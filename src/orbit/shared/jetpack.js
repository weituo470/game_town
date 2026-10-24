import { isWalkable, movePlayer, WORLD_LOCATIONS, TREE_POSITIONS, FOUNTAIN, SPAWN } from './world.js';
import { wonderSolid } from './wonders.js';
import { startJump, stepJump } from './jump.js';
import { parkFlightFloor } from './deepseek-park.js';
import { RING_STATION, canonicalStationZ, stationDeltaZ, isStationDomain } from './ringStation.js';
import { ringCityFlightFloor } from './ringCity.js';
import { carStateFrom, stepCar } from './car.js';
import { farmFlightFloor, farmFlightCeiling, farmVolumeBlocks } from './farmLayout.js';

export const JETPACK = Object.freeze({ holdSeconds: 0.22, climbSpeed: 7, acceleration: 22, gravity: 12, fallSpeed: 8, travelSpeed: 8 });
export const AVATAR_BODY_HEIGHT = 2.2;
// Match farmSolid's ground clearance exactly. A larger airborne footprint
// would turn a valid wall-adjacent walking pose into a rooftop on ignition.
export const AVATAR_COLLISION_RADIUS = .35;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const valid = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function flightFloor(x, z, y = 0) {
  // The farm has a walk-in interior: its roof is a floor only for a body
  // already above it. Treating it as a single heightfield teleports visitors.
  const farmFloor = farmFlightFloor(x, z, AVATAR_COLLISION_RADIUS, y);
  if (farmFloor > 0) return farmFloor;
  const cityFloor = ringCityFlightFloor(x, z);
  if (cityFloor > 0) return cityFloor;
  const parkFloor = parkFlightFloor(x, z);
  if (parkFloor > 0) return parkFloor;
  if (isWalkable(x,z)) return 0;
  if (WORLD_LOCATIONS.some(place => Math.abs(x - place.x) < 3.55 && Math.abs(z - place.z) < 3.15)) return 9;
  if (Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < FOUNTAIN.radius + 0.25) return 9;
  if (TREE_POSITIONS.some(([tx, tz, scale]) => Math.hypot(x - tx, z - tz) < 0.65 * scale)) return 6;
  if (wonderSolid(x, z)) return Math.hypot(x, z + 61) < 5.2 ? 35 : 9;
  return 0;
}

/** Feet-height limit; the full head/body remains below a solid underside. */
export function flightCeiling(x, z, y = 0) {
  return Math.min(RING_STATION.maxAltitude,
    farmFlightCeiling(x, z, y, AVATAR_COLLISION_RADIUS) - AVATAR_BODY_HEIGHT);
}

export function flightPositionAllowed(x, z, y) {
  return isStationDomain(x, z) && flightFloor(x, z, y) <= y + .01
    && !farmVolumeBlocks(x, z, y, AVATAR_COLLISION_RADIUS, AVATAR_BODY_HEIGHT - 1e-8);
}

export function safeLanding(x, z) {
  x = valid(x, SPAWN.x); z = canonicalStationZ(valid(z, SPAWN.z));
  if (isWalkable(x, z)) return { x, z };
  // Used only when feet reach water/non-walkable ground, never during flight.
  for (let radius = 0.5; radius <= 100; radius += 0.5) {
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI / 16, nx = x + Math.cos(angle) * radius, nz = canonicalStationZ(z + Math.sin(angle) * radius);
      if (isWalkable(nx, nz)) return { x: nx, z: nz };
    }
  }
  return { x: SPAWN.x, z: SPAWN.z };
}

export function stoppedVertical(state) {
  // Menus, lost focus and stale input cut the engine; they never freeze flight.
  if (state?.driving) return { carSpeed: 0, carSteer: 0, y: 0, vy: 0, jetpack: false, thrusting: false, hovering: false, moving: false };
  return state?.jetpack ? { jetpack: true, thrusting: false, hovering: false, vy: Math.min(0, valid(state.vy)), moving: false } : { y: 0, vy: 0, jetpack: false, thrusting: false, hovering: false, moving: false };
}

export function stepFlightVertical(state, thrust, seconds, floor = 0, hover = false) {
  floor = Math.max(0, valid(floor));
  const dt = clamp(valid(seconds), 0, 0.1), y = Math.max(floor, valid(state?.y));
  thrust = thrust === true;
  // Hover is an actively refreshed intent, never a latched physics state. It
  // cannot launch from a surface; thrust takes priority if both are requested.
  if (hover === true && !thrust && y > floor + 0.001) return { y, vy: 0, jetpack: true, thrusting: false, hovering: true };
  let vy = clamp(valid(state?.vy), -JETPACK.fallSpeed, JETPACK.climbSpeed);
  if (!thrust && state?.thrusting) vy = Math.min(0, vy); // release means immediate descent, not upward coasting
  const acceleration = thrust ? JETPACK.acceleration : -JETPACK.gravity;
  const nextVy = clamp(vy + acceleration * dt, -JETPACK.fallSpeed, JETPACK.climbSpeed);
  // No gameplay altitude cap. Keep invalid values out of snapshots/JSON even
  // if a damaged local state reaches this shared simulation boundary.
  const nextY = Math.max(floor, valid(y + (vy + nextVy) * dt / 2, y));
  vy = nextY <= floor ? 0 : nextVy;
  return { y: nextY, vy, jetpack: thrust || nextY > 0.001, thrusting: thrust, hovering: false };
}

export function startAvatarJump(state) {
  if (state?.driving) return null;
  const floor = flightFloor(state.x, state.z, state.y);
  const jump = startJump({ y: Math.max(0, valid(state.y) - floor), vy: state.vy });
  return jump ? { y: floor, vy: jump.vy } : null;
}

export function stepAvatar(state, input, seconds) {
  const car = carStateFrom(state);
  if (car.driving) return stepCar(state, input, seconds);
  // Protocol 9 has a finite interior everywhere, including the original town.
  // Invalid/obsolete heights are sanitized before prediction or server ticks.
  // Colyseus schema fields are accessors, not necessarily enumerable: do not
  // spread the schema or every authoritative tick would reset X/Z to spawn.
  state = { x: state?.x, z: state?.z, yaw: state?.yaw, vy: state?.vy,
    jetpack: state?.jetpack, thrusting: state?.thrusting, hovering: state?.hovering,
    y: clamp(valid(state?.y), 0, RING_STATION.maxAltitude) };
  const dt = clamp(valid(seconds), 0, 0.1), thrust = input?.thrust === true, hover = input?.hover === true;
  const canHover = hover && valid(state.y) > flightFloor(state.x, state.z, state.y) + 0.001;
  if (!state.jetpack && !thrust && !canHover) {
    const jump = stepJump(state, dt);
    const ceiling = flightCeiling(state.x, state.z, state.y);
    if (jump.y > ceiling) { jump.y = ceiling; jump.vy = Math.min(0, jump.vy); }
    return { ...movePlayer(state, input, dt), ...jump, jetpack: false, thrusting: false, hovering: false, ...car };
  }
  let x = valid(state.x, SPAWN.x), z = canonicalStationZ(valid(state.z, SPAWN.z)), yaw = valid(state.yaw);
  const vertical = stepFlightVertical(state, thrust, dt, flightFloor(x, z, state.y), hover);
  // Radius-relative clearance keeps the map away from its radial singularity.
  // 60 m leaves enough headroom above the original 35 m rocket collision roof.
  const ceiling = flightCeiling(x, z, state.y);
  if (vertical.y >= ceiling) {
    vertical.y = ceiling;
    vertical.vy = Math.min(0, vertical.vy);
    vertical.thrusting = false;
  }
  let dx = valid(input?.x), dz = valid(input?.z);
  const length = Math.hypot(dx, dz); if (length > 1) { dx /= length; dz /= length; }
  if (length > 0.001) yaw = Math.atan2(dx, dz);
  const startX = x, startZ = z, steps = Math.max(1, Math.ceil(JETPACK.travelSpeed * dt / 0.12));
  const distance = JETPACK.travelSpeed * dt / steps;
  for (let i = 0; i < steps; i++) {
    const nx = clamp(x + dx * distance, RING_STATION.flightMinX, RING_STATION.flightMaxX);
    const nz = canonicalStationZ(z + dz * distance);
    if (flightPositionAllowed(nx, z, vertical.y)) x = nx;
    if (flightPositionAllowed(x, nz, vertical.y)) z = nz;
  }
  const floor = flightFloor(x, z, vertical.y);
  if (vertical.y < floor) { vertical.y = floor; vertical.vy = 0; }
  if (vertical.y <= floor + 0.001) vertical.hovering = false;
  let rescued = false;
  if (vertical.y <= 0.001 && !isWalkable(x, z)) { ({ x, z } = safeLanding(x, z)); rescued = true; }
  return { x, z, yaw, ...vertical, moving: Math.hypot(x - startX, stationDeltaZ(startZ, z)) > 0.0001 && !rescued, rescued, ...car };
}
