import { OFFSHORE_ISLAND } from '../../../shared/offshore-island.js';

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Same XYZ Euler convention as the shared passenger pose and the ship model.
function shipVector(x, y, z, pose, reducedMotion = false) {
  const yaw = finite(pose?.yaw), roll = reducedMotion ? 0 : finite(pose?.roll), pitch = reducedMotion ? 0 : finite(pose?.pitch);
  const ax = x * Math.cos(roll) - y * Math.sin(roll), ay = x * Math.sin(roll) + y * Math.cos(roll);
  const bx = ax * Math.cos(yaw) + z * Math.sin(yaw), bz = -ax * Math.sin(yaw) + z * Math.cos(yaw);
  return [bx, ay * Math.cos(pitch) - bz * Math.sin(pitch), ay * Math.sin(pitch) + bz * Math.cos(pitch)];
}

/** Fits the complete 26 x 38 x 31 m ship, leaving a separate, usable HUD band. */
export function offshoreCameraShot(aspect = 16 / 9, sample = {}, seconds = 0, view = 'director', reducedMotion = false) {
  const validAspect = finite(aspect, 16 / 9);
  const ratio = Math.max(.25, Math.min(4, validAspect > 0 ? validAspect : 16 / 9));
  const origin = [finite(sample?.x, OFFSHORE_ISLAND.x), finite(sample?.y), finite(sample?.z, OFFSHORE_ISLAND.z)];
  const at = local => local.map((value, index) => value + origin[index]);
  if (view === 'deck') {
    return { position: at(shipVector(-8, OFFSHORE_ISLAND.deckY + 2.6, 11, sample, reducedMotion)),
      target: at(shipVector(-8.7, OFFSHORE_ISLAND.deckY + 1.5, 70, sample, reducedMotion)), fov: 58, near: .15, far: 900 };
  }
  const portrait = ratio < .8, fov = portrait ? 48 : 44, tangent = Math.tan(fov * Math.PI / 360);
  const time = Math.max(0, finite(seconds));
  const sweep = view === 'orbit' && !reducedMotion ? Math.sin(time * .055) * .78 : 0;
  const angle = .62 + sweep, elevation = .29;
  const direction = shipVector(Math.sin(angle) * Math.cos(elevation), Math.sin(elevation), Math.cos(angle) * Math.cos(elevation), { yaw: finite(sample?.yaw) });
  const right = shipVector(Math.cos(angle), 0, -Math.sin(angle), { yaw: finite(sample?.yaw) });
  const up = shipVector(-Math.sin(angle) * Math.sin(elevation), Math.cos(elevation), -Math.cos(angle) * Math.sin(elevation), { yaw: finite(sample?.yaw) });
  // Portrait controls occupy at most the bottom 44svh; the model ends at 52%.
  const limits = portrait ? { top: .70, bottom: -.04, center: .33 } : { top: .68, bottom: -.32, center: .18 };
  const center = at(shipVector(0, 14.75, 0, sample));
  let distance = 62;
  for (const x of [-OFFSHORE_ISLAND.width / 2, OFFSHORE_ISLAND.width / 2]) {
    for (const y of [-1.5, 31]) for (const z of [-OFFSHORE_ISLAND.length / 2, OFFSHORE_ISLAND.length / 2]) {
      const point = shipVector(x, y - 14.75, z, sample), depth = dot(point, direction), height = dot(point, up) / tangent;
      distance = Math.max(distance, depth + Math.abs(dot(point, right)) / (tangent * ratio * .86),
        (height + limits.top * depth) / (limits.top - limits.center),
        (-height - limits.bottom * depth) / (limits.center - limits.bottom));
    }
  }
  distance *= 1.045;
  const pan = -limits.center * distance * tangent;
  const target = center.map((value, index) => value + up[index] * pan);
  return { position: target.map((value, index) => value + direction[index] * distance), target, fov, near: .2, far: 1000 };
}
