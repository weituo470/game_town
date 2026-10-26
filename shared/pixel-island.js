// Original voxel-island layout shared by the distant world and local sandbox.
// No mutable block edits live here: room authority always sees this base island.
// A column height is a solid LAYER COUNT, not the top voxel's zero-based index.
export const PIXEL_ISLAND = Object.freeze({
  id: 'pixel-island', name: '方块原野', x: 120, z: 210,
  width: 96, depth: 96, columns: 64, layers: 40, cell: 1.5,
  origin: Object.freeze({ x: 72, y: -7.28, z: 162 }),
  seed: 424242,
  arrival: Object.freeze({ x: 120.75, z: 238.75, yaw: Math.PI }),
});

const clamp = (value, a, b) => Math.max(a, Math.min(b, value));
const smooth = (a, b, value) => { const t = clamp((value - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const validColumn = (gx, gz) => Number.isInteger(gx) && Number.isInteger(gz)
  && gx >= 0 && gz >= 0 && gx < PIXEL_ISLAND.columns && gz < PIXEL_ISLAND.columns;

/** Deterministic terraced coast, meadow and northern hills; no textures/no RNG. */
export function pixelColumnHeight(gx, gz) {
  if (!validColumn(gx, gz)) return 0;
  // The southeast arrival meadow has room to walk, jump and begin building.
  if (Math.abs(gx - 32) <= 3 && Math.abs(gz - 51) <= 3) return 8;
  const nx = (gx - 31.5) / 30.5, nz = (gz - 31) / 30;
  const radius = Math.hypot(nx, nz);
  const shore = 1 + .026 * Math.sin(gx * .31) * Math.cos(gz * .23);
  if (radius >= shore) return 0;
  // Four layers end exactly at the existing world's -1.28m water surface.
  if (radius > shore - .055) return 4;
  if (radius > shore - .115) return 5;
  const interior = 1 - smooth(.36, .89, radius);
  const northPeak = 13.2 * Math.exp(-(((gx - 38) / 12) ** 2 + ((gz - 18) / 10) ** 2));
  const westRidge = 5.8 * Math.exp(-(((gx - 19) / 10) ** 2 + ((gz - 24) / 14) ** 2));
  const relief = Math.sin(gx * .23 + Math.cos(gz * .16)) * .7 + Math.cos(gz * .28 - gx * .11) * .5;
  return clamp(Math.round(6 + interior * (2.5 + northPeak + westRidge + relief)), 6, 22);
}

/** Block IDs are the sandbox's own original palette: grass=1/sand=4/snow=15. */
export function pixelSurfaceBlock(gx, gz) {
  const height = pixelColumnHeight(gx, gz);
  return height >= 19 ? 15 : height <= 7 ? 4 : 1;
}

function columnAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  return pixelColumnHeight(Math.floor((x - PIXEL_ISLAND.origin.x) / PIXEL_ISLAND.cell),
    Math.floor((z - PIXEL_ISLAND.origin.z) / PIXEL_ISLAND.cell));
}

/** Visible dry columns only: the enclosing rectangle is not invisible land. */
export function inPixelIsland(x, z) {
  return columnAt(x, z) >= 5;
}

/** Absolute world support height. Outside dry land the established floor is 0. */
export function pixelGroundHeight(x, z) {
  const height = columnAt(x, z);
  return height >= 5 ? PIXEL_ISLAND.origin.y + height * PIXEL_ISLAND.cell : 0;
}

/** Named static arrival only; user edits never become room-owned coordinates. */
export function pixelDestination(id) {
  return id === PIXEL_ISLAND.id ? { ...PIXEL_ISLAND.arrival,
    y: pixelGroundHeight(PIXEL_ISLAND.arrival.x, PIXEL_ISLAND.arrival.z) } : null;
}

/** Exterior walking cannot walk through a full-height voxel wall or into sea. */
export function pixelCanStep(x, z, nx, nz) {
  if (![x, z, nx, nz].every(Number.isFinite)) return false;
  if (!inPixelIsland(x, z) && !inPixelIsland(nx, nz)) return true;
  if (!inPixelIsland(nx, nz)) return false;
  return Math.abs(pixelGroundHeight(nx, nz) - pixelGroundHeight(x, z)) <= .6;
}
