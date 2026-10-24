import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as THREE from 'three';
import * as catalog from '../src/lib/catalog.js';
import { REALISTIC_ISLAND as I, ISLAND_TRAIL, inRealisticIsland, islandHeight } from '../shared/realistic-island.js';
import { getDestination, groundHeight, WORLD_BOUNDS, SPAWN } from '../shared/world.js';
import { followTarget, followOrbitCamera } from '../src/components/town/camera.js';
import { closeThirdPersonCamera } from '../src/components/town/firstPerson.js';
import { sampleIslandCamera, ISLAND_SHOTS, islandCameraFloor } from '../src/components/island/islandCamera.js';
import { spectatorPose } from '../src/components/drone/spectatorOrbit.js';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const file = new URL('src/components/town/PlayerController.jsx', root), require = createRequire(file);
const code = (await transformWithEsbuild(read('src/components/town/PlayerController.jsx'), 'PlayerController.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code;
const elements = (node, list = []) => {
  if (Array.isArray(node)) node.forEach(child => elements(child, list));
  else if (node?.props) { list.push(node); elements(node.props.children, list); }
  return list;
};
function emitter() {
  const events = new Map();
  return { hidden: false,
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); },
    emit(type, details = {}) { for (const fn of events.get(type) || []) fn({ target: { tagName: 'BODY' }, preventDefault() {}, ...details }); },
  };
}

/** Run the real JSX controller/effects with real shared physics, without a DOM or renderer. */
function controllerHarness({ viewMode = 'follow', active = true, remote = false, destination = { id: I.id } } = {}) {
  const contexts = { self: { slots: [], effects: [], pending: [], cursor: 0 }, remote: { slots: [], effects: [], pending: [], cursor: 0 } };
  let context = contexts.self, time = 100000, tree;
  const win = emitter(), doc = emitter(), camera = new THREE.PerspectiveCamera(50, 1280 / 720, .08, 1800);
  camera.position.set(100, 100, 100);
  const inputRef = { current: {} }, playerPoseRef = { current: null }, flightRef = { current: {} };
  const self = { ...SPAWN, id: 'self', seq: 0, y: 0, vy: 0, yaw: 0, connected: true };
  const other = { ...getDestination(I.id), id: 'remote', name: '岛上同行者', y: groundHeight(I.summit.x, I.summit.z), x: I.summit.x, z: I.summit.z,
    seq: 0, connected: true, jetpack: false, thrusting: false, hovering: false, vy: 0, moving: false };
  const snapshotRef = { current: { selfId: 'self', tick: 1, players: [self, other] } };
  const network = remote ? { status: 'connected', selfId: 'self', players: [self, other], snapshotRef, sendInput() {} } : null;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, window: win, document: doc, performance: { now: () => time }, require(id) {
    if (id === 'react') return {
      useRef(value) { const index = context.cursor++; return context.slots[index] ||= { current: value }; },
      useEffect(fn, deps) { const owner = context, index = owner.cursor++, old = owner.effects[index];
        if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) owner.pending.push(() => { old?.cleanup?.(); owner.effects[index] = { deps, cleanup: fn() }; }); },
    };
    if (id === '@react-three/fiber') return { useFrame(fn) { context.frame = fn; }, useThree: () => ({ camera, size: { width: 1280, height: 720 }, invalidate() {} }) };
    if (id === '../../lib/catalog') return catalog;
    if (id === './FirstPersonLook.jsx') return { __esModule: true, default: 'Look' };
    return require(id);
  } });
  const props = { Model: 'Avatar', active, viewMode, inputRef, playerPoseRef, flightRef, destination, network };
  function render(changes = {}) {
    Object.assign(props, changes); context = contexts.self; context.cursor = 0;
    tree = module.exports.default(props); while (context.pending.length) context.pending.shift()();
  }
  render(); let remotePose;
  if (remote) {
    const child = elements(tree).find(node => typeof node.type === 'function' && node.props.player?.id === 'remote');
    context = contexts.remote; context.cursor = 0; remotePose = child.type(child.props).props.poseRef;
    while (context.pending.length) context.pending.shift()();
  }
  return { camera, playerPoseRef, remotePose, inputRef, flightRef, win, doc, render, snapshotRef,
    frame(delta = 1 / 60, kind = 'self') { time += delta * 1000; contexts[kind].frame({}, delta); },
    dispose() { for (const ctx of Object.values(contexts)) for (const effect of ctx.effects) effect?.cleanup?.(); },
  };
}

test('local named travel, walking, blur and focus all preserve the actual elevated support height', () => {
  const app = controllerHarness();
  try {
    const pose = app.playerPoseRef.current;
    assert.ok(inRealisticIsland(pose.x, pose.z)); close(pose.y, islandHeight(pose.x, pose.z));
    app.win.emit('keydown', { code: 'KeyW' });
    for (let i = 0; i < 25; i++) { app.frame(); close(pose.y, groundHeight(pose.x, pose.z)); assert.equal(pose.jetpack, false); }
    app.win.emit('keyup', { code: 'KeyW' });
    app.win.emit('blur'); app.frame(.1); close(pose.y, groundHeight(pose.x, pose.z));
    app.win.emit('focus'); app.frame(.1); close(pose.y, groundHeight(pose.x, pose.z));
    assert.ok(app.camera.position.toArray().every(Number.isFinite));
    assert.ok(app.camera.position.x > 100, 'follow camera must stay at the island instead of clamping to town');
  } finally { app.dispose(); }
});

test('remote non-jetpack mountain snapshots do not sink toward the town zero-height plane when patches stall', () => {
  const app = controllerHarness({ remote: true, destination: null });
  try {
    const floor = groundHeight(I.summit.x, I.summit.z); assert.ok(floor > 30);
    for (let i = 0; i < 90; i++) { app.frame(1 / 60, 'remote'); close(app.remotePose.current.y, floor); assert.equal(app.remotePose.current.jetpack, false); }
  } finally { app.dispose(); }
});

test('island observation never steals the drone, sphere, offshore or island camera lens from their owner', () => {
  for (const viewMode of ['drone', 'sphere', 'offshore', 'island']) {
    const app = controllerHarness({ viewMode, active: false });
    try {
      app.camera.position.set(750, 300, 750); app.camera.fov = 43; app.camera.far = 4000; app.camera.updateProjectionMatrix();
      for (let i = 0; i < 10; i++) app.frame();
      assert.deepEqual(app.camera.position.toArray(), [750, 300, 750]);
      assert.equal(app.camera.fov, 43); assert.equal(app.camera.far, 4000);
    } finally { app.dispose(); }
  }
});

test('follow target retains island coordinates and absolute mountain height without expanding original town bounds', () => {
  assert.deepEqual(WORLD_BOUNDS, { minX: -42.9, maxX: 42.9, minZ: -38.9, maxZ: 40.3 });
  for (const point of [I.arrival, ...ISLAND_TRAIL]) for (const width of [390, 1280]) {
    const pose = { ...point, y: groundHeight(point.x, point.z) }, target = followTarget(pose, width);
    close(target.x, pose.x); assert.ok(Math.abs(target.z - pose.z) < 3); close(target.y, pose.y + 1.2);
  }
});

test('close and follow orbital camera sweeps never place their lens under a walkable mountain surface', () => {
  for (const point of [I.arrival, ...ISLAND_TRAIL]) for (const aspect of [390 / 844, 1280 / 720]) {
    const pose = { ...point, y: groundHeight(point.x, point.z) };
    for (const yaw of [0, Math.PI / 3, Math.PI, -Math.PI / 2]) for (const pitch of [-.5, .5, 1.25]) {
      for (const camera of [closeThirdPersonCamera, followOrbitCamera]) {
        const shot = camera(pose, yaw, pitch, { aspect });
        assert.ok([...Object.values(shot.position), ...Object.values(shot.target)].every(Number.isFinite));
        const p = shot.position;
        if (inRealisticIsland(p.x, p.z)) assert.ok(p.y >= islandHeight(p.x, p.z) + .12, `camera below terrain at ${p.x}, ${p.z}: ${p.y} < ${islandHeight(p.x, p.z)}`);
      }
    }
  }
});

test('the new procedural landmark neither owns a second renderer nor globally changes lighting, sky, tone mapping or fog', () => {
  const visual = read('src/components/island/RealisticIsland.jsx') + read('src/components/island/realisticIslandVisual.js');
  assert.doesNotMatch(visual, /<Canvas\b|new\s+(?:THREE\.)?(?:WebGLRenderer|Scene|PerspectiveCamera)|createRoot\(/);
  assert.doesNotMatch(visual, /scene\.(?:environment|background|fog)\s*=|gl\.(?:toneMapping|outputColorSpace|toneMappingExposure)\s*=|<(?:Environment|Sky)\b/);
  assert.doesNotMatch(visual, /https?:\/\/|useGLTF\(|GLTFLoader|TextureLoader/);
  assert.match(read('src/components/island/IslandGate.jsx'), /lazy\(\(\)\s*=>\s*import\('\.\/RealisticIsland\.jsx'\)\)/);
  assert.doesNotMatch(read('src/components/Town.jsx'), /import\s+RealisticIsland\s+from/);
  assert.equal((read('src/components/Town.jsx').match(/<Canvas\b/g) || []).length, 1);
});

test('all authored island lenses and malformed aspect fallbacks produce finite view/projection matrices', () => {
  assert.deepEqual(ISLAND_SHOTS.map(shot => shot.id), ['aerial', 'coast', 'trail']);
  for (const aspect of [1920 / 1080, 1280 / 720, 390 / 844, 390 / 736, 844 / 390, NaN, Infinity, 0, -1]) {
    for (const shot of [...ISLAND_SHOTS.map(item => item.id), 'not-a-shot', 'constructor', '__proto__', null]) {
      const sample = sampleIslandCamera(shot, aspect);
      assert.ok([...sample.position, ...sample.target, sample.fov, sample.near, sample.far].every(Number.isFinite));
      assert.ok(sample.fov >= 40 && sample.fov <= 70); assert.ok(sample.near > 0 && sample.far > 1000);
      const camera = new THREE.PerspectiveCamera(sample.fov, Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9, sample.near, sample.far);
      camera.position.fromArray(sample.position); camera.lookAt(...sample.target); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
      assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
      assert.ok(camera.matrixWorldInverse.elements.every(Number.isFinite));
      assert.ok(camera.position.distanceTo(new THREE.Vector3(...sample.target)) > 20);
    }
  }
});

test('whole-island aerial lens fits the actual footprint and twelve-metre planting canopy at desktop and portrait sizes', () => {
  for (const [width, height] of [[1920, 1080], [1280, 720], [390, 844], [390, 736], [360, 640]]) {
    const sample = sampleIslandCamera('aerial', width / height), camera = new THREE.PerspectiveCamera(sample.fov, width / height, sample.near, sample.far);
    camera.position.fromArray(sample.position); camera.lookAt(...sample.target); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    for (let x = I.x - I.width / 2; x <= I.x + I.width / 2; x += 3) for (let z = I.z - I.depth / 2; z <= I.z + I.depth / 2; z += 3) {
      if (!inRealisticIsland(x, z)) continue;
      for (const extra of [0, 12]) {
        const point = new THREE.Vector3(x, islandHeight(x, z) + extra, z).project(camera);
        assert.ok(Math.abs(point.x) <= .96, `island horizontal crop at ${width}x${height}`);
        assert.ok(Math.abs(point.y) <= .85, `island vertical crop at ${width}x${height}`);
        assert.ok(point.z > -1 && point.z < 1, 'ground and trees stay in the authored frustum');
      }
    }
  }
});

test('island proximity gate defers the heavy landmark at town startup, detects approach at 4 Hz and retains one mounted landmark', async () => {
  const gateFile = new URL('src/components/island/IslandGate.jsx', root), gateRequire = createRequire(gateFile);
  const gateCode = (await transformWithEsbuild(read('src/components/island/IslandGate.jsx'), 'IslandGate.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code;
  const module = { exports: {} }, slots = []; let cursor = 0, frame;
  vm.runInNewContext(gateCode, { module, exports: module.exports, require(id) {
    if (id === 'react') return { Suspense: 'Suspense', lazy: () => 'LazyIsland',
      useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], value => { slots[index] = value; }]; },
      useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    };
    if (id === '@react-three/fiber') return { useFrame(fn) { frame = fn; } };
    return gateRequire(id);
  } });
  const playerPoseRef = { current: { ...SPAWN, y: 0 } }, props = { playerPoseRef, viewMode: 'overview' };
  const render = changes => { Object.assign(props, changes); cursor = 0; return module.exports.default(props); };
  assert.equal(render(), null);
  for (let i = 0; i < 90; i++) { frame({}, 1 / 60); assert.equal(render(), null); }
  playerPoseRef.current = { x: I.x - 120, y: 20, z: I.z };
  for (let i = 0; i < 20; i++) frame({}, 1 / 60);
  const entered = render(); assert.equal(elements(entered).filter(node => node.type === 'LazyIsland').length, 1);
  playerPoseRef.current = { ...SPAWN, y: 0 };
  for (let i = 0; i < 120; i++) frame({}, 1 / 60);
  const returned = render(); assert.equal(elements(returned).filter(node => node.type === 'LazyIsland').length, 1);
});

test('the atlas actual button travels using only the shared named destination and exposes a separate observation entry', async () => {
  const atlasFile = new URL('src/components/TownAtlas.jsx', root), atlasRequire = createRequire(atlasFile);
  const atlasCode = (await transformWithEsbuild(read('src/components/TownAtlas.jsx'), 'TownAtlas.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code;
  const module = { exports: {} };
  vm.runInNewContext(atlasCode, { module, exports: module.exports, require(id) { return id.endsWith('.css') ? {} : atlasRequire(id); } });
  const travelled = [], observed = [];
  const tree = module.exports.default({ onTravel: value => travelled.push(value), onIslandTour: () => observed.push(true) });
  const controls = elements(tree).filter(node => node.type === 'button');
  const enter = controls.find(node => String(node.props.children).includes('登岛探索'));
  const observe = controls.find(node => String(node.props.children).includes('观景雾岬岛'));
  assert.ok(enter); assert.ok(observe); enter.props.onClick(); observe.props.onClick();
  assert.deepEqual(travelled, [I.id]); assert.deepEqual(observed, [true]);
});

test('deep-link, overview entry, isolated camera branch and explicit explore/return actions remain wired without touching music dispatch', () => {
  const app = read('src/App.jsx'), town = read('src/components/Town.jsx');
  assert.ok(/get\('landmark'\) === 'realistic-island' \? 'island'/.test(app), 'landmark=realistic-island opens island mode');
  assert.ok(/onClick=\{openIsland\}[^>]*>[\s\S]{0,100}探索雾岬岛/.test(app), 'normal town overview has an explicit island entry');
  assert.ok(/onExplore=\{\(\) => travel\(REALISTIC_ISLAND.id\)\}/.test(app));
  assert.ok(/onClose=\{\(\) => travel\('center'\)\}/.test(app));
  assert.ok(/props.viewMode === 'island'[^\n]*<IslandCamera/.test(town));
  assert.ok(/props.viewMode === 'drone'[^\n]*<DroneCamera/.test(town), 'the existing music/drone camera retains its own mode branch');
  assert.ok(/<IslandGate viewMode=\{props.viewMode\} playerPoseRef=\{playerPoseRef\}/.test(town));
  assert.doesNotMatch(read('src/components/island/IslandCamera.jsx'), /MusicRehearsal|createDroneFleet|droneShowClock|(?:window\.)?location\.href\s*=/);
});

test('manual island orbit raises its lens above terrain without moving horizontal intent or altering the common spectator sampler', () => {
  let guarded = 0;
  for (const shot of ISLAND_SHOTS) for (const aspect of [16 / 9, 390 / 844]) for (const zoom of [.45, 1, 2.5]) {
    const original = sampleIslandCamera(shot.id, aspect);
    for (let yaw = -Math.PI; yaw <= Math.PI; yaw += .3) for (let pitch = -1; pitch <= 1; pitch += .2) {
      const orbit = spectatorPose(original, { yaw, pitch }, zoom), before = [...orbit.position];
      const height = islandCameraFloor(orbit.position);
      assert.ok(Number.isFinite(height)); assert.ok(height >= before[1] && height >= 1.2);
      assert.ok(height >= islandHeight(before[0], before[2]) + 1.8 - 1e-9);
      if (height > before[1]) guarded++;
      assert.deepEqual(orbit.position, before, 'scoped guard never changes the shared sampler result in place');
      assert.deepEqual(orbit.target, original.target);
    }
  }
  assert.ok(guarded > 100, 'the authored stress sweep actually exercises previously buried orbit lenses');
});

test('real IslandCamera applies its scoped terrain guard after the shared orbit frame and exposes the final finite lens only', async () => {
  const cameraFile = new URL('src/components/island/IslandCamera.jsx', root), cameraRequire = createRequire(cameraFile);
  const cameraCode = (await transformWithEsbuild(read('src/components/island/IslandCamera.jsx'), 'IslandCamera.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code;
  const module = { exports: {} }, frames = [], cleanups = [];
  vm.runInNewContext(cameraCode, { module, exports: module.exports, require(id) {
    if (id === 'react') return { useRef: current => ({ current }), useEffect: setup => { const cleanup = setup(); if (cleanup) cleanups.push(cleanup); } };
    if (id === '@react-three/fiber') return { useFrame: (callback, priority) => frames.push({ callback, priority }) };
    if (id === '../drone/SpectatorOrbit.jsx') return { __esModule: true, default: 'SpectatorOrbit' };
    return cameraRequire(id);
  } });
  const child = module.exports.default({ shot: 'coast' });
  const base = frames.find(frame => frame.priority < -.09), guard = frames.find(frame => frame.priority > -.09);
  assert.ok(base && guard && guard.priority < 0, 'island frame runs after spectator -.09 and before normal render');
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, .08, 1800), gl = { domElement: { dataset: {} } };
  base.callback({ camera, size: { width: 1280, height: 720 } });
  const orbit = spectatorPose(child.props.poseRef.current, { yaw: -2.84, pitch: -1 }, .45);
  assert.ok(orbit.position[1] < islandHeight(orbit.position[0], orbit.position[2]), 'fixture starts below the terrain');
  camera.position.set(...orbit.position); guard.callback({ camera, gl });
  close(camera.position.x, orbit.position[0]); close(camera.position.z, orbit.position[2]);
  close(camera.position.y, islandHeight(orbit.position[0], orbit.position[2]) + 1.8);
  assert.ok(camera.matrixWorld.elements.every(Number.isFinite));
  const telemetry = JSON.parse(gl.domElement.dataset.islandCamera);
  assert.equal(telemetry.shot, 'coast'); assert.deepEqual(telemetry.position, camera.position.toArray());
  cleanups.forEach(cleanup => cleanup());
  assert.equal(gl.domElement.dataset.islandCamera, undefined, 'unmount removes stale camera telemetry');
});
