import { SPHERE_LANDMARK } from '../../../shared/sphere-landmark.js';

/** Framing reserves the top title and bottom controls without cropping the globe. */
export function sphereCameraShot(aspect = 16 / 9, seconds = 0, orbit = false, reducedMotion = false) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? Math.max(.25, aspect) : 16 / 9;
  const portrait = ratio < .8;
  const fov = portrait ? 50 : 44;
  const halfAngle = Math.atan(Math.tan(fov * Math.PI / 360) * Math.min(1, ratio));
  const distance = Math.max(72, SPHERE_LANDMARK.radius / Math.sin(halfAngle) * 1.2);
  const t = Number.isFinite(seconds) ? seconds : 0;
  const yaw = SPHERE_LANDMARK.faceYaw + (orbit && !reducedMotion ? Math.sin(t * .11) * .48 : 0);
  return {
    position: [SPHERE_LANDMARK.x + Math.sin(yaw) * distance, 21, SPHERE_LANDMARK.z + Math.cos(yaw) * distance],
    target: [SPHERE_LANDMARK.x, portrait ? 14.5 : 14, SPHERE_LANDMARK.z],
    fov, near: .1, far: 420,
  };
}
