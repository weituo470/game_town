import { MIDNIGHT_MS } from '../shared/dayNight.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React, { act } from 'react';
import * as Fiber from '@react-three/fiber';
import * as THREE from 'three';
import { transformWithEsbuild } from 'vite';
import { createAmbientBlackHoleClock } from '../shared/ambientBlackHole.js';
import { createAmbientBlackHoleRuntime } from '../src/components/town/ambientBlackHoleRuntime.js';

// Run the actual component under React + R3F, including their real hooks and
// StrictMode effect replay. Only the browser document and GPU visual are fake.
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(() => {
  if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});
const file = new URL('../src/components/town/AmbientBlackHole.jsx', import.meta.url);
const { code } = await transformWithEsbuild(fs.readFileSync(file, 'utf8'), 'AmbientBlackHole.jsx', { loader: 'jsx', format: 'cjs' });

async function harness({ strict = false, props = {} } = {}) {
  const listeners = new Set(), instances = [], visuals = [], appearances = [];
  const document = {
    hidden: false,
    addEventListener(type, listener) { assert.equal(type, 'visibilitychange'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'visibilitychange'); listeners.delete(listener); },
  };
  const canvas = { width: 1280, height: 720, style: {}, dataset: {} };
  const gl = { domElement: canvas, render() {}, setPixelRatio() {}, setSize() {},
    xr: { enabled: false, isPresenting: false, addEventListener() {}, removeEventListener() {}, setAnimationLoop() {} },
    shadowMap: { enabled: false },
  };
  const createVisual = () => {
    const visual = { group: new THREE.Group(), disposals: 0,
      setAmbientVisibility(state) { this.group.visible = state.visible; }, update() {}, render() {},
      dispose() { this.disposals += 1; },
    };
    visuals.push(visual); return visual;
  };
  const createRuntime = options => {
    const clock = createAmbientBlackHoleClock({ random: () => 0 });
    const actual = createAmbientBlackHoleRuntime({ ...options, clock, createVisual });
    const instance = { actual, clock, frames: [], disposals: 0,
      frame(args) { const state = actual.frame(args); this.frames.push({ ...args, state }); return state; },
      dispose() { this.disposals += 1; actual.dispose(); },
    };
    instances.push(instance); return instance;
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, document,
    require(name) {
      if (name === 'react') return React;
      if (name === '@react-three/fiber') return Fiber;
      if (name === './ambientBlackHoleRuntime.js') return { createAmbientBlackHoleRuntime: createRuntime };
      throw new Error(`Unexpected component dependency: ${name}`);
    },
  }, { filename: 'AmbientBlackHole.real-hooks.cjs' });
  const Component = module.exports.default;
  // R3F's public factory hardcodes isStrictMode=false on its reconciler root.
  // React 19 does not replay passive mount effects for only a nested StrictMode
  // boundary. Enable the actual root flag for this one construction; all hooks
  // and effect replay still run in React's real reconciler, not a hook mock.
  const createContainer = Fiber.reconciler.createContainer;
  let root;
  try {
    if (strict) Fiber.reconciler.createContainer = (...args) => { args[3] = true; return createContainer(...args); };
    root = Fiber.createRoot(canvas);
  } finally { Fiber.reconciler.createContainer = createContainer; }
  await root.configure({ gl, frameloop: 'never', dpr: 1, size: { width: 1280, height: 720, top: 0, left: 0 } });
  let currentProps = { timeRef: { current: MIDNIGHT_MS }, enabled: true, reducedMotion: false, onAppearance: id => appearances.push(id), ...props };
  let timestamp = 0;
  const render = async next => {
    currentProps = { ...currentProps, ...next };
    const element = React.createElement(Component, currentProps);
    await act(async () => { root.render(strict ? React.createElement(React.StrictMode, null, element) : element); });
  };
  await render();
  const frame = delta => {
    timestamp += delta;
    Fiber.advance(timestamp, false, Fiber._roots.get(canvas).store.getState());
    return instances.at(-1).frames.at(-1);
  };
  return {
    root, canvas, document, instances, visuals, appearances, listeners, render, frame,
    visibility(hidden) { document.hidden = hidden; for (const listener of [...listeners]) listener(); },
    async unmount() { await act(async () => { root.unmount(); }); },
  };
}

test('real React StrictMode replays the effect with one cleanup per runtime and one live visibility listener', async () => {
  const h = await harness({ strict: true });
  try {
    assert.equal(h.instances.length, 2, 'React StrictMode must actually replay setup/cleanup, not a simulated hook');
    assert.equal(h.instances[0].disposals, 1); assert.equal(h.instances[1].disposals, 0);
    assert.equal(h.listeners.size, 1);
    h.frame(0); h.frame(1);
    assert.equal(h.instances[0].frames.length, 0);
    assert.equal(h.instances[1].frames.length, 2);
    assert.equal(h.instances[1].frames.at(-1).state.nextInMs, 34000);
  } finally { await h.unmount(); }
  assert.deepEqual(h.instances.map(instance => instance.disposals), [1, 1]);
  assert.equal(h.listeners.size, 0); assert.equal(Fiber._roots.has(h.canvas), false);
});

test('real visibility events suppress hidden progress and discard the first recovered frame delta', async () => {
  const h = await harness();
  try {
    h.frame(0); h.frame(1);
    const before = h.instances[0].clock.advance().nextInMs;
    h.visibility(true);
    const firstHidden = h.frame(500);
    assert.equal(firstHidden.enabled, false); assert.equal(firstHidden.delta, 0);
    assert.equal(h.frame(500).state.nextInMs, before);
    h.visibility(false);
    const recovered = h.frame(500);
    assert.equal(recovered.enabled, true); assert.equal(recovered.delta, 0);
    assert.equal(recovered.state.nextInMs, before);
    assert.equal(h.frame(1).state.nextInMs, before - 1000);
  } finally { await h.unmount(); }
  assert.equal(h.listeners.size, 0);
});

test('visibility hidden-and-visible without an intervening RAF still discards the background gap', async () => {
  const h = await harness();
  try {
    h.frame(0); h.frame(1);
    const before = h.instances[0].clock.advance().nextInMs;
    h.visibility(true); h.visibility(false);
    const recovered = h.frame(7200);
    assert.equal(recovered.delta, 0); assert.equal(recovered.state.nextInMs, before);
    assert.equal(h.frame(1).state.nextInMs, before - 1000);
  } finally { await h.unmount(); }
});

test('prop disabling and document.hidden both freeze the actual clock across real React rerenders', async () => {
  const h = await harness();
  try {
    h.frame(0); h.frame(1);
    const before = h.instances[0].clock.advance().nextInMs;
    await h.render({ enabled: false });
    assert.equal(h.frame(600).enabled, false);
    assert.equal(h.instances[0].clock.advance().nextInMs, before);
    h.document.hidden = true;
    await h.render({ enabled: true, reducedMotion: true });
    const hidden = h.frame(600);
    assert.equal(hidden.enabled, false); assert.equal(hidden.reducedMotion, true);
    assert.equal(hidden.state.nextInMs, before);
    assert.equal(h.instances.length, 1, 'prop updates must not replace or reset the random clock');
    h.visibility(false);
    assert.equal(h.frame(600).state.nextInMs, before);
    assert.equal(h.frame(1).state.nextInMs, before - 1000);
  } finally { await h.unmount(); }
});

test('real callback refs use the latest prop and unmount frees the active visual exactly once', async () => {
  const h = await harness(); const fresh = [];
  try {
    h.frame(0);
    for (let i = 0; i < 34; i += 1) h.frame(1);
    await h.render({ onAppearance: id => fresh.push(id) });
    assert.equal(h.instances.length, 1);
    const state = h.frame(1).state;
    assert.equal(state.active, true); assert.deepEqual(fresh, [1]); assert.deepEqual(h.appearances, []);
    assert.equal(h.visuals.length, 1); assert.equal(h.visuals[0].disposals, 0);
  } finally { await h.unmount(); }
  assert.equal(h.instances[0].disposals, 1); assert.equal(h.visuals[0].disposals, 1);
  assert.equal(h.listeners.size, 0);
  assert.deepEqual(h.canvas.dataset, {});
});


test('actual sky timeRef controls night eligibility across frames without remounting the runtime', async () => {
  const timeRef = { current: MIDNIGHT_MS };
  const h = await harness({ props: { timeRef } });
  try {
    h.frame(0);
    for (let i = 0; i < 36; i += 1) h.frame(1);
    assert.equal(h.visuals.length, 1);
    assert.equal(h.canvas.dataset.skyBlackhole, 'appearing');
    timeRef.current = 0;
    const day = h.frame(.016);
    assert.equal(day.worldTimeMs, 0);
    assert.equal(day.state.active, false);
    assert.equal(h.canvas.dataset.skyBlackhole, 'daylight');
    assert.equal(h.visuals[0].disposals, 1);
    timeRef.current = MIDNIGHT_MS;
    assert.equal(h.frame(.016).state.phase, 'waiting');
    assert.equal(h.instances.length, 1);
  } finally { await h.unmount(); }
});
