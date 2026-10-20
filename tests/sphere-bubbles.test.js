import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { SPHERE_LANDMARK } from '../shared/sphere-landmark.js';
import { SPHERE_BUBBLE_BUDGET as BUDGET, SPHERE_BUBBLE_MOUTH, sampleSphereBubble, sampleSphereBubbleCue } from '../src/components/sphere/sphereBubbleCycle.js';
import { createSphereBubbles } from '../src/components/sphere/createSphereBubbles.js';

test('bubble mouth matches the LED mouth on the actual rotated landmark, without applying world translation twice', () => {
  const mouth = new THREE.Vector3(0, Math.sin(-.205) * 18, Math.cos(-.205) * 18).applyAxisAngle(new THREE.Vector3(0, 1, 0), SPHERE_LANDMARK.faceYaw);
  mouth.y += SPHERE_LANDMARK.centerY;
  assert.ok(mouth.distanceTo(new THREE.Vector3(...SPHERE_BUBBLE_MOUTH.local)) < 1e-12);
  assert.ok(Math.abs(new THREE.Vector3(...SPHERE_BUBBLE_MOUTH.normal).length() - 1) < 1e-12);
  const sample = sampleSphereBubble(2100, 0);
  const offset = new THREE.Vector3(sample.x, sample.y, sample.z).sub(mouth);
  assert.ok(offset.clone().normalize().dot(new THREE.Vector3(...SPHERE_BUBBLE_MOUTH.normal)) > .999);
  assert.ok(Math.abs(offset.length() - sample.radius * 1.015) < 1e-12);
  assert.ok(sample.x > 0, 'parent owns the -108 world translation');
});

test('28s narrative anticipates, inflates a hero bubble, releases a chain, morphs into clouds and fades before resetting', () => {
  assert.equal(sampleSphereBubbleCue(1000).phase, 'anticipation');
  assert.equal(sampleSphereBubbleCue(5000).phase, 'blowing');
  assert.ok(sampleSphereBubbleCue(5000).blow > .8);
  assert.ok(sampleSphereBubbleCue(15000).lookUp > .9);
  assert.equal(sampleSphereBubble(1999, 0).visible, false);
  const small = sampleSphereBubble(2200, 0), inflated = sampleSphereBubble(3799, 0), released = sampleSphereBubble(6000, 0);
  assert.equal(small.phase, 'inflating'); assert.ok(inflated.radius > 2.6); assert.equal(inflated.detached, false);
  assert.equal(released.detached, true); assert.equal(released.phase, 'rising'); assert.ok(released.y > inflated.y);
  assert.equal(sampleSphereBubble(8400, 7).visible, true);
  const morph = sampleSphereBubble(13000, 0), cloud = sampleSphereBubble(18000, 0);
  assert.equal(morph.phase, 'transforming'); assert.ok(morph.bubbleOpacity > 0 && morph.cloudOpacity > 0);
  assert.equal(cloud.phase, 'cloud'); assert.equal(cloud.bubbleOpacity, 0); assert.equal(cloud.cloudOpacity, 1);
  assert.ok(cloud.y > released.y + 10);
  for (let i = 0; i < 8; i++) {
    assert.equal(sampleSphereBubble(27999, i).bubbleOpacity, 0);
    assert.equal(sampleSphereBubble(27999, i).cloudOpacity, 0);
    assert.equal(sampleSphereBubble(28000, i).visible, false);
  }
});

test('absolute sampling is finite, repeatable, bounded and continuous at detach/morph boundaries', () => {
  const out = {};
  for (const time of [NaN, Infinity, -Infinity, -1, 0, 1, 1e13]) for (const index of [-1, 0, 7, 8, NaN]) {
    assert.equal(sampleSphereBubble(time, index, {}, out), out);
    for (const value of Object.values(out)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
  for (let time = 0; time <= 28000; time += 43) for (let index = 0; index < 8; index++) {
    const pose = sampleSphereBubble(time, index);
    assert.deepEqual(pose, sampleSphereBubble(time + 28000, index));
    if (pose.visible) {
      assert.ok(pose.y + pose.cloudScale * 1.5 < BUDGET.maxHeight);
      assert.ok(Math.hypot(pose.x, pose.z) + Math.max(pose.radius, pose.cloudScale * 1.85) < BUDGET.maxRadius);
    }
    assert.ok(pose.bubbleOpacity >= 0 && pose.bubbleOpacity <= 1 && pose.cloudOpacity >= 0 && pose.cloudOpacity <= 1);
  }
  for (const time of [2000, 3800, 11000, 14300, 18000, 23500, 27300]) {
    const a = sampleSphereBubble(time - .01, 0), b = sampleSphereBubble(time + .01, 0);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < .001);
    assert.ok(Math.abs(a.bubbleOpacity - b.bubbleOpacity) < .001 && Math.abs(a.cloudOpacity - b.cloudOpacity) < .001);
  }
});

test('reduced motion is a fixed composition of exactly two bubbles and one cloud', () => {
  const poses = Array.from({ length: 8 }, (_, i) => sampleSphereBubble(0, i, { reducedMotion: true }));
  assert.equal(poses.filter(p => p.bubbleOpacity > .01).length, 2); assert.equal(poses.filter(p => p.cloudOpacity > .01).length, 1);
  for (let index = 0; index < 8; index++) assert.deepEqual(poses[index], sampleSphereBubble(999999, index, { reducedMotion: true }));
  assert.deepEqual(sampleSphereBubbleCue(1, { reducedMotion: true }), sampleSphereBubbleCue(20000, { reducedMotion: true }));
});

test('clouds fan out into a legible sky procession only after leaving the tight mouth stream', () => {
  const lateral = pose => pose.x * Math.cos(SPHERE_LANDMARK.faceYaw) - pose.z * Math.sin(SPHERE_LANDMARK.faceYaw);
  const spreadAt = time => {
    const values = Array.from({ length: 8 }, (_, index) => sampleSphereBubble(time, index)).filter(pose => pose.visible).map(lateral);
    return Math.max(...values) - Math.min(...values);
  };
  assert.ok(spreadAt(9000) < 2.5, 'keep the freshly blown chain close to the mouth');
  assert.ok(spreadAt(24000) > 13, 'separate cloud silhouettes across the sky');
  assert.ok(spreadAt(24000) > spreadAt(16000) + 4, 'fan out gradually during cloud drift');
});

test('renderer stays inside two draws/12k triangles with stable GPU resources, exact sampled transforms and no secondary render pass', () => {
  const model = createSphereBubbles(), meshes = model.group.children, bubble = meshes[0], clouds = meshes[1];
  try {
    assert.equal(model.statistics.drawCalls, 2); assert.ok(model.statistics.triangles <= BUDGET.triangles); assert.equal(model.statistics.instances, 48);
    const resources = meshes.map(mesh => [mesh, mesh.geometry, mesh.material, mesh.instanceMatrix, mesh.geometry.attributes.aOpacity]);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), quaternion = new THREE.Quaternion();
    for (let time = 0; time < 56000; time += 113) {
      const cue = model.update(time, { night: .5 });
      assert.deepEqual(cue, sampleSphereBubbleCue(time));
      for (let index = 0; index < 8; index++) {
        const pose = sampleSphereBubble(time, index); bubble.getMatrixAt(index, matrix); matrix.decompose(position, quaternion, scale);
        assert.ok(position.distanceTo(new THREE.Vector3(pose.x, pose.y, pose.z)) < .00001);
        assert.ok(Math.abs(scale.x - (pose.visible ? pose.radius : 0)) < .00001);
        assert.ok(Math.abs(bubble.geometry.attributes.aOpacity.array[index] - pose.bubbleOpacity) < .000001);
      }
    }
    meshes.forEach((mesh, i) => assert.deepEqual([mesh, mesh.geometry, mesh.material, mesh.instanceMatrix, mesh.geometry.attributes.aOpacity], resources[i]));
    const source = fs.readFileSync(new URL('../src/components/sphere/createSphereBubbles.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /new THREE\.(?:WebGLRenderer|WebGLRenderTarget|CubeCamera|TextureLoader)|requestAnimationFrame|setInterval|fetch\(|transmission:/);
    assert.equal(bubble.material.depthWrite, false); assert.equal(clouds.material.depthWrite, false);
    assert.equal(bubble.castShadow, false); assert.equal(clouds.castShadow, false);
  } finally { model.dispose(); }
});

test('pause/reduced-motion repeat uploads no matrices, opacity/night are bounded, and dispose releases each resource exactly once', () => {
  const model = createSphereBubbles(), [bubble, clouds] = model.group.children;
  const resources = [bubble, clouds, bubble.geometry, clouds.geometry, bubble.material, clouds.material], counts = resources.map(() => 0);
  resources.forEach((item, index) => item.addEventListener('dispose', () => counts[index]++));
  model.update(12000); const version = bubble.instanceMatrix.version;
  model.update(12000); assert.equal(bubble.instanceMatrix.version, version);
  model.update(17000, { reducedMotion: true }); const staticVersion = bubble.instanceMatrix.version;
  model.update(25000, { reducedMotion: true, night: 10 }); assert.equal(bubble.instanceMatrix.version, staticVersion);
  assert.equal(bubble.material.uniforms.uNight.value, 1);
  model.update(16000, { opacity: 0 }); assert.equal(model.group.visible, false);
  assert.ok(bubble.geometry.attributes.aOpacity.array.every(value => value === 0));
  const hiddenVersion = bubble.instanceMatrix.version;
  for (let i = 0; i < 100; i++) model.update(16001 + i, { opacity: 0 });
  assert.equal(bubble.instanceMatrix.version, hiddenVersion, 'hidden facade must not upload invisible instance matrices every frame');
  model.update(16000, { opacity: 10, night: -1 }); assert.equal(model.group.visible, true); assert.equal(clouds.material.uniforms.uNight.value, 0);
  model.dispose(); model.dispose();
  assert.deepEqual(counts, [1, 1, 1, 1, 1, 1]); assert.equal(model.group.children.length, 0); assert.equal(model.update(20000), null);
});
