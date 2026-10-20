import { isOffshoreDeckWalkable, offshoreDeckSolid, stepOffshoreDeck } from '../../../shared/offshore-deck.js';
import { OFFSHORE_ISLAND, offshoreLocalToWorld, sampleOffshorePassenger } from '../../../shared/offshore-island.js';
import { closeThirdPersonCamera } from './firstPerson.js';
import { followOrbitCamera } from './camera.js';

/** Interpolate only through safe deck space; never lerp through the moon pool. */
export function blendOffshoreDeck(from, to, amount) {
  if (!isOffshoreDeckWalkable(to?.deckX, to?.deckZ) && isOffshoreDeckWalkable(from?.deckX, from?.deckZ)) return { deckX: from.deckX, deckZ: from.deckZ, deckYaw: from.deckYaw, moving: false };
  const target = stepOffshoreDeck(to, { x: 0, z: 0 }, 0);
  if (!isOffshoreDeckWalkable(from?.deckX, from?.deckZ)) return target;
  const factor = Math.max(0, Math.min(1, amount));
  const dx = (target.deckX - from.deckX) * factor, dz = (target.deckZ - from.deckZ) * factor;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .1));
  for (let i = 1; i <= steps; i++) {
    if (!isOffshoreDeckWalkable(from.deckX + dx * i / steps, from.deckZ + dz * i / steps)) return target;
  }
  return { deckX: from.deckX + dx, deckZ: from.deckZ + dz,
    deckYaw: from.deckYaw + Math.atan2(Math.sin(target.deckYaw - from.deckYaw), Math.cos(target.deckYaw - from.deckYaw)) * factor,
    moving: to?.moving === true };
}

export function offshoreWalkingCamera(pose, ship, look, firstPerson = false, aspect = 16 / 9) {
  // Sweep against the moving ship in its own coordinates, then transform both
  // camera and target by the exact same XYZ tilt as the visible deck.
  const local = { x: pose.deckX, y: OFFSHORE_ISLAND.deckY, z: pose.deckZ };
  const shot = (firstPerson ? closeThirdPersonCamera : followOrbitCamera)(local, look.yaw, look.pitch, {
    aspect, blocked: (x, y, z) => y < OFFSHORE_ISLAND.deckY + .22 || offshoreDeckSolid(x, y, z),
  });
  return { ...shot, position: offshoreLocalToWorld(ship, shot.position), target: offshoreLocalToWorld(ship, shot.target) };
}

export function remoteOffshorePose(current, next, voyage, dt, reducedMotion, fresh = true) {
  const authoritative = sampleOffshorePassenger(voyage.plan, voyage.now, next.offshoreSeat, next);
  const distance = Math.hypot(current.deckX - authoritative.deckX, current.deckZ - authoritative.deckZ);
  const alpha = !current.aboard || !Number.isFinite(distance) || distance > 3 || reducedMotion ? 1 : 1 - Math.exp(-Math.min(.1, Math.max(0, dt)) * 16);
  const local = blendOffshoreDeck(current, authoritative, alpha);
  local.moving = next.connected !== false && fresh && next.moving === true && distance > .015;
  return sampleOffshorePassenger(voyage.plan, voyage.now, next.offshoreSeat, local);
}
