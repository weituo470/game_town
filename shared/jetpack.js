import { isWalkable, movePlayer, WORLD_LOCATIONS, TREE_POSITIONS, FOUNTAIN, SPAWN } from './world.js';
import { EXPLORATION_BOUNDS, wonderSolid } from './wonders.js';
import { startJump, stepJump } from './jump.js';
import { parkFlightFloor } from './deepseek-park.js';

export const JETPACK = Object.freeze({ holdSeconds: 0.22, climbSpeed: 7, acceleration: 22, gravity: 12, fallSpeed: 8, travelSpeed: 8 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const valid = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function flightFloor(x, z) {
  const parkFloor = parkFlightFloor(x, z);
  if (parkFloor > 0) return parkFloor;
  if (isWalkable(x,z)) return 0;
  if (WORLD_LOCATIONS.some(place => Math.abs(x - place.x) < 3.55 && Math.abs(z - place.z) < 3.15)) return 9;
  if (Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < FOUNTAIN.radius + 0.25) return 9;
  if (TREE_POSITIONS.some(([tx, tz, scale]) => Math.hypot(x - tx, z - tz) < 0.65 * scale)) return 6;
  if (wonderSolid(x, z)) return Math.hypot(x, z + 61) < 5.2 ? 35 : 9;
  return 0;
}

export function safeLanding(x, z) {
  if (isWalkable(x, z)) return { x, z };
  // Used only when feet reach water/non-walkable ground, never during flight.
  for (let radius = 0.5; radius <= 100; radius += 0.5) {
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI / 16, nx = x + Math.cos(angle) * radius, nz = z + Math.sin(angle) * radius;
      if (isWalkable(nx, nz)) return { x: nx, z: nz };
    }
  }
  return { x: SPAWN.x, z: SPAWN.z };
}

export function stoppedVertical(state) {
  // Menus, lost focus and stale input cut the engine; they never freeze flight.
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
  const floor = flightFloor(state.x, state.z);
  const jump = startJump({ y: Math.max(0, valid(state.y) - floor), vy: state.vy });
  return jump ? { y: floor, vy: jump.vy } : null;
}

export function stepAvatar(state, input, seconds) {
  const dt = clamp(valid(seconds), 0, 0.1), thrust = input?.thrust === true, hover = input?.hover === true;
  const canHover = hover && valid(state.y) > flightFloor(state.x, state.z) + 0.001;
  if (!state.jetpack && !thrust && !canHover) return { ...movePlayer(state, input, dt), ...stepJump(state, dt), jetpack: false, thrusting: false, hovering: false };
  let x = valid(state.x, SPAWN.x), z = valid(state.z, SPAWN.z), yaw = valid(state.yaw);
  const vertical = stepFlightVertical(state, thrust, dt, flightFloor(x, z), hover);
  let dx = valid(input?.x), dz = valid(input?.z);
  const length = Math.hypot(dx, dz); if (length > 1) { dx /= length; dz /= length; }
  if (length > 0.001) yaw = Math.atan2(dx, dz);
  const startX = x, startZ = z, steps = Math.max(1, Math.ceil(JETPACK.travelSpeed * dt / 0.12));
  const distance = JETPACK.travelSpeed * dt / steps;
  for (let i = 0; i < steps; i++) {
    const nx = clamp(x + dx * distance, EXPLORATION_BOUNDS.minX, EXPLORATION_BOUNDS.maxX);
    const nz = clamp(z + dz * distance, EXPLORATION_BOUNDS.minZ, EXPLORATION_BOUNDS.maxZ);
    if (flightFloor(nx, z) <= vertical.y + 0.01) x = nx;
    if (flightFloor(x, nz) <= vertical.y + 0.01) z = nz;
  }
  const floor = flightFloor(x, z);
  if (vertical.y < floor) { vertical.y = floor; vertical.vy = 0; }
  if (vertical.y <= floor + 0.001) vertical.hovering = false;
  let rescued = false;
  if (vertical.y <= 0.001 && !isWalkable(x, z)) { ({ x, z } = safeLanding(x, z)); rescued = true; }
  return { x, z, yaw, ...vertical, moving: Math.hypot(x - startX, z - startZ) > 0.0001 && !rescued, rescued };
}
