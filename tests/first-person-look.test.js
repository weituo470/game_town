import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformWithEsbuild } from 'vite';
import * as math from '../src/components/town/firstPerson.js';

const source = fs.readFileSync(new URL('../src/components/town/FirstPersonLook.jsx', import.meta.url), 'utf8');
const compiled = await transformWithEsbuild(source, 'FirstPersonLook.jsx', { loader: 'jsx', format: 'cjs' });
const module = { exports: {} };
vm.runInNewContext(compiled.code, {
  module, exports: module.exports,
  require(id) {
    if (id === './firstPerson.js') return math;
    if (id === 'react' || id === '@react-three/fiber') return {};
    throw new Error(`Unexpected import: ${id}`);
  },
});
const { bindFirstPersonLook } = module.exports;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`);
const settled = () => new Promise(resolve => setImmediate(resolve));

class Surface {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, values = {}) {
    const event = { type, target: this, isTrusted: true, ...values };
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }
  count() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function harness(initial = {}) {
  const win = new Surface();
  const doc = new Surface();
  doc.defaultView = win;
  doc.hidden = false;
  doc.pointerLockElement = null;
  let exits = 0, requests = 0, stops = 0, invalidations = 0;
  const statuses = [];
  doc.exitPointerLock = () => {
    exits++;
    doc.pointerLockElement = null;
    doc.emit('pointerlockchange');
  };
  const canvas = new Surface();
  canvas.ownerDocument = doc;
  canvas.style = { touchAction: 'pan-y' };
  const captures = new Set();
  canvas.setPointerCapture = id => captures.add(id);
  canvas.hasPointerCapture = id => captures.has(id);
  canvas.releasePointerCapture = id => {
    captures.delete(id);
    canvas.emit('lostpointercapture', { pointerId: id });
  };
  canvas.requestPointerLock = () => {
    requests++;
    doc.pointerLockElement = canvas;
    doc.emit('pointerlockchange');
    return Promise.resolve();
  };
  const options = {
    enabled: true, active: true, lookRef: { current: { yaw: 0, pitch: 0 } },
    onStatus: status => statuses.push(status), onStop: () => { stops++; }, ...initial,
  };
  const bind = () => bindFirstPersonLook(canvas, () => options, () => { invalidations++; });
  const binding = bind();
  const pointer = (type, values = {}) => canvas.emit(type, {
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 100, clientY: 100, ...values,
  });
  return {
    win, doc, canvas, captures, options, binding, bind, pointer, statuses,
    get exits() { return exits; }, get requests() { return requests; },
    get stops() { return stops; }, get invalidations() { return invalidations; },
  };
}

test('look bindings never request pointer lock on activation, focus, sync or movement', () => {
  const h = harness();
  h.binding.sync();
  h.win.emit('focus');
  h.doc.emit('mousemove', { movementX: 100, movementY: 100 });
  h.pointer('pointermove', { clientX: 120 });
  assert.equal(h.requests, 0);
  assert.deepEqual(h.statuses, ['ready']);
  assert.equal(h.canvas.style.touchAction, 'none');
  h.binding.dispose();
});

test('explicit light canvas click locks and document mousemove applies sensitivity once', async () => {
  const h = harness();
  h.pointer('pointerdown');
  h.pointer('pointerup');
  assert.equal(h.requests, 0);
  h.canvas.emit('click');
  await settled();
  assert.equal(h.requests, 1);
  assert.deepEqual(h.statuses, ['ready', 'locked']);
  h.doc.emit('mousemove', { movementX: 100, movementY: -50 });
  close(h.options.lookRef.current.yaw, 100 * math.LOOK_SENSITIVITY);
  close(h.options.lookRef.current.pitch, 50 * math.LOOK_SENSITIVITY);
  h.pointer('pointerdown');
  h.pointer('pointermove', { clientX: 200 });
  assert.equal(h.captures.size, 0);
  assert.equal(h.invalidations, 1);
  h.binding.dispose();
});

test('dragging rotates without pointer lock and its following click cannot accidentally lock', () => {
  const h = harness();
  h.pointer('pointerdown');
  assert.equal(h.captures.size, 1);
  h.pointer('pointermove', { clientX: 180, clientY: 140 });
  h.pointer('pointerup', { clientX: 180, clientY: 140 });
  h.canvas.emit('click');
  assert.equal(h.requests, 0);
  assert.equal(h.captures.size, 0);
  close(h.options.lookRef.current.yaw, 80 * math.LOOK_SENSITIVITY);
  close(h.options.lookRef.current.pitch, -40 * math.LOOK_SENSITIVITY);
  assert.deepEqual(h.statuses, ['ready', 'drag']);
  h.pointer('pointerdown');
  h.pointer('pointerup');
  h.canvas.emit('click');
  assert.equal(h.requests, 1);
  h.binding.dispose();
});

test('touch drag captures only its own pointer, never requests a lock or prevents navigation defaults', () => {
  const h = harness();
  let prevented = 0;
  h.pointer('pointerdown', { pointerType: 'touch', preventDefault: () => { prevented++; } });
  h.pointer('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 150 });
  assert.equal(h.invalidations, 0);
  h.pointer('pointermove', { pointerType: 'touch', clientX: 150, clientY: 80 });
  h.pointer('pointerup', { pointerType: 'touch' });
  h.canvas.emit('click', { pointerType: 'touch' });
  h.canvas.emit('click');
  assert.equal(h.requests, 0);
  assert.equal(prevented, 0);
  assert.equal(h.captures.size, 0);
  close(h.options.lookRef.current.yaw, 50 * math.LOOK_SENSITIVITY);
  close(h.options.lookRef.current.pitch, 20 * math.LOOK_SENSITIVITY);
  h.binding.dispose();
});

for (const pointerType of ['touch', 'pen']) {
  test(`a nonprimary ${pointerType} can look while the movement pad owns the primary pointer`, () => {
    const h = harness();
    // The primary finger is held on a separate movement button, not the canvas.
    h.pointer('pointerdown', { pointerId: 2, pointerType, isPrimary: false });
    assert.ok(h.captures.has(2));
    h.pointer('pointermove', { pointerId: 2, pointerType, isPrimary: false, clientX: 150, clientY: 80 });
    close(h.options.lookRef.current.yaw, 50 * math.LOOK_SENSITIVITY);
    close(h.options.lookRef.current.pitch, 20 * math.LOOK_SENSITIVITY);

    // An additional canvas finger cannot steal or end the active look gesture.
    h.pointer('pointerdown', { pointerId: 3, pointerType, isPrimary: false });
    h.pointer('pointermove', { pointerId: 3, pointerType, isPrimary: false, clientX: 300 });
    h.pointer('pointerup', { pointerId: 3, pointerType, isPrimary: false });
    assert.ok(h.captures.has(2));
    assert.ok(!h.captures.has(3));
    assert.equal(h.invalidations, 1);

    h.pointer('pointermove', { pointerId: 2, pointerType, isPrimary: false, clientX: 170, clientY: 80 });
    close(h.options.lookRef.current.yaw, 70 * math.LOOK_SENSITIVITY);
    h.pointer('pointerup', { pointerId: 2, pointerType, isPrimary: false });
    h.canvas.emit('click', { pointerType });
    assert.equal(h.captures.size, 0);
    assert.equal(h.requests, 0);
    h.binding.dispose();
  });
}

test('unsupported pointer lock and synchronous failure degrade to deduplicated drag status', () => {
  for (const request of [undefined, () => { throw new Error('Denied'); }]) {
    const h = harness();
    h.canvas.requestPointerLock = request;
    h.canvas.emit('click');
    h.canvas.emit('click');
    assert.deepEqual(h.statuses, ['ready', 'drag']);
    h.pointer('pointerdown');
    h.pointer('pointermove', { clientX: 130 });
    assert.ok(h.options.lookRef.current.yaw > 0);
    h.binding.dispose();
  }
});

test('rejected lock Promise is handled and a paired pointerlockerror does not repeat status', async () => {
  const h = harness();
  h.canvas.requestPointerLock = () => Promise.reject(new Error('Iframe lock denied'));
  h.canvas.emit('click');
  h.doc.emit('pointerlockerror');
  await settled();
  assert.deepEqual(h.statuses, ['ready', 'drag']);
  h.binding.dispose();
});

test('Esc-style browser unlock clears movement once and permits a later explicit click', () => {
  const h = harness();
  h.canvas.emit('click');
  h.doc.pointerLockElement = null;
  h.doc.emit('pointerlockchange');
  h.doc.emit('pointerlockchange');
  assert.equal(h.stops, 1);
  assert.deepEqual(h.statuses, ['ready', 'locked', 'ready']);
  h.doc.emit('mousemove', { movementX: 400, movementY: 0 });
  assert.equal(h.invalidations, 0);
  h.canvas.emit('click');
  assert.equal(h.requests, 2);
  h.binding.dispose();
});

for (const reason of ['blur', 'hidden', 'disabled', 'inactive']) {
  test(`${reason} releases own lock/capture, stops movement, and does not automatically relock`, () => {
    const h = harness();
    h.canvas.emit('click');
    if (reason === 'blur') h.win.emit('blur');
    if (reason === 'hidden') { h.doc.hidden = true; h.doc.emit('visibilitychange'); }
    if (reason === 'disabled') { h.options.enabled = false; h.binding.sync(); }
    if (reason === 'inactive') { h.options.active = false; h.binding.sync(); }
    assert.equal(h.exits, 1);
    assert.equal(h.stops, 1);
    assert.equal(h.doc.pointerLockElement, null);
    assert.equal(h.canvas.style.touchAction, 'pan-y');
    h.canvas.emit('click');
    h.doc.emit('mousemove', { movementX: 500, movementY: 500 });
    assert.equal(h.requests, 1);
    assert.equal(h.invalidations, 0);
    h.options.enabled = h.options.active = true;
    h.doc.hidden = false;
    h.win.emit('focus');
    h.binding.sync();
    assert.equal(h.requests, 1);
    h.binding.dispose();
  });
}

test('late lock grant after disabling and re-enabling is released rather than silently recapturing', async () => {
  const h = harness();
  let resolve;
  h.canvas.requestPointerLock = () => new Promise(done => { resolve = done; });
  h.canvas.emit('click');
  h.options.active = false;
  h.binding.sync();
  h.options.active = true;
  h.binding.sync();
  h.doc.pointerLockElement = h.canvas;
  h.doc.emit('pointerlockchange');
  resolve();
  await settled();
  assert.equal(h.doc.pointerLockElement, null);
  assert.equal(h.exits, 1);
  assert.ok(!h.statuses.includes('locked'));
  h.binding.dispose();
});

test('unmount handles an outstanding Promise, cleans every listener and restores capture/style', async () => {
  const h = harness();
  let resolve;
  h.canvas.requestPointerLock = () => new Promise(done => { resolve = done; });
  h.canvas.emit('click');
  h.pointer('pointerdown');
  h.binding.dispose();
  h.binding.dispose();
  assert.equal(h.canvas.count() + h.doc.count() + h.win.count(), 0);
  assert.equal(h.captures.size, 0);
  assert.equal(h.canvas.style.touchAction, 'pan-y');
  assert.equal(h.stops, 1);
  h.doc.pointerLockElement = h.canvas;
  resolve();
  await settled();
  assert.equal(h.doc.pointerLockElement, null);
  assert.equal(h.exits, 1);
  assert.deepEqual(h.statuses, ['ready']);
});

test('inactive and disposed bindings never release another element pointer lock', () => {
  const h = harness();
  const otherCanvas = {};
  h.doc.pointerLockElement = otherCanvas;
  h.doc.emit('pointerlockchange');
  h.options.active = false;
  h.binding.sync();
  h.binding.dispose();
  assert.equal(h.exits, 0);
  assert.equal(h.doc.pointerLockElement, otherCanvas);
});

test('StrictMode-style cleanup/rebind produces one set of listeners and one rotation per event', () => {
  const h = harness();
  const count = h.canvas.count() + h.doc.count() + h.win.count();
  h.binding.dispose();
  const second = h.bind();
  assert.equal(h.canvas.count() + h.doc.count() + h.win.count(), count);
  h.canvas.emit('click');
  h.doc.emit('mousemove', { movementX: 10, movementY: 0 });
  close(h.options.lookRef.current.yaw, 10 * math.LOOK_SENSITIVITY);
  assert.equal(h.invalidations, 1);
  second.dispose();
  assert.equal(h.canvas.count() + h.doc.count() + h.win.count(), 0);
});

test('callbacks are read live and status reports are not duplicated by sync or lock events', () => {
  const h = harness();
  const statuses = [];
  let stops = 0;
  h.options.onStatus = status => statuses.push(status);
  h.options.onStop = () => { stops++; };
  h.binding.sync();
  h.canvas.emit('click');
  h.doc.emit('pointerlockchange');
  h.binding.sync();
  h.win.emit('blur');
  assert.deepEqual(statuses, ['locked', 'ready']);
  assert.deepEqual(h.statuses, ['ready']);
  assert.equal(stops, 1);
  h.binding.dispose();
});

test('secondary pointers, right clicks, untrusted clicks and canceled drags do not capture the mouse', () => {
  const h = harness();
  h.pointer('pointerdown', { button: 2 });
  h.pointer('pointerdown', { isPrimary: false });
  h.canvas.emit('click', { isTrusted: false });
  assert.equal(h.captures.size, 0);
  assert.equal(h.requests, 0);
  h.pointer('pointerdown');
  h.pointer('pointercancel');
  h.canvas.emit('click');
  assert.equal(h.requests, 0);
  h.binding.dispose();
});

test('follow RMB orbit: only held right mouse rotates and never requests pointer lock', () => {
  const h = harness({ orbitOnly: true });
  h.pointer('pointerdown'); h.pointer('pointermove', { clientX: 200 }); h.pointer('pointerup');
  h.canvas.emit('click');
  assert.equal(h.requests, 0); assert.equal(h.options.lookRef.current.yaw, 0);
  h.pointer('pointerdown', { button: 2, buttons: 2 });
  h.pointer('pointermove', { button: -1, buttons: 2, clientX: 180, clientY: 50 });
  close(h.options.lookRef.current.yaw, 80 * math.LOOK_SENSITIVITY);
  close(h.options.lookRef.current.pitch, 50 * math.LOOK_SENSITIVITY);
  h.pointer('pointerup', { button: 2, buttons: 0 });
  const yaw = h.options.lookRef.current.yaw;
  h.pointer('pointermove', { clientX: 250, buttons: 0 });
  close(h.options.lookRef.current.yaw, yaw);
  assert.equal(h.captures.size, 0); assert.equal(h.requests, 0);
  h.binding.dispose(); assert.equal(h.canvas.count()+h.doc.count()+h.win.count(),0);
});

test('follow RMB orbit: missed release, pointer cancellation, blur and visibility never leave an active drag', () => {
  for (const end of ['buttons', 'pointercancel', 'lostpointercapture', 'blur', 'hidden']) {
    const h=harness({orbitOnly:true});
    h.pointer('pointerdown',{button:2,buttons:2});
    h.pointer('pointermove',{clientX:150,buttons:2});
    const yaw=h.options.lookRef.current.yaw;
    if(end==='buttons')h.pointer('pointermove',{clientX:190,buttons:0});
    else if(end==='blur')h.win.emit('blur');
    else if(end==='hidden'){h.doc.hidden=true;h.doc.emit('visibilitychange');}
    else h.pointer(end,{button:2});
    h.pointer('pointermove',{clientX:220,buttons:2});
    close(h.options.lookRef.current.yaw,yaw);
    assert.equal(h.captures.size,0);
    if(['pointercancel','lostpointercapture','blur','hidden'].includes(end))assert.equal(h.stops,1);
    h.binding.dispose();
  }
});

test('follow RMB orbit: canvas-only context menu suppression and live outdoor/modal gates', () => {
  const h=harness({orbitOnly:true,blockedRef:{current:null}});let canvasMenus=0,docMenus=0;
  h.canvas.emit('contextmenu',{preventDefault(){canvasMenus++;}});
  h.doc.emit('contextmenu',{preventDefault(){docMenus++;}});
  assert.equal(canvasMenus,1);assert.equal(docMenus,0);
  for(const gate of ['outdoor','inactive','disabled']){
    if(gate==='outdoor')h.options.blockedRef.current={id:'fishing'};
    if(gate==='inactive')h.options.active=false;
    if(gate==='disabled')h.options.enabled=false;
    h.binding.sync();h.pointer('pointerdown',{button:2,buttons:2});h.pointer('pointermove',{clientX:220,buttons:2});
    h.canvas.emit('contextmenu',{preventDefault(){canvasMenus++;}});
    assert.equal(h.options.lookRef.current.yaw,0);assert.equal(h.captures.size,0);assert.equal(canvasMenus,1);
    h.options.blockedRef.current=null;h.options.active=true;h.options.enabled=true;
  }
  h.binding.dispose();
});

test('follow RMB orbit: switch from locked close view releases the lock without recapturing',async()=>{
  const h=harness();h.canvas.emit('click');await settled();assert.equal(h.requests,1);
  h.options.orbitOnly=true;h.binding.sync();assert.equal(h.doc.pointerLockElement,null);
  h.doc.emit('mousemove',{movementX:300,movementY:300});assert.equal(h.options.lookRef.current.yaw,0);
  h.canvas.emit('click');assert.equal(h.requests,1);
  h.pointer('pointerdown',{button:2,buttons:2});h.pointer('pointermove',{clientX:150,buttons:2});
  assert.ok(h.options.lookRef.current.yaw>0);h.binding.dispose();
});
