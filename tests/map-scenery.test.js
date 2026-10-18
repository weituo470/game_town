import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebGLObjects } from 'three/src/renderers/webgl/WebGLObjects.js';
import { EMPTY_PLOTS, FOUNTAIN, STREETS, TREE_POSITIONS, WORLD_BOUNDS, WORLD_LOCATIONS, WORLD_SIZE } from '../shared/world.js';
import { addExpandedGround, createStreetPlan } from '../src/components/town/ExpandedGround.js';
import { GEOMETRY, MATERIAL, castsSceneryShadow, configureSceneryBatch, createBalloonBatches, createSceneryBatches, getSceneryStats, isVenueLabelVisible } from '../src/components/town/DuskSceneryModel.js';

const plan = createStreetPlan();
const staticBatches = createSceneryBatches();
const balloonBatches = createBalloonBatches();
const entries = staticBatches.flatMap(batch => batch.entries.map(entry => ({ ...entry, kind: batch.kind, material: batch.material })));
const inside = (rect, x, z, inset = 0) => Math.abs(x - rect.x) < rect.width / 2 - inset && Math.abs(z - rect.z) < rect.depth / 2 - inset;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const overlap = (a, b) => Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2) > 1e-7
  && Math.min(a.z + a.depth / 2, b.z + b.depth / 2) - Math.max(a.z - a.depth / 2, b.z - b.depth / 2) > 1e-7;

test('expanded scenery: exact 96 by 87 land mass, not a world-wide model scale', () => {
  const floor = entries.find(entry => entry.p[1] === -0.71);
  assert.ok(floor);
  assert.deepEqual(floor.p, [WORLD_SIZE.centerX, -0.71, WORLD_SIZE.centerZ]);
  assert.deepEqual(floor.s, [96, 1.3, 87]);
  close(floor.s[0] / WORLD_SIZE.baseWidth, 3);
  close(floor.s[2] / WORLD_SIZE.baseDepth, 3);
  close(floor.s[0] * floor.s[2] / (WORLD_SIZE.baseWidth * WORLD_SIZE.baseDepth), 9);
  assert.equal(floor.kind, 'box', 'large floor uses 12 triangles, not rounded micro-pavers');
});

test('expanded scenery: street slabs form the authoritative road union without coplanar overlaps', () => {
  for (let i = 0; i < plan.surfaces.length; i++) for (let j = i + 1; j < plan.surfaces.length; j++) {
    assert.equal(overlap(plan.surfaces[i], plan.surfaces[j]), false, `overlap ${i}/${j}`);
  }
  for (const street of STREETS) for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
    const x = street.x + (i / 6 - 0.5) * (street.width - 0.02);
    const z = street.z + (j / 6 - 0.5) * (street.depth - 0.02);
    assert.ok(plan.surfaces.some(surface => inside(surface, x, z, -1e-7)), `missing ${street.id} at ${x},${z}`);
  }
  for (const surface of plan.surfaces) assert.ok(STREETS.some(street => street.id === surface.id && inside(street, surface.x, surface.z, -1e-7)));
});

test('expanded scenery: curb segments stop at road junctions and the circular central piazza', () => {
  assert.ok(plan.curbs.length > 0 && plan.curbs.length < 160);
  for (const curb of plan.curbs) for (const t of [-0.45, 0, 0.45]) {
    const alongX = curb.width > curb.depth;
    const x = curb.x + (alongX ? curb.width * t : 0);
    const z = curb.z + (alongX ? 0 : curb.depth * t);
    assert.equal(STREETS.some(street => inside(street, x, z, 1e-5)), false, `curb crosses road at ${x},${z}`);
    assert.ok(Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) >= FOUNTAIN.plazaRadius, 'curb crosses plaza');
  }
});

test('expanded scenery: road-side lamps are sparse and clear of roads, buildings, trunks and plaza', () => {
  assert.ok(plan.lamps.length >= 16 && plan.lamps.length <= 48, `lamp count ${plan.lamps.length}`);
  for (const lamp of plan.lamps) {
    assert.equal(STREETS.some(street => inside(street, lamp.x, lamp.z, -0.39)), false);
    assert.ok(Math.hypot(lamp.x - FOUNTAIN.x, lamp.z - FOUNTAIN.z) > FOUNTAIN.plazaRadius + 0.3);
    assert.ok(lamp.x > WORLD_BOUNDS.minX && lamp.x < WORLD_BOUNDS.maxX && lamp.z > WORLD_BOUNDS.minZ && lamp.z < WORLD_BOUNDS.maxZ);
    assert.equal(WORLD_LOCATIONS.some(place => Math.abs(place.x - lamp.x) < 3.9 && Math.abs(place.z - lamp.z) < 3.5), false);
    assert.equal(TREE_POSITIONS.some(([x, z, scale]) => Math.hypot(x - lamp.x, z - lamp.z) < 1.5 * scale), false);
  }
});

test('expanded scenery: all future house lots stay flat grass with flush survey edging', () => {
  const groundEntries = [];
  addExpandedGround({ add: (kind, p, s, c, r, material) => groundEntries.push({ kind, p, s, c, r, material }) });
  for (const plot of EMPTY_PLOTS) {
    assert.ok(groundEntries.some(entry => entry.kind === 'box' && entry.p[0] === plot.x && entry.p[2] === plot.z && entry.s[0] === plot.width && entry.s[2] === plot.depth && entry.p[1] === 0.047));
    assert.equal(groundEntries.some(entry => entry.p[1] > 0.15 && inside(plot, entry.p[0], entry.p[2])), false, `fake house on ${plot.id}`);
  }
  assert.equal(groundEntries.filter(entry => entry.kind === 'plaza').length, 2);
});

test('expanded scenery: all four venues retain their original dimensions at shared new positions', () => {
  const dimensions = { balloons: [6, 0.4, 5.25], haunted: [5.6, 3.3, 4.8], rhythm: [5.9, 0.54, 5], puzzle: [3.05, 0.4, 3.05] };
  for (const place of WORLD_LOCATIONS) {
    assert.ok(entries.some(entry => entry.kind === (place.id === 'puzzle' ? 'cylinder' : 'soft') && entry.p[0] === place.x && entry.p[2] === place.z), `${place.id} has no model at its shared anchor`);
    assert.ok(entries.some(entry => entry.p[0] === place.x && entry.p[2] === place.z && entry.s.every((n, i) => n === dimensions[place.id][i])), `${place.id} size changed`);
  }
  // Only the separate landmark module may put a raised object in the basin area.
  assert.equal(entries.some(entry => entry.p[1] > 0.2 && Math.hypot(entry.p[0] - FOUNTAIN.x, entry.p[2] - FOUNTAIN.z) < FOUNTAIN.radius), false);
  assert.equal(MATERIAL.water, undefined, 'the retired miniature fountain must not retain a water material');
});

test('expanded scenery: finite transforms and resources stay below the explicit instancing budget', () => {
  const stats = getSceneryStats(staticBatches), balloons = getSceneryStats(balloonBatches);
  assert.ok(stats.batches <= 24 && stats.instances <= 2400 && stats.triangles <= 350000, JSON.stringify(stats));
  assert.ok(balloons.batches <= 3 && balloons.instances <= 24);
  for (const batch of [...staticBatches, ...balloonBatches]) {
    assert.ok(GEOMETRY[batch.kind] && MATERIAL[batch.material]);
    assert.ok(batch.entries.length > 0);
    for (const entry of batch.entries) {
      assert.ok([...entry.p, ...entry.s, ...entry.r].every(Number.isFinite), `${batch.kind} nonfinite transform`);
      assert.ok(entry.s.every(n => n > 0));
      assert.match(entry.c, /^#[a-f0-9]{6}$/i);
    }
  }
  for (const kind of ['box', 'plaza', 'plane', 'inlay']) assert.equal(castsSceneryShadow(kind, 'matte'), false);
  assert.equal(castsSceneryShadow('soft', 'lamp'), false);
  assert.equal(castsSceneryShadow('soft', 'matte'), true);
});

test('expanded scenery: repeated/Strict Mode construction is deterministic and leaves shared map data untouched', () => {
  const original = JSON.stringify({ STREETS, EMPTY_PLOTS, WORLD_LOCATIONS, TREE_POSITIONS, WORLD_SIZE, WORLD_BOUNDS, FOUNTAIN });
  assert.deepEqual(createStreetPlan(), plan);
  assert.deepEqual(createSceneryBatches(), staticBatches);
  assert.equal(JSON.stringify({ STREETS, EMPTY_PLOTS, WORLD_LOCATIONS, TREE_POSITIONS, WORLD_SIZE, WORLD_BOUNDS, FOUNTAIN }), original);
});

test('expanded scenery: Batch cleanup releases owned instance buffers, never shared geometry or materials', () => {
  // Exercise the installed Three renderer's actual resource ownership path.
  // Only attribute upload/removal is mocked, so no WebGL/browser is required.
  const uploaded = new Set();
  const info = { render: { frame: 1 } };
  const objects = WebGLObjects(
    { ARRAY_BUFFER: 34962 },
    { get: (_object, geometry) => geometry, update: () => {} },
    { update: attribute => uploaded.add(attribute), remove: attribute => uploaded.delete(attribute) },
    info,
  );
  const batch = staticBatches.find(item => item.kind === 'box');
  const mesh = new THREE.InstancedMesh(GEOMETRY[batch.kind], MATERIAL[batch.material], batch.entries.length);
  const sharedDisposals = { geometry: 0, material: 0 };
  const onGeometryDispose = () => { sharedDisposals.geometry++; };
  const onMaterialDispose = () => { sharedDisposals.material++; };
  mesh.geometry.addEventListener('dispose', onGeometryDispose);
  mesh.material.addEventListener('dispose', onMaterialDispose);
  let meshDisposals = 0;
  mesh.addEventListener('dispose', () => { meshDisposals++; });
  try {
    const firstCleanup = configureSceneryBatch(mesh, batch.entries);
    objects.update(mesh);
    assert.equal(uploaded.size, 2, 'first draw uploads both instance buffers');
    const firstMatrices = Array.from(mesh.instanceMatrix.array);
    const firstColors = Array.from(mesh.instanceColor.array);
    firstCleanup();
    assert.equal(uploaded.size, 0, 'unmount frees instanceMatrix and instanceColor');
    firstCleanup();
    assert.equal(meshDisposals, 1, 'one setup owns one idempotent cleanup');
    assert.deepEqual(sharedDisposals, { geometry: 0, material: 0 });

    // React Strict Mode keeps the same object while replaying layout effects.
    const secondCleanup = configureSceneryBatch(mesh, batch.entries);
    info.render.frame++;
    objects.update(mesh);
    assert.equal(uploaded.size, 2, 'second setup can upload fresh GPU buffers');
    assert.deepEqual(Array.from(mesh.instanceMatrix.array), firstMatrices);
    assert.deepEqual(Array.from(mesh.instanceColor.array), firstColors);
    assert.ok(Number.isFinite(mesh.boundingSphere.radius));
    secondCleanup();
    assert.equal(uploaded.size, 0);
    assert.equal(meshDisposals, 2);
    assert.deepEqual(sharedDisposals, { geometry: 0, material: 0 });
  } finally {
    mesh.dispose();
    mesh.geometry.removeEventListener('dispose', onGeometryDispose);
    mesh.material.removeEventListener('dispose', onMaterialDispose);
  }
});

test('venue labels: phone/tablet floating labels stay hidden without shrinking their text', () => {
  for (const width of [390, 700, 760]) for (const y of [120, 400, 700]) {
    assert.equal(isVenueLabelVisible({ x: width / 2, y, width, height: 844 }), false);
  }
  assert.equal(isVenueLabelVisible({ x: 640, y: 400, width: 1280, height: 720 }), true);
});

test('venue labels: desktop bounding boxes avoid title, toolbar/weather and lower side controls', () => {
  const visible = (x, y, options = {}) => isVenueLabelVisible({ x, y, width: 1280, height: 720, ...options });
  for (const [x, y] of [[220, 170], [350, 200], [1100, 150], [930, 150], [850, 150], [200, 630], [1100, 630]]) {
    assert.equal(visible(x, y), false, `label overlaps reserved HUD at ${x},${y}`);
  }
  assert.equal(visible(410, 240), true, 'clear of the left title edge');
  assert.equal(visible(930, 250), true, 'below the right toolbar');
  assert.equal(visible(640, 640), true, 'bottom center is not a side-control rectangle');
  assert.equal(visible(410, 240, { labelWidth: 220 }), false, 'actual larger label bounds, not just anchor, decide overlap');
});

test('venue labels: clipped/malformed anchors hide and a later unobstructed position becomes visible again', () => {
  const base = { x: 640, y: 380, width: 1280, height: 720 };
  for (const fields of [{ x: 20 }, { x: 1260 }, { y: 10 }, { y: 710 }, { clipZ: 1.1 }, { clipZ: -1.1 }, { x: NaN }, { height: 0 }]) {
    assert.equal(isVenueLabelVisible({ ...base, ...fields }), false);
  }
  assert.deepEqual([140, 400, 150, 400].map(y => isVenueLabelVisible({ ...base, x: 1100, y })), [false, true, false, true]);
  assert.equal(isVenueLabelVisible(base), true, 'overview -> follow remount has no permanently hidden state');
});
