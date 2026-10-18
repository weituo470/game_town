import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as rules from '../src/minigames/outdoor.js';

const file = new URL('../src/components/OutdoorPlay.jsx', import.meta.url);
const require = createRequire(file);
const compiled = await transformWithEsbuild(fs.readFileSync(file, 'utf8'), 'OutdoorPlay.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
function emitter() {
  const listeners = new Map();
  return { addEventListener(key, fn) { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); },
    removeEventListener(key, fn) { listeners.get(key)?.delete(fn); },
    emit(key, options = {}) { const event = { code: '', target: { closest: () => false }, preventDefault() {}, ...options }; for (const fn of listeners.get(key) || []) fn(event); } };
}
function harness() {
  let index = 0, now = 0;
  const states = [], refs = [], effects = [], pending = [], timers = [];
  const win = emitter(), doc = { ...emitter(), hidden: false, exitPointerLock() {} };
  const module = { exports: {} };
  vm.runInNewContext(compiled.code, {
    module, exports: module.exports, window: win, document: doc, performance: { now: () => now }, localStorage: { getItem: () => null },
    setInterval(fn, ms) { const timer = { fn, ms, active: true }; timers.push(timer); return timer; }, clearInterval(timer) { timer.active = false; },
    require(id) {
      if (id === '../minigames/outdoor.js') return rules;
      if (id.endsWith('.css')) return {};
      if (id === 'react') return {
        useRef(value) { const slot = index++; return refs[slot] ||= { current: value }; },
        useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial; return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }]; },
        useCallback: fn => fn,
        useEffect(callback, deps) { const slot = index++, previous = effects[slot]; if (!previous || deps.some((value, i) => previous.deps[i] !== value)) pending.push(() => { previous?.cleanup?.(); effects[slot] = { deps, cleanup: callback() }; }); },
      };
      return require(id);
    },
  });
  function render() { index = 0; const hook = module.exports.useOutdoorPlay(); while (pending.length) pending.shift()(); return hook; }
  return { render, window: win, document: doc, advance(ms) { for (let t = 0; t < ms; t += 16) { now += 16; for (const timer of timers) if (timer.active) timer.fn(); } }, cleanup() { for (const effect of effects) effect?.cleanup?.(); } };
}
test('outdoor input: gameplay clock advances independently of WebGL frames and cleans up', () => {
  const app = harness(); let hook = app.render(); hook.start('fishing'); hook = app.render();
  rules.beginOutdoorGame(hook.runtimeRef.current);
  app.window.emit('keydown', { code: 'Space' }); app.window.emit('keyup', { code: 'Space' });
  app.advance(2000); assert.equal(hook.runtimeRef.current.phase, 'waiting');
  assert.ok(hook.runtimeRef.current.elapsed >= 2, 'no render frame was needed to advance two real seconds');
  const elapsed = hook.runtimeRef.current.elapsed; app.cleanup(); app.advance(1000); assert.equal(hook.runtimeRef.current.elapsed, elapsed);
});
test('outdoor input: blur and hidden tabs pause, clear held keys and never resume automatically', () => {
  const app = harness(); let hook = app.render(); hook.start('hop'); hook = app.render();
  rules.beginOutdoorGame(hook.runtimeRef.current); app.window.emit('keydown', { code: 'Space' }); app.advance(300);
  assert.equal(hook.runtimeRef.current.phase, 'charging'); app.window.emit('blur');
  assert.equal(hook.runtimeRef.current.phase, 'grounded'); assert.equal(hook.runtimeRef.current.held, false); assert.equal(hook.runtimeRef.current.paused, true);
  const elapsed = hook.runtimeRef.current.elapsed; app.advance(1000); assert.equal(hook.runtimeRef.current.elapsed, elapsed);
  rules.setOutdoorPaused(hook.runtimeRef.current, false); app.document.hidden = true; app.document.emit('visibilitychange');
  assert.equal(hook.runtimeRef.current.paused, true); app.document.hidden = false; app.document.emit('visibilitychange'); assert.equal(hook.runtimeRef.current.paused, true);
  app.cleanup();
});
test('outdoor input: editable fields do not start actions; Escape works on buttons and flushes before exit', () => {
  const app = harness(); let hook = app.render(); hook.start('fishing'); hook = app.render(); rules.beginOutdoorGame(hook.runtimeRef.current);
  const target = { closest: () => true }; app.window.emit('keydown', { code: 'Space', target }); assert.equal(hook.runtimeRef.current.phase, 'idle');
  let flushed = false; hook.runtimeRef.current.flush = () => { flushed = true; };
  app.window.emit('keydown', { code: 'Escape', target }); assert.equal(flushed, true); assert.equal(hook.runtimeRef.current, null);
  hook = app.render(); assert.equal(hook.selected, null); app.cleanup();
});
