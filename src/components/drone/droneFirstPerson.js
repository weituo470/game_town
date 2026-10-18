import { clampLookPitch, lookDirection } from '../town/firstPerson.js';
import { DRONE_DRAGON, DRONE_STUNT } from '../../../shared/droneShow.js';

const MOUNT_HEIGHT = 0.12;
const CENTER_Z = -8;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pitchAtHeight = height => -.12 - clamp((height - 10) / 90, 0, 1) * .2;
const FALL_PITCH = -.72;

// These are real, permanent even-numbered identities, present in both the
// 4096- and 2048-light fleets. A formation transition may cross the old town
// centre: its gimbal reference therefore follows the score, not that origin.
// Child-Goku artwork parts: 0 = spiky hair, 7 = the right-hand power pole.
// These exterior points are vetted over the entire score, including launch,
// dragon morph, four-batch freefall and return. The left outline's identity is
// divisible by 16 so its real trail exists at both supported quality tiers.
const SEAT_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'hair-tip', label: '刺猬发尖', identity: 1972, part: 0, maxX: -8, minY: 99, hero: [-16.33643, 106.22353, -.8] }),
  Object.freeze({ id: 'power-pole', label: '如意棒侧', identity: 3882, part: 7, minX: 24, minY: 85, hero: [27.39724, 90.49034, 4] }),
  Object.freeze({ id: 'left-outline', label: '左侧发梢', identity: 592, part: 0, maxX: -23, minY: 77, hero: [-26.08633, 82.34971, -.8] }),
  Object.freeze({ id: 'first-drop', label: '首批领航', identity: 3278, part: 7, batch: 0, minX: 24, minY: 85, hero: [29.69229, 94.86, 3.9] }),
]);

function fleetCount(fleet) {
  if (!Number.isInteger(fleet?.count) || fleet.count < 1) return 0;
  return Math.min(fleet.count, Math.floor((fleet.positions?.length || 0) / 3));
}

// Start/end at rest, with a constant-speed middle and a maximum derivative of
// 1.137 (rather than cubic smoothstep's 1.5). The selected seats' turn after
// thrust recovery stays below 23 degrees/s without turning during the fall.
function gimbalEase(progress) {
  const u = clamp(progress, 0, 1), ramp = .12;
  if (u < ramp) return u * u / (2 * ramp * (1 - ramp));
  if (u > 1 - ramp) return 1 - (1 - u) ** 2 / (2 * ramp * (1 - ramp));
  return (u - ramp / 2) / (1 - ramp);
}

function turnTowards(from, to, progress) {
  const shortestTurn = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + shortestTurn * gimbalEase(progress);
}

function formationHeading(buffer, offset, centerZ, fallback) {
  const x = buffer?.[offset], z = buffer?.[offset + 2];
  return Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x, z - centerZ) > .01
    ? Math.atan2(-x, z - centerZ) : fallback;
}

function dragonGimbal(fleet, offset, fallback) {
  const elapsed = fleet.state?.elapsed;
  if (!fleet.dragon || !Number.isFinite(elapsed) || elapsed < DRONE_DRAGON.start || elapsed >= DRONE_DRAGON.end) return null;
  // The selected aircraft may cross the old formation centre during this
  // morph. Follow its authored endpoints, not atan2 of that crossing position.
  const galaxy = formationHeading(fleet.galaxy, offset, CENTER_Z, fallback)
    + (DRONE_DRAGON.start / 1000 - 28) * .065;
  const dragon = formationHeading(fleet.dragon, offset, -5, galaxy);
  const hero = formationHeading(fleet.hero, offset, CENTER_Z, fallback);
  if (elapsed < DRONE_DRAGON.formed) return {
    heading: turnTowards(galaxy, dragon, (elapsed - DRONE_DRAGON.start) / (DRONE_DRAGON.formed - DRONE_DRAGON.start)),
    pitch: pitchAtHeight(fleet.positions[offset + 1]),
  };
  if (elapsed < DRONE_DRAGON.holdEnd) return { heading: dragon, pitch: pitchAtHeight(fleet.positions[offset + 1]) };
  return {
    heading: turnTowards(dragon, hero, (elapsed - DRONE_DRAGON.holdEnd) / (DRONE_DRAGON.end - DRONE_DRAGON.holdEnd)),
    pitch: pitchAtHeight(fleet.positions[offset + 1]),
  };
}

function stuntGimbal(fleet, offset, fallback) {
  const elapsed = fleet.state?.elapsed;
  if (!Number.isFinite(elapsed) || elapsed < DRONE_STUNT.gatherStart || elapsed >= DRONE_STUNT.reformEnd) return null;
  const hero = formationHeading(fleet.hero, offset, CENTER_Z, fallback);
  // Aim toward a fixed shoreline reference BEFORE any sector drops. Looking
  // into the co-moving eye erased the fall; deriving pitch from current height
  // also levelled the view while the water was rushing up. Freeze both axes
  // throughout all four freefalls and the simultaneous thrust-recovery beat.
  const shore = formationHeading(fleet.skyEye, offset, -30, hero);
  const phoenix = formationHeading(fleet.phoenix, offset, DRONE_STUNT.centerZ, shore);
  const heroPitch = pitchAtHeight(finite(fleet.hero?.[offset + 1], fleet.positions[offset + 1]));
  const phoenixPitch = pitchAtHeight(finite(fleet.phoenix?.[offset + 1], fleet.positions[offset + 1]));
  const blend = (from, to, progress) => from + (to - from) * gimbalEase(progress);
  if (elapsed < DRONE_STUNT.fallStart) {
    const progress = (elapsed - DRONE_STUNT.gatherStart) / (DRONE_STUNT.fallStart - DRONE_STUNT.gatherStart);
    return { heading: turnTowards(hero, shore, progress), pitch: blend(heroPitch, FALL_PITCH, progress) };
  }
  if (elapsed <= DRONE_STUNT.recoverStart) return { heading: shore, pitch: FALL_PITCH };
  if (elapsed < DRONE_STUNT.wingEnd) {
    const progress = (elapsed - DRONE_STUNT.recoverStart) / (DRONE_STUNT.wingEnd - DRONE_STUNT.recoverStart);
    return { heading: turnTowards(shore, phoenix, progress), pitch: blend(FALL_PITCH, phoenixPitch, progress) };
  }
  const progress = (elapsed - DRONE_STUNT.wingEnd) / (DRONE_STUNT.reformEnd - DRONE_STUNT.wingEnd);
  return { heading: turnTowards(phoenix, hero, progress), pitch: blend(phoenixPitch, heroPitch, progress) };
}

/** Select once when the renderer creates a fleet, not on every render frame. */
export function selectDroneSeats(fleet) {
  const count = fleetCount(fleet);
  if (!count || !fleet.hero || !fleet.parts || !fleet.identities) return [];
  const used = new Set();
  const seats = [];
  for (const definition of SEAT_DEFINITIONS) {
    let selected = -1;
    let nearest = Infinity;
    for (let index = 0; index < count; index++) {
      if (used.has(index) || fleet.parts[index] !== definition.part) continue;
      if (definition.batch !== undefined && fleet.fallBatches?.[index] !== definition.batch) continue;
      const offset = index * 3;
      const point = [fleet.hero[offset], fleet.hero[offset + 1], fleet.hero[offset + 2]];
      if (!point.every(Number.isFinite)) continue;
      // A changed artwork or a sparse quality tier must not silently label a
      // central / opposite-side emitter as the selected exterior seat.
      if (definition.minX !== undefined && point[0] < definition.minX) continue;
      if (definition.maxX !== undefined && point[0] > definition.maxX) continue;
      if (definition.minY !== undefined && point[1] < definition.minY) continue;
      if (fleet.identities[index] === definition.identity) { selected = index; break; }
      const distance = point.reduce((sum, value, axis) => sum + (value - definition.hero[axis]) ** 2, 0);
      if (distance < nearest) { nearest = distance; selected = index; }
    }
    if (selected < 0) continue;
    used.add(selected);
    seats.push({ id: definition.id, label: definition.label, index: selected, identity: fleet.identities[selected] });
  }
  return seats;
}

/**
 * Read the exact renderer-owned fleet sample. This helper owns neither a clock
 * nor a second choreography instance, and never writes to any fleet buffer.
 * `seatIndex` is the actual buffer index returned by selectDroneSeats.
 * Altitude is the aircraft's world Y; the camera is mounted 12 cm above it.
 * Missing fleet data returns null so the host can keep its previous camera.
 */
export function sampleDroneFirstPerson(fleet, seatIndex, options = {}) {
  const count = fleetCount(fleet);
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= count) return null;
  const offset = seatIndex * 3;
  const x = fleet.positions[offset], y = fleet.positions[offset + 1], z = fleet.positions[offset + 2];
  const identity = fleet.identities?.[seatIndex];
  if (![x, y, z, identity].every(Number.isFinite)) return null;

  // Position is always the renderer-owned aircraft. Only its gimbal heading
  // follows authored absolute-time references while the formation relocates.
  const hx = finite(fleet.hero?.[offset], x);
  const hz = finite(fleet.hero?.[offset + 2], z);
  const fallbackYaw = Math.hypot(hx, hz - CENTER_Z) > 0.01 ? Math.atan2(-hx, hz - CENTER_Z) : 0;
  const inwardHeading = Math.hypot(x, z - CENTER_Z) >= 8 ? Math.atan2(-x, z - CENTER_Z) : fallbackYaw;
  const gimbal = !options?.reducedMotion ? stuntGimbal(fleet, offset, fallbackYaw) ?? dragonGimbal(fleet, offset, fallbackYaw) : null;
  const heading = gimbal?.heading ?? inwardHeading;
  const userYaw = finite(options?.yaw) % (Math.PI * 2);
  const basePitch = gimbal?.pitch ?? pitchAtHeight(y);
  const direction = lookDirection(heading + userYaw, clampLookPitch(basePitch + finite(options?.pitch)));
  const position = [x, y + MOUNT_HEIGHT, z];
  const target = position.map((value, axis) => value + [direction.x, direction.y, direction.z][axis] * 30);
  const aspect = finite(options?.aspect, 1.6);
  return {
    position, target,
    fov: aspect > 0 && aspect < 0.8 ? 90 : 82,
    // The owned light is only 12 cm away and must stay behind the near plane,
    // including when the user looks directly down. Neighbour lights remain.
    near: 0.18,
    far: 600,
    altitude: y,
    identity,
  };
}
