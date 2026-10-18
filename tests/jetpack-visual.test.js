import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { transformWithEsbuild } from 'vite';
import { jetpackVisualState } from '../src/components/town/jetpackVisual.js';
import { stepAvatar, stoppedVertical } from '../shared/jetpack.js';
import { SPAWN } from '../shared/world.js';
import * as catalog from '../src/lib/catalog.js';

const ground = () => ({ ...SPAWN, y: 0, vy: 0, jetpack: false, thrusting: false, hovering: false });
const hover = () => ({ ...ground(), y: 100, jetpack: true, hovering: true });

test('backpacks are equipped by default on the ground without activating flight, changing movement, or emitting exhaust', () => {
  for (const pose of [undefined, {}, ground(), { ...ground(), moving: true }, { ...ground(), thrusting: true, hovering: true }]) {
    assert.deepEqual(jetpackVisualState(pose), { equipped: true, firing: false, hovering: false });
  }
  let pose = ground();
  for (let i = 0; i < 600; i++) {
    assert.equal(jetpackVisualState(pose).equipped, true);
    pose = stepAvatar(pose, { x: 0, z: 0 }, 1 / 60);
  }
  assert.equal(pose.y, 0); assert.equal(pose.vy, 0); assert.equal(pose.jetpack, false);
});

test('hover exhaust is purely visual, holds exactly the same altitude and never turns thrusting on', () => {
  let pose = hover();
  for (let i = 0; i < 600; i++) {
    const before = { ...pose };
    assert.deepEqual(jetpackVisualState(Object.freeze(pose)), { equipped: true, firing: true, hovering: true });
    assert.deepEqual(pose, before);
    pose = stepAvatar(pose, { x: 0, z: 0, hover: true }, 1 / 60);
    assert.equal(pose.y, 100); assert.equal(pose.vy, 0); assert.equal(pose.thrusting, false);
  }
  const rising = { ...pose, hovering: false, thrusting: true };
  assert.deepEqual(jetpackVisualState(rising), { equipped: true, firing: true, hovering: false });
  assert.ok(stepAvatar(rising, { thrust: true }, .1).y > 100);
});

test('release, stop and touchdown cut the plume; invalid values and outdoor activities never ignite it', () => {
  const falling = { ...hover(), hovering: false, vy: -3 };
  assert.equal(jetpackVisualState(falling).firing, false);
  const stopped = { ...hover(), ...stoppedVertical(hover()) };
  assert.equal(jetpackVisualState(stopped).firing, false);
  assert.ok(stepAvatar(stopped, {}, .1).y < 100);
  for (const activity of ['fishing', 'hop', 'jetpack']) assert.deepEqual(jetpackVisualState({ ...hover(), activity }), { equipped: false, firing: false, hovering: false });
  for (const y of [0, -1, Infinity, NaN, '10', undefined]) assert.equal(jetpackVisualState({ ...hover(), y }).firing, false);
  for (const field of ['thrusting', 'hovering']) assert.equal(jetpackVisualState({ ...ground(), jetpack: true, y: 100, [field]: 'true' }).firing, false);
  assert.equal(jetpackVisualState({ ...hover(), jetpack: false }).firing, false);
  assert.equal(jetpackVisualState({ ...hover(), hovering: false, vy: 0 }).firing, false, 'standing on an elevated roof is not hovering');
});

const rigFile = new URL('../src/components/town/JetpackRig.jsx', import.meta.url);
const rigCode = (await transformWithEsbuild(fs.readFileSync(rigFile, 'utf8'), 'JetpackRig.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code;
function rigHarness(pose, reducedMotion = false) {
  const require = createRequire(rigFile), refs = [];
  let frame;
  const module = { exports: {} };
  vm.runInNewContext(rigCode, { module, exports: module.exports, require(id) {
    if (id === 'react') return { useRef() { const ref = { current: new THREE.Group() }; refs.push(ref); return ref; } };
    if (id === '@react-three/fiber') return { useFrame(callback) { frame = callback; } };
    if (id === './jetpackVisual.js') return { jetpackVisualState };
    return require(id);
  } });
  const poseRef = { current: pose }, tree = module.exports.default({ poseRef, reducedMotion });
  return { tree, poseRef, rig: refs[0].current, jets: refs[1].current, frame: time => frame({ clock: { elapsedTime: time } }) };
}

test('actual JetpackRig mounts equipped before its first frame and updates hover, thrust, cut and outdoor states', () => {
  const h = rigHarness(ground());
  assert.equal(h.tree.props.visible, true);
  const jetNode = h.tree.props.children.find(node => node?.props?.ref && node.props.ref.current === h.jets);
  assert.equal(jetNode.props.visible, false);
  h.frame(0); assert.equal(h.rig.visible, true); assert.equal(h.jets.visible, false);
  h.poseRef.current = hover(); h.frame(1);
  assert.equal(h.jets.visible, true); assert.ok(h.jets.scale.y > .5 && h.jets.scale.y < .7);
  const hoverScale = h.jets.scale.y;
  h.poseRef.current = { ...hover(), hovering: false, thrusting: true }; h.frame(1);
  assert.ok(h.jets.scale.y > hoverScale);
  h.poseRef.current = { ...hover(), hovering: false }; h.frame(2); assert.equal(h.jets.visible, false);
  h.poseRef.current = { ...ground(), activity: 'fishing' }; h.frame(3); assert.equal(h.rig.visible, false);
  h.poseRef.current = ground(); h.frame(4); assert.equal(h.rig.visible, true); assert.equal(h.jets.visible, false);
});

test('reduced-motion hover keeps a steady visible plume instead of pulsing or changing altitude', () => {
  const pose = Object.freeze(hover()), h = rigHarness(pose, true);
  for (const time of [0, .15, 1, 100, 10000]) {
    h.frame(time); assert.equal(h.jets.visible, true); assert.equal(h.jets.scale.y, .7);
    assert.equal(pose.y, 100); assert.equal(pose.thrusting, false);
  }
});

const controllerFile = new URL('../src/components/town/PlayerController.jsx', import.meta.url);
const controllerCode = (await transformWithEsbuild(fs.readFileSync(controllerFile, 'utf8'), 'PlayerController.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code;
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(item => nodes(item, result)); else if (node?.props) { result.push(node); nodes(node.props.children, result); } return result; }

test('real remote-player interpolation shows hover exhaust immediately and stops it on stale snapshots', () => {
  const require = createRequire(controllerFile);
  const remote = { ...hover(), id: 'remote', name: '远端', connected: true };
  const self = { ...ground(), id: 'self', connected: true };
  const snapshotRef = { current: { selfId: 'self', players: [self, remote] } };
  let frame, time = 0;
  const module = { exports: {} };
  vm.runInNewContext(controllerCode, { module, exports: module.exports, performance: { now: () => time }, require(id) {
    if (id === 'react') return { useRef: value => ({ current: value }), useEffect() {} };
    if (id === '@react-three/fiber') return { useFrame(callback) { frame = callback; }, useThree: () => ({ camera: new THREE.PerspectiveCamera(), size: { width: 1280, height: 720 }, invalidate() {} }) };
    if (id === '../../lib/catalog') return catalog;
    if (id === './FirstPersonLook.jsx') return { __esModule: true, default: 'Look' };
    return require(id);
  } });
  const tree = module.exports.default({ Model: 'Avatar', active: true, network: { status: 'connected', selfId: 'self', players: [self, remote], snapshotRef } });
  const child = nodes(tree).find(node => node.props.player?.id === 'remote');
  assert.ok(child);
  const avatar = child.type(child.props), pose = avatar.props.poseRef.current;
  assert.equal(pose.hovering, true, 'first-frame pose contains the authoritative hover bit');
  assert.equal(jetpackVisualState(pose).firing, true);
  frame({}, .05); time = 100; frame({}, .05);
  assert.equal(pose.y, 100); assert.equal(pose.vy, 0); assert.equal(pose.thrusting, false); assert.equal(jetpackVisualState(pose).firing, true);
  time = 600; frame({}, .05);
  assert.equal(pose.hovering, false); assert.equal(jetpackVisualState(pose).firing, false); assert.ok(pose.y < 100);
  snapshotRef.current = { selfId: 'self', players: [self, { ...remote, ...ground() }] };
  frame({}, .05);
  assert.equal(jetpackVisualState(pose).equipped, true); assert.equal(jetpackVisualState(pose).firing, false);
});
