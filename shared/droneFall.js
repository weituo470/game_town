// Idealised show choreography, not a flight-control recipe for physical drones.
// The four adjacent sea-stage sectors lose thrust in sequence. Their different
// velocities are preserved until ONE common thrust-recovery beat; no group is
// teleported onto a shared low plane to fake a simultaneous rescue.
const FALL_START = 88000;
const BATCH_INTERVAL = 400;
const BRAKE_START = 91600;
const RECOVER_START = 92600;
const HEIGHT = 85.2;
const GRAVITY = 9.81;
const FIRST_FALL_SECONDS = (BRAKE_START - FALL_START) / 1000;
const BRAKE_SECONDS = (RECOVER_START - BRAKE_START) / 1000;

export const DRONE_FALL = Object.freeze({
  fallStart: FALL_START, brakeStart: BRAKE_START, recoverStart: RECOVER_START,
  batchCount: 4, batchInterval: BATCH_INTERVAL,
  batchStarts: Object.freeze(Array.from({ length: 4 }, (_, batch) => FALL_START + batch * BATCH_INTERVAL)),
  height: HEIGHT, gravity: GRAVITY, navigationEnergy: 0.16,
  minimumY: HEIGHT - 0.5 * GRAVITY * FIRST_FALL_SECONDS ** 2 - 0.5 * GRAVITY * FIRST_FALL_SECONDS * BRAKE_SECONDS,
  centerZ: 90, radius: 34,
});

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const u = clamp(value); return u * u * (3 - 2 * u); };
const mix = (a, b, u) => a + (b - a) * u;

/** Adjacent quadrants, not interleaved identity buckets: a visible wave of loss. */
export function droneFallBatch(x, z) {
  const angle = (Math.atan2(z - DRONE_FALL.centerZ, x) + Math.PI * 2) % (Math.PI * 2);
  return Math.min(DRONE_FALL.batchCount - 1, Math.floor(angle / (Math.PI / 2)));
}

/** Absolute-time ballistic sample. Position and velocity are continuous at every join. */
export function sampleDroneFall(timeMs, batch = 0) {
  const b = Math.max(0, Math.min(DRONE_FALL.batchCount - 1, Number.isFinite(batch) ? Math.floor(batch) : 0));
  const time = Number.isFinite(timeMs) ? timeMs : 0;
  const start = DRONE_FALL.batchStarts[b];
  const freeSeconds = (BRAKE_START - start) / 1000;
  const downwardSpeed = GRAVITY * freeSeconds;
  const brakeY = HEIGHT - 0.5 * GRAVITY * freeSeconds ** 2;
  // Constant net upward acceleration stops each sector on the same beat. The
  // four different arrest altitudes are the physical consequence of staggering.
  const deceleration = downwardSpeed / BRAKE_SECONDS;
  const stopY = brakeY - 0.5 * downwardSpeed * BRAKE_SECONDS;
  let y = HEIGHT, velocity = 0, acceleration = 0, phase = 'holding';
  if (time >= start && time < BRAKE_START) {
    const dt = (time - start) / 1000;
    y = HEIGHT - 0.5 * GRAVITY * dt ** 2;
    velocity = -GRAVITY * dt;
    acceleration = -GRAVITY;
    phase = 'falling';
  } else if (time >= BRAKE_START && time < RECOVER_START) {
    const dt = (time - BRAKE_START) / 1000;
    y = brakeY - downwardSpeed * dt + 0.5 * deceleration * dt ** 2;
    velocity = -downwardSpeed + deceleration * dt;
    acceleration = deceleration;
    phase = 'braking';
  } else if (time >= RECOVER_START) {
    y = stopY;
    phase = 'recovered';
  }
  // The main lamps go dark sector by sector, but readable navigation points
  // remain. All four sectors regain their main lamps at exactly BRAKE_START.
  let energy = time < 84000 ? 1 : mix(1, 1.18, smooth((time - 84000) / 3600));
  if (time >= start && time < BRAKE_START) energy = time >= start + 120 ? DRONE_FALL.navigationEnergy : mix(1.18, DRONE_FALL.navigationEnergy, smooth((time - start) / 120));
  else if (time >= BRAKE_START && time < RECOVER_START) energy = mix(DRONE_FALL.navigationEnergy, 1.16, smooth((time - BRAKE_START) / 180));
  else if (time >= RECOVER_START) energy = mix(1.16, 1, smooth((time - RECOVER_START) / 1200));
  return { batch: b, start, y, velocity, acceleration, stopY, phase, energy };
}
