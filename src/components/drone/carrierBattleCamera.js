import { sampleCarrierBattle } from '../../../shared/carrierBattle.js';

// A director's close three-quarter rail, not a tactical map. Keep the same
// carrier large enough to read its machinery; peripheral attackers may leave
// the frame. Keys contain time, offset from the ship, and ship-relative target.
const KEYS = [
  [0, [50, 26, 62], [63, 3, 20]],
  [14000, [45, 26, 53], [67, 8, 22]],
  [38000, [38, 24, 44], [66, 7, 21]],
  [58000, [40, 27, 47], [63, 3, 20]],
  [78000, [48, 31, 56], [63, 3, 20]],
  [98000, [48, 31, 56], [63, 3, 20]],
  [114000, [48, 31, 56], [63, 3, 20]],
  [124000, [59, 33, 65], [71, 5, 23]],
  [136000, [59, 33, 65], [71, 5, 23]],
  [150000, [50, 26, 62], [63, 3, 20]],
];
const STILL = [[112, 29, 82], [63, 3, 20]];
const smooth = value => { const u = Math.max(0, Math.min(1, value)); return u * u * (3 - 2 * u); };
const lerp = (a, b, u) => a + (b - a) * u;
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const normalize = vector => { const size = Math.hypot(...vector); return vector.map(value => value / size); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Pure absolute-time camera; no extra clock, fleet, world or accumulated lerp. */
export function sampleCarrierBattleCamera(timeMs = 0, aspect = 16 / 9, reducedMotion = false) {
  const state = sampleCarrierBattle(timeMs, { reducedMotion }), time = state.elapsed;
  let position, target;
  if (reducedMotion) { position = [...STILL[0]]; target = [...STILL[1]]; }
  else {
    let index = 0;
    while (index < KEYS.length - 2 && time > KEYS[index + 1][0]) index++;
    const a = KEYS[index], b = KEYS[index + 1], u = smooth((time - a[0]) / (b[0] - a[0]));
    target = a[2].map((value, axis) => lerp(value, b[2][axis], u));
    target[1] += state.carrier.height;
    position = a[1].map((value, axis) => target[axis] + lerp(value, b[1][axis], u));
  }
  const safeAspect = Number.isFinite(aspect) ? Math.max(.25, aspect) : 16 / 9;
  // Fit the hero ship itself, including its expanding sponsons and plume ends.
  // Fitting the entire 100-metre combat volume made this vessel a tiny toy and
  // erased the very transformation the camera is supposed to reveal.
  const halfWidth = 10.4 + state.carrier.deploy * 6.25;
  const minimum = [63 - halfWidth, Math.max(-1.28, state.carrier.height - 8.6), 4.5];
  const maximum = [63 + halfWidth, state.carrier.height + 8, 35.5];
  const corners = [];
  for (const x of [minimum[0], maximum[0]]) for (const y of [minimum[1], maximum[1]]) for (const z of [minimum[2], maximum[2]]) corners.push([x, y, z]);
  const tanY = Math.tan(25 * Math.PI / 180), tanX = tanY * safeAspect;
  const verticalMargin = safeAspect < .8 ? .38 : .58;
  // Solve the frustum fit analytically along the viewing axis. The bottom HUD
  // and top programme chooser are protected without reducing their font sizes.
  // If a low-angle portrait dolly would enter the sea, constrain eye height and
  // refit. This keeps the ascent visibly above the observer, never underwater.
  for (let iteration = 0; iteration < 8; iteration++) {
    const offset = position.map((value, axis) => value - target[axis]);
    const distance = Math.hypot(...offset), forward = normalize(offset.map(value => -value));
    const right = normalize(cross(forward, [0, 1, 0])), up = cross(right, forward);
    let needed = distance;
    for (const corner of corners) {
      const relative = corner.map((value, axis) => value - target[axis]), depth = dot(relative, forward);
      needed = Math.max(needed, Math.abs(dot(relative, right)) / (tanX * .90) - depth, Math.abs(dot(relative, up)) / (tanY * verticalMargin) - depth);
    }
    if (needed <= distance + 1e-7 && position[1] >= 4) break;
    position = target.map((value, axis) => value + offset[axis] * needed / distance);
    position[1] = Math.max(4, position[1]);
  }
  return { position, target, fov: 50, near: .1, far: 1000 };
}
