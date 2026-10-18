import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithEsbuild } from 'vite';
import * as world from '../shared/world.js';
import * as catalog from '../src/lib/catalog.js';
import { auditSources } from '../scripts/check-readability.mjs';

// Transformed imports belong to App.jsx, not to this test's directory.
const require = createRequire(new URL('../src/App.jsx', import.meta.url));
const react = require('react');
const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/expanded-map.css', import.meta.url), 'utf8');
const transformed = await transformWithEsbuild(source, 'App.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });

function appHarness() {
  const states = [];
  let index = 0;
  // Camera tests exercise the hook's idle contract, not outdoor input/timers.
  // Fail explicitly if a test accidentally tries to start that separate mode.
  const outdoor = {
    runtimeRef: { current: null },
    selected: null,
    start() { throw new Error('Outdoor gameplay is outside this camera UI harness'); },
    exit() { throw new Error('Outdoor gameplay is outside this camera UI harness'); },
  };
  const React = {
    ...react,
    useState(initial) {
      const slot = index++;
      if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial;
      return [states[slot], next => { states[slot] = typeof next === 'function' ? next(states[slot]) : next; }];
    },
    useCallback: callback => callback,
    useMemo: factory => factory(),
    useEffect() {},
    useRef: value => ({ current: value }),
  };
  const module = { exports: {} };
  vm.runInNewContext(transformed.code, {
    module, exports: module.exports, URLSearchParams,
    window: { location: { search: '' }, matchMedia: () => ({ matches: false }) },
    require(id) {
      if (id === 'react') return React;
      if (id === '../shared/world.js') return world;
      if (id === './lib/catalog.js') return catalog;
      if (id === './lib/useMultiplayer.js') return { __esModule: true, default: () => ({}) };
      if (id === './lib/useWorldClock.js') return { __esModule: true, default: () => ({ timeRef: { current: 0 }, label: '白天' }) };
      if (id === './components/OutdoorPlay.jsx') return {
        useOutdoorPlay: () => outdoor,
        OutdoorLauncher: function OutdoorLauncherStub() {},
        OutdoorHud: function OutdoorHudStub() {},
      };
      if (id === './components/drone/DroneShowControls.jsx') return {
        __esModule: true, default: function DroneControlsStub() {},
        useDroneShowController: () => ({ state: { active: false }, timeRef: { current: 0 }, start() {}, close() {} }),
      };
      if (id === './lib/gameCharacterClient.js') return {
        gameCharacterClient: { mine() { throw new Error('Character network calls are outside this synchronous UI harness'); } },
      };
      // The passport's preferences store is unrelated to camera interactions.
      // Do not load it or silently perform persistence from these UI tests.
      if (id === './lib/marketRecommendations.js') return {
        clearPreferences() { throw new Error('Preferences persistence is outside this camera UI harness'); },
      };
      if (id === './lib/profile.js') return {
        loadProfile: () => ({ visits: [], dismissed: [] }),
        getCompletion: () => 0,
      };
      if (id.startsWith('./components/')) return { __esModule: true, default: function SceneStub() {}, MultiplayerStatus: function StatusStub() {} };
      return require(id);
    },
  });
  return { ...module.exports, render() { index = 0; return module.exports.default(); } };
}

function elements(node, result = []) {
  if (Array.isArray(node)) node.forEach(item => elements(item, result));
  else if (node && typeof node === 'object' && node.props) {
    result.push(node);
    elements(node.props.children, result);
  }
  return result;
}

test('first-person UI: three explicit camera choices are labelled and report selected state', () => {
  const app = appHarness();
  const calls = [];
  const controls = app.MapCameraControls({ viewMode: 'first-person', onChange: mode => calls.push(mode) });
  const buttons = elements(controls).filter(node => node.type === 'button');
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map(button => button.props['aria-pressed']), [false, false, true]);
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(calls, ['overview', 'follow', 'first-person']);
  const html = renderToStaticMarkup(controls);
  assert.match(html, /aria-label="地图视角"/);
  for (const label of ['全镇鸟瞰', '跟随人物', '近距第三人称']) assert.ok(html.includes(label));
  assert.ok(html.includes('近距离第三人称'));
});

test('first-person UI: movement and destination navigation preserve first-person mode', () => {
  const app = appHarness();
  let nodes = elements(app.render());
  const cameraControls = () => nodes.find(node => node.type === app.MapCameraControls);
  const scene = () => nodes.find(node => typeof node.props.onStartExploring === 'function');
  assert.equal(cameraControls().props.viewMode, 'overview');
  scene().props.onStartExploring();
  nodes = elements(app.render());
  assert.equal(cameraControls().props.viewMode, 'follow');
  cameraControls().props.onChange('first-person');
  nodes = elements(app.render());
  scene().props.onStartExploring();
  nodes.find(node => node.props.className === 'button-plain reset-view').props.onClick();
  nodes = elements(app.render());
  assert.equal(cameraControls().props.viewMode, 'first-person');
  assert.equal(scene().props.destination.id, 'center');
  cameraControls().props.onChange('follow');
  nodes = elements(app.render());
  assert.equal(cameraControls().props.viewMode, 'follow');
});

test('first-person UI: scene status drives instructions and nearby entry remains available', () => {
  const app = appHarness();
  let nodes = elements(app.render());
  nodes.find(node => node.type === app.MapCameraControls).props.onChange('first-person');
  nodes = elements(app.render());
  const scene = nodes.find(node => typeof node.props.onLookStatus === 'function');
  scene.props.onLookStatus('locked');
  scene.props.onNearest('balloons');
  nodes = elements(app.render());
  const overlay = nodes.find(node => node.type === app.FirstPersonOverlay);
  assert.equal(overlay.props.status, 'locked');
  assert.ok(nodes.some(node => node.props.className === 'nearby-prompt'));
  for (const [status, text] of [['ready', '点击场景开启环视'], ['locked', '鼠标环视已开启'], ['drag', '拖动画面环视 · WASD 移动']]) {
    const html = renderToStaticMarkup(app.FirstPersonOverlay({ status }));
    assert.ok(html.includes(text));
    assert.ok(html.includes('拖动环视 · 长按喷气 · 空中点悬停'));
    assert.ok(html.includes('空格跳跃'));
    assert.match(html, /class="first-person-crosshair" aria-hidden="true"/);
  }
});

test('first-person UI: HUD does not intercept scene input and readable controls reflow at narrow widths', () => {
  assert.match(css, /\.first-person-overlay\s*\{[^}]*pointer-events:\s*none/);
  assert.match(css, /\.map-camera-controls button\s*\{[^}]*min-height:\s*44px[^}]*font-size:\s*var\(--text-control\)/);
  assert.match(css, /\.first-person-hint\s*\{[^}]*font-size:\s*var\(--text-body\)/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*grid-template-columns:\s*repeat\(2,/);
  const root = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.deepEqual(auditSources([
    { path: 'src/styles.css', content: root },
    { path: 'src/App.jsx', content: source },
    { path: 'src/expanded-map.css', content: css },
  ]).issues, []);
});

test('jump UI: touch and keyboard activation issue one request without changing camera mode', () => {
  const app = appHarness();
  const nodes = elements(app.render());
  const jump = nodes.find(node => node.props.className === 'mobile-jump-button');
  const scene = nodes.find(node => typeof node.props.onLookStatus === 'function');
  assert.equal(jump.props['aria-label'], '跳跃');
  let prevented = false;
  jump.props.onPointerDown({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(scene.props.inputRef.current.jumpRequested, 1);
  jump.props.onClick({ detail: 1 });
  assert.equal(scene.props.inputRef.current.jumpRequested, 1, 'pointer click does not duplicate pointerdown');
  jump.props.onClick({ detail: 0 });
  assert.equal(scene.props.inputRef.current.jumpRequested, 2, 'keyboard activation is supported');
  assert.equal(nodes.find(node => node.type === app.MapCameraControls).props.viewMode, 'overview');
});

test('hover UI: button queues one intent only in active airborne exploration', () => {
  const app = appHarness();
  let nodes = elements(app.render());
  let flight = nodes.find(node => typeof node.props.onToggleHover === 'function');
  let scene = nodes.find(node => typeof node.props.onFlyingChange === 'function');
  flight.props.onToggleHover();
  assert.equal(scene.props.inputRef.current.hoverToggle, undefined, 'grounded UI does not activate flight');
  scene.props.onFlyingChange(true);
  nodes = elements(app.render());
  flight = nodes.find(node => typeof node.props.onToggleHover === 'function');
  scene = nodes.find(node => typeof node.props.onFlyingChange === 'function');
  assert.equal(flight.props.flying, true);
  flight.props.onToggleHover();
  assert.equal(scene.props.inputRef.current.hoverToggle, 1);
  flight.props.onToggleHover();
  assert.equal(scene.props.inputRef.current.hoverToggle, 2);
  nodes.find(node => node.props['aria-label'] === '怎么玩').props.onClick();
  nodes = elements(app.render());
  flight = nodes.find(node => typeof node.props.onToggleHover === 'function');
  scene = nodes.find(node => typeof node.props.onFlyingChange === 'function');
  flight.props.onToggleHover();
  assert.equal(scene.props.inputRef.current.hoverToggle, undefined, 'modal suppresses flight button input');
});

test('day/night UI: local preview choice reaches the clock without changing network state', () => {
  const app = appHarness();
  let nodes = elements(app.render());
  const controls = () => nodes.find(node => typeof node.props.onChange === 'function' && node.props.label === '白天');
  assert.equal(controls().props.mode, 'auto');
  controls().props.onChange('night');
  nodes = elements(app.render());
  assert.equal(controls().props.mode, 'night');
  assert.ok(nodes.find(node => typeof node.props.onLookStatus === 'function').props.timeRef);
});

test('character UI: explicit navigation and selection carry only model fields into local Town', () => {
  const app = appHarness();
  let nodes = elements(app.render());
  const scene = () => nodes.find(node => typeof node.props.onLookStatus === 'function');
  assert.equal(scene().props.characterAsset, null);
  const navigation = nodes.find(node => node.type === 'button' && node.props.className?.includes('character-studio-nav'));
  assert.equal(navigation.props['aria-haspopup'], 'dialog');
  navigation.props.onClick();
  nodes = elements(app.render());
  const studio = nodes.find(node => typeof node.props.onCharacterChanged === 'function');
  assert.ok(studio, 'studio is absent until the navigation action');
  studio.props.onCharacterChanged({ id: 'private-job', modelUrl: '/private-model.glb', walkingUrl: '/private-walk.glb', facing: 'positive-z' });
  nodes = elements(app.render());
  assert.equal(scene().props.characterAsset.modelUrl, '/private-model.glb');
  assert.deepEqual(Object.keys(scene().props.characterAsset).sort(), ['facing', 'modelUrl', 'walkingUrl']);
  studio.props.onEnterTown();
  nodes = elements(app.render());
  assert.equal(scene().props.active, true);
  assert.equal(nodes.find(node => node.type === app.MapCameraControls).props.viewMode, 'follow');
  assert.equal(nodes.some(node => typeof node.props.onCharacterChanged === 'function'), false);
});
