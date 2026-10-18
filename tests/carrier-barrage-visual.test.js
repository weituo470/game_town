import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCarrierBattleVisual } from '../src/components/drone/carrierBattleGeometry.js';
import { BARRAGE_COUNT, BARRAGE_PER_MOUNT, BARRAGE_WINDOW, sampleBarrageRound, sampleBarrageMount } from '../shared/carrierBarrage.js';
import { CARRIER_BATTLE_COUNTS, CARRIER_BATTLE_EVENTS, sampleBattleShot, sampleBattleTurret } from '../shared/carrierBattle.js';

const NAME = 'battle-ciws-barrage';
const close = (a, b, epsilon = 3e-5) => assert.ok(Math.abs(a - b) <= epsilon, `${a} differs from ${b}`);
const pose = (mesh, index) => {
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  mesh.getMatrixAt(index, matrix); matrix.decompose(position, rotation, scale);
  return { matrix, position, rotation, scale };
};
const bufferState = mesh => ({ matrix: mesh.instanceMatrix.array.slice(), colors: mesh.instanceColor.array.slice(), visible: mesh.visible });
const roundIsVisible = round => round.visible && round.opacity > .001;

test('dense barrage adds exactly one fixed-capacity instanced batch and shares existing tracer geometry', () => {
  const visual = createCarrierBattleVisual();
  try {
    const mesh = visual.meshes[NAME];
    assert.ok(mesh instanceof THREE.InstancedMesh);
    assert.equal(mesh.count, BARRAGE_COUNT);
    assert.equal(BARRAGE_COUNT, BARRAGE_PER_MOUNT * 4);
    assert.ok(mesh.count <= 288, 'bounded geometry, not individual React/projectile objects');
    assert.equal(mesh.geometry, visual.meshes['battle-short-tracers'].geometry);
    assert.equal(mesh.geometry.type, 'CylinderGeometry');
    assert.ok(mesh.geometry.groups.length <= 1, 'at most the cylinder sidewall group');
    assert.equal(Array.isArray(mesh.material), false, 'one material draw, no multi-material passes');
    assert.ok(mesh.material.isMeshBasicMaterial);
    assert.equal(mesh.material.blending, THREE.AdditiveBlending);
    assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.instanceMatrix.usage, THREE.DynamicDrawUsage);
    let batches = 0, lights = 0;
    visual.group.traverse(node => { if (node.isMesh || node.isLine) batches++; if (node.isLight) lights++; });
    assert.equal(batches, 13); assert.equal(lights, 2, 'muzzle glows do not add scene lights or exposure pulses');
    assert.equal(visual.group.userData.battle.renderBatches, 13);
  } finally { visual.dispose(); }
});

test('actual cylinders exactly join sampled short tail/head segments and keep inactive slots empty', () => {
  const visual = createCarrierBattleVisual(), c = new THREE.Color();
  try {
    const mesh = visual.meshes[NAME];
    for (const time of [22500, 26000, 38000, 42000, 48000, 57000]) {
      visual.update(time);
      let visible = 0;
      for (let index = 0; index < BARRAGE_COUNT; index++) {
        const round = sampleBarrageRound(time, index), actual = pose(mesh, index);
        mesh.getColorAt(index, c);
        if (!roundIsVisible(round)) {
          close(actual.scale.length(), 0);
          assert.deepEqual([c.r, c.g, c.b], [0, 0, 0]);
          continue;
        }
        visible++;
        const head = new THREE.Vector3(0, .5, 0).applyMatrix4(actual.matrix);
        const tail = new THREE.Vector3(0, -.5, 0).applyMatrix4(actual.matrix);
        assert.ok(head.distanceTo(new THREE.Vector3(...round.head)) < 4e-5);
        assert.ok(tail.distanceTo(new THREE.Vector3(...round.tail)) < 4e-5);
        close(actual.scale.y, round.length);
        assert.ok(actual.scale.y > 0 && actual.scale.y < 8, 'short moving strokes, not full-field beams');
        assert.ok(actual.scale.x > .03 && actual.scale.x < .05);
        assert.ok(c.r > c.g && c.g > c.b && c.r <= 1.26, 'restrained gold-white, not unbounded HDR');
        assert.deepEqual(round.origin, sampleBattleTurret(time, round.mountId).muzzle);
      }
      assert.equal(visual.group.userData.battle.barrageRounds, visible);
      assert.equal(mesh.visible, visible > 0);
    }
  } finally { visual.dispose(); }
});

test('peak fire net remains visibly dense across four sources without inventing impacts', () => {
  const visual = createCarrierBattleVisual();
  try {
    visual.update(26000);
    const earlyCount = visual.group.userData.battle.barrageRounds;
    assert.ok(earlyCount >= 100 && earlyCount < 180);
    for (const time of [38000, 40000, 43000, 48000, 52000, 56000]) {
      visual.update(time);
      const perMount = [0, 0, 0, 0];
      for (let index = 0; index < BARRAGE_COUNT; index++) {
        const round = sampleBarrageRound(time, index);
        if (roundIsVisible(round)) perMount[round.mountId]++;
      }
      assert.ok(perMount.every(count => count >= 35 && count <= BARRAGE_PER_MOUNT));
      assert.ok(visual.group.userData.battle.barrageRounds >= 200);
      assert.ok(visual.group.userData.battle.barrageRounds <= 288);
      const authoredHits = CARRIER_BATTLE_EVENTS.reduce((count, event) => {
        const shot = sampleBattleShot(time, event.id);
        return count + (shot.impactAge >= 0 && shot.impactAge < .8 ? 1 : 0);
      }, 0);
      assert.equal(visual.group.userData.battle.hits, authoredHits, 'decorative fire net does not add damage/explosions');
    }
  } finally { visual.dispose(); }
});

test('pause does not rewrite GPU buffers; reverse seek and different frame pacing reproduce exact cylinders', () => {
  const visual = createCarrierBattleVisual();
  try {
    visual.update(42123.5);
    const mesh = visual.meshes[NAME], expected = bufferState(mesh);
    const matrixArray = mesh.instanceMatrix.array, colorArray = mesh.instanceColor.array;
    const matrixVersion = mesh.instanceMatrix.version, colorVersion = mesh.instanceColor.version;
    for (let i = 0; i < 30; i++) assert.equal(visual.update(42123.5), false);
    assert.equal(mesh.instanceMatrix.version, matrixVersion);
    assert.equal(mesh.instanceColor.version, colorVersion);
    assert.equal(mesh.instanceMatrix.array, matrixArray); assert.equal(mesh.instanceColor.array, colorArray);
    for (const fps of [30, 60, 120]) {
      for (let i = 0; i < 16; i++) visual.update(40000 + i * 1000 / fps);
      visual.update(42123.5); assert.deepEqual(bufferState(mesh), expected);
    }
    for (const time of [150000, 0, 58000, 23000, 57000, 118000]) visual.update(time);
    visual.update(42123.5); assert.deepEqual(bufferState(mesh), expected);
  } finally { visual.dispose(); }
});

test('reduced-motion toggles and both timeline edges clear every real barrage matrix/color slot', () => {
  const visual = createCarrierBattleVisual();
  try {
    visual.update(42000); const mesh = visual.meshes[NAME], expected = bufferState(mesh);
    assert.equal(mesh.visible, true);
    for (const [time, reduced] of [[42000, true], [BARRAGE_WINDOW.start, false], [BARRAGE_WINDOW.end, false], [150000, false], [NaN, false]]) {
      visual.update(time, reduced);
      assert.equal(mesh.visible, false);
      assert.equal(visual.group.userData.battle.barrageRounds, 0);
      for (let index = 0; index < BARRAGE_COUNT; index++) close(pose(mesh, index).scale.length(), 0);
      assert.ok(mesh.instanceColor.array.every(value => value === 0));
      assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
    }
    visual.update(42000, false); assert.deepEqual(bufferState(mesh), expected);
  } finally { visual.dispose(); }
});

test('four source glows stay compact and follow the shared barrel without projectile-frequency flashing', () => {
  const visual = createCarrierBattleVisual(), c = new THREE.Color(), gold = new THREE.Color('#ffd18b');
  try {
    const mesh = visual.meshes['battle-hit-sparks'], offset = CARRIER_BATTLE_COUNTS.shots * 9;
    const transitions = [0, 0, 0, 0], previous = [null, null, null, null];
    // A full two-second interval covers many .72s projectile cycles, while
    // source glow follows the slower authored burst envelope, never each round.
    for (let step = 0; step <= 120; step++) {
      const time = 42000 + step * 1000 / 60; visual.update(time);
      for (let mount = 0; mount < 4; mount++) {
        const source = sampleBarrageMount(time, mount), actual = pose(mesh, offset + mount);
        const on = actual.scale.y > 0;
        if (previous[mount] !== null && on !== previous[mount]) transitions[mount]++;
        previous[mount] = on;
        if (!source.firing) continue; // authored single encounters may also illuminate a source
        assert.equal(on, true);
        const expected = new THREE.Vector3(...source.origin).addScaledVector(new THREE.Vector3(...source.target).sub(new THREE.Vector3(...source.origin)).normalize(), .2);
        assert.ok(actual.position.distanceTo(expected) < 4e-5);
        close(actual.scale.x, .17); close(actual.scale.y, .45); close(actual.scale.z, .17);
        mesh.getColorAt(offset + mount, c);
        close(c.r, gold.r * .75 * (.65 + source.strength * .35));
        assert.ok(c.r <= .75001, 'small emissive geometry, no high-HDR flash');
      }
    }
    assert.ok(transitions.every(count => count <= 4), `not projectile-frequency blinking: ${transitions}`);
    visual.update(58000);
    for (let mount = 0; mount < 4; mount++) close(pose(mesh, offset + mount).scale.length(), 0);
  } finally { visual.dispose(); }
});

test('shared tracer geometry and barrage GPU objects dispose exactly once and later allocations survive', () => {
  const first = createCarrierBattleVisual(), second = createCarrierBattleVisual();
  const mesh = first.meshes[NAME], resources = [mesh, mesh.geometry, mesh.material], disposal = [0, 0, 0];
  resources.forEach((resource, index) => resource.addEventListener('dispose', () => disposal[index]++));
  assert.notEqual(mesh.geometry, second.meshes[NAME].geometry);
  first.dispose(); first.dispose();
  assert.deepEqual(disposal, [1, 1, 1]);
  assert.equal(first.update(42000), false);
  assert.equal(first.group.children.length, 0);
  try {
    assert.equal(second.update(42000), true);
    assert.ok(second.group.userData.battle.barrageRounds > 200);
  } finally { second.dispose(); }
});
