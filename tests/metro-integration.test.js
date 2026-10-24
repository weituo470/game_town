import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as THREE from 'three';
import * as jsx from 'react/jsx-runtime';
import * as catalog from '../src/lib/catalog.js';
import * as metro from '../shared/metro-island.js';
import * as island from '../shared/realistic-island.js';
import * as world from '../shared/world.js';
import * as dayNight from '../shared/dayNight.js';
import { flightFloor } from '../shared/jetpack.js';
import { METRO_SHOTS, sampleMetroCamera, metroCameraFloor } from '../src/components/metro/metroCamera.js';
import { closeThirdPersonCamera } from '../src/components/town/firstPerson.js';
import { followTarget, followOrbitCamera } from '../src/components/town/camera.js';
import { spectatorPose } from '../src/components/drone/spectatorOrbit.js';

const M = metro.METRO_ISLAND, root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const all = (node, list = []) => { if (Array.isArray(node)) node.forEach(child => all(child, list)); else if (node?.props) { list.push(node); all(node.props.children, list); } return list; };
const label = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(label).join('') : node?.props ? label(node.props.children) : '';
async function evaluate(path, overrides = {}, globals = {}) {
  const require = createRequire(new URL(path, root));
  const code = (await transformWithEsbuild(read(path), path, { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, ...globals, require(id) {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    return id.endsWith('.css') ? {} : require(id);
  } });
  return module.exports;
}
function emitter() {
  const events = new Map();
  return { hidden: false, addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); },
    emit(type, details = {}) { for (const fn of events.get(type) || []) fn({ target: { tagName: 'BODY' }, preventDefault() {}, ...details }); },
    listeners: () => [...events.values()].reduce((sum, group) => sum + group.size, 0),
  };
}
async function controllerHarness(viewMode = 'first-person', active = true) {
  let time = 100000, frame;
  const win = emitter(), doc = emitter(), cleanups = [];
  const camera = new THREE.PerspectiveCamera(58, 1280 / 720, .08, 1800);
  const playerPoseRef = { current: null }, inputRef = { current: {} };
  const module = await evaluate('src/components/town/PlayerController.jsx', {
    react: { useRef: current => ({ current }), useEffect: setup => { const cleanup = setup(); if (cleanup) cleanups.push(cleanup); } },
    '@react-three/fiber': { useFrame: callback => { frame = callback; }, useThree: () => ({ camera, size: { width: 1280, height: 720 }, invalidate() {} }) },
    '../../lib/catalog': catalog, './FirstPersonLook.jsx': { __esModule: true, default: 'Look' },
  }, { window: win, document: doc, performance: { now: () => time } });
  module.default({ Model: 'Avatar', active, viewMode, inputRef, playerPoseRef, destination: { id: M.id } });
  return { camera, playerPoseRef, inputRef, win, doc,
    frame(dt = 1 / 60) { time += dt * 1000; frame({}, dt); },
    dispose() { cleanups.forEach(cleanup => cleanup()); },
  };
}

test('metro named travel and real controller walk/focus use the same flat shared streets without returning to town', async () => {
  const app = await controllerHarness();
  try {
    const p = app.playerPoseRef.current;
    assert.equal(p.x, M.arrival.x); assert.equal(p.z, M.arrival.z); assert.equal(p.y, M.groundY);
    app.win.emit('keydown', { code: 'KeyW' });
    for (let i = 0; i < 45; i++) { app.frame(); assert.equal(p.y, M.groundY); assert.ok(world.isWalkable(p.x, p.z)); }
    assert.ok(p.z < M.arrival.z - 2, 'the character actually moves down the central avenue');
    app.win.emit('keyup', { code: 'KeyW' }); app.win.emit('blur'); app.frame(.1);
    assert.equal(p.y, M.groundY); app.win.emit('focus'); app.frame();
    assert.ok(app.camera.position.z < -150, 'the close lens stays at the city');
    for (const width of [390, 1280]) { const target = followTarget(p, width); close(target.x, p.x); assert.ok(Math.abs(target.z - p.z) < 3); }
  } finally { app.dispose(); }
});

test('real parked controller never writes the privately-owned metro or existing show lens', async () => {
  for (const mode of ['metro', 'island', 'drone', 'sphere', 'offshore']) {
    const app = await controllerHarness(mode, false);
    try {
      app.camera.position.set(550, 200, -450); app.camera.fov = 47; app.camera.far = 4000;
      for (let i = 0; i < 10; i++) app.frame();
      assert.deepEqual(app.camera.position.toArray(), [550, 200, -450]);
      assert.equal(app.camera.fov, 47); assert.equal(app.camera.far, 4000);
    } finally { app.dispose(); }
  }
});

test('city lenses and malformed shot/aspect fallbacks stay finite with independent near/far clipping', () => {
  assert.deepEqual(METRO_SHOTS.map(item => item.id), ['skyline', 'avenue', 'waterfront']);
  for (const shot of [...METRO_SHOTS.map(item => item.id), 'unknown', '__proto__', 'constructor', null]) {
    for (const aspect of [16 / 9, 390 / 844, 390 / 736, 844 / 390, 0, NaN, Infinity, -1]) {
      const pose = sampleMetroCamera(shot, aspect);
      assert.ok([...pose.position, ...pose.target, pose.fov, pose.near, pose.far].every(Number.isFinite));
      assert.ok(pose.near > 0 && pose.far >= 1800 && pose.fov >= 40 && pose.fov < 75);
      const c = new THREE.PerspectiveCamera(pose.fov, Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9, pose.near, pose.far);
      c.position.fromArray(pose.position); c.lookAt(...pose.target); c.updateMatrixWorld(true);
      assert.ok(c.matrixWorld.elements.every(Number.isFinite)); assert.ok(c.projectionMatrix.elements.every(Number.isFinite));
    }
  }
});

test('skyline establishes the complete authored building envelope on desktop and narrow phones', () => {
  for (const [width, height] of [[1920, 1080], [1280, 720], [390, 844], [390, 736], [360, 640]]) {
    const pose = sampleMetroCamera('skyline', width / height), camera = new THREE.PerspectiveCamera(pose.fov, width / height, pose.near, pose.far);
    camera.position.fromArray(pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld(true);
    for (const b of metro.METRO_BUILDINGS) for (const dx of [-b.width / 2, b.width / 2]) for (const dz of [-b.depth / 2, b.depth / 2]) for (const y of [0, b.height]) {
      const p = new THREE.Vector3(b.x + dx, y, b.z + dz).project(camera);
      assert.ok(Math.abs(p.x) < .93, `horizontal tower crop ${b.id} at ${width}x${height}`);
      assert.ok(Math.abs(p.y) < .80, `vertical tower crop ${b.id} at ${width}x${height}`);
      assert.ok(p.z > -1 && p.z < 1);
    }
  }
});

test('close/follow camera booms respect shared skyscraper walls at ground and roof heights', () => {
  for (const b of metro.METRO_BUILDINGS.filter((_, i) => i % 3 === 0)) for (const aspect of [16 / 9, 390 / 844]) {
    const x = b.x + b.width / 2 + 1.2, z = b.z;
    assert.ok(world.isWalkable(x, z));
    for (const y of [0, b.height + .12]) for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      for (const sample of [closeThirdPersonCamera, followOrbitCamera]) {
        const shot = sample({ x, z, y }, yaw, .12, { aspect }), p = shot.position;
        assert.ok(Object.values(p).every(Number.isFinite));
        assert.ok(p.y >= flightFloor(p.x, p.z) + .12, `${b.id} camera inside shared collision envelope`);
      }
    }
  }
});

test('manual metro orbit lifts above any rooftop without mutating the shared programme orbit result', () => {
  let corrected = 0;
  for (const shot of METRO_SHOTS) for (const aspect of [16 / 9, 390 / 844]) for (const zoom of [.45, 1, 2.5]) {
    const base = sampleMetroCamera(shot.id, aspect);
    for (let yaw = -Math.PI; yaw < Math.PI; yaw += .25) for (let pitch = -1; pitch <= 1; pitch += .2) {
      const orbit = spectatorPose(base, { yaw, pitch }, zoom), before = [...orbit.position], floor = metroCameraFloor(before);
      assert.ok(Number.isFinite(floor) && floor >= before[1] && floor >= metro.metroFlightFloor(before[0], before[2]) + 1.7);
      if (floor > before[1]) corrected++;
      assert.deepEqual(orbit.position, before); assert.deepEqual(orbit.target, base.target);
    }
  }
  assert.ok(corrected > 20, 'stress sweep actually covers street/roof collisions');
});

test('real MetroCamera orders final roof correction after orbit and cleans its DOM telemetry on unmount', async () => {
  const frames = [], cleanups = [];
  const module = await evaluate('src/components/metro/MetroCamera.jsx', {
    react: { useRef: current => ({ current }), useEffect: setup => { const cleanup = setup(); if (cleanup) cleanups.push(cleanup); } },
    '@react-three/fiber': { useFrame: (callback, priority) => frames.push({ callback, priority }) },
    '../drone/SpectatorOrbit.jsx': { __esModule: true, default: 'Orbit' },
  });
  module.default({ shot: 'avenue' });
  const base = frames.find(item => item.priority < -.09), final = frames.find(item => item.priority > -.09);
  assert.ok(base && final && final.priority < 0);
  const camera = new THREE.PerspectiveCamera(), gl = { domElement: { dataset: {} } };
  base.callback({ camera, size: { width: 1280, height: 720 } });
  const b = metro.METRO_BUILDINGS.at(-1); camera.position.set(b.x, 2, b.z); final.callback({ camera, gl });
  close(camera.position.y, metro.metroFlightFloor(b.x, b.z) + 1.7);
  assert.ok(camera.matrixWorld.elements.every(Number.isFinite));
  assert.deepEqual(JSON.parse(gl.domElement.dataset.metroCamera).position, camera.position.toArray());
  cleanups.forEach(cleanup => cleanup()); assert.equal(gl.domElement.dataset.metroCamera, undefined);
});

test('heavy city gate stays unloaded in town, loads on approach or observation, reports readiness and retries by revision', async () => {
  const slots = []; let cursor = 0, frame;
  const module = await evaluate('src/components/metro/MetroGate.jsx', {
    react: { Suspense: 'Suspense', lazy: () => 'LazyMetro', useCallback: fn => fn,
      useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
      useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], value => { slots[i] = value; }]; },
    }, '@react-three/fiber': { useFrame: callback => { frame = callback; } },
  });
  const statuses = [], props = { playerPoseRef: { current: world.SPAWN }, viewMode: 'overview', onStatus: status => statuses.push(status), revision: 0 };
  const render = changes => { Object.assign(props, changes); cursor = 0; return module.default(props); };
  assert.equal(render(), null); for (let i = 0; i < 90; i++) { frame({}, 1 / 60); assert.equal(render(), null); }
  props.playerPoseRef.current = { x: M.x, z: M.z + 150 };
  for (let i = 0; i < 20; i++) frame({}, 1 / 60);
  let lazy = all(render()).find(node => node.type === 'LazyMetro'); assert.ok(lazy); lazy.props.onReady(); lazy.props.onError();
  assert.deepEqual(statuses, ['ready', 'error']);
  const originalKey = lazy.key; lazy = all(render({ revision: 1 })).find(node => node.type === 'LazyMetro'); assert.notEqual(lazy.key, originalKey);
  props.playerPoseRef.current = world.SPAWN; for (let i = 0; i < 90; i++) frame({}, 1 / 60);
  assert.equal(all(render()).filter(node => node.type === 'LazyMetro').length, 1);
  slots.length = 0;
  assert.equal(all(render({ viewMode: 'metro' })).filter(node => node.type === 'LazyMetro').length, 1, 'a direct observation entry mounts immediately even while the avatar is still in town');
});

test('metro controls guard unfinished loading, expose failure/retry, and remove Escape listeners on unmount', async () => {
  const win = emitter(), cleanups = [], calls = [];
  const module = await evaluate('src/components/metro/MetroControls.jsx', {
    react: { useEffect: setup => { const cleanup = setup(); if (cleanup) cleanups.push(cleanup); } },
  }, { window: win });
  const props = { shot: 'skyline', onShot: id => calls.push(id), onExplore() {}, onClose: () => calls.push('close'), onRetry: () => calls.push('retry'), onDay() {}, day: true };
  let nodes = all(module.default(props));
  assert.equal(nodes.find(node => node.props.className === 'metro-enter').props.disabled, true);
  cleanups.splice(0).forEach(cleanup => cleanup());
  nodes = all(module.default({ ...props, status: 'error' }));
  nodes.find(node => node.type === 'button' && label(node) === '重新加载').props.onClick(); assert.deepEqual(calls, ['retry']);
  win.emit('keydown', { key: 'Escape' }); assert.deepEqual(calls, ['retry', 'close']);
  cleanups.splice(0).forEach(cleanup => cleanup()); assert.equal(win.listeners(), 0);
  nodes = all(module.default({ ...props, status: 'ready' }));
  assert.equal(nodes.find(node => node.props.className === 'metro-enter').props.disabled, false);
  for (const button of nodes.filter(node => node.type === 'button')) assert.equal(button.props.type, 'button');
  cleanups.splice(0).forEach(cleanup => cleanup());
});

test('atlas buttons keep metro observation distinct from named authoritative arrival, preserving older island entries', async () => {
  const module = await evaluate('src/components/TownAtlas.jsx'), calls = [];
  const nodes = all(module.default({ onTravel: id => calls.push(id), onMetroTour: () => calls.push('observe'), onIslandTour() {} }));
  const area = nodes.find(node => node.props['aria-label'] === '临湾都会导航'), buttons = all(area).filter(node => node.type === 'button');
  assert.equal(buttons.length, 2); buttons[0].props.onClick(); buttons[1].props.onClick();
  assert.deepEqual(calls, ['observe', M.id]); assert.ok(nodes.find(node => node.props['aria-label'] === '雾岬岛导航'));
});

test('metro shares the one Canvas and isolates its lazy camera/rendering/UI branch from existing programmes', () => {
  const town = read('src/components/Town.jsx'), app = read('src/App.jsx'), gate = read('src/components/metro/MetroGate.jsx');
  assert.equal((town.match(/<Canvas\b/g) || []).length, 1);
  assert.ok(/get\('landmark'\) === 'metro-island' \? 'metro'/.test(app));
  assert.ok(/onExplore=\{\(\) => travel\(METRO_ISLAND.id\)\}/.test(app));
  assert.ok(/onMetroTour=\{openMetro\}/.test(app));
  assert.ok(/props.viewMode === 'metro'[^\n]*<MetroCamera/.test(town));
  assert.ok(/props.viewMode === 'island'[^\n]*<IslandCamera/.test(town));
  assert.ok(/props.viewMode === 'drone'[^\n]*<DroneCamera/.test(town));
  assert.ok(/lazy\(\(\)\s*=>\s*import\('\.\/MetroIsland\.jsx'\)\)/.test(gate));
  for (const file of ['src/components/metro/MetroCamera.jsx', 'src/components/metro/MetroGate.jsx']) assert.doesNotMatch(read(file), /new\s+(?:THREE\.)?(?:Scene|WebGLRenderer)|<Canvas\b|createDroneFleet|droneShowClock/);
});

test('real TownSky recenters only metro observation or local metro exploration; show and old island lights/fog stay scoped', async () => {
  for (const mode of ['metro', 'follow', 'first-person', 'island', 'overview', 'drone', 'sphere', 'offshore', 'wonder']) {
    let frame;
    const module = await evaluate('src/components/town/TownSky.jsx', {
      react: { useRef: current => ({ current }), useMemo: fn => fn() }, 'react/jsx-runtime': jsx,
      '@react-three/fiber': { useFrame: callback => { frame = callback; } },
    });
    const poseRef = { current: { ...M.arrival, y: 0 } }, timeRef = { current: 0 };
    const nodes = all(module.default({ playerPoseRef: poseRef, timeRef, viewMode: mode }));
    const sun = new THREE.DirectionalLight(), fogNode = nodes.find(node => node.type === 'fog'), fog = new THREE.Fog(...fogNode.props.args);
    nodes.find(node => node.type === 'directionalLight' && node.props.castShadow).props.ref.current = sun;
    fogNode.props.ref.current = fog;
    const camera = new THREE.PerspectiveCamera(); camera.position.y = 20;
    for (const t of [0, 450000]) {
      timeRef.current = t; frame({ camera, size: { width: 1280, height: 720 }, clock: { elapsedTime: 15 } });
      const metroFocus = ['metro', 'follow', 'first-person'].includes(mode), expected = metroFocus ? [mode === 'metro' ? M.x : M.arrival.x, 35, mode === 'metro' ? M.z : M.arrival.z] : mode === 'island' ? [island.REALISTIC_ISLAND.x, 12, island.REALISTIC_ISLAND.z] : [0, 0, 0];
      assert.deepEqual(sun.target.position.toArray(), expected);
      assert.equal(sun.shadow.camera.right, metroFocus ? 190 : 105); assert.equal(sun.shadow.camera.far, metroFocus ? 520 : 360);
      assert.equal(sun.intensity, dayNight.sampleDayNight(t).sunIntensity);
      assert.equal(fog.near, mode === 'metro' ? 1025 : mode === 'island' ? 475 : 175);
      assert.equal(fog.far, mode === 'metro' ? 1190 : mode === 'island' ? 640 : 340);
    }
  }
});
