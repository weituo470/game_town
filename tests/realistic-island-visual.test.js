import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { REALISTIC_ISLAND as I, ISLAND_TRAIL, islandHeight, islandSlope } from '../shared/realistic-island.js';
import { createRealisticIslandVisual, createIslandLeafTexture, createIslandPlanting, ISLAND_VISUAL_QUALITY } from '../src/components/island/realisticIslandVisual.js';

test('island terrain samples the exact shared world heightfield, with one world transform', () => {
  const visual = createRealisticIslandVisual();
  const terrain = visual.group.getObjectByName('realistic-island-shared-heightfield');
  assert.deepEqual(visual.group.position.toArray(), [I.x, 0, I.z]);
  const p = terrain.geometry.attributes.position;
  for (let i = 0; i < p.count; i += 23) assert.ok(Math.abs(p.getY(i) - islandHeight(I.x + p.getX(i), I.z + p.getZ(i))) < .000003);
  assert.ok(p.count > 20000); assert.ok(terrain.geometry.attributes.islandSurface);
  visual.dispose();
});

test('forest is deterministic, avoids open beach, inaccessible cliffs and hiking route', () => {
  const high = createIslandPlanting();
  assert.deepEqual(high, createIslandPlanting());
  assert.equal(high.trees.length, ISLAND_VISUAL_QUALITY.high.trees);
  for (const p of high.trees) {
    assert.ok(p.y > 4.4 && p.y < 28.5); assert.ok(islandSlope(p.x, p.z) < .64);
    assert.ok(ISLAND_TRAIL.every(t => Math.hypot(t.x - p.x, t.z - p.z) > 4));
  }
  assert.ok(createIslandPlanting('low').trees.length < high.trees.length);
});

test('both quality tiers retain a bounded instanced visual budget without a second sea or scene owner', () => {
  const high = createRealisticIslandVisual(), low = createRealisticIslandVisual({ quality: 'low' });
  assert.ok(high.budget.triangles <= 160000, JSON.stringify(high.budget)); assert.ok(high.budget.drawCalls <= 25);
  assert.ok(low.budget.triangles < high.budget.triangles * .65);
  const names = []; high.group.traverse(node => { names.push(node.name); assert.equal(!!node.isCamera, false); assert.equal(!!node.isLight, false); });
  assert.ok(!names.some(name => /ocean|skybox|whole-sea/.test(name)));
  assert.ok(high.group.getObjectByName('fine-cutout-coastal-leaf-sprays').isInstancedMesh);
  assert.ok(high.group.getObjectByName('coastal-tree-trunks-and-tapered-branches').isInstancedMesh);
  high.dispose(); low.dispose();
});

test('original alpha leaves contain fine-cutout margins and a solid vein rather than ball/cone crowns', () => {
  const texture = createIslandLeafTexture();
  assert.equal(texture.image.width, 128); assert.equal(texture.image.height, 128);
  const data = texture.image.data; let clear = 0, solid = 0;
  for (let i = 3; i < data.length; i += 4) { if (data[i] < 10) clear++; if (data[i] > 245) solid++; }
  assert.ok(clear > 6000 && solid > 3000); assert.equal(texture.colorSpace, THREE.SRGBColorSpace); texture.dispose();
});

test('aerial mip alpha retains foliage and daylight cannot turn untinted trunks and grass white', () => {
  const visual = createRealisticIslandVisual();
  const leaves = visual.group.getObjectByName('fine-cutout-coastal-leaf-sprays');
  const bark = visual.group.getObjectByName('coastal-tree-trunks-and-tapered-branches');
  const grass = visual.group.getObjectByName('wind-shaped-dune-grass');
  const data = leaves.material.map.image.data;
  let totalAlpha = 0;
  for (let i = 3; i < data.length; i += 4) totalAlpha += data[i] / 255;
  assert.ok(totalAlpha / (data.length / 4) > leaves.material.alphaTest * 1.25);
  assert.ok(leaves.material.alphaTest <= .2); assert.ok(leaves.material.color.g > leaves.material.color.r);
  assert.ok(bark.material.color.r < .2 && bark.material.color.b < bark.material.color.r);
  assert.ok(grass.material.color.g > grass.material.color.b * 2);
  assert.ok(leaves.count >= 2100);
  visual.dispose();
});

test('landing and overlook use a warm nonwhite timber base and original directional grain', () => {
  const visual = createRealisticIslandVisual();
  const wood = visual.group.getObjectByName('terrain-following-wood-landing-and-overlook').material;
  assert.ok(wood.color.r > wood.color.g && wood.color.g > wood.color.b);
  assert.ok(wood.color.r < .5 && wood.color.b < .1);
  assert.equal(wood.metalness, 0); assert.ok(wood.roughness >= .9);
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  wood.onBeforeCompile(shader, null);
  assert.ok(shader.fragmentShader.includes('islandWoodGrain')); assert.ok(shader.vertexShader.includes('instanceMatrix*islandWoodP'));
  visual.dispose();
});

test('all matrices, normals and vertices stay finite including interrupted wind and reduced motion', () => {
  const visual = createRealisticIslandVisual();
  for (const value of [0, 10000, NaN, Infinity]) visual.update(value);
  visual.update(10000, { reducedMotion: true });
  visual.group.traverse(node => {
    if (!node.isMesh) return;
    for (const attr of Object.values(node.geometry.attributes)) for (const n of attr.array) assert.ok(Number.isFinite(n), node.name);
    if (node.isInstancedMesh) for (const n of node.instanceMatrix.array) assert.ok(Number.isFinite(n), node.name);
  });
  visual.dispose();
});

test('procedural material hooks expand current Three standard chunks and release every local GPU resource once', () => {
  const visual = createRealisticIslandVisual(), geometries = new Set(), materials = new Set(), textures = new Set();
  visual.group.traverse(node => { if (node.isMesh) { geometries.add(node.geometry); materials.add(node.material); if (node.material.map) textures.add(node.material.map); } });
  let g = 0, m = 0, t = 0;
  geometries.forEach(v => v.addEventListener('dispose', () => g++)); materials.forEach(v => v.addEventListener('dispose', () => m++)); textures.forEach(v => v.addEventListener('dispose', () => t++));
  for (const material of materials) {
    const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
    material.onBeforeCompile(shader, null);
    assert.ok(shader.vertexShader.includes('void main()')); assert.ok(shader.fragmentShader.includes('void main()'));
    assert.ok(!shader.vertexShader.includes('undefined')); assert.ok(!shader.fragmentShader.includes('undefined'));
  }
  visual.dispose(); visual.dispose(); assert.equal(g, geometries.size); assert.equal(m, materials.size); assert.equal(t, textures.size); assert.equal(visual.group.children.length, 0);
});
