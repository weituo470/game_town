import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as React from 'react';
import * as THREE from 'three';
import * as performancePolicy from '../src/components/drone/dronePerformance.js';

// Execute the real committed component with instrumented effects. This proves
// resource ownership and renderer policy, not real WebGL speed or image quality.
const file = new URL('../src/components/town/SceneEffects.jsx', import.meta.url);
const compiled = await transformWithEsbuild(fs.readFileSync(file, 'utf8'), 'SceneEffects.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
const nativeRequire = createRequire(file);

function harness({ hdr = true } = {}) {
  const slots = [], pending = [], frames = [], allocated = [], listeners = new Map();
  let cursor = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const hooks = { ...React,
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useEffect(setup, deps) {
      const index = cursor++, previous = slots[index];
      if (previous && same(previous.deps, deps)) return;
      pending.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; });
    },
  };
  const gl = {
    toneMapping: THREE.NoToneMapping, toneMappingExposure: .7,
    shadowMap: { autoUpdate: true, needsUpdate: false },
    info: { autoReset: true, render: { calls: 0, triangles: 0 }, reset() { this.render.calls = 0; this.render.triangles = 0; } },
    extensions: { has: () => hdr }, capabilities: { maxSamples: 4 },
    getPixelRatio: () => 1.5,
    render() { this.info.render.calls++; this.info.render.triangles += 100; },
    domElement: { dataset: {}, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: type => listeners.delete(type) },
  };
  class Pass {
    constructor(kind) { this.kind = kind; this.params = {}; this.enabled = true; this.disposed = 0; allocated.push(this); }
    dispose() { this.disposed++; }
  }
  class Composer extends Pass {
    constructor(renderer, target) { super('composer'); this.renderer = renderer; this.target = target; this.passes = []; }
    addPass(pass) { this.passes.push(pass); }
    setPixelRatio(ratio) { this.ratio = ratio; }
    setSize(width, height) { this.width = width; this.height = height; }
    render() { this.passes.filter(pass => pass.enabled).forEach(() => this.renderer.render()); }
    dispose() { super.dispose(); this.target.dispose(); }
  }
  const state = { gl, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), size: { width: 1280, height: 720 }, invalidate() {} };
  const overrides = {
    react: hooks, three: THREE,
    '@react-three/fiber': { useThree: () => state, useFrame: callback => frames.push(callback) },
    'three/addons/postprocessing/EffectComposer.js': { EffectComposer: Composer },
    'three/addons/postprocessing/RenderPass.js': { RenderPass: class extends Pass { constructor() { super('render'); } } },
    'three/addons/postprocessing/SAOPass.js': { SAOPass: class extends Pass { constructor() { super('ao'); } } },
    'three/addons/postprocessing/UnrealBloomPass.js': { UnrealBloomPass: class extends Pass { constructor() { super('bloom'); } } },
    'three/addons/postprocessing/OutputPass.js': { OutputPass: class extends Pass { constructor() { super('output'); } } },
    '../drone/dronePerformance.js': performancePolicy,
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled.code, { module, exports: module.exports, document: { hidden: false }, require: id => Object.hasOwn(overrides, id) ? overrides[id] : nativeRequire(id) });
  const Component = module.exports.default;
  return { gl, state, allocated, listeners,
    render(mode, faithfulBlackHole = false) { cursor = 0; frames.length = 0; Component({ performanceMode: mode, faithfulBlackHole }); while (pending.length) pending.shift()(); },
    frame(delta = 1 / 60) { frames.forEach(callback => callback(state, delta)); },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('committed drone effects skip AO allocation and restore original town quality when leaving', () => {
  const h = harness();
  h.render('town');
  assert.equal(h.allocated.filter(item => item.kind === 'ao').length, 1);
  assert.equal(h.gl.domElement.dataset.visualQuality, 'high');
  const originalComposer = h.allocated.find(item => item.kind === 'composer');
  assert.equal(originalComposer.target.samples, 4);
  h.render('drone');
  assert.equal(originalComposer.disposed, 1);
  assert.equal(h.allocated.filter(item => item.kind === 'ao').length, 1, 'not one additional AO is created for the drone view');
  const composer = h.allocated.filter(item => item.kind === 'composer').at(-1);
  assert.equal(composer.target.samples, 2);
  assert.equal(composer.ratio, 1.25);
  assert.deepEqual(composer.passes.map(pass => pass.kind), ['render', 'bloom', 'output']);
  assert.equal(h.gl.shadowMap.autoUpdate, false);
  assert.equal(performancePolicy.getSceneRenderRatio(h.gl), 1.25);
  for (let frame = 0; frame < 420; frame++) h.frame();
  assert.equal(h.gl.domElement.dataset.renderFps, '60');
  assert.equal(h.gl.domElement.dataset.renderCalls, '3', 'all instrumented postprocessing passes are counted');
  assert.equal(h.gl.domElement.dataset.renderTriangles, '300');
  h.render('town');
  assert.equal(composer.disposed, 1);
  assert.equal(h.gl.shadowMap.autoUpdate, true);
  assert.equal(h.gl.domElement.dataset.ambientOcclusion, 'on');
  assert.equal(h.gl.domElement.dataset.visualQuality, 'high');
  assert.equal(performancePolicy.getSceneRenderRatio(h.gl), 1.5);
  h.dispose();
  assert.equal(h.gl.info.autoReset, true);
  assert.equal(h.gl.toneMapping, THREE.NoToneMapping);
  assert.equal(h.gl.toneMappingExposure, .7);
  assert.equal(h.listeners.size, 0);
});

test('each committed drone setup disposes its own resources and restores shadow state even without HDR', () => {
  for (const hdr of [true, false]) for (let strictSetup = 0; strictSetup < 2; strictSetup++) {
    const h = harness({ hdr });
    h.render('drone');
    h.gl.shadowMap.needsUpdate = false;
    for (let frame = 0; frame < 30; frame++) h.frame();
    assert.equal(h.gl.shadowMap.needsUpdate, false);
    for (let frame = 0; frame < 31; frame++) h.frame();
    assert.equal(h.gl.shadowMap.needsUpdate, true);
    assert.equal(h.allocated.some(item => item.kind === 'ao'), false);
    h.dispose();
    assert.equal(h.gl.shadowMap.autoUpdate, true);
    assert.equal(h.gl.info.autoReset, true);
    assert.equal(h.gl.toneMappingExposure, .7);
    assert.equal(performancePolicy.getSceneRenderRatio(h.gl), 1.5);
    assert.equal(h.listeners.size, 0);
    for (const resource of h.allocated.filter(item => item.kind !== 'render')) assert.equal(resource.disposed, 1);
  }
});

test('source-faithful black hole bypasses extra ACES and bloom and restores the ordinary show afterwards', () => {
  const h = harness();
  try {
    h.render('drone');
    assert.equal(h.gl.toneMapping, THREE.ACESFilmicToneMapping);
    const before = h.allocated.find(item => item.kind === 'composer');
    h.render('drone', true);
    assert.equal(before.disposed, 1);
    assert.equal(h.gl.toneMapping, THREE.NoToneMapping);
    const blackhole = h.allocated.filter(item => item.kind === 'composer').at(-1);
    assert.deepEqual(blackhole.passes.map(pass => pass.kind), ['render', 'output']);
    assert.equal(h.allocated.filter(item => item.kind === 'ao').length, 0);
    h.frame();
    assert.equal(h.gl.info.render.calls, 2);
    h.render('drone');
    assert.equal(blackhole.disposed, 1);
    assert.equal(h.gl.toneMapping, THREE.ACESFilmicToneMapping);
    assert.deepEqual(h.allocated.filter(item => item.kind === 'composer').at(-1).passes.map(pass => pass.kind), ['render', 'bloom', 'output']);
  } finally { h.dispose(); }
  assert.equal(h.gl.toneMapping, THREE.NoToneMapping);
  assert.equal(h.gl.toneMappingExposure, .7);
  assert.equal(h.listeners.size, 0);
});

test('source-faithful black hole keeps neutral renderer fallback without HDR and does not leak into the town', () => {
  const h = harness({ hdr: false });
  try {
    h.render('drone', true);
    assert.equal(h.gl.toneMapping, THREE.NoToneMapping);
    assert.equal(h.allocated.length, 0);
    h.frame();
    assert.equal(h.gl.info.render.calls, 1);
    h.render('town');
    assert.equal(h.gl.toneMapping, THREE.ACESFilmicToneMapping);
    assert.equal(h.gl.shadowMap.autoUpdate, true);
  } finally { h.dispose(); }
  assert.equal(h.gl.toneMapping, THREE.NoToneMapping);
});
