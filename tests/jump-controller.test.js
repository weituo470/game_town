import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as THREE from 'three';
import * as catalog from '../src/lib/catalog.js';

const file = new URL('../src/components/town/PlayerController.jsx', import.meta.url);
const require = createRequire(file);
const transformed = await transformWithEsbuild(fs.readFileSync(file, 'utf8'), 'PlayerController.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });

function target() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, props = {}) { const event = { type, target: { tagName: 'BODY' }, preventDefault() {}, ...props }; for (const listener of listeners.get(type) || []) listener(event); },
  };
}

function harness(initial = {}) {
  const refs = [], effects = [], pending = [];
  let cursor = 0, frame, time = 0, tree;
  const win = target(), doc = { ...target(), hidden: false };
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 420);
  const size = { width: 1280, height: 720 };
  const inputRef = { current: {} };
  let explorations = 0;
  let props = { Model: 'Avatar', inputRef, active: true, viewMode: 'overview', onStartExploring() { explorations += 1; }, ...initial };
  const module = { exports: {} };
  vm.runInNewContext(transformed.code, {
    module, exports: module.exports, window: win, document: doc, performance: { now: () => time },
    require(id) {
      if (id === 'react') return {
        useRef(value) { const slot = cursor++; return refs[slot] ||= { current: value }; },
        useEffect(callback, deps) {
          const slot = cursor++, previous = effects[slot];
          if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) pending.push(() => { previous?.cleanup?.(); effects[slot] = { deps, cleanup: callback() }; });
        },
      };
      if (id === '@react-three/fiber') return { useFrame(callback) { frame = callback; }, useThree: () => ({ camera, size, invalidate() {} }) };
      if (id === '../../lib/catalog') return catalog;
      if (id === './FirstPersonLook.jsx') return { __esModule: true, default: 'Look' };
      return require(id);
    },
  });
  function render(changes = {}) { props = { ...props, ...changes }; cursor = 0; tree = module.exports.default(props); while (pending.length) pending.shift()(); return tree; }
  function all(node, result = []) { if (Array.isArray(node)) node.forEach(child => all(child, result)); else if (node?.props) { result.push(node); all(node.props.children, result); } return result; }
  render();
  const pose = () => all(tree).find(node => node.props.self)?.props.poseRef.current;
  return { window: win, document: doc, inputRef, render, pose, camera, size, explorations: () => explorations,
    frame(count = 1) { for (let i = 0; i < count; i++) { time += 1000 / 60; frame({}, 1 / 60); } },
  };
}

test('overview first Space jumps immediately without a camera-switch stop swallowing it', () => {
  const app = harness();
  app.window.emit('keydown', { code: 'Space', repeat: false });
  app.frame();
  assert.ok(app.pose().y > 0 && app.pose().vy > 0);
  assert.equal(app.explorations(), 0, 'jump alone preserves overview');
  app.window.emit('keyup', { code: 'Space' });
  app.frame(70);
  assert.equal(app.pose().y, 0, 'a short tap is still an ordinary jump');
  app.window.emit('keyup', { code: 'Space' });
  app.window.emit('keydown', { code: 'Space', repeat: false });
  app.frame();
  assert.ok(app.pose().y > 0);
});

test('touch requests consume once, never queue air jumps, and survive a reset counter', () => {
  const app = harness();
  app.inputRef.current.jumpRequested = 1;
  app.frame();
  assert.ok(app.pose().y > 0);
  assert.equal(app.inputRef.current.jumpRequested, 0);
  for (let i = 0; i < 20; i++) { app.inputRef.current.jumpRequested += 1; app.frame(); }
  app.frame(60);
  assert.equal(app.pose().y, 0);
  app.inputRef.current = { jumpRequested: 1 };
  app.frame();
  assert.ok(app.pose().y > 0, 'new counter object still requests one jump');
});

test('Space preserves native UI activation and does not also jump from direction buttons', () => {
  const app = harness();
  let prevented = 0;
  const targets = [
    { tagName: 'BUTTON' }, { tagName: 'A' }, { tagName: 'SUMMARY' },
    { tagName: 'SPAN', closest(selector) { assert.match(selector, /\[role="button"\]/); return { tagName: 'BUTTON' }; } },
  ];
  for (const target of targets) {
    app.window.emit('keydown', { code: 'Space', repeat: false, target, preventDefault() { prevented += 1; } });
    app.frame();
    assert.equal(app.pose().y, 0, 'focused UI does not launch a scene jump');
    app.window.emit('keyup', { code: 'Space', target });
  }
  assert.equal(prevented, 0, 'native click/activation remains available to camera and passport buttons');
  // The direction button's own handler runs before bubbling to window.
  app.inputRef.current.forward = true;
  app.window.emit('keydown', { code: 'Space', repeat: false, target: { tagName: 'BUTTON' } });
  app.frame();
  assert.equal(app.pose().y, 0);
  assert.ok(app.pose().moving, 'the button keeps its intended directional action');
  app.inputRef.current.forward = false;
  // The UI jump button's native keyboard click is its only jump request.
  app.inputRef.current.jumpRequested = 1;
  app.frame();
  assert.ok(app.pose().y > 0);
});

test('editable fields, modal, blur and hidden tabs cannot queue or retain airborne input', () => {
  const app = harness();
  app.window.emit('keydown', { code: 'Space', target: { tagName: 'INPUT' } }); app.frame();
  assert.equal(app.pose().y, 0);
  app.inputRef.current.jumpRequested = 1; app.frame();
  app.render({ active: false });
  assert.equal(app.pose().y, 0);
  app.inputRef.current.jumpRequested = 1; app.frame();
  app.render({ active: true }); app.frame();
  assert.equal(app.pose().y, 0);
  app.inputRef.current.jumpRequested = 1; app.frame();
  app.window.emit('blur'); assert.equal(app.pose().y, 0);
  app.inputRef.current.jumpRequested = 1; app.frame();
  app.window.emit('focus'); app.frame(); assert.equal(app.pose().y, 0);
  app.inputRef.current.jumpRequested = 1; app.frame();
  app.document.hidden = true; app.document.emit('visibilitychange');
  assert.equal(app.pose().y, 0);
});

test('jump prediction ignores stale ground patches and cancellation ignores stale airborne patches', () => {
  const packets = [], player = { id: 'self', x: 0, z: 10.7, y: 0, vy: 0, yaw: 0, seq: 900, connected: true };
  const network = { status: 'connected', selfId: 'self', players: [player], snapshotRef: { current: { players: [player], selfId: 'self', tick: 1 } }, sendInput(packet) { packets.push(packet); return true; } };
  const app = harness({ network });
  app.frame();
  app.inputRef.current.jumpRequested = 1; app.frame();
  const jump = packets.find(packet => packet.jump);
  assert.ok(jump.seq > 900);
  assert.ok(app.pose().y > 0);
  network.snapshotRef.current = { players: [{ ...player }], selfId: 'self', tick: 2 };
  app.frame(5);
  assert.ok(app.pose().y > 0.4, 'pre-jump authority does not reset prediction');
  app.window.emit('blur');
  const stop = packets.at(-1);
  assert.ok(stop.stop && stop.seq > jump.seq);
  network.snapshotRef.current = { players: [{ ...player, y: 1.4, vy: 1, seq: jump.seq }], selfId: 'self', tick: 3 };
  app.frame(5);
  assert.equal(app.pose().y, 0, 'pre-stop authority does not resurrect the jump');
});

test('returning to overview from first person restores the resized automatic orthographic frustum', () => {
  const app = harness();
  app.size.width = 1092; app.size.height = 1244;
  app.render({ viewMode: 'overview' });
  assert.equal(app.camera.top, 622);
  app.render({ viewMode: 'first-person' });
  app.size.width = 1280; app.size.height = 648;
  app.render();
  assert.equal(app.camera.top, 622, 'retained camera is not touched while first person owns the view');
  app.render({ viewMode: 'overview' });
  assert.equal(app.camera.left, -640);
  assert.equal(app.camera.right, 640);
  assert.equal(app.camera.top, 324);
  assert.equal(app.camera.bottom, -324);
  assert.equal((app.camera.right - app.camera.left) / (app.camera.top - app.camera.bottom), 1280 / 648);
  app.camera.manual = true;
  app.camera.left = -7; app.camera.right = 7; app.camera.top = 4; app.camera.bottom = -4;
  app.size.width = 390;
  app.render({ viewMode: 'overview' });
  assert.equal(app.camera.left, -7, 'explicit manual camera frusta stay caller-owned');
  assert.equal(app.camera.top, 4);
});

test('global jetpack controller: long Space starts in overview, survives auto-follow, release falls immediately', () => {
  const app=harness(), flightRef={current:{}};
  app.render({flightRef});app.window.emit('keydown',{code:'Space',repeat:false});app.frame(35);
  assert.equal(app.pose().jetpack,true);assert.equal(app.pose().thrusting,true);assert.ok(app.pose().y>2);assert.equal(app.explorations(),1);
  const height=app.pose().y;app.render({viewMode:'follow'});app.frame(12);assert.ok(app.pose().y>height,'auto-follow does not clear a held engine');
  app.window.emit('keyup',{code:'Space'});const releaseHeight=app.pose().y;app.frame();assert.equal(app.pose().thrusting,false);assert.ok(app.pose().y<releaseHeight);
  app.frame(180);assert.equal(app.pose().y,0);assert.equal(app.pose().jetpack,false);assert.equal(flightRef.current.flying,false);
});

test('global jetpack controller: touch hold works anywhere and blur cuts thrust without teleporting to ground', () => {
  const app=harness({viewMode:'follow'});app.inputRef.current.jetHeld=true;app.inputRef.current.jumpRequested=1;app.frame(50);
  assert.equal(app.pose().thrusting,true);const height=app.pose().y;app.window.emit('blur');assert.equal(app.pose().y,height);assert.equal(app.pose().thrusting,false);
  app.frame(20);assert.ok(app.pose().y<height);assert.equal(app.inputRef.current.jetHeld,undefined);
});

test('outdoor practice: overrides the local visual only, ignores movement and restores position/camera', () => {
  const outdoorRef = { current: null }, app = harness({ outdoorRef, viewMode: 'follow' });
  app.frame(); const original = { ...app.pose() };
  outdoorRef.current = { id: 'fishing', pose: { x: -31, y: 0, z: 24.5, yaw: Math.PI, moving: false } };
  app.frame(); assert.equal(app.pose().x, -31); assert.equal(app.camera.view.enabled, true);
  app.window.emit('keydown', { code: 'KeyW' }); app.inputRef.current.jumpRequested = 1; app.frame(5);
  assert.equal(app.pose().z, 24.5); assert.equal(app.pose().y, 0);
  outdoorRef.current = null; app.frame();
  assert.equal(app.pose().x, original.x); assert.equal(app.pose().z, original.z); assert.equal(app.pose().y, 0);
  assert.equal(app.camera.view.enabled, false); assert.equal(app.pose().moving, false);
});

test('outdoor practice: sends a stop, never sends flight coordinates, reconciles authority on exit', () => {
  const packets = [], player = { id: 'self', x: 0, z: 10.7, y: 0, vy: 0, yaw: 0, seq: 10, connected: true };
  const network = { status: 'connected', selfId: 'self', players: [player], snapshotRef: { current: { players: [player], selfId: 'self', tick: 1 } }, sendInput(packet) { packets.push(packet); return true; } };
  const outdoorRef = { current: null }, app = harness({ network, outdoorRef, viewMode: 'follow' });
  app.frame(); packets.length = 0;
  outdoorRef.current = { id: 'jetpack', pose: { x: 31, z: 20, y: 7, yaw: Math.PI, moving: true } };
  app.frame(30); assert.equal(app.pose().y, 7); assert.equal(packets.length, 1); assert.equal(packets[0].stop, true);
  assert.equal('y' in packets[0], false); assert.equal('position' in packets[0], false);
  outdoorRef.current = null; app.frame(); assert.equal(app.pose().x, player.x); assert.equal(app.pose().z, player.z); assert.equal(app.pose().y, 0);
});
