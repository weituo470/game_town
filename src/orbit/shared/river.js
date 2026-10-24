// The western river lies beyond the original island, not on a building plot.
export const RIVER = Object.freeze({ x: -51.5, z: -17, width: 6, depth: 42, waterY: -0.28 });
export const RIVER_PIER = Object.freeze({ x: -45.8, z: -4, width: 12.4, depth: 2.6 });
export const FISHING_SPOT = Object.freeze({ x: -50.5, z: -4, y: 0, yaw: -Math.PI / 2 });
export function onRiverPier(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) && Math.abs(x - RIVER_PIER.x) <= RIVER_PIER.width / 2 - 0.22 && Math.abs(z - RIVER_PIER.z) <= RIVER_PIER.depth / 2 - 0.22;
}
