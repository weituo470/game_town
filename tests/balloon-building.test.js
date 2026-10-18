import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BALLOON_SPEC, createBalloonGameStall } from '../src/components/town/buildings/createBalloonGameStall.js';

function inventory(group) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  let drawCalls = 0, triangles = 0;
  group.traverse(object => {
    if (!object.isMesh) return;
    drawCalls++;
    geometries.add(object.geometry);
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    for (const material of [].concat(object.material)) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  return { geometries, materials, textures, drawCalls, triangles };
}

function snapshot(group) {
  const objects = [];
  group.traverse(object => objects.push({
    name: object.name, p: object.position.toArray(), q: object.quaternion.toArray(),
    s: object.scale.toArray(), intensity: object.material?.emissiveIntensity,
  }));
  return JSON.stringify({ objects, elapsed: group.userData.elapsed });
}

test('balloon stall exposes a named standalone factory contract', () => {
  const a = createBalloonGameStall();
  try {
    assert.ok(a.group.isGroup);
    assert.equal(a.group.name, 'BalloonGameStallAsset');
    assert.deepEqual(a.group.userData.spec, BALLOON_SPEC);
    assert.equal(a.group.userData.stats, a.stats);
    assert.equal(a.group.userData.elapsed, 0);
    assert.equal(typeof a.update, 'function');
    assert.equal(typeof a.dispose, 'function');
    assert.ok(Object.isFrozen(BALLOON_SPEC));
    assert.equal(BALLOON_SPEC.reference, '气球射击摊_多视图.jpg');
  } finally { a.dispose(); }
});

test('balloon stall has finite mesh attributes and complete 3D surfaces', () => {
  const a = createBalloonGameStall();
  try {
    a.group.traverse(object => {
      if (!object.isMesh) return;
      assert.ok(object.geometry.attributes.normal);
      assert.ok(object.geometry.attributes.uv);
      for (const attribute of Object.values(object.geometry.attributes)) {
        for (const value of attribute.array) assert.ok(Number.isFinite(value));
      }
      object.geometry.computeBoundingBox();
      const size = object.geometry.boundingBox.getSize(new THREE.Vector3());
      assert.ok(size.x > 0 && size.y > 0 && size.z > 0);
      assert.equal(object.material.side, THREE.FrontSide);
      assert.equal(object.material.transparent, false);
    });
  } finally { a.dispose(); }
});

test('balloon stall rests on Y=0 and remains inside its documented animated envelope', () => {
  const a = createBalloonGameStall();
  try {
    for (let i = 0; i < 400; i++) {
      a.update(0.05);
      if (i % 40 !== 0) continue;
      a.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(a.group);
      assert.ok(Math.abs(box.min.y) < 1e-5, 'base is grounded without a sunken decorative part');
      assert.ok(box.min.x >= -BALLOON_SPEC.width / 2 && box.max.x <= BALLOON_SPEC.width / 2);
      assert.ok(box.min.z >= -BALLOON_SPEC.depth / 2 && box.max.z <= BALLOON_SPEC.depth / 2);
      assert.ok(box.max.y <= BALLOON_SPEC.height);
      assert.ok(box.max.y > 8.5, 'roof balloons remain part of the silhouette');
    }
  } finally { a.dispose(); }
});

test('balloon stall reports actual geometry budgets without hidden textures or light spam', () => {
  const a = createBalloonGameStall();
  try {
    const actual = inventory(a.group);
    assert.equal(actual.drawCalls, a.stats.drawCalls);
    assert.equal(actual.triangles, a.stats.triangles);
    assert.equal(actual.geometries.size, a.stats.geometries);
    assert.equal(actual.materials.size, a.stats.materials);
    assert.equal(actual.textures.size, a.stats.textures);
    assert.ok(actual.drawCalls <= BALLOON_SPEC.drawCallBudget);
    assert.ok(actual.triangles <= BALLOON_SPEC.triangleBudget);
    assert.equal(actual.textures.size, 0);
    assert.equal(a.stats.pointLights, 0);
    assert.ok(a.stats.partCount > 300);
    a.group.traverse(object => {
      assert.ok(!object.isSprite, 'not a billboard facade');
      if (object.isMesh) assert.ok(!Array.isArray(object.material), 'one batch per material');
    });
  } finally { a.dispose(); }
});

test('only roof balloon bouquet transforms while bulbs breathe softly', () => {
  const a = createBalloonGameStall();
  try {
    const bouquet = a.group.getObjectByName('BalloonBouquet');
    assert.ok(bouquet?.isGroup);
    const staticPoses = new Map();
    a.group.traverse(object => { if (object !== bouquet) staticPoses.set(object, [object.position.toArray(), object.quaternion.toArray(), object.scale.toArray()]); });
    const bulb = [...inventory(a.group).materials].find(material => material.name.endsWith('-bulb'));
    const initialIntensity = bulb.emissiveIntensity;
    for (let i = 0; i < 30; i++) a.update(1 / 60);
    assert.notEqual(bouquet.rotation.z, 0);
    assert.notEqual(bulb.emissiveIntensity, initialIntensity);
    assert.ok(bulb.emissiveIntensity >= 0.675 && bulb.emissiveIntensity <= 0.765);
    for (const [object, pose] of staticPoses) assert.deepEqual([object.position.toArray(), object.quaternion.toArray(), object.scale.toArray()], pose);
  } finally { a.dispose(); }
});

test('reduced motion freezes transforms, glow and elapsed time exactly', () => {
  const a = createBalloonGameStall();
  try {
    a.update(0.04);
    const before = snapshot(a.group);
    for (let i = 0; i < 20; i++) a.update(0.04, true);
    assert.equal(snapshot(a.group), before);
    a.update(0.04, false);
    assert.notEqual(snapshot(a.group), before);
  } finally { a.dispose(); }
});

test('invalid deltas do not change state and long frames are clamped', () => {
  const a = createBalloonGameStall();
  try {
    const before = snapshot(a.group);
    for (const invalid of [undefined, null, NaN, Infinity, -Infinity, 0, -1, '0.02']) a.update(invalid);
    assert.equal(snapshot(a.group), before);
    a.update(20);
    assert.equal(a.group.userData.elapsed, 0.05);
  } finally { a.dispose(); }
});

test('instances own separate mesh, geometry, material and animation state', () => {
  const a = createBalloonGameStall(), b = createBalloonGameStall();
  try {
    const ar = inventory(a.group), br = inventory(b.group);
    assert.notEqual(a.group, b.group);
    for (const geometry of ar.geometries) assert.ok(!br.geometries.has(geometry));
    for (const material of ar.materials) assert.ok(!br.materials.has(material));
    a.update(0.05);
    assert.equal(b.group.userData.elapsed, 0);
    assert.equal(b.group.getObjectByName('BalloonBouquet').rotation.z, 0);
    a.dispose();
    b.update(0.04);
    assert.equal(b.group.userData.elapsed, 0.04);
  } finally { a.dispose(); b.dispose(); }
});

test('dispose releases every owned GPU resource exactly once and detaches the asset', () => {
  const a = createBalloonGameStall();
  const parent = new THREE.Group(); parent.add(a.group);
  const resources = inventory(a.group), counts = new Map();
  for (const resource of [...resources.geometries, ...resources.materials, ...resources.textures]) {
    counts.set(resource, 0);
    resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  }
  const before = snapshot(a.group);
  a.dispose(); a.dispose(); a.update(0.05);
  assert.equal(a.group.parent, null);
  for (const count of counts.values()) assert.equal(count, 1);
  assert.equal(snapshot(a.group), before);
  const next = createBalloonGameStall();
  try { assert.deepEqual(next.stats, a.stats); next.update(0.05); assert.equal(next.group.userData.elapsed, 0.05); }
  finally { next.dispose(); }
});

test('React wrapper allocates during commit and cleans up for StrictMode remounts', () => {
  const source = readFileSync(new URL('../src/components/town/buildings/BalloonGameStall.jsx', import.meta.url), 'utf8');
  assert.match(source, /useLayoutEffect\(\(\) => \{/);
  assert.match(source, /const parent = host\.current;[\s\S]*const stall = createBalloonGameStall\(\);/);
  assert.match(source, /parent\.remove\(stall\.group\);[\s\S]*stall\.dispose\(\);/);
  assert.match(source, /useFrame\(\(_, delta\) => asset\.current\?\.update\(delta, reducedMotion\)\)/);
  assert.match(source, /dispose=\{null\}/);
  assert.doesNotMatch(source, /useMemo|useState/);
});
