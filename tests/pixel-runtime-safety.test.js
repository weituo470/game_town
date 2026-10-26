import test from 'node:test';
import assert from 'node:assert/strict';
import { createPixelRuntime, PIXEL_SAVE_KEY } from '../src/components/pixel/pixelRuntime.js';
import { PIXEL_ISLAND as I } from '../shared/pixel-island.js';
import { HOTBAR, BLOCK_BY_ID, setVoxel, getVoxel, restoreVoxelSave } from '../shared/pixel-world.js';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
};
const create = () => createPixelRuntime({ storage: storage() });
function aimAtTestBlock(runtime) {
  runtime.start('creative');
  Object.assign(runtime.player, { x: I.origin.x + 32.5 * I.cell, y: I.origin.y + 28.5 * I.cell - 1.55,
    z: I.origin.z + 51.5 * I.cell, yaw: 0, pitch: 0, vy: 0, flying: true });
  setVoxel(runtime.world, 32, 28, 48, 7);
  runtime.frame(.016);
  assert.deepEqual([runtime.target.x, runtime.target.y, runtime.target.z], [32, 28, 48]);
}

test('changing aim cancels previous mining progress instead of applying it to the next block', () => {
  const runtime = create();
  try {
    aimAtTestBlock(runtime); setVoxel(runtime.world, 34, 28, 49, 7);
    const revision = runtime.world.revision;
    runtime.setInput('mine', true); runtime.frame(.04); runtime.frame(.04);
    assert.ok(runtime.miningProgress > .5 && runtime.miningProgress < 1);
    runtime.player.yaw = -Math.PI / 4; runtime.frame(.01);
    assert.deepEqual([runtime.target.x, runtime.target.y, runtime.target.z], [34, 28, 49]);
    assert.ok(runtime.miningProgress < .2); assert.equal(runtime.world.revision, revision);
    assert.equal(getVoxel(runtime.world, 32, 28, 48), 7);
  } finally { runtime.dispose(); }
});

test('placement respects aimed array cells and cannot consume resources twice before the next frame', () => {
  const runtime = create();
  try {
    aimAtTestBlock(runtime); runtime.start('collect'); runtime.player.flying = true;
    runtime.select(4); const id = HOTBAR[4], count = runtime.inventory[id], target = runtime.target;
    assert.ok(Array.isArray(target.place));
    assert.equal(runtime.action('place'), true); assert.equal(runtime.inventory[id], count - 1);
    assert.equal(getVoxel(runtime.world, ...target.place), id);
    assert.equal(runtime.action('place'), false); assert.equal(runtime.inventory[id], count - 1);
    assert.equal(runtime.getSnapshot().stats.placed, 1);
  } finally { runtime.dispose(); }
});

test('inventory panel cancels held movement and mining, freezes physics and leaves no stale input', () => {
  const runtime = create();
  try {
    aimAtTestBlock(runtime); runtime.setInput('forward', true); runtime.setInput('mine', true); runtime.frame(.03);
    const position = { ...runtime.player }, revision = runtime.world.revision;
    runtime.togglePanel('craft');
    for (let frame = 0; frame < 60; frame++) runtime.frame(.02);
    assert.equal(runtime.player.x, position.x); assert.equal(runtime.player.z, position.z);
    assert.equal(runtime.world.revision, revision); assert.equal(runtime.miningProgress, 0);
    runtime.togglePanel('craft'); runtime.frame(.02);
    assert.equal(runtime.player.x, position.x); assert.equal(runtime.player.z, position.z);
    assert.equal(runtime.world.revision, revision);
  } finally { runtime.dispose(); }
});

test('pointer unlock pauses once, clears inputs and manual resume does not resume held movement', () => {
  const runtime = create();
  try {
    runtime.start('collect'); runtime.setLocked(true); runtime.setInput('forward', true); runtime.frame(.02);
    const z = runtime.player.z; runtime.setLocked(false);
    assert.equal(runtime.phase, 'paused'); runtime.frame(.04); assert.equal(runtime.player.z, z);
    runtime.resume(); runtime.frame(.04); assert.equal(runtime.player.z, z);
    assert.equal(runtime.phase, 'playing');
  } finally { runtime.dispose(); }
});

test('bedrock cannot grant resources or record a successful mine even after long input', () => {
  const runtime = create();
  try {
    runtime.start('collect'); runtime.player.pitch = -1.48;
    // Strip the one aimed arrival column above the protected bottom.
    for (let y = 1; y < I.layers; y++) setVoxel(runtime.world, 32, y, 51, 0);
    Object.assign(runtime.player, { y: I.origin.y + I.cell, vy: 0, grounded: true });
    runtime.frame(.02); assert.equal(runtime.target.id, 14);
    const revision = runtime.world.revision, inventory = { ...runtime.inventory };
    runtime.setInput('mine', true);
    for (let frame = 0; frame < 120; frame++) runtime.frame(.02);
    assert.equal(runtime.world.revision, revision); assert.deepEqual(runtime.inventory, inventory);
    assert.equal(runtime.getSnapshot().stats.mined, 0); assert.equal(BLOCK_BY_ID[14].placeable, false);
  } finally { runtime.dispose(); }
});

test('valid import replaces world atomically, marks all chunks dirty and preserves collect flight restriction', () => {
  const source = create(), destination = create();
  try {
    aimAtTestBlock(source); source.action('mine'); source.start('collect');
    const raw = source.exportSave(), previous = destination.world;
    assert.equal(destination.importSave(raw), true); assert.notEqual(destination.world, previous);
    assert.deepEqual(destination.world.blocks, source.world.blocks);
    assert.equal(destination.phase, 'paused'); assert.equal(destination.mode, 'collect');
    assert.equal(destination.player.flying, false); assert.equal(destination.dirtyChunks.has('*'), true);
    const imported = destination.world;
    assert.equal(destination.importSave('{"not":"a world"}'), false); assert.equal(destination.world, imported);
  } finally { source.dispose(); destination.dispose(); }
});

test('deactivation writes pending incremental edits, while corrupt previous records are retained until explicit reset', () => {
  const targetStorage = storage(), runtime = createPixelRuntime({ storage: targetStorage });
  try {
    aimAtTestBlock(runtime); runtime.action('mine'); runtime.deactivate();
    const raw = targetStorage.getItem(PIXEL_SAVE_KEY), restored = restoreVoxelSave(raw);
    assert.deepEqual(restored.world.blocks, runtime.world.blocks);
    assert.equal(runtime.phase, 'paused');
  } finally { runtime.dispose(); }
  const damagedStorage = storage(); damagedStorage.setItem(PIXEL_SAVE_KEY, '{damaged');
  const damaged = createPixelRuntime({ storage: damagedStorage });
  try {
    damaged.start('creative'); damaged.pause(); damaged.deactivate();
    assert.equal(damagedStorage.getItem(PIXEL_SAVE_KEY), '{damaged');
    assert.doesNotThrow(() => restoreVoxelSave(damaged.exportSave()));
    damaged.reset(); damaged.deactivate();
    assert.doesNotThrow(() => restoreVoxelSave(damagedStorage.getItem(PIXEL_SAVE_KEY)));
  } finally { damaged.dispose(); }
});

test('local creative and collect modes switch without losing builds or minting items directly', () => {
  const runtime = create();
  try {
    aimAtTestBlock(runtime); const inventory = { ...runtime.inventory };
    runtime.action('mine'); assert.deepEqual(runtime.inventory, inventory);
    const changes = runtime.world.changes.size, blocks = runtime.world.blocks;
    runtime.start('collect'); assert.equal(runtime.world.blocks, blocks); assert.equal(runtime.world.changes.size, changes);
    assert.deepEqual(runtime.inventory, inventory); assert.equal(runtime.player.flying, false);
    runtime.start('creative'); assert.deepEqual(runtime.inventory, inventory);
    // This is deliberately a single-player sandbox, not an anti-cheat ledger:
    // switching modes preserves the edited terrain rather than deleting it.
  } finally { runtime.dispose(); }
});
