import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as React from 'react';
import { createDroneShowClock } from '../src/lib/droneShowClock.js';

// Execute the real compiled hook and HUD, including their committed effects.
// This validates React/clock wiring, not a browser render or shader output.
const path = 'src/components/drone/DroneShowControls.jsx';
const file = new URL(`../${path}`, import.meta.url);
const require = createRequire(file);
const { code } = await transformWithEsbuild(fs.readFileSync(file, 'utf8'), path, { loader: 'jsx', jsx: 'automatic', format: 'cjs' });

function load(hooks, globals, clock, audioFactory) {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, ...globals, require(id) {
    if (id === 'react') return hooks.react;
    if (id === '../../lib/droneShowClock.js') return { createDroneShowClock: () => clock };
    if (id === '../../lib/droneShowAudio.js') return { createDroneShowAudio: audioFactory };
    if (id.endsWith('.css')) return {};
    return require(id);
  } });
  return module.exports;
}

function hookRuntime() {
  const slots = [], pending = [];
  let cursor = 0, dirty = true;
  const equalDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  function memo(factory, deps) {
    const index = cursor++;
    if (!slots[index] || !equalDeps(slots[index].deps, deps)) slots[index] = { deps, value: factory() };
    return slots[index].value;
  }
  function effect(setup, deps) {
    const index = cursor++, old = slots[index];
    if (old && equalDeps(old.deps, deps)) return;
    pending.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; });
  }
  return {
    get dirty() { return dirty; },
    begin() { cursor = 0; dirty = false; },
    commit() { while (pending.length) pending.shift()(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
    react: { ...React,
      useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
      useState(value) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { value: typeof value === 'function' ? value() : value };
        return [slots[index].value, next => {
          const value = typeof next === 'function' ? next(slots[index].value) : next;
          if (!Object.is(slots[index].value, value)) { slots[index].value = value; dirty = true; }
        }];
      },
      useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps), useEffect: effect, useLayoutEffect: effect,
    },
  };
}

class Surface {
  listeners = new Map();
  hidden = false;
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, data = {}) { for (const callback of [...(this.listeners.get(type) || [])]) callback({ type, target: this, ...data }); }
  count(type) { return type ? this.listeners.get(type)?.size || 0 : [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0); }
}

function elements(node, result = []) {
  if (Array.isArray(node)) node.forEach(child => elements(child, result));
  else if (React.isValidElement(node)) { result.push(node); elements(node.props.children, result); }
  return result;
}
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : '';

function harness({ audioStart = () => Promise.resolve(true), reducedMotion = false, allowEncore = false } = {}) {
  const controllerHooks = hookRuntime(), hudHooks = hookRuntime();
  const doc = new Surface(), win = new Surface(), timers = new Map(), players = [];
  const lookInputRef = { current: { left: false, right: false, up: false, down: false } };
  let now = 1000, timerId = 0, controller, tree;
  const clock = createDroneShowClock({ now: () => now, allowEncore });
  const globals = { document: doc, window: win,
    setInterval(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearInterval(id) { timers.delete(id); },
  };
  const audioFactory = () => {
    const player = { disposed: 0, updates: [], start: audioStart,
      update(value) { this.updates.push(value); }, dispose() { this.disposed++; },
    };
    players.push(player); return player;
  };
  const useController = load(controllerHooks, globals, clock, audioFactory).useDroneShowController;
  const Controls = load(hudHooks, globals, clock, audioFactory).default;
  function render() {
    let passes = 0;
    do {
      assert.ok(++passes < 12, 'committed state/effects must settle');
      controllerHooks.begin(); controller = useController(); controllerHooks.commit();
      hudHooks.begin();
      tree = Controls({ controller, onClose: () => controller.close(), reducedMotion, lookInputRef });
      hudHooks.commit();
    } while (controllerHooks.dirty || hudHooks.dirty);
    return tree;
  }
  function button(label) {
    const node = elements(tree).find(node => node.type === 'button' && text(node) === label);
    assert.ok(node, `button ${label} exists`); return node;
  }
  render();
  return {
    clock, timers, doc, win, players, lookInputRef, render, button,
    get controller() { return controller; }, get tree() { return tree; }, get nodes() { return elements(tree); },
    start(options) { controller.start(options); render(); },
    advance(milliseconds) { now += milliseconds; },
    tick() { for (const { callback } of [...timers.values()]) callback(); render(); },
    visibility(hidden) { doc.hidden = hidden; doc.emit('visibilitychange'); render(); },
    click(label) { const result = button(label).props.onClick(); render(); return result; },
    dispose() { hudHooks.dispose(); controllerHooks.dispose(); },
  };
}


test('real default controller ends waterdrop in place and exposes only the three public shows, never an encore action', () => {
  const h = harness();
  try {
    h.start({ program: 'droplet', elapsedMs: 149999, speed: 2 });
    assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 250);
    assert.equal(h.doc.count('visibilitychange'), 1);
    assert.equal(h.controller.playEncore, undefined);
    h.advance(1); assert.equal(h.controller.timeRef.current, 150000); h.tick();
    assert.equal(h.controller.state.program, 'droplet'); assert.equal(h.controller.state.encoreFrom, null);
    assert.equal(h.controller.state.elapsedMs, 150000); assert.equal(h.controller.state.paused, true);
    assert.equal(h.controller.state.ended, true); assert.equal(h.controller.state.speed, 2);
    assert.doesNotMatch(text(h.tree), /黑洞|片尾|彩蛋|自动接续/);
    const group = h.nodes.find(node => node.props['aria-label'] === '选择无人机演出节目');
    assert.deepEqual(elements(group).filter(node => node.type === 'button').map(text), ['法天象地', '水滴之战', '空天母舰']);
    h.advance(900000); h.tick();
    assert.equal(h.controller.state.program, 'droplet'); assert.equal(h.controller.state.elapsedMs, 150000);
  } finally { h.dispose(); }
});

test('default visibility refresh after long suspension cannot start a new show or consume an ambient event', () => {
  const h = harness();
  try {
    h.start({ program: 'droplet', elapsedMs: 149500 });
    h.advance(600000); h.visibility(false);
    assert.equal(h.controller.state.program, 'droplet'); assert.equal(h.controller.state.elapsedMs, 150000);
    assert.equal(h.controller.state.ended, true); assert.equal(h.controller.state.encoreFrom, null);
    h.visibility(false); h.advance(90000); h.tick();
    assert.equal(h.controller.state.program, 'droplet'); assert.equal(h.controller.state.elapsedMs, 150000);
  } finally { h.dispose(); }
});

test('closing cancels detected completion and removes polling and visibility listeners even in legacy opt-in mode', () => {
  const h = harness({ allowEncore: true });
  try {
    h.start({ program: 'droplet', elapsedMs: 149999 });
    const queuedRefresh = [...h.timers.values()][0].callback;
    h.advance(1); assert.equal(h.controller.timeRef.current, 150000);
    h.controller.close(); h.render();
    assert.equal(h.timers.size, 0); assert.equal(h.doc.count('visibilitychange'), 0);
    queuedRefresh(); h.render(); h.visibility(false);
    assert.equal(h.controller.state.active, false); assert.equal(h.controller.state.program, 'droplet');
    assert.equal(h.controller.state.encoreFrom, null);
    h.start({ program: 'avatar' }); h.advance(100); h.tick(); assert.equal(h.controller.state.program, 'avatar');
  } finally { h.dispose(); }
  assert.equal(h.timers.size, 0); assert.equal(h.doc.count(), 0); assert.equal(h.win.count(), 0);
});

test('scrubbing to the droplet end offers only restart of that same score, not a manual encore entrance', () => {
  const h = harness();
  try {
    h.start({ program: 'droplet', elapsedMs: 10000 });
    const timeline = h.nodes.find(node => node.type === 'input' && node.props.type === 'range');
    timeline.props.onChange({ target: { value: '150000' } }); h.render();
    h.advance(900000); h.tick();
    assert.equal(h.controller.state.program, 'droplet'); assert.equal(h.controller.state.paused, true);
    assert.match(text(h.tree), /演出结束 · 已全部归航/);
    assert.doesNotMatch(text(h.tree), /黑洞|片尾|彩蛋|自动接续/);
    h.click('重新演出');
    assert.equal(h.controller.state.program, 'droplet'); assert.equal(h.controller.state.elapsedMs, 0);
    assert.equal(h.controller.state.encoreFrom, null); assert.equal(h.controller.state.paused, false);
  } finally { h.dispose(); }
});

test('normal ended HUD preserves speed and reduced-motion while replaying only the chosen performance', () => {
  const h = harness({ reducedMotion: true });
  try {
    h.start({ program: 'droplet', elapsedMs: 149999, speed: 2 }); h.advance(1); h.tick();
    assert.equal(h.controller.state.program, 'droplet'); assert.doesNotMatch(text(h.tree), /黑洞|片尾|彩蛋/);
    assert.equal(h.nodes.find(node => node.type === 'input' && node.props.type === 'range').props.max, 150000);
    h.click('从头观看');
    assert.equal(h.controller.state.program, 'droplet'); assert.equal(h.controller.state.elapsedMs, 0);
    assert.equal(h.controller.state.speed, 2); assert.equal(h.controller.state.reducedMotion, true);
    h.advance(75000); h.tick(); assert.equal(h.controller.state.ended, true);
    h.click('重新演出');
    assert.equal(h.controller.state.program, 'droplet'); assert.equal(h.controller.state.elapsedMs, 0);
  } finally { h.dispose(); }
});

test('private legacy celestial playback remains compatible but is absent from all HUD programme choices', () => {
  const h = harness();
  try {
    h.start({ program: 'blackhole' });
    assert.equal(h.controller.state.encoreFrom, null); assert.equal(h.tree.props['data-drone-encore'], undefined);
    assert.match(text(h.tree), /小镇天穹 · 深空奇观/); assert.match(text(h.tree), /静默观演 · 深空全景/);
    assert.doesNotMatch(text(h.tree), /片尾|彩蛋/);
    const group = h.nodes.find(node => node.props['aria-label'] === '选择无人机演出节目');
    assert.deepEqual(elements(group).filter(node => node.type === 'button').map(text), ['法天象地', '水滴之战', '空天母舰']);
    h.advance(90000); h.tick(); h.click('重新演出');
    assert.equal(h.controller.state.program, 'blackhole'); assert.equal(h.controller.state.elapsedMs, 0);
    h.advance(90000); h.tick(); h.click('从头观看');
    assert.equal(h.controller.state.program, 'blackhole'); assert.equal(h.controller.state.elapsedMs, 0);
  } finally { h.dispose(); }
});

test('explicit legacy opt-in still commits one transition but creates no menu entrance or epilogue UI', () => {
  const h = harness({ allowEncore: true });
  try {
    h.start({ program: 'droplet', elapsedMs: 149999, speed: 2 }); h.advance(1);
    assert.equal(h.controller.timeRef.current, 150000); assert.equal(h.controller.state.program, 'droplet');
    h.tick(); assert.equal(h.controller.state.program, 'blackhole'); assert.equal(h.controller.state.encoreFrom, 'droplet');
    assert.equal(h.controller.state.elapsedMs, 0); assert.equal(h.controller.state.speed, 2);
    assert.equal(h.tree.props['data-drone-encore'], undefined); assert.doesNotMatch(text(h.tree), /片尾|彩蛋/);
    h.advance(125); h.tick(); assert.equal(h.controller.state.elapsedMs, 250);
    h.click('法天象地'); h.tick();
    assert.equal(h.controller.state.program, 'avatar'); assert.equal(h.controller.state.encoreFrom, null);
  } finally { h.dispose(); }
});

test('a public programme choice cancels an already detected legacy hand-off', () => {
  const h = harness({ allowEncore: true });
  try {
    h.start({ program: 'droplet', elapsedMs: 149999 }); h.advance(1); void h.controller.timeRef.current;
    h.click('法天象地'); h.tick();
    assert.equal(h.controller.state.program, 'avatar'); assert.equal(h.controller.state.encoreFrom, null);
  } finally { h.dispose(); }
});

test('opt-in legacy transition still disposes battle audio and clears held look input', async () => {
  const h = harness({ allowEncore: true });
  try {
    h.start({ program: 'droplet', elapsedMs: 149999 }); await h.click('开启演出音效'); h.render();
    assert.equal(h.players.length, 1); assert.ok(h.players[0].updates.length > 0);
    h.lookInputRef.current.left = true;
    const updates = h.players[0].updates.length; h.advance(1); h.tick();
    assert.equal(h.controller.state.program, 'blackhole'); assert.equal(h.players[0].disposed, 1);
    assert.equal(h.players[0].updates.length, updates); assert.equal(h.lookInputRef.current.left, false);
    assert.equal(h.nodes.some(node => node.type === 'button' && /演出音效/.test(text(node))), false);
    h.advance(1000); h.tick(); assert.equal(h.players[0].disposed, 1);
  } finally { h.dispose(); }
  assert.equal(h.players[0].disposed, 1);
});

for (const outcome of ['resolve', 'reject']) {
  test('pending audio start ' + outcome + ' cannot restore prior sound after an explicit legacy transition', async () => {
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    const h = harness({ audioStart: () => pending, allowEncore: true });
    try {
      h.start({ program: 'droplet', elapsedMs: 149999 }); const activation = h.click('开启演出音效');
      assert.equal(h.players.length, 1); h.advance(1); h.tick(); assert.equal(h.players[0].disposed, 1);
      if (outcome === 'resolve') resolve(true); else reject(new Error('old battle audio rejected'));
      await activation; h.render();
      assert.equal(h.controller.state.program, 'blackhole'); assert.equal(h.players[0].updates.length, 0);
      assert.equal(h.players[0].disposed, 1); assert.equal(h.nodes.some(node => node.props.className === 'drone-audio-error'), false);
      assert.doesNotMatch(text(h.tree), /正在开启音效|关闭演出音效|old battle audio rejected/);
    } finally { h.dispose(); }
  });
}
