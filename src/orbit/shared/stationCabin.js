import { RING_STATION } from './ringStation.js';

// Shared geometric contract, not a gas/stress simulation. Camera constraints
// and the visible pressure boundary must agree without importing Three models.
export const STATION_CABIN = Object.freeze({
  roofHeight: 72,
  roofRadius: RING_STATION.radius - 72,
  outerRadius: 159.4,
  minX: RING_STATION.minX,
  maxX: RING_STATION.maxX,
  cameraClearance: .35,
});
export const ENCLOSED_ROCKET_ASCENT_SCALE = .16;
