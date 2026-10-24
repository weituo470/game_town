import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPHERE_LANDMARK as S } from '../shared/sphere-landmark.js';
import { SPHERE_UFO_SCORE as C, sampleSphereUfoShow, sphereLocalToWorld } from '../shared/sphereUfoShow.js';
import { createSphereUfo } from '../src/components/sphere/createSphereUfo.js';
import { createSphereLandmark } from '../src/components/sphere/createSphereLandmark.js';
import { sphereGuestCamera } from '../src/components/sphere/sphereUfoCamera.js';
import { sampleDroneCamera } from '../src/components/drone/droneCamera.js';
import { isWalkable } from '../shared/world.js';

test('the saucer story orders approach, provocation, charge, paired laser hit, sea crash and victory', () => {
  assert(C.enter < C.prank && C.prank < C.lock && C.lock < C.charge && C.charge < C.fire && C.fire < C.hit && C.hit < C.fall && C.fall < C.splash && C.splash < C.victory);
  assert.equal(sampleSphereUfoShow(C.enter - 1).ufoVisible, false);
  assert.equal(sampleSphereUfoShow(C.enter + 1000).phase, 'intruder');
  assert.equal(sampleSphereUfoShow(114500).prank, true);
  assert(sampleSphereUfoShow(118000).charge > .5); assert(sampleSphereUfoShow(119250).laser > .9);
  assert(sampleSphereUfoShow(119800).hit > .5); assert.equal(sampleSphereUfoShow(125000).falling, true);
  assert.equal(sampleSphereUfoShow(128500).splash, true); assert.equal(sampleSphereUfoShow(134000).phase, 'victory');
  assert.equal(sampleSphereUfoShow(150000).active, false);
});

test('absolute-time show is finite, deterministic, seekable and restrained under reduced motion', () => {
  for (const reduced of [false, true]) for (let ms = 0; ms <= 151000; ms += 137) {
    const state = sampleSphereUfoShow(ms, reduced);
    assert.deepEqual(state, sampleSphereUfoShow(ms, reduced));
    for (const n of [...state.position, ...state.eyes.flat(), ...state.tint, ...Object.values(state.face)]) assert(Number.isFinite(n));
    assert(state.position[1] >= .2); assert(state.face.leftOpen >= 0 && state.face.leftOpen <= 1);
    if (reduced) { assert.equal(state.laser, 0); assert.equal(state.hit, 0); assert.equal(state.splash, false); assert.equal(state.roll, 0); }
  }
  for (const invalid of [NaN, Infinity, 'hello', undefined]) assert.deepEqual(sampleSphereUfoShow(invalid), sampleSphereUfoShow(0));
});

test('UFO position is continuous at entry, hover, impact and ballistic fall; debris ends away from land', () => {
  for (const t of [C.prank, C.hit, C.fall, C.splash]) {
    const a = sampleSphereUfoShow(t - .01), b = sampleSphereUfoShow(t + .01);
    assert(Math.hypot(...a.position.map((n, i) => n - b.position[i])) < .01);
  }
  const crash = sampleSphereUfoShow(C.splash).splashPosition;
  assert.equal(isWalkable(crash[0], crash[2]), false);
  assert(Math.hypot(crash[0] - S.x, crash[2] - S.z) > S.groundRadius + 60);
});

test('both eye muzzle points agree with actual rotating facade geometry and pupil direction', () => {
  const state = sampleSphereUfoShow(119250);
  for (const [index, side] of [-1, 1].entries()) {
    const a = side * .29, lat = .23 + state.face.gazeY, r = S.radius + .12;
    const expected = sphereLocalToWorld([Math.sin(a) * Math.cos(lat) * r, S.centerY + Math.sin(lat) * r, Math.cos(a) * Math.cos(lat) * r], state.yaw);
    assert.deepEqual(state.eyes[index], expected);
  }
  assert(Math.hypot(...state.eyes[0].map((x, i) => x - state.eyes[1][i])) > 8);
});

test('real sphere mesh follows score colour, eye power, pose and rotation, then restores normal facade', () => {
  const model = createSphereLandmark(), wall = model.group.getObjectByName('sphere-led-wall'), u = wall.material.uniforms;
  const performance = sampleSphereUfoShow(119250);
  model.update(0, { mode: 'earth', performance });
  assert.equal(u.uMode.value, 0); assert.equal(wall.rotation.y, performance.yaw);
  assert.deepEqual(u.uShowTint.value.toArray(), [...performance.tint, 1]); assert.equal(u.uEyePower.value, performance.charge);
  assert.deepEqual(u.uFaceEyes.value.toArray(), [performance.face.leftOpen, performance.face.rightOpen, 0, performance.face.gazeY]);
  model.update(0, { mode: 'earth' }); assert.equal(u.uMode.value, 2); assert.equal(u.uShowTint.value.w, 0); assert.equal(u.uEyePower.value, 0); assert.equal(wall.rotation.y, S.faceYaw);
  model.dispose();
});

test('real saucer stage owns one scene and bounded batches with no lights, textures or cameras', () => {
  const v = createSphereUfo(), refs = [], geometries = new Set(), materials = new Set(); let triangles = 0, calls = 0;
  v.group.traverse(n => {
    assert(!n.isLight && !n.isCamera); refs.push(n);
    if (n.geometry) { geometries.add(n.geometry); triangles += (n.geometry.index?.count || n.geometry.attributes.position.count) / 3 * (n.count || 1); }
    if (n.material) { calls++; materials.add(n.material); for (const value of Object.values(n.material)) assert(!value?.isTexture); }
  });
  assert(calls <= 23); assert(triangles < 40000);
  for (const t of [0, 110000, 118000, 119250, 125000, 128500, 134000, 149999]) {
    v.update(t); let i = 0; v.group.traverse(n => { assert.equal(n, refs[i++]); assert(n.position.toArray().every(Number.isFinite)); });
  }
  v.update(119250); assert(v.group.getObjectByName('EyeLaserCore0').visible && v.group.getObjectByName('EyeLaserCore1').visible);
  v.update(128500); assert(!v.group.getObjectByName('MischiefSaucer').visible && v.group.getObjectByName('SeaCrashRipple').visible);
  let gs = 0, ms = 0; geometries.forEach(g => g.addEventListener('dispose', () => gs++)); materials.forEach(m => m.addEventListener('dispose', () => ms++));
  v.dispose(); v.dispose(); assert.equal(gs, geometries.size); assert.equal(ms, materials.size); assert.equal(v.update(0), null);
});

test('cinematic cutaway keeps sphere, saucer and both eyes within desktop and phone frusta', () => {
  for (const aspect of [1280 / 720, 390 / 844]) for (const time of [114000, 118000, 119250, 123000, 128500, 134000]) {
    const base = sampleDroneCamera(time, aspect, false), pose = sphereGuestCamera(base, time, aspect), camera = new THREE.PerspectiveCamera(pose.fov, aspect, .1, pose.far);
    camera.position.set(...pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld();
    const s = sampleSphereUfoShow(time);
    for (const point of [[S.x, S.centerY, S.z], ...s.eyes, ...(s.ufoVisible ? [s.position] : [])]) {
      const p = new THREE.Vector3(...point).project(camera); assert(Math.abs(p.x) < .95 && Math.abs(p.y) < .95 && p.z > -1 && p.z < 1, `${aspect} ${time} ${p.toArray()}`);
    }
    assert.equal(sphereGuestCamera(base, time, aspect, true), base);
  }
  const base = sampleDroneCamera(40000, 1.6); assert.equal(sphereGuestCamera(base, 40000, 1.6), base);
});
