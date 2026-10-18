import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { TICKET_SPEC, createPurpleTicketBooth } from '../src/components/town/buildings/createPurpleTicketBooth.js';

function resources(group) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  let drawCalls = 0, triangles = 0;
  group.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry); drawCalls++;
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    for (const material of [].concat(object.material)) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  return { geometries, materials, textures, drawCalls, triangles };
}

function snapshot(group) {
  const poses = [];
  group.traverse(object => poses.push([object.name, object.position.toArray(), object.quaternion.toArray(), object.scale.toArray(), object.material?.emissiveIntensity]));
  return JSON.stringify([group.userData.elapsed, poses]);
}

test('ticket booth exposes standalone factory and documented footprint', () => {
  const a = createPurpleTicketBooth();
  try {
    assert.equal(a.group.name, 'PurpleTicketBoothAsset'); assert.ok(a.group.isGroup);
    assert.equal(a.group.userData.stats, a.stats); assert.equal(a.group.userData.spec, TICKET_SPEC);
    assert.equal(a.group.userData.elapsed, 0); assert.equal(typeof a.update, 'function'); assert.equal(typeof a.dispose, 'function');
    assert.ok(Object.isFrozen(TICKET_SPEC)); assert.equal(TICKET_SPEC.reference, '紫色售票亭_三视图.jpg');
  } finally { a.dispose(); }
});

test('ticket booth has finite, opaque, correctly budgeted dimensional geometry', () => {
  const a = createPurpleTicketBooth();
  try {
    const r = resources(a.group);
    assert.equal(r.drawCalls, a.stats.drawCalls); assert.equal(r.triangles, a.stats.triangles);
    assert.equal(r.geometries.size, a.stats.geometries); assert.equal(r.materials.size, a.stats.materials);
    assert.ok(r.drawCalls <= TICKET_SPEC.drawCallBudget); assert.ok(r.triangles <= TICKET_SPEC.triangleBudget);
    assert.equal(r.textures.size, 0); assert.equal(a.stats.pointLights, 0);
    a.group.traverse(object => {
      assert.ok(!object.isSprite);
      if (!object.isMesh) return;
      assert.equal(object.material.side, THREE.FrontSide); assert.equal(object.material.transparent, false);
      assert.ok(object.geometry.attributes.normal); assert.ok(object.geometry.attributes.uv);
      for (const attribute of Object.values(object.geometry.attributes)) for (const value of attribute.array) assert.ok(Number.isFinite(value));
    });
  } finally { a.dispose(); }
});

test('ticket booth is grounded and remains in its bounds through sign movement', () => {
  const a = createPurpleTicketBooth();
  try {
    for (let i = 0; i < 400; i++) {
      a.update(0.05); if (i % 40) continue;
      a.group.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(a.group);
      assert.ok(Math.abs(b.min.y) < 1e-5);
      assert.ok(b.min.x >= -TICKET_SPEC.width / 2 && b.max.x <= TICKET_SPEC.width / 2);
      assert.ok(b.min.z >= -TICKET_SPEC.depth / 2 && b.max.z <= TICKET_SPEC.depth / 2);
      assert.ok(b.max.y <= TICKET_SPEC.height); assert.ok(b.max.y > 6.7);
    }
  } finally { a.dispose(); }
});

test('service window has real depth and no disguised flat facade across its centre', () => {
  const a = createPurpleTicketBooth();
  try {
    a.group.updateMatrixWorld(true);
    const centreRay = new THREE.Raycaster(new THREE.Vector3(0, 3, 5), new THREE.Vector3(0, 0, -1));
    const jambRay = new THREE.Raycaster(new THREE.Vector3(1.8, 3, 5), new THREE.Vector3(0, 0, -1));
    const centreHit = centreRay.intersectObject(a.group, true)[0];
    const jambHit = jambRay.intersectObject(a.group, true)[0];
    assert.ok(centreHit && jambHit);
    assert.ok(centreHit.point.z < -1.2, 'window opens through to the back interior wall');
    assert.ok(jambHit.point.z > 1.4, 'front surround stays solid beside the opening');
    assert.ok(jambHit.point.z - centreHit.point.z > 2.5, 'actual cavity has appreciable depth');
  } finally { a.dispose(); }
});

test('sign and interior lighting animate; reduced motion freezes all state exactly', () => {
  const a = createPurpleTicketBooth();
  try {
    const original = snapshot(a.group); a.update(0.04); assert.notEqual(snapshot(a.group), original);
    assert.notEqual(a.group.getObjectByName('TicketSign').rotation.z, 0);
    const frozen = snapshot(a.group); for (let i = 0; i < 20; i++) a.update(0.05, true);
    assert.equal(snapshot(a.group), frozen); a.update(0.04, false); assert.notEqual(snapshot(a.group), frozen);
  } finally { a.dispose(); }
});

test('invalid deltas are rejected, large deltas clamp to 0.05 seconds', () => {
  const a = createPurpleTicketBooth();
  try {
    const before = snapshot(a.group);
    for (const delta of [undefined, null, NaN, Infinity, -Infinity, 0, -1, '0.1']) a.update(delta);
    assert.equal(snapshot(a.group), before); a.update(100); assert.equal(a.group.userData.elapsed, 0.05);
  } finally { a.dispose(); }
});

test('ticket booth instances have independent resources and animation', () => {
  const a = createPurpleTicketBooth(), b = createPurpleTicketBooth();
  try {
    const ar = resources(a.group), br = resources(b.group);
    for (const value of ar.geometries) assert.ok(!br.geometries.has(value));
    for (const value of ar.materials) assert.ok(!br.materials.has(value));
    a.update(0.05); assert.equal(b.group.userData.elapsed, 0);
    a.dispose(); b.update(0.03); assert.equal(b.group.userData.elapsed, 0.03);
  } finally { a.dispose(); b.dispose(); }
});

test('ticket booth cleanup releases every resource once and supports clean recreation', () => {
  const a = createPurpleTicketBooth(), parent = new THREE.Group(); parent.add(a.group);
  const r = resources(a.group), counts = new Map();
  for (const value of [...r.geometries, ...r.materials, ...r.textures]) {
    counts.set(value, 0); value.addEventListener('dispose', () => counts.set(value, counts.get(value) + 1));
  }
  const before = snapshot(a.group); a.dispose(); a.dispose(); a.update(0.05);
  assert.equal(a.group.parent, null); assert.equal(snapshot(a.group), before);
  for (const count of counts.values()) assert.equal(count, 1);
  const next = createPurpleTicketBooth();
  try { assert.deepEqual(next.stats, a.stats); next.update(0.05); assert.equal(next.group.userData.elapsed, 0.05); }
  finally { next.dispose(); }
});

test('ticket booth wrapper creates only after commit and cleans up for StrictMode', () => {
  const source = readFileSync(new URL('../src/components/town/buildings/PurpleTicketBooth.jsx', import.meta.url), 'utf8');
  assert.match(source, /useLayoutEffect\(\(\) => \{/);
  assert.match(source, /const parent = host\.current;[\s\S]*const booth = createPurpleTicketBooth\(\);/);
  assert.match(source, /parent\.remove\(booth\.group\);[\s\S]*booth\.dispose\(\);/);
  assert.match(source, /useFrame\(\(_, delta\) => asset\.current\?\.update\(delta, reducedMotion\)\)/);
  assert.match(source, /dispose=\{null\}/); assert.doesNotMatch(source, /useMemo|useState/);
});
