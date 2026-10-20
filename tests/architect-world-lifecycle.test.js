import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as React from 'react';
import * as THREE from 'three';
import { transformWithEsbuild } from 'vite';
import { ARCHITECT_KINDS, ARCHITECT_PLOTS } from '../shared/architectPlan.js';
import * as models from '../src/components/architect/architectModels.js';

const source = new URL('../src/components/architect/ArchitectWorld.jsx', import.meta.url);
const compiled = (await transformWithEsbuild(readFileSync(source, 'utf8'), source.pathname, { loader: 'jsx', jsx: 'automatic', format: 'cjs' })).code;
const require = createRequire(source);

// Replays the effect lifecycle React StrictMode uses: the same committed host
// refs receive setup, cleanup, then setup again without a fresh render. Actual
// THREE groups/geometries/materials are used so group.clear() cannot be mocked
// away and a reused, already-disposed resource really becomes invisible.
function strictWorldHarness(props) {
  let active;
  const instances = [], resources = [], scene = new THREE.Scene();
  function ref(value) { const index = active.cursor++; return active.slots[index] ||= { current: value }; }
  function effect(setup) { active.effects.push(setup); }
  function memo(factory) { const index = active.cursor++; if (!(index in active.slots)) active.slots[index] = factory(); return active.slots[index]; }
  function factory(name) {
    return (...args) => {
      const resource = models[name](...args), record = { name, resource, geometryDisposed: 0, materialDisposed: 0 };
      resource.group.traverse(object => {
        if (!object.isMesh) return;
        object.geometry.addEventListener('dispose', () => record.geometryDisposed++);
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.addEventListener('dispose', () => record.materialDisposed++);
      });
      resources.push(record); return resource;
    };
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, require(id) {
    if (id === 'react') return { ...React, useRef: ref, useLayoutEffect: effect, useEffect: effect, useMemo: memo };
    if (id === '@react-three/fiber') return { useFrame: callback => active.frames.push(callback) };
    if (id === '@react-three/drei') return { Html: 'Html' };
    if (id.endsWith('architectModels.js')) return { createArchitectBuilding: factory('createArchitectBuilding'), createArchitectResident: factory('createArchitectResident') };
    if (id.endsWith('.css')) return {};
    return require(id);
  } });
  function mount(element, parent) {
    if (Array.isArray(element)) { element.forEach(child => mount(child, parent)); return; }
    if (!React.isValidElement(element)) return;
    if (typeof element.type === 'function') {
      const previous = active;
      active = { cursor: 0, slots: [], effects: [], frames: [] }; instances.push(active);
      const rendered = element.type(element.props);
      active = previous; mount(rendered, parent); return;
    }
    if (element.type !== 'group') return;
    const group = new THREE.Group(); group.name = element.props.name || '';
    if (element.props.position) group.position.fromArray(element.props.position);
    if (element.props.rotation) group.rotation.fromArray(element.props.rotation);
    if (element.props.ref) element.props.ref.current = group;
    parent.add(group); mount(element.props.children, group);
  }
  mount(React.createElement(module.exports.default, props), scene);
  let cleanups = [];
  return { scene, resources,
    setup() { assert.equal(cleanups.length, 0); for (const instance of instances.slice().reverse()) for (const setup of instance.effects) { const cleanup = setup(); if (cleanup) cleanups.push(cleanup); } },
    cleanup() { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); },
    frame(delta = 0.1) { for (const instance of instances) instance.frames.forEach(callback => callback({}, delta)); },
  };
}
function meshes(scene) { const result = []; scene.traverse(object => { if (object.isMesh) result.push(object); }); return result; }
function disposed(record) {
  assert.equal(record.geometryDisposed, record.resource.stats.drawCalls);
  assert.equal(record.materialDisposed, record.resource.stats.drawCalls);
  assert.equal(record.resource.group.children.length, 0);
  assert.equal(record.resource.group.parent, null);
}

test('all buildings and the resident remain visible after StrictMode setup-cleanup-setup and dispose fully on final unmount', () => {
  const projects = ARCHITECT_KINDS.map((kind, index) => ({
    id: `lifecycle-${kind}`, createdAt: Date.now(),
    plan: { version: 1, name: kind, description: 'lifecycle fixture', plotId: ARCHITECT_PLOTS[index].id, kind, palette: 'coastal', orientation: 90 },
  }));
  const harness = strictWorldHarness({ projects, reducedMotion: true, viewMode: 'follow' });
  assert.equal(meshes(harness.scene).length, 0, 'resources mount in the effect, not in render');
  harness.setup(); harness.frame();
  assert.equal(harness.resources.length, 7);
  const first = harness.resources.slice(), firstMeshes = meshes(harness.scene);
  assert.equal(firstMeshes.length, first.reduce((sum, record) => sum + record.resource.stats.drawCalls, 0));
  assert.ok(firstMeshes.length > 20);
  assert.equal(first.filter(record => record.name === 'createArchitectResident').length, 1);
  const hosts = first.map(record => record.resource.group.parent);
  assert.ok(hosts.every(host => host?.isGroup && host.children.length === 1));
  harness.cleanup();
  assert.equal(meshes(harness.scene).length, 0); first.forEach(disposed);

  harness.setup(); harness.frame();
  assert.equal(harness.resources.length, 14, 'second setup creates fresh resources, never reuses cleared meshes');
  const second = harness.resources.slice(7), secondMeshes = meshes(harness.scene);
  assert.equal(secondMeshes.length, firstMeshes.length);
  for (let index = 0; index < second.length; index++) {
    const record = second[index];
    assert.equal(record.resource.group.parent, hosts[index], 'the same React host is reused safely');
    assert.notEqual(record.resource.group, first[index].resource.group);
    assert.equal(record.geometryDisposed, 0); assert.equal(record.materialDisposed, 0);
    assert.equal(hosts[index].children.length, 1, 'replay does not attach duplicates');
    assert.equal(hosts[index].scale.y, 1);
  }
  assert.ok(secondMeshes.every(mesh => !firstMeshes.includes(mesh) && mesh.geometry.attributes.position.count > 0));
  harness.cleanup();
  assert.equal(meshes(harness.scene).length, 0);
  second.forEach(disposed); first.forEach(disposed);
  assert.ok(hosts.every(host => host.children.length === 0));
});

test('the architect resident alone survives the same replay before the first project has been generated', () => {
  const harness = strictWorldHarness({ projects: [], reducedMotion: false, viewMode: 'overview' });
  harness.setup();
  assert.equal(harness.resources.length, 1);
  const count = meshes(harness.scene).length; assert.ok(count > 0);
  harness.cleanup(); assert.equal(meshes(harness.scene).length, 0);
  harness.setup();
  assert.equal(harness.resources.length, 2); assert.equal(meshes(harness.scene).length, count);
  assert.equal(harness.resources[1].name, 'createArchitectResident');
  assert.notEqual(harness.resources[0].resource.group, harness.resources[1].resource.group);
  harness.cleanup(); harness.resources.forEach(disposed);
});
