/** A continuous, seekable 28-second character performance. No timers or assets. */
export const SPHERE_FACE_CYCLE_MS = 28000;
export const SPHERE_FACE_BEATS = Object.freeze([
  Object.freeze({ id: 'welcome', name: '微笑打量', atMs: 700 }),
  Object.freeze({ id: 'blowing', name: '鼓腮吹泡泡', atMs: 5200 }),
  Object.freeze({ id: 'wonder', name: '惊讶追云', atMs: 11800 }),
  Object.freeze({ id: 'wink', name: '单眼眨眼', atMs: 17200 }),
  Object.freeze({ id: 'smirk', name: '挑眉偷笑', atMs: 18500 }),
  Object.freeze({ id: 'laugh', name: '开心大笑', atMs: 20600 }),
  Object.freeze({ id: 'yawn', name: '困倦哈欠', atMs: 24200 }),
  Object.freeze({ id: 'settle', name: '满足微笑', atMs: 27100 }),
]);
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const smooth = (a, b, n) => { const x = clamp((n - a) / (b - a)); return x * x * (3 - 2 * x); };
const window = (t, a, b, fade) => smooth(a, a + fade, t) * (1 - smooth(b - fade, b, t));
const pulse = (t, center, width) => Math.exp(-(((t - center) / width) ** 2));
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;

/** Reuses optional out; all eyes/mouth/brows are CPU-testable, not hidden in GLSL.
 * bubbleExpression.timeMs is the same resettable clock as the emitted bubbles.
 */
export function sampleSphereFace(timeMs = 0, { reducedMotion = false, bubbleExpression } = {}, out = {}) {
  const sourceTime = finite(bubbleExpression?.timeMs, finite(timeMs));
  const t = reducedMotion ? 0 : Math.max(0, sourceTime) % SPHERE_FACE_CYCLE_MS / 1000;
  const curious = window(t, .15, 1.5, .32);
  const wonder = window(t, 9.65, 16.1, .8);
  const wink = window(t, 16.6, 18.05, .30);
  const smirk = window(t, 17.9, 19.55, .42);
  const laugh = window(t, 19.3, 22.45, .60);
  const yawn = window(t, 22.8, 25.8, .75);
  const settle = window(t, 26.0, 27.9, .55);
  const inferredBlow = window(t, 1.6, 10.0, .65);
  const blow = reducedMotion ? 0 : clamp(finite(bubbleExpression?.blow, inferredBlow) * 1.5);
  const lookUp = reducedMotion ? 0 : clamp(finite(bubbleExpression?.lookUp, window(t, 9.0, 26.7, 2.1)));
  const blink = reducedMotion ? 0 : clamp(pulse(t, .95, .075) + pulse(t, 1.23, .07) + pulse(t, 6.1, .09) + pulse(t, 14.7, .085) + pulse(t, 26.4, .10));
  const friendly = 1 - Math.max(blow, wonder, laugh, yawn);
  // Asymmetric eye acting is deliberate: a wink is not a blink on both sides.
  out.leftOpen = clamp((1 - .86 * wink - .94 * laugh - .62 * yawn - .12 * settle) * (1 - .97 * blink), .025, 1);
  out.rightOpen = clamp((1 - .90 * laugh - .58 * yawn - .12 * settle) * (1 - .97 * blink), .025, 1);
  out.gazeX = clamp(.075 * curious - .032 * smirk + .018 * Math.sin(t * 1.7) * wonder, -.09, .09);
  out.gazeY = clamp(-.018 + .108 * Math.max(lookUp, wonder) * (1 - yawn) + .025 * wonder - .024 * yawn, -.06, .12);
  out.leftBrowLift = clamp(.075 * curious - .035 * wink + .055 * smirk + .10 * wonder + .025 * laugh - .035 * yawn, -.06, .16);
  out.rightBrowLift = clamp(.028 * curious + .07 * wink - .01 * smirk + .10 * wonder + .025 * laugh - .045 * yawn, -.06, .16);
  out.leftBrowTilt = clamp(-.035 * curious + .025 * wink + .022 * smirk, -.05, .05);
  out.rightBrowTilt = clamp(.018 * curious - .027 * wink, -.05, .05);
  // Start with a genuinely curved smile, not the old permanently round mouth.
  const total = Math.max(1, blow + wonder + laugh + yawn);
  const neutral = Math.max(0, 1 - blow - wonder - laugh - yawn);
  out.mouthWidth = (.158 * neutral + .076 * blow + .085 * wonder + .227 * laugh + .092 * yawn) / total + .026 * smirk;
  out.mouthHeight = (.023 * neutral + .078 * blow + .125 * wonder + .143 * laugh + .191 * yawn) / total;
  out.smile = clamp(.72 * friendly + .25 * smirk + .88 * laugh + .15 * settle);
  out.roundness = clamp(.08 + .92 * Math.max(blow, wonder, yawn));
  out.laugh = laugh;
  out.blush = clamp(.10 + .52 * laugh + .36 * smirk + .24 * settle);
  out.sleepy = yawn;
  out.cheeky = clamp(wink + smirk);
  out.timeMs = t * 1000;
  out.phase = blow > .5 ? 'blowing' : wonder > .5 ? 'wonder' : wink > .5 ? 'wink' : smirk > .5 ? 'smirk' : laugh > .5 ? 'laugh' : yawn > .5 ? 'yawn' : settle > .5 ? 'settle' : 'welcome';
  return out;
}

