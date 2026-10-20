import { SPHERE_LANDMARK } from '../../../shared/sphere-landmark.js';

const FRAMING_POINTS = [];
for (let lat = 0; lat <= 10; lat++) for (let az = 0; az < 20; az++) {
  const phi = lat / 10 * Math.acos((SPHERE_LANDMARK.baseY - SPHERE_LANDMARK.centerY) / SPHERE_LANDMARK.radius);
  const a = az / 20 * Math.PI * 2;
  FRAMING_POINTS.push([Math.sin(phi) * Math.cos(a) * 18, SPHERE_LANDMARK.centerY + Math.cos(phi) * 18, Math.sin(phi) * Math.sin(a) * 18]);
}
// The ascending plume stays in front of the face, not behind the building.
for (const x of [12, 29]) for (const y of [8, 44]) for (const z of [-2, 20]) FRAMING_POINTS.push([x,y,z]);

/** Keep the face AND its ascending clouds visible above the readable controls. */
export function sphereCameraShot(aspect = 16 / 9, seconds = 0, orbit = false, reducedMotion = false) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? Math.max(.25, aspect) : 16 / 9;
  const portrait = ratio < .8, fov = portrait ? 50 : 44;
  const t = Number.isFinite(seconds) ? seconds : 0;
  const yaw = SPHERE_LANDMARK.faceYaw + (orbit && !reducedMotion ? Math.sin(t * .11) * .48 : 0);
  const elevation = .09, tangent = Math.tan(fov * Math.PI / 360);
  const direction = [Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation)];
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = [-Math.sin(yaw) * Math.sin(elevation), Math.cos(elevation), -Math.cos(yaw) * Math.sin(elevation)];
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  const limits = portrait ? {top:.72, bottom:-.02, center:.35} : {top:.70, bottom:-.47, center:.12};
  let distance = 76;
  for (const [x,y,z] of FRAMING_POINTS) {
    const p = [x, y - 23, z], depth = dot(p, direction), height = dot(p, up) / tangent;
    distance = Math.max(distance, depth + Math.abs(dot(p, right)) / (tangent * ratio * .91),
      (height + limits.top * depth) / (limits.top - limits.center),
      (-height - limits.bottom * depth) / (limits.center - limits.bottom));
  }
  distance *= 1.015;
  const pan = -limits.center * distance * tangent;
  const center = [SPHERE_LANDMARK.x, 23, SPHERE_LANDMARK.z];
  const target = center.map((v, i) => v + up[i] * pan);
  return { position: target.map((v, i) => v + direction[i] * distance), target, fov, near:.1, far:620 };
}
