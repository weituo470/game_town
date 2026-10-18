import { sampleBattleTurret } from './carrierBattle.js';

// Decorative cinema strokes only. These are not ballistics, ammunition,
// targeting, or damage events: the existing 64 authored encounters are intact.
export const BARRAGE_PER_MOUNT = 64;
export const BARRAGE_COUNT = 4 * BARRAGE_PER_MOUNT;
export const BARRAGE_WINDOW = Object.freeze({ start: 22000, dense: 38000, end: 58000 });
const TAU = Math.PI * 2, CYCLE = 720, BURST_CYCLE = 1420;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const u = clamp(value); return u * u * (3 - 2 * u); };
const safeTime = value => Number.isFinite(value) ? Math.max(0, Math.min(150000, value)) : 0;
const safeId = (value, count) => Number.isFinite(value) ? Math.max(0, Math.min(count - 1, Math.floor(value))) : 0;
const modulo = (value, divisor) => ((value % divisor) + divisor) % divisor;
const mix = (a, b, progress) => a + (b - a) * progress;
const normalize = vector => { const length = Math.max(1e-8, Math.hypot(...vector)); return vector.map(value => value / length); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const denseAt = time => smooth((time - 36000) / 2000);
const envelope = time => smooth((time - BARRAGE_WINDOW.start) / 450) * (1 - smooth((time - 57000) / 1000));

function burst(time, mount) {
  if (time <= BARRAGE_WINDOW.start || time >= BARRAGE_WINDOW.end) return 0;
  const phase = modulo(time - BARRAGE_WINDOW.start + mount * 310, BURST_CYCLE);
  const on = mix(1120, 1320, denseAt(time));
  return smooth(phase / 70) * (1 - smooth((phase - on + 70) / 70));
}
const STROKES = Object.freeze(Array.from({ length: BARRAGE_PER_MOUNT }, (_, index) => {
  const angle = index * 2.399963229728653, radius = .018 + Math.sqrt(((index * 37) % 64 + .5) / 64) * .05;
  return Object.freeze({ horizontal: Math.cos(angle) * radius, vertical: Math.sin(angle) * radius,
    densityRank: ((index * 29) % 64 + .5) / 64, phase: index / 64,
    length: .038 + (index % 5) * .006, radius: .032 + (index % 3) * .005 });
}));

// Exact-time one-frame cache: only four turret poses/event scans for all 256
// strokes, plus the muzzle glow and rotating barrel visual. Seeking backward
// simply replaces this cache; nothing integrates or depends on call order.
let cachedTime = NaN, cachedReduced = false, cachedMounts = [];
function frame(timeMs, reducedMotion) {
  const time = safeTime(timeMs), reduced = Boolean(reducedMotion);
  if (time === cachedTime && reduced === cachedReduced) return cachedMounts;
  cachedTime = time; cachedReduced = reduced;
  cachedMounts = Array.from({ length: 4 }, (_, mountId) => {
    const pose = sampleBattleTurret(time, mountId, reduced);
    const origin = Object.freeze([...pose.muzzle]), target = Object.freeze([...pose.target]);
    const direction = normalize(target.map((value, axis) => value - origin[axis]));
    const right = normalize(cross(direction, Math.abs(direction[1]) > .96 ? [1, 0, 0] : [0, 1, 0]));
    const up = cross(right, direction);
    const strength = reduced ? 0 : envelope(time) * burst(time, mountId);
    return Object.freeze({ mountId, time, origin, target, base: Object.freeze([...pose.base]), pivot: Object.freeze([...pose.pivot]), direction: Object.freeze(direction), right: Object.freeze(right), up: Object.freeze(up),
      distance: Math.max(8, Math.hypot(...target.map((value, axis) => value - origin[axis]))),
      firing: strength > .08, strength,
      spin: reduced ? 0 : Math.max(0, Math.min(36000, time - BARRAGE_WINDOW.start)) * .018 % TAU });
  });
  return cachedMounts;
}

export function sampleBarrageMount(timeMs = 0, mount = 0, reducedMotion = false) {
  return frame(timeMs, reducedMotion)[safeId(mount, 4)];
}

/** Each result is one SHORT travelling stroke, never a muzzle-to-target beam. */
export function sampleBarrageRound(timeMs = 0, index = 0, reducedMotion = false) {
  const id = safeId(index, BARRAGE_COUNT), mountId = Math.floor(id / BARRAGE_PER_MOUNT), slot = id % BARRAGE_PER_MOUNT;
  const mount = frame(timeMs, reducedMotion)[mountId], stroke = STROKES[slot], time = mount.time;
  const progress = modulo((time - BARRAGE_WINDOW.start) / CYCLE + stroke.phase, 1);
  const launchTime = time - progress * CYCLE;
  const density = mix(.73, 1.04, denseAt(launchTime));
  const selected = smooth((density - stroke.densityRank) / .06);
  const opacity = reducedMotion ? 0 : .82 * envelope(time) * burst(launchTime, mountId) * selected
    * smooth(progress / .035) * (1 - smooth((progress - .85) / .15));
  const visible = time >= BARRAGE_WINDOW.start && time < BARRAGE_WINDOW.end && opacity > .02;
  const tailProgress = Math.max(0, progress - stroke.length);
  const point = u => mount.origin.map((value, axis) => value + mount.distance * u * (mount.direction[axis]
    + mount.right[axis] * stroke.horizontal + mount.up[axis] * stroke.vertical));
  const tail = point(tailProgress), head = point(progress);
  return { id, mountId, visible, opacity: visible ? opacity : 0, origin: mount.origin, tail, head, start: tail, end: head, progress,
    radius: stroke.radius, length: Math.hypot(...head.map((value, axis) => value - tail[axis])) };
}
