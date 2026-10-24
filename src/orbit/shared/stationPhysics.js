import { RING_STATION, canonicalStationZ, stationDeltaZ, stationPoseFrame } from './ringStation.js';

// This is the isolated vacuum experiment, NOT the assisted avatar controller.
// Ground contact supplies centripetal acceleration; a released probe has no
// real force and follows a straight line in the non-rotating inertial frame.
const radius = RING_STATION.radius;
const gravity = 9.81;
const angularSpeed = Math.sqrt(gravity / radius);
export const STATION_PHYSICS = Object.freeze({
  radius, gravity, angularSpeed,
  rpm: angularSpeed * 60 / (2 * Math.PI),
  period: 2 * Math.PI / angularSpeed,
  epochMs: 0,
  center: Object.freeze([RING_STATION.centerX, radius, RING_STATION.centerZ]),
});

export const GRAVITY_EXPERIMENT = Object.freeze({
  x: 9, z: 17.5, heights: Object.freeze([8, 20]), probeRadius: .22,
  minX: 7.1, maxX: 10.9, minZ: 16.8, maxZ: 26.2,
});

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const vector = value => [finite(value?.[0]), finite(value?.[1]), finite(value?.[2])];
const rotate = (value, angle) => {
  const [x, y, z] = vector(value), c = Math.cos(angle), s = Math.sin(angle);
  return [x, c * y - s * z, s * y + c * z];
};
const add = (a, b) => a.map((value, index) => value + b[index]);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const scaled = (a, amount) => a.map(value => value * amount);
const spinVelocity = q => [0, -angularSpeed * q[2], angularSpeed * q[1]];

/** Absolute server-clock milliseconds -> positive +X angular phase, radians. */
export function stationPhaseAt(epochMs) {
  const periodMs = STATION_PHYSICS.period * 1000;
  const elapsed = finite(epochMs, STATION_PHYSICS.epochMs) - STATION_PHYSICS.epochMs;
  return ((elapsed % periodMs + periodMs) % periodMs) / periodMs * Math.PI * 2;
}

export function toStationDirection(direction, epochMs) { return rotate(direction, -stationPhaseAt(epochMs)); }
export function toInertialDirection(direction, epochMs) { return rotate(direction, stationPhaseAt(epochMs)); }
export function toStationPoint(point, epochMs) {
  return add(STATION_PHYSICS.center, toStationDirection(subtract(vector(point), STATION_PHYSICS.center), epochMs));
}
export function toInertialPoint(point, epochMs) {
  return add(STATION_PHYSICS.center, toInertialDirection(subtract(vector(point), STATION_PHYSICS.center), epochMs));
}

/** Required contact support, not a real force applied to the airborne probe. */
export function stationSupportGravity(height = 0) {
  return angularSpeed ** 2 * Math.max(0, radius - finite(height));
}

export function stationLogicalPoint(position) {
  const q = subtract(vector(position), STATION_PHYSICS.center);
  const r = Math.hypot(q[1], q[2]);
  const angle = r > 1e-12 ? Math.atan2(-q[2], -q[1]) : 0;
  return { x: q[0] + STATION_PHYSICS.center[0], y: radius - r, z: canonicalStationZ(RING_STATION.centerZ - radius * angle) };
}

/** First exit of a straight ray from the circular interior (sphere centre). */
export function firstRingWallContact(position, velocity, ballRadius = 0) {
  const q = subtract(vector(position), STATION_PHYSICS.center), v = vector(velocity);
  const wall = radius - clamp(finite(ballRadius), 0, radius - 1e-6);
  const a = v[1] ** 2 + v[2] ** 2;
  const b = 2 * (q[1] * v[1] + q[2] * v[2]);
  const c = q[1] ** 2 + q[2] ** 2 - wall ** 2;
  if (c >= -1e-9 && b >= 0) return 0;
  if (a <= 1e-20) return Infinity;
  const discriminant = Math.max(0, b * b - 4 * a * c);
  // Stable positive quadratic root for interior points, also handles an
  // inward launch from contact (zero root must not suppress the next impact).
  const root = Math.sqrt(discriminant);
  const time = b >= 0 ? -2 * c / (b + root) : (-b + root) / (2 * a);
  return Number.isFinite(time) && time >= 0 ? time : Infinity;
}

/**
 * Release velocity inherits the rotating carrier plus an optional physical
 * local velocity [axial, inward, +longitude-tangent], in metres per second.
 * No fake downward acceleration or height animation is involved.
 */
export function createInertialRelease(options = {}) {
  const ballRadius = clamp(finite(options.ballRadius), 0, 1);
  const height = clamp(finite(options.height, 8), ballRadius, RING_STATION.maxAltitude);
  const logical = { x: finite(options.x, GRAVITY_EXPERIMENT.x), y: height, z: canonicalStationZ(finite(options.z, GRAVITY_EXPERIMENT.z)) };
  const frame = stationPoseFrame(logical);
  const q = subtract(frame.position, STATION_PHYSICS.center);
  const relative = vector(options.relativeVelocity);
  const bodyVelocity = [
    relative[0],
    relative[1] * frame.normal[1] - relative[2] * frame.normal[2],
    relative[1] * frame.normal[2] + relative[2] * frame.normal[1],
  ];
  const velocityAtRelease = add(spinVelocity(q), bodyVelocity);
  const startedAt = finite(options.startedAt, STATION_PHYSICS.epochMs);
  const inertialPosition = toInertialPoint(frame.position, startedAt);
  const inertialVelocity = toInertialDirection(velocityAtRelease, startedAt);
  const landingTime = firstRingWallContact(inertialPosition, inertialVelocity, ballRadius);
  return { logical, position: frame.position, velocityAtRelease, inertialPosition, inertialVelocity, startedAt, height, ballRadius, landingTime };
}

/**
 * Exact inertial p=p0+v*t, observed from the rotating station. At first wall
 * contact the experiment catcher absorbs momentum and holds the probe to the
 * deck. Conservation assertions deliberately apply only before that contact.
 */
export function sampleInertialRelease(release, elapsed = 0) {
  const requestedElapsed = Math.max(0, finite(elapsed));
  const t = Math.min(requestedElapsed, release.landingTime);
  const q = subtract(release.position, STATION_PHYSICS.center);
  const translated = add(q, scaled(release.velocityAtRelease, t));
  // Relative phase is numerically stable even at Unix-epoch-sized timestamps.
  const bodyQ = rotate(translated, -angularSpeed * t);
  const position = add(STATION_PHYSICS.center, bodyQ);
  const impactOrFreePosition = add(release.inertialPosition, scaled(release.inertialVelocity, t));
  const landed = requestedElapsed >= release.landingTime;
  const inertialInBody = rotate(release.velocityAtRelease, -angularSpeed * t);
  const bodyVelocity = landed ? [0, 0, 0] : subtract(inertialInBody, spinVelocity(bodyQ));
  const logicalPosition = stationLogicalPoint(position);
  const r = Math.hypot(bodyQ[1], bodyQ[2]);
  const normal = r > 1e-12 ? [0, -bodyQ[1] / r, -bodyQ[2] / r] : [0, 1, 0];
  const now = release.startedAt + requestedElapsed * 1000;
  const inertialPosition = landed ? toInertialPoint(position, now) : impactOrFreePosition;
  const inertialVelocity = landed ? toInertialDirection(spinVelocity(bodyQ), now) : [...release.inertialVelocity];
  return {
    position, logicalPosition, normal, bodyVelocity,
    inertialPosition, inertialVelocity,
    impactPosition: landed ? impactOrFreePosition : null,
    elapsed: t, requestedElapsed, landed, landingTime: release.landingTime,
    drift: stationDeltaZ(release.logical.z, logicalPosition.z),
    height: Math.max(release.ballRadius, logicalPosition.y),
    speed: Math.hypot(...bodyVelocity),
    inertialSpeed: Math.hypot(...inertialVelocity),
    supportGravity: stationSupportGravity(logicalPosition.y),
    // This vector is expressed in station axes. Only the catcher's contact
    // supplies a real acceleration; the released probe remains force-free.
    realAcceleration: landed ? scaled(normal, angularSpeed ** 2 * r) : [0, 0, 0],
  };
}

/** UI and renderer share this exact finite-ball experiment configuration. */
export function sampleGravityExperiment(options = {}) {
  const release = createInertialRelease({
    ...options, ballRadius: finite(options.ballRadius, GRAVITY_EXPERIMENT.probeRadius),
  });
  return sampleInertialRelease(release, options.elapsed);
}

/** Ordered exact samples, including the first contact once (never through it). */
export function sampleGravityTrajectory(options = {}) {
  const release = createInertialRelease({
    ...options, ballRadius: finite(options.ballRadius, GRAVITY_EXPERIMENT.probeRadius),
  });
  const count = clamp(Math.round(finite(options.samples, 96)), 2, 1024);
  const duration = Math.min(release.landingTime, Math.max(0, finite(options.duration, release.landingTime)));
  if (!Number.isFinite(duration)) return [sampleInertialRelease(release, 0)];
  return Array.from({ length: count }, (_, index) => sampleInertialRelease(release, duration * index / (count - 1)));
}
