import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as React from 'react';
import { sampleOffshoreVoyage } from '../shared/offshore-island.js';

const compiled = new Map(await Promise.all(['src/App.jsx', 'src/components/Town.jsx'].map(async path => {
  const file = new URL('../' + path, import.meta.url);
  return [path, { code: (await transformWithEsbuild(fs.readFileSync(file, 'utf8'), path, { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code, require: createRequire(file) }];
})));
function nodes(element, list = []) {
  if (Array.isArray(element)) element.forEach(item => nodes(item, list));
  else if (React.isValidElement(element)) { list.push(element); nodes(element.props.children, list); }
  return list;
}
function lazyName(loader) {
  const source = String(loader);
  if (source.includes('WonderSchedule.jsx')) return /\.WonderHud\b/.test(source) ? 'WonderHud' : 'WonderSchedule';
  return 'Lazy:' + source.match(/\/([^/]+)\.jsx/)?.[1];
}
function hooks() {
  let cursor = 0; const slots = [];
  return { reset() { cursor = 0; }, react: { ...React, lazy: lazyName,
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useEffect() {}, useLayoutEffect() {}, useMemo: fn => fn(), useCallback: fn => fn,
  } };
}
const namespace = name => new Proxy({ __esModule: true, default: name }, { get: (object, key) => key in object ? object[key] : `${name}:${String(key)}` });
function evaluate(path, overrides, globals = {}, localStubs = false) {
  const module = { exports: {} }, item = compiled.get(path);
  vm.runInNewContext(item.code, { module, exports: module.exports, ...globals, require(id) {
    if (id in overrides) return overrides[id];
    if (id.endsWith('.css')) return {};
    if (localStubs && id.startsWith('./')) return namespace(id);
    return item.require(id);
  } }); return module.exports;
}
function appHarness(search = '') {
  const h = hooks(), calls = [], modes = [];
  const runtime = { now: 100000, plan: { startAt: 0, returnAt: 0 }, aboard: false, seat: -1 };
  Object.defineProperty(runtime, 'sample', { get: () => sampleOffshoreVoyage(runtime.plan, runtime.now) });
  const controller = { runtimeRef: { current: runtime }, get state() { return { ...runtime.sample, aboard: runtime.aboard, seat: runtime.seat, error: '', pending: '', online: false }; },
    board() { calls.push('board'); runtime.aboard = true; runtime.seat = 0; }, depart() { calls.push('depart'); runtime.plan = { startAt: runtime.now, returnAt: 0 }; },
    boardAndDepart() { calls.push('board-and-depart'); runtime.aboard = true; runtime.seat = 0; runtime.plan = { startAt: runtime.now, returnAt: 0 }; },
    returnToPort() { calls.push('return'); }, disembark() { calls.push('disembark'); runtime.aboard = false; runtime.seat = -1; } };
  const outdoor = { runtimeRef: { current: null }, selected: null, start(id) { calls.push(`outdoor:${id}`); this.selected = id; }, exit() { calls.push('outdoor:exit'); this.selected = null; } };
  const drone = { state: { active: false, program: 'avatar' }, timeRef: { current: 0 }, start({ program }) { calls.push('drone:start'); this.state.active = true; this.state.program = program; }, close() { calls.push('drone:close'); this.state.active = false; } };
  const sharedTime = { current: 140000 }, dayTime = { current: 0 };
  const overrides = { react: h.react,
    './lib/useMultiplayer.js': { __esModule: true, default: () => ({ status: 'disconnected' }) },
    './lib/useOffshoreCruise.js': { __esModule: true, default: () => controller },
    './lib/useWorldClock.js': { __esModule: true, default: ({ mode } = {}) => { if (mode !== undefined) modes.push(mode); return { timeRef: mode === undefined ? sharedTime : dayTime, label: mode === 'night' ? '夜晚' : '白天' }; } },
    './lib/profile.js': { loadProfile: () => ({ visits: [], dismissed: [] }), getCompletion: () => 0 },
    './lib/gameCharacterClient.js': { gameCharacterClient: {} }, './lib/marketRecommendations.js': {},
    './lib/npcAnimalPlayer.js': { createNpcAnimalPlayer: () => ({ stop() {}, play() {} }) },
    './components/Town.jsx': { __esModule: true, default: 'Town' },
    './components/OutdoorPlay.jsx': { useOutdoorPlay: () => outdoor, OutdoorLauncher: 'OutdoorLauncher', OutdoorHud: 'OutdoorHud' },
    './components/drone/DroneShowControls.jsx': { __esModule: true, default: 'DroneControls', useDroneShowController: () => drone },
  };
  for (const name of ['FlightStatus', 'MarketRecommendations', 'MultiplayerPanel', 'DayNightControls']) overrides[`./components/${name}.jsx`] = namespace(name);
  const app = evaluate('src/App.jsx', overrides, { URLSearchParams, requestAnimationFrame: fn => fn(), window: { location: { search }, matchMedia: () => ({ matches: false }) },
    document: { activeElement: null, exitPointerLock() { calls.push('unlock'); }, querySelector: () => null } });
  let tree;
  const render = () => { h.reset(); tree = app.default(); return nodes(tree); };
  const find = type => nodes(tree).find(node => node.type === type);
  return { app, render, find, calls, modes, runtime, controller, outdoor, drone,
    town: () => find('Town'), controls: () => find('Lazy:OffshoreControls'), all: () => nodes(tree),
    catalogue() { nodes(tree).find(node => node.type === 'button' && node.props.className?.includes('wonder-nav')).props.onClick(); render(); return find('WonderSchedule'); } };
}

test('offshore deep link retains the real Town single Canvas and grants only its own camera ownership', () => {
  const app = appHarness('?landmark=offshore'); app.render();
  assert.equal(app.all().filter(node => node.type === 'Town').length, 1);
  const props = app.town().props;
  assert.equal(props.viewMode, 'offshore'); assert.equal(props.active, false); assert.equal(props.suspended, false);
  assert.equal(props.offshoreRef, app.controller.runtimeRef); assert.equal(app.controls().props.controller, app.controller);
  assert.equal(app.controls().props.view, 'director'); assert.equal(props.destination, null);
  const h = hooks();
  const Town = evaluate('src/components/Town.jsx', { react: h.react, '@react-three/fiber': { Canvas: 'Canvas', useFrame() {} },
    '@react-three/drei': { Html: 'Html', PerspectiveCamera: 'PerspectiveCamera', RoundedBox: 'RoundedBox' } }, {}, true).default;
  h.reset(); const tree = Town(props), elements = nodes(tree);
  assert.equal(elements.filter(node => node.type === 'Canvas').length, 1);
  assert.equal(elements.find(node => node.type === 'Canvas').props.frameloop, 'always');
  const scene = elements.find(node => typeof node.type === 'function' && node.props.offshoreRef);
  h.reset(); const children = nodes(scene.type(scene.props));
  assert.equal(children.filter(node => node.type === 'PerspectiveCamera').length, 1);
  assert.equal(children.filter(node => node.type === 'Canvas').length, 0);
  const camera = children.find(node => node.type === 'Lazy:OffshoreCamera');
  assert.equal(camera.props.runtimeRef, app.controller.runtimeRef);
  assert.equal(children.find(node => node.type === 'Lazy:PlayerController').props.offshoreRef, app.controller.runtimeRef);
});

test('opening offshore stops outdoor and drone modes, resets held inputs and returns to the prior shore view', () => {
  for (const previous of ['follow', 'drone']) {
    const app = appHarness(); app.render(); app.town().props.onStartExploring(); app.render();
    if (previous === 'drone') { app.catalogue().props.onDroneShow('avatar'); app.render(); }
    app.outdoor.selected = 'fishing'; app.town().props.inputRef.current = { forward: true, jetHeld: true };
    const destination = app.town().props.destination;
    app.town().props.onOffshoreSelect(); app.render();
    assert.equal(app.town().props.viewMode, 'offshore'); assert.equal(app.town().props.active, false);
    assert.equal(app.drone.state.active, false); assert.equal(app.outdoor.selected, null);
    assert.ok(app.calls.includes('drone:close') && app.calls.includes('outdoor:exit') && app.calls.includes('unlock'));
    assert.ok(Object.values(app.town().props.inputRef.current).every(value => value === false));
    assert.equal(app.town().props.destination, destination, 'opening the lens is not a teleport');
    app.controls().props.onView('orbit'); app.render(); assert.equal(app.town().props.offshoreView, 'orbit');
    app.controls().props.onClose(); app.render();
    assert.equal(app.town().props.viewMode, previous === 'drone' ? 'overview' : previous);
    assert.equal(app.calls.includes('disembark'), false);
  }
});

test('aboard close switches to follow and exposes resume without disembarking or resetting the voyage', () => {
  const app = appHarness('?landmark=offshore'); app.runtime.aboard = true; app.runtime.seat = 3; app.runtime.plan.startAt = 75000; app.render();
  const plan = app.runtime.plan, walk = app.controls().props.onWalk;
  assert.equal(walk, app.controls().props.onClose);
  app.controls().props.onView('deck'); app.render(); walk(); app.render();
  assert.equal(app.town().props.viewMode, 'follow'); assert.equal(app.runtime.aboard, true);
  assert.equal(app.calls.includes('disembark'), false); assert.equal(app.runtime.plan, plan);
  const resume = app.all().find(node => node.props.className === 'offshore-resume');
  assert.ok(resume); assert.ok(app.all().find(node => node.type === 'main').props.className.includes('is-offshore-aboard'));
  assert.ok(app.all().some(node => node.props.className === 'offshore-walk-hint'));
  resume.props.onClick(); app.render(); assert.equal(app.controls().props.view, 'director');
  assert.equal(app.town().props.offshoreAboard, true); assert.equal(app.runtime.plan, plan);
});

test('onDock travels only from shore; onboard invokes disembark without changing the active lens', () => {
  const ashore = appHarness('?landmark=offshore'); ashore.render(); ashore.controls().props.onDock(); ashore.render();
  assert.equal(ashore.town().props.destination.id, 'offshore'); assert.equal(ashore.town().props.viewMode, 'follow');
  assert.equal(ashore.calls.includes('disembark'), false);
  const aboard = appHarness('?landmark=offshore'); aboard.runtime.aboard = true; aboard.render();
  aboard.controls().props.onDock(); aboard.render();
  assert.deepEqual(aboard.calls, ['disembark']); assert.equal(aboard.town().props.viewMode, 'offshore');
  assert.equal(aboard.town().props.destination, null);
});

test('aboard refuses ordinary travel, outdoor and wonder callbacks, including a previously captured shore callback', () => {
  const app = appHarness(); app.render(); const schedule = app.catalogue(), travel = schedule.props.onTravel;
  const observe = schedule.props.onImmerse, outdoor = app.town().props.onOutdoorStart;
  app.runtime.aboard = true; app.runtime.seat = 0; app.render();
  const before = { destination: app.town().props.destination, viewMode: app.town().props.viewMode };
  travel('center'); observe('rocket'); outdoor('fishing'); outdoor('jetpack'); app.render();
  assert.equal(app.town().props.destination, before.destination); assert.equal(app.town().props.viewMode, before.viewMode);
  assert.equal(app.outdoor.selected, null); assert.equal(app.calls.some(item => item.startsWith('outdoor:')), false);
  assert.ok(app.all().some(node => node.props.className === 'toast'));
});

test('night preview and camera mode are purely visual and never alter voyage, membership or its shared clock', () => {
  const app = appHarness('?landmark=offshore'); app.runtime.aboard = true; app.runtime.seat = 6; app.runtime.plan.startAt = 90000; app.render();
  const before = JSON.stringify(app.runtime), plan = app.runtime.plan, clock = app.town().props.npcTimeRef;
  app.controls().props.onNight(); app.controls().props.onView('deck'); app.render();
  assert.equal(app.controls().props.night, true); assert.equal(app.town().props.offshoreView, 'deck'); assert.equal(app.modes.at(-1), 'night');
  assert.equal(JSON.stringify(app.runtime), before); assert.equal(app.runtime.plan, plan); assert.equal(app.town().props.npcTimeRef, clock);
  assert.deepEqual(app.calls, []); app.controls().props.onNight(); app.render(); assert.equal(app.modes.at(-1), 'day');
});

test('dock proximity supplies a real one-click embarkation control and removes it once aboard', () => {
  const app = appHarness(); app.render(); app.town().props.onStartExploring(); app.render();
  app.town().props.onNearestOffshoreDock(true); app.render();
  const prompt = app.all().find(node => node.props.className === 'nearby-prompt offshore-nearby-prompt');
  assert.ok(prompt);
  nodes(prompt).find(node => node.type === 'button').props.onClick(); app.render();
  assert.equal(app.calls.filter(value => value === 'board-and-depart').length, 1);
  assert.equal(app.town().props.viewMode, 'offshore');
  assert.equal(app.runtime.aboard, true);
  assert.equal(app.runtime.sample.docked, false);
  assert.ok(!app.all().some(node => node.props.className === 'nearby-prompt offshore-nearby-prompt'));
});

test('sphere replay returns to the face and advances the shared scene cue, without creating a second scene', () => {
  const app = appHarness('?landmark=sphere'); app.render();
  let controls = app.find('Lazy:SphereControls');
  const before = app.town().props.sphereBubbleCue;
  controls.props.onMode('earth'); app.render();
  controls = app.find('Lazy:SphereControls'); controls.props.onBlow(); app.render();
  assert.equal(app.town().props.sphereMode, 'smile');
  assert.equal(app.town().props.sphereBubbleCue, before + 1);
  assert.equal(app.all().filter(node => node.type === 'Town').length, 1);
});
