// Ship-local collision authority. These bounds mirror createOffshoreIsland's
// working deck, not the much wider underwater pontoons or elevated helipad.
export const OFFSHORE_DECK_SPEED = 4.2;
export const OFFSHORE_DECK_RADIUS = 0.4;
export const OFFSHORE_DECK_BOUNDS = Object.freeze({ minX: -12.3, maxX: 12.3, minZ: -14.3, maxZ: 14.3 });
export const OFFSHORE_DECK_HOLE = Object.freeze({ minX: -3.7, maxX: 3.7, minZ: -7.1, maxZ: 3.1 });
const box = (id, minX, maxX, minZ, maxZ, minY, maxY) => Object.freeze({ id, minX, maxX, minZ, maxZ, minY, maxY });
export const OFFSHORE_DECK_OBSTACLES = Object.freeze([
  box('forward-deckhouse', -6.5, 6.5, 7.6, 14.9, 8, 14.45),
  box('aft-deckhouse', 3.2, 11.6, -14.25, -6.75, 8, 13.85),
  box('aft-equipment', -10.45, -4.95, -13.6, -9.6, 8, 10.6),
  box('equipment-rack', -7.12, -4.08, -6.42, -2.88, 8, 11.42),
  box('port-crane-base', -10.75, -8.05, -5.95, -3.25, 8, 10.6),
  box('port-crane-mast', -10.55, -8.25, -5.9, -3.3, 10.6, 17.85),
  box('starboard-crane-base', 8.05, 10.75, 2.95, 5.65, 8, 10.6),
  box('starboard-crane-mast', 8.25, 10.55, 3, 5.6, 10.6, 17.85),
  box('derrick', -2.9, 2.9, -5.9, -0.1, 8, 31),
  box('exhausts', -5.08, -3.42, -12.38, -11.52, 10.3, 15.8),
  box('helipad', 1.5, 12.8, -15.55, -4.25, 14.2, 14.6),
  ...[-10.4, 10.4].flatMap(x => [-11.8, 11.8].map(z => box(
    `lifeboat-${x}-${z}`, x - 1.08, x + 1.08, z - 2.58, z + 2.58, 8, 10.2,
  ))),
]);
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const inside = (x, z, r, padding = 0) => x >= r.minX - padding && x <= r.maxX + padding && z >= r.minZ - padding && z <= r.maxZ + padding;
const deckObstacles = OFFSHORE_DECK_OBSTACLES.filter(r => r.minY < 10 && r.maxY > 8);

export function isOffshoreDeckWalkable(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !inside(x, z, OFFSHORE_DECK_BOUNDS)) return false;
  if (inside(x, z, OFFSHORE_DECK_HOLE, OFFSHORE_DECK_RADIUS)) return false;
  return !deckObstacles.some(r => inside(x, z, r, OFFSHORE_DECK_RADIUS));
}

/** Camera collision uses the real solid height, not a floor-only obstacle. */
export function offshoreDeckSolid(x, y, z) {
  return [x, y, z].every(Number.isFinite) && OFFSHORE_DECK_OBSTACLES.some(r => y >= r.minY && y <= r.maxY && inside(x, z, r));
}

/** Direction only: no destination, velocity, height or arbitrary pose injection. */
export function stepOffshoreDeck(local, input, dt) {
  const seat = clamp(Number.isInteger(local?.offshoreSeat) ? local.offshoreSeat : 0, 0, 7);
  const valid = isOffshoreDeckWalkable(local?.deckX, local?.deckZ);
  let x = valid ? local.deckX : -8, z = valid ? local.deckZ : 4 + seat;
  let yaw = finite(local?.deckYaw);
  let dx = clamp(finite(input?.x), -1, 1), dz = clamp(finite(input?.z), -1, 1);
  const length = Math.hypot(dx, dz), duration = clamp(finite(dt), 0, 0.1);
  if (!length || !duration) return { deckX: x, deckZ: z, deckYaw: yaw, moving: false };
  if (length > 1) { dx /= length; dz /= length; }
  yaw = Math.atan2(dx, dz);
  dx *= OFFSHORE_DECK_SPEED * duration; dz *= OFFSHORE_DECK_SPEED * duration;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.12)), startX = x, startZ = z;
  dx /= steps; dz /= steps;
  for (let i = 0; i < steps; i++) {
    if (isOffshoreDeckWalkable(x + dx, z + dz)) { x += dx; z += dz; }
    else {
      // Separate axes allow walking along a bulkhead rather than sticky corners.
      if (isOffshoreDeckWalkable(x + dx, z)) x += dx;
      if (isOffshoreDeckWalkable(x, z + dz)) z += dz;
    }
  }
  return { deckX: x, deckZ: z, deckYaw: yaw, moving: Math.hypot(x - startX, z - startZ) > 1e-8 };
}
