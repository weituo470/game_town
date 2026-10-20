import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformWithEsbuild } from 'vite';
import * as THREE from 'three';
import { SPHERE_LANDMARK, SPHERE_BRIDGE, SPHERE_MODES } from '../shared/sphere-landmark.js';
import { createSphereLandmark, sampleSphereWall, SPHERE_RENDER_BUDGET } from '../src/components/sphere/createSphereLandmark.js';
import { sphereWallVertexShader, sphereWallFragmentShader } from '../src/components/sphere/sphereWallShaders.js';
import { SPHERE_BUBBLE_BUDGET, sampleSphereBubbleCue } from '../src/components/sphere/sphereBubbleCycle.js';
import { sampleDayNight } from '../shared/dayNight.js';

test('sphere landmark is a bounded one-canvas local model with no downloaded assets', () => {
  const model = createSphereLandmark(), stats = model.statistics;
  assert.ok(model.group.isGroup); assert.deepEqual(model.group.position.toArray(), [0, 0, 0]);
  assert.ok(stats.drawCalls <= SPHERE_RENDER_BUDGET.drawCalls, `${stats.drawCalls} calls`);
  assert.ok(stats.triangles <= SPHERE_RENDER_BUDGET.triangles, `${stats.triangles} triangles`);
  let triangles = 0, calls = 0;
  model.group.traverse(node => {
    assert.equal(Boolean(node.isLight || node.isCamera), false);
    if (!node.isMesh) return; calls++;
    const count = node.geometry.index?.count ?? node.geometry.attributes.position.count;
    triangles += count / 3 * (node.isInstancedMesh ? node.count : 1);
    assert.ok(node.geometry.attributes.position.array.every(Number.isFinite));
    assert.equal(node.userData.sphereLandmark, 'sphere');
    for (const value of Object.values(node.material)) assert.equal(Boolean(value?.isTexture), false);
  });
  assert.equal(calls, stats.drawCalls); assert.equal(triangles, stats.triangles);
  model.dispose();
});

test('real truncated sphere meets its solid pedestal, faces the town and retains warm stone ground', () => {
  const model = createSphereLandmark(), spec = SPHERE_LANDMARK, wall = model.group.getObjectByName('sphere-led-wall');
  assert.equal(wall.geometry.parameters.radius, spec.radius); assert.equal(wall.position.y, spec.centerY); assert.equal(wall.rotation.y, spec.faceYaw);
  wall.geometry.computeBoundingBox();
  assert.ok(Math.abs(wall.geometry.boundingBox.min.y + wall.position.y - spec.baseY) < 1e-5);
  assert.ok(Math.abs(wall.geometry.boundingBox.max.y + wall.position.y - spec.radius - spec.centerY) < 1e-5);
  const drum = model.group.getObjectByName('sphere-glazed-drum'), cap = model.group.getObjectByName('sphere-drum-cap');
  drum.geometry.computeBoundingBox(); cap.geometry.computeBoundingBox();
  assert.ok(drum.geometry.boundingBox.min.y + drum.position.y <= .35 + 1e-5);
  assert.ok(drum.geometry.boundingBox.max.y + drum.position.y >= spec.baseY);
  assert.ok(cap.geometry.boundingBox.max.y + cap.position.y >= spec.baseY);
  assert.ok(drum.geometry.parameters.radiusTop > Math.sqrt(spec.radius ** 2 - (spec.baseY - spec.centerY) ** 2));
  const ground = model.group.getObjectByName('sphere-island-town-paving');
  assert.equal(ground.geometry.parameters.radiusTop, spec.groundRadius);
  assert.ok(ground.material.color.r > ground.material.color.b && ground.material.color.g > ground.material.color.b);
  const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), wall.rotation.y);
  assert.ok(normal.x > .9 && normal.z > .3); model.dispose();
});

test('rendered bridge uses the shared world contract and keeps its top just below adjoining stone', () => {
  const model = createSphereLandmark(), deck = model.group.getObjectByName('sphere-town-bridge-deck');
  assert.equal(deck.position.x + SPHERE_LANDMARK.x, SPHERE_BRIDGE.x);
  assert.equal(deck.position.z + SPHERE_LANDMARK.z, SPHERE_BRIDGE.z);
  assert.equal(deck.scale.x, SPHERE_BRIDGE.width); assert.equal(deck.scale.z, SPHERE_BRIDGE.depth);
  assert.ok(Math.abs(deck.position.y + deck.scale.y / 2 + .02) < 1e-9);
  const rails = model.group.getObjectByName('sphere-town-bridge-rails'), matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  for (let i = 0; i < rails.count; i++) { rails.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix); assert.ok(Math.hypot(position.x, position.z) >= SPHERE_LANDMARK.groundRadius - .15); }
  model.dispose();
});

test('all four artwork modes and auto crossfade are deterministic under arbitrary seeking', () => {
  const modes = SPHERE_MODES.filter(mode => mode.id !== 'auto').map(mode => mode.id);
  assert.deepEqual(modes, ['smile', 'eye', 'earth', 'basketball']);
  for (let i = 0; i < modes.length; i++) {
    assert.equal(sampleSphereWall(i * 30000 + 1000).mode, modes[i]);
    for (const time of [0, 6500, 119999, 86401234]) { const state = sampleSphereWall(time, { mode: modes[i] }); assert.equal(state.mode, modes[i]); assert.equal(state.nextMode, modes[i]); assert.equal(state.blend, 0); }
  }
  assert.equal(SPHERE_RENDER_BUDGET.modeMs, 30000); assert.equal(SPHERE_RENDER_BUDGET.cycleMs, 120000);
  assert.ok(SPHERE_RENDER_BUDGET.modeMs - SPHERE_RENDER_BUDGET.crossfadeMs >= SPHERE_BUBBLE_BUDGET.cycleMs);
  assert.equal(sampleSphereWall(28000).blend, 0, 'the complete bubble story precedes the fade');
  assert.equal(sampleSphereWall(28600).blend, 0);
  assert.ok(sampleSphereWall(29300).blend > .49 && sampleSphereWall(29300).blend < .51);
  assert.ok(sampleSphereWall(29999).blend > .9999); assert.equal(sampleSphereWall(30000).mode, 'eye');
  assert.equal(sampleSphereWall(120000).mode, 'smile'); assert.equal(sampleSphereWall(NaN).timeSeconds, 0);
  for (const time of [0, 15000, 29300, 30000, 59999, 90000, 119999]) {
    const first = sampleSphereWall(time), loop = sampleSphereWall(time + 120000);
    assert.equal(loop.mode, first.mode); assert.equal(loop.nextMode, first.nextMode); assert.equal(loop.blend, first.blend);
  }
  assert.equal(sampleSphereWall(100, { mode: 'unsupported' }).mode, 'smile');
  assert.equal(sampleSphereWall(100, { night: true }).night, 1); assert.equal(sampleSphereWall(100, { night: 7 }).night, 1);
  const model = createSphereLandmark(), wall = model.group.getObjectByName('sphere-led-wall');
  for (const time of [29500, 62000, 9000, 29500]) {
    const state = model.update(time, { mode: 'auto', night: .75 });
    assert.equal(wall.material.uniforms.uTime.value, state.timeSeconds); assert.equal(wall.material.uniforms.uMode.value, state.modeIndex);
    assert.equal(wall.material.uniforms.uBlend.value, state.blend); assert.equal(wall.material.uniforms.uNight.value, .75);
  }
  model.dispose();
});

test('reduced motion freezes an open-eyed finished expression or the chosen artwork without autoplay', () => {
  for (const mode of ['auto', 'smile', 'eye', 'earth', 'basketball']) {
    const baseline = sampleSphereWall(0, { mode, reducedMotion: true });
    assert.equal(baseline.blend, 0); assert.equal(baseline.reducedMotion, true);
    for (const time of [3, 30000, 120000, 1234567890]) assert.deepEqual(sampleSphereWall(time, { mode, reducedMotion: true }), baseline);
  }
  assert.equal(sampleSphereWall(90000, { reducedMotion: true }).mode, 'smile');
});

test('updates reuse all GPU resources and disposal releases each owned resource exactly once', () => {
  const model = createSphereLandmark(), meshes = model.group.children.slice(), geometries = new Set(), materials = new Set();
  let geometryDisposals = 0, materialDisposals = 0, instanceDisposals = 0;
  for (const mesh of meshes) {
    geometries.add(mesh.geometry); materials.add(mesh.material);
    if (mesh.isInstancedMesh) mesh.addEventListener('dispose', () => instanceDisposals++);
  }
  for (const geometry of geometries) geometry.addEventListener('dispose', () => geometryDisposals++);
  for (const material of materials) material.addEventListener('dispose', () => materialDisposals++);
  const uniforms = model.group.getObjectByName('sphere-led-wall').material.uniforms;
  for (let i = 0; i < 100; i++) model.update(i * 937, { mode: i % 2 ? 'earth' : 'auto', night: i / 100 });
  assert.deepEqual(model.group.children, meshes); assert.equal(model.group.getObjectByName('sphere-led-wall').material.uniforms, uniforms);
  model.dispose(); model.dispose();
  assert.equal(geometryDisposals, geometries.size); assert.equal(materialDisposals, materials.size);
  assert.equal(instanceDisposals, meshes.filter(mesh => mesh.isInstancedMesh).length);
  assert.equal(model.group.children.length, 0); assert.equal(model.update(123), null);
});

test('LED shader has explicit near-bead/far anti-aliasing, original procedural modes and no external pipeline', () => {
  assert.match(sphereWallVertexShader, /normalize\(position\)/);
  assert.match(sphereWallFragmentShader, /beadVisibility=1\.-smoothstep/); assert.match(sphereWallFragmentShader, /fwidth\(grid\.x\)/);
  assert.match(sphereWallFragmentShader, /faceArt/); assert.match(sphereWallFragmentShader, /eyeArt/); assert.match(sphereWallFragmentShader, /earthArt/); assert.match(sphereWallFragmentShader, /basketballArt/);
  assert.doesNotMatch(sphereWallFragmentShader, /sampler2D|samplerCube|texture2D/);
  const factory = fs.readFileSync(new URL('../src/components/sphere/createSphereLandmark.js', import.meta.url), 'utf8');
  const wrapper = fs.readFileSync(new URL('../src/components/town/SphereLandmark.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(factory + wrapper, /requestAnimationFrame|setInterval|new\s+THREE\.WebGLRenderer|TextureLoader|fetch\(/);
  assert.match(wrapper, /timeRef\?\.current/); assert.match(wrapper, /lightTimeRef\?\.current/); assert.match(wrapper, /sampleDayNight/); assert.match(wrapper, /instance\.dispose\(\)/);
});

test('artwork uses the Canvas monotonic clock across the 180-second daylight wrap', () => {
  const wrapper = fs.readFileSync(new URL('../src/components/town/SphereLandmark.jsx', import.meta.url), 'utf8');
  assert.match(wrapper, /const time = clock\.elapsedTime \* 1000;/);
  assert.match(wrapper, /const lightTime = lightTimeRef\?\.current \?\? timeRef\?\.current \?\? time;/);
  assert.match(wrapper, /const night = sampleDayNight\(lightTime\)\.nightOpacity/);
  assert.match(wrapper, /model\.current\?\.update\(wallTime, \{ mode, reducedMotion, night, bubbleExpression \}\)/);
  assert.doesNotMatch(wrapper, /const time = timeRef/);
  const model = createSphereLandmark(), uniforms = model.group.getObjectByName('sphere-led-wall').material.uniforms;
  const before = model.update(179999), after = model.update(180000);
  assert.equal(before.mode, 'eye'); assert.equal(before.nextMode, 'earth'); assert.ok(before.blend > .9999);
  assert.equal(after.mode, 'earth'); assert.equal(after.blend, 0);
  assert.equal(uniforms.uMode.value, 2); assert.equal(uniforms.uTime.value, 180);
  assert.ok(after.timeSeconds > before.timeSeconds);
  model.update(180001, { mode: 'basketball', night: 1 });
  assert.equal(uniforms.uMode.value, 3); assert.equal(uniforms.uNextMode.value, 3); assert.equal(uniforms.uBlend.value, 0); assert.equal(uniforms.uNight.value, 1);
  model.dispose();
});

const wrapperCode = (await transformWithEsbuild(
  fs.readFileSync(new URL('../src/components/town/SphereLandmark.jsx', import.meta.url), 'utf8'),
  'SphereLandmark.jsx', { loader: 'jsx', format: 'cjs', jsx: 'automatic' },
)).code;

function mountLandmark(initialProps) {
  let cursor = 0, mounted = false, frame;
  const refs = [], effects = [], calls = { wall: [], bubble: [] }, module = { exports: {} };
  const parent = { add() {}, remove() {} };
  vm.runInNewContext(wrapperCode, { module, exports: module.exports, document: { hidden: false }, require(id) {
    if (id === 'react') return {
      useRef(value) { const i = cursor++; return refs[i] ??= { current: value }; },
      useEffect(callback) { if (!mounted) effects.push(callback); },
    };
    if (id === 'react/jsx-runtime') return { jsx(type, props) { if (props.ref) props.ref.current = parent; return { type, props }; } };
    if (id === '@react-three/fiber') return { useFrame(callback) { frame = callback; } };
    if (id === '../../../shared/sphere-landmark.js') return { SPHERE_LANDMARK };
    if (id === '../../../shared/dayNight.js') return { sampleDayNight };
    if (id === '../sphere/createSphereLandmark.js') return { sampleSphereWall, createSphereLandmark: () => ({
      group: {}, dispose() {}, update(time, options) { const state = sampleSphereWall(time, options); calls.wall.push({ time, options, state }); return state; },
    }) };
    if (id === '../sphere/createSphereBubbles.js') return { createSphereBubbles: () => ({
      group: {}, dispose() {}, update(time, options) { const cue = sampleSphereBubbleCue(time, options); calls.bubble.push({ time, options, cue }); return cue; },
    }) };
    throw new Error(`Unexpected landmark dependency: ${id}`);
  } });
  function render(props) {
    cursor = 0; module.exports.default(props);
    if (!mounted) { effects.forEach(effect => effect()); mounted = true; }
  }
  render(initialProps);
  return { render, calls, step(time) { frame({ clock: { elapsedTime: time / 1000 } }); } };
}

test('entering auto at an arbitrary global time gives the whole bubble story before the first wall crossfade', () => {
  const lightTimeRef = { current: 179999 }, harness = mountLandmark({ mode: 'smile', lightTimeRef });
  harness.step(1230000);
  harness.render({ mode: 'auto', lightTimeRef });
  const start = 1239800;
  harness.step(start);
  assert.equal(harness.calls.wall.at(-1).time, 0); assert.equal(harness.calls.bubble.at(-1).time, 0);
  for (const elapsed of [2000, 9000, 17000, 26000, 27999, 28000]) {
    lightTimeRef.current = 0; harness.step(start + elapsed);
    const wall = harness.calls.wall.at(-1), bubble = harness.calls.bubble.at(-1);
    assert.equal(wall.state.mode, 'smile'); assert.equal(wall.state.blend, 0);
    assert.equal(bubble.time, elapsed); assert.equal(bubble.options.opacity, 1);
    assert.equal(wall.options.night, sampleDayNight(0).nightOpacity);
  }
  harness.step(start + 29300);
  assert.ok(Math.abs(harness.calls.wall.at(-1).state.blend - .5) < 1e-9);
  harness.step(start + 30000);
  assert.equal(harness.calls.wall.at(-1).state.mode, 'eye');
  assert.equal(harness.calls.bubble.at(-1).options.opacity, 0);
});

test('replaying the smile resets the face cue and bubbles together without resetting lighting or global artwork time', () => {
  const lightTimeRef = { current: 90000 }, harness = mountLandmark({ mode: 'smile', bubbleCue: 0, lightTimeRef });
  harness.step(800000); harness.step(820000);
  assert.equal(harness.calls.bubble.at(-1).cue.phase, 'drifting');
  harness.render({ mode: 'smile', bubbleCue: 1, lightTimeRef }); harness.step(820001);
  const wall = harness.calls.wall.at(-1), bubble = harness.calls.bubble.at(-1);
  assert.equal(bubble.time, 0); assert.equal(bubble.cue.phase, 'anticipation');
  assert.equal(wall.options.bubbleExpression, bubble.cue);
  assert.equal(wall.time, 820001); assert.equal(wall.options.night, sampleDayNight(90000).nightOpacity);
  harness.step(825001); assert.equal(harness.calls.bubble.at(-1).cue.phase, 'blowing');
});
