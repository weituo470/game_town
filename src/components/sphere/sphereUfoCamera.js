import { SPHERE_LANDMARK as S } from '../../../shared/sphere-landmark.js';
import { sampleSphereUfoShow } from '../../../shared/sphereUfoShow.js';
const smooth = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** A gentle cinematic cutaway; never applied to exploration or onboard FPV. */
export function sphereGuestCamera(base, ms, aspect, reducedMotion = false) {
  if (!base || reducedMotion || ms <= 108000 || ms >= 142000) return base;
  const blend = smooth((ms - 108000) / 4000) * (1 - smooth((ms - 137000) / 5000));
  const state = sampleSphereUfoShow(ms), centre = [S.x, S.centerY + 4, S.z];
  const home = sphereGuestFocus(), settle = smooth((ms - 134000) / 3000);
  const focus = ms < 134000 ? state.position : state.splashPosition.map((v, i) => v + (home[i] - v) * settle);
  const target = centre.map((v, i) => v * .55 + focus[i] * .45);
  const span = Math.hypot(...centre.map((v, i) => v - focus[i]));
  const radius = S.radius + span * .55;
  const halfFov = Math.min(26 * Math.PI / 180, Math.atan(Math.tan(26 * Math.PI / 180) * Math.max(.25, aspect)));
  const distance = Math.max(105, radius / Math.sin(halfFov)), angle = S.faceYaw + .23;
  const position = [target[0] + Math.sin(angle) * distance * .94, target[1] + distance * .34, target[2] + Math.cos(angle) * distance * .94];
  const lerp = (a, b) => a.map((x, i) => x + (b[i] - x) * blend);
  return { ...base, position: lerp(base.position, position), target: lerp(base.target, target), fov: base.fov + (52 - base.fov) * blend, far: Math.max(base.far || 600, 1800) };
}

const sphereGuestFocus = () => [S.x + Math.sin(S.faceYaw) * 36, 29, S.z + Math.cos(S.faceYaw) * 36];
