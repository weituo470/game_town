import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as THREE from 'three';
import * as catalog from '../src/lib/catalog.js';
import { SPAWN } from '../shared/world.js';
import { OFFSHORE_ARRIVAL, sampleOffshorePassenger, sampleOffshoreVoyage } from '../shared/offshore-island.js';
import { followOrbitCamera } from '../src/components/town/camera.js';

const file = new URL('../src/components/town/PlayerController.jsx', import.meta.url), require = createRequire(file);
const code = (await transformWithEsbuild(fs.readFileSync(file, 'utf8'), 'PlayerController.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code;
const elements = (node, list = []) => { if (Array.isArray(node)) node.forEach(child => elements(child, list)); else if (node?.props) { list.push(node); elements(node.props.children, list); } return list; };
function emitter() {
  const events = new Map();
  return { hidden: false, addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); },
    emit(type, details = {}) { for (const fn of events.get(type) || []) fn({ target: { tagName: 'BODY' }, preventDefault() {}, ...details }); } };
}
function harness({ remote = false, outdoorRef = { current: null }, viewMode = 'offshore' } = {}) {
  const contexts = { self: { slots: [], effects: [], pending: [], cursor: 0 }, remote: { slots: [], effects: [], pending: [], cursor: 0 } };
  let context = contexts.self, time = 150000, tree;
  const runtime = { now: time, plan: { startAt: 100000, returnAt: 0 }, aboard: !remote, seat: 2 };
  Object.defineProperty(runtime, 'sample', { get: () => sampleOffshoreVoyage(runtime.plan, runtime.now) });
  const inputRef = { current: {} }, poseRef = { current: null }, flightRef = { current: {} }, win = emitter(), doc = emitter(), packets = [];
  const self = { ...SPAWN, id: 'self', seq: 0, y: 0, vy: 0, yaw: 0, connected: true };
  const other = { ...self, id: 'remote', name: '同行者', aboard: true, offshoreSeat: 5, y: 0, vy: -50 };
  const snapshotRef = { current: { selfId: 'self', tick: 1, players: [self, other] } };
  const network = remote ? { status: 'connected', selfId: 'self', players: [self, other], snapshotRef, sendInput(packet) { packets.push(packet); } } : null;
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, .2, 1000);
  camera.position.set(100, 100, 100);
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
  const props = { Model: 'Avatar', active: false, viewMode, inputRef, playerPoseRef: poseRef, flightRef, offshoreRef: { current: runtime }, outdoorRef, network };
  function render(changes = {}) { Object.assign(props, changes); context = contexts.self; context.cursor = 0; tree = module.exports.default(props); while (context.pending.length) context.pending.shift()(); }
  render();
  let remotePose;
  if (remote) {
    const child = elements(tree).find(node => typeof node.type === 'function' && node.props.player?.id === 'remote');
    context = contexts.remote; context.cursor = 0; remotePose = child.type(child.props).props.poseRef;
    while (context.pending.length) context.pending.shift()();
  }
  return { runtime, inputRef, poseRef, remotePose, flightRef, camera, win, snapshotRef, outdoorRef, packets, render,
    lookRef: () => elements(tree).find(node => node.type === 'Look').props.lookRef,
    frame(delta = 1 / 60, kind = 'self') { time += delta * 1000; runtime.now = time; contexts[kind].frame({}, delta); },
    dispose() { for (const ctx of Object.values(contexts)) for (const effect of ctx.effects) effect?.cleanup?.(); } };
}
function assertPose(actual, expected) {
  for (const key of ['x', 'y', 'z', 'yaw', 'vy', 'aboard', 'jetpack', 'thrusting', 'hovering']) assert.equal(actual[key], expected[key], key);
}

test('self passenger follows the exact deck every frame without gravity, held thrust, movement or offshore-camera writes', () => {
  const app = harness(), lens = app.camera.position.clone();
  try {
    app.frame();
    for (let i = 0; i < 120; i++) {
      app.inputRef.current = { forward: true, right: true, jetHeld: true, jumpRequested: 1, hoverToggle: 1 };
      app.win.emit('keydown', { code: 'Space' }); app.win.emit('keydown', { code: 'KeyW' });
      app.frame(i % 2 ? 1 / 120 : 1 / 15);
      assertPose(app.poseRef.current, sampleOffshorePassenger(app.runtime.plan, app.runtime.now, app.runtime.seat));
      assert.equal(app.poseRef.current.moving, false); assert.equal(app.flightRef.current.flying, false);
      assert.deepEqual(app.camera.position.toArray(), lens.toArray());
    }
  } finally { app.dispose(); }
});

test('remote passenger uses the same deterministic deck and leaves at the authoritative dock without falling/extrapolating at sea', () => {
  const app = harness({ remote: true });
  try {
    for (let i = 0; i < 50; i++) {
      app.frame(.1, 'remote');
      assertPose(app.remotePose.current, sampleOffshorePassenger(app.runtime.plan, app.runtime.now, 5));
    }
    const next = { ...app.snapshotRef.current.players[1], ...OFFSHORE_ARRIVAL, aboard: false, offshoreSeat: -1, y: 0, vy: 0, moving: false, jetpack: false };
    app.snapshotRef.current = { ...app.snapshotRef.current, tick: 2, players: [app.snapshotRef.current.players[0], next] };
    app.frame(.1, 'remote');
    assert.equal(app.remotePose.current.aboard, false); assert.equal(app.remotePose.current.y, 0);
    assert.equal(app.remotePose.current.x, OFFSHORE_ARRIVAL.x); assert.equal(app.remotePose.current.z, OFFSHORE_ARRIVAL.z);
  } finally { app.dispose(); }
});

test('boarding clears old outdoor-return state so disembark returns to the dock, not an old activity location', () => {
  const outdoorRef = { current: { id: 'fishing', phase: 'ready', timer: 0, pose: { x: -55, y: 0, z: 25, yaw: 1 } } };
  const app = harness({ outdoorRef }); app.runtime.aboard = false;
  try {
    app.frame(); assert.equal(app.poseRef.current.activity, 'fishing');
    app.runtime.aboard = true; app.frame(); assert.equal(app.poseRef.current.aboard, true); assert.equal(app.poseRef.current.activity, null);
    outdoorRef.current = null; app.runtime.aboard = false; app.runtime.plan = { startAt: 0, returnAt: 0 }; app.frame();
    assert.equal(app.poseRef.current.x, OFFSHORE_ARRIVAL.x); assert.equal(app.poseRef.current.z, OFFSHORE_ARRIVAL.z);
    assert.equal(app.poseRef.current.y, 0); assert.equal(app.poseRef.current.aboard, false); assert.equal(app.poseRef.current.jetpack, false);
    app.frame(.1); assert.equal(app.poseRef.current.x, OFFSHORE_ARRIVAL.x); assert.equal(app.poseRef.current.z, OFFSHORE_ARRIVAL.z);
  } finally { app.dispose(); }
});

test('closing aboard observation into follow initializes the port-side view, rotates with the ship and preserves manual orbit intent', () => {
  const app = harness();
  try {
    app.frame(); app.render({ viewMode: 'follow', active: true });
    assert.equal(app.lookRef().current.yaw, Math.PI / 2);
    for (const delta of [1 / 60, 15, 1 / 60]) {
      app.frame(delta);
      const expected = followOrbitCamera(app.poseRef.current, app.lookRef().current.yaw - app.runtime.sample.yaw, .12, { aspect: app.camera.aspect });
      assert.deepEqual(app.camera.position.toArray(), [expected.position.x, expected.position.y, expected.position.z]);
    }
    const before = app.camera.position.clone();
    app.lookRef().current.yaw += .4;
    app.frame(0);
    assert.ok(app.camera.position.distanceTo(before) > .2, 'manual orbit is not reset by the next ship frame');
    assertPose(app.poseRef.current, sampleOffshorePassenger(app.runtime.plan, app.runtime.now, app.runtime.seat));
  } finally { app.dispose(); }
});
