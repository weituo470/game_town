import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import { offshoreCameraShot } from '../src/components/offshore/offshoreCamera.js';
import { OFFSHORE_ISLAND, sampleOffshoreVoyage } from '../shared/offshore-island.js';
import { auditSources } from '../scripts/check-readability.mjs';

const source = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const controlsSource = source('src/components/offshore/OffshoreControls.jsx');
const cameraSource = source('src/components/offshore/OffshoreCamera.jsx');
const require = createRequire(new URL('../src/components/offshore/OffshoreControls.jsx', import.meta.url));
const transform = (code, name) => transformWithEsbuild(code, name, { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
const controlsCode = (await transform(controlsSource, 'OffshoreControls.jsx')).code;
const cameraCode = (await transform(cameraSource, 'OffshoreCamera.jsx')).code;

function mountControls(environment = {}) {
  const effects = [], updates = [], module = { exports: {} };
  vm.runInNewContext(controlsCode, { module, exports: module.exports, ...environment, require(id) {
    if (id === 'react') return { useRef: value => ({ current: value }), useEffect: effect => effects.push(effect),
      useState: initial => [typeof initial === 'function' ? initial() : initial, value => updates.push(value)] };
    if (id === './offshore.css') return {};
    return require(id);
  } });
  return { ...module.exports, effects, updates };
}
function elements(node, result = []) {
  if (Array.isArray(node)) node.forEach(item => elements(item, result));
  else if (node?.props) { result.push(node); elements(node.props.children, result); }
  return result;
}
function textOf(node) { return typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : ''; }

test('offshore director and orbit fit the entire ship outside HUD on desktop and 390px phone throughout the voyage', () => {
  const plan = { startAt: 1000, returnAt: 0 };
  for (const [width, height] of [[1280, 720], [390, 844], [320, 740], [844, 390]]) {
    for (const view of ['director', 'orbit']) for (const time of [0, 12, 40, 90, 130, 149]) {
      const sample = sampleOffshoreVoyage(plan, 1000 + time * 1000);
      const shot = offshoreCameraShot(width / height, sample, time, view);
      const camera = new THREE.PerspectiveCamera(shot.fov, width / height, shot.near, shot.far);
      camera.position.set(...shot.position); camera.lookAt(...shot.target); camera.updateMatrixWorld();
      const rotation = new THREE.Euler(sample.pitch, sample.yaw, sample.roll, 'XYZ');
      for (const x of [-13, 13]) for (const y of [-1.5, 31]) for (const z of [-19, 19]) {
        const point = new THREE.Vector3(x, y, z).applyEuler(rotation).add(new THREE.Vector3(sample.x, sample.y, sample.z)).project(camera);
        assert.ok(Math.abs(point.x) < .87, `${view} horizontal ${width} t=${time}: ${point.x}`);
        const screenY = (1 - point.y) / 2;
        assert.ok(screenY > .149 && screenY < (width / height < .8 ? .521 : .661), `${view} HUD gap ${width} t=${time}: ${screenY}`);
        assert.ok(point.z > -1 && point.z < 1);
      }
    }
  }
});

test('offshore shots are finite, yaw-relative, and reduced motion removes orbit drift', () => {
  for (const aspect of [NaN, Infinity, 0, -1, .1, 1, 3]) for (const time of [NaN, Infinity, -9, 0, 10000]) {
    for (const view of ['director', 'orbit', 'deck']) {
      const shot = offshoreCameraShot(aspect, { x: NaN, z: Infinity, yaw: NaN, roll: NaN }, time, view);
      assert.ok([...shot.position, ...shot.target, shot.fov, shot.near, shot.far].every(Number.isFinite));
    }
  }
  assert.deepEqual(offshoreCameraShot(.5, {}, 100, 'orbit', true), offshoreCameraShot(.5, {}, 0, 'director', true));
  const pose = { x: 80, y: .1, z: 160, yaw: Math.PI / 2, pitch: 0, roll: 0 };
  const shot = offshoreCameraShot(1.5, pose, 0, 'deck');
  assert.ok(Math.abs(shot.position[0] - 91) < 1e-9);
  assert.ok(Math.abs(shot.position[1] - 10.7) < 1e-9);
  assert.ok(Math.abs(shot.position[2] - 168) < 1e-9);
  assert.ok(shot.target[0] > shot.position[0] + 50, 'deck faces the local bow, not the rear cabin');
  const stationary = offshoreCameraShot(1.5, {}, 0, 'deck');
  assert.equal(stationary.position[0] - OFFSHORE_ISLAND.x, -8, 'eye remains in the approved port corridor');
  assert.equal(stationary.position[2] - OFFSHORE_ISLAND.z, 11);
});

test('mounted offshore camera follows live ship poses with a monotonic rail and resets the previous lens', () => {
  let frame, reads = 0;
  const module = { exports: {} }, runtime = { sample: sampleOffshoreVoyage({}, 0), now: 179999 };
  vm.runInNewContext(cameraCode, { module, exports: module.exports, require(id) {
    if (id === 'react') return { useRef: value => ({ current: value }) };
    if (id === '@react-three/fiber') return { useFrame: callback => { frame = callback; } };
    if (id === './offshoreCamera.js') return { offshoreCameraShot };
    throw new Error(id);
  } });
  module.exports.default({ view: 'orbit', runtimeRef: { get current() { reads++; return runtime; } } });
  frame({ camera: new THREE.OrthographicCamera(), clock: { elapsedTime: 50 } });
  const camera = new THREE.PerspectiveCamera(70, .5, 1, 200); camera.zoom = 2; camera.setViewOffset(390, 844, 0, 10, 390, 844);
  frame({ camera, clock: { elapsedTime: 100 } });
  assert.deepEqual(camera.position.toArray(), offshoreCameraShot(.5, runtime.sample, 0, 'orbit').position);
  const before = camera.position.clone(); runtime.now = 0;
  frame({ camera, clock: { elapsedTime: 100.001 } });
  assert.ok(camera.position.distanceTo(before) < .02); assert.equal(reads, 2);
  assert.equal(camera.zoom, 1); assert.equal(camera.view.enabled, false);
  runtime.sample = { ...runtime.sample, x: 60, z: 180, yaw: 1 };
  frame({ camera, clock: { elapsedTime: 101 } });
  assert.deepEqual(camera.position.toArray(), offshoreCameraShot(.5, runtime.sample, 1, 'orbit').position);
});

test('offshore buttons dispatch explicit passenger actions and closing never disembarks', () => {
  for (const [phase, aboard, allowed] of [['docked', false, ['board-and-depart', 'board', 'dock']], ['docked', true, ['depart', 'disembark']], ['cruising', true, ['return']], ['cruising', false, ['dock']]]) {
    const ui = mountControls(), calls = [];
    const controller = { state: { phase, aboard, label: '测试航程', online: true, seat: 1 }, runtimeRef: { current: { sample: { docked: phase === 'docked' } } },
      boardAndDepart: () => calls.push('board-and-depart'), board: () => calls.push('board'), depart: () => calls.push('depart'), returnToPort: () => calls.push('return'), disembark: () => calls.push('disembark') };
    const tree = ui.default({ controller, onDock: () => calls.push('dock'), onClose: () => calls.push('close'), onView: id => calls.push(id), onNight: () => calls.push('night') });
    assert.deepEqual(calls, [], 'render must never invoke actions');
    const buttons = elements(tree).filter(node => node.type === 'button');
    for (const button of buttons) if (!['offshore-close', 'offshore-light'].includes(button.props.className) && button.props['aria-pressed'] === undefined) button.props.onClick();
    assert.deepEqual(calls, allowed);
    calls.length = 0; buttons.find(node => node.props.className === 'offshore-close').props.onClick();
    assert.deepEqual(calls, ['close']);
    const html = renderToStaticMarkup(tree);
    assert.match(html, /非官方科普模拟/); assert.match(html, /上海交通大学/); assert.match(html, /约 2 分 30 秒航程/);
    assert.equal(buttons.filter(node => node.props['aria-pressed'] !== undefined).length, 4);
    assert.ok(buttons.every(node => node.props.type === 'button'));
  }
});

test('offshore pending/return state prevents duplicate operations and reports failures accessibly', () => {
  const ui = mountControls();
  const nodes = elements(ui.default({ controller: { state: { phase: 'docked', aboard: true, pending: 'depart', error: '请先到码头登船。' } } }));
  assert.ok(nodes.find(node => textOf(node) === '启航 · 约 2 分 30 秒' && node.type === 'button').props.disabled);
  assert.ok(nodes.find(node => textOf(node) === '下船回码头' && node.type === 'button').props.disabled);
  assert.ok(nodes.some(node => node.props.role === 'alert' && textOf(node) === '请先到码头登船。'));
  const returning = elements(ui.default({ controller: { state: { phase: 'returning', aboard: true } } }));
  assert.ok(returning.find(node => textOf(node) === '正在返航靠泊' && node.type === 'button').props.disabled);
  for (const [aboard, pendingStage, pendingLabel] of [[false, 'board', '正在确认登船，请稍候…'], [true, 'cooldown', '已登船，正在准备离港，无需再次点击。'], [true, 'depart', '正在确认启航，即将驶离码头…']]) {
    const combined = elements(ui.default({ controller: { state: { phase: 'docked', aboard, pending: 'board-and-depart', pendingStage, pendingLabel } } }));
    assert.ok(combined.some(node => node.props.role === 'status' && textOf(node) === pendingLabel));
    const actions = combined.find(node => node.props.className === 'offshore-actions');
    assert.ok(elements(actions).filter(node => node.type === 'button' && node.props.className !== 'offshore-light').every(node => node.props.disabled));
  }
});

test('progress polls only its own component every 250ms and releases listeners/timer', () => {
  let interval, removed = 0, cleared = 0, reads = 0;
  const ui = mountControls({ document: { hidden: false, addEventListener() {}, removeEventListener() { removed++; } },
    setInterval(fn, delay) { assert.equal(delay, 250); interval = fn; return 7; }, clearInterval(id) { assert.equal(id, 7); cleared++; } });
  const runtimeRef = { get current() { reads++; return { sample: { progress: .5, remainingMs: 75000, distanceFromPort: 136.3, docked: false } }; } };
  const tree = ui.OffshoreProgress({ runtimeRef });
  assert.match(textOf(tree), /1:15/); assert.match(textOf(tree), /距港 136 米/); const cleanup = ui.effects[0](); interval();
  assert.equal(reads, 3); assert.equal(ui.updates.length, 2); cleanup();
  assert.equal(cleared, 1); assert.equal(removed, 1);
});

test('offshore telemetry shows small departure movement, zero at berth, and safe values for invalid samples', () => {
  for (const [sample, expected] of [[{ docked: false, distanceFromPort: .2 }, '距港 0.2 米'], [{ docked: true, distanceFromPort: 0 }, '港内待命 · 距港 0 米'], [{ docked: false, distanceFromPort: NaN, remainingMs: Infinity }, '距港 0.0 米']]) {
    const ui = mountControls(), tree = ui.OffshoreProgress({ runtimeRef: { current: { sample } } });
    assert.match(textOf(tree), new RegExp(expected.replaceAll('.', '\\.')));
    assert.doesNotMatch(textOf(tree), /NaN|Infinity/);
    assert.equal(elements(tree).filter(node => node.type === 'output' && node.props['aria-label']).length, 2);
  }
});

test('Escape only closes the viewer, removes its listener and restores prior focus', () => {
  let listener, removed = 0, restored = 0, closed = 0, disembarked = 0, prevented = 0;
  const ui = mountControls({ document: { activeElement: { isConnected: true, focus() { restored++; } } },
    window: { addEventListener(type, callback) { assert.equal(type, 'keydown'); listener = callback; },
      removeEventListener(type, callback) { assert.equal(type, 'keydown'); assert.equal(callback, listener); removed++; } } });
  ui.default({ controller: { state: { phase: 'cruising', aboard: true }, disembark() { disembarked++; } }, onClose() { closed++; } });
  const cleanup = ui.effects[0]();
  listener({ key: 'Escape', preventDefault() { prevented++; } });
  assert.equal(closed, 1); assert.equal(disembarked, 0); assert.equal(prevented, 1);
  cleanup(); assert.equal(removed, 1); assert.equal(restored, 1);
});

test('viewer source keeps safe focus/escape handling, isolated playback, and readable controls', () => {
  const css = source('src/components/offshore/offshore.css');
  assert.match(controlsSource, /event.key === 'Escape'/); assert.match(controlsSource, /exit.current\?\.focus/);
  assert.match(controlsSource, /关闭镜头不会下船/); assert.match(controlsSource, /固定观景站/);
  assert.doesNotMatch(controlsSource + cameraSource, /fetch\(|<Canvas|requestAnimationFrame|createRoot|getUserMedia|npcTimeRef/);
  assert.match(css, /\.town-shell.is-offshore > :not\(\.world-stage\)/);
  assert.match(css, /min-height:44px/); assert.match(css, /max-height:44svh/); assert.match(css, /:focus-visible/);
  for (const name of ['world-controls', 'touch-controls', 'mobile-jump-button', 'outdoor-launcher', 'jetpack-status']) assert.ok(css.includes(`.town-shell.is-offshore-aboard .${name}`));
  assert.match(css, /\.offshore-resume\s*\{[^}]*bottom:max\(90px/);
  const audit = auditSources([{ path: 'src/styles.css', content: source('src/styles.css') },
    { path: 'src/components/offshore/offshore.css', content: css }, { path: 'src/components/offshore/OffshoreControls.jsx', content: controlsSource }]);
  assert.deepEqual(audit.issues, []);
});
