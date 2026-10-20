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
import { offshoreWalkingCamera } from '../src/components/town/offshoreWalking.js';
import { isOffshoreDeckWalkable } from '../shared/offshore-deck.js';

const file = new URL('../src/components/town/PlayerController.jsx', import.meta.url), require = createRequire(file);
const code = (await transformWithEsbuild(fs.readFileSync(file, 'utf8'), 'PlayerController.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code;
const elements = (node, list = []) => { if (Array.isArray(node)) node.forEach(child => elements(child, list)); else if (node?.props) { list.push(node); elements(node.props.children, list); } return list; };
function emitter() {
  const events = new Map();
  return { hidden: false, addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); },
    emit(type, details = {}) { for (const fn of events.get(type) || []) fn({ target: { tagName: 'BODY' }, preventDefault() {}, ...details }); } };
}
function harness({ remote = false, online = false, outdoorRef = { current: null }, viewMode = 'offshore' } = {}) {
  const contexts = { self: { slots: [], effects: [], pending: [], cursor: 0 }, remote: { slots: [], effects: [], pending: [], cursor: 0 } };
  let context = contexts.self, time = 150000, tree;
  const runtime = { now: time, plan: { startAt: 100000, returnAt: 0 }, aboard: !remote, seat: 2 };
  Object.defineProperty(runtime, 'sample', { get: () => sampleOffshoreVoyage(runtime.plan, runtime.now) });
  const inputRef = { current: {} }, poseRef = { current: null }, flightRef = { current: {} }, win = emitter(), doc = emitter(), packets = [];
  const self = { ...SPAWN, id: 'self', seq: 0, y: 0, vy: 0, yaw: 0, connected: true };
  if (online) Object.assign(self, sampleOffshorePassenger(runtime.plan, time, runtime.seat));
  const other = { ...self, id: 'remote', name: '同行者', aboard: true, offshoreSeat: 5, y: 0, vy: -50 };
  const snapshotRef = { current: { selfId: 'self', tick: 1, players: [self, other] } };
  const network = remote || online ? { status: 'connected', selfId: 'self', players: [self, other], snapshotRef, sendInput(packet) { packets.push(packet); } } : null;
  Object.defineProperty(runtime, 'self', { get: () => online ? snapshotRef.current.players.find(p => p.id === 'self') : null });
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
  return { runtime, inputRef, poseRef, remotePose, flightRef, camera, win, doc, network, snapshotRef, outdoorRef, packets, render,
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
      const expected = offshoreWalkingCamera(app.poseRef.current, app.runtime.sample, app.lookRef().current, false, app.camera.aspect);
      assert.deepEqual(app.camera.position.toArray(), [expected.position.x, expected.position.y, expected.position.z]);
    }
    const before = app.camera.position.clone();
    app.lookRef().current.yaw += .4;
    app.frame(0);
    assert.ok(app.camera.position.distanceTo(before) > .2, 'manual orbit is not reset by the next ship frame');
    assertPose(app.poseRef.current, sampleOffshorePassenger(app.runtime.plan, app.runtime.now, app.runtime.seat));
  } finally { app.dispose(); }
});

test('follow mode walks with WASD and touch directions while the local deck rides the turning ship', () => {
  const app = harness();
  try {
    app.frame(); app.render({ viewMode: 'follow', active: true });
    const before = { ...app.poseRef.current };
    app.win.emit('keydown', { code: 'KeyA' });
    for (let i = 0; i < 30; i++) { app.frame(); assert.ok(isOffshoreDeckWalkable(app.poseRef.current.deckX, app.poseRef.current.deckZ)); }
    assert.ok(app.poseRef.current.deckZ < before.deckZ - 1.5);
    app.win.emit('keyup', { code: 'KeyA' });
    app.inputRef.current = { backward: true, jetHeld: true, jumpRequested: 1, hoverToggle: 1 };
    const x = app.poseRef.current.deckX;
    for (let i = 0; i < 20; i++) app.frame();
    assert.ok(app.poseRef.current.deckX < x - 1);
    assert.equal(app.poseRef.current.jetpack, false); assert.equal(app.poseRef.current.vy, 0);
    assertPose(app.poseRef.current, sampleOffshorePassenger(app.runtime.plan, app.runtime.now, app.runtime.seat, app.poseRef.current));
    const stood = { ...app.poseRef.current };
    app.win.emit('blur'); app.frame(10);
    assert.equal(app.poseRef.current.deckX, stood.deckX); assert.equal(app.poseRef.current.deckZ, stood.deckZ);
    assert.equal(app.poseRef.current.moving, false); assert.notEqual(app.poseRef.current.z, stood.z, 'standing passenger still travels with the boat');
    app.win.emit('focus'); app.render({ viewMode: 'offshore', active: false });
    const observation = { ...app.poseRef.current };
    app.inputRef.current = { forward: true }; app.frame();
    assert.equal(app.poseRef.current.deckX, observation.deckX);
    app.render({ viewMode: 'follow', active: true }); app.frame();
    assert.equal(app.poseRef.current.deckX, observation.deckX, 'return to walking preserves the previous location');
  } finally { app.dispose(); }
});

test('online follow predicts only deck directions, reconciles authoritative local fields and freezes on reconnect', () => {
  const app = harness({ online: true });
  try {
    app.frame(); app.render({ viewMode: 'follow', active: true });
    app.win.emit('keydown', { code: 'KeyA' });
    for (let i = 0; i < 20; i++) app.frame();
    assert.ok(app.poseRef.current.deckZ < 5);
    assert.ok(app.packets.some(p => p.z < -.9));
    assert.ok(app.packets.every(p => !('deckX' in p) && !('deckZ' in p) && !p.thrust && !p.hover && !p.jump));
    app.win.emit('keyup', { code: 'KeyA' });
    const authoritative = { ...app.snapshotRef.current.players[0], deckX: -8, deckZ: 5.1, deckYaw: Math.PI, moving: false, seq: 100 };
    app.snapshotRef.current = { ...app.snapshotRef.current, tick: 3, players: [authoritative] };
    for (let i = 0; i < 60; i++) app.frame();
    assert.ok(Math.abs(app.poseRef.current.deckZ - 5.1) < .001);
    app.network.status = 'reconnecting'; app.render();
    const stopped = { ...app.poseRef.current };
    app.win.emit('keydown', { code: 'KeyW' }); app.inputRef.current = { forward: true };
    for (let i = 0; i < 30; i++) app.frame();
    assert.equal(app.poseRef.current.deckX, stopped.deckX); assert.equal(app.poseRef.current.deckZ, stopped.deckZ);
    assert.equal(app.poseRef.current.moving, false);
  } finally { app.dispose(); }
});
