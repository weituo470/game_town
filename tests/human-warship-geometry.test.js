import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createHumanWarshipGeometry, createHumanWarshipEngineGeometry } from '../src/components/drone/humanWarshipGeometry.js';

test('detailed cruiser and engine geometries keep a two-draw instancing contract with compatible attributes', () => {
  const hull = createHumanWarshipGeometry(), engine = createHumanWarshipEngineGeometry();
  for (const geometry of [hull, engine]) {
    assert.equal(geometry.index, null);
    assert.deepEqual(Object.keys(geometry.attributes).sort(), ['color', 'normal', 'position', 'uv']);
    for (const name of ['normal', 'color', 'uv']) assert.equal(geometry.attributes[name].count, geometry.attributes.position.count);
    for (const attribute of Object.values(geometry.attributes)) assert.ok(Array.from(attribute.array).every(Number.isFinite));
    assert.equal(geometry.groups.length, 0, 'no sub-material draw calls');
    const normal = geometry.attributes.normal;
    for (let i = 0; i < normal.count; i++) {
      assert.ok(Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) < .0001);
    }
  }
  const combined = mergeGeometries([hull, engine], false);
  assert.ok(combined?.isBufferGeometry);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  const batch = new THREE.InstancedMesh(hull, material, 216);
  assert.equal(batch.count, 216);
  batch.dispose(); material.dispose(); combined.dispose(); hull.dispose(); engine.dispose();
});

test('cruiser stays inside choreography bounds and has a long pointed prow and raised bridge silhouette', () => {
  const hull = createHumanWarshipGeometry(), engine = createHumanWarshipEngineGeometry();
  for (const geometry of [hull, engine]) {
    const b = geometry.boundingBox;
    assert.ok(b.min.x >= -5.5 && b.max.x <= 6.001);
    assert.ok(b.min.z >= -2.8 && b.max.z <= 2.8);
    assert.ok(b.min.y >= -1.1 && b.max.y <= 2.5);
  }
  assert.ok(hull.boundingBox.max.y > 2.1, 'mast and bridge distinguish the top silhouette');
  assert.ok(hull.boundingBox.min.y < -.9, 'armoured ventral keel is not a flat boat deck');
  const p = hull.attributes.position;
  let prowCount = 0;
  for (let i = 0; i < p.count; i++) if (p.getX(i) >= 5.99) {
    prowCount++;
    assert.ok(Math.abs(p.getZ(i)) < .04 && Math.abs(p.getY(i)) < .03, 'spear nose tapers in both axes');
  }
  assert.ok(prowCount > 0);
  hull.dispose(); engine.dispose();
});

test('hull has physically separate pale armour, steel chamfers, deep seams and four dark engine chambers', () => {
  const hull = createHumanWarshipGeometry(), engine = createHumanWarshipEngineGeometry();
  const colors = hull.attributes.color, p = hull.attributes.position, distinct = new Set(), engineChambers = new Set();
  for (let i = 0; i < colors.count; i++) {
    distinct.add([colors.getX(i), colors.getY(i), colors.getZ(i)].map(n => n.toFixed(5)).join(','));
    if (p.getX(i) < -5.25 && Math.max(colors.getX(i), colors.getY(i), colors.getZ(i)) < .02) {
      engineChambers.add(`${p.getY(i) < 0 ? 'low' : 'high'}-${p.getZ(i) < 0 ? 'port' : 'starboard'}`);
    }
  }
  assert.ok(distinct.size >= 6);
  assert.equal(engineChambers.size, 4);
  assert.ok(engine.boundingBox.max.y > 1.6, 'glazing is part of the emissive batch');
  hull.dispose(); engine.dispose();
});

test('detailed ship remains below the 2500-triangle combined fleet budget without textures or lights', () => {
  const hull = createHumanWarshipGeometry(), engine = createHumanWarshipEngineGeometry();
  const hullTriangles = hull.attributes.position.count / 3, engineTriangles = engine.attributes.position.count / 3;
  assert.ok(hullTriangles > 600, 'real silhouette modelling replaces the old few boxes');
  assert.ok(hullTriangles + engineTriangles < 2500, `${hullTriangles + engineTriangles} triangles per ship`);
  assert.equal(hull.userData.triangleCount, hullTriangles);
  assert.equal(engine.userData.triangleCount, engineTriangles);
  hull.dispose(); engine.dispose();
});
