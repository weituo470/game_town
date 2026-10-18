import { DROPLET_SCORE } from '../../../shared/droneDroplet.js';

// The camera reads all six fleet layers from an oblique angle. It never
// inherits the waterdrop's impossible acceleration or instant direction turns.
// Seconds, position, target, minimum visible width, optional vertical FOV.
const KEYS = [
  [0, [14, 36, 106], [0, 4, -1], 94],
  [8, [20, 45, 130], [0, 12, -6], 110],
  // A restrained long lens and near-horizontal diagonal view widen the cube
  // without letting its nearest lower layer disappear behind the console.
  [28, [457, 194, 407], [0, 126, -50], 350, 30],
  [34, [457, 194, 407], [0, 126, -50], 350, 30],
  // After the cube has been understood, move among the front ranks. This is
  // an intentional detail shot: a ship must read as a vessel, not a speck.
  [42, [125, 158, 126], [15, 145, 25], 160, 42],
  [44, [125, 158, 126], [15, 145, 25], 160, 42],
  // Hold the same reflective surface long enough to read its round head,
  // pointed tail and undisturbed reflections before the sudden attack.
  [50, [8, 141, 108], [0, 135, 65], 35],
  [58, [8, 141, 108], [0, 135, 65], 35],
  // The first penetration is the one close battle shot. The other layers
  // remain in the background; a slow pull-back reveals the whole catastrophe.
  // The faster route now turns at +/-190, so this remains a closer opening
  // view but includes its complete sharp corners on desktop and portrait.
  [DROPLET_SCORE.strikeStart / 1000, [45, 140, 160], [0, 130, -125], 450],
  [DROPLET_SCORE.firstTurn / 1000, [45, 140, 160], [0, 130, -125], 450],
  // Start pulling back after the first 280 ms pass, without adopting the
  // probe's violent acceleration. Hold the whole fleet during the silent beat.
  [DROPLET_SCORE.firstTurn / 1000 + 8, [450, 195, 412], [0, 126, -50], 400, 30],
  [DROPLET_SCORE.attackEnd / 1000, [450, 195, 412], [0, 126, -50], 400, 30],
  [DROPLET_SCORE.collapseStart / 1000, [450, 195, 412], [0, 126, -50], 400, 30],
  [DROPLET_SCORE.lastExplosion / 1000 + 8, [430, 191, 430], [0, 126, -45], 400, 30],
  [104, [425, 188, 440], [0, 126, -40], 400, 30],
  [114, [425, 188, 440], [0, 126, -40], 400, 30],
  [134, [35, 56, 175], [0, 28, -4], 150],
  [148, [14, 36, 106], [0, 4, -1], 94],
  [180, [14, 36, 106], [0, 4, -1], 94],
];
const STILL = [0, [215, 245, 330], [0, 130, -45], 370];
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/** Deterministic framing for arbitrary scrubbing, with no integration drift. */
export function sampleDropletCamera(timeMs, aspect = 16 / 9, reducedMotion = false) {
  const seconds = Math.max(0, Math.min(180, Number.isFinite(timeMs) ? timeMs / 1000 : 0));
  const safeAspect = Number.isFinite(aspect) ? Math.max(0.25, aspect) : 16 / 9;
  let a = KEYS[0], b = KEYS[1];
  if (reducedMotion) a = b = STILL;
  else {
    for (let index = 1; index < KEYS.length; index++) {
      if (seconds <= KEYS[index][0]) { a = KEYS[index - 1]; b = KEYS[index]; break; }
    }
  }
  const progress = a === b ? 0 : smooth((seconds - a[0]) / (b[0] - a[0]));
  const position = a[1].map((value, axis) => lerp(value, b[1][axis], progress));
  const target = a[2].map((value, axis) => lerp(value, b[2][axis], progress));
  const offset = position.map((value, axis) => value - target[axis]);
  const distance = Math.hypot(...offset);
  const worldWidth = lerp(a[3], b[3], progress);
  const fov = lerp(a[4] ?? 50, b[4] ?? 50, progress);
  const minimumDistance = worldWidth / (2 * Math.tan(fov / 2 * Math.PI / 180) * safeAspect);
  if (minimumDistance > distance) {
    for (let axis = 0; axis < 3; axis++) position[axis] = target[axis] + offset[axis] * minimumDistance / distance;
  }
  return { position, target, fov, near: 0.1, far: 3000 };
}
