import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { METRO_LAYOUT, METRO_ISLAND, metroSolid } from '../shared/metro-island.js';
import { MIDNIGHT_MS } from '../shared/dayNight.js';
import { createMetroIslandRuntime, createMetroRoute, sampleMetroTraffic, METRO_TRAFFIC_COUNT, METRO_ORIGIN } from '../src/components/metro/metroTraffic.js';

const base = new URL('../public/metro-island/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', base), 'utf8'));
const bytes = fs.readFileSync(new URL('city.glb', base));
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
const binaryOffset = 20 + bytes.readUInt32LE(12) + 8;
function fakeSource() {
  const scene = new THREE.Group(), geometry = new THREE.BoxGeometry(4, 6, 4);
  for (const name of ['metro-glass-blue', 'metro-window-lit-warm', 'metro-window-lit-cool', 'metro-architectural-light']) {
    const mat = new THREE.MeshStandardMaterial({ color: '#52626b' }); mat.name = name;
    const mesh = new THREE.Mesh(geometry, mat); mesh.name = name; scene.add(mesh);
  }
  return scene;
}

test('Blender GLB uses the same collision layout, bounded materials, meshes and original assets', () => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(new URL('../shared/metro-layout.json', import.meta.url))).digest('hex');
  assert.equal(manifest.layoutSha256, hash); assert.deepEqual(manifest.origin, METRO_ORIGIN);
  assert.equal(manifest.bytes, bytes.length); assert.ok(bytes.length < 12 * 1024 * 1024);
  const metadata = JSON.parse(fs.readFileSync(new URL('../shared/metro-asset.json', import.meta.url), 'utf8'));
  assert.equal(metadata.revision, crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16));
  assert.equal(metadata.revision, manifest.revision); assert.equal(metadata.bytes, bytes.length);
  assert.equal(manifest.buildings, 24);
  assert.deepEqual(manifest.buildingBounds, METRO_LAYOUT.buildings.map(({ id, x, z, width, depth, height }) => ({ id, x, z, width, depth, height })));
  assert.ok(gltf.meshes.length < 65); assert.ok(gltf.materials.length < 65); assert.ok(manifest.triangles < 300000);
  assert.equal(gltf.asset.generator.startsWith('Khronos glTF Blender'), true);
  assert.equal(manifest.editableSource, null);
  assert.equal(manifest.generatorSource, 'scripts/build-metro-island.py');
  assert.match(fs.readFileSync(new URL('../scripts/build-metro-island.py', import.meta.url), 'utf8'), /bpy\.ops\.wm\.save_as_mainfile/);
  assert.ok(manifest.editableSourceExcluded.includes('metadata'), 'editable binary exclusion is explicit, not an invented bundled asset');
  assert.ok(gltf.images.every(image => image.bufferView != null && !image.uri));
});

test('real exported positions are local Y-up, with zero extra sea, lights, cameras or animations', () => {
  assert.equal(gltf.cameras, undefined); assert.equal(gltf.animations, undefined);
  assert.ok(!gltf.extensionsUsed?.includes('KHR_lights_punctual'));
  assert.ok(!gltf.nodes.some(node => /ocean|skybox|camera|sun/i.test(node.name)));
  const bounds = gltf.meshes.flatMap(mesh => mesh.primitives.map(primitive => gltf.accessors[primitive.attributes.POSITION]));
  const min = [0, 1, 2].map(axis => Math.min(...bounds.map(b => b.min[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...bounds.map(b => b.max[axis])));
  assert.ok(Math.abs(min[0] + 140) < .01 && Math.abs(max[0] - 140) < .01);
  // The sea wall is exact; the irregular crowns may overhang it by < 0.5m.
  const wall = gltf.accessors[gltf.meshes.find(m => m.name === 'metro-seawall-stone-geometry').primitives[0].attributes.POSITION];
  assert.deepEqual(wall.min, [-140, -2.5, -110]);
  assert.ok(Math.abs(wall.max[2] - 110) < .01);
  assert.ok(min[2] >= -111.5 && max[2] <= 111.5);
  assert.ok(min[1] > -3 && max[1] > 139 && max[1] <= 140);
  assert.ok(gltf.nodes.every(node => !node.translation && !node.rotation && !node.scale), 'no concealed second origin or axis rotation');
});

test('route derives from shared roads; ten cars never drive into a building or off-road', () => {
  const route = createMetroRoute();
  assert.equal(METRO_TRAFFIC_COUNT, 10); assert.ok(route.getLength() > 400);
  for (let j = 0; j < 400; j++) {
    const { position, yaw } = sampleMetroTraffic(route, j * 1.9, j % 10);
    const x = position.x + METRO_ISLAND.x, z = position.z + METRO_ISLAND.z;
    assert.ok([x, z, yaw].every(Number.isFinite)); assert.equal(metroSolid(x, z), false);
    assert.ok(METRO_LAYOUT.roads.some(r => Math.abs(x - r.x) < r.width / 2 - 1 && Math.abs(z - r.z) < r.depth / 2 - 1));
  }
  assert.deepEqual(sampleMetroTraffic(route, NaN, 2).position.toArray(), sampleMetroTraffic(route, 0, 2).position.toArray());
});

test('night window light follows the shared clock, independent motion clock survives noon preview', () => {
  const source = fakeSource(), runtime = createMetroIslandRuntime(source);
  assert.deepEqual(runtime.group.position.toArray(), METRO_ORIGIN);
  runtime.update(0, { seconds: 4 });
  const window = runtime.city.children.find(node => node.material.name === 'metro-window-lit-warm').material;
  assert.equal(window.emissiveIntensity, 0);
  const before = [...runtime.traffic.children[0].instanceMatrix.array];
  runtime.update(0, { seconds: 9 });
  assert.notDeepEqual([...runtime.traffic.children[0].instanceMatrix.array], before);
  runtime.update(MIDNIGHT_MS, { seconds: 9 });
  assert.ok(window.emissiveIntensity >= .60 && window.emissiveIntensity <= .8);
  assert.equal(source.children[1].material.emissiveIntensity, 1, 'cached asset is not mutated');
  runtime.dispose();
});

test('facade daylight is coherent blue-grey; leaf crowns are fine alpha branchlets, not solid spheres', async () => {
  const source = fakeSource(), runtime = createMetroIslandRuntime(source);
  const glass = runtime.city.children.filter(node => /window|glass/.test(node.material.name));
  for (const node of glass) assert.deepEqual(node.material.color.toArray(), [.15, .23, .28]);
  const foliage = gltf.materials.filter(m => /foliage/.test(m.name));
  assert.equal(foliage.length, 3);
  for (const m of foliage) { assert.ok(m.pbrMetallicRoughness.baseColorTexture); assert.equal(m.doubleSided, true); assert.ok(m.alphaMode); }
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(fileURLToPath(new URL('metro-original-fine-branchlets.png', base))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0, solid = 0;
  for (let i = 3; i < data.length; i += info.channels) { if (data[i] < 10) clear++; if (data[i] > 245) solid++; }
  assert.ok(clear / (info.width * info.height) > .60); assert.ok(solid > 1500);
  runtime.dispose();
});

test('actual GLB leaf vertices form independent coplanar branchlet quads, never closed crown shells', () => {
  for (const mesh of gltf.meshes.filter(m => /foliage-(light|sage)-geometry/.test(m.name))) {
    const primitive = mesh.primitives[0];
    const accessor = gltf.accessors[primitive.attributes.POSITION], view = gltf.bufferViews[accessor.bufferView];
    const positions = new Float32Array(bytes.buffer, bytes.byteOffset + binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0), accessor.count * 3);
    assert.equal(accessor.count % 4, 0);
    let cards = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
    for (let k = 0; k < accessor.count; k += 4) {
      a.fromArray(positions, k * 3); b.fromArray(positions, (k + 1) * 3); c.fromArray(positions, (k + 2) * 3); d.fromArray(positions, (k + 3) * 3);
      assert.ok(a.distanceTo(b) > .4 && a.distanceTo(b) < 1.4);
      assert.ok(a.distanceTo(d) > .7 && a.distanceTo(d) < 1.5);
      const plane = new THREE.Plane().setFromCoplanarPoints(a, b, c);
      assert.ok(Math.abs(plane.distanceToPoint(d)) < .00003);
      cards++;
    }
    assert.ok(cards > 2000);
  }
});

test('reduced motion freezes traffic, every matrix stays finite, no second scene owners', () => {
  const runtime = createMetroIslandRuntime(fakeSource());
  runtime.update(0, { seconds: 10 });
  const before = [...runtime.traffic.children[0].instanceMatrix.array];
  runtime.update(MIDNIGHT_MS, { seconds: 5000, reducedMotion: true });
  assert.deepEqual([...runtime.traffic.children[0].instanceMatrix.array], before);
  runtime.update(Infinity, { seconds: NaN });
  runtime.group.traverse(node => {
    assert.ok(!node.isLight && !node.isCamera);
    if (node.isInstancedMesh) assert.ok([...node.instanceMatrix.array].every(Number.isFinite));
  });
  assert.equal(runtime.budget.addedDrawCalls, 5); assert.ok(manifest.meshes + runtime.budget.addedDrawCalls < 80);
  assert.ok(manifest.triangles + runtime.budget.trafficTriangles < 300000);
  runtime.dispose();
});

test('disposal releases local GPU resources exactly once, leaving cached GLB geometry and textures alive', () => {
  const source = fakeSource(), runtime = createMetroIslandRuntime(source);
  let sourceGeometryDisposals = 0, sourceMaterialDisposals = 0, localMaterialDisposals = 0, localGeometryDisposals = 0;
  source.children[0].geometry.addEventListener('dispose', () => sourceGeometryDisposals++);
  for (const node of source.children) node.material.addEventListener('dispose', () => sourceMaterialDisposals++);
  for (const material of runtime.materials.values()) material.addEventListener('dispose', () => localMaterialDisposals++);
  for (const node of runtime.traffic.children) node.geometry.addEventListener('dispose', () => localGeometryDisposals++);
  runtime.dispose(); runtime.dispose();
  assert.equal(sourceGeometryDisposals, 0); assert.equal(sourceMaterialDisposals, 0);
  assert.equal(localMaterialDisposals, source.children.length); assert.equal(localGeometryDisposals, 5);
  assert.equal(runtime.group.children.length, 0);
});
