import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDroneShowClock } from '../src/lib/droneShowClock.js';
import * as samples from '../shared/droneSamplePrograms.js';

// Execute real compiled component bodies and committed hook effects. Only
// module loading / encoder hardware are deferred doubles; no component logic
// or production clock is replaced. Real encoder lifecycle has its own suite.
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : React.isValidElement(node) ? text(node.props.children) : '';
function elements(node, result = []) {
  if (Array.isArray(node)) node.forEach(child => elements(child, result));
  else if (React.isValidElement(node)) { result.push(node); elements(node.props.children, result); }
  return result;
}
function hooks() {
  let cursor = 0, dirty = true; const slots = [], pending = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const effect = (setup, deps) => { const index = cursor++, previous = slots[index]; if (previous && same(previous.deps, deps)) return; pending.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; }); };
  return { get dirty() { return dirty; }, begin() { cursor = 0; dirty = false; }, commit() { while (pending.length) pending.shift()(); }, dispose() { slots.forEach(slot => slot?.cleanup?.()); },
    react: { ...React, useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }]; },
      useEffect: effect, useLayoutEffect: effect,
      useMemo(factory, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { deps, value: factory() }; return slots[index].value; },
    },
  };
}
async function component(name, dependencies = {}, globals = {}) {
  const file = new URL(`../src/components/drone/${name}.jsx`, import.meta.url), require = createRequire(file);
  // Substitute only the asynchronous module transport so cancellation can be
  // exercised while an actual dynamic import is unresolved in the browser.
  const source = fs.readFileSync(file, 'utf8')
    .replaceAll("import('../../lib/droneVideoRecorder.js')", '__loadRecorder()')
    .replaceAll("import('../../../shared/droneSamplePrograms.js')", '__loadSamples()')
    .replaceAll("import('./DroneVideoExport.jsx')", '__loadExport()');
  const { code } = await transformWithEsbuild(source, `${name}.jsx`, { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, ...globals, require(id) {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    if (id.endsWith('.css')) return {};
    return require(id);
  } });
  return module.exports.default;
}
const capability = { mp4: { supported: true }, webm: { supported: true } };
async function exportHarness(settings = {}) {
  const runtime = samples.createDroneSampleRuntime('voyage-of-light'), stateHooks = hooks();
  let time = 1000, tree, startCalls = 0, importCalls = 0;
  const clock = createDroneShowClock({ now: () => time }); clock.start({ program: 'ai', aiRuntime: runtime, elapsedMs: 50000, speed: 2 });
  const busy = [], recorders = [], canvas = { width: 1280, height: 720 };
  const busyChange = value => busy.push(value);
  const module = { detectDroneVideoCapabilities: async () => capability, createDroneVideoRecorder() {
    const index = recorders.length;
    const recorder = { state: { phase: 'idle' }, cancels: 0, disposed: 0, stopReasons: [], input: null,
      async start(input) { this.input = input; this.state = { phase: 'preparing' }; input.onState(this.state);
        if (settings.encoderGate?.[index]) await settings.encoderGate[index].promise;
        if (this.cancels) throw Object.assign(new Error('cancelled old encoder'), { code: 'CANCELLED' });
        this.state = { phase: 'recording' }; input.onState(this.state); return this.state;
      },
      async stop(reason) { this.stopReasons.push(reason); this.state = { phase: 'processing' }; this.input.onState(this.state);
        if (settings.stopGate?.[index]) await settings.stopGate[index].promise;
        const result = { url: 'blob:test-film', bytes: 1024, durationMs: reason === 'complete' ? 600000 : 2000, extension: 'mp4', reason };
        this.state = { phase: 'ready', result }; this.input.onState(this.state); return result;
      },
      cancel() { this.cancels++; this.state = { phase: 'idle' }; this.input?.onState(this.state); return Promise.resolve(null); },
      dispose() { this.disposed++; return this.cancel(); }, getState() { return this.state; },
    }; recorders.push(recorder); return recorder;
  } };
  const Component = await component('DroneVideoExport', { react: stateHooks.react }, { document: { querySelector: () => canvas }, __loadRecorder: () => {
    importCalls++; return importCalls > 1 && settings.importGate?.[importCalls - 2] ? settings.importGate[importCalls - 2].promise : Promise.resolve(module);
  } });
  const controller = () => ({ ...clock, state: clock.snapshot(), start(options) { startCalls++; return clock.start(options); } });
  function render() { let passes = 0; do { assert.ok(++passes < 12); stateHooks.begin(); tree = Component({ controller: controller(), program: runtime.program, onBusyChange: busyChange }); stateHooks.commit(); } while (stateHooks.dirty); return tree; }
  function click(label) { const node = elements(tree).find(item => item.type === 'button' && text(item) === label); assert.ok(node, label); node.props.onClick(); render(); }
  render(); click('导出 MP4'); await flush(); render();
  return { clock, module, recorders, busy, render, click, advance: ms => { time += ms; }, dispose: () => stateHooks.dispose(),
    get tree() { return tree; }, get startCalls() { return startCalls; }, async settle() { await flush(); render(); } };
}

test('sample library renders real 10/4/5-minute catalogue and discards late playback after close', async () => {
  const Static = await component('DroneSampleLibrary');
  const html = renderToStaticMarkup(React.createElement(Static, { onPlay() {} }));
  for (const value of ['10:00', '4:00', '5:00', '当前会话编排', '无配乐', '回放零模型调用']) assert.ok(html.includes(value));
  assert.equal((html.match(/aria-label="观看样板：/g) || []).length, 3);
  const stateHooks = hooks(), gate = deferred(), played = [];
  const Component = await component('DroneSampleLibrary', { react: stateHooks.react }, { __loadSamples: () => gate.promise });
  stateHooks.begin(); const tree = Component({ onPlay: value => played.push(value) }); stateHooks.commit();
  const buttons = elements(tree).filter(item => item.type === 'button'); buttons[0].props.onClick(); buttons[1].props.onClick();
  stateHooks.dispose(); gate.resolve(samples); await flush();
  assert.equal(played.length, 0, 'an unmounted studio cannot reopen observation');
});

test('cancel during module loading prevents late encoder allocation and any playback restart', async () => {
  const gate = deferred(), h = await exportHarness({ importGate: [gate] });
  h.click('从头录制 MP4'); h.click('取消录制');
  gate.resolve(h.module); await h.settle();
  assert.equal(h.recorders.length, 0); assert.equal(h.startCalls, 0);
  assert.doesNotMatch(text(h.tree), /正在录制|正在准备本机编码器|cancelled/);
  assert.equal(h.busy.at(-1), false); h.dispose();
});

test('cancelled encoder startup cannot overwrite an immediate replacement recording', async () => {
  const gate = deferred(), h = await exportHarness({ encoderGate: [gate] });
  h.click('从头录制 MP4'); await h.settle();
  assert.equal(h.recorders.length, 1); assert.equal(h.clock.snapshot().paused, true);
  h.click('取消录制'); h.click('从头录制 MP4'); await h.settle();
  assert.equal(h.recorders.length, 2); assert.equal(h.clock.snapshot().paused, false); assert.equal(h.clock.snapshot().speed, 1);
  gate.resolve(); await h.settle();
  assert.match(text(h.tree), /正在录制/); assert.doesNotMatch(text(h.tree), /cancelled old encoder/);
  assert.equal(h.recorders[0].cancels >= 1, true); h.dispose();
});

test('natural ten-minute completion stops only once and offers a real MP4-labelled result', async () => {
  const h = await exportHarness(); h.click('从头录制 MP4'); await h.settle();
  assert.equal(h.clock.snapshot().elapsedMs, 0); assert.equal(h.clock.snapshot().speed, 1); assert.equal(h.clock.snapshot().view, 'cinematic');
  h.recorders[0].input.onProgress({ durationMs: 12000, bytes: 1024, frames: 100 }); h.render();
  assert.match(text(h.tree), /当前实际采样约 8\.3 帧\/秒/);
  h.recorders[0].input.onProgress({ durationMs: 12000, bytes: 1024, frames: 360 }); h.render();
  assert.doesNotMatch(text(h.tree), /视频可能不流畅/);
  h.advance(600000); h.render(); await h.settle();
  assert.deepEqual(h.recorders[0].stopReasons, ['complete']);
  assert.equal(h.clock.snapshot().ended, true); assert.match(text(h.tree), /全片已完成。 录制用时 10:00/);
  assert.doesNotMatch(text(h.tree), /视频时长/);
  const preview = elements(h.tree).find(item => item.type === 'video');
  preview.props.onLoadedMetadata({ currentTarget: { duration: NaN } }); h.render();
  assert.match(text(h.tree), /录制用时 10:00/);
  // Explicit unit-test metadata, not a claim that this mock encoded a file:
  // the UI must use the player's measured duration, never recorder wall time.
  preview.props.onLoadedMetadata({ currentTarget: { duration: 597.5 } }); h.render();
  assert.match(text(h.tree), /视频时长 9:57/);
  assert.doesNotMatch(text(h.tree), /录制用时 10:00/);
  const link = elements(h.tree).find(item => item.type === 'a'); assert.ok(link.props.download.endsWith('.mp4')); assert.equal(link.props.href, 'blob:test-film');
  h.dispose(); assert.ok(h.recorders[0].disposed > 0);
});

test('a late failed old finalization cannot replace a newer recording state', async () => {
  const gate = deferred(), h = await exportHarness({ stopGate: [gate] });
  h.click('从头录制 MP4'); await h.settle(); h.click('停止并保留片段');
  assert.match(text(h.tree), /正在封装视频/);
  h.click('取消录制'); h.click('从头录制 MP4'); await h.settle();
  gate.reject(new Error('old finalization failed')); await h.settle();
  assert.equal(h.recorders.length, 2); assert.match(text(h.tree), /正在录制/); assert.doesNotMatch(text(h.tree), /old finalization failed/);
  h.dispose();
});

test('unmount cancels in-flight preparation and cannot resume the show when it finishes', async () => {
  const gate = deferred(), h = await exportHarness({ encoderGate: [gate] });
  h.click('从头录制 MP4'); await h.settle(); assert.equal(h.startCalls, 1);
  h.dispose(); gate.resolve(); await flush();
  assert.equal(h.startCalls, 1); assert.ok(h.recorders[0].disposed >= 1); assert.equal(h.busy.at(-1), false);
});

test('real sample HUD exposes the 600-second timeline and locks scrubbing while its export child is busy', async () => {
  const runtime = samples.createDroneSampleRuntime('voyage-of-light'), clock = createDroneShowClock({ now: () => 0 });
  clock.start({ program: 'ai', aiRuntime: runtime });
  const stateHooks = hooks();
  // Execute the real HUD and preserve the child's props across its lazy
  // boundary. The child body is tested above; no eager production import is
  // added to accommodate this raw-element harness.
  const ExportChild = () => null;
  let lazyLoader, exportLoads = 0;
  const Component = await component('DroneShowControls', { react: { ...stateHooks.react, lazy(loader) { lazyLoader = loader; return ExportChild; } } },
    { window: { addEventListener() {}, removeEventListener() {} }, __loadExport: async () => { exportLoads++; return { default: ExportChild }; } });
  assert.equal(exportLoads, 0, 'loading the HUD must not eagerly load video export');
  assert.equal(typeof lazyLoader, 'function');
  assert.equal((await lazyLoader()).default, ExportChild);
  assert.equal(exportLoads, 1);
  const render = () => { stateHooks.begin(); const tree = Component({ controller: { ...clock, state: clock.snapshot() }, onClose() {} }); stateHooks.commit(); return tree; };
  let tree = render(), nodes = elements(tree);
  assert.equal(nodes.find(item => item.type === 'input' && item.props.type === 'range').props.max, 600000);
  assert.match(text(tree), /0:00 \/ 10:00/);
  nodes.find(item => item.type === ExportChild).props.onBusyChange(true);
  tree = render(); nodes = elements(tree);
  assert.equal(nodes.find(item => item.type === 'fieldset' && item.props.className === 'drone-playback-lock').props.disabled, true);
  assert.equal(nodes.find(item => item.type === ExportChild).props.program.sampleId, 'voyage-of-light');
  stateHooks.dispose();
});
