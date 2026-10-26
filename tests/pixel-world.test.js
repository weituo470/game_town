import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKS, BLOCK_BY_ID, HOTBAR, RECIPES, VOXEL_PLAYER,
  MAX_VOXEL_CHANGES, MAX_VOXEL_SAVE_BYTES, createVoxelWorld,
  getVoxel, setVoxel, voxelIndex, voxelCoords, voxelRaycast,
  voxelBodyCollides, voxelSpawn, stepVoxelPlayer, createVoxelInventory,
  mineVoxel, placeVoxel, craftVoxel, serializeVoxelSave, restoreVoxelSave,
} from '../shared/pixel-world.js';
import { PIXEL_ISLAND as I, pixelColumnHeight } from '../shared/pixel-island.js';

const S = I.cell, O = I.origin;
const point = (x, y, z) => ({ x: O.x + x * S, y: O.y + y * S, z: O.z + z * S });
const close = (actual, expected, epsilon = .00001) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
function fixture() {
  const world = createVoxelWorld();
  for (let x = 27; x <= 38; x++) for (let z = 46; z <= 57; z++) for (let y = 1; y <= 26; y++) {
    const id = y <= 5 ? 3 : 0;
    if (getVoxel(world, x, y, z) !== id) assert.equal(setVoxel(world, x, y, z, id), true);
  }
  const player = { ...point(30.5, 6, 50.5), yaw: 0, pitch: 0, vy: 0, grounded: true, flying: false };
  return { world, player };
}
function simulate(world, player, input, seconds, fps = 60) {
  let state = { ...player };
  for (let index = 0; index < Math.ceil(seconds * fps); index++) state = stepVoxelPlayer(world, state, typeof input === 'function' ? input(index, state) : input, 1 / fps);
  return state;
}

test('original palette, 9-slot hotbar and recipes are immutable and internally valid', () => {
  assert.equal(BLOCKS.length, 16); assert.equal(HOTBAR.length, 9);
  assert.ok(Object.isFrozen(BLOCKS) && Object.isFrozen(BLOCKS[1]) && Object.isFrozen(RECIPES));
  for (const id of HOTBAR) assert.ok(BLOCK_BY_ID[id].placeable);
  assert.equal(BLOCK_BY_ID[14].placeable, false);
  assert.equal(BLOCK_BY_ID[14].hardness, Infinity);
  for (const recipe of RECIPES) {
    assert.ok(BLOCK_BY_ID[recipe.output.id].placeable);
    assert.ok(Number.isInteger(recipe.output.count) && recipe.output.count > 0);
    for (const [id, amount] of Object.entries(recipe.inputs)) assert.ok(BLOCK_BY_ID[id].placeable && amount > 0);
  }
});

test('voxel indexing is reversible and rejects fractional, non-finite and outside coordinates', () => {
  for (const cell of [[0, 0, 0], [63, 39, 63], [32, 7, 51], [1, 23, 46]]) assert.deepEqual(voxelCoords(voxelIndex(...cell)), cell);
  for (const cell of [[-1, 0, 0], [64, 0, 0], [0, 40, 0], [0, 0, 64], [.5, 2, 2], [1, NaN, 1], [1, 1, Infinity], ['1', 1, 1]]) assert.equal(voxelIndex(...cell), -1);
  for (const index of [-1, 163840, NaN, Infinity, .3, '22']) assert.equal(voxelCoords(index), null);
});

test('island generation is repeatable, independently owned and contains trees, caves and ores', () => {
  const a = createVoxelWorld(), b = createVoxelWorld();
  assert.deepEqual(a.blocks, b.blocks); assert.notEqual(a.blocks, b.blocks);
  const palette = new Set(a.blocks); for (const id of [0, 1, 2, 3, 4, 5, 6, 8, 11, 12, 13, 14, 15]) assert.ok(palette.has(id), `generated block ${id}`);
  for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) {
    const height = pixelColumnHeight(x, z);
    if (height > 0) assert.equal(getVoxel(a, x, 0, z), 14);
  }
  assert.equal(getVoxel(a, 43, 7, 30), 0, 'mine tunnel is carved');
  const p = voxelSpawn(a);
  assert.equal(voxelBodyCollides(a, p), false); assert.ok(p.y > 0);
  assert.equal(setVoxel(a, 32, 7, 51, 0), true);
  assert.equal(getVoxel(b, 32, 7, 51), 1);
});

test('incremental edits preserve bedrock, do not accept unknown block IDs and remove restored differences', () => {
  const world = createVoxelWorld(), before = world.revision;
  for (const [cell, id] of [[[32, 0, 51], 0], [[32, 8, 51], 14], [[64, 8, 51], 1], [[32, 8, 51], -1], [[32, 8, 51], 16], [[32, 8, 51], 1.2]]) assert.equal(setVoxel(world, ...cell, id), false);
  assert.equal(world.revision, before);
  assert.equal(setVoxel(world, 32, 7, 51, 0), true);
  assert.equal(world.changes.size, 1); assert.equal(world.revision, before + 1);
  assert.equal(setVoxel(world, 32, 7, 51, 0), false);
  assert.equal(setVoxel(world, 32, 7, 51, 1), true);
  assert.equal(world.changes.size, 0);
});

test('edit capacity is bounded but allows revising or undoing an existing changed cell', () => {
  const world = createVoxelWorld();
  for (let y = 25; y < 40 && world.changes.size < MAX_VOXEL_CHANGES; y++) for (let z = 0; z < 64 && world.changes.size < MAX_VOXEL_CHANGES; z++) for (let x = 0; x < 64 && world.changes.size < MAX_VOXEL_CHANGES; x++) setVoxel(world, x, y, z, 7);
  assert.equal(world.changes.size, MAX_VOXEL_CHANGES);
  assert.equal(setVoxel(world, 63, 39, 63, 7), false);
  const first = voxelCoords(world.changes.keys().next().value);
  assert.equal(setVoxel(world, ...first, 8), true);
  assert.equal(setVoxel(world, ...first, 0), true);
  assert.equal(world.changes.size, MAX_VOXEL_CHANGES - 1);
  assert.equal(setVoxel(world, 63, 39, 63, 7), true);
});

test('DDA finds the nearest surface and correct outward normal from all six axes', () => {
  const { world } = fixture(); setVoxel(world, 32, 12, 50, 7);
  for (const [offset, dir, normal] of [
    [[-2, 0, 0], [1, 0, 0], [-1, 0, 0]], [[2, 0, 0], [-1, 0, 0], [1, 0, 0]],
    [[0, -2, 0], [0, 1, 0], [0, -1, 0]], [[0, 2, 0], [0, -1, 0], [0, 1, 0]],
    [[0, 0, -2], [0, 0, 1], [0, 0, -1]], [[0, 0, 2], [0, 0, -1], [0, 0, 1]],
  ]) {
    const origin = point(32.5 + offset[0], 12.5 + offset[1], 50.5 + offset[2]);
    const hit = voxelRaycast(world, origin, { x: dir[0], y: dir[1], z: dir[2] });
    assert.deepEqual([hit.x, hit.y, hit.z], [32, 12, 50]); assert.deepEqual(hit.normal, normal);
    assert.deepEqual(hit.place, [32 + normal[0], 12 + normal[1], 50 + normal[2]]); close(hit.distance, 2.25);
  }
});

test('DDA supports non-unit vectors, exact boundary rays and zero axes without NaN', () => {
  const { world } = fixture(); setVoxel(world, 32, 12, 50, 9); setVoxel(world, 34, 12, 50, 7);
  const start = point(30, 12.5, 50.5);
  assert.equal(voxelRaycast(world, start, { x: 10, y: 0, z: 0 }).x, 32);
  assert.equal(voxelRaycast(world, start, { x: 1, y: 0, z: 0 }, 2), null);
  const boundary = voxelRaycast(world, point(33, 12.5, 50.5), { x: -1, y: 0, z: 0 });
  assert.equal(boundary.x, 32); close(boundary.distance, 0);
  const inside = voxelRaycast(world, point(32.5, 12.5, 50.5), { x: 1, y: 0, z: 0 });
  assert.equal(inside.distance, 0); assert.deepEqual(inside.normal, [0, 0, 0]);
  assert.equal(voxelRaycast(world, start, { x: 0, y: 0, z: 0 }), null);
  assert.equal(voxelRaycast(world, { ...start, x: NaN }, { x: 1, y: 0, z: 0 }), null);
  assert.equal(voxelRaycast(world, start, { x: Infinity, y: 0, z: 0 }), null);
});

test('mining grants exactly one original resource; duplicate/bedrock attempts cannot grant items', () => {
  const world = createVoxelWorld(), inventory = createVoxelInventory(), previous = inventory[1];
  assert.equal(mineVoxel(world, { x: 32, y: 7, z: 51 }, inventory, 'collect').ok, true);
  assert.equal(inventory[1], previous + 1);
  assert.equal(mineVoxel(world, [32, 7, 51], inventory, 'collect').ok, false);
  assert.equal(inventory[1], previous + 1);
  assert.equal(mineVoxel(world, [32, 0, 51], inventory, 'collect').ok, false);
  assert.equal(getVoxel(world, 32, 0, 51), 14);
});

test('placing consumes one item, rejects overlap, occupied cells, invalid inventory and missing resources', () => {
  const { world, player } = fixture(), inventory = createVoxelInventory();
  const old = inventory[7];
  assert.equal(placeVoxel(world, [32, 6, 50], 7, inventory, 'collect', player).ok, true);
  assert.equal(inventory[7], old - 1);
  assert.equal(placeVoxel(world, [32, 6, 50], 7, inventory, 'collect', player).ok, false);
  assert.equal(inventory[7], old - 1);
  assert.equal(placeVoxel(world, [30, 6, 50], 7, inventory, 'collect', player).ok, false, 'body cell');
  assert.equal(placeVoxel(world, [32, 7, 50], 10, inventory, 'collect', player).ok, false);
  assert.equal(placeVoxel(world, [32, 7, 50], 7, null, 'collect', player).ok, false);
  assert.equal(placeVoxel(world, [32, 7, 50], 7, inventory, 'bad-mode', player).ok, false);
  assert.equal(placeVoxel(world, [32, 7, 50], 14, inventory, 'creative', player).ok, false);
  assert.equal(placeVoxel(world, [32, 7, 50], 7, inventory, 'collect', null).ok, false, 'missing player fails closed');
});

test('creative mode does not consume or award survival inventory', () => {
  const { world, player } = fixture(), inventory = createVoxelInventory(), original = { ...inventory };
  assert.equal(placeVoxel(world, [32, 6, 50], 10, inventory, 'creative', player).ok, true);
  assert.equal(mineVoxel(world, [32, 6, 50], inventory, 'creative').ok, true);
  assert.deepEqual(inventory, original);
});

test('crafting checks all ingredients before atomically consuming and granting materials', () => {
  const inventory = createVoxelInventory(); inventory[5] = 2;
  const previous = inventory[7];
  assert.equal(craftVoxel(inventory, 'planks').ok, true);
  assert.equal(inventory[5], 1); assert.equal(inventory[7], previous + 4);
  const frozenCopy = { ...inventory };
  assert.equal(craftVoxel(inventory, 'glow').ok, false); assert.deepEqual(inventory, frozenCopy);
  assert.equal(craftVoxel(inventory, '__proto__').ok, false);
  inventory[7] = 999999; assert.equal(craftVoxel(inventory, 'planks').ok, false); assert.equal(inventory[5], 1);
});

test('standing AABB rests on a face, rejects embedded body and respects narrow passages', () => {
  const { world, player } = fixture();
  assert.equal(voxelBodyCollides(world, player), false);
  assert.equal(voxelBodyCollides(world, { ...player, y: player.y - .05 }), true);
  setVoxel(world, 31, 6, 50, 7);
  assert.equal(voxelBodyCollides(world, { ...player, x: O.x + 31 * S - .2 }), true);
  assert.equal(voxelBodyCollides(world, { ...player, x: O.x + 31 * S - .31 }), false);
  assert.equal(voxelBodyCollides(world, { ...player, x: NaN }), true);
});

test('walking is camera-relative, normalized and frame-rate stable', () => {
  const { world, player } = fixture();
  const a = simulate(world, player, { forward: 1 }, .5, 60);
  const b = simulate(world, player, { forward: 1 }, .5, 30);
  close(a.x, player.x); close(player.z - a.z, VOXEL_PLAYER.walkSpeed * .5); close(a.z, b.z);
  const diagonal = simulate(world, player, { forward: 1, right: 1 }, .5);
  close(Math.hypot(diagonal.x - player.x, diagonal.z - player.z), VOXEL_PLAYER.walkSpeed * .5);
  const east = simulate(world, { ...player, yaw: -Math.PI / 2 }, { forward: 1 }, .5);
  assert.ok(east.x > player.x); close(east.z, player.z);
});

test('jump apex clears a full block and lands, without automatic repeated jumping', () => {
  const { world, player } = fixture(); let highest = player.y;
  const after = simulate(world, player, (frame, state) => { highest = Math.max(highest, state.y); return { jump: frame === 0 }; }, 2);
  assert.ok(highest - player.y > S + .1); assert.ok(highest - player.y < 2);
  close(after.y, player.y); assert.equal(after.grounded, true); assert.equal(after.vy, 0);
});

test('swept physics can jump onto a one-block ledge, then stand on its true top', () => {
  const { world, player } = fixture(); setVoxel(world, 32, 6, 50, 7);
  let state = { ...player, yaw: -Math.PI / 2 };
  for (let frame = 0; frame < 150; frame++) {
    state = stepVoxelPlayer(world, state, { forward: state.x < O.x + 32.5 * S ? 1 : 0, jump: frame === 0 }, 1 / 60);
    assert.equal(voxelBodyCollides(world, state), false);
  }
  assert.ok(state.x >= O.x + 32 * S); close(state.y, O.y + 7 * S); assert.equal(state.grounded, true);
});

test('fast movement and long frames do not tunnel through wall or ceiling', () => {
  const { world, player } = fixture();
  for (let y = 6; y < 12; y++) for (let z = 48; z < 54; z++) setVoxel(world, 33, y, z, 8);
  const after = simulate(world, { ...player, yaw: -Math.PI / 2 }, { forward: 1, sprint: true }, 2, 10);
  assert.ok(after.x <= O.x + 33 * S - VOXEL_PLAYER.radius + .00001); assert.equal(voxelBodyCollides(world, after), false);
  setVoxel(world, 30, 8, 50, 7);
  const jump = simulate(world, player, frame => ({ jump: frame === 0 }), 1, 10);
  assert.equal(voxelBodyCollides(world, jump), false); close(jump.y, player.y);
});

test('creative flight rises, descends, has no gravity and still collides', () => {
  const { world, player } = fixture(), flying = { ...player, flying: true };
  const raised = simulate(world, flying, { ascend: true }, .5); close(raised.y - player.y, VOXEL_PLAYER.flightSpeed * .5);
  const hover = simulate(world, raised, {}, .5); close(hover.y, raised.y); assert.equal(hover.vy, 0);
  const lowered = simulate(world, raised, { descend: true }, .5); close(lowered.y, player.y);
  assert.equal(voxelBodyCollides(world, lowered), false);
});

test('non-finite movement inputs, huge delta and falling outside the island are bounded safely', () => {
  const { world, player } = fixture();
  assert.deepEqual(stepVoxelPlayer(world, player, {}, -1).x, player.x);
  const nan = stepVoxelPlayer(world, player, { forward: NaN, right: Infinity }, NaN); close(nan.x, player.x); close(nan.z, player.z);
  const large = stepVoxelPlayer(world, player, { forward: 1 }, 99999); assert.ok(Math.abs(large.z - player.z) <= .52);
  assert.equal(stepVoxelPlayer(world, { ...player, x: Infinity }, {}, .1).rescued, true);
  assert.equal(stepVoxelPlayer(world, { ...player, x: O.x - 20 }, {}, .1).rescued, true);
  const sea = stepVoxelPlayer(world, { ...player, x: O.x + .5 * S, z: O.z + .5 * S, y: -2, vy: -1, grounded: false }, {}, .1);
  assert.equal(sea.rescued, true); assert.ok(sea.y > 0);
});

test('save/restore round-trips exact changes, inventory, mode and safe player pose', () => {
  const world = createVoxelWorld(), inventory = createVoxelInventory(), player = voxelSpawn(world);
  mineVoxel(world, [32, 7, 50], inventory, 'collect');
  placeVoxel(world, [36, 10, 51], 7, inventory, 'collect', player);
  const raw = serializeVoxelSave(world, inventory, 'collect', player), restored = restoreVoxelSave(raw);
  assert.deepEqual(restored.world.blocks, world.blocks); assert.deepEqual([...restored.world.changes], [...world.changes].sort((a, b) => a[0] - b[0]));
  assert.deepEqual(restored.inventory, inventory); assert.equal(restored.mode, 'collect');
  close(restored.player.x, player.x); close(restored.player.z, player.z);
  assert.ok(raw.length < 1000, 'only incremental edits, never the full voxel array');
});

test('restore rejects incompatible, duplicate, bedrock, malformed and oversized edit payloads', () => {
  const world = createVoxelWorld(), valid = JSON.parse(serializeVoxelSave(world, createVoxelInventory(), 'collect', voxelSpawn(world)));
  const reject = mutate => { const data = structuredClone(valid); mutate(data); assert.throws(() => restoreVoxelSave(JSON.stringify(data))); };
  reject(data => { data.schemaVersion = 2; }); reject(data => { data.seed = 123; }); reject(data => { data.mode = 'admin'; });
  reject(data => { data.unknown = true; }); reject(data => { data.changes = [[-1, 1]]; });
  reject(data => { data.changes = [[voxelIndex(32, 0, 51), 0]]; });
  reject(data => { data.changes = [[voxelIndex(32, 12, 51), 14]]; });
  reject(data => { data.changes = [[voxelIndex(32, 12, 51), 7], [voxelIndex(32, 12, 51), 7]]; });
  reject(data => { data.changes = new Array(MAX_VOXEL_CHANGES + 1).fill([32, 1]); });
  reject(data => { data.changes = [[voxelIndex(32, 12, 51), '7']]; });
  reject(data => { data.inventory[7] = -1; }); reject(data => { data.inventory[7] = 1000000; });
  reject(data => { data.inventory.secret = 12; }); reject(data => { data.player.untrusted = 'extra'; });
  assert.throws(() => restoreVoxelSave('{broken'));
  assert.throws(() => restoreVoxelSave(' '.repeat(MAX_VOXEL_SAVE_BYTES + 1)));
  assert.throws(() => restoreVoxelSave(null));
});

test('restored embedded or non-finite player positions recover safely, and collect cannot retain flight', () => {
  const world = createVoxelWorld(), inventory = createVoxelInventory();
  const data = JSON.parse(serializeVoxelSave(world, inventory, 'collect', voxelSpawn(world)));
  data.player.y = O.y + 2; data.player.flying = true;
  const restored = restoreVoxelSave(JSON.stringify(data));
  assert.equal(voxelBodyCollides(restored.world, restored.player), false); assert.equal(restored.player.flying, false);
  data.player.x = null;
  assert.equal(voxelBodyCollides(world, restoreVoxelSave(JSON.stringify(data)).player), false);
  const creative = JSON.parse(serializeVoxelSave(world, inventory, 'creative', { ...voxelSpawn(world), flying: true }));
  assert.equal(restoreVoxelSave(JSON.stringify(creative)).player.flying, true);
});

test('serialization refuses tampered change records rather than silently exporting corrupt state', () => {
  const world = createVoxelWorld(), inventory = createVoxelInventory(), player = voxelSpawn(world);
  world.changes.set(-1, 7); assert.throws(() => serializeVoxelSave(world, inventory, 'collect', player));
  world.changes.clear(); world.changes.set(voxelIndex(32, 12, 51), 7);
  assert.throws(() => serializeVoxelSave(world, inventory, 'collect', player));
});
