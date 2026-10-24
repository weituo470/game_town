// One authored layout is consumed by Blender, the browser and room authority.
// All X/Z values are absolute world metres. Building height is the maximum
// solid roof Y; decorative equipment must fit below that authored envelope.
import layout from './metro-layout.json' with { type: 'json' };

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze); Object.freeze(value);
  }
  return value;
}
export const METRO_LAYOUT = deepFreeze(layout);
export const METRO_ISLAND = METRO_LAYOUT.island;
export const METRO_BUILDINGS = METRO_LAYOUT.buildings;
export const METRO_ROADS = METRO_LAYOUT.roads;
export const METRO_PARKS = METRO_LAYOUT.parks;
export const METRO_PROMENADE = METRO_LAYOUT.promenade;
export const METRO_BODY_MARGIN = .34;
const finite = (x, z) => Number.isFinite(x) && Number.isFinite(z);

/** Rounded sea wall, not a square of invisible land around the real mesh. */
export function inMetroIsland(x, z) {
  if (!finite(x, z)) return false;
  const island = METRO_ISLAND, r = island.cornerRadius;
  const qx = Math.abs(x - island.x) - island.width / 2 + r;
  const qz = Math.abs(z - island.z) - island.depth / 2 + r;
  const edge = Math.hypot(Math.max(0, qx), Math.max(0, qz)) + Math.min(Math.max(qx, qz), 0) - r;
  return edge <= -.3;
}
export const inMetroGround = inMetroIsland;

const inside = (x, z, building) => Math.abs(x - building.x) < building.width / 2 + METRO_BODY_MARGIN
  && Math.abs(z - building.z) < building.depth / 2 + METRO_BODY_MARGIN;

/** Shared conservative full-height wall silhouettes. Streets/park stay open. */
export function metroSolid(x, z) {
  return finite(x, z) && inMetroIsland(x, z) && METRO_BUILDINGS.some(building => inside(x, z, building));
}

/** A jetpack cannot cross a facade below its roof, but may land on that roof. */
export function metroFlightFloor(x, z) {
  if (!finite(x, z) || !inMetroIsland(x, z)) return 0;
  let top = METRO_ISLAND.groundY;
  for (const building of METRO_BUILDINGS) if (inside(x, z, building)) top = Math.max(top, building.height + .12);
  return top;
}

/** Named destination only; callers cannot use a user-supplied coordinate. */
export function metroDestination(id) {
  return id === METRO_ISLAND.id ? { ...METRO_ISLAND.arrival, y: METRO_ISLAND.groundY } : null;
}
