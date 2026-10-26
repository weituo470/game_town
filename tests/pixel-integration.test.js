import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithEsbuild } from 'vite';
import * as THREE from 'three';
import * as jsx from 'react/jsx-runtime';
import * as catalog from '../src/lib/catalog.js';
import { PIXEL_ISLAND as I } from '../shared/pixel-island.js';
import { getDestination, SPAWN } from '../shared/world.js';
import { HOTBAR, BLOCK_BY_ID } from '../shared/pixel-world.js';
import { createPixelRuntime, PIXEL_SAVE_KEY } from '../src/components/pixel/pixelRuntime.js';
import { sceneRenderProfile } from '../src/components/drone/dronePerformance.js';
import { auditSources } from '../scripts/check-readability.mjs';

const root = new URL('../', import.meta.url), read = name => fs.readFileSync(new URL(name, root), 'utf8').replaceAll('\r\n', '\n');
const all = (node, list = []) => { if (Array.isArray(node)) node.forEach(child => all(child, list)); else if (node?.props) { list.push(node); all(node.props.children, list); } return list; };
const label = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(label).join('') : node?.props ? label(node.props.children) : '';
async function evaluate(name, overrides = {}, globals = {}) {
  const require = createRequire(new URL(name, root)), module = { exports: {} };
  const source = (await transformWithEsbuild(read(name), name, { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code;
  vm.runInNewContext(source, { module, exports: module.exports, ...globals, require(id) {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    return id.endsWith('.css') ? {} : require(id);
  } });
  return module.exports;
}
function emitter() {
  const listeners = new Map();
  return { hidden: false,
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    emit(name, event = {}) { for (const callback of listeners.get(name) || []) callback({ target: { tagName: 'BODY' }, preventDefault() {}, ...event }); },
    count() { return [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); },
  };
}
const state = changes => ({ phase: 'overview', mode: 'collect', selected: 0, inventory: { 1: 14, 3: 6, 5: 4 },
  stats: { mined: 0, placed: 0, crafted: 0 }, panel: null, message: '', miningProgress: 0,
  saveStatus: '已保存到本机', locked: false, flying: false, ...changes });
const hookStub = { useCallback: fn => fn, useEffect() {}, useRef: current => ({ current }),
  useState: value => [typeof value === 'function' ? value() : value, () => {}],
  useSyncExternalStore: (_, getSnapshot) => getSnapshot() };

test('pixel gate defers heavy voxel code until approach or explicit entry and retains its existing mount', async () => {
  const slots = []; let cursor = 0, frame;
  const module = await evaluate('src/components/pixel/PixelGate.jsx', {
    react: { Suspense: 'Suspense', lazy: () => 'LazyPixel',
      useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
      useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], value => { slots[i] = value; }]; },
    }, '@react-three/fiber': { useFrame: fn => { frame = fn; } },
  });
  const props = { viewMode: 'overview', playerPoseRef: { current: SPAWN }, runtimeRef: { current: null }, onReady() {} };
  const render = changes => { Object.assign(props, changes); cursor = 0; return module.default(props); };
  assert.equal(render(), null);
  for (let n = 0; n < 60; n++) { frame({}, 1 / 60); assert.equal(render(), null); }
  props.playerPoseRef.current = { x: I.x, z: I.z + 120 };
  for (let n = 0; n < 20; n++) frame({}, 1 / 60);
  let island = all(render()).find(node => node.type === 'LazyPixel');
  assert.ok(island); assert.equal(island.props.active, false); assert.equal(island.props.runtimeRef, props.runtimeRef);
  props.playerPoseRef.current = SPAWN; frame({}, 1); assert.ok(all(render()).find(node => node.type === 'LazyPixel'));
  slots.length = 0;
  island = all(render({ viewMode: 'pixel' })).find(node => node.type === 'LazyPixel');
  assert.ok(island); assert.equal(island.props.active, true);
});

test('actual inactive town controller leaves the private pixel lens untouched, hides self and stops old movement', async () => {
  const win = emitter(), doc = emitter(), cleanups = []; let frame;
  const camera = new THREE.PerspectiveCamera(72, 1280 / 720, .03, 1200);
  camera.position.set(133, 27, 231); camera.rotation.set(.1, .7, 0); camera.updateProjectionMatrix();
  const original = { matrix: camera.projectionMatrix.toArray(), position: camera.position.toArray(), quaternion: camera.quaternion.toArray() };
  const module = await evaluate('src/components/town/PlayerController.jsx', {
    react: { useRef: current => ({ current }), useEffect: setup => { const clean = setup(); if (clean) cleanups.push(clean); } },
    '@react-three/fiber': { useFrame: fn => { frame = fn; }, useThree: () => ({ camera, size: { width: 1280, height: 720 }, invalidate() {} }) },
    '../../lib/catalog': catalog, './FirstPersonLook.jsx': { __esModule: true, default: 'Look' },
  }, { window: win, document: doc, performance: { now: () => 100000 } });
  const poseRef = { current: null };
  const tree = module.default({ Model: 'Avatar', active: false, viewMode: 'pixel', destination: { id: I.id }, inputRef: { current: {} }, playerPoseRef: poseRef });
  const initial = { ...poseRef.current };
  win.emit('keydown', { code: 'KeyW' }); win.emit('keydown', { code: 'Space' });
  for (let n = 0; n < 30; n++) frame({}, 1 / 60);
  assert.equal(all(tree).filter(node => node.type === 'Avatar' && node.props.self).length, 0);
  assert.deepEqual(camera.projectionMatrix.toArray(), original.matrix);
  assert.deepEqual(camera.position.toArray(), original.position); assert.deepEqual(camera.quaternion.toArray(), original.quaternion);
  assert.equal(poseRef.current.x, initial.x); assert.equal(poseRef.current.z, initial.z); assert.equal(poseRef.current.y, getDestination(I.id).y);
  cleanups.forEach(clean => clean()); assert.equal(win.count(), 0); assert.equal(doc.count(), 0);
});

test('real application shortcut closure blocks old E/F interactions only while pixel sandbox owns input', () => {
  const app = read('src/App.jsx');
  const match = app.match(/const handleKey = event => \{([\s\S]*?)\n    \};\n    window\.addEventListener\('keydown', handleKey\);/);
  assert.ok(match, 'test the actual App shortcut closure rather than a duplicate implementation');
  const calls = [], env = { droneWatching: false, sphereWatching: false, offshoreWatching: false, islandWatching: false,
    metroWatching: false, pixelWatching: true, offshore: { state: { aboard: false } }, modal: null, mapOpen: false,
    outdoor: { selected: null }, nearOffshoreDock: false, nearestOutdoor: null, nearest: 'balloons', nearestNpc: 'test',
    setMapOpen() {}, startOffshoreCruise: () => calls.push('ship'), startOutdoor: () => calls.push('outdoor'),
    openGame: () => calls.push('game'), inspectResidents: () => calls.push('npc') };
  const context = vm.createContext(env), handle = vm.runInContext(`event => {${match[1]}\n}`, context);
  for (const key of ['e', 'f', 'E', 'F']) handle({ key, target: {}, preventDefault() {} });
  assert.deepEqual(calls, []);
  context.pixelWatching = false; handle({ key: 'e', target: {}, preventDefault() {} }); handle({ key: 'f', target: {}, preventDefault() {} });
  assert.deepEqual(calls, ['game', 'npc']);
});

test('pixel welcome renders with real React, safe loading controls and explicit local-only scope', async () => {
  const module = await evaluate('src/components/pixel/PixelControls.jsx');
  const empty = renderToStaticMarkup(jsx.jsx(module.default, { runtime: null, onClose() {}, onDay() {}, day: true }));
  assert.match(empty, /方块原野/); assert.match(empty, /单人沙盒/); assert.match(empty, /仅本机存档/); assert.match(empty, /不与房间同步/);
  assert.match(empty, /disabled=""/);
  const runtime = { subscribe: () => () => {}, getSnapshot: () => state() };
  const ready = renderToStaticMarkup(jsx.jsx(module.default, { runtime, onClose() {}, onDay() {}, day: true }));
  assert.match(ready, /采集建造/); assert.match(ready, /自由创造/); assert.match(ready, /世界存档/); assert.match(ready, /操作说明/);
});

test('pixel welcome start actions choose a mode and leaving saves/deactivates before returning to town', async () => {
  const module = await evaluate('src/components/pixel/PixelControls.jsx', { react: hookStub }), calls = [];
  const runtime = { getSnapshot: () => state(), start: mode => calls.push(mode), requestLock: () => calls.push('lock'),
    save: () => calls.push('save'), deactivate: () => calls.push('deactivate'), togglePanel: name => calls.push(name) };
  const nodes = all(module.default({ runtime, onClose: () => calls.push('close'), onDay() {}, day: true }));
  nodes.find(node => node.type === 'button' && label(node).includes('采集建造')).props.onClick();
  nodes.find(node => node.type === 'button' && label(node) === '自由创造').props.onClick();
  nodes.find(node => node.type === 'button' && label(node) === '返回小镇').props.onClick();
  assert.deepEqual(calls, ['collect', 'lock', 'creative', 'lock', 'save', 'deactivate', 'close']);
});

test('pixel playing HUD exposes exactly nine labelled selectable slots with real counts and unlimited creative supply', async () => {
  const module = await evaluate('src/components/pixel/PixelControls.jsx', { react: hookStub }), selected = [];
  const runtime = { getSnapshot: () => state({ phase: 'playing', mode: 'collect', selected: 3 }), select: value => selected.push(value) };
  let nodes = all(module.default({ runtime, onClose() {}, onDay() {}, day: true }));
  let slots = nodes.filter(node => node.type === 'button' && node.props.className === 'pixel-slot');
  assert.equal(slots.length, 9); assert.equal(slots.filter(node => node.props['aria-pressed']).length, 1);
  assert.equal(slots[3].props['aria-pressed'], true); assert.match(slots[3].props['aria-label'], /原木，4块/);
  slots.forEach((slot, index) => { assert.equal(slot.props.type, 'button'); assert.match(slot.props['aria-label'], new RegExp(BLOCK_BY_ID[HOTBAR[index]].name)); slot.props.onClick(); });
  assert.deepEqual(selected, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  runtime.getSnapshot = () => state({ phase: 'playing', mode: 'creative' });
  nodes = all(module.default({ runtime, onClose() {}, onDay() {}, day: false }));
  slots = nodes.filter(node => node.props.className === 'pixel-slot');
  assert.ok(slots.every(slot => slot.props['aria-label'].includes('无限')));
});

test('real touch HUD holds actually move backwards and ascend through the runtime input contract', async () => {
  const module = await evaluate('src/components/pixel/PixelControls.jsx', { react: hookStub });
  const runtime = createPixelRuntime({ storage: { getItem() { return null; }, setItem() {} } });
  const render = () => all(module.default({ runtime, onClose() {}, onDay() {}, day: true }));
  const hold = name => {
    const component = render().find(node => typeof node.type === 'function' && node.type.name === 'HoldButton' && node.props.label === name);
    assert.ok(component, `${name} touch control is available`);
    return component.type(component.props);
  };
  try {
    runtime.start('creative');
    let button = hold('向后'), startZ = runtime.player.z;
    button.props.onPointerDown({ preventDefault() {}, currentTarget: { setPointerCapture() {} }, pointerId: 1 });
    for (let n = 0; n < 10; n++) runtime.frame(.04);
    button.props.onPointerUp(); assert.ok(runtime.player.z > startZ + 1, 'back touch intent must match the runtime movement key');
    runtime.action('fly'); const startY = runtime.player.y; button = hold('上升');
    button.props.onPointerDown({ preventDefault() {}, currentTarget: { setPointerCapture() {} }, pointerId: 2 });
    for (let n = 0; n < 10; n++) runtime.frame(.04);
    button.props.onPointerCancel(); assert.ok(runtime.player.y > startY + 1, 'ascend touch intent must reach the flight vertical input');
  } finally { runtime.dispose(); }
});

test('pixel save/help/craft dialogs render actionable controls and scope disclosures with real React', async () => {
  const module = await evaluate('src/components/pixel/PixelControls.jsx');
  for (const panel of ['save', 'help', 'craft']) {
    const runtime = { subscribe: () => () => {}, getSnapshot: () => state({ phase: 'paused', panel }) };
    const html = renderToStaticMarkup(jsx.jsx(module.default, { runtime, onClose() {}, onDay() {}, day: true }));
    assert.match(html, /role="dialog"/); assert.match(html, /aria-modal="true"/);
    if (panel === 'save') { assert.match(html, /仅接受本游戏导出的有效世界文件/); assert.match(html, /导出世界/); assert.match(html, /导入备份/); assert.match(html, /重建原始岛屿/); assert.doesNotMatch(html, />确认重建</); }
    if (panel === 'help') { assert.match(html, /最远可操作 8 米/); assert.match(html, /基岩不可破坏/); assert.match(html, /未包含怪物、红石或多人共享建造/); assert.match(html, /原创方块与纹理/); }
    if (panel === 'craft') { assert.match(html, /材料库存/); assert.match(html, /原木/); assert.match(html, /合成/); }
  }
});

test('pixel atlas entry invokes its own sandbox action without pretending to travel into a shared editable room', async () => {
  const module = await evaluate('src/components/TownAtlas.jsx'), calls = [];
  const nodes = all(module.default({ onTravel: id => calls.push(id), onPixelTour: () => calls.push('pixel') }));
  const area = nodes.find(node => node.props['aria-label'] === '方块原野像素岛导航');
  assert.ok(area); assert.match(label(area), /仅保存在本机/); assert.match(label(area), /不与联机房间同步/);
  all(area).find(node => node.type === 'button').props.onClick(); assert.deepEqual(calls, ['pixel']);
});

test('pixel sky updates the actual sun target without moving the programme lighting to a parked private player', async () => {
  for (const viewMode of ['pixel', 'follow', 'first-person', 'drone', 'overview']) {
    let frame;
    const module = await evaluate('src/components/town/TownSky.jsx', {
      react: { useRef: current => ({ current }), useMemo: fn => fn() },
      '@react-three/fiber': { useFrame: fn => { frame = fn; } },
    });
    const nodes = all(module.default({ viewMode, timeRef: { current: 0 }, playerPoseRef: { current: { ...I.arrival, y: 4.72 } } }));
    const sun = new THREE.DirectionalLight(), fogNode = nodes.find(node => node.type === 'fog'), fog = new THREE.Fog(...fogNode.props.args);
    nodes.find(node => node.type === 'directionalLight' && node.props.castShadow).props.ref.current = sun; fogNode.props.ref.current = fog;
    frame({ camera: new THREE.PerspectiveCamera(), size: { width: 1280, height: 720 }, clock: { elapsedTime: 10 } });
    assert.deepEqual(sun.target.position.toArray(), ['pixel', 'follow', 'first-person'].includes(viewMode) ? [I.x, 10, I.z] : [0, 0, 0]);
    assert.equal(fog.near, viewMode === 'pixel' ? 475 : 175); assert.equal(fog.far, viewMode === 'pixel' ? 640 : 340);
  }
});

test('pixel scene stays in one animated Canvas and retains a lazy, local-only renderer with no paid-provider dependency', () => {
  const app = read('src/App.jsx'), town = read('src/components/Town.jsx'), gate = read('src/components/pixel/PixelGate.jsx');
  assert.equal((town.match(/<Canvas\b/g) || []).length, 1);
  assert.match(app, /get\('landmark'\) === 'pixel-island' \? 'pixel'/);
  assert.match(app, /is-\$\{viewMode\}/); assert.match(app, /active=\{[^\n]*!pixelWatching/);
  assert.match(town, /frameloop=\{[^\n]*'pixel'[^\n]*\? 'always'/);
  assert.match(town, /'pixel'\]\.includes\(props.viewMode\)[^\n]*<PerspectiveCamera/);
  assert.match(gate, /lazy\(\(\) => import\('\.\/PixelIsland\.jsx'\)\)/);
  for (const file of ['src/components/pixel/PixelIsland.jsx', 'src/components/pixel/pixelRuntime.js', 'shared/pixel-world.js']) {
    assert.doesNotMatch(read(file), /new\s+(?:THREE\.)?(?:Scene|WebGLRenderer)|<Canvas\b|fetch\(|sendInput\(|\.travel\(|deepseek|apiKey/i);
  }
  assert.equal(PIXEL_SAVE_KEY, 'game-town.pixel-island.v1');
});

test('pixel renderer disables expensive AO while keeping a crisp bounded rendering profile', () => {
  for (const width of [390, 1280, 2560]) for (const stage of [0, 1, 2]) {
    const profile = sceneRenderProfile({ mode: 'pixel', width, stage, pixelRatio: 2, maxSamples: 8 });
    assert.equal(profile.ao, false); assert.equal(profile.quality, 'pixel-crisp');
    assert.ok(profile.pixelRatio <= 1.25); assert.ok(profile.samples <= 2);
  }
  assert.equal(sceneRenderProfile({ mode: 'town', width: 1280, stage: 0 }).ao, true);
});

test('pixel HUD static typography and responsive containment guard is repeatable, without claiming browser QA', () => {
  const css = read('src/components/pixel/pixel.css');
  const report = auditSources([
    { path: 'src/styles.css', content: read('src/styles.css') },
    { path: 'src/components/pixel/pixel.css', content: css },
    { path: 'src/components/pixel/PixelControls.jsx', content: read('src/components/pixel/PixelControls.jsx') },
  ]);
  assert.deepEqual(report.issues, []);
  assert.match(css, /\.pixel-controls button\s*\{[^}]*min-height:\s*46px[^}]*font-size:\s*var\(--text-control\)/);
  assert.match(css, /\.pixel-panel p\s*\{[^}]*font-size:\s*var\(--text-body\)/);
  assert.match(css, /@media\s*\(max-width:\s*700px\)/);
  assert.match(css, /\.pixel-hotbar\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.pixel-inventory\s*\{\s*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(css, /(?:^|[;{])\s*zoom\s*:/);
});
