import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as React from 'react';
import * as THREE from 'three';
import * as choreography from '../shared/droneShow.js';
import * as programs from '../shared/dronePrograms.js';
import * as fpvMath from '../src/components/drone/droneFirstPerson.js';
import * as directorMath from '../src/components/drone/droneCamera.js';
import * as shaders from '../src/components/drone/droneShaders.js';
import * as lookMath from '../src/components/town/firstPerson.js';
import * as clockModule from '../src/lib/droneShowClock.js';
import * as audioModule from '../src/lib/droneShowAudio.js';
import * as world from '../shared/world.js';
import * as catalog from '../src/lib/catalog.js';

// Run the real compiled React components and committed effects, actual Three
// geometry buffers, and scheduled frame callbacks. This does not pretend to be
// a browser, shader-rendering, or visual-quality test.
const paths = ['src/App.jsx', 'src/components/Town.jsx', 'src/components/WonderSchedule.jsx', 'src/components/drone/DroneInvitation.jsx', 'src/components/drone/DroneShow.jsx', 'src/components/drone/DroneShowControls.jsx', 'src/components/town/FirstPersonLook.jsx', 'src/components/town/PlayerController.jsx'];
const compiled = new Map(await Promise.all(paths.map(async path => {
  const file = new URL(`../${path}`, import.meta.url);
  const result = await transformWithEsbuild(fs.readFileSync(file, 'utf8'), path, { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
  return [path, { code: result.code, require: createRequire(file) }];
})));

function evaluate(path, overrides, globals = {}) {
  const item = compiled.get(path), module = { exports: {} };
  vm.runInNewContext(item.code, { module, exports: module.exports, ...globals, require(id) {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id.endsWith('.css')) return {};
    return item.require(id);
  } });
  return module.exports;
}

function elements(node, found = []) {
  if (Array.isArray(node)) node.forEach(child => elements(child, found));
  else if (React.isValidElement(node)) { found.push(node); elements(node.props.children, found); }
  return found;
}

const elementText = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(elementText).join('') : React.isValidElement(node) ? elementText(node.props.children) : '';

function hookRuntime() {
  const slots = [], pending = [], frames = [];
  let cursor = 0;
  const equalDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  function effect(setup, deps) {
    const index = cursor++, old = slots[index];
    if (old && equalDeps(old.deps, deps)) return;
    pending.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; });
  }
  function memo(factory, deps) {
    const index = cursor++;
    if (!slots[index] || !equalDeps(slots[index].deps, deps)) slots[index] = { deps, value: factory() };
    return slots[index].value;
  }
  return {
    frames,
    begin() { cursor = 0; frames.length = 0; },
    commit() { while (pending.length) pending.shift()(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
    react: { ...React,
      useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
      useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof value === 'function' ? value() : value }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
      useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps), useEffect: effect, useLayoutEffect: effect,
    },
  };
}

class Surface {
  listeners = new Map();
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, values = {}) {
    const event = { type, target: this, isTrusted: true, preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
    return event;
  }
  count(type) { return type ? this.listeners.get(type)?.size || 0 : [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}

function surfaces() {
  const win = new Surface(), doc = new Surface(), canvas = new Surface();
  const captures = new Set();
  let requests = 0, releases = 0;
  Object.assign(doc, { hidden: false, pointerLockElement: null, defaultView: win,
    exitPointerLock() { releases++; this.pointerLockElement = null; this.emit('pointerlockchange'); },
  });
  Object.assign(canvas, { ownerDocument: doc, style: { touchAction: 'pan-y' },
    setPointerCapture(id) { captures.add(id); }, hasPointerCapture: id => captures.has(id),
    releasePointerCapture(id) { captures.delete(id); canvas.emit('lostpointercapture', { pointerId: id }); },
    requestPointerLock() { requests++; doc.pointerLockElement = canvas; doc.emit('pointerlockchange'); },
  });
  return { win, doc, canvas, captures, get requests() { return requests; }, get releases() { return releases; } };
}

function clockFixture() {
  let now = 1000;
  const clock = clockModule.createDroneShowClock({ now: () => now });
  return { clock, advance(milliseconds) { now += milliseconds; } };
}

function sceneHarness({ view = 'fpv', quality = 'high', reducedMotion = false } = {}) {
  const dom = surfaces(), showHooks = hookRuntime(), cameraHooks = hookRuntime();
  const context = { ALIASED_POINT_SIZE_RANGE: 0, getParameter: () => [1, 64], getExtension: () => ({}) };
  const renderCalls = [];
  let target = null, activeFace = 0, activeMipmap = 0, scissorTest = false, clearAlpha = 1;
  const viewport = new THREE.Vector4(0, 0, 1440, 900), scissor = viewport.clone(), clearColor = new THREE.Color('#06101c');
  const gl = {
    domElement: dom.canvas, getContext: () => context, getPixelRatio: () => 1,
    xr: { enabled: false }, shadowMap: { autoUpdate: true },
    autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
    toneMapping: THREE.NoToneMapping, toneMappingExposure: 1, outputColorSpace: THREE.SRGBColorSpace,
    getSize: out => out.set(state.size.width, state.size.height),
    getRenderTarget: () => target, getActiveCubeFace: () => activeFace, getActiveMipmapLevel: () => activeMipmap,
    setRenderTarget(next, face = 0, level = 0) { target = next; activeFace = face; activeMipmap = level; },
    getViewport: out => out.copy(viewport), getScissor: out => out.copy(scissor), getScissorTest: () => scissorTest,
    setViewport(...value) { value[0]?.isVector4 ? viewport.copy(value[0]) : viewport.set(...value); },
    setScissor(...value) { value[0]?.isVector4 ? scissor.copy(value[0]) : scissor.set(...value); },
    setScissorTest(value) { scissorTest = value; }, getClearColor: out => out.copy(clearColor), getClearAlpha: () => clearAlpha,
    setClearColor(value, alpha = 1) { clearColor.set(value); clearAlpha = alpha; },
    render(scene, camera) { renderCalls.push({ target: target?.texture?.name, scene, camera }); },
  };
  const state = { camera: new THREE.PerspectiveCamera(58, 1440 / 900, .08, 420), size: { width: 1440, height: 900 }, gl, invalidate() {} };
  let creations = 0, updates = 0, seats, child;
  const tracedChoreography = { ...choreography,
    createDroneFleet(...args) { creations++; return choreography.createDroneFleet(...args); },
  };
  const tracedPrograms = { ...programs,
    updateDroneProgram(...args) { updates++; return programs.updateDroneProgram(...args); },
  };
  function moduleFor(hooks) {
    return evaluate('src/components/drone/DroneShow.jsx', {
      react: hooks.react,
      '@react-three/fiber': { useThree: selector => selector ? selector(state) : state, useFrame: (callback, priority = 0) => hooks.frames.push({ callback, priority }) },
      '../../../shared/droneShow.js': tracedChoreography, './droneShaders.js': shaders,
      '../../../shared/dronePrograms.js': tracedPrograms,
      './droneFirstPerson.js': fpvMath, './droneCamera.js': directorMath,
      '../town/firstPerson.js': lookMath, '../town/FirstPersonLook.jsx': { __esModule: true, default: 'FirstPersonLook' },
    }, { window: dom.win, document: dom.doc });
  }
  const Show = moduleFor(showHooks).default, Camera = moduleFor(cameraHooks).DroneCamera;
  const { clock, advance } = clockFixture();
  clock.start({ elapsedMs: 82000, view });
  const fleetRef = { current: null }, lookInputRef = { current: {} }, recenterRef = { current: 0 }, telemetryRef = { current: {} };
  const onSeatsReady = value => { seats = value; };
  let current = { view, reducedMotion, quality, seatId: '' };
  const parent = new THREE.Group();
  function render(patch = {}) {
    current = { ...current, ...patch };
    showHooks.begin();
    const show = Show({ ...current, timeRef: clock.timeRef, fleetRef, onSeatsReady, firstPersonSeatId: current.view === 'fpv' && !current.reducedMotion ? current.seatId : null });
    show.props.ref.current = parent;
    showHooks.commit();
    cameraHooks.begin();
    child = Camera({ ...current, timeRef: clock.timeRef, fleetRef, lookInputRef, recenterRef, telemetryRef });
    cameraHooks.commit();
  }
  function frame(delta = .016) {
    for (const frame of [...showHooks.frames, ...cameraHooks.frames].sort((a, b) => a.priority - b.priority)) frame.callback(state, delta);
  }
  render();
  return { dom, state, parent, clock, advance, fleetRef, lookInputRef, recenterRef, telemetryRef, showHooks, cameraHooks, render, frame, renderCalls,
    get seats() { return seats; }, get child() { return child; }, get creations() { return creations; }, get updates() { return updates; },
    dispose() { cameraHooks.dispose(); showHooks.dispose(); },
  };
}

function assertMounted(h, seat = h.seats[0]) {
  const fleet = h.fleetRef.current, offset = seat.index * 3;
  assert.deepEqual(h.state.camera.position.toArray(), [fleet.positions[offset], fleet.positions[offset + 1] + .12, fleet.positions[offset + 2]]);
  assert.equal(h.telemetryRef.current.identity, seat.identity);
  assert.equal(h.telemetryRef.current.altitude, fleet.positions[offset + 1]);
}

test('switching programmes replaces and disposes one fleet without keeping two visual simulations alive', () => {
  const h = sceneHarness({ view: 'cinematic' });
  try {
    h.clock.togglePause();
    h.frame();
    const original = h.fleetRef.current;
    const oldPoints = h.parent.getObjectByName('4096IndependentLights');
    let disposed = false;
    oldPoints.geometry.addEventListener('dispose', () => { disposed = true; });
    h.render({ program: 'droplet', view: 'cinematic' });
    h.frame();
    assert.equal(disposed, true);
    assert.equal(h.parent.children.length, 1);
    assert.notEqual(h.fleetRef.current, original);
    assert.equal(h.fleetRef.current.state.program, 'droplet');
    assert.equal(h.fleetRef.current.state.elapsed, 82000);
    const sampled = h.updates;
    h.frame();
    assert.equal(h.updates, sampled, 'paused droplet buffers are cached');
    h.render({ program: 'avatar', view: 'cinematic' });
    h.frame();
    assert.equal(h.parent.children.length, 1);
    assert.equal(h.fleetRef.current.state.phase, 'avatar');
    assert.equal(h.creations, 3);
  } finally { h.dispose(); }
});

test('original placeholder black hole mounts in the same scene with hidden aircraft and complete switch disposal', () => {
  const h = sceneHarness({ view: 'cinematic' });
  try {
    h.clock.start({ program: 'blackhole', elapsedMs: 50000 }); h.clock.togglePause();
    h.render({ program: 'blackhole', view: 'fpv' }); h.frame();
    assert.equal(h.parent.children.length, 1);
    assert.equal(h.child, null, 'entity mode never mounts first-person aircraft input');
    assert.equal(h.parent.getObjectByName('4096IndependentLights').visible, false);
    assert.equal(h.parent.getObjectByName('SubtleFlightTrails').visible, false);
    const apparition = h.parent.getObjectByName('game-town-black-hole');
    assert.ok(apparition?.visible);
    assert.ok(h.parent.getObjectByName('game-town-black-hole-ring'));
    assert.equal(h.parent.getObjectByName('MirrorDropletAndHumanFleet'), undefined);
    assert.equal(h.fleetRef.current.state.program, 'blackhole');
    assert.equal(h.renderCalls.length, 0, 'the placeholder is drawn by the town scene, without extra offscreen passes');
    const passes = h.renderCalls.length, sampled = h.updates;
    h.frame(); assert.equal(h.updates, sampled);
    assert.equal(h.renderCalls.length, passes, 'paused placeholder never starts a second rendering pipeline');
    assert.equal(h.state.gl.getRenderTarget(), null, 'offscreen passes restore the town render target');
    const mesh = h.parent.getObjectByName('game-town-black-hole-ring');
    let disposed = false; mesh.geometry.addEventListener('dispose', () => { disposed = true; });
    h.render({ program: 'blackhole', reducedMotion: true }); h.frame();
    const reducedPasses = h.renderCalls.length;
    h.frame(); assert.equal(h.renderCalls.length, reducedPasses, 'reduced motion uses the same scene without extra passes');
    h.clock.seek(90000); h.frame(); assert.equal(apparition.visible, false);
    h.clock.seek(35000); h.frame(); assert.equal(apparition.visible, true);
    h.render({ program: 'avatar', view: 'cinematic', reducedMotion: false }); h.frame();
    assert.equal(disposed, true); assert.equal(h.parent.children.length, 1);
    assert.equal(h.parent.getObjectByName('game-town-black-hole'), undefined);
    assert.equal(h.parent.getObjectByName('4096IndependentLights').visible, true);
  } finally { h.dispose(); }
});

test('FPV clock selection preserves elapsed time, pause, speed, and activity without restarting', () => {
  for (const paused of [false, true]) {
    const { clock, advance } = clockFixture();
    clock.start({ elapsedMs: 32000, speed: 2 }); advance(157);
    if (paused) clock.togglePause();
    const before = clock.snapshot();
    assert.deepEqual(clock.setView('fpv'), { ...before, view: 'fpv' });
    for (const value of ['fly', 'anything', '', null, undefined, 1]) assert.deepEqual(clock.setView(value), { ...before, view: 'fpv' });
    advance(400);
    assert.equal(clock.timeRef.current, before.elapsedMs + (paused ? 0 : 800));
    const snapshot = clock.snapshot();
    assert.deepEqual(clock.setView('cinematic'), { ...snapshot, view: 'cinematic' });
  }
  const { clock } = clockFixture();
  assert.equal(clock.start({ view: 'fpv' }).view, 'fpv');
  clock.close();
  assert.equal(clock.setView('fpv').active, false, 'view selection cannot activate a closed show');
});

test('the real show commits exactly one fleet whose actual geometry updates before the attached FPV camera', () => {
  for (const quality of ['high', 'low']) {
    const h = sceneHarness({ quality });
    try {
      assert.equal(h.creations, 1);
      const points = h.parent.getObjectByName('4096IndependentLights');
      assert.equal(points.geometry.attributes.position.array, h.fleetRef.current.positions);
      assert.equal(h.fleetRef.current.count, quality === 'low' ? 2048 : 4096);
      assert.equal(h.showHooks.frames[0].priority, -.2);
      assert.equal(h.cameraHooks.frames[0].priority, -.1);
      h.frame(); assertMounted(h);
      for (const seat of h.seats) {
        h.render({ seatId: seat.id }); h.advance(16); h.frame(); assertMounted(h, seat);
      }
      assert.equal(h.creations, 1, 'seat switches cannot create a divergent flight simulation');
      assert.equal(h.updates, 2 + h.seats.length, 'one initial sample and one sample per render frame including every available seat');
    } finally { h.dispose(); }
    assert.equal(h.fleetRef.current, null);
    assert.equal(h.parent.children.length, 0);
  }
});

test('pause, seek and view switching keep FPV attached to the visible renderer sample, not a second time read', () => {
  const h = sceneHarness();
  try {
    h.frame();
    const fleet = h.fleetRef.current, identity = fleet.positions;
    h.clock.togglePause(); const paused = h.clock.snapshot();
    h.advance(5000); h.frame(); assertMounted(h); assert.equal(h.clock.timeRef.current, paused.elapsedMs);
    const frozen = h.state.camera.position.toArray();
    h.frame(); assert.deepEqual(h.state.camera.position.toArray(), frozen);
    for (const time of [0, 12000, 48000, 85000, 130000, 148000, 150000]) {
      h.clock.seek(time); h.frame(); assertMounted(h);
      assert.equal(fleet.positions, identity);
      assert.equal(h.clock.snapshot().paused, true);
    }
    // An independent choreography sample would erase these distinctive values.
    const seat = h.seats[0], offset = seat.index * 3;
    fleet.positions.set([12.5, 65.25, -9.75], offset);
    const beforeUpdates = h.updates;
    h.cameraHooks.frames[0].callback(h.state, .016);
    assert.deepEqual(h.state.camera.position.toArray(), [12.5, 65.37, -9.75]);
    assert.equal(h.updates, beforeUpdates, 'camera must read, never resimulate, the live fleet');
    h.render({ view: 'cinematic' }); h.frame();
    assert.deepEqual(h.state.camera.position.toArray(), directorMath.sampleDroneCamera(h.clock.timeRef.current, 1.6).position);
    h.render({ view: 'fpv' }); h.frame(); assertMounted(h);
    assert.equal(h.creations, 1);
  } finally { h.dispose(); }
});

test('own emitter and sampled trail disappear only for the selected FPV seat and restore in panorama', () => {
  for (const quality of ['high', 'low']) {
    const h = sceneHarness({ quality });
    try {
      const seat = h.seats.find(item => item.id === 'left-outline');
      assert.equal(seat.identity, 592, 'both tiers hide the exact same permanent aircraft');
      assert.equal(seat.index % 8, 0, 'this regression exercises a seat with a rendered trail');
      h.render({ seatId: seat.id }); h.frame(); h.advance(16); h.frame();
      const fleet = h.fleetRef.current;
      assert.equal(fleet.sizes[seat.index], 0);
      assert.equal([...fleet.sizes].filter(size => size === 0).length, 1);
      const trails = h.parent.getObjectByName('SubtleFlightTrails');
      assert.equal(trails.visible, true);
      assert.deepEqual([...trails.geometry.attributes.color.array.slice(seat.index / 8 * 6, seat.index / 8 * 6 + 6)], [0, 0, 0, 0, 0, 0]);
      h.render({ view: 'cinematic' }); h.advance(16); h.frame();
      assert.ok(fleet.sizes[seat.index] > 0);
      assert.ok([...fleet.sizes].every(size => size > 0));
      assert.ok([...trails.geometry.attributes.color.array.slice(seat.index / 8 * 6, seat.index / 8 * 6 + 3)].some(value => value > 0));
    } finally { h.dispose(); }
  }
});

test('paused fleet caching still restores emitter sizes on seat, panorama and reduced-motion switches', () => {
  const h = sceneHarness();
  try {
    h.clock.togglePause(); h.frame();
    const points = h.parent.getObjectByName('4096IndependentLights');
    const fleet = h.fleetRef.current, sampled = h.updates;
    const version = points.geometry.attributes.aSize.version;
    const firstSeat = h.seats[0], secondSeat = h.seats[1];
    assert.equal(fleet.sizes[firstSeat.index], 0);
    h.dom.win.emit('keydown', { code: 'ArrowRight' });
    for (let i = 0; i < 15; i++) h.frame();
    h.dom.win.emit('keyup', { code: 'ArrowRight' });
    assert.ok(h.child.props.lookRef.current.yaw > 0, 'looking must remain live even while choreography is cached');
    assert.equal(h.updates, sampled, 'a paused timestamp is sampled only once');
    assert.equal(points.geometry.attributes.aSize.version, version);
    h.state.size.height = 844; h.frame();
    assert.equal(h.updates, sampled, 'viewport changes do not resimulate a paused fleet');
    assert.equal(points.material.uniforms.uViewportHeight.value, 844, 'point size tracks the render buffer even on a cached frame');
    h.render({ seatId: secondSeat.id }); h.frame();
    assert.equal(h.updates, sampled + 1);
    assert.ok(fleet.sizes[firstSeat.index] > 0); assert.equal(fleet.sizes[secondSeat.index], 0);
    assertMounted(h, secondSeat);
    h.frame(); assert.equal(h.updates, sampled + 1);
    h.render({ view: 'cinematic' }); h.frame();
    assert.equal(h.updates, sampled + 2); assert.ok([...fleet.sizes].every(size => size > 0));
    h.frame(); assert.equal(h.updates, sampled + 2);
    h.render({ view: 'fpv' }); h.frame();
    assert.equal(h.updates, sampled + 3); assert.equal(fleet.sizes[secondSeat.index], 0);
    h.render({ reducedMotion: true }); h.frame();
    assert.equal(h.updates, sampled + 4); assert.ok([...fleet.sizes].every(size => size > 0));
    h.render({ reducedMotion: false }); h.frame();
    assert.equal(h.updates, sampled + 5); assert.equal(fleet.sizes[secondSeat.index], 0);
    assert.equal(h.fleetRef.current, fleet, 'optimization never swaps out the actual observed fleet');
  } finally { h.dispose(); }
});

test('FPV, panorama, portrait and reduced-motion lens transitions use their own near/far/fov and cleanly restore', () => {
  const h = sceneHarness();
  const original = { fov: 58, near: .08, far: 420 };
  const lens = () => ({ fov: h.state.camera.fov, near: h.state.camera.near, far: h.state.camera.far });
  try {
    h.frame();
    const sample = fpvMath.sampleDroneFirstPerson(h.fleetRef.current, h.seats[0].index, { aspect: 1.6 });
    assert.deepEqual(lens(), { fov: sample.fov, near: sample.near, far: sample.far });
    h.state.size = { width: 390, height: 844 }; h.frame();
    assertMounted(h); assert.ok(h.state.camera.fov > sample.fov);
    h.render({ view: 'cinematic' }); h.frame();
    const wide = directorMath.sampleDroneCamera(h.clock.timeRef.current, 390 / 844);
    assert.deepEqual(lens(), { fov: wide.fov, near: wide.near, far: wide.far });
    h.render({ view: 'fpv', reducedMotion: true }); h.frame();
    const fixed = directorMath.sampleDroneCamera(h.clock.timeRef.current, 390 / 844, true);
    assert.deepEqual(h.state.camera.position.toArray(), fixed.position);
    assert.equal(h.child, null, 'fixed panorama does not mount a canvas look binding');
    h.advance(500); h.frame(); assert.deepEqual(h.state.camera.position.toArray(), fixed.position);
  } finally { h.dispose(); }
  assert.deepEqual(lens(), original);
});

test('arrow look only activates in FPV, ignores edits and modifiers, and clears on blur, hidden, recenter and unmount', () => {
  const h = sceneHarness({ view: 'cinematic' });
  try {
    assert.equal(h.dom.win.count('keydown'), 0);
    assert.equal(h.child, null, 'panorama does not mount a canvas look binding');
    h.render({ view: 'fpv' }); h.clock.togglePause(); h.frame();
    assert.equal(h.dom.win.count('keydown'), 1);
    assert.equal(h.child.props.enabled, true);
    const lookRef = h.child.props.lookRef;
    for (const values of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { target: { tagName: 'INPUT' } }, { target: { tagName: 'TEXTAREA' } }, { target: { tagName: 'SELECT' } }, { target: { isContentEditable: true } }]) {
      assert.equal(h.dom.win.emit('keydown', { code: 'ArrowRight', ...values }).defaultPrevented, undefined);
      h.frame(); assert.equal(lookRef.current.yaw, 0);
    }
    const escape = h.dom.win.emit('keydown', { code: 'Escape', key: 'Escape' });
    assert.equal(escape.defaultPrevented, undefined, 'camera leaves Escape to the controls and browser');
    h.dom.win.emit('keydown', { code: 'ArrowRight' }); h.frame();
    assert.ok(lookRef.current.yaw > 0);
    h.dom.win.emit('keyup', { code: 'ArrowRight' });
    const released = lookRef.current.yaw; h.frame(); assert.equal(lookRef.current.yaw, released);
    for (const interrupt of ['blur', 'hidden', 'recenter']) {
      h.dom.doc.hidden = false;
      h.dom.win.emit('keydown', { code: 'ArrowRight' }); h.lookInputRef.current.up = true;
      if (interrupt === 'blur') h.dom.win.emit('blur');
      if (interrupt === 'hidden') { h.dom.doc.hidden = true; h.dom.doc.emit('visibilitychange'); }
      if (interrupt === 'recenter') h.recenterRef.current++;
      const before = lookRef.current.yaw;
      h.frame();
      assert.equal(lookRef.current.yaw, interrupt === 'recenter' ? 0 : before);
      assert.equal(Object.keys(h.lookInputRef.current).length, 0);
    }
    h.dom.doc.hidden = false;
    h.lookInputRef.current.left = true;
    h.render({ view: 'cinematic' });
    assert.equal(h.dom.win.count('keydown'), 0);
    assert.equal(h.dom.win.count('keyup'), 0);
    assert.equal(Object.keys(h.lookInputRef.current).length, 0);
  } finally { h.dispose(); }
  assert.equal(h.dom.win.count() + h.dom.doc.count(), 0);
});

test('real canvas look binding uses the FPV look ref and disposes lock, capture, and every listener', () => {
  const h = sceneHarness();
  const bindingModule = evaluate('src/components/town/FirstPersonLook.jsx', { react: {}, '@react-three/fiber': {}, './firstPerson.js': lookMath });
  const child = h.child;
  const binding = bindingModule.bindFirstPersonLook(h.dom.canvas, () => child.props);
  try {
    h.clock.togglePause(); h.frame();
    assert.equal(h.dom.requests, 0);
    h.dom.canvas.emit('click');
    assert.equal(h.dom.requests, 1);
    h.dom.doc.emit('mousemove', { movementX: 100, movementY: -20 });
    h.frame(); assertMounted(h);
    assert.ok(child.props.lookRef.current.yaw > 0);
    assert.ok(child.props.lookRef.current.pitch > 0);
    h.lookInputRef.current.right = true;
    h.dom.win.emit('blur');
    assert.equal(h.dom.doc.pointerLockElement, null);
    assert.equal(Object.keys(h.lookInputRef.current).length, 0);
    h.dom.win.emit('focus');
    assert.equal(h.dom.requests, 1, 'regaining focus must never capture the mouse without a click');
  } finally { binding.dispose(); h.dispose(); }
  assert.equal(h.dom.canvas.count() + h.dom.doc.count() + h.dom.win.count(), 0);
  assert.equal(h.dom.canvas.style.touchAction, 'pan-y');
});

function controlsHarness({ view = 'fpv', locked = false } = {}) {
  const hooks = hookRuntime(), dom = surfaces(), timers = new Map();
  let timerId = 0, closed = 0;
  const { clock, advance } = clockFixture();
  clock.start({ elapsedMs: 82000, view });
  const lookInputRef = { current: {} }, telemetryRef = { current: {} };
  const globals = { window: dom.win, document: dom.doc,
    setInterval(callback) { timers.set(++timerId, callback); return timerId; }, clearInterval(id) { timers.delete(id); },
  };
  const Component = evaluate('src/components/drone/DroneShowControls.jsx', {
    './DroneVideoExport.jsx': { __esModule: true, default: () => null },
    react: hooks.react, '../../../shared/droneShow.js': choreography,
    '../../lib/droneShowClock.js': clockModule, '../../lib/droneShowAudio.js': audioModule,
  }, globals).default;
  let tree, props = { onClose: () => { closed++; }, seats: fpvMath.selectDroneSeats(choreography.createDroneFleet()), lookStatus: locked ? 'locked' : 'ready', lookInputRef, telemetryRef };
  function render(patch = {}) {
    props = { ...props, ...patch }; hooks.begin();
    tree = Component({ ...props, controller: { ...clock, state: clock.snapshot() } }); hooks.commit();
    return elements(tree);
  }
  render();
  return { dom, clock, advance, hooks, timers, render, lookInputRef, get closed() { return closed; } };
}

test('controls route Escape to pointer release first and exit only once the view is unlocked', () => {
  const h = controlsHarness({ locked: true });
  try {
    h.dom.doc.pointerLockElement = h.dom.canvas;
    const event = h.dom.win.emit('keydown', { key: 'Escape' });
    assert.equal(event.defaultPrevented, true);
    assert.equal(h.closed, 0); assert.equal(h.dom.releases, 1);
    h.render({ lookStatus: 'ready' });
    h.dom.win.emit('keydown', { key: 'Escape' });
    assert.equal(h.closed, 1);
  } finally { h.hooks.dispose(); }
  assert.equal(h.dom.win.count(), 0);
  assert.equal(h.timers.size, 0);
});

test('controls switch the lens without a replay, preserve FPV on restart, and fall back to fixed panorama for reduced motion', () => {
  const h = controlsHarness({ view: 'cinematic' });
  const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : '';
  try {
    h.clock.togglePause(); h.clock.setSpeed(2);
    const before = h.clock.snapshot();
    let nodes = h.render();
    nodes.find(node => node.type === 'button' && text(node) === '编队第一视角').props.onClick();
    assert.deepEqual(h.clock.snapshot(), { ...before, view: 'fpv' });
    nodes = h.render();
    assert.equal(nodes.find(node => node.type === 'button' && text(node) === '编队第一视角').props['aria-pressed'], true);
    nodes.find(node => node.type === 'button' && node.props.className === 'drone-action drone-restart').props.onClick();
    assert.equal(h.clock.snapshot().view, 'fpv');
    assert.equal(h.clock.snapshot().speed, 2);
    assert.equal(h.clock.timeRef.current, 0);
    h.lookInputRef.current.left = true;
    h.render({ reducedMotion: true }); nodes = h.render();
    assert.equal(h.clock.snapshot().view, 'cinematic');
    assert.equal(nodes.find(node => node.type === 'button' && text(node) === '编队第一视角').props.disabled, true);
    assert.ok(Object.values(h.lookInputRef.current).every(value => !value));
  } finally { h.hooks.dispose(); }
});

test('visible programme buttons switch all three real scores and reselecting the active score never restarts it', () => {
  const h = controlsHarness({ view: 'fpv' });
  try {
    for (const id of ['droplet', 'carrier-battle', 'avatar']) {
      h.clock.setSpeed(2);
      let nodes = h.render();
      const group = nodes.find(node => node.props.role === 'group' && node.props['aria-label'] === '选择无人机演出节目');
      assert.ok(group, 'programme choices are directly visible, not hidden in a select or chapter menu');
      const choices = elements(group).filter(node => node.type === 'button');
      assert.deepEqual(choices.map(elementText), programs.DRONE_PROGRAM_MENU.map(program => program.shortTitle || program.title));
      assert.deepEqual(choices.map(node => node.props['aria-label']), programs.DRONE_PROGRAM_MENU.map(program => program.title));
      assert.ok(choices.every(node => node.props.type === 'button' && typeof node.props['aria-pressed'] === 'boolean'));
      const chosen = choices.find(node => node.props['aria-label'] === programs.getDroneProgram(id).title);
      assert.equal(choices.some(node => elementText(node).includes('黑洞')), false);
      chosen.props.onClick();
      assert.equal(h.clock.snapshot().program, id);
      assert.equal(h.clock.snapshot().elapsedMs, 0);
      assert.equal(h.clock.snapshot().view, 'cinematic');
      assert.equal(h.clock.snapshot().speed, 2);
      h.advance(3000); h.clock.togglePause();
      const before = h.clock.snapshot();
      nodes = h.render();
      const active = nodes.find(node => node.type === 'button' && node.props['aria-label'] === programs.getDroneProgram(id).title);
      assert.equal(active.props['aria-pressed'], true);
      active.props.onClick();
      assert.deepEqual(h.clock.snapshot(), before, 'reselecting a paused score preserves its exact progress');
      const fpv = nodes.find(node => node.type === 'button' && elementText(node) === '编队第一视角');
      assert.equal(Boolean(fpv), id === 'avatar', 'FPV belongs only to the supported original programme');
    }
  } finally { h.hooks.dispose(); }
});

test('one programme catalogue retains all three public scores alongside existing wonders, excluding ambient sky events', () => {
  const hooks = hookRuntime(), calls = [];
  const Invitation = evaluate('src/components/drone/DroneInvitation.jsx', {}).default;
  const Schedule = evaluate('src/components/WonderSchedule.jsx', {
    react: hooks.react,
    './drone/DroneInvitation.jsx': { __esModule: true, default: Invitation },
  }).default;
  hooks.begin();
  const nodes = elements(Schedule({ timeRef: { current: 0 }, onDroneShow: id => calls.push(['drone', id]), onTravel: id => calls.push(['travel', id]), onImmerse: id => calls.push(['observe', id]), onReducedMotion() {} }));
  const invitation = nodes.find(node => node.type === Invitation);
  assert.ok(invitation);
  const droneNodes = elements(Invitation(invitation.props));
  const cards = droneNodes.filter(node => node.type === 'article');
  assert.equal(cards.length, programs.DRONE_PROGRAM_MENU.length);
  assert.doesNotMatch(elementText(Invitation(invitation.props)), /黑洞|片尾|彩蛋|自动接续/);
  for (const program of programs.DRONE_PROGRAM_MENU) {
    const card = cards.find(node => node.props['aria-labelledby'] === `drone-programme-${program.id}`);
    const button = elements(card).find(node => node.type === 'button');
    assert.equal(elementText(button), `观看${program.title}`);
    button.props.onClick();
  }
  for (const id of ['orca', 'carrier', 'rocket']) {
    const row = nodes.find(node => node.props.className === `wonder-programme-row wonder-${id}`);
    assert.ok(row, `${id} remains present in the shared programme catalogue`);
    const buttons = elements(row).filter(node => node.type === 'button');
    assert.equal(buttons.length, 2);
    buttons.forEach(button => button.props.onClick());
  }
  assert.deepEqual(calls, [['drone', 'avatar'], ['drone', 'droplet'], ['drone', 'carrier-battle'], ['travel', 'orca'], ['observe', 'orca'], ['travel', 'carrier'], ['observe', 'carrier'], ['travel', 'rocket'], ['observe', 'rocket']]);
});

const componentNamespace = name => new Proxy({ __esModule: true, default: name }, { get(target, key) { return key in target ? target[key] : `${name}:${String(key)}`; } });

test('App FPV selection, seat changes, seek and look never change the parked avatar destination or submit movement input', () => {
  const hooks = hookRuntime(), { clock } = clockFixture();
  const sent = [], worldTimeRef = { current: 140000 };
  const controller = { ...clock, get state() { return clock.snapshot(); } };
  const offshore = {
    runtimeRef: { current: { now: 0, plan: { startAt: 0, returnAt: 0 }, aboard: false, seat: -1,
      sample: { x: 16, y: 0, z: 85, yaw: 0, pitch: 0, roll: 0, phase: 'docked', label: '靠港待命', progress: 0, moving: false, docked: true, remainingMs: 0 } } },
    state: { phase: 'docked', label: '靠港待命', aboard: false, seat: -1, error: '', pending: '', online: false },
    board() { assert.fail('Drone FPV must not board a ship'); }, depart() { assert.fail('Drone FPV must not start a voyage'); },
    returnToPort() { assert.fail('Drone FPV must not return a ship'); }, disembark() { assert.fail('Drone FPV must not disembark'); },
  };
  const overrides = { react: { ...hooks.react, lazy(loader) {
    const source = String(loader);
    if (/import\(["']\.\/components\/WonderSchedule\.jsx["']\)/.test(source)) return /\.WonderHud\b/.test(source) ? 'WonderHud' : 'WonderSchedule';
    return hooks.react.lazy(loader);
  } },
    './lib/useMultiplayer.js': { __esModule: true, default: () => ({ status: 'disconnected', sendInput: value => sent.push(value) }) },
    './lib/useOffshoreCruise.js': { __esModule: true, default: () => offshore },
    './lib/useWorldClock.js': { __esModule: true, default: () => ({ timeRef: worldTimeRef, label: '白天' }) },
    './lib/profile.js': { loadProfile: () => ({ visits: [], dismissed: [] }), getCompletion: () => 0 },
    './lib/gameCharacterClient.js': { gameCharacterClient: {} }, './lib/marketRecommendations.js': {},
    './lib/catalog.js': catalog, '../shared/world.js': world,
    './components/Town.jsx': { __esModule: true, default: 'Town' },
    './components/WonderSchedule.jsx': { __esModule: true, default: 'WonderSchedule', WonderHud: 'WonderHud' },
    './components/drone/DroneShowControls.jsx': { __esModule: true, default: 'DroneControls', useDroneShowController: () => controller },
    './components/OutdoorPlay.jsx': { useOutdoorPlay: () => ({ runtimeRef: { current: null }, selected: null, exit() {} }), OutdoorLauncher: 'OutdoorLauncher', OutdoorHud: 'OutdoorHud' },
  };
  for (const id of ['./components/TownAtlas.jsx', './components/FlightStatus.jsx', './components/MiniGame.jsx', './components/MarketRecommendations.jsx', './components/NpcDirectory.jsx', './components/MultiplayerPanel.jsx', './components/DayNightControls.jsx']) overrides[id] = componentNamespace(id);
  const App = evaluate('src/App.jsx', overrides, { URLSearchParams, requestAnimationFrame: callback => callback(), window: { location: { search: '' }, matchMedia: () => ({ matches: false }) }, document: { exitPointerLock() {}, querySelector: () => null } });
  let nodes;
  const render = () => { hooks.begin(); nodes = elements(App.default()); return nodes; };
  const town = () => nodes.find(node => node.type === 'Town');
  const controls = () => nodes.find(node => node.type === 'DroneControls');
  render();
  nodes.find(node => node.type === App.MapCameraControls).props.onChange('first-person'); render();
  assert.equal(town().props.viewMode, 'first-person');
  const avatarDestination = town().props.destination;
  nodes.find(node => node.props.className === 'drone-town-entry').props.onClick(); render();
  assert.equal(town().props.viewMode, 'first-person', 'opening the programme list does not force a show camera');
  assert.equal(clock.snapshot().active, false, 'opening the programme list must not autoplay a score');
  assert.equal(controls(), undefined);
  const Invitation = evaluate('src/components/drone/DroneInvitation.jsx', {}).default;
  for (const program of ['droplet', 'avatar']) {
    const schedule = nodes.find(node => node.type === 'WonderSchedule');
    assert.ok(schedule, 'town entry opens the common show catalogue');
    const choices = elements(Invitation({ onStart: schedule.props.onDroneShow }));
    choices.find(node => node.type === 'button' && elementText(node) === `观看${programs.getDroneProgram(program).title}`).props.onClick(); render();
    assert.equal(clock.snapshot().program, program);
    assert.equal(clock.snapshot().elapsedMs, 0, 'selected score starts with its full launch sequence');
    assert.equal(town().props.viewMode, 'drone'); assert.equal(town().props.active, false);
    if (program === 'droplet') {
      controls().props.onClose(); render();
      assert.equal(town().props.viewMode, 'first-person');
      nodes.find(node => node.props.className === 'drone-town-entry').props.onClick(); render();
      assert.equal(clock.snapshot().active, false);
    }
  }
  const inputRef = town().props.inputRef, stoppedInputRef = inputRef.current, stoppedInput = { ...inputRef.current }, showTimeRef = town().props.droneTimeRef;
  clock.seek(82000); clock.togglePause(); clock.setSpeed(2);
  const before = clock.snapshot();
  controls().props.controller.setView('fpv'); render();
  assert.deepEqual(clock.snapshot(), { ...before, view: 'fpv' });
  controls().props.onSeatChange('left-outline'); controls().props.onRecenter(); render();
  assert.equal(town().props.droneFpv.view, 'fpv'); assert.equal(town().props.droneFpv.seatId, 'left-outline');
  assert.equal(town().props.droneFpv.recenterRef.current, 1);
  assert.equal(town().props.droneTimeRef, showTimeRef);
  assert.equal(town().props.npcTimeRef, worldTimeRef);
  assert.equal(town().props.destination, avatarDestination);
  assert.equal(town().props.inputRef, inputRef); assert.equal(inputRef.current, stoppedInputRef); assert.deepEqual({ ...inputRef.current }, stoppedInput);
  assert.deepEqual(sent, [], 'camera controls must not send player or aircraft movement');
  controls().props.controller.setView('cinematic'); render();
  assert.equal(town().props.droneFpv.view, 'cinematic');
  assert.equal(town().props.destination, avatarDestination); assert.equal(inputRef.current, stoppedInputRef); assert.deepEqual({ ...inputRef.current }, stoppedInput);
  controls().props.onClose(); render();
  assert.equal(town().props.viewMode, 'first-person', 'the existing close third-person mode is preserved');
  assert.equal(town().props.active, true); assert.equal(town().props.destination, avatarDestination);
  assert.equal(nodes.some(node => node.type === 'DroneControls'), false);
});

test('Town wires the same fleet and private clock into one camera without replacing the town, player, or shared environment', () => {
  for (const reducedMotion of [false, true]) {
    const hooks = hookRuntime();
    const imports = ['./DuskScenery', './town/PlayerController', './town/SceneEffects', './town/SoftPenumbra', './town/characters/Residents', './town/landmarks/LandmarkFountain.jsx', './town/TownSky.jsx', './town/TownEnvironment.jsx', './town/WonderIslands.jsx', './town/GptPark.jsx', './town/DeepSeekPark.jsx', './town/GeneratedPlayerModel.jsx', './town/OutdoorScenery.jsx', './town/JetpackRig.jsx'];
    const overrides = Object.fromEntries(imports.map(id => [id, componentNamespace(id)]));
    Object.assign(overrides, { react: hooks.react,
      './drone/DroneShow.jsx': { __esModule: true, default: 'DroneShow', DroneCamera: 'DroneCamera' },
      '@react-three/fiber': { Canvas: 'TownCanvas', useFrame: (callback, priority = 0) => hooks.frames.push({ callback, priority }) },
      '@react-three/drei': { Html: 'Html', PerspectiveCamera: 'PerspectiveCamera', RoundedBox: 'RoundedBox' },
    });
    const Town = evaluate('src/components/Town.jsx', overrides).default;
    const sharedClock = { current: 145000 }, showClock = { current: 82000 }, lightingClock = { current: 90000 };
    const droneFpv = { view: 'fpv', seatId: 'hair-tip', lookInputRef: { current: {} } };
    const inputRef = { current: { forward: false } }, destination = { id: 'carrier', nonce: 1 };
    const selections = [], onGptSelect = value => selections.push(value);
    hooks.begin();
    const root = elements(Town({ viewMode: 'drone', active: false, reducedMotion, npcTimeRef: sharedClock, timeRef: lightingClock, droneTimeRef: showClock, droneFpv, inputRef, destination, onGptSelect }));
    assert.equal(root.filter(node => node.type === 'TownCanvas').length, 1);
    const sceneElement = root.find(node => typeof node.type === 'function' && node.props.npcTimeRef === sharedClock);
    const scene = elements(sceneElement.type(sceneElement.props));
    const show = scene.find(node => node.type === 'DroneShow'), camera = scene.find(node => node.type === 'DroneCamera');
    assert.equal(show.props.fleetRef, camera.props.fleetRef);
    assert.equal(show.props.timeRef, showClock); assert.equal(camera.props.timeRef, showClock);
    assert.equal(camera.props.lookInputRef, droneFpv.lookInputRef);
    assert.equal(show.props.firstPersonSeatId, reducedMotion ? null : 'hair-tip');
    const player = scene.find(node => node.type === './town/PlayerController');
    assert.equal(player.props.active, false); assert.equal(player.props.inputRef, inputRef); assert.equal(player.props.destination, destination);
    const sky = scene.find(node => node.type === './town/TownSky.jsx'), wonders = scene.find(node => node.type === './town/WonderIslands.jsx');
    assert.equal(sky.props.timeRef, lightingClock); assert.equal(wonders.props.timeRef, sharedClock);
    assert.equal(scene.filter(node => node.type === 'PerspectiveCamera').length, 1);
    assert.equal(scene.filter(node => node.type === 'TownCanvas').length, 0);
    const gpt = scene.find(node => node.type === './town/GptPark.jsx');
    assert.equal(gpt.props.onSelect, undefined, 'clicking the canvas to look cannot open a different experience');
    const exploringScene = elements(sceneElement.type({ ...sceneElement.props, active: true, viewMode: 'first-person' }));
    const exploringGpt = exploringScene.find(node => node.type === './town/GptPark.jsx');
    assert.equal(exploringGpt.props.onSelect, onGptSelect, 'normal exploration restores the original park entry');
    exploringGpt.props.onSelect('gpt'); assert.deepEqual(selections, ['gpt']);
    const battleScene = elements(sceneElement.type({ ...sceneElement.props, droneFpv: { program: 'carrier-battle', view: 'cinematic' } }));
    assert.equal(battleScene.filter(node => node.type === 'DroneShow').length, 0, 'combat never leaves a second light fleet in the sky');
    const battleCamera = battleScene.find(node => node.type === 'DroneCamera');
    assert.equal(battleCamera.props.program, 'carrier-battle');
    assert.equal(battleCamera.props.timeRef, showClock);
    const battleWonders = battleScene.find(node => node.type === './town/WonderIslands.jsx');
    assert.equal(battleWonders.props.battleTimeRef, showClock, 'the existing port ship receives the same private clock');
    assert.equal(battleWonders.props.timeRef, sharedClock, 'other wonders retain their shared clock');
    assert.equal(wonders.props.battleTimeRef, null, 'normal show does not lift the port ship');
    assert.equal(battleScene.filter(node => node.type === 'PerspectiveCamera').length, 1);
    assert.equal(battleScene.find(node => node.type === './town/PlayerController').props.destination, destination);
  }
});

test('the real inactive PlayerController cannot move the avatar or overwrite the FPV lens when arrow keys rotate the drone view', () => {
  for (const connected of [false, true]) {
    const h = sceneHarness(), hooks = hookRuntime();
    const poseRef = { current: null }, inputRef = { current: {} }, sent = [];
    let now = 0;
    const self = { ...world.SPAWN, id: 'local', seq: 0, y: 0, vy: 0, jetpack: false, thrusting: false, moving: false };
    const network = connected ? { status: 'connected', selfId: 'local', players: [self], snapshotRef: { current: { selfId: 'local', tick: 1, players: [self] } }, sendInput(packet) { sent.push(packet); } } : null;
    const Player = evaluate('src/components/town/PlayerController.jsx', {
      react: hooks.react, '../../lib/catalog': catalog,
      '@react-three/fiber': { useThree: () => h.state, useFrame: (callback, priority = 0) => hooks.frames.push({ callback, priority }) },
      './FirstPersonLook.jsx': { __esModule: true, default: 'PlayerLook' },
    }, { window: h.dom.win, document: h.dom.doc, performance: { now: () => now } }).default;
    hooks.begin();
    Player({ Model: 'PlayerAvatar', active: false, viewMode: 'drone', playerPoseRef: poseRef, inputRef, network });
    hooks.commit();
    const before = { ...poseRef.current };
    try {
      inputRef.current = { forward: true, right: true, jetHeld: true, jumpRequested: 1 };
      h.dom.win.emit('keydown', { code: 'ArrowRight' });
      h.dom.win.emit('keydown', { code: 'KeyW' });
      h.dom.win.emit('keydown', { code: 'Space' });
      for (let frame = 0; frame < 30; frame++) {
        now += 1000 / 60; h.advance(1000 / 60); h.frame();
        const cameraPosition = h.state.camera.position.toArray(), quaternion = h.state.camera.quaternion.toArray();
        const lens = [h.state.camera.fov, h.state.camera.near, h.state.camera.far];
        for (const { callback } of hooks.frames) callback(h.state, 1 / 60);
        assert.deepEqual(h.state.camera.position.toArray(), cameraPosition);
        assert.deepEqual(h.state.camera.quaternion.toArray(), quaternion);
        assert.deepEqual([h.state.camera.fov, h.state.camera.near, h.state.camera.far], lens);
        for (const key of ['x', 'y', 'z', 'yaw']) assert.equal(poseRef.current[key], before[key], `parked avatar ${key} changed`);
        assert.equal(poseRef.current.moving, false); assert.equal(poseRef.current.thrusting, false);
      }
      assert.ok(h.child.props.lookRef.current.yaw > 0, 'the same arrow events actually rotated the onboard view');
      if (connected) assert.ok(sent.length > 0, 'retain the existing multiplayer stop/heartbeat contract');
      assert.ok(sent.every(packet => packet.x === 0 && packet.z === 0 && !packet.thrust && !packet.jump), 'FPV cannot send movement or flight commands');
    } finally { hooks.dispose(); h.dispose(); }
  }
});
