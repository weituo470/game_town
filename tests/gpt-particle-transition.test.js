import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

// Execute the real component with deterministic hooks, Canvas2D and RAF adapters.
// This suite verifies lifecycle/timing, not browser pixel quality or React DOM layout.
const source = fs.readFileSync(new URL('../src/components/gpt/ParticleTransition.jsx', import.meta.url), 'utf8');
const { code } = await transform(source, {
  loader: 'jsx', format: 'cjs', target: 'es2022', jsxFactory: 'createElement',
});

function harness({ width = 1200, height = 800, dpr = 2, hidden = false, missingContext = false } = {}) {
  let now = 0, nextRaf = 0, refIndex = 0, effectIndex = 0;
  let pendingEffects = [];
  const refs = [], effects = [], rafs = new Map(), microtasks = [];
  const documentListeners = new Map(), windowListeners = new Map(), observers = new Set();
  const viewport = { width, height };
  const metrics = { drawImages: 0, ellipses: 0, requestedContexts: [], clears: 0 };
  const addListener = (map, type, fn) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
  };
  const removeListener = (map, type, fn) => map.get(type)?.delete(fn);
  const emit = (map, type) => [...(map.get(type) ?? [])].forEach(fn => fn());
  const listenerCount = map => [...map.values()].reduce((total, listeners) => total + listeners.size, 0);

  function drawingContext() {
    return {
      globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', lineWidth: 1,
      clearRect() { metrics.clears++; },
      drawImage() { metrics.drawImages++; },
      ellipse() { metrics.ellipses++; },
      createRadialGradient() { return { addColorStop() {} }; },
      getImageData() { return { data: new Uint8ClampedArray([100, 220, 190, 255]) }; },
      setTransform() {}, fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    };
  }

  const parent = { getBoundingClientRect: () => ({ ...viewport }) };
  function makeCanvas(root = false) {
    const context = drawingContext();
    return {
      style: {}, dataset: {}, width: 1, height: 1, parentElement: root ? parent : null,
      getBoundingClientRect: () => ({ ...viewport }),
      getContext(kind) {
        metrics.requestedContexts.push(kind);
        assert.equal(kind, '2d', 'the effect must not allocate a second WebGL context');
        return root && missingContext ? null : context;
      },
      removeAttribute(name) {
        if (name.startsWith('data-')) {
          const key = name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
          delete this.dataset[key];
        }
      },
    };
  }

  const canvas = makeCanvas(true);
  const document = {
    hidden,
    createElement(tag) { assert.equal(tag, 'canvas'); return makeCanvas(); },
    addEventListener: (type, fn) => addListener(documentListeners, type, fn),
    removeEventListener: (type, fn) => removeListener(documentListeners, type, fn),
  };
  const window = {
    devicePixelRatio: dpr,
    addEventListener: (type, fn) => addListener(windowListeners, type, fn),
    removeEventListener: (type, fn) => removeListener(windowListeners, type, fn),
  };
  class ResizeObserver {
    constructor(callback) { this.callback = callback; }
    observe(target) { assert.equal(target, parent); observers.add(this); }
    disconnect() { observers.delete(this); }
  }

  const hooks = {
    useRef(value) {
      const index = refIndex++;
      if (!refs[index]) refs[index] = { current: value };
      return refs[index];
    },
    useEffect(create, deps) {
      const index = effectIndex++;
      const previous = effects[index];
      if (!previous || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects[index] = { create, deps, cleanup: create() };
        });
      }
    },
  };
  const module = { exports: {} };
  const scope = vm.createContext({
    module, exports: module.exports, document, window, ResizeObserver,
    require(name) { assert.equal(name, 'react'); return hooks; },
    createElement(tag, props) {
      assert.equal(tag, 'canvas');
      if (props.ref) props.ref.current = canvas;
      canvas.elementProps = props;
      return { tag, props };
    },
    requestAnimationFrame(fn) { const id = ++nextRaf; rafs.set(id, fn); return id; },
    cancelAnimationFrame(id) { rafs.delete(id); },
    queueMicrotask(fn) { microtasks.push(fn); },
  });
  vm.runInContext(code, scope, { filename: 'ParticleTransition.compiled.cjs' });
  const Component = module.exports.default;

  const api = {
    canvas, metrics, timing: module.exports.PARTICLE_TRANSITION_TIMING,
    get now() { return now; },
    get rafCount() { return rafs.size; },
    get observerCount() { return observers.size; },
    get listenerCount() { return listenerCount(documentListeners) + listenerCount(windowListeners); },
    render(props = {}) {
      refIndex = effectIndex = 0;
      pendingEffects = [];
      Component(props);
      pendingEffects.forEach(run => run());
    },
    frame(ms = 16) {
      now += ms;
      const pending = [...rafs.values()];
      rafs.clear();
      pending.forEach(fn => fn(now));
    },
    advance(ms, step = 16) {
      let remaining = ms;
      while (remaining > 0) {
        const delta = Math.min(step, remaining);
        api.frame(delta);
        remaining -= delta;
      }
    },
    visibility(value) { document.hidden = value; emit(documentListeners, 'visibilitychange'); },
    resize(nextWidth, nextHeight, nextDpr = window.devicePixelRatio) {
      viewport.width = nextWidth; viewport.height = nextHeight; window.devicePixelRatio = nextDpr;
      [...observers].forEach(observer => observer.callback());
      emit(windowListeners, 'resize');
    },
    replayEffects() {
      // React StrictMode's setup -> cleanup -> setup replay preserves ref identities.
      effects.forEach(effect => effect.cleanup?.());
      effects.forEach(effect => { effect.cleanup = effect.create(); });
    },
    flushMicrotasks() { while (microtasks.length) microtasks.shift()(); },
    dispose() { effects.forEach(effect => effect.cleanup?.()); },
  };
  return api;
}

const transition = token => ({ token, fromColor: '#6becb8', toColor: '#78dcff' });
function recorder(h) {
  const events = [];
  return {
    events,
    callbacks: {
      onCommit: token => events.push({ type: 'commit', token, time: h.now }),
      onComplete: token => events.push({ type: 'complete', token, time: h.now }),
    },
  };
}

test('particle transition commits at 1000ms and completes at 2400ms exactly once', t => {
  const h = harness(), { events, callbacks } = recorder(h);
  t.after(() => h.dispose());
  h.render({ transition: transition(1), ...callbacks });
  h.frame(0);
  h.advance(999);
  assert.equal(events.length, 0);
  assert.equal(h.canvas.dataset.phase, 'gather');
  h.advance(1);
  assert.deepEqual(events, [{ type: 'commit', token: 1, time: 1000 }]);
  assert.equal(h.canvas.dataset.phase, 'reveal');
  assert.equal(h.canvas.dataset.committed, 'true');
  h.advance(1399);
  assert.equal(events.length, 1);
  h.advance(1);
  assert.deepEqual(events, [{ type: 'commit', token: 1, time: 1000 }, { type: 'complete', token: 1, time: 2400 }]);
  assert.equal(h.canvas.dataset.phase, 'complete');
  assert.equal(h.canvas.dataset.progress, '1');
  assert.equal(h.canvas.dataset.active, 'false');
  assert.equal(h.rafCount, 0);
  h.advance(5000);
  assert.equal(events.length, 2);
});

test('idle transition has no RAF, listeners or context and cannot intercept HUD input', t => {
  const h = harness();
  t.after(() => h.dispose());
  h.render({ transition: null });
  assert.equal(h.rafCount, 0);
  assert.equal(h.listenerCount, 0);
  assert.equal(h.observerCount, 0);
  assert.equal(h.metrics.requestedContexts.length, 0);
  assert.equal(h.canvas.elementProps['aria-hidden'], 'true');
  assert.equal(h.canvas.elementProps.style.pointerEvents, 'none');
  assert.equal(h.canvas.elementProps.style.zIndex, 0);
  assert.equal(h.canvas.elementProps.hidden, true);
  assert.equal(h.canvas.dataset.phase, 'idle');
});

test('StrictMode initial effect replay keeps one RAF and emits each callback only once', t => {
  const h = harness(), { events, callbacks } = recorder(h);
  t.after(() => h.dispose());
  h.render({ transition: transition('strict'), ...callbacks });
  h.replayEffects();
  assert.equal(h.rafCount, 1);
  assert.equal(h.observerCount, 1);
  assert.equal(h.listenerCount, 2);
  h.frame(0); h.advance(2400);
  assert.deepEqual(events.map(event => event.type), ['commit', 'complete']);
  h.replayEffects();
  assert.equal(h.rafCount, 0);
  assert.equal(events.length, 2);
});

test('effect replay after commit resumes the reveal without committing the same token twice', t => {
  const h = harness(), { events, callbacks } = recorder(h);
  t.after(() => h.dispose());
  h.render({ transition: transition('replay-after-cut'), ...callbacks });
  h.frame(0); h.advance(1100);
  assert.deepEqual(events.map(event => event.type), ['commit']);
  h.replayEffects();
  h.frame(0); h.advance(1400);
  assert.deepEqual(events.map(event => event.type), ['commit', 'complete']);
});

test('cancellation before midpoint removes RAF, observers and listeners without emitting callbacks', t => {
  const h = harness(), { events, callbacks } = recorder(h);
  t.after(() => h.dispose());
  h.render({ transition: transition('cancel-before'), ...callbacks });
  h.frame(0); h.advance(600);
  h.render({ transition: null, ...callbacks });
  assert.equal(h.rafCount, 0);
  assert.equal(h.observerCount, 0);
  assert.equal(h.listenerCount, 0);
  assert.equal(h.canvas.dataset.phase, 'idle');
  assert.equal(h.canvas.dataset.token, undefined);
  h.advance(5000);
  assert.equal(events.length, 0);
});

test('cancellation after midpoint never completes a superseded transition', t => {
  const h = harness(), { events, callbacks } = recorder(h);
  t.after(() => h.dispose());
  h.render({ transition: transition('cancel-after'), ...callbacks });
  h.frame(0); h.advance(1200);
  h.render({ transition: null, ...callbacks });
  h.advance(5000);
  assert.deepEqual(events.map(event => event.type), ['commit']);
  assert.equal(h.rafCount, 0);
});

test('a new token cancels the older gathering animation and owns both subsequent callbacks', t => {
  const h = harness(), { events, callbacks } = recorder(h);
  t.after(() => h.dispose());
  h.render({ transition: transition('old'), ...callbacks });
  h.frame(0); h.advance(600);
  h.render({ transition: transition('new'), ...callbacks });
  assert.equal(h.rafCount, 1);
  h.frame(0); h.advance(2400);
  assert.deepEqual(events.map(({ type, token }) => [type, token]), [['commit', 'new'], ['complete', 'new']]);
});

test('ten seconds in a hidden document freeze progress and resume without a time jump', t => {
  const h = harness(), { events, callbacks } = recorder(h);
  t.after(() => h.dispose());
  h.render({ transition: transition('background'), ...callbacks });
  h.frame(0); h.advance(640);
  const before = h.canvas.dataset.progress;
  h.visibility(true);
  assert.equal(h.canvas.dataset.paused, 'true');
  assert.equal(h.rafCount, 0);
  h.advance(10000);
  assert.equal(h.canvas.dataset.progress, before);
  assert.equal(events.length, 0);
  h.visibility(false);
  assert.equal(h.canvas.dataset.paused, 'false');
  h.frame(16);
  assert.equal(h.canvas.dataset.progress, before, 'first resumed frame establishes a new time baseline');
  h.advance(360);
  assert.deepEqual(events.map(event => event.type), ['commit']);
  h.advance(1400);
  assert.deepEqual(events.map(event => event.type), ['commit', 'complete']);
});

test('a transition mounted while hidden starts only when the document becomes visible', t => {
  const h = harness({ hidden: true }), { events, callbacks } = recorder(h);
  t.after(() => h.dispose());
  h.render({ transition: transition('starts-hidden'), ...callbacks });
  assert.equal(h.rafCount, 0);
  h.advance(10000);
  assert.equal(events.length, 0);
  h.visibility(false); h.frame(0); h.advance(2400);
  assert.deepEqual(events.map(event => event.type), ['commit', 'complete']);
});

test('reduced-motion mode uses a 200ms fade with a 100ms cut and no flying particles', t => {
  const h = harness(), { events, callbacks } = recorder(h);
  t.after(() => h.dispose());
  h.render({ transition: transition('reduced'), reducedMotion: true, ...callbacks });
  h.frame(0); h.advance(99);
  assert.equal(events.length, 0);
  h.advance(1);
  assert.deepEqual(events, [{ type: 'commit', token: 'reduced', time: 100 }]);
  h.advance(100);
  assert.equal(events[1].type, 'complete');
  assert.equal(events[1].time, 200);
  assert.equal(h.canvas.dataset.motion, 'reduced');
  assert.equal(h.metrics.drawImages, 0);
  assert.equal(h.metrics.ellipses, 0);
  assert.equal(h.rafCount, 0);
});

test('canvas follows stage resize, caps DPR at 1.5 and releases resize work after completion', t => {
  const h = harness({ dpr: 3 }), { callbacks } = recorder(h);
  t.after(() => h.dispose());
  h.render({ transition: transition('resize'), ...callbacks });
  assert.equal(h.canvas.dataset.dpr, '1.5');
  assert.equal(h.canvas.width, 1800);
  assert.equal(h.canvas.height, 1200);
  h.resize(390, 844, 3);
  assert.equal(h.canvas.width, 585);
  assert.equal(h.canvas.height, 1266);
  h.resize(800, 600, 1);
  assert.equal(h.canvas.width, 800);
  assert.equal(h.canvas.height, 600);
  assert.equal(h.canvas.dataset.dpr, '1');
  h.frame(0); h.advance(2400);
  assert.equal(h.observerCount, 0);
  assert.equal(h.listenerCount, 0);
  h.resize(600, 400, 2);
  assert.equal(h.canvas.width, 800, 'completed effects do not keep a resize loop alive');
});

test('a previously completed token stays deduplicated even after an idle render', t => {
  const h = harness(), { events, callbacks } = recorder(h);
  t.after(() => h.dispose());
  h.render({ transition: transition(0), ...callbacks });
  h.frame(0); h.advance(2400);
  h.render({ transition: null, ...callbacks });
  h.render({ transition: transition(0), ...callbacks });
  h.advance(3000);
  assert.equal(events.length, 2);
  assert.equal(h.rafCount, 0);
  assert.equal(h.canvas.dataset.phase, 'complete');
});

test('rerendering with new callbacks keeps the current clock and calls only the latest handlers', t => {
  const h = harness(), old = recorder(h), latest = recorder(h);
  t.after(() => h.dispose());
  h.render({ transition: transition('callbacks'), ...old.callbacks });
  h.frame(0); h.advance(800);
  h.render({ transition: transition('callbacks'), ...latest.callbacks });
  h.advance(200);
  assert.equal(old.events.length, 0);
  assert.equal(latest.events[0].time, 1000, 'callback changes must not restart the 1000ms cut clock');
  h.advance(1400);
  assert.deepEqual(latest.events.map(event => event.type), ['commit', 'complete']);
});

test('missing Canvas2D context still settles callbacks and cancellation prevents fallback callbacks', t => {
  const h = harness({ missingContext: true }), { events, callbacks } = recorder(h);
  const cancelled = harness({ missingContext: true }), cancelledRecorder = recorder(cancelled);
  t.after(() => { h.dispose(); cancelled.dispose(); });
  h.render({ transition: transition('no-context'), ...callbacks });
  h.flushMicrotasks();
  assert.deepEqual(events.map(event => event.type), ['commit', 'complete']);
  assert.equal(h.rafCount, 0);
  cancelled.render({ transition: transition('cancel-fallback'), ...cancelledRecorder.callbacks });
  cancelled.render({ transition: null });
  cancelled.flushMicrotasks();
  assert.equal(cancelledRecorder.events.length, 0);
});
