// Original local-only voxel sandbox. No vendor game code, textures or network
// authority is imported here; the distant island keeps its immutable base map.
import { PIXEL_ISLAND as ISLAND, pixelColumnHeight, pixelSurfaceBlock } from './pixel-island.js';

const freeze = value => Object.freeze(value);
export const BLOCKS = freeze([
  { id: 0, name: '空气', color: '#c5e6f1', hardness: 0, solid: false, placeable: false },
  { id: 1, name: '草方块', color: '#7eaf4a', hardness: .35, solid: true, placeable: true },
  { id: 2, name: '泥土', color: '#916c47', hardness: .3, solid: true, placeable: true },
  { id: 3, name: '岩石', color: '#949a9e', hardness: .8, solid: true, placeable: true },
  { id: 4, name: '海沙', color: '#e6cc91', hardness: .3, solid: true, placeable: true },
  { id: 5, name: '原木', color: '#806044', hardness: .65, solid: true, placeable: true },
  { id: 6, name: '树叶', color: '#527f37', hardness: .2, solid: true, placeable: true },
  { id: 7, name: '木板', color: '#bb9561', hardness: .4, solid: true, placeable: true },
  { id: 8, name: '砌石', color: '#858c96', hardness: .7, solid: true, placeable: true },
  { id: 9, name: '水晶玻璃', color: '#95d7df', hardness: .4, solid: true, placeable: true },
  { id: 10, name: '红砖', color: '#b96a50', hardness: .7, solid: true, placeable: true },
  { id: 11, name: '光晶', color: '#f4c975', hardness: .7, solid: true, placeable: true },
  { id: 12, name: '煤矿', color: '#59616c', hardness: 1.0, solid: true, placeable: true },
  { id: 13, name: '铜矿', color: '#b68869', hardness: 1.0, solid: true, placeable: true },
  { id: 14, name: '基岩', color: '#444c59', hardness: Infinity, solid: true, placeable: false },
  { id: 15, name: '雪方块', color: '#edf2ec', hardness: .3, solid: true, placeable: true },
].map(freeze));
export const BLOCK_BY_ID = freeze(Object.fromEntries(BLOCKS.map(block => [block.id, block])));
export const HOTBAR = freeze([1, 2, 3, 5, 7, 8, 9, 10, 11]);
export const RECIPES = freeze([
  { id: 'planks', name: '原木 → 木板', inputs: freeze({ 5: 1 }), output: freeze({ id: 7, count: 4 }) },
  { id: 'masonry', name: '岩石 → 砌石', inputs: freeze({ 3: 2 }), output: freeze({ id: 8, count: 2 }) },
  { id: 'bricks', name: '泥土＋岩石 → 红砖', inputs: freeze({ 2: 2, 3: 1 }), output: freeze({ id: 10, count: 4 }) },
  { id: 'glass', name: '海沙＋煤矿 → 玻璃', inputs: freeze({ 4: 2, 12: 1 }), output: freeze({ id: 9, count: 3 }) },
  { id: 'glow', name: '铜矿＋煤矿 → 光晶', inputs: freeze({ 13: 1, 12: 1 }), output: freeze({ id: 11, count: 2 }) },
].map(freeze));

export const MAX_VOXEL_CHANGES = 12_000;
export const MAX_VOXEL_SAVE_BYTES = 10_000_000;
export const VOXEL_PLAYER = freeze({ radius: .3, height: 1.7, eyeHeight: 1.55, walkSpeed: 5.1, runSpeed: 8.2, flightSpeed: 9, gravity: 18, jumpSpeed: 8.2 });
const N = ISLAND.columns, H = ISLAND.layers, S = ISLAND.cell, O = ISLAND.origin;
const TOTAL = N * N * H, MAX_INVENTORY = 999_999, EPS = 1e-7;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const validId = id => Number.isInteger(id) && id >= 0 && id < BLOCKS.length;
const solid = id => BLOCK_BY_ID[id]?.solid === true;
const validMode = mode => mode === 'collect' || mode === 'creative';
const cellTuple = cell => Array.isArray(cell) ? cell : cell && typeof cell === 'object' ? [cell.x, cell.y, cell.z] : [];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function voxelIndex(x, y, z) {
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
    && x >= 0 && x < N && y >= 0 && y < H && z >= 0 && z < N ? x + N * (z + N * y) : -1;
}
export function voxelCoords(index) {
  if (!Number.isInteger(index) || index < 0 || index >= TOTAL) return null;
  return [index % N, Math.floor(index / (N * N)), Math.floor(index / N) % N];
}
export function getVoxel(world, x, y, z) {
  const index = voxelIndex(x, y, z);
  return index < 0 || !world?.blocks ? 0 : world.blocks[index];
}

// Coordinate hashing is deterministic and does not alter the browser RNG.
function hash(x, y, z) {
  let value = Math.imul(x + ISLAND.seed, 374761393) ^ Math.imul(y + 19, 668265263) ^ Math.imul(z + 71, 2147483647);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return (value ^ value >>> 16) >>> 0;
}
let baseline = null;
function baseBlocks() {
  if (baseline) return baseline;
  const blocks = new Uint8Array(TOTAL);
  const put = (x, y, z, id) => { const index = voxelIndex(x, y, z); if (index >= 0) blocks[index] = id; };
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const height = pixelColumnHeight(x, z), surface = pixelSurfaceBlock(x, z);
    for (let y = 0; y < height; y++) {
      let id = y === 0 ? 14 : y === height - 1 ? surface : surface === 4 && y >= height - 3 ? 4 : y >= height - 3 ? 2 : 3;
      if (id === 3 && y > 1) {
        const ore = hash(x, y, z) % 100;
        if (ore < 5) id = 12; else if (ore < 9 && y < 13) id = 13;
      }
      put(x, y, z, id);
    }
  }
  // A shallow curving mine has a visible southern entrance, a solid floor,
  // and headroom; it is not a hidden void that can trap the arrival player.
  for (let z = 25; z <= 44; z++) {
    const cx = Math.round(43 + Math.sin(z * .27) * 1.5);
    for (let x = cx - 1; x <= cx + 1; x++) {
      const height = pixelColumnHeight(x, z);
      const ceiling = z > 40 ? Math.max(9, height + 1) : 9;
      for (let y = 6; y <= ceiling; y++) put(x, y, z, 0);
      if (z < 36) put(x, 5, z, (x + z) % 3 === 0 ? 13 : 3);
    }
  }
  // Original cubic groves. Keep all trunks and foliage away from arrival.
  const trees = [[14, 42], [19, 40], [24, 41], [16, 35], [12, 30], [20, 27], [28, 33], [48, 36], [49, 30], [47, 21], [29, 18], [22, 17], [13, 22], [51, 42], [18, 48], [42, 49]];
  for (const [x, z] of trees) {
    const ground = pixelColumnHeight(x, z), height = 4 + hash(x, 0, z) % 2;
    if (ground < 7 || ground > 19 || Math.hypot(x - 32, z - 51) < 7) continue;
    for (let y = ground; y < ground + height; y++) put(x, y, z, 5);
    for (let dy = -1; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) + Math.abs(dz) + Math.max(0, dy) > 4 || dx === 0 && dz === 0 && dy < 0) continue;
      const gy = ground + height - 1 + dy, index = voxelIndex(x + dx, gy, z + dz);
      if (index >= 0 && blocks[index] === 0) blocks[index] = 6;
    }
  }
  // A broken stone gate marks the northern meadow and can be recycled.
  const archZ = 31, left = 31, right = 39;
  const archY = Math.max(...Array.from({ length: right - left + 1 }, (_, i) => pixelColumnHeight(left + i, archZ)));
  for (const x of [left, right]) for (let y = pixelColumnHeight(x, archZ); y <= archY + 5; y++) {
    put(x, y, archZ, 8); put(x, y, archZ + 1, 8);
  }
  for (let x = left; x <= right; x++) { put(x, archY + 5, archZ, 8); put(x, archY + 5, archZ + 1, 8); }
  put(left, archY + 6, archZ, 11); put(right, archY + 6, archZ, 11);
  baseline = blocks;
  return baseline;
}

export function createVoxelWorld() {
  return { blocks: baseBlocks().slice(), changes: new Map(), revision: 0 };
}

export function setVoxel(world, x, y, z, id) {
  const index = voxelIndex(x, y, z);
  if (index < 0 || y === 0 || !validId(id) || id === 14 || !(world?.blocks instanceof Uint8Array)
    || world.blocks.length !== TOTAL || !(world.changes instanceof Map) || world.blocks[index] === id) return false;
  const original = baseBlocks()[index];
  if (original === 14 || world.changes.size >= MAX_VOXEL_CHANGES && !world.changes.has(index) && id !== original) return false;
  world.blocks[index] = id;
  if (id === original) world.changes.delete(index); else world.changes.set(index, id);
  world.revision += 1;
  return true;
}

/** Absolute world-space ray, exact grid DDA; nearest opaque or glass block. */
export function voxelRaycast(world, origin, direction, reach = 8) {
  if (![origin?.x, origin?.y, origin?.z, direction?.x, direction?.y, direction?.z, reach].every(finite) || reach <= 0) return null;
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  if (magnitude < 1e-12) return null;
  const d = [direction.x / magnitude, direction.y / magnitude, direction.z / magnitude];
  const originArray = [origin.x, origin.y, origin.z], offsets = [O.x, O.y, O.z];
  const cell = originArray.map((value, axis) => Math.floor((value - offsets[axis]) / S));
  const step = d.map(value => Math.sign(value));
  const delta = d.map(value => value === 0 ? Infinity : S / Math.abs(value));
  const next = d.map((value, axis) => value === 0 ? Infinity
    : (offsets[axis] + (cell[axis] + (value > 0 ? 1 : 0)) * S - originArray[axis]) / value);
  let distance = 0, normal = [0, 0, 0];
  const limit = Math.min(reach, 200);
  for (let iteration = 0; iteration < 1024 && distance <= limit + EPS; iteration++) {
    const [x, y, z] = cell, id = getVoxel(world, x, y, z);
    if (solid(id)) return { x, y, z, id, normal: [...normal], distance: Math.max(0, distance), place: cell.map((value, axis) => value + normal[axis]) };
    // Ties have a stable X/Y/Z order; a zero direction is never selected.
    const axis = next[0] <= next[1] && next[0] <= next[2] ? 0 : next[1] <= next[2] ? 1 : 2;
    distance = next[axis];
    if (!Number.isFinite(distance)) break;
    cell[axis] += step[axis]; next[axis] += delta[axis]; normal = [0, 0, 0]; normal[axis] = -step[axis];
  }
  return null;
}

function bodyBounds(pose) {
  return { min: [pose.x - VOXEL_PLAYER.radius, pose.y + EPS, pose.z - VOXEL_PLAYER.radius],
    max: [pose.x + VOXEL_PLAYER.radius, pose.y + VOXEL_PLAYER.height - EPS, pose.z + VOXEL_PLAYER.radius] };
}
export function voxelBodyCollides(world, pose) {
  if (![pose?.x, pose?.y, pose?.z].every(finite)) return true;
  const bounds = bodyBounds(pose), offsets = [O.x, O.y, O.z];
  const min = bounds.min.map((value, axis) => Math.floor((value - offsets[axis] + EPS) / S));
  const max = bounds.max.map((value, axis) => Math.floor((value - offsets[axis] - EPS) / S));
  for (let y = Math.max(0, min[1]); y <= Math.min(H - 1, max[1]); y++)
    for (let z = Math.max(0, min[2]); z <= Math.min(N - 1, max[2]); z++)
      for (let x = Math.max(0, min[0]); x <= Math.min(N - 1, max[0]); x++) if (solid(getVoxel(world, x, y, z))) return true;
  return false;
}
function overlapsCell(player, x, y, z) {
  if (![player?.x, player?.y, player?.z].every(finite)) return true;
  const bounds = bodyBounds(player), mins = [O.x + x * S, O.y + y * S, O.z + z * S];
  return mins.every((value, axis) => bounds.max[axis] > value + EPS && bounds.min[axis] < value + S - EPS);
}

export function voxelSpawn(world) {
  const cx = Math.floor((ISLAND.arrival.x - O.x) / S), cz = Math.floor((ISLAND.arrival.z - O.z) / S);
  for (let radius = 0; radius <= 12; radius++) for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    if (radius && Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
    const x = cx + dx, z = cz + dz;
    if (x < 1 || x >= N - 1 || z < 1 || z >= N - 1) continue;
    for (let y = H - 3; y >= 5; y--) if (solid(getVoxel(world, x, y - 1, z))) {
      const pose = { x: O.x + (x + .5) * S, y: O.y + y * S, z: O.z + (z + .5) * S, yaw: 0, pitch: 0, vy: 0, grounded: true, flying: false };
      if (!voxelBodyCollides(world, pose)) return pose;
    }
  }
  // Only a deliberately destroyed whole arrival area reaches this fallback.
  return { x: ISLAND.arrival.x, y: O.y + (H + 1) * S, z: ISLAND.arrival.z, yaw: 0, pitch: 0, vy: 0, grounded: false, flying: false };
}

function validPlayerPose(pose) {
  return plain(pose) && ['x', 'y', 'z', 'yaw', 'pitch', 'vy'].every(key => finite(pose[key]))
    && pose.x >= O.x - 8 && pose.x <= O.x + N * S + 8
    && pose.z >= O.z - 8 && pose.z <= O.z + N * S + 8
    && pose.y >= O.y - 2 && pose.y <= O.y + H * S + 45
    && Math.abs(pose.vy) <= 40;
}

/** Swept, axis-separated AABB controller in metres, with bounded substeps. */
export function stepVoxelPlayer(world, state, input = {}, seconds = 0) {
  if (!validPlayerPose(state)) return { ...voxelSpawn(world), rescued: true };
  const dt = finite(seconds) ? clamp(seconds, 0, .1) : 0;
  const next = { ...state, yaw: Math.atan2(Math.sin(state.yaw), Math.cos(state.yaw)), pitch: clamp(state.pitch, -1.48, 1.48), rescued: false };
  if (dt === 0) return next;
  let forward = finite(input?.forward) ? clamp(input.forward, -1, 1) : 0;
  let right = finite(input?.right) ? clamp(input.right, -1, 1) : 0;
  const length = Math.hypot(forward, right); if (length > 1) { forward /= length; right /= length; }
  const speed = next.flying ? VOXEL_PLAYER.flightSpeed : input?.sprint ? VOXEL_PLAYER.runSpeed : VOXEL_PLAYER.walkSpeed;
  const dx = (Math.cos(next.yaw) * right - Math.sin(next.yaw) * forward) * speed * dt;
  const dz = (-Math.sin(next.yaw) * right - Math.cos(next.yaw) * forward) * speed * dt;
  let dy;
  const supported = voxelBodyCollides(world, { ...next, y: next.y - .025 });
  next.grounded = !next.flying && supported && next.vy <= 0;
  if (next.flying) {
    next.vy = 0;
    dy = (Number(input?.ascend === true) - Number(input?.descend === true)) * speed * dt;
  } else {
    if (input?.jump === true && next.grounded) { next.vy = VOXEL_PLAYER.jumpSpeed; next.grounded = false; }
    else if (next.grounded) next.vy = 0;
    dy = next.vy * dt - VOXEL_PLAYER.gravity * dt * dt / 2;
    next.vy = Math.max(-30, next.vy - VOXEL_PLAYER.gravity * dt);
  }
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz), Math.abs(dy)) / .16));
  for (let step = 0; step < steps; step++) {
    for (const [key, delta] of [['x', dx / steps], ['z', dz / steps], ['y', dy / steps]]) {
      if (Math.abs(delta) < 1e-12) continue;
      const candidate = { ...next, [key]: next[key] + delta };
      if (!voxelBodyCollides(world, candidate)) next[key] = candidate[key];
      else {
        // Resolve the final fraction to the exact face instead of hovering
        // one whole substep above floors or stopping far away from a wall.
        let low = 0, high = 1;
        for (let i = 0; i < 15; i++) {
          const mid = (low + high) / 2;
          if (voxelBodyCollides(world, { ...next, [key]: next[key] + delta * mid })) high = mid; else low = mid;
        }
        next[key] += delta * low;
        if (key === 'y') { next.vy = 0; if (delta < 0 && !next.flying) next.grounded = true; }
      }
    }
  }
  next.moving = Math.hypot(next.x - state.x, next.z - state.z) > .0001;
  next.y = Math.min(next.y, O.y + H * S + 30);
  const gx = Math.floor((next.x - O.x) / S), gz = Math.floor((next.z - O.z) / S);
  const fellIntoSea = next.y < -1.8 && pixelColumnHeight(gx, gz) < 5;
  if (!validPlayerPose(next) || fellIntoSea) return { ...voxelSpawn(world), rescued: true, moving: false };
  return next;
}

export function createVoxelInventory() {
  return { 1: 12, 2: 16, 3: 8, 4: 0, 5: 0, 6: 0, 7: 24, 8: 8, 9: 12, 10: 0, 11: 4, 12: 0, 13: 0, 15: 0 };
}
function count(inventory, id) {
  const value = inventory?.[id];
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_INVENTORY ? value : 0;
}
function fail(message) { return { ok: false, message }; }

export function mineVoxel(world, cell, inventory, mode = 'collect') {
  const [x, y, z] = cellTuple(cell), index = voxelIndex(x, y, z), id = getVoxel(world, x, y, z);
  if (!validMode(mode) || !plain(inventory)) return fail('材料记录无效。');
  if (index < 0 || id === 0) return fail('这里没有可以采集的方块。');
  if (y === 0 || id === 14) return fail('基岩保护着岛屿，不能挖掘。');
  if (mode === 'collect' && count(inventory, id) >= MAX_INVENTORY) return fail('这种材料已达到背包上限。');
  if (!setVoxel(world, x, y, z, 0)) return fail('当前编辑已达存档容量，或这个方块不可修改。');
  if (mode === 'collect') inventory[id] = count(inventory, id) + 1;
  return { ok: true, message: `采集了${BLOCK_BY_ID[id].name}`, id, cell: [x, y, z], count: 1 };
}
export function placeVoxel(world, cell, id, inventory, mode = 'collect', player) {
  const [x, y, z] = cellTuple(cell), index = voxelIndex(x, y, z);
  if (!validMode(mode) || !plain(inventory)) return fail('材料记录无效。');
  if (!validId(id) || !BLOCK_BY_ID[id].placeable || index < 0 || y === 0) return fail('这里不能放置这个方块。');
  if (getVoxel(world, x, y, z) !== 0) return fail('这里已经有方块了。');
  if (overlapsCell(player, x, y, z)) return fail('不能把方块放进自己身体里。');
  if (mode === 'collect' && count(inventory, id) < 1) return fail('材料不足，先去采集或合成。');
  if (!setVoxel(world, x, y, z, id)) return fail('当前编辑已达存档容量。');
  if (mode === 'collect') inventory[id] = count(inventory, id) - 1;
  return { ok: true, message: `放置了${BLOCK_BY_ID[id].name}`, id, cell: [x, y, z] };
}
export function craftVoxel(inventory, recipeId) {
  if (!plain(inventory)) return fail('材料记录无效。');
  const recipe = RECIPES.find(item => item.id === recipeId);
  if (!recipe) return fail('没有这个合成配方。');
  if (Object.entries(recipe.inputs).some(([id, amount]) => count(inventory, id) < amount)) return fail('合成材料不足。');
  if (count(inventory, recipe.output.id) + recipe.output.count > MAX_INVENTORY) return fail('背包材料已达到上限。');
  for (const [id, amount] of Object.entries(recipe.inputs)) inventory[id] = count(inventory, id) - amount;
  inventory[recipe.output.id] = count(inventory, recipe.output.id) + recipe.output.count;
  return { ok: true, message: `合成了 ${recipe.output.count} 个${BLOCK_BY_ID[recipe.output.id].name}`, ...recipe.output };
}

const SAVE_KEYS = ['schemaVersion', 'seed', 'changes', 'inventory', 'mode', 'player'];
const PLAYER_KEYS = ['x', 'y', 'z', 'yaw', 'pitch', 'vy', 'grounded', 'flying'];
function cleanInventory(inventory) {
  if (!plain(inventory) || Object.keys(inventory).length > BLOCKS.length) throw new Error('背包记录不合法。');
  const result = {};
  for (const [key, value] of Object.entries(inventory)) {
    const id = Number(key);
    if (!/^(?:[1-9]|1[0-5])$/.test(key) || !validId(id) || id === 14
      || !Number.isSafeInteger(value) || value < 0 || value > MAX_INVENTORY) throw new Error('背包材料数量或类型不合法。');
    result[id] = value;
  }
  for (const block of BLOCKS) if (block.placeable && !(block.id in result)) result[block.id] = 0;
  return result;
}
function cleanPlayer(world, player, mode, rejectUnknown = false) {
  if (rejectUnknown && (!plain(player) || Object.keys(player).some(key => !PLAYER_KEYS.includes(key)))) throw new Error('人物位置记录不合法。');
  if (!validPlayerPose(player) || voxelBodyCollides(world, player)) return voxelSpawn(world);
  return { x: player.x, y: player.y, z: player.z, yaw: Math.atan2(Math.sin(player.yaw), Math.cos(player.yaw)),
    pitch: clamp(player.pitch, -1.48, 1.48), vy: clamp(player.vy, -30, 15), grounded: player.grounded === true,
    flying: mode === 'creative' && player.flying === true };
}

export function serializeVoxelSave(world, inventory, mode, player) {
  if (!validMode(mode) || !(world?.changes instanceof Map) || world.changes.size > MAX_VOXEL_CHANGES) throw new Error('无法保存这个沙盒状态。');
  const changes = [...world.changes.entries()].sort((a, b) => a[0] - b[0]);
  for (const [index, id] of changes) {
    const cell = voxelCoords(index);
    if (!cell || cell[1] === 0 || !validId(id) || id === 14 || baseBlocks()[index] === 14 || world.blocks[index] !== id) throw new Error('方块改动记录不合法。');
  }
  const data = { schemaVersion: 1, seed: ISLAND.seed, changes, inventory: cleanInventory(inventory), mode, player: cleanPlayer(world, player, mode) };
  const raw = JSON.stringify(data);
  if (raw.length > MAX_VOXEL_SAVE_BYTES) throw new Error('存档过大，请减少方块改动。');
  return raw;
}

export function restoreVoxelSave(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_VOXEL_SAVE_BYTES) throw new Error('存档不是文本，或超过 10 MB 上限。');
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('存档文件损坏，无法读取 JSON。'); }
  if (!plain(data) || Object.keys(data).length !== SAVE_KEYS.length || Object.keys(data).some(key => !SAVE_KEYS.includes(key))
    || data.schemaVersion !== 1 || data.seed !== ISLAND.seed || !validMode(data.mode)) throw new Error('存档版本、岛屿种子或模式不兼容。');
  if (!Array.isArray(data.changes) || data.changes.length > MAX_VOXEL_CHANGES) throw new Error('方块改动超出存档上限。');
  const world = createVoxelWorld(), seen = new Set();
  for (const entry of data.changes) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('方块改动记录不合法。');
    const [index, id] = entry, cell = voxelCoords(index);
    if (!cell || cell[1] === 0 || !validId(id) || id === 14 || baseBlocks()[index] === 14 || seen.has(index)) throw new Error('存档包含非法、重复或受保护的方块。');
    seen.add(index);
    if (id !== world.blocks[index] && !setVoxel(world, ...cell, id)) throw new Error('无法恢复方块改动。');
  }
  const inventory = cleanInventory(data.inventory), player = cleanPlayer(world, data.player, data.mode, true);
  return { world, inventory, mode: data.mode, player };
}
