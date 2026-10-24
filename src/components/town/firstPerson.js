import { SPAWN, isWalkable } from '../../../shared/world.js';
import { flightFloor } from '../../../shared/jetpack.js';

export const FIRST_PERSON_EYE_HEIGHT = 1.7;
export const LOOK_SENSITIVITY = 0.0022;
export const CLOSE_THIRD_PERSON = Object.freeze({ distance: 4.4, portraitDistance: 5.2, targetHeight: 1.15, fov: 58, portraitFov: 62, clearance: .22 });

export function closeThirdPersonLens(aspect) {
  const portrait = Number.isFinite(aspect) && aspect > 0 && aspect < .75;
  return { distance: portrait ? CLOSE_THIRD_PERSON.portraitDistance : CLOSE_THIRD_PERSON.distance, fov: portrait ? CLOSE_THIRD_PERSON.portraitFov : CLOSE_THIRD_PERSON.fov };
}

const PITCH_LIMIT = Math.PI / 2 - 0.12;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const inputAxis = value => Math.max(-1, Math.min(1, finite(value)));

// Heading zero faces world -Z. Positive headings turn right, independently
// of the avatar mesh's rotation convention and any third-person camera offset.
export function firstPersonInput(forward, right, yaw) {
  const f = inputAxis(forward);
  const r = inputAxis(right);
  const heading = finite(yaw);
  const divisor = Math.max(1, Math.hypot(f, r));
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  return {
    x: (f * sin + r * cos) / divisor,
    z: (-f * cos + r * sin) / divisor,
  };
}

export function clampLookPitch(pitch) {
  return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, finite(pitch)));
}

export function lookDirection(yaw, pitch) {
  const heading = finite(yaw);
  const elevation = clampLookPitch(pitch);
  const horizontal = Math.cos(elevation);
  return {
    x: Math.sin(heading) * horizontal,
    y: Math.sin(elevation),
    z: -Math.cos(heading) * horizontal,
  };
}

export function firstPersonEye(pose) {
  return {
    x: finite(pose?.x, SPAWN.x),
    y: FIRST_PERSON_EYE_HEIGHT + Math.max(0, finite(pose?.y)),
    z: finite(pose?.z, SPAWN.z),
  };
}

// The legacy mode id remains `first-person`, but the view now follows a visible
// avatar from a close third-person boom. Input yaw keeps its established axes.
export function closeThirdPersonCamera(pose, yaw, pitch, options = {}) {
  const x = finite(pose?.x, SPAWN.x), z = finite(pose?.z, SPAWN.z), y = Math.max(0, finite(pose?.y));
  // Aerial orbit must genuinely look upward, rather than stopping at the old
  // nine-degree ceiling. Ground clearance still keeps the lens out of terrain.
  const heading = finite(yaw), elevation = Math.max(-1.08, Math.min(1.25, .38 - clampLookPitch(pitch)));
  const target = { x, y: y + finite(options.targetHeight, CLOSE_THIRD_PERSON.targetHeight), z };
  const direction = { x: -Math.sin(heading) * Math.cos(elevation), y: Math.sin(elevation), z: Math.cos(heading) * Math.cos(elevation) };
  // Narrow screens keep the whole character between the controls rather than
  // magnifying the torso. Desktop retains the original intimate 4.4m boom.
  const distance = Math.max(.75, finite(options.distance, closeThirdPersonLens(options.aspect).distance));
  const blocked = options.blocked || ((cx, cy, cz) => flightFloor(cx, cz) > cy - CLOSE_THIRD_PERSON.clearance);
  const obstructed = (cx, cy, cz) => [[0,0],[.2,0],[-.2,0],[0,.2],[0,-.2]].some(([dx,dz]) => blocked(cx+dx,cy,cz+dz));
  let safeDistance = distance, clipped = false;
  // Sweep the whole camera boom, not just its endpoint. A wall between the
  // avatar and the lens cannot be skipped; high flight clears actual roofs.
  const steps = Math.ceil(distance / Math.max(.08, Math.min(.32, finite(options.sweepStep, .16))));
  for (let i = 1; i <= steps; i++) {
    const d = distance * i / steps;
    if (obstructed(target.x + direction.x*d, Math.max(.35,target.y + direction.y*d), target.z + direction.z*d)) {
      safeDistance = Math.max(.16,d-distance/steps-.18); clipped = true; break;
    }
  }
  const position = { x: target.x + direction.x*safeDistance, y: Math.max(.35,target.y+direction.y*safeDistance), z: target.z+direction.z*safeDistance };
  if (safeDistance < .75) {
    // A tight corner uses a near-overhead fallback instead of burying the lens
    // inside the visible head. The avatar's own position/altitude never moves.
    position.x = x; position.z = z; position.y = y + 2.7;
  }
  return { position, target, clipped, distance: safeDistance };
}
