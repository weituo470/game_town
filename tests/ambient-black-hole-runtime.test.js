import { MIDNIGHT_MS } from '../shared/dayNight.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAmbientBlackHoleClock } from '../shared/ambientBlackHole.js';
import { createAmbientBlackHoleRuntime, placeAmbientBlackHole } from '../src/components/town/ambientBlackHoleRuntime.js';
import { CAMERA_OFFSETS, cameraZoom } from '../src/components/town/camera.js';
import { SPAWN } from '../shared/world.js';
import { closeThirdPersonCamera, closeThirdPersonLens } from '../src/components/town/firstPerson.js';

const size = { width: 1280, height: 720 };
const skyDirection = new THREE.Vector3(Math.sin(.65), Math.SQRT1_2 * .7, Math.cos(.65)).normalize();
const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
function cameraState(camera) {
  return { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), up: camera.up.toArray(),
    zoom: camera.zoom, fov: camera.fov, near: camera.near, far: camera.far,
    left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom,
    projection: camera.projectionMatrix.toArray() };
}
function scriptedClock(initial) {
  let state = initial;
  const calls = [];
  return { calls, set(next) { state = next; }, advance(delta, options) { calls.push([delta, options]); return { ...state }; } };
}
function active(elapsedMs = 0, eventId = 1) {
  return { active: true, phase: elapsedMs < 8000 ? 'appearing' : 'holding', elapsedMs, opacity: Math.min(1, elapsedMs / 8000), eventId, nextInMs: 0 };
}
function harness({ clock = createAmbientBlackHoleClock({ random: () => 0 }) } = {}) {
  const scene = new THREE.Scene(), gl = { domElement: { dataset: { unrelated: 'preserved' } } };
  const camera = new THREE.PerspectiveCamera(65, size.width / size.height, .08, 420);
  camera.position.set(10, 4, 20); camera.lookAt(10, 4, 21); camera.updateMatrixWorld();
  const visuals = [], appearances = [];
  function createVisual(options) {
    const visual = { options, group: new THREE.Group(), updates: [], visibility: [], renders: [], disposals: 0,
      setAmbientVisibility(state) { this.visibility.push({ ...state }); this.group.visible = state.visible; },
      update(...args) { this.updates.push(args); },
      render(renderer) { this.renders.push(renderer); },
      dispose() { this.disposals += 1; },
    };
    visuals.push(visual); return visual;
  }
  const runtime = createAmbientBlackHoleRuntime({ scene, gl, clock, createVisual, onAppearance: id => appearances.push(id) });
  const frame = (delta = 0, options = {}) => runtime.frame({ delta, camera, size, enabled: true, worldTimeMs: MIDNIGHT_MS, ...options });
  const advance = seconds => { let state; for (let i = 0; i < seconds; i += 1) state = frame(1); return state; };
  return { runtime, scene, gl, camera, clock, visuals, appearances, frame, advance };
}

test('runtime remains GPU-lazy during the complete first waiting interval', () => {
  const h = harness();
  assert.equal(h.frame(600).nextInMs, 35000, 'first resume frame never consumes a potentially stale delta');
  assert.equal(h.visuals.length, 0); assert.equal(h.scene.children.length, 0);
  assert.equal(h.advance(34).nextInMs, 1000);
  assert.equal(h.visuals.length, 0);
  const state = h.frame(1);
  assert.equal(state.active, true); assert.equal(state.elapsedMs, 0);
  assert.equal(h.visuals.length, 1); assert.deepEqual(h.visuals[0].options, { ambient: true });
  assert.equal(h.visuals[0].group.parent, h.scene);
  assert.deepEqual(h.appearances, [1]);
  assert.equal(h.gl.domElement.dataset.skyBlackhole, 'appearing');
  h.runtime.dispose();
});

test('natural disappearance frees all visual resources and the next event builds a fresh instance', () => {
  const h = harness(); h.frame(); h.advance(35);
  const first = h.visuals[0];
  const ended = h.advance(90);
  assert.equal(ended.phase, 'waiting'); assert.equal(ended.nextInMs, 180000);
  assert.equal(first.disposals, 1); assert.equal(first.group.parent, null); assert.equal(h.scene.children.length, 0);
  h.advance(179);
  assert.equal(h.visuals.length, 1);
  assert.equal(h.frame(1).eventId, 2);
  assert.equal(h.visuals.length, 2); assert.notEqual(h.visuals[1], first);
  assert.equal(h.visuals[1].group.parent, h.scene); assert.deepEqual(h.appearances, [1, 2]);
  assert.equal(h.visuals[1].updates.length, 1, 'new GPU instance receives the initial optical frame');
  h.runtime.dispose(); assert.equal(h.visuals[1].disposals, 1);
});

test('disabled waiting never advances time or allocates a hidden GPU scene', () => {
  const h = harness(); h.frame(); h.advance(12);
  const before = h.clock.advance();
  for (let i = 0; i < 10; i += 1) h.frame(3600, { enabled: false });
  assert.deepEqual(h.clock.advance(), before);
  assert.equal(h.visuals.length, 0); assert.equal(h.gl.domElement.dataset.skyBlackhole, 'suspended');
  assert.deepEqual(h.frame(3600), before, 'resume delta is discarded rather than capped and counted');
  assert.equal(h.frame(1).nextInMs, 22000);
  h.runtime.dispose();
});

test('disabled active events hide, freeze, and resume without rebuilding or replaying notification', () => {
  const h = harness(); h.frame(); h.advance(35); const before = h.advance(4), visual = h.visuals[0];
  const updates = visual.updates.length, renders = visual.renders.length;
  for (let i = 0; i < 10; i += 1) {
    const hidden = h.frame(600, { enabled: false });
    assert.equal(hidden.active, false); assert.equal(hidden.elapsedMs, before.elapsedMs);
    assert.equal(visual.group.visible, false);
  }
  assert.equal(visual.updates.length, updates); assert.equal(visual.renders.length, renders);
  assert.equal(visual.disposals, 0); assert.equal(visual.group.parent, h.scene);
  assert.deepEqual(h.frame(600), before);
  assert.equal(visual.group.visible, true); assert.equal(h.visuals.length, 1);
  assert.deepEqual(h.appearances, [1]); assert.equal(h.frame(1).elapsedMs, 5000);
  h.runtime.dispose();
});

test('optical updates run at 20 Hz while placement, opacity and cache render run every frame', () => {
  const clock = scriptedClock(active()); const h = harness({ clock });
  const elapsedTimes = [0, 16, 32, 48, 64, 80, 96, 112];
  for (const elapsed of elapsedTimes) {
    clock.set(active(elapsed)); h.camera.position.x = 10 + elapsed;
    h.frame(.016);
    const visual = h.visuals[0];
    close(visual.group.position.x, h.camera.position.x + skyDirection.x * 230);
    close(visual.visibility.at(-1).opacity, elapsed / 8000);
    assert.equal(visual.visibility.at(-1).growth, 1);
  }
  const visual = h.visuals[0];
  assert.deepEqual(visual.updates.map(args => args[0]), [50000, 50015, 50030]);
  assert.equal(visual.visibility.length, elapsedTimes.length);
  assert.equal(visual.renders.length, elapsedTimes.length);
  assert.ok(visual.renders.every(renderer => renderer === h.gl));
  assert.deepEqual(h.appearances, [1]); h.runtime.dispose();
});

test('zero-time frozen frames still render for resize and context-restoration cache checks', () => {
  const h = harness({ clock: scriptedClock(active(10000)) });
  h.frame(); const visual = h.visuals[0];
  h.frame(0, { size: { width: 390, height: 844 } }); h.frame(0);
  assert.equal(visual.updates.length, 1);
  assert.equal(visual.renders.length, 3);
  assert.equal(visual.visibility.length, 3);
  h.runtime.dispose();
});

test('reduced motion is forwarded without altering the ambient schedule or hiding its fade', () => {
  const h = harness(); h.frame(0, { reducedMotion: true });
  for (let i = 0; i < 35; i += 1) h.frame(1, { reducedMotion: true });
  const visual = h.visuals[0];
  const state = h.frame(1, { reducedMotion: true });
  assert.equal(state.eventId, 1); assert.equal(state.elapsedMs, 1000); assert.ok(state.opacity > 0);
  assert.ok(visual.updates.every(args => args[1] === true));
  assert.equal(visual.visibility.at(-1).opacity, state.opacity);
  assert.equal(visual.group.visible, true); h.runtime.dispose();
});

test('a reduced-motion preference change applies immediately inside the same optical bucket', () => {
  const h = harness({ clock: scriptedClock(active(10000)) });
  h.frame(0, { reducedMotion: false });
  h.frame(0, { reducedMotion: true });
  assert.deepEqual(h.visuals[0].updates.map(args => args[1]), [false, true]);
  h.frame(0, { reducedMotion: false });
  assert.deepEqual(h.visuals[0].updates.map(args => args[1]), [false, true, false]);
  h.runtime.dispose();
});

test('disposal is idempotent, removes its own diagnostics only, and prevents future allocation', () => {
  const h = harness({ clock: scriptedClock(active(3000)) });
  h.frame(); const visual = h.visuals[0], updates = visual.updates.length;
  h.runtime.dispose(); h.runtime.dispose();
  assert.equal(visual.disposals, 1); assert.equal(visual.group.parent, null);
  assert.deepEqual(h.gl.domElement.dataset, { unrelated: 'preserved' });
  assert.equal(h.frame(1000), null); assert.equal(h.visuals.length, 1); assert.equal(visual.updates.length, updates);
  const waiting = harness(); waiting.frame(); waiting.runtime.dispose();
  assert.equal(waiting.frame(100000), null); assert.equal(waiting.visuals.length, 0);
});

test('the runtime never changes the camera lens, transform, player state or input object', () => {
  const h = harness({ clock: scriptedClock(active(12000)) });
  const camera = cameraState(h.camera);
  const input = Object.freeze({ KeyW: true, KeyA: false, Space: true });
  const player = Object.freeze({ x: 8, y: 1, z: 12, yaw: 1.2, jetpack: false });
  h.frame(.016, { input, player }); h.frame(.016, { input, player, enabled: false });
  assert.deepEqual(cameraState(h.camera), camera);
  assert.deepEqual(input, { KeyW: true, KeyA: false, Space: true });
  assert.deepEqual(player, { x: 8, y: 1, z: 12, yaw: 1.2, jetpack: false });
  h.runtime.dispose(); assert.deepEqual(cameraState(h.camera), camera);
});

test('perspective scenery has a fixed world bearing, moves with translation and vanishes when looking away', () => {
  const group = new THREE.Group(), camera = new THREE.PerspectiveCamera(65, 16 / 9, .08, 420);
  camera.position.set(8, 3, 12); camera.lookAt(camera.position.clone().add(skyDirection)); camera.updateMatrixWorld();
  const before = cameraState(camera);
  placeAmbientBlackHole(group, camera, size);
  assert.deepEqual(cameraState(camera), before);
  close(group.position.distanceTo(camera.position), 230);
  close(group.scale.x * 320, 100);
  const firstBearing = group.position.clone().sub(camera.position).normalize();
  close(firstBearing.distanceTo(skyDirection), 0);
  const firstPosition = group.position.clone();
  const viewed = group.position.clone().applyMatrix4(camera.matrixWorldInverse);
  assert.ok(viewed.z < 0);
  camera.lookAt(camera.position.clone().sub(skyDirection)); camera.updateMatrixWorld();
  placeAmbientBlackHole(group, camera, size);
  close(group.position.distanceTo(firstPosition), 0, 1e-8);
  assert.ok(group.position.clone().applyMatrix4(camera.matrixWorldInverse).z > 0, 'turning away places the body behind the eye, not attached to the screen');
  camera.position.add(new THREE.Vector3(17, 5, -6)); camera.updateMatrixWorld();
  placeAmbientBlackHole(group, camera, size);
  close(group.position.clone().sub(firstPosition).distanceTo(new THREE.Vector3(17, 5, -6)), 0, 1e-8);
  close(group.quaternion.angleTo(camera.quaternion), 0, 1e-7);
});

test('orthographic map lenses never receive a screen-space sky sticker', () => {
  for (const dimensions of [size, { width: 390, height: 844 }]) {
    for (const mode of ['follow', 'overview']) {
      const camera = new THREE.OrthographicCamera(-dimensions.width / 2, dimensions.width / 2, dimensions.height / 2, -dimensions.height / 2, .08, 420);
      camera.zoom = cameraZoom(mode, dimensions.width, dimensions.height);
      const target = new THREE.Vector3(0, 1.2, -2.5);
      camera.position.copy(target).add(new THREE.Vector3(...CAMERA_OFFSETS[mode]));
      camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      const before = cameraState(camera), group = new THREE.Group();
      group.position.set(3, 4, 5);
      assert.equal(placeAmbientBlackHole(group, camera, dimensions), false);
      assert.deepEqual(cameraState(camera), before);
      assert.deepEqual(group.position.toArray(), [3, 4, 5]);
    }
  }
});

test('looking up with the real close-third-person lens reveals the elevated sky event', () => {
  // Match PlayerController's actual view-switch initialization rather than
  // assuming the avatar yaw is zero or the camera looks towards world +Z.
  const yaw = Math.atan2(Math.sin(SPAWN.yaw), -Math.cos(SPAWN.yaw));
  for (const dimensions of [size, { width: 390, height: 844 }]) {
    const aspect = dimensions.width / dimensions.height;
    const shot = closeThirdPersonCamera({ ...SPAWN, y: 0 }, yaw, 1.0, { aspect });
    const camera = new THREE.PerspectiveCamera(closeThirdPersonLens(aspect).fov, aspect, .08, 420);
    camera.position.set(shot.position.x, shot.position.y, shot.position.z);
    camera.lookAt(shot.target.x, shot.target.y, shot.target.z); camera.updateMatrixWorld();
    const before = cameraState(camera), group = new THREE.Group();
    placeAmbientBlackHole(group, camera, dimensions);
    assert.deepEqual(cameraState(camera), before);
    const point = group.position.clone().project(camera);
    const screenX = (point.x + 1) * dimensions.width / 2;
    assert.ok(point.z > -1 && point.z < 1);
    assert.ok(point.y > -1 && point.y < 1, `spawn event is vertically outside ${dimensions.width}px view`);
    if (dimensions.width >= 700) assert.ok(screenX > 0 && screenX < dimensions.width, `desktop event center ${screenX}px outside view`);
    else assert.ok(screenX > 0 && screenX < 390, `portrait event center ${screenX}px is outside the actual spawn view`);
  }
});
