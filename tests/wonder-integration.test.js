import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as React from 'react';
import * as THREE from 'three';
import * as world from '../shared/world.js';
import * as catalog from '../src/lib/catalog.js';
import { WONDERS, WONDER_CYCLE_MS, sampleOrca, sampleJet, sampleRocket } from '../shared/wonders.js';
import { sampleDayNight } from '../shared/dayNight.js';
import { townWonderCamera } from '../src/components/town/camera.js';

// Compile the production components, then exercise their actual render trees and
// callback transitions. No source-text snapshots or browser/WebGL claims here.
const paths = ['src/App.jsx', 'src/components/Town.jsx', 'src/components/town/WonderIslands.jsx', 'src/components/town/TownWater.jsx'];
const compiled = new Map(await Promise.all(paths.map(async path => {
  const file = new URL(`../${path}`, import.meta.url);
  const result = await transformWithEsbuild(fs.readFileSync(file, 'utf8'), path, { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
  return [path, { code: result.code, require: createRequire(file) }];
})));
function evaluate(path, overrides = {}, globals = {}) {
  const module = { exports: {} }, item = compiled.get(path);
  vm.runInNewContext(item.code, { module, exports: module.exports, ...globals, require(id) {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id.endsWith('.css')) return {};
    return item.require(id);
  } });
  return module.exports;
}
function elements(node, list = []) {
  if (Array.isArray(node)) node.forEach(child => elements(child, list));
  else if (React.isValidElement(node)) { list.push(node); elements(node.props.children, list); }
  return list;
}
function hooks() {
  const slots = [], frames = [];
  let cursor = 0;
  return {
    frames, reset() { cursor = 0; frames.length = 0; },
    react: { ...React,
      useState(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }]; },
      useRef(initial) { const slot = cursor++; return slots[slot] ||= { current: initial }; },
      useMemo: fn => fn(), useCallback: fn => fn, useEffect() {}, useLayoutEffect() {},
      lazy: loader => ({ $$typeof: Symbol.for('react.lazy'), loader }),
    },
  };
}
const componentNamespace = name => new Proxy({ __esModule: true, default: name }, { get(target, key) { return key in target ? target[key] : `${name}:${String(key)}`; } });
const finiteNumbers = (value, label) => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), label);
  else if (value && typeof value === 'object') for (const [key, next] of Object.entries(value)) finiteNumbers(next, `${label}.${key}`);
};

test('integrated wonders: all shared poses remain finite through every phase, wrap and invalid clock input', () => {
  const times = [NaN, Infinity, -Infinity, undefined, -1, 0, 39999, 40000, 59999, 60000, 104999, 105000, 119999, 120000, 129999, 130000, 132999, 133000, 151999, 152000, 159999, 160000, WONDER_CYCLE_MS];
  for (let t = 0; t < WONDER_CYCLE_MS; t += 113) times.push(t);
  const samplers = [t => sampleOrca(t, 0), t => sampleOrca(t, 1), sampleJet, sampleRocket];
  for (const [index, sample] of samplers.entries()) for (const time of times) {
    finiteNumbers(sample(time), `sampler ${index}, time ${time}`);
    if (Number.isFinite(time)) assert.deepEqual(sample(time), sample(time + WONDER_CYCLE_MS));
  }
});

function observationCamera(wonder, time, aspect, reduced = false) {
  const shot = townWonderCamera(wonder.arrival, time, aspect, reduced);
  const camera = new THREE.PerspectiveCamera(shot.fov, aspect, .08, 420);
  camera.position.set(...shot.position); camera.lookAt(...shot.target); camera.updateMatrixWorld(true);
  return { shot, camera };
}
test('integrated observation: each approved arrival frames its own site and portrait backs away rather than cropping horizontally', () => {
  for (const wonder of WONDERS) {
    const pose = { ...wonder.arrival }, before = { ...pose };
    const desktop = observationCamera(wonder, wonder.start, 1440 / 900), phone = observationCamera(wonder, wonder.start, 390 / 844);
    assert.equal(desktop.shot.id, wonder.id); assert.equal(phone.shot.id, wonder.id);
    assert.ok(phone.camera.position.distanceTo(new THREE.Vector3(...phone.shot.target)) > desktop.camera.position.distanceTo(new THREE.Vector3(...desktop.shot.target)) * 1.2);
    assert.ok(phone.shot.fov >= desktop.shot.fov);
    for (const { camera, shot } of [desktop, phone]) {
      finiteNumbers(shot, wonder.id);
      const center = new THREE.Vector3(wonder.id === 'orca' ? -64 : wonder.id === 'carrier' ? 63 : 0, wonder.id === 'rocket' ? 7 : 1.5, wonder.id === 'rocket' ? -61 : wonder.z).project(camera);
      assert.ok(Math.abs(center.x) < .8 && Math.abs(center.y) < .8, `${wonder.id}: site center outside usable frame ${center.toArray()}`);
    }
    townWonderCamera(pose, 145000, .46); assert.deepEqual(pose, before, 'looking never moves the player');
  }
});
test('integrated observation: complete visible rocket stays in the perspective frustum throughout ascent on desktop and phone', () => {
  const wonder = WONDERS.find(w => w.id === 'rocket');
  for (const aspect of [1440 / 900, 390 / 736, 390 / 844]) for (let time = 133000; time < 152000; time += 137) {
    const pose = sampleRocket(time), { camera } = observationCamera(wonder, time, aspect);
    // TownRocket uses 0.2 scale, nozzle y=.85 and a 66m body/fairing.
    for (const y of [.85 + pose.height, .85 + pose.height + 13.2]) {
      const point = new THREE.Vector3(0, y, -61).project(camera);
      assert.ok(Math.abs(point.x) < .95 && Math.abs(point.y) < .95 && point.z > -1 && point.z < 1, `ascent ${time}, aspect ${aspect}, projected ${point.toArray()}`);
    }
  }
  const pad = townWonderCamera(wonder.arrival, 120000, 1.6), rising = townWonderCamera(wonder.arrival, 148000, 1.6);
  assert.ok(rising.target[1] - pad.target[1] > 40);
  assert.deepEqual(townWonderCamera(wonder.arrival, 148000, 1.6, true), townWonderCamera(wonder.arrival, 120000, 1.6, true));
});
test('integrated observation: portrait contains every deck and lagoon promenade corner without shrinking them to a distant speck', () => {
  for (const [id, bounds] of [['carrier', [54, 72, 5, 35]], ['orca', [-77, -49, 6, 34]]]) {
    const wonder = WONDERS.find(w => w.id === id);
    for (const aspect of [390 / 736, 390 / 844]) {
      const { camera } = observationCamera(wonder, 0, aspect), projected = [];
      // The full original footprint plus an 8m vertical envelope also protects
      // the bridge mast / leaping whale, not just an easy-to-fit center point.
      for (const x of bounds.slice(0, 2)) for (const z of bounds.slice(2)) for (const y of [0, 8]) {
        const point = new THREE.Vector3(x, y, z).project(camera); projected.push(point);
        assert.ok(Math.abs(point.x) < .94 && Math.abs(point.y) < .94 && point.z > -1 && point.z < 1, `${id} ${aspect} boundary [${x},${y},${z}] clipped: ${point.toArray()}`);
      }
      const width = Math.max(...projected.map(p => p.x)) - Math.min(...projected.map(p => p.x));
      assert.ok(width > 1.5, `${id} should still occupy at least 75% of the phone width`);
      const town = new THREE.Vector3(0, 7, 0).project(camera);
      assert.ok(Math.abs(town.x) < 1 && Math.abs(town.y) < 1 && town.z < 1, `${id} must retain the original town skyline`);
    }
  }
});

function appHarness(search = '') {
  const h = hooks(), sceneType = 'TownScene', scheduleType = 'WonderSchedule', hudType = 'WonderHud';
  const drone = { state: { active: false }, timeRef: { current: 0 }, start() { this.state.active = true; }, close() { this.state.active = false; } };
  const overrides = { react: h.react,
    './lib/useMultiplayer.js': { __esModule: true, default: () => ({}) },
    './lib/useWorldClock.js': { __esModule: true, default: () => ({ timeRef: { current: 145000 }, label: '白天' }) },
    './lib/profile.js': { loadProfile: () => ({ visits: [], dismissed: [] }), getCompletion: () => 0 },
    './lib/gameCharacterClient.js': { gameCharacterClient: {} },
    './lib/marketRecommendations.js': {},
    './lib/catalog.js': catalog, '../shared/world.js': world,
    './components/Town.jsx': { __esModule: true, default: sceneType },
    './components/WonderSchedule.jsx': { __esModule: true, default: scheduleType, WonderHud: hudType },
    './components/drone/DroneShowControls.jsx': { __esModule: true, default: 'DroneControls', useDroneShowController: () => drone },
    './components/OutdoorPlay.jsx': { useOutdoorPlay: () => ({ runtimeRef: { current: null }, selected: null, exit() {} }), OutdoorLauncher: 'OutdoorLauncher', OutdoorHud: 'OutdoorHud' },
  };
  for (const id of ['./components/TownAtlas.jsx', './components/FlightStatus.jsx', './components/MiniGame.jsx', './components/MarketRecommendations.jsx', './components/NpcDirectory.jsx', './components/MultiplayerPanel.jsx', './components/DayNightControls.jsx']) overrides[id] = componentNamespace(id);
  const app = evaluate('src/App.jsx', overrides, { URLSearchParams, requestAnimationFrame: fn => fn(), window: { location: { search }, matchMedia: () => ({ matches: false }) }, document: { exitPointerLock() {}, querySelector: () => null } });
  let tree;
  function render() { h.reset(); tree = app.default(); return elements(tree); }
  return { render, scene: () => elements(tree).find(n => n.type === sceneType), schedule: () => elements(tree).find(n => n.type === scheduleType), hud: () => elements(tree).find(n => n.type === hudType),
    assertTownOnly() { const nodes = elements(tree); assert.equal(nodes.filter(n => n.type === sceneType).length, 1); assert.equal(nodes.filter(n => n.type?.$$typeof === Symbol.for('react.lazy')).length, 0, 'wonder actions must not mount a standalone lazy experience'); assert.equal(this.scene().props.suspended, false); },
  };
}
test('integrated navigation: all wonder deep links open the original Town directly, invalid IDs remain the normal overview', () => {
  for (const id of ['orca', 'carrier', 'rocket', 'invalid']) {
    const app = appHarness(`?wonder=${id}`); app.render(); app.assertTownOnly();
    assert.equal(app.scene().props.viewMode, id === 'invalid' ? 'overview' : 'wonder');
    assert.equal(app.scene().props.destination?.id ?? null, id === 'invalid' ? null : id);
    assert.equal(app.scene().props.active, true);
  }
});
test('integrated navigation: schedule observation, HUD return, walking and on-foot travel retain one town instead of opening cinema', () => {
  const app = appHarness(); let nodes = app.render();
  for (const wonder of WONDERS) {
    nodes.find(n => n.type === 'button' && n.props.className?.includes('wonder-nav')).props.onClick();
    nodes = app.render(); assert.ok(app.schedule());
    app.schedule().props.onImmerse(wonder.id); nodes = app.render(); app.assertTownOnly();
    assert.equal(app.scene().props.viewMode, 'wonder'); assert.equal(app.scene().props.destination.id, wonder.id); assert.equal(app.scene().props.active, true);
    app.scene().props.onNearestWonder(wonder.id); nodes = app.render(); assert.equal(app.hud().props.observing, true);
    const destination = app.scene().props.destination;
    app.hud().props.onObserve(); nodes = app.render(); app.assertTownOnly();
    assert.equal(app.scene().props.viewMode, 'first-person'); assert.equal(app.scene().props.destination, destination, 'return to avatar does not teleport');
    app.hud().props.onObserve(); app.render(); app.scene().props.onStartExploring(); nodes = app.render();
    assert.equal(app.scene().props.viewMode, 'first-person', 'walking exits observation into the controllable close view');
    nodes.find(n => n.type === 'button' && n.props.className?.includes('wonder-nav')).props.onClick(); app.render();
    app.schedule().props.onTravel(wonder.id); nodes = app.render(); app.assertTownOnly();
    assert.equal(app.scene().props.viewMode, 'first-person'); assert.equal(app.scene().props.destination.id, wonder.id);
  }
});

test('drone observation: one existing town, private show clock, night lighting and reversible camera without travel', () => {
  const app = appHarness(); let nodes = app.render();
  app.scene().props.onStartExploring(); nodes = app.render();
  const before = app.scene().props;
  assert.equal(before.viewMode, 'follow');
  nodes.find(n => n.props.className === 'drone-town-entry').props.onClick();
  nodes = app.render();
  assert.ok(app.schedule(), 'the main entry opens a catalogue rather than forcing the latest drone show');
  assert.equal(app.scene().props.viewMode, 'follow');
  assert.equal(nodes.some(n => n.type === 'DroneControls'), false);
  app.schedule().props.onDroneShow('avatar');
  nodes = app.render(); app.assertTownOnly();
  const watching = app.scene().props;
  assert.equal(watching.viewMode, 'drone');
  assert.equal(watching.active, false, 'held movement is disabled while watching');
  assert.equal(watching.timeRef.current, 90000, 'night is local lighting only');
  assert.equal(watching.npcTimeRef.current, before.npcTimeRef.current, 'NPC/shared time keeps running');
  assert.equal(watching.droneTimeRef.current, 0, 'manual show begins with launch, not the avatar shortcut');
  assert.equal(watching.destination, before.destination, 'watching never teleports the player');
  nodes.find(n => n.type === 'DroneControls').props.onClose();
  nodes = app.render();
  assert.equal(app.scene().props.viewMode, 'follow');
  assert.equal(app.scene().props.active, true);
  assert.equal(nodes.some(n => n.type === 'DroneControls'), false);
});

function townHarness(mode, onReady) {
  const h = hooks();
  const imports = ['./DuskScenery', './town/PlayerController', './town/SceneEffects', './town/SoftPenumbra', './town/characters/Residents', './town/landmarks/LandmarkFountain.jsx', './town/TownSky.jsx', './town/TownEnvironment.jsx', './town/WonderIslands.jsx', './town/GptPark.jsx', './town/DeepSeekPark.jsx', './town/GeneratedPlayerModel.jsx', './town/OutdoorScenery.jsx', './town/JetpackRig.jsx'];
  const overrides = Object.fromEntries(imports.map(id => [id, componentNamespace(id)]));
  overrides['./drone/DroneShow.jsx'] = componentNamespace('DroneShow');
  Object.assign(overrides, { react: h.react, '@react-three/fiber': { Canvas: 'TownCanvas', useFrame: callback => h.frames.push(callback) }, '@react-three/drei': { Html: 'Html', PerspectiveCamera: 'PerspectiveCamera', RoundedBox: 'RoundedBox' } });
  const town = evaluate('src/components/Town.jsx', overrides), timeRef = { current: 0 }, npcTimeRef = { current: 145000 };
  const root = town.default({ viewMode: mode, timeRef, npcTimeRef, onReady }), rootNodes = elements(root);
  const sceneElement = rootNodes.find(n => typeof n.type === 'function' && n.props.npcTimeRef === npcTimeRef);
  assert.ok(sceneElement, 'town scene receives the shared show clock');
  return { rootNodes, sceneNodes: elements(sceneElement.type(sceneElement.props)), timeRef, npcTimeRef, frames: h.frames };
}

test('scene loading: readiness waits for the first rendered frame and announces only once', () => {
  let ready = 0;
  const { frames } = townHarness('overview', () => ready++);
  assert.equal(ready, 0);
  frames.forEach(frame => frame());
  assert.equal(ready, 0);
  frames.forEach(frame => frame());
  assert.equal(ready, 1);
  for (let i = 0; i < 10; i++) frames.forEach(frame => frame());
  assert.equal(ready, 1);
});
test('integrated architecture: all modes retain one Canvas, one shared sky and environment, and one wonder group with independent lighting time', () => {
  for (const mode of ['overview', 'follow', 'first-person', 'wonder', 'drone']) {
    const { rootNodes, sceneNodes, timeRef, npcTimeRef } = townHarness(mode);
    assert.equal(rootNodes.filter(n => n.type === 'TownCanvas').length, 1);
    assert.equal(sceneNodes.filter(n => n.type === 'TownCanvas').length, 0);
    const wonders = sceneNodes.filter(n => n.type === './town/WonderIslands.jsx');
    assert.equal(wonders.length, 1); assert.equal(wonders[0].props.timeRef, npcTimeRef); assert.equal(wonders[0].props.lightTimeRef, timeRef);
    assert.equal(sceneNodes.filter(n => n.type === './town/TownSky.jsx').length, 1);
    assert.equal(sceneNodes.filter(n => n.type === './town/TownEnvironment.jsx').length, 1);
    assert.equal(sceneNodes.find(n => n.type === './town/SceneEffects').props.performanceMode, mode === 'drone' ? 'drone' : 'town');
    const lenses = sceneNodes.filter(n => n.type === 'PerspectiveCamera');
    assert.equal(lenses.length, ['follow', 'first-person', 'wonder', 'drone'].includes(mode) ? 1 : 0);
    if (lenses.length) assert.equal(lenses[0].props.makeDefault, true);
  }
});

function harbourHarness() {
  const h = hooks();
  const module = evaluate('src/components/town/WonderIslands.jsx', { react: h.react, '@react-three/fiber': { useFrame: fn => h.frames.push(fn) }, '@react-three/drei': { Html: 'Html' }, './TownWater.jsx': { __esModule: true, default: 'TownWater' }, './WonderLoading.jsx': componentNamespace('WonderLoading') });
  const timeRef = { current: 74000 }, lightTimeRef = { current: 0 };
  const tree = module.default({ timeRef, lightTimeRef, viewMode: 'overview', playerPoseRef: { current: world.SPAWN } });
  const nodes = elements(tree);
  return { h, tree, nodes, timeRef, lightTimeRef };
}
test('integrated harbour: shared sea and pool are unique and no eager child owns a camera, renderer, or environment', () => {
  const { nodes, timeRef, lightTimeRef } = harbourHarness();
  const waters = nodes.filter(n => n.type === 'TownWater');
  assert.equal(waters.length, 2); assert.equal(waters.filter(n => n.props.pool).length, 1);
  for (const water of waters) { assert.equal(water.props.timeRef, timeRef); assert.equal(water.props.lightTimeRef, lightTimeRef); }
  const models = nodes.filter(n => n.type?.$$typeof === Symbol.for('react.lazy'));
  assert.equal(models.length, 3);
  for (const model of models) { assert.equal(model.props.timeRef, timeRef); assert.equal(model.props.active, true); }
  assert.equal(nodes.some(n => typeof n.type === 'string' && /camera|canvas|environment|background/i.test(n.type)), false);
});
test('integrated pool: real paving geometry has an open lagoon; water lies above its bed and below the walkable promenade', () => {
  const { nodes } = harbourHarness();
  const local = nodes.filter(n => typeof n.type === 'function').map(n => n.type(n.props));
  const paving = local.find(n => n.type === 'mesh' && n.props.geometry?.isBufferGeometry);
  assert.ok(paving, 'lagoon ground exposes its real geometry');
  const mesh = new THREE.Mesh(paving.props.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.position.set(...paving.props.position); mesh.rotation.set(...paving.props.rotation); mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(-64, 10, 19), new THREE.Vector3(0, -1, 0));
  assert.equal(ray.intersectObject(mesh).length, 0, 'paving must not cover the orca water');
  ray.ray.origin.set(-53, 10, 22); assert.ok(ray.intersectObject(mesh).length > 0, 'approved arrival remains on paving');
  const h = hooks(), water = evaluate('src/components/town/TownWater.jsx', { react: h.react, '@react-three/fiber': { useFrame: fn => h.frames.push(fn) } }).default({ pool: true, timeRef: { current: 0 } });
  const [x, y, z] = water.props.position;
  assert.equal(x, -64); assert.equal(z, 19); assert.ok(y < paving.props.position[1]);
  assert.equal(world.isWalkable(x, z), false);
  const batches = nodes.filter(n => n.props.entries && !n.props.rock);
  const bed = batches.flatMap(n => n.props.entries).filter(e => Math.abs(x - e.at[0]) < e.size[0] / 2 && Math.abs(z - e.at[2]) < e.size[2] / 2);
  assert.ok(bed.length > 0); assert.ok(bed.every(e => e.at[1] + e.size[1] / 2 < y - .15), 'solid island base must remain below the maximum displaced wave trough, with margin');
  mesh.geometry.dispose(); mesh.material.dispose();
});
test('integrated water: lighting previews change the common shader but never replace its shared animation clock', () => {
  const h = hooks(), timeRef = { current: 74000 }, lightTimeRef = { current: 0 };
  const water = evaluate('src/components/town/TownWater.jsx', { react: h.react, '@react-three/fiber': { useFrame: fn => h.frames.push(fn) } }).default({ timeRef, lightTimeRef });
  const material = elements(water).find(n => n.type === 'shaderMaterial'); material.props.ref.current = { uniforms: material.props.uniforms };
  for (const lightingTime of [0, 45000, 90000, 135000]) {
    lightTimeRef.current = lightingTime; h.frames.forEach(fn => fn());
    assert.equal(material.props.uniforms.time.value, 74);
    assert.equal(material.props.uniforms.daylight.value, sampleDayNight(lightingTime).daylight);
    finiteNumbers(material.props.uniforms.sun.value, 'water sun');
  }
});
