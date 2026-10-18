import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as React from 'react';
import * as THREE from 'three';
import { createCarrierBattleVisual, sampleCarrierDownwash } from '../src/components/drone/carrierBattleGeometry.js';
import { CARRIER_BATTLE_COUNTS, CARRIER_BATTLE_EVENTS, sampleBattleDrone, sampleBattleShot } from '../shared/carrierBattle.js';
import { sampleBarrageMount } from '../shared/carrierBarrage.js';

const close = (a, b, epsilon = 2e-5) => assert.ok(Math.abs(a - b) <= epsilon, `${a} differs from ${b}`);
const pose = (mesh, index) => {
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  mesh.getMatrixAt(index, matrix); matrix.decompose(position, rotation, scale);
  return { matrix, position, rotation, scale };
};
function snapshot(visual) {
  return Object.fromEntries(Object.entries(visual.meshes).map(([name, mesh]) => [name, mesh.isInstancedMesh
    ? { matrix: mesh.instanceMatrix.array.slice(), colors: mesh.instanceColor?.array.slice(), visible: mesh.visible }
    : { positions: mesh.geometry.attributes.position.array.slice(), colors: mesh.geometry.attributes.color.array.slice(), visible: mesh.visible }]));
}

test('battle renderer uses genuine 3D shaded aircraft and exactly thirteen render batches', () => {
  const v = createCarrierBattleVisual();
  try {
    let batches = 0, points = 0, lights = 0;
    v.group.traverse(node => { if (node.isMesh || node.isLine) batches++; if (node.isPoints) points++; if (node.isLight) lights++; });
    assert.equal(batches, 13); assert.equal(points, 0); assert.equal(lights, 2);
    const body = v.meshes['battle-drone-bodies'], wings = v.meshes['battle-drone-wings'];
    assert.equal(body.count, CARRIER_BATTLE_COUNTS.attack + CARRIER_BATTLE_COUNTS.defense);
    assert.ok(body.material.isMeshStandardMaterial && wings.material.isMeshStandardMaterial);
    body.geometry.computeBoundingBox(); wings.geometry.computeBoundingBox();
    assert.ok(body.geometry.boundingBox.max.z - body.geometry.boundingBox.min.z > 2.7);
    assert.ok(body.geometry.boundingBox.max.y - body.geometry.boundingBox.min.y > .3);
    assert.ok(wings.geometry.boundingBox.max.x - wings.geometry.boundingBox.min.x > 3.5);
    assert.ok(wings.geometry.boundingBox.max.y - wings.geometry.boundingBox.min.y > .25, 'tail fins have genuine height');
    assert.equal(v.meshes['battle-short-tracers'].count, CARRIER_BATTLE_COUNTS.shots * 3);
    assert.equal(v.meshes['battle-hit-sparks'].count, CARRIER_BATTLE_COUNTS.shots * 9 + 4);
  } finally { v.dispose(); }
});

test('every actual instance follows the shared world-space trajectory and model -Z orientation', () => {
  const v = createCarrierBattleVisual();
  try {
    for (const time of [0, 15500, 24000, 42000, 79000, 98800, 104000, 118000, 140000, 150000]) {
      v.update(time);
      for (const [index, team] of [[0, 'attack'], [17, 'attack'], [47, 'attack'], [0, 'defense'], [19, 'defense'], [31, 'defense']]) {
        const sample = sampleBattleDrone(time, index, team);
        const slot = team === 'attack' ? index : index + CARRIER_BATTLE_COUNTS.attack;
        const actual = pose(v.meshes['battle-drone-bodies'], slot);
        sample.position.forEach((value, axis) => close(actual.position.getComponent(axis), value));
        const size = sample.visible ? Math.sqrt(sample.opacity) * sample.scale : 0;
        close(actual.scale.y, size);
        close(actual.scale.x, size * (team === 'attack' ? 1.02 : .88));
        if (size > .01) {
          const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(sample.pitch, sample.yaw, sample.bank, 'YXZ'));
          assert.ok(actual.rotation.angleTo(expected) < .001);
        }
        for (const name of ['battle-drone-wings', 'battle-drone-canopies', 'battle-drone-team-lights', 'battle-drone-exhausts']) {
          const other = pose(v.meshes[name], slot);
          assert.deepEqual(other.matrix.elements, actual.matrix.elements, `${name} stays attached to the aircraft`);
        }
      }
    }
  } finally { v.dispose(); }
});

test('pause is cached and reverse seek rebuilds identical real geometry without temporal trails', () => {
  const v = createCarrierBattleVisual();
  try {
    v.update(118230); const expected = snapshot(v);
    const version = v.meshes['battle-drone-bodies'].instanceMatrix.version;
    assert.equal(v.update(118230), false);
    assert.equal(v.meshes['battle-drone-bodies'].instanceMatrix.version, version);
    for (const time of [0, 150000, 22500, 109000, 43000]) v.update(time);
    v.update(118230); assert.deepEqual(snapshot(v), expected);
    const trail = v.meshes['battle-restrained-flight-trails'].geometry.attributes.position.array;
    for (let i = 0; i < trail.length; i += 6) {
      assert.ok(Math.hypot(trail[i] - trail[i + 3], trail[i + 1] - trail[i + 4], trail[i + 2] - trail[i + 5]) <= 2.60002);
    }
    v.update(NaN);
    for (const value of v.meshes['battle-drone-bodies'].instanceMatrix.array) assert.ok(Number.isFinite(value));
  } finally { v.dispose(); }
});

test('gold and red/cyan shots are short moving geometry segments, never full-screen connecting rays', () => {
  const v = createCarrierBattleVisual();
  try {
    const selected = [CARRIER_BATTLE_EVENTS.find(e => e.kind === 'intercept'),
      CARRIER_BATTLE_EVENTS.find(e => e.kind === 'attack'),
      CARRIER_BATTLE_EVENTS.find(e => e.kind === 'duel' && e.team === 'defense'),
      CARRIER_BATTLE_EVENTS.find(e => e.kind === 'duel' && e.team === 'attack')];
    assert.ok(selected.every(Boolean), 'programme contains both sides and deck strikes');
    for (const event of selected) {
      const time = event.hitTime - event.flightMs * .45;
      v.update(time);
      const sample = sampleBattleShot(time, event.id), actual = pose(v.meshes['battle-short-tracers'], event.id * 3);
      const head = new THREE.Vector3(0, .5, 0).applyMatrix4(actual.matrix);
      const expected = new THREE.Vector3().fromArray(sample.start).lerp(new THREE.Vector3().fromArray(sample.end), sample.progress);
      assert.ok(head.distanceTo(expected) < .00003, 'tracer head follows the shared start/end/progress');
      assert.ok(actual.scale.y > .1 && actual.scale.y <= (sample.kind === 'intercept' ? 4.40001 : 2.80001));
      const c = new THREE.Color(); v.meshes['battle-short-tracers'].getColorAt(event.id * 3, c);
      if (event.kind === 'intercept') assert.ok(c.r > c.g && c.g > c.b);
      else if (event.team === 'attack') assert.ok(c.r > c.b * 3);
      else assert.ok(c.b > c.r * 3);
    }
  } finally { v.dispose(); }
});

test('hits create compact sparks/smoke at the actual impact point including carrier deck hits', () => {
  const v = createCarrierBattleVisual();
  try {
    const events = [CARRIER_BATTLE_EVENTS.find(e => e.kind === 'intercept' && e.willHit),
      CARRIER_BATTLE_EVENTS.find(e => e.kind === 'attack' && e.willHit)];
    for (const event of events) {
      const time = event.hitTime + 80; v.update(time);
      const sample = sampleBattleShot(time, event.id);
      const core = pose(v.meshes['battle-hit-sparks'], event.id * 9);
      close(core.position.x, sample.impact[0]); close(core.position.z, sample.impact[2]);
      close(core.position.y, sample.impact[1] - 2.3 * .08 * .08);
      assert.ok(core.scale.x > 0 && core.scale.x < .5);
      assert.ok(pose(v.meshes['battle-small-hit-smoke'], event.id * 2).scale.x > 0);
      assert.ok(v.group.userData.battle.hits >= 1);
    }
    const miss = CARRIER_BATTLE_EVENTS.find(e => !e.willHit);
    v.update(miss.hitTime + 80);
    assert.equal(pose(v.meshes['battle-hit-sparks'], miss.id * 9).scale.x, 0, 'near misses do not invent impacts');
  } finally { v.dispose(); }
});

test('debris rings occur after a fall to the sea and never on the carrier deck', () => {
  const v = createCarrierBattleVisual();
  try {
    const event = CARRIER_BATTLE_EVENTS.find(e => {
      if (!e.willHit || e.victimTeam === 'carrier') return false;
      const [x, , z] = sampleBattleShot(e.hitTime + 1, e.id).impact;
      return x > 49 && !(x > 53.8 && x < 72.2 && z > 4.8 && z < 35.2);
    });
    assert.ok(event);
    const hit = sampleBattleShot(event.hitTime, event.id).impact;
    const time = event.hitTime + Math.sqrt(2 * (hit[1] + 1.28) / 9.81) * 1000 + 300;
    v.update(time);
    const ring = pose(v.meshes['battle-sea-impact-rings'], event.id);
    assert.ok(ring.scale.x > .7); close(ring.position.y, -1.25); close(ring.position.x, hit[0]);
    const deck = CARRIER_BATTLE_EVENTS.find(e => e.kind === 'attack' && e.willHit);
    v.update(deck.hitTime + 800);
    assert.equal(pose(v.meshes['battle-sea-impact-rings'], deck.id).scale.x, 0);
  } finally { v.dispose(); }
});

test('reduced motion retains shaded static formations but removes all rapid combat effects', () => {
  const v = createCarrierBattleVisual();
  try {
    v.update(25000, true);
    const expected = v.meshes['battle-drone-bodies'].instanceMatrix.array.slice();
    for (const time of [45000, 80000, 105000, 120000, 145000]) {
      v.update(time, true);
      assert.deepEqual(v.meshes['battle-drone-bodies'].instanceMatrix.array, expected);
      for (const name of ['battle-short-tracers', 'battle-ciws-barrage', 'battle-hit-sparks', 'battle-small-hit-smoke', 'battle-sea-impact-rings', 'battle-restrained-flight-trails', 'battle-engine-downwash-rings', 'battle-engine-sea-mist']) assert.equal(v.meshes[name].visible, false, name);
      assert.equal(v.group.userData.battle.aircraft, 80);
    }
    v.update(150000, true); assert.equal(v.group.userData.battle.aircraft, 0);
  } finally { v.dispose(); }
});

test('interception is a restrained three-segment tracer train and a shared-muzzle soft light', () => {
  const v = createCarrierBattleVisual();
  try {
    const event = CARRIER_BATTLE_EVENTS.find(item => item.kind === 'intercept');
    const time = event.hitTime - event.flightMs * .35; v.update(time);
    const shot = sampleBattleShot(time, event.id);
    for (let segment = 0; segment < 3; segment++) {
      const actual = pose(v.meshes['battle-short-tracers'], event.id * 3 + segment);
      const head = new THREE.Vector3(0, .5, 0).applyMatrix4(actual.matrix);
      const expected = new THREE.Vector3().fromArray(shot.start).lerp(new THREE.Vector3().fromArray(shot.end), shot.progress - segment * .16);
      assert.ok(actual.scale.y > 0 && actual.scale.y <= 4.40001);
      assert.ok(head.distanceTo(expected) < .00003);
    }
    const muzzle = pose(v.meshes['battle-hit-sparks'], CARRIER_BATTLE_COUNTS.shots * 9 + shot.mountId);
    const firing = sampleBarrageMount(time, shot.mountId);
    const origin = firing.firing ? firing.origin : shot.start;
    const target = firing.firing ? firing.target : shot.end;
    const expected = new THREE.Vector3().fromArray(origin).add(new THREE.Vector3().fromArray(target).sub(new THREE.Vector3().fromArray(origin)).normalize().multiplyScalar(.2));
    assert.ok(muzzle.position.distanceTo(expected) < .00002);
    close(muzzle.scale.y, .45);
    assert.ok(v.group.userData.battle.muzzleLights > 0);
    // One authored hit no longer ends the sustained CIWS firing window.
    v.update(58000);
    assert.equal(pose(v.meshes['battle-hit-sparks'], CARRIER_BATTLE_COUNTS.shots * 9 + shot.mountId).scale.x, 0);
  } finally { v.dispose(); }
});

test('four engine wakes grow at lift-off then decay with height on the actual sea, not a new water plane', () => {
  const v = createCarrierBattleVisual();
  try {
    assert.equal(sampleCarrierDownwash(78000).strength, 0);
    assert.ok(sampleCarrierDownwash(81000).strength > .9);
    assert.ok(sampleCarrierDownwash(90000).strength < .25);
    assert.equal(sampleCarrierDownwash(101000).strength, 0);
    assert.equal(sampleCarrierDownwash(85000, true).strength, 0);
    v.update(82500);
    const wash = sampleCarrierDownwash(82500);
    assert.equal(wash.origins.length, 4);
    assert.equal(v.meshes['battle-engine-downwash-rings'].visible, true);
    assert.equal(v.meshes['battle-engine-sea-mist'].visible, true);
    for (let engine = 0; engine < 4; engine++) for (let ring = 0; ring < 3; ring++) {
      const actual = pose(v.meshes['battle-engine-downwash-rings'], engine * 3 + ring);
      close(actual.position.x, wash.origins[engine][0]); close(actual.position.z, wash.origins[engine][2]);
      close(actual.position.y, -1.245);
      assert.ok(actual.scale.x >= 1.25 && actual.scale.x <= 6.45);
    }
    const geometry = v.meshes['battle-engine-downwash-rings'].geometry;
    assert.equal(geometry.type, 'TorusGeometry', 'a fine hollow ring, never an opaque disc');
    assert.ok(geometry.parameters.tube <= .0121);
    const expected = snapshot(v);
    for (const time of [0, 100000, 150000, 89000]) v.update(time);
    v.update(82500); assert.deepEqual(snapshot(v), expected, 'wake and mist are seek-stable too');
    v.update(101000);
    assert.equal(v.meshes['battle-engine-downwash-rings'].visible, false);
    assert.equal(v.meshes['battle-engine-sea-mist'].visible, false);
  } finally { v.dispose(); }
});

test('all owned GPU geometries/materials and instance batches dispose once with no shared resources', () => {
  const a = createCarrierBattleVisual(), b = createCarrierBattleVisual();
  const resources = new Set(), counts = new Map();
  a.group.traverse(node => { if (node.geometry) resources.add(node.geometry); if (node.material) resources.add(node.material); if (node.isInstancedMesh) resources.add(node); });
  for (const resource of resources) { counts.set(resource, 0); resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1)); }
  assert.notEqual(a.meshes['battle-drone-bodies'].geometry, b.meshes['battle-drone-bodies'].geometry);
  a.dispose(); a.dispose();
  for (const count of counts.values()) assert.equal(count, 1);
  assert.equal(a.group.children.length, 0); assert.equal(a.update(100000), false);
  assert.equal(b.update(100000), true, 'a StrictMode cleanup cannot dispose a later independent allocation');
  b.dispose();
});

test('the real React component allocates after commit, samples the caller clock and cleans its scene', async () => {
  const file = new URL('../src/components/drone/CarrierBattleScene.jsx', import.meta.url);
  const code = await transformWithEsbuild(fs.readFileSync(file, 'utf8'), 'CarrierBattleScene.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
  const require = createRequire(file), effects = [], frames = [], module = { exports: {} };
  let allocations = 0;
  vm.runInNewContext(code.code, { module, exports: module.exports, require(id) {
    if (id === 'react') return { ...React, useRef: value => ({ current: value }), useLayoutEffect: setup => effects.push(setup) };
    if (id === '@react-three/fiber') return { useFrame: (callback, priority) => frames.push({ callback, priority }) };
    if (id === './carrierBattleGeometry.js') return { createCarrierBattleVisual() { allocations++; return createCarrierBattleVisual(); } };
    return require(id);
  } });
  const timeRef = { current: 0 }, element = module.exports.default({ timeRef });
  assert.equal(allocations, 0, 'discarded React render does not leak GPU allocations');
  const parent = new THREE.Group(); element.props.ref.current = parent;
  const cleanups = effects.map(setup => setup());
  assert.equal(allocations, 1); assert.equal(parent.children.length, 1);
  assert.equal(frames[0].priority, -.2);
  timeRef.current = 104000; frames[0].callback();
  assert.equal(parent.children[0].userData.battle.elapsed, 104000);
  assert.ok(parent.children[0].userData.battle.aircraft > 32);
  cleanups.forEach(cleanup => cleanup());
  assert.equal(parent.children.length, 0);
});
