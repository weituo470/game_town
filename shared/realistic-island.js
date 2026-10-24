// One original heightfield for scenery, local prediction and room authority.
// Units are metres in the existing continuous town world; no scene transition.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const finite = (x, z) => Number.isFinite(x) && Number.isFinite(z);
const gaussian = (x, z, cx, cz, sx, sz) => Math.exp(-(((x - cx) / sx) ** 2) - ((z - cz) / sz) ** 2);

export const REALISTIC_ISLAND = Object.freeze({
  id: 'realistic-island', name: '雾岬岛', x: 280, z: 120,
  width: 220, depth: 170, maxHeight: 42, seaFloor: -3, seaLevel: -1.28,
  color: '#c6b491',
  arrival: Object.freeze({ x: 214, z: 148, yaw: Math.PI / 2 }),
  summit: Object.freeze({ x: 310, z: 82 }),
  bay: Object.freeze({ x: 202, z: 151 }),
});

// This is an unpaved hiking route, not a disconnected raised deck. Renderers
// sample islandHeight at every segment and may add only a tiny surface offset.
export const REALISTIC_ISLAND_TRAIL = Object.freeze([
  [214, 148], [233, 146], [252, 139], [269, 127],
  [282, 111], [291, 96], [301, 86], [310, 82],
].map(([x, z]) => Object.freeze({ x, z })));
export const ISLAND_TRAIL = REALISTIC_ISLAND_TRAIL;
export const ISLAND_MAX_WALK_SLOPE = .78;

/** Elliptical distance: 1 is the maximum authored footprint, not a square. */
export function islandDistance(x, z) {
  if (!finite(x, z)) return Infinity;
  return Math.hypot((x - REALISTIC_ISLAND.x) / (REALISTIC_ISLAND.width / 2), (z - REALISTIC_ISLAND.z) / (REALISTIC_ISLAND.depth / 2));
}

/** Absolute ground Y, including a submerged -3m skirt outside the shore. */
export function islandHeight(x, z) {
  const r = islandDistance(x, z);
  if (r >= 1 || !Number.isFinite(r)) return REALISTIC_ISLAND.seaFloor;
  const qx = x - REALISTIC_ISLAND.x, qz = z - REALISTIC_ISLAND.z;
  const angle = Math.atan2(qz / 85, qx / 110);
  const edge = .945 + .025 * Math.sin(angle * 3 + .7) + .017 * Math.cos(angle * 7 - .3);
  const land = 1 - smooth(edge - .18, edge, r);
  const plateau = -3 + land * 6.4;
  const hills = 22 * gaussian(x, z, 310, 82, 40, 34)
    + 10 * gaussian(x, z, 276, 78, 38, 25)
    + 8 * gaussian(x, z, 275, 125, 45, 36);
  // Fine, smooth non-periodic-looking relief. Stable arithmetic is shared by
  // browser and server; neither side consults noise textures or random seeds.
  const relief = Math.sin(qx * .084 + Math.sin(qz * .057)) * 1.05
    + Math.sin(qz * .113 - qx * .038) * .55
    + Math.cos(qx * .21 + qz * .14) * .18;
  const bay = 4.8 * gaussian(x, z, 198, 153, 24, 19);
  const cliff = 13 * gaussian(x, z, 367, 96, 9, 21);
  const interior = 1 - smooth(.56, .91, r);
  return plateau + (hills + relief) * interior - bay * land + cliff * land;
}

/** Land is deliberately smaller than the underwater mesh footprint. */
export function inRealisticIsland(x, z) {
  return finite(x, z) && islandDistance(x, z) < 1 && islandHeight(x, z) >= .12;
}

export function islandSlope(x, z) {
  if (!finite(x, z) || islandDistance(x, z) >= 1) return Infinity;
  const d = .4;
  return Math.hypot((islandHeight(x + d, z) - islandHeight(x - d, z)) / (2 * d),
    (islandHeight(x, z + d) - islandHeight(x, z - d)) / (2 * d));
}

export function islandWalkable(x, z) {
  return inRealisticIsland(x, z) && islandSlope(x, z) <= ISLAND_MAX_WALK_SLOPE
    && [[.32, 0], [-.32, 0], [0, .32], [0, -.32]].every(([dx, dz]) => inRealisticIsland(x + dx, z + dz));
}

/** Reject a steep height delta even at a shallow-looking saddle boundary. */
export function islandCanStep(x, z, nx, nz) {
  if (!inRealisticIsland(x, z) && !inRealisticIsland(nx, nz)) return true;
  if (!islandWalkable(nx, nz)) return false;
  const distance = Math.hypot(nx - x, nz - z);
  return distance < 1e-9 || Math.abs(islandHeight(nx, nz) - islandHeight(x, z)) <= distance * (ISLAND_MAX_WALK_SLOPE + .04) + .002;
}

export function islandDestination(id) {
  if (id !== REALISTIC_ISLAND.id) return null;
  const arrival = REALISTIC_ISLAND.arrival;
  return { ...arrival, y: islandHeight(arrival.x, arrival.z) };
}
