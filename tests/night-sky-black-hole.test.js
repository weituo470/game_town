import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DAY_NIGHT_CYCLE_MS, sampleDayNight } from '../shared/dayNight.js';
import { createAmbientBlackHoleClock, sampleAmbientBlackHoleNight } from '../shared/ambientBlackHole.js';
import { createAmbientBlackHoleRuntime, placeAmbientBlackHole } from '../src/components/town/ambientBlackHoleRuntime.js';
import { SPAWN } from '../shared/world.js';
import { closeThirdPersonCamera, closeThirdPersonLens } from '../src/components/town/firstPerson.js';

const NIGHT = DAY_NIGHT_CYCLE_MS / 2;
const size = { width: 1280, height: 720 };
const bearing = new THREE.Vector3(Math.sin(.65), Math.SQRT1_2 * .7, Math.cos(.65)).normalize();
const timeAtElevation = elevation => Math.acos(elevation) / (2 * Math.PI) * DAY_NIGHT_CYCLE_MS;
const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} differs from ${b}`);
const cameraState = camera => ({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
  up: camera.up.toArray(), zoom: camera.zoom, fov: camera.fov, near: camera.near, far: camera.far,
  projection: camera.projectionMatrix.toArray() });

function harness() {
  const clock = createAmbientBlackHoleClock({ random: () => 0 });
  const scene = new THREE.Scene(), gl = { domElement: { dataset: {} } };
  const camera = new THREE.PerspectiveCamera(58, size.width / size.height, .08, 420);
  camera.position.set(10, 3, 20); camera.lookAt(camera.position.clone().add(bearing)); camera.updateMatrixWorld();
  const visuals = [], appearances = [];
  const runtime = createAmbientBlackHoleRuntime({ scene, gl, clock, onAppearance: id => appearances.push(id),
    createVisual(options) {
      const visual = { options, group: new THREE.Group(), visibility: [], updates: [], renders: 0, disposals: 0,
        setAmbientVisibility(state) { this.visibility.push({ ...state }); this.group.visible = state.visible; },
        update(...args) { this.updates.push(args); }, render() { this.renders += 1; }, dispose() { this.disposals += 1; },
      };
      visuals.push(visual); return visual;
    },
  });
  const frame = (delta = 0, options = {}) => runtime.frame({ delta, camera, size, enabled: true, worldTimeMs: NIGHT, ...options });
  const advance = (seconds, options = {}) => { let state; for (let i = 0; i < seconds; i += 1) state = frame(1, options); return state; };
  return { clock, scene, gl, camera, visuals, appearances, runtime, frame, advance };
}

test('night eligibility exactly follows the visible town label, never stars or twilight alone', () => {
  for (let time = -DAY_NIGHT_CYCLE_MS; time <= DAY_NIGHT_CYCLE_MS * 2; time += 125) {
    const state = sampleAmbientBlackHoleNight(time), town = sampleDayNight(time);
    assert.equal(state.eligible, town.label === '夜晚', `eligibility at ${time} (${town.label})`);
    assert.ok(Number.isFinite(state.opacity) && state.opacity >= 0 && state.opacity <= 1);
    if (!state.eligible) assert.equal(state.opacity, 0, `non-night light leakage at ${time}`);
  }
  for (const time of [undefined, NaN, Infinity, -Infinity]) assert.deepEqual(sampleAmbientBlackHoleNight(time), { eligible: false, opacity: 0 });
  assert.deepEqual(sampleAmbientBlackHoleNight(NIGHT), { eligible: true, opacity: 1 });
});

test('both night edges fade inside the night interval rather than over daylight or twilight', () => {
  const elevations = [-.30001, -.33, -.39, -.45, -.48001];
  const values = elevations.map(elevation => sampleAmbientBlackHoleNight(timeAtElevation(elevation)));
  assert.ok(values.every(state => state.eligible));
  assert.ok(values[0].opacity < .001); assert.equal(values.at(-1).opacity, 1);
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i].opacity > values[i - 1].opacity);
  for (const elevation of elevations) {
    const time = timeAtElevation(elevation);
    close(sampleAmbientBlackHoleNight(time).opacity, sampleAmbientBlackHoleNight(DAY_NIGHT_CYCLE_MS - time).opacity);
  }
  for (const elevation of [-.29, 0, .5, 1]) assert.equal(sampleAmbientBlackHoleNight(timeAtElevation(elevation)).opacity, 0);
});

test('daytime waiting reaches zero without starting, looping or resampling, then starts only at night', () => {
  let randomCalls = 0;
  const clock = createAmbientBlackHoleClock({ random: () => { randomCalls += 1; return 0; } });
  let state;
  for (let i = 0; i < 300; i += 1) state = clock.advance(1000, { allowStart: false });
  assert.equal(state.active, false); assert.equal(state.phase, 'waiting'); assert.equal(state.nextInMs, 0);
  assert.equal(state.eventId, 0); assert.equal(randomCalls, 1);
  const started = clock.advance(0, { allowStart: true });
  assert.equal(started.active, true); assert.equal(started.eventId, 1); assert.equal(started.elapsedMs, 0);
});

test('endEvent terminates a partly seen event exactly once; the next night cannot resume its middle', () => {
  let randomCalls = 0;
  const clock = createAmbientBlackHoleClock({ random: () => { randomCalls += 1; return 0; } });
  for (let i = 0; i < 47; i += 1) clock.advance(1000);
  assert.equal(clock.advance(0).elapsedMs, 12000);
  clock.endEvent(); clock.endEvent();
  const ended = clock.advance(0, { allowStart: false });
  assert.equal(ended.active, false); assert.equal(ended.phase, 'waiting'); assert.equal(ended.elapsedMs, 0);
  assert.equal(ended.nextInMs, 180000); assert.equal(ended.eventId, 1); assert.equal(randomCalls, 2);
  for (let i = 0; i < 180; i += 1) clock.advance(1000, { allowStart: false });
  const next = clock.advance(0, { allowStart: true });
  assert.equal(next.eventId, 2); assert.equal(next.elapsedMs, 0); assert.equal(next.phase, 'appearing');
});

test('runtime stays entirely GPU-free in daylight including expired waits and missing world-time input', () => {
  const h = harness();
  try {
    h.frame(0, { worldTimeMs: 0 });
    h.advance(120, { worldTimeMs: 0 });
    h.advance(120, { worldTimeMs: undefined });
    assert.equal(h.visuals.length, 0); assert.equal(h.scene.children.length, 0); assert.deepEqual(h.appearances, []);
    assert.equal(h.clock.advance(0, { allowStart: false }).eventId, 0);
    h.frame(0);
    assert.equal(h.visuals.length, 1); assert.deepEqual(h.appearances, [1]);
  } finally { h.runtime.dispose(); }
});

test('daybreak disposes active sky optics immediately and returning night starts a new event after its cooldown', () => {
  const h = harness();
  try {
    h.frame(); h.advance(35); h.advance(10);
    const first = h.visuals[0], renderCount = first.renders;
    assert.equal(h.clock.advance(0).elapsedMs, 10000);
    h.frame(.016, { worldTimeMs: 0 });
    assert.equal(first.disposals, 1); assert.equal(first.group.parent, null); assert.equal(first.renders, renderCount);
    assert.equal(h.scene.children.length, 0);
    h.frame(0);
    assert.equal(h.visuals.length, 1, 'night immediately after daybreak cannot resume the old event');
    h.advance(180, { worldTimeMs: 0 });
    h.frame(0);
    assert.equal(h.visuals.length, 2); assert.notEqual(h.visuals[1], first);
    assert.deepEqual(h.appearances, [1, 2]);
    assert.equal(h.clock.advance(0).elapsedMs, 0);
  } finally { h.runtime.dispose(); }
});

test('background pauses remain pauses, but daylight invalidates the hidden event rather than preserving stale optics', () => {
  const h = harness();
  try {
    h.frame(); h.advance(35); h.advance(4);
    const first = h.visuals[0], before = h.clock.advance(0);
    h.frame(600, { enabled: false });
    assert.equal(first.disposals, 0); assert.equal(first.group.visible, false);
    assert.equal(h.clock.advance(0).elapsedMs, before.elapsedMs);
    h.frame(600, { enabled: false, worldTimeMs: 0 });
    assert.equal(first.disposals, 1); assert.equal(h.scene.children.length, 0);
    const resumed = h.frame(600);
    assert.equal(resumed.active, false); assert.equal(resumed.phase, 'waiting'); assert.equal(resumed.elapsedMs, 0);
    assert.equal(h.visuals.length, 1);
  } finally { h.runtime.dispose(); }
});

test('night-edge attenuation multiplies the event fade every frame without requiring an optical-time tick', () => {
  const h = harness();
  try {
    h.frame(); h.advance(35); h.advance(12);
    const visual = h.visuals[0], updates = visual.updates.length;
    const edgeTime = timeAtElevation(-.39), night = sampleAmbientBlackHoleNight(edgeTime);
    h.frame(0, { worldTimeMs: edgeTime });
    close(visual.visibility.at(-1).opacity, night.opacity);
    assert.equal(visual.updates.length, updates, 'night fade cannot require expensive optical re-render updates');
    h.frame(0); close(visual.visibility.at(-1).opacity, 1);
    h.frame(0, { worldTimeMs: timeAtElevation(-.29) });
    assert.equal(visual.disposals, 1); assert.equal(h.scene.children.length, 0);
  } finally { h.runtime.dispose(); }
});

test('orthographic exploration never makes a screen sticker, allocates optics or consumes the perspective-only wait', () => {
  const h = harness(), camera = new THREE.OrthographicCamera(-50, 50, 35, -35, .08, 420);
  camera.position.set(72, 90, 102); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const before = cameraState(camera), group = new THREE.Group();
  try {
    assert.equal(placeAmbientBlackHole(group, camera, size), false);
    h.frame(0, { camera }); h.advance(45, { camera });
    assert.equal(h.clock.advance(0).nextInMs, 35000);
    assert.equal(h.visuals.length, 0); assert.deepEqual(h.appearances, []); assert.deepEqual(cameraState(camera), before);
    assert.equal(h.frame(600).nextInMs, 35000, 'returning to perspective discards the stale frame delta');
    h.advance(35);
    assert.equal(h.visuals.length, 1); assert.deepEqual(h.appearances, [1]);
  } finally { h.runtime.dispose(); }
});

test('an active event pauses without a sky lens, yet daybreak still cancels it while orthographic', () => {
  const h = harness(), camera = new THREE.OrthographicCamera(-50, 50, 35, -35, .08, 420);
  camera.position.set(72, 90, 102); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  try {
    h.frame(); h.advance(35); h.advance(6);
    const visual = h.visuals[0], before = h.clock.advance(0), renders = visual.renders;
    h.advance(50, { camera });
    assert.equal(h.clock.advance(0).elapsedMs, before.elapsedMs);
    assert.equal(visual.renders, renders); assert.equal(visual.group.parent, null); assert.equal(visual.disposals, 1);
    h.frame(0, { camera, worldTimeMs: 0 });
    assert.equal(visual.disposals, 1); assert.equal(h.scene.children.length, 0);
    assert.equal(h.frame(600).active, false); assert.equal(h.visuals.length, 1);
  } finally { h.runtime.dispose(); }
});

test('perspective artwork stays entirely above the true horizon even with camera roll and pitch', () => {
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, .08, 420), group = new THREE.Group();
  camera.position.set(4, 2, 5);
  for (const pitch of [-1.2, -.3, 0, .6, 1.2]) for (const yaw of [0, 1, 3, 5]) for (const roll of [0, .7, 1.5]) {
    camera.rotation.set(pitch, yaw, roll, 'YXZ'); camera.updateMatrixWorld();
    const before = cameraState(camera);
    assert.equal(placeAmbientBlackHole(group, camera, size), true); group.updateMatrixWorld();
    assert.deepEqual(cameraState(camera), before);
    close(group.position.distanceTo(camera.position), 230); close(group.scale.x * 320, 100);
    close(group.position.clone().sub(camera.position).normalize().distanceTo(bearing), 0);
    for (const x of [-160, 160]) for (const y of [-90, 90]) {
      const direction = new THREE.Vector3(x, y, 0).applyMatrix4(group.matrixWorld).sub(camera.position).normalize();
      const elevation = Math.asin(direction.y) * 180 / Math.PI;
      assert.ok(elevation > 10, `billboard corner falls below safe sky elevation: ${elevation}`);
    }
  }
});

test('the complete high-sky artwork fits the real spawn lens when the player voluntarily looks up', () => {
  const yaw = Math.atan2(Math.sin(SPAWN.yaw), -Math.cos(SPAWN.yaw));
  for (const dimensions of [size, { width: 390, height: 844 }]) {
    const aspect = dimensions.width / dimensions.height;
    const shot = closeThirdPersonCamera({ ...SPAWN, y: 0 }, yaw, 1, { aspect });
    const camera = new THREE.PerspectiveCamera(closeThirdPersonLens(aspect).fov, aspect, .08, 420);
    camera.position.set(shot.position.x, shot.position.y, shot.position.z);
    camera.lookAt(shot.target.x, shot.target.y, shot.target.z); camera.updateMatrixWorld();
    const before = cameraState(camera), group = new THREE.Group();
    placeAmbientBlackHole(group, camera, dimensions); group.updateMatrixWorld();
    assert.deepEqual(cameraState(camera), before);
    for (const x of [-160, 160]) for (const y of [-90, 90]) {
      const corner = new THREE.Vector3(x, y, 0).applyMatrix4(group.matrixWorld).project(camera);
      assert.ok(Math.abs(corner.x) < 1 && Math.abs(corner.y) < 1 && Math.abs(corner.z) < 1,
        `${dimensions.width}px look-up lens crops the artwork corner at ${corner.toArray()}`);
    }
  }
});

test('real spawn lens is not silently tilted towards the high sky, and user look-away remains effective', () => {
  const yaw = Math.atan2(Math.sin(SPAWN.yaw), -Math.cos(SPAWN.yaw));
  for (const dimensions of [size, { width: 390, height: 844 }]) {
    const aspect = dimensions.width / dimensions.height;
    const shot = closeThirdPersonCamera({ ...SPAWN, y: 0 }, yaw, .12, { aspect });
    const camera = new THREE.PerspectiveCamera(closeThirdPersonLens(aspect).fov, aspect, .08, 420);
    camera.position.set(shot.position.x, shot.position.y, shot.position.z);
    camera.lookAt(shot.target.x, shot.target.y, shot.target.z); camera.updateMatrixWorld();
    const before = cameraState(camera), group = new THREE.Group();
    assert.equal(placeAmbientBlackHole(group, camera, dimensions), true);
    assert.deepEqual(cameraState(camera), before);
    const worldPosition = group.position.clone();
    camera.lookAt(camera.position.clone().add(bearing)); camera.updateMatrixWorld();
    assert.equal(placeAmbientBlackHole(group, camera, dimensions), true);
    close(group.position.clone().project(camera).length(), Math.abs(group.position.clone().project(camera).z));
    camera.lookAt(camera.position.clone().sub(bearing)); camera.updateMatrixWorld();
    placeAmbientBlackHole(group, camera, dimensions);
    close(group.position.distanceTo(worldPosition), 0);
    assert.ok(group.position.clone().applyMatrix4(camera.matrixWorldInverse).z > 0, 'looking away must leave the sky body behind the eye');
  }
});

test('night gating and reduced motion never mutate input, player pose or the camera, including disposal', () => {
  const h = harness(), input = Object.freeze({ KeyW: true, Space: true }), player = Object.freeze({ ...SPAWN, y: 0 });
  const before = cameraState(h.camera);
  try {
    h.frame(); h.advance(35);
    h.frame(.016, { reducedMotion: true, input, player });
    h.frame(.016, { worldTimeMs: 0, input, player });
    assert.deepEqual(cameraState(h.camera), before);
    assert.deepEqual(input, { KeyW: true, Space: true }); assert.deepEqual(player, { ...SPAWN, y: 0 });
    const visual = h.visuals[0]; h.runtime.dispose(); h.runtime.dispose(); assert.equal(visual.disposals, 1);
    assert.deepEqual(cameraState(h.camera), before);
    assert.equal(h.frame(600), null); assert.equal(h.visuals.length, 1);
  } finally { h.runtime.dispose(); }
});
