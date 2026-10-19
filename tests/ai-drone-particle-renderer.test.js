import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as React from 'react';
import * as THREE from 'three';
import { createAiDroneRuntime } from '../shared/aiDroneShow.js';
import { buildAiDroneV2Example } from '../server/aiDroneDirector.js';
import { DRONE_VERTEX_SHADER, DRONE_FRAGMENT_SHADER, AI_DRONE_VERTEX_SHADER, AI_DRONE_FRAGMENT_SHADER, AI_DRONE_LIGHT_PROFILE } from '../src/components/drone/droneShaders.js';

// Exercise the committed React effect, actual Three buffers/materials, update
// callbacks and disposal. GPU appearance remains a separate browser acceptance.
const sourceUrl = new URL('../src/components/drone/DroneShow.jsx', import.meta.url);
const source = fs.readFileSync(sourceUrl, 'utf8');
const { code } = await transformWithEsbuild(source, 'DroneShow.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
const localRequire = createRequire(sourceUrl);
const score = { version: 1, seed: 2457, title: '粒子星芒', synopsis: '分离的星点描绘轮廓。', scenes: ['star', 'heart', 'whale', 'flower'].map(shape => ({ name: shape, description: '清晰的独立灯点。', shape, color: '#FFD399', accent: '#8DDCFF', duration: 10, motion: 'still', transition: 'morph' })) };

function mount(program = 'ai', quality = 'high', selectedScore = score) {
  const effects = [], frames = [], cleanups = [];
  const gl = { getContext: () => ({ ALIASED_POINT_SIZE_RANGE: 1, getParameter: () => [1, 64] }), getPixelRatio: () => 1, domElement: { dataset: {} } };
  const state = { gl, size: { width: 1200, height: 720 } };
  const fakeReact = { ...React, useRef: value => ({ current: value }), useLayoutEffect: setup => effects.push(setup) };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, performance, require(id) {
    if (id === 'react') return fakeReact;
    if (id === '@react-three/fiber') return { useThree: select => select(state), useFrame: callback => frames.push(callback) };
    if (id === '../town/FirstPersonLook.jsx') return { __esModule: true, default: () => null };
    return localRequire(id);
  } });
  const parent = new THREE.Group(), fleetRef = { current: null }, timeRef = { current: 17000 };
  const element = module.exports.default({ program, quality, fleetRef, timeRef, aiRuntime: program === 'ai' ? createAiDroneRuntime(selectedScore) : undefined });
  element.props.ref.current = parent;
  for (const setup of effects) cleanups.push(setup());
  return { parent, fleetRef, timeRef, frame() { for (const callback of frames) callback(state); }, dispose() { for (const cleanup of cleanups) cleanup?.(); } };
}

test('AI owns compact normally blended sprites without changing permanent identity counts', () => {
  for (const [quality, count] of [['high', 4096], ['low', 2048]]) {
    const scene = mount('ai', quality);
    try {
      const lights = scene.parent.getObjectByName('4096IndependentLights');
      assert.equal(scene.fleetRef.current.count, count);
      assert.equal(lights.geometry.attributes.position.count, count);
      assert.equal(lights.material.vertexShader, AI_DRONE_VERTEX_SHADER);
      assert.equal(lights.material.fragmentShader, AI_DRONE_FRAGMENT_SHADER);
      assert.equal(lights.material.blending, THREE.NormalBlending);
      assert.equal(lights.material.uniforms.uMaxPointSize.value, AI_DRONE_LIGHT_PROFILE.maxPixels);
      assert.equal(lights.material.uniforms.uMinPointSize.value, AI_DRONE_LIGHT_PROFILE.minPixels);
      assert.equal(lights.material.depthWrite, false);
      assert.equal(lights.material.depthTest, true);
      assert.equal(scene.parent.getObjectByName('SubtleFlightTrails'), undefined);
      const positions = lights.geometry.attributes.position.array;
      for (const time of [17000, 17016, 17032, 27000]) { scene.timeRef.current = time; scene.frame(); }
      assert.equal(lights.geometry.attributes.position.array, positions);
      assert.equal(scene.parent.getObjectByName('SubtleFlightTrails'), undefined);
    } finally { scene.dispose(); }
    assert.equal(scene.parent.children.length, 0);
    assert.equal(scene.fleetRef.current, null);
  }
});

test('dense V2 sculptures keep smaller independent light cores without changing V1 or hand-authored samples', () => {
  const scene = mount('ai', 'high', buildAiDroneV2Example(73));
  try {
    const lights = scene.parent.getObjectByName('4096IndependentLights');
    assert.equal(lights.material.uniforms.uMinPointSize.value, 3.6);
    assert.equal(lights.material.blending, THREE.NormalBlending);
    assert.match(lights.material.vertexShader, /uniform float uMinPointSize/);
    assert.equal(scene.fleetRef.current.count, 4096);
  } finally { scene.dispose(); }
});

test('legacy avatar rendering retains its shaders, additive material and moving trails', () => {
  const scene = mount('avatar', 'low');
  try {
    const lights = scene.parent.getObjectByName('4096IndependentLights');
    const trails = scene.parent.getObjectByName('SubtleFlightTrails');
    assert.equal(lights.material.vertexShader, DRONE_VERTEX_SHADER);
    assert.equal(lights.material.fragmentShader, DRONE_FRAGMENT_SHADER);
    assert.equal(lights.material.blending, THREE.AdditiveBlending);
    assert.equal(lights.material.uniforms.uMaxPointSize.value, 64);
    assert.equal(trails.geometry.attributes.position.count, 512);
    scene.frame(); scene.timeRef.current += 16; scene.frame();
    assert.equal(trails.visible, true);
    scene.frame(); assert.equal(trails.visible, false, 'paused scenes hide motion trails');
  } finally { scene.dispose(); }
});

test('AI point resources are released exactly once without a second renderer or postprocessing pass', () => {
  const scene = mount();
  const lights = scene.parent.getObjectByName('4096IndependentLights');
  let geometryDisposed = 0, materialDisposed = 0;
  lights.geometry.addEventListener('dispose', () => geometryDisposed++);
  lights.material.addEventListener('dispose', () => materialDisposed++);
  scene.dispose();
  assert.equal(geometryDisposed, 1);
  assert.equal(materialDisposed, 1);
  assert.doesNotMatch(source, /new THREE\.WebGLRenderer|new UnrealBloomPass|new EffectComposer/);
  assert.doesNotMatch(source, /import[^\n]+shared\/aiDroneShow/);
});

test('AI shader bounds halo and HDR energy while legacy glow remains byte-for-byte separate', () => {
  assert.ok(AI_DRONE_LIGHT_PROFILE.spriteScale < 4.2);
  assert.ok(AI_DRONE_LIGHT_PROFILE.maxPixels <= 14);
  assert.ok(AI_DRONE_LIGHT_PROFILE.haloGain <= .10);
  assert.equal(AI_DRONE_LIGHT_PROFILE.minPixels, 5);
  assert.ok(AI_DRONE_LIGHT_PROFILE.coreInner * AI_DRONE_LIGHT_PROFILE.minPixels >= 1.25, 'a full-bright center survives subpixel placement');
  assert.ok(AI_DRONE_LIGHT_PROFILE.coreOuter * AI_DRONE_LIGHT_PROFILE.minPixels <= 2.5, 'the main luminous disk stays narrower than the visible gaps');
  assert.ok(AI_DRONE_LIGHT_PROFILE.peak <= 1.60);
  assert.match(AI_DRONE_FRAGMENT_SHADER, /if \(alpha < 0\.008\) discard/);
  assert.match(AI_DRONE_FRAGMENT_SHADER, /min\(vColor, vec3\(1\.60\)\)/);
  assert.match(AI_DRONE_FRAGMENT_SHADER, /min\(1\.0, brightness\)/, 'white core fades with the original light energy');
  assert.match(DRONE_VERTEX_SHADER, /pixels \* 4\.2/);
  assert.match(DRONE_FRAGMENT_SHADER, /corona \* 0\.62 \+ aureole \* 0\.24/);
});
