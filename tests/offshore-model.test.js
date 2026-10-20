import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createOffshoreIsland, createOffshoreDock, OFFSHORE_MODEL_SPEC } from '../src/components/offshore/createOffshoreIsland.js';
import { OFFSHORE_DOCK, OFFSHORE_BRIDGE, OFFSHORE_ISLAND, OFFSHORE_SEATS, offshoreSeatLocal } from '../shared/offshore-island.js';

const ray = (group, origin, direction, far = 100) => {
  group.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize(), 0, far).intersectObject(group, true).filter(hit => hit.object.isMesh && hit.object.visible && !hit.object.name.includes('wake'));
};

test('ship and dock batch detailed structure within the combined GPU budget without extra renderers', () => {
  const boat = createOffshoreIsland(), dock = createOffshoreDock(), spec = OFFSHORE_MODEL_SPEC;
  assert.ok(boat.statistics.drawCalls + dock.statistics.drawCalls <= spec.drawCallBudget);
  assert.ok(boat.statistics.triangles + dock.statistics.triangles <= spec.triangleBudget);
  assert.ok(boat.statistics.triangles > 10000, 'keep recognizable research-platform detail');
  for (const model of [boat, dock]) {
    let triangles = 0, calls = 0;
    model.group.traverse(node => {
      assert.equal(Boolean(node.isLight || node.isCamera), false);
      if (!node.isMesh && !node.isPoints) return;
      calls++; assert.ok(node.geometry.attributes.position.array.every(Number.isFinite));
      if (node.isMesh) triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    });
    assert.equal(triangles, model.statistics.triangles); assert.equal(calls, model.statistics.drawCalls);
    assert.deepEqual(model.group.position.toArray(), [0, 0, 0]); model.dispose();
  }
});

test('semi-submersible has two long green floats, four supported white columns and a truly open moon pool', () => {
  const model = createOffshoreIsland(), spec = OFFSHORE_MODEL_SPEC;
  assert.equal(spec.length, OFFSHORE_ISLAND.length); assert.equal(spec.width, OFFSHORE_ISLAND.width); assert.equal(spec.deckY, OFFSHORE_ISLAND.deckY);
  const hull = model.group.getObjectByName('offshore-deep-green-pontoons'); hull.geometry.computeBoundingBox();
  assert.ok(Math.abs(hull.geometry.boundingBox.min.z + 19) < .01 && Math.abs(hull.geometry.boundingBox.max.z - 19) < .01);
  for (const x of [-9, 9]) for (const z of [-16, 16]) {
    const hit = ray(model.group, [x, 2, z], [0, -1, 0], 5)[0]; assert.ok(hit); assert.equal(hit.object, hull); assert.ok(Math.abs(hit.point.y - .4) < .01);
  }
  for (const x of [-9, 9]) for (const z of [-11.3, 11.3]) {
    const hit = ray(model.group, [x, 7, z], [0, -1, 0], 6)[0]; assert.ok(hit || ray(model.group, [x + 3.3, 5, z], [-1, 0, 0], 1).length > 0);
  }
  for (const [x, z] of [[0, 1.3], [1.3, 1.3], [-1.3, 1.3], [0, -3]]) {
    const hits = ray(model.group, [x, 7.9, z], [0, -1, 0], 9); assert.equal(hits.length, 0, `${x}/${z} month pool must not be a painted green deck`);
  }
  const tower = model.group.getObjectByName('offshore-signal-red-lattice'); tower.geometry.computeBoundingBox();
  assert.ok(Math.abs(tower.geometry.boundingBox.max.y - 31) < .001); model.dispose();
});

test('all eight authoritative passenger seats have a clear 2m headspace and a readable bow view', () => {
  const model = createOffshoreIsland();
  assert.equal(OFFSHORE_SEATS, 8);
  for (let seat = 0; seat < OFFSHORE_SEATS; seat++) {
    const p = offshoreSeatLocal(seat); assert.equal(p.x, -8); assert.equal(p.z, 4 + seat); assert.equal(p.y, 8);
    for (const dx of [-.25, 0, .25]) {
      assert.equal(ray(model.group, [p.x + dx, p.y + .08, p.z], [0, 1, 0], 2.05).length, 0, `seat ${seat} headroom`);
      const floor = ray(model.group, [p.x + dx, p.y + .05, p.z], [0, -1, 0], .2)[0]; assert.ok(floor); assert.ok(Math.abs(floor.point.y - 8) < .01);
    }
  }
  assert.equal(ray(model.group, [-8, 10.6, 11], [-.7, -1.1, 59], 15).length, 0, 'deck camera sees ahead, not through a cabin');
  model.dispose();
});

test('hull dimensions and roofline fit the shared observation-camera envelope', () => {
  const model = createOffshoreIsland(); let bounds = new THREE.Box3();
  for (const mesh of model.group.children) if (mesh.isMesh && !mesh.name.includes('wake')) { mesh.geometry.computeBoundingBox(); bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix)); }
  assert.ok(bounds.min.x >= -13.05 && bounds.max.x <= 13.05);
  assert.ok(bounds.min.z >= -19.05 && bounds.max.z <= 19.05);
  assert.ok(bounds.min.y >= -2.16 && bounds.max.y <= 31.001);
  assert.ok(model.group.getObjectByName('offshore-rescue-orange').geometry.attributes.position.count > 1000);
  assert.ok(model.group.getObjectByName('offshore-H-landing-mark')); model.dispose();
});

test('port/starboard/forward Chinese panels face outward and their UVs never mirror the text', () => {
  const model = createOffshoreIsland(), geometry = model.group.getObjectByName('offshore-readable-nameplates').geometry;
  const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
  const groups = { port: [], starboard: [], bow: [] };
  for (let i = 0; i < p.count; i++) { const name = n.getX(i) < -.9 ? 'port' : n.getX(i) > .9 ? 'starboard' : 'bow'; groups[name].push({ x: p.getX(i), z: p.getZ(i), u: uv.getX(i), nz: n.getZ(i) }); }
  for (const [name, points] of Object.entries(groups)) {
    assert.ok(points.length >= 6); const left = points.filter(p => p.u < .01), right = points.filter(p => p.u > .99);
    const average = (data, axis) => data.reduce((sum, p) => sum + p[axis], 0) / data.length;
    if (name === 'port') assert.ok(average(right, 'z') > average(left, 'z'));
    if (name === 'starboard') assert.ok(average(right, 'z') < average(left, 'z'));
    if (name === 'bow') { assert.ok(points.every(p => p.nz > .9)); assert.ok(average(right, 'x') > average(left, 'x')); }
  }
  model.dispose();
});

test('ordinary Chinese nameplates and H markings are drawn once with system fonts, without a school emblem', () => {
  const originalDocument = globalThis.document, draws = [], canvases = [];
  try {
    globalThis.document = { createElement: kind => { assert.equal(kind, 'canvas'); const ctx = { fillRect() {}, beginPath() {}, arc() {}, stroke() {}, fillText(text) { draws.push({ text, font: this.font }); } }; const canvas = { getContext: type => { assert.equal(type, '2d'); return ctx; } }; canvases.push(canvas); return canvas; } };
    const boat = createOffshoreIsland(), dock = createOffshoreDock();
    assert.equal(canvases.length, 3);
    assert.deepEqual(draws.map(draw => draw.text), ['上海交通大学', '远海浮动岛', 'H', '上海交通大学', '远海浮动岛']);
    assert.ok(draws.filter(draw => draw.text !== 'H').every(draw => draw.font.includes('Microsoft YaHei')));
    boat.dispose(); dock.dispose();
  } finally { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; }
});

test('dock stays at shared world coordinates while the moving ship is independently positioned', () => {
  const boat = createOffshoreIsland(), dock = createOffshoreDock();
  for (const [point, expected] of [[[OFFSHORE_DOCK.x, 5, OFFSHORE_DOCK.z + 3], 0], [[OFFSHORE_BRIDGE.x, 5, OFFSHORE_BRIDGE.z - 3], -.02]]) {
    const hit = ray(dock.group, point, [0, -1, 0], 8)[0]; assert.ok(hit); assert.ok(Math.abs(hit.point.y - expected) < .001);
  }
  const dockBefore = dock.group.children.map(mesh => mesh.geometry.attributes.position.array.slice());
  boat.group.position.set(200, .2, 300); boat.group.rotation.set(.002, 1, .003); boat.update(15000, { speed: 2, progress: .3 });
  dock.update(15000, { night: .5 });
  assert.deepEqual(dock.group.position.toArray(), [0, 0, 0]);
  dock.group.children.forEach((mesh, index) => assert.deepEqual(mesh.geometry.attributes.position.array, dockBefore[index]));
  boat.dispose(); dock.dispose();
});

test('wake and bow spray appear only underway, seek deterministically and reuse their fixed buffers', () => {
  const model = createOffshoreIsland(), wake = model.group.getObjectByName('offshore-stern-wake'), spray = model.group.getObjectByName('offshore-bow-spray');
  assert.equal(wake.visible, false); assert.equal(spray.visible, false);
  const uniforms = wake.material.uniforms, buffer = spray.geometry.attributes.position.array;
  model.update(12000, { speed: 2.5, progress: .2, night: .7 }); assert.equal(wake.visible, true); assert.equal(spray.visible, true); assert.ok(uniforms.uSpeed.value > 0); assert.equal(uniforms.uNight.value, .7);
  const snapshot = buffer.slice(); model.update(30000, { speed: 6 }); model.update(12000, { speed: 2.5, progress: .2, night: .7 }); assert.deepEqual(buffer, snapshot);
  assert.equal(spray.geometry.attributes.position.array, buffer); assert.equal(wake.material.uniforms, uniforms);
  model.update(130000, { speed: 2, progress: .9 }); assert.equal(wake.position.z, 34); assert.equal(wake.rotation.z, Math.PI);
  assert.ok(Array.from(buffer).filter((_, i) => i % 3 === 2).every(value => value < 0), 'stern-first approach reverses wake/spray rather than leaving foam ahead of travel');
  for (const options of [{ speed: 3, stationary: true }, { speed: 3, reducedMotion: true }, { speed: 0 }, { speed: NaN }]) { model.update(16000, options); assert.equal(wake.visible, false); assert.equal(spray.visible, false); }
  model.dispose();
});

test('all merged geometries, materials and procedural textures are owned and disposed exactly once', () => {
  for (const make of [createOffshoreIsland, createOffshoreDock]) {
    const model = make(), geometries = new Set(), materials = new Set(), textures = new Set();
    let gd = 0, md = 0, td = 0;
    model.group.traverse(mesh => { if (!mesh.geometry) return; geometries.add(mesh.geometry); materials.add(mesh.material); for (const value of Object.values(mesh.material)) if (value?.isTexture) textures.add(value); });
    for (const value of geometries) value.addEventListener('dispose', () => gd++);
    for (const value of materials) value.addEventListener('dispose', () => md++);
    for (const value of textures) value.addEventListener('dispose', () => td++);
    model.dispose(); model.dispose(); assert.equal(gd, geometries.size); assert.equal(md, materials.size); assert.equal(td, textures.size); assert.equal(model.group.children.length, 0); assert.equal(model.update(1), null);
  }
});

test('source stays procedural and uses no private animation, font download or external model asset', () => {
  const source = fs.readFileSync(new URL('../src/components/offshore/createOffshoreIsland.js', import.meta.url), 'utf8');
  const shader = fs.readFileSync(new URL('../src/components/offshore/offshoreShaders.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source + shader, /requestAnimationFrame|setInterval|fetch\(|FontLoader|TextureLoader|GLTFLoader|https?:\/\//);
  assert.match(source, /mergeGeometries/); assert.match(source, /OFFSHORE_DOCK/); assert.match(source, /offshoreSeatLocal/);
});
