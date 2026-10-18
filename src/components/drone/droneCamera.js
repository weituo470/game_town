import { DRONE_DRAGON, DRONE_STUNT, sampleDroneShow } from '../../../shared/droneShow.js';

// Stop the camera before the first sector lets go. The water, shoreline and
// waiting sectors must stay fixed on screen while each falling sector drops.
const FALL_CAMERA = [[34, 96, 265], [0, 36, 78]];
const DRAGON_CAMERA = [[17, 65, 200], [0, 64, -5]];

const KEYS = [
  [0, [10, 34, 98], [0, 4, -1], 92],
  [8, [10, 33, 101], [0, 9, -2], 94],
  [28, [16, 29, 142], [0, 43, -8], 100],
  [DRONE_DRAGON.start / 1000, [16, 44, 166], [0, 52, -8], 122],
  [DRONE_DRAGON.formed / 1000, ...DRAGON_CAMERA, 144],
  [DRONE_DRAGON.holdEnd / 1000, ...DRAGON_CAMERA, 144],
  // Portrait: translate both ends upward, moving the whole child below the
  // stacked show menu without changing the viewing angle or character scale.
  [68, [10, 39, 150], [0, 66, -8], 112],
  [DRONE_STUNT.gatherStart / 1000, [3, 40, 153], [0, 66, -8], 112],
  [84, [18, 155, 230], [0, 57, 70], 120],
  [84.4, [18, 155, 230], [0, 57, 70], 120],
  [87.8, ...FALL_CAMERA, 126],
  [DRONE_STUNT.fallStart / 1000, ...FALL_CAMERA, 126],
  [DRONE_STUNT.brakeStart / 1000, ...FALL_CAMERA, 126],
  [DRONE_STUNT.recoverStart / 1000, ...FALL_CAMERA, 126],
  [DRONE_STUNT.wingEnd / 1000, [-7, 67, 240], [0, 38, 86], 132],
  [DRONE_STUNT.reformEnd / 1000, [-7, 40, 153], [0, 66, -8], 112],
  [108, [-7, 38, 153], [0, 66, -8], 112],
  [128, [10, 32, 130], [0, 28, -4], 102],
  [148, [10, 34, 98], [0, 4, -1], 92],
  [180, [10, 34, 98], [0, 4, -1], 92],
];
const smooth = value => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
// The wider hero-to-sky-eye pan needs a lower speed peak than smoothstep.
// Quarter-duration acceleration/deceleration keeps C1 joins and a 4/3 peak
// derivative (rather than 3/2), with no extra keyframe or camera cut.
const steadyPan = value => {
  const t = Math.min(1, Math.max(0, value));
  if (t < .25) return 8 * t * t / 3;
  if (t > .75) return 1 - 8 * (1 - t) * (1 - t) / 3;
  return 4 * t / 3 - 1 / 6;
};
// A landscape screen has room for an architectural foreground. Keep the
// fountain and a street block below the figure, not behind the transport HUD.
// Portrait framing retains the closer, near-frontal rail above.
const LANDSCAPE_POSES = {
  28: [[16, 42, 152], [0, 36, -8]],
  [DRONE_DRAGON.start / 1000]: [[16, 52, 174], [0, 45, -8]],
  [DRONE_DRAGON.formed / 1000]: DRAGON_CAMERA,
  [DRONE_DRAGON.holdEnd / 1000]: DRAGON_CAMERA,
  // Landscape: a matched -44m translation places the eyes ~180px right of
  // center, clear of the left menu. The fountain stays under the full figure.
  68: [[-34, 68, 178], [-44, 40, -8]],
  [DRONE_STUNT.gatherStart / 1000]: [[-41, 70, 180], [-44, 40, -8]],
  // The eye is a horizontal mandala. Rise above its plane before it settles:
  // a shallow frontal angle merges the concentric rings into a white stripe.
  84: [[18, 155, 230], [0, 57, 70]],
  87.8: FALL_CAMERA,
  [DRONE_STUNT.fallStart / 1000]: FALL_CAMERA,
  [DRONE_STUNT.brakeStart / 1000]: FALL_CAMERA,
  [DRONE_STUNT.recoverStart / 1000]: FALL_CAMERA,
  [DRONE_STUNT.wingEnd / 1000]: [[10, 70, 244], [0, 36, 72]],
  [DRONE_STUNT.reformEnd / 1000]: [[-51, 68, 180], [-44, 40, -8]],
  108: [[-51, 66, 180], [-44, 40, -8]],
  128: [[10, 40, 135], [0, 19, -4]],
};
// Reduced motion uses a truly stationary wide shot containing both the pads
// and the highest hair spike, rather than a static close-up hiding recovery.
const STATIC_CAMERA = [0, [0, 48, 230], [0, 48, -8], 144];

/** Pure director rail, usable by visibility tests without a browser or React. */
export function sampleDroneCamera(timeMs, aspect = 16 / 9, reducedMotion = false) {
  const seconds = sampleDroneShow(timeMs).seconds;
  let a = KEYS[0], b = KEYS[1];
  if (reducedMotion) a = b = STATIC_CAMERA;
  else {
    for (let i = 1; i < KEYS.length; i++) {
      if (seconds <= KEYS[i][0]) { a = KEYS[i - 1]; b = KEYS[i]; break; }
    }
  }
  const ease = a[0] === DRONE_STUNT.gatherStart / 1000 && b[0] === 84 ? steadyPan : smooth;
  const progress = a === b ? 0 : ease((seconds - a[0]) / Math.max(0.001, b[0] - a[0]));
  const position = a[1].map((value, axis) => lerp(value, b[1][axis], progress));
  const target = a[2].map((value, axis) => lerp(value, b[2][axis], progress));
  const safeAspect = Number.isFinite(aspect) ? Math.max(0.25, aspect) : 16 / 9;
  const townView = reducedMotion ? 0 : smooth((safeAspect - 0.8) / 0.5);
  const landscapeA = LANDSCAPE_POSES[a[0]] || [a[1], a[2]];
  const landscapeB = LANDSCAPE_POSES[b[0]] || [b[1], b[2]];
  for (let axis = 0; axis < 3; axis++) {
    position[axis] = lerp(position[axis], lerp(landscapeA[0][axis], landscapeB[0][axis], progress), townView);
    target[axis] = lerp(target[axis], lerp(landscapeA[1][axis], landscapeB[1][axis], progress), townView);
  }
  const offset = position.map((value, axis) => value - target[axis]);
  const distance = Math.hypot(...offset);
  const worldWidth = lerp(a[3], b[3], progress);
  const minimumDistance = worldWidth / (2 * Math.tan(25 * Math.PI / 180) * safeAspect);
  if (minimumDistance > distance) {
    for (let axis = 0; axis < 3; axis++) position[axis] = target[axis] + offset[axis] * minimumDistance / distance;
  }
  return { position, target, fov: 50, near: 0.1, far: 600 };
}
