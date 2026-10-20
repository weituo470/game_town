import { SPHERE_LANDMARK } from '../../../shared/sphere-landmark.js';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = (from, to, value) => { const x = clamp((value - from) / (to - from)); return x * x * (3 - 2 * x); };
const latitude = -.205, yaw = SPHERE_LANDMARK.faceYaw;
const normal = Object.freeze([Math.sin(yaw) * Math.cos(latitude), Math.sin(latitude), Math.cos(yaw) * Math.cos(latitude)]);
export const SPHERE_BUBBLE_MOUTH = Object.freeze({
  latitude, longitude: 0,
  local: Object.freeze([normal[0] * SPHERE_LANDMARK.radius, SPHERE_LANDMARK.centerY + normal[1] * SPHERE_LANDMARK.radius, normal[2] * SPHERE_LANDMARK.radius]),
  normal,
});
export const SPHERE_BUBBLE_BUDGET = Object.freeze({ cycleMs: 28000, capacity: 8, cloudLobes: 5, drawCalls: 2, triangles: 12000, maxHeight: 43, maxRadius: 30 });
const localTime = value => (Number.isFinite(value) ? Math.max(0, value) : 0) % SPHERE_BUBBLE_BUDGET.cycleMs;

/** Facial anticipation, exhalation and upward gaze share the bubbles' 28s clock. */
export function sampleSphereBubbleCue(timeMs = 0, { reducedMotion = false } = {}) {
  const seconds = (reducedMotion ? 6200 : localTime(timeMs)) / 1000;
  const envelope = smooth(1.55, 2.2, seconds) * (1 - smooth(9, 10, seconds));
  const blow = envelope * (.82 + .18 * Math.sin((seconds - 2) * Math.PI * 2 / .9) ** 2);
  return {
    timeMs: seconds * 1000,
    phase: seconds < 2 ? 'anticipation' : seconds < 10 ? 'blowing' : seconds < 17 ? 'transforming' : seconds < 26 ? 'drifting' : 'reset',
    blow, lipOpen: .15 + .85 * blow,
    cheek: smooth(.1, 1.7, seconds) * (1 - smooth(8.8, 10.8, seconds)),
    lookUp: smooth(8.8, 15.5, seconds) * (1 - smooth(25, 27.5, seconds)),
    reducedMotion: Boolean(reducedMotion),
  };
}

/**
 * Building-local pose: the parent applies the landmark world translation once.
 * Optional out object lets the renderer reuse all eight records on every frame.
 */
export function sampleSphereBubble(timeMs = 0, index = 0, { reducedMotion = false } = {}, out = {}) {
  const id = Number.isInteger(index) && index >= 0 && index < SPHERE_BUBBLE_BUDGET.capacity ? index : -1;
  const staticVisible = id === 0 || id === 3 || id === 6;
  const time = reducedMotion ? (id === 0 ? 6200 : id === 3 ? 9700 : 19000) : localTime(timeMs);
  const birth = 2000 + Math.max(0, id) * 900, age = time - birth;
  const inflationMs = id === 0 ? 1800 : 950;
  const inflation = smooth(0, inflationMs, age);
  const release = birth + inflationMs;
  const rise = smooth(release, 22800, time), drift = smooth(17000, 26500, time);
  const targetRadius = id === 0 ? 2.7 : 1.05 + (id % 3) * .27;
  const radius = .06 + (targetRadius - .06) * inflation;
  const morph = smooth(11000 + id * 350, 14300 + id * 350, time);
  const fade = 1 - smooth(23500 + id * 90, 27300, time);
  const visible = id >= 0 && age >= 0 && fade > 0 && (!reducedMotion || staticVisible);
  // Keep the mouth's bubble chain tight, then fan out the clouds rather than
  // stacking eight billows into one small white patch above the forehead.
  const spread = (id - 3.5) * (.78 + morph * 1.1);
  const sway = Math.sin((time - release) / 2300 + id * 1.7) * .44 * rise;
  const sideways = spread * rise + sway + (id - 3.5) * drift * .3;
  const outward = radius * 1.015 + rise * 2.4 + drift * 1.4;
  const normalX = SPHERE_BUBBLE_MOUTH.normal[0], normalY = SPHERE_BUBBLE_MOUTH.normal[1], normalZ = SPHERE_BUBBLE_MOUTH.normal[2];
  out.x = SPHERE_BUBBLE_MOUTH.local[0] + normalX * outward + Math.cos(yaw) * sideways;
  out.y = SPHERE_BUBBLE_MOUTH.local[1] + normalY * radius * 1.015 + rise * (27.8 + id * .34) + drift * .8;
  out.z = SPHERE_BUBBLE_MOUTH.local[2] + normalZ * outward - Math.sin(yaw) * sideways;
  out.radius = radius;
  out.bubbleOpacity = visible ? smooth(0, 180, age) * (1 - smooth(.15, .94, morph)) * fade : 0;
  out.cloudOpacity = visible ? smooth(.04, .88, morph) * fade : 0;
  out.cloudScale = (id === 0 ? 1.72 : 1.3 + (id % 3) * .13) * (.72 + .28 * morph);
  out.cloudSpread = .65 + .35 * morph + drift * .18;
  out.visible = visible;
  out.phase = !visible ? 'hidden' : age < inflationMs ? 'inflating' : morph <= 0 ? 'rising' : morph < 1 ? 'transforming' : 'cloud';
  out.detached = age >= inflationMs;
  out.index = id;
  return out;
}
