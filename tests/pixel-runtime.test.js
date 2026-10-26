import test from 'node:test';
import assert from 'node:assert/strict';
import { createPixelRuntime, PIXEL_SAVE_KEY } from '../src/components/pixel/pixelRuntime.js';
import { createPixelChunkGeometry } from '../src/components/pixel/pixelVisual.js';
import { HOTBAR, getVoxel, restoreVoxelSave } from '../shared/pixel-world.js';
import { readFileSync } from 'node:fs';

const memoryStorage = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };

test('pixel runtime exposes a stable external-store snapshot until notification', () => {
  const r = createPixelRuntime({ storage: memoryStorage() });
  const first = r.getSnapshot(); assert.equal(first, r.getSnapshot()); assert.ok(Object.isFrozen(first));
  let notices = 0; const unsubscribe = r.subscribe(() => notices++);
  r.select(2); assert.equal(r.getSnapshot().selected, 2); assert.notEqual(first, r.getSnapshot()); assert.equal(notices, 1);
  unsubscribe(); r.select(3); assert.equal(notices, 1); r.dispose();
});

test('pixel runtime starts only on request and never requests pointer lock implicitly', () => {
  const r = createPixelRuntime({ storage: memoryStorage() }); let locks = 0;
  r.bindPointerLock(() => locks++, () => {});
  assert.equal(r.getSnapshot().phase, 'overview'); r.start(); assert.equal(locks, 0);
  r.requestLock(); assert.equal(locks, 1); r.pause(); r.resume(); assert.equal(locks, 1);
  r.dispose();
});

test('pixel controller moves using returned physics pose and stops on pause', () => {
  const r = createPixelRuntime({ storage: memoryStorage() }); r.start('collect');
  const z = r.player.z; r.setInput('forward', true); for (let i = 0; i < 20; i++) r.frame(.016);
  assert.ok(r.player.z < z - .5); r.pause(); const paused = r.player.z;
  for (let i = 0; i < 20; i++) r.frame(.016); assert.equal(r.player.z, paused);
  r.resume(); r.frame(.02); assert.equal(r.player.z, paused); r.dispose();
});

test('pixel touch inputs support backward and ascend aliases', () => {
  const r = createPixelRuntime({ storage: memoryStorage() }); r.start('creative');
  const z = r.player.z; r.setInput('backward', true); for (let i = 0; i < 10; i++) r.frame(.02); r.setInput('backward', false);
  assert.ok(r.player.z > z); r.action('fly'); const y = r.player.y;
  r.setInput('ascend', true); for (let i = 0; i < 10; i++) r.frame(.02); r.setInput('ascend', false);
  assert.ok(r.player.y > y + 1); assert.equal(r.getSnapshot().flying, true); r.dispose();
});

test('pixel mining and placement use aimed faces, counts and dirty chunks', () => {
  const r = createPixelRuntime({ storage: memoryStorage() }); r.start('collect'); r.player.pitch = -1;
  r.frame(.016); const target = r.target; assert.ok(target);
  const before = r.inventory[target.id] ?? 0; assert.equal(r.action('mine'), true);
  assert.equal(getVoxel(r.world, target.x, target.y, target.z), 0); assert.equal(r.inventory[target.id], before + 1);
  assert.ok(r.dirtyChunks.size > 0); assert.equal(r.getSnapshot().stats.mined, 1);
  r.frame(.016); r.select(4); const id = HOTBAR[4], count = r.inventory[id];
  assert.equal(r.action('place'), true); assert.equal(r.inventory[id], count - 1); assert.equal(r.getSnapshot().stats.placed, 1);
  r.dispose();
});

test('pixel long press observes hardness instead of deleting on first frame', () => {
  const r = createPixelRuntime({ storage: memoryStorage() }); r.start('collect'); r.player.pitch = -1; r.frame(.016);
  const before = r.world.revision; r.setInput('mine', true); r.frame(.02); assert.equal(r.world.revision, before);
  for (let i = 0; i < 20; i++) r.frame(.02); assert.ok(r.world.revision > before);
  r.setInput('mine', false); r.dispose();
});

test('pixel stored mode and local world survive reload without consuming creative inventory', () => {
  const storage = memoryStorage(), r = createPixelRuntime({ storage }); r.start('creative'); r.player.pitch = -1; r.frame(.016);
  const inventory = { ...r.inventory }; assert.equal(r.action('mine'), true); assert.deepEqual(r.inventory, inventory);
  r.pause(); assert.equal(r.save(), true); const saved = storage.getItem(PIXEL_SAVE_KEY); assert.ok(saved);
  const restored = createPixelRuntime({ storage }); assert.equal(restored.getSnapshot().mode, 'creative');
  assert.equal(restored.world.changes.size, r.world.changes.size); assert.deepEqual(restored.inventory, inventory);
  restored.start('collect'); restored.pause(); restored.save(); assert.equal(restoreVoxelSave(storage.getItem(PIXEL_SAVE_KEY)).mode, 'collect');
  r.dispose(); restored.dispose();
});

test('pixel bad import is atomic and damaged previous local save is not silently overwritten', () => {
  const storage = memoryStorage(); storage.setItem(PIXEL_SAVE_KEY, '{broken');
  const r = createPixelRuntime({ storage }), original = r.world;
  assert.equal(r.importSave('{bad'), false); assert.equal(r.world, original); r.start(); r.pause();
  assert.equal(r.save(), false); assert.equal(storage.getItem(PIXEL_SAVE_KEY), '{broken');
  assert.match(r.getSnapshot().saveStatus, /旧存档/); r.reset(); r.save(); assert.doesNotThrow(() => restoreVoxelSave(storage.getItem(PIXEL_SAVE_KEY))); r.dispose();
});

test('pixel storage failure keeps the world playable and exportable', () => {
  const r = createPixelRuntime({ storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } });
  r.start('creative'); r.player.pitch = -1; r.frame(.016); assert.equal(r.action('mine'), true);
  const world = r.world; assert.equal(r.save(), false); assert.equal(r.world, world);
  assert.match(r.getSnapshot().saveStatus, /写入失败/); assert.ok(restoreVoxelSave(r.exportSave()).world.changes.size > 0); r.dispose();
});

test('pixel exposed-face geometry uses bounded chunks and finite world-space vertices', () => {
  const r = createPixelRuntime({ storage: memoryStorage() }); const geometry = createPixelChunkGeometry(r.world, 2, 3);
  assert.ok(geometry.attributes.position.count > 0); assert.ok(geometry.attributes.position.count < 16 * 16 * 40 * 24);
  assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
  assert.equal(geometry.attributes.position.count, geometry.attributes.normal.count); assert.equal(geometry.attributes.position.count, geometry.attributes.uv.count);
  geometry.dispose(); r.dispose();
});

test('pixel overview projection offsets are responsive and cleared on play and exit', () => {
  const source = readFileSync(new URL('../src/components/pixel/PixelIsland.jsx', import.meta.url), 'utf8');
  assert.match(source, /camera\.setViewOffset\(size\.width, size\.height/);
  assert.match(source, /aspect < \.85 \? \.18 : \.15/);
  assert.match(source, /Math\.max\(1, \.96 \/ aspect\)/);
  assert.ok((source.match(/camera\.clearViewOffset\(\)/g) ?? []).length >= 2, 'clear welcome lens offset both on first-person entry and effect cleanup');
  assert.match(source, /camera\.fov = previousFov/);
  assert.match(source, /if \(previousView\) camera\.setViewOffset/);
});

test('pixel denied-pointer-lock mouse can long-press mine while touch stays drag-only', () => {
  const source = readFileSync(new URL('../src/components/pixel/PixelIsland.jsx', import.meta.url), 'utf8');
  assert.match(source, /mouseMining: event\.pointerType !== 'touch' && event\.button === 0/);
  assert.match(source, /if \(drag\.mouseMining\) runtime\.setInput\('mine', true\)/);
  assert.match(source, /drag\.mouseMining && moved > 5/);
  assert.match(source, /drag\.mouseMining = false; runtime\.setInput\('mine', false\)/);
  assert.match(source, /if \(!drag\.mouseMining\) runtime\.look\(dx, dy\)/);
  assert.match(source, /window\.addEventListener\('pointercancel', pointerup\)/);
  assert.match(source, /catch\?\.\(\(\) => \{ if \(runtime\.locked\) runtime\.setLocked\(false\)/, 'denied request must not clear never-locked held mining');
});
