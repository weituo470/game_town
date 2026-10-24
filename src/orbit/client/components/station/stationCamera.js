import { sampleRingPath, stationPoseFrame } from '../../../shared/ringStation.js';
import { STATION_PHYSICS, GRAVITY_EXPERIMENT, stationPhaseAt, toStationPoint, toStationDirection } from '../../../shared/stationPhysics.js';

export function stationHeroShot(aspect = 16 / 9) {
  const portrait = aspect < .85;
  // Look out from the original plaza: its own streets and coast rise into the
  // horizon. Both camera and target use the exact same world surface as feet.
  const at = stationPoseFrame({ x: portrait ? 5 : 8, y: portrait ? 16 : 11, z: portrait ? 34 : 25 });
  const ahead = stationPoseFrame({ x: portrait ? -8 : -12, y: portrait ? 4 : 7, z: portrait ? -35 : -95 });
  return { position: at.position, target: ahead.position, up: at.normal, fov: portrait ? 92 : 76, far: 2400 };
}
export function stationTourShot(progress, aspect = 16 / 9) {
  const at = sampleRingPath(progress, -13, 12);
  const ahead = sampleRingPath(progress + .028, -10, 10);
  return { position: at.position, target: ahead.position, up: at.normal, fov: aspect < .85 ? 77 : 68, far: 2400 };
}

/** The scene stays in its co-rotating coordinates. Transforming an inertially
 * fixed lens into this frame shows real relative rotation without rebaking
 * scenery or changing the collision-tested ground cameras. */
export function stationExteriorShot(physicsTimeMs = 0, aspect = 16 / 9) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const fov = 50;
  const bound = 225; // Entire pressure envelope, including both axial caps.
  const halfAngle = Math.atan(Math.tan(fov * Math.PI / 360) * Math.min(1, safeAspect));
  const distance = bound / Math.sin(halfAngle) * 1.14;
  const direction = [.68, .30, .67], length = Math.hypot(...direction);
  const center = STATION_PHYSICS.center;
  const position = center.map((value, i) => value + direction[i] / length * distance);
  return {
    position: toStationPoint(position, physicsTimeMs),
    target: toStationPoint(center, physicsTimeMs),
    up: toStationDirection([0, 1, 0], physicsTimeMs),
    fov, far: Math.max(2400, distance + bound * 3),
    phase: stationPhaseAt(physicsTimeMs), referenceFrame: 'inertial',
  };
}

/** Fixed co-rotating laboratory view. Playback never drags the viewer after
 * the falling ball; both drop heights and the landing arc remain in frame. */
export function stationGravityShot(aspect = 16 / 9) {
  const { x, z } = GRAVITY_EXPERIMENT;
  const portrait = aspect < .85;
  const at = stationPoseFrame({ x: x - (portrait ? 30 : 27), y: 20, z: z + (portrait ? 32 : 30) });
  const target = stationPoseFrame({ x, y: 10.5, z: z + 4 });
  return {
    position: at.position, target: target.position, up: target.normal,
    fov: portrait ? 58 : 50, far: 2400, referenceFrame: 'co-rotating',
  };
}

export function advanceStationTour(state, delta, { active = true, reducedMotion = false } = {}) {
  if (!state) return 0;
  const progress = Number.isFinite(state.progress) ? state.progress : 0;
  const step = active && state.playing && !reducedMotion ? Math.min(.1, Math.max(0, Number.isFinite(delta) ? delta : 0)) * Math.max(0, Math.min(.1, Number.isFinite(state.speed) ? state.speed : .025)) : 0;
  state.progress = ((progress + step) % 1 + 1) % 1;
  if (reducedMotion) state.playing = false;
  return state.progress;
}
