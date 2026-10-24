import { isWalkable, PLAYER_SPEED, SPAWN } from './world.js';
import { canonicalStationZ, stationDeltaZ } from './ringStation.js';

// A deliberately assisted, ground-bound bicycle model, not a rigid-body solver.
// All distances/speeds use the same unrolled metric as walking on the ring.
export const CAR = Object.freeze({
  width: 1.8, length: 3.3, wheelRadius: .30, wheelbase: 2.2, clearance: .10,
  topSpeed: PLAYER_SPEED * 10, reverseSpeed: PLAYER_SPEED * 2.5,
  acceleration: 12, brakeDeceleration: 30, coastDeceleration: 5,
  steeringRate: 2.6, maxSteeringAngle: .48, maxLateralAcceleration: 8,
  maxYawRate: 1.35, collisionStep: .12, enterDistance: 3.5, exitSpeed: .6,
});
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toward = (value, target, distance) => value < target ? Math.min(target, value + distance) : Math.max(target, value - distance);
const wrapYaw = value => Math.atan2(Math.sin(value), Math.cos(value));
const halfWidth = CAR.width / 2 + CAR.clearance, halfLength = CAR.length / 2 + CAR.clearance;

/** Positive input is the driver's right. A +Z-facing driver has right at -X,
 * so a right turn is a negative local-Y rotation for both wheels and physics. */
export function carSteeringAngle(steer) {
  return -clamp(finite(steer), -1, 1) * CAR.maxSteeringAngle;
}

// Check the entire footprint, not just the wheels or centre. Spacing is smaller
// than the narrowest existing trunk/solid, including the footprint's interior.
const footprint = [[0, 0], [-halfWidth, -halfLength], [halfWidth, -halfLength], [-halfWidth, halfLength], [halfWidth, halfLength]];
const across = Math.ceil(halfWidth * 2 / .35), along = Math.ceil(halfLength * 2 / .35);
for (let x = 0; x <= across; x++) for (let z = 0; z <= along; z++) {
  footprint.push([-halfWidth + x * halfWidth * 2 / across, -halfLength + z * halfLength * 2 / along]);
}

export function carCanOccupy(x, z, yaw = 0) {
  if (![x, z, yaw].every(Number.isFinite)) return false;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  return footprint.every(([side, forward]) => isWalkable(
    x + cos * side + sin * forward,
    canonicalStationZ(z - sin * side + cos * forward),
  ));
}

function clearGroundPath(fromX, fromZ, toX, toZ) {
  const dx = toX - fromX, dz = stationDeltaZ(fromZ, toZ);
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / CAR.collisionStep));
  for (let i = 0; i <= count; i++) {
    if (!isWalkable(fromX + dx * i / count, canonicalStationZ(fromZ + dz * i / count))) return false;
  }
  return true;
}

function parkingNear(position) {
  const x = finite(position?.x, SPAWN.x), z = canonicalStationZ(finite(position?.z, SPAWN.z));
  const yaw = finite(position?.yaw, SPAWN.yaw);
  // Start beside the driver, then try other sides and larger local radii.
  // A summon never moves the avatar or creates a car on an island/water gap.
  for (const radius of [2.5, 3.25, 4.25, 5.5, 7]) {
    for (let i = 0; i < 16; i++) {
      const angle = yaw + Math.PI / 2 + i * Math.PI / 8;
      const px = x + Math.sin(angle) * radius, pz = canonicalStationZ(z + Math.cos(angle) * radius);
      if (!clearGroundPath(x, z, px, pz)) continue;
      for (const heading of [yaw, 0, Math.PI / 2]) {
        if (carCanOccupy(px, pz, heading)) return { carX: px, carZ: pz, carYaw: wrapYaw(heading) };
      }
    }
  }
  return null;
}

const defaultParking = Object.freeze(parkingNear(SPAWN));

export function initialCarState(position = SPAWN) {
  return { driving: false, ...(parkingNear(position) || defaultParking), carSpeed: 0, carSteer: 0 };
}

// Explicit reads are essential for Colyseus Schema accessor-backed fields.
export function carStateFrom(state) {
  return {
    driving: state?.driving === true,
    carX: finite(state?.carX, defaultParking.carX),
    carZ: canonicalStationZ(finite(state?.carZ, defaultParking.carZ)),
    carYaw: wrapYaw(finite(state?.carYaw, defaultParking.carYaw)),
    carSpeed: clamp(finite(state?.carSpeed), -CAR.reverseSpeed, CAR.topSpeed),
    carSteer: clamp(finite(state?.carSteer), -1, 1),
  };
}

export function carDistance(state) {
  const car = carStateFrom(state);
  return Math.hypot(car.carX - finite(state?.x, SPAWN.x), stationDeltaZ(finite(state?.z, SPAWN.z), car.carZ));
}

function avatarState(state) {
  return {
    x: finite(state?.x, SPAWN.x), z: canonicalStationZ(finite(state?.z, SPAWN.z)),
    yaw: finite(state?.yaw, SPAWN.yaw), y: Math.max(0, finite(state?.y)), vy: finite(state?.vy),
    moving: state?.moving === true, jetpack: state?.jetpack === true,
    thrusting: state?.thrusting === true, hovering: state?.hovering === true,
    ...carStateFrom(state),
  };
}

function exitPosition(car) {
  for (const [side, forward] of [[1.55, 0], [-1.55, 0], [0, -2.1], [0, 2.1]]) {
    const x = car.carX + Math.cos(car.carYaw) * side + Math.sin(car.carYaw) * forward;
    const z = canonicalStationZ(car.carZ - Math.sin(car.carYaw) * side + Math.cos(car.carYaw) * forward);
    // A little foot clearance prevents a nominally valid exit inside a wall.
    if (clearGroundPath(car.carX, car.carZ, x, z)
      && [[0, 0], [.2, 0], [-.2, 0], [0, .2], [0, -.2]].every(([dx, dz]) => isWalkable(x + dx, canonicalStationZ(z + dz)))) return { x, z };
  }
  return null;
}

export function performCarAction(state, action) {
  const next = avatarState(state);
  const reply = result => ({ state: next, result });
  if (!['enter', 'exit', 'summon'].includes(action)) return reply('invalid');
  if (action === 'exit') {
    if (!next.driving) return reply('not-driving');
    if (Math.abs(next.carSpeed) > CAR.exitSpeed) return reply('moving');
    const landing = exitPosition(next);
    if (!landing) return reply('no-space');
    Object.assign(next, landing, { driving: false, carSpeed: 0, carSteer: 0, yaw: next.carYaw, y: 0, vy: 0, moving: false, jetpack: false, thrusting: false, hovering: false });
    return reply('exited');
  }
  if (next.driving) return reply('already-driving');
  if (next.y > .05 || Math.abs(next.vy) > .05 || next.jetpack || !isWalkable(next.x, next.z)) return reply('airborne');
  if (action === 'summon') {
    const parking = parkingNear(next);
    if (!parking) return reply('no-space');
    Object.assign(next, parking, { carSpeed: 0, carSteer: 0 });
    return reply('summoned');
  }
  const nearbyCar = carDistance(next) <= CAR.enterDistance
    && carCanOccupy(next.carX, next.carZ, next.carYaw)
    && clearGroundPath(next.x, next.z, next.carX, next.carZ);
  if (!nearbyCar) {
    // Recall the existing owned car, never create a second car or teleport the
    // avatar to its old location. Do not change anything until parking succeeds.
    const parking = parkingNear(next);
    if (!parking) return reply('no-space');
    Object.assign(next, parking);
  }
  Object.assign(next, { x: next.carX, z: next.carZ, yaw: next.carYaw, y: 0, vy: 0, driving: true, carSpeed: 0, carSteer: 0, moving: false, jetpack: false, thrusting: false, hovering: false });
  return reply('entered');
}

export function stepCar(state, input, seconds) {
  const car = carStateFrom(state);
  const dt = clamp(finite(seconds), 0, .1);
  const throttle = clamp(finite(input?.throttle), -1, 1), steer = clamp(finite(input?.steer), -1, 1);
  if (!car.driving) return { ...car, carSpeed: 0, carSteer: 0 };
  // Focus loss/stale transport is a safety stop, not unbounded coasting.
  if (input?.stop === true) { car.carSpeed = 0; car.carSteer = 0; }
  const startX = car.carX, startZ = car.carZ;
  const maxTravel = Math.min(CAR.topSpeed, Math.abs(car.carSpeed) + CAR.acceleration * dt) * dt;
  const turnSweep = Math.hypot(halfWidth, halfLength) * CAR.maxYawRate * dt;
  const steps = Math.max(1, Math.ceil((maxTravel + turnSweep) / CAR.collisionStep)), h = dt / steps;
  for (let step = 0; step < steps && input?.stop !== true; step++) {
    const beforeSpeed = car.carSpeed;
    car.carSteer = toward(car.carSteer, steer, CAR.steeringRate * h);
    if (input?.brake === true) car.carSpeed = toward(beforeSpeed, 0, CAR.brakeDeceleration * h);
    else if (Math.abs(throttle) < .001) car.carSpeed = toward(beforeSpeed, 0, CAR.coastDeceleration * h);
    else if (beforeSpeed * throttle < -.001) car.carSpeed = toward(beforeSpeed, 0, CAR.brakeDeceleration * Math.abs(throttle) * h);
    else {
      const target = throttle > 0 ? CAR.topSpeed * throttle : CAR.reverseSpeed * throttle;
      car.carSpeed = toward(beforeSpeed, target, CAR.acceleration * Math.abs(throttle) * h);
    }
    const speed = (beforeSpeed + car.carSpeed) / 2;
    const gripLimit = Math.min(CAR.maxYawRate, CAR.maxLateralAcceleration / Math.max(.1, Math.abs(speed)));
    const yawRate = clamp(speed / CAR.wheelbase * Math.tan(carSteeringAngle(car.carSteer)), -gripLimit, gripLimit);
    const heading = car.carYaw + yawRate * h / 2;
    const yaw = wrapYaw(car.carYaw + yawRate * h);
    const x = car.carX + Math.sin(heading) * speed * h;
    const z = canonicalStationZ(car.carZ + Math.cos(heading) * speed * h);
    if (Math.abs(speed) < 1e-9 && Math.abs(yawRate) < 1e-9) continue;
    if (!carCanOccupy(x, z, yaw)) { car.carSpeed = 0; break; }
    car.carX = x; car.carZ = z; car.carYaw = yaw;
  }
  return {
    ...car, x: car.carX, z: car.carZ, yaw: car.carYaw,
    y: 0, vy: 0, jetpack: false, thrusting: false, hovering: false,
    moving: Math.hypot(car.carX - startX, stationDeltaZ(startZ, car.carZ)) > .0001,
  };
}
