import { canonicalStationZ, stationPoseFrame } from '../../../shared/ringStation.js';
import { STATION_CABIN } from '../../../shared/stationCabin.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Shorten the already obstacle-tested boom, never extend it into a building.
 * Logical X/Y bounds describe the two caps and the inner ceiling everywhere
 * on the cylinder, including its periodic seam. Player poses are untouched. */
export function confineStationCamera(shot) {
  const clearance = STATION_CABIN.cameraClearance;
  const minX = STATION_CABIN.minX + clearance, maxX = STATION_CABIN.maxX - clearance;
  const maxY = STATION_CABIN.roofHeight - clearance;
  const target = { x: clamp(shot.target.x, minX, maxX), y: clamp(shot.target.y, clearance, maxY), z: shot.target.z };
  const delta = { x: shot.position.x - target.x, y: shot.position.y - target.y, z: shot.position.z - target.z };
  let fraction = 1;
  for (const [axis, low, high] of [['x', minX, maxX], ['y', clearance, maxY]]) {
    if (shot.position[axis] > high && delta[axis] > 0) fraction = Math.min(fraction, (high - target[axis]) / delta[axis]);
    if (shot.position[axis] < low && delta[axis] < 0) fraction = Math.min(fraction, (low - target[axis]) / delta[axis]);
  }
  const targetChanged = target.x !== shot.target.x || target.y !== shot.target.y;
  if (fraction === 1 && !targetChanged) return shot;
  const position = { x: target.x + delta.x * fraction, y: target.y + delta.y * fraction, z: target.z + delta.z * fraction };
  // At an axial wall an outward-facing long follow boom can be shorter than
  // the avatar's readable framing. Its own valid footprint supplies a safe
  // overhead fallback; never raise that lens through the new cabin ceiling.
  if (shot.distance >= 8 && Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z) < 4 && maxY - target.y >= 4) {
    position.x = target.x; position.z = target.z; position.y = Math.min(maxY, target.y + 8.5);
    const horizontal = Math.hypot(delta.x, delta.z);
    if (horizontal > .0001) {
      target.x = clamp(target.x - delta.x / horizontal * .015, minX, maxX);
      target.z -= delta.z / horizontal * .015;
    } else target.z -= .015;
  }
  return { ...shot, position, target, clipped: true, cabinClipped: true,
    distance: Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z) };
}

/** The collision-tested boom lives in surface metres, just like movement.
 * Only its final render positions are bent; never feed these back to physics. */
export function stationWalkCamera(shot, pose) {
  const confined = confineStationCamera(shot);
  const project = point => {
    const [x, y, z] = stationPoseFrame({ ...point, z: canonicalStationZ(point.z) }).position;
    return { x, y, z };
  };
  return {
    ...confined,
    position: project(confined.position),
    target: project(confined.target),
    up: stationPoseFrame(pose).normal,
  };
}
