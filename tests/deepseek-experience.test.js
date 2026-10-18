import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { OrbitControls as RealOrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as jsx from 'react/jsx-runtime';
import { transformWithEsbuild } from 'vite';
import * as tour from '../src/components/deepseek/tour.js';
import { auditSources } from '../scripts/check-readability.mjs';

const path = 'src/components/deepseek/DeepSeekParkExperience.jsx';
const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const compiled = await transformWithEsbuild(source, 'DeepSeekParkExperience.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
const marker = name => Object.defineProperty(() => null, 'name', { value: name });
const markers = Object.fromEntries(['Canvas', 'OrbitControls', 'Environment', 'Stars', 'DeepSeekPark'].map(name => [name, marker(name)]));
function elements(node, result = []) {
  if (Array.isArray(node)) node.forEach(child => elements(child, result));
  else if (node?.props) { result.push(node); elements(node.props.children, result); }
  return result;
}
function words(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node === 'boolean') return '';
  return (Array.isArray(node) ? node : [node?.props?.children]).map(words).join('');
}
function documentMock() {
  const listeners = new Map();
  const document = { title: '游戏小镇', hidden: false, body: { style: { overflow: 'auto' } }, activeElement: null,
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    querySelector() { return this.fallback ?? null; },
  };
  const element = (visible = true) => ({ isConnected: true, focus() { document.activeElement = this; }, getClientRects: () => visible ? [{}] : [] });
  const previous = element(), first = element(), last = element(), hidden = element(false);
  const root = { ...element(), querySelectorAll: () => [first, hidden, last], contains: item => [first, last, hidden, root].includes(item) };
  previous.focus();
  return { document, root, first, last, previous, listeners,
    event(key, shiftKey = false) { const event = { key, shiftKey, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; for (const callback of [...(listeners.get('keydown') ?? [])]) callback(event); return event; },
  };
}
function harness({ document = documentMock().document, three = {} } = {}) {
  const slots = []; let cursor = 0; const effects = [], frames = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) { const index = cursor++; slots[index] ??= { value: typeof value === 'function' ? value() : value }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useMemo(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const previous = slots[index]; const slot = slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slot.cleanup = fn(); }); } },
    Suspense: marker('Suspense'),
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled.code, { module, exports: module.exports, document, requestAnimationFrame: fn => { fn(); return 1; }, require(id) {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return jsx;
    if (id === '@react-three/fiber') return { Canvas: markers.Canvas, useFrame: (fn, priority = 0) => frames.push({ fn, priority }), useThree: () => three };
    if (id === '@react-three/drei') return markers;
    if (id === 'three') return THREE;
    if (id === 'lucide-react') return new Proxy({}, { get: (_, name) => marker(name) });
    if (id === './tour.js') return tour;
    if (id === '../town/DeepSeekPark.jsx') return { default: markers.DeepSeekPark, __esModule: true };
    if (id === '../../lib/appUrl.js') return { appUrl: value => `/game-town${value}` };
    if (id.endsWith('.css')) return {};
    throw new Error(`Unexpected import ${id}`);
  } });
  return { Component: module.exports.default, CameraTour: module.exports.CameraTour, ParkClock: module.exports.ParkClock, render(Component, props) { cursor = 0; frames.length = 0; return Component(props); }, commit() { for (const effect of effects.splice(0)) effect(); }, frame(delta = 1 / 60) { for (const { fn } of [...frames].sort((a, b) => a.priority - b.priority)) fn(three, delta); }, cleanup() { for (const slot of slots) slot?.cleanup?.(); }, slots, frames };
}
function cameraRig({ width = 1280, reducedMotion = false } = {}) {
  const camera = new THREE.PerspectiveCamera(46, width / 844, .15, 650); camera.position.set(47, 27, 57);
  const controls = new RealOrbitControls(camera, null);
  const h = harness({ three: { camera, size: { width, height: 844 } } });
  function select(id) { const control = h.render(h.CameraTour, { selected: id, reducedMotion }); Object.assign(controls, Object.fromEntries(['minDistance', 'maxDistance', 'maxPolarAngle', 'enablePan', 'enableDamping', 'dampingFactor'].map(key => [key, control.props[key]]))); control.props.ref.current = controls; h.commit(); return control; }
  return { camera, controls, h, select };
}

test('DeepSeek tour keeps original five camera compositions immutable with a safe unknown-view fallback', () => {
  assert.deepEqual(tour.DEEPSEEK_VIEWS.map(view => view.id), ['gate', 'whale', 'towers', 'layers', 'sky']);
  assert.equal(tour.deepSeekView('untrusted-view').id, 'whale');
  for (const view of tour.DEEPSEEK_VIEWS) { assert.ok(Object.isFrozen(view)); assert.ok(Object.isFrozen(view.position)); assert.ok([...view.position, ...view.target].every(Number.isFinite)); }
});

test('DeepSeek actual CameraTour converges through real OrbitControls and projection matrices on desktop and mobile', () => {
  for (const width of [1280, 390]) {
    const { camera, controls, h, select } = cameraRig({ width });
    for (const view of tour.DEEPSEEK_VIEWS) {
      select(view.id); for (let i = 0; i < 300; i++) h.frame();
      const target = new THREE.Vector3(...view.target); target.y -= .335;
      const eye = new THREE.Vector3(...view.position); eye.y -= .335;
      if (width < 700) eye.sub(target).multiplyScalar(1.25).add(target);
      assert.ok(camera.position.distanceTo(eye) < .05, `${width}px ${view.id}: original framing`);
      assert.ok(controls.target.distanceTo(target) < .05);
      camera.updateMatrixWorld(true);
      const projected = target.clone().project(camera);
      assert.ok(Math.abs(projected.x) < .002 && Math.abs(projected.y) < .002 && projected.z > -1 && projected.z < 1, 'view target stays centered and inside the real perspective clip range');
      assert.ok(camera.matrixWorld.elements.every(Number.isFinite));
      assert.ok(camera.position.y > target.y, 'orbit cannot tilt below the ground-facing pole limit');
    }
  }
});

test('DeepSeek user orbit interrupts camera flight and reduced motion snaps once instead of animating', () => {
  const { camera, h, select } = cameraRig();
  const orbit = select('gate'); h.frame(); orbit.props.onStart();
  const stopped = camera.position.clone(); for (let i = 0; i < 90; i++) h.frame(); assert.ok(camera.position.equals(stopped));
  select('layers'); h.frame(); assert.ok(!camera.position.equals(stopped), 'new viewpoint resumes an intentional camera flight');
  const reduced = cameraRig({ reducedMotion: true }); reduced.select('sky'); reduced.h.frame();
  assert.ok(reduced.camera.position.distanceTo(new THREE.Vector3(0, 112 - .335, 112)) < 1e-8);
  const settled = reduced.camera.position.clone(); reduced.h.frame(); assert.ok(reduced.camera.position.equals(settled));
});

test('DeepSeek dialog real effect traps keyboard focus, exits once and restores title/body/focus without leaking listeners', () => {
  const dom = documentMock(), h = harness({ document: dom.document }); let closes = 0;
  const tree = h.render(h.Component, { onClose: () => closes++ }); tree.props.ref.current = dom.root; h.commit();
  assert.equal(dom.document.activeElement, dom.root); assert.equal(dom.document.body.style.overflow, 'hidden'); assert.match(dom.document.title, /DeepSeek/);
  assert.ok(dom.event('Tab').prevented); assert.equal(dom.document.activeElement, dom.first);
  assert.ok(dom.event('Tab', true).prevented); assert.equal(dom.document.activeElement, dom.last);
  assert.ok(dom.event('Tab').prevented); assert.equal(dom.document.activeElement, dom.first);
  const escape = dom.event('Escape'); assert.equal(closes, 1); assert.ok(escape.prevented && escape.stopped);
  h.cleanup(); assert.equal(dom.listeners.get('keydown').size, 0); assert.equal(dom.document.title, '游戏小镇'); assert.equal(dom.document.body.style.overflow, 'auto'); assert.equal(dom.document.activeElement, dom.previous);
  dom.event('Escape'); assert.equal(closes, 1);
});

test('DeepSeek exit restores the stable map entry after the originating atlas dialog has unmounted', () => {
  const dom = documentMock(), h = harness({ document: dom.document });
  const tree = h.render(h.Component, { onClose() {} }); tree.props.ref.current = dom.root; h.commit();
  dom.previous.isConnected = false; dom.document.fallback = dom.first; h.cleanup();
  assert.equal(dom.document.activeElement, dom.first);
  assert.equal(dom.listeners.get('keydown').size, 0);
});

test('DeepSeek actual ParkClock freezes hidden, paused and reduced frames without catching up after resume', () => {
  const dom = documentMock(), h = harness({ document: dom.document }), timeRef = { current: 0 };
  const render = (paused = false, reducedMotion = false) => h.render(h.ParkClock, { timeRef, paused, reducedMotion });
  render(); assert.equal(h.frames[0].priority, -100); h.frame(.016); assert.equal(timeRef.current, 16);
  h.frame(60); assert.equal(timeRef.current, 66, 'clamps long frames rather than jumping a minute');
  render(true); h.frame(5); assert.equal(timeRef.current, 66);
  render(false, true); h.frame(.016); assert.equal(timeRef.current, 66);
  render(); dom.document.hidden = true; h.frame(600); assert.equal(timeRef.current, 66);
  dom.document.hidden = false; h.frame(.016); assert.equal(timeRef.current, 82, 'resumes from paused time instead of wall clock');
  h.frame(-1); assert.equal(timeRef.current, 82);
});

test('DeepSeek experience passes original-scale model props, one Canvas and accessible pause/night/view actions', () => {
  const h = harness(); let entered = 0; const props = { onClose() {}, onEnterTown() { entered++; } };
  let tree = h.render(h.Component, props);
  assert.equal(elements(tree).filter(node => node.type === markers.Canvas).length, 1);
  let park = elements(tree).find(node => node.type === markers.DeepSeekPark); assert.equal(park.props.inTown, false); assert.equal(park.props.paused, false); assert.equal(park.props.reducedMotion, false);
  assert.equal(elements(tree).find(node => node.type?.name === 'ParkClock').props.timeRef, park.props.timeRef, 'model and animation clock share one stable time source');
  elements(tree).find(node => node.type === 'button' && words(node).includes('暂停动态')).props.onClick();
  tree = h.render(h.Component, props); park = elements(tree).find(node => node.type === markers.DeepSeekPark); assert.equal(park.props.paused, true);
  elements(tree).find(node => node.type === 'button' && words(node).includes('走进园区')).props.onClick(); assert.equal(entered, 1);
  const oldBackground = elements(tree).find(node => node.type === 'color').props.args[0];
  elements(tree).find(node => node.type === 'button' && words(node).includes('切换白天')).props.onClick(); tree = h.render(h.Component, props); assert.notEqual(elements(tree).find(node => node.type === 'color').props.args[0], oldBackground);
  const reduced = harness(); const reducedTree = reduced.render(reduced.Component, { ...props, reducedMotion: true });
  assert.equal(elements(reducedTree).find(node => node.type === markers.DeepSeekPark).props.reducedMotion, true);
  assert.ok(elements(reducedTree).some(node => node.type === 'button' && node.props.disabled));
  assert.doesNotMatch(source, /new\s+THREE\.WebGLRenderer|requestAnimationFrame\s*\(|setInterval\s*\(/);
});

test('DeepSeek new observation UI obeys semantic font floors across mobile and focus styles', () => {
  const files = ['src/styles.css', path, 'src/components/deepseek/deepseek-experience.css'];
  const result = auditSources(files.map(file => ({ path: file, content: fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') })));
  assert.deepEqual(result.issues, []);
  assert.ok(result.stats.mediaQueries >= 1);
  const css = fs.readFileSync(new URL('../src/components/deepseek/deepseek-experience.css', import.meta.url), 'utf8');
  assert.match(css, /:focus-visible/); assert.match(css, /min-height:44px/);
});
