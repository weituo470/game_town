import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as React from 'react';
import * as THREE from 'three';
import { WONDER_CYCLE_MS, sampleOrca } from '../shared/wonders.js';
import { sampleDayNight } from '../shared/dayNight.js';
import { LAGOON_WATER, LAGOON_CONTACTS, createLagoonWaterState, sampleLagoonWater, lagoonEdgeMask, sampleLagoonHeight, sampleLagoonNormal } from '../shared/lagoonWater.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('lagoon water: twelve contacts come from the real two whales, including six stronger landings', () => {
  assert.equal(LAGOON_CONTACTS.length, 12);
  assert.equal(LAGOON_CONTACTS.filter(event => event.landing).length, 6);
  for (const event of LAGOON_CONTACTS) {
    const pose = sampleOrca(event.time, event.index);
    near(event.x, pose.x); near(event.z, pose.z);
    near(pose.y, LAGOON_WATER.y + (event.index === 0 ? .59 : .56) * .72, .00001);
    const before = sampleOrca(event.time - 10, event.index), after = sampleOrca(event.time + 10, event.index);
    assert.equal(before.y > after.y, event.landing);
    assert.equal(event.strength, event.landing ? .16 : .06);
    assert.ok(lagoonEdgeMask(event.x, event.z) > .99);
  }
});

test('lagoon water: absolute sampling survives pause, backward seek, wrap and invalid times without history', () => {
  const reused = createLagoonWaterState(), whales = reused.whales, impacts = reused.impacts;
  for (const time of [0, 12000, 12400, 12400, 32000, 9000, -1000, 179999, 180000, NaN, Infinity, undefined]) {
    assert.equal(sampleLagoonWater(time, false, reused), reused);
    assert.deepEqual(reused, sampleLagoonWater(time));
    assert.equal(reused.whales, whales); assert.equal(reused.impacts, impacts);
  }
  for (let time = 0; time < WONDER_CYCLE_MS; time += 41) {
    const sample = sampleLagoonWater(time);
    assert.deepEqual(sample, sampleLagoonWater(time + WONDER_CYCLE_MS));
    assert.equal(sample.impacts.length, 4);
    assert.ok(sample.impacts.every(event => event.every(Number.isFinite)));
  }
});

test('lagoon water: V-shaped wake follows each real heading and vanishes when the whale clears the water', () => {
  const state = sampleLagoonWater(0), baseline = structuredClone(state);
  baseline.whales.forEach(whale => { whale[3] = 0; });
  state.whales[1][3] = 0;
  const [x, z, yaw] = state.whales[0], along = 3;
  let rearEnergy = 0, aheadEnergy = 0;
  for (let across = -2.4; across <= 2.4; across += .1) {
    const at = distance => [x + Math.sin(yaw) * distance + Math.cos(yaw) * across, z + Math.cos(yaw) * distance - Math.sin(yaw) * across];
    const rear = at(along), ahead = at(-along);
    rearEnergy += Math.abs(sampleLagoonHeight(...rear, state) - sampleLagoonHeight(...rear, baseline));
    aheadEnergy += Math.abs(sampleLagoonHeight(...ahead, state) - sampleLagoonHeight(...ahead, baseline));
  }
  assert.ok(rearEnergy > .1, `actual V wake must move the surface, energy=${rearEnergy}`);
  assert.ok(aheadEnergy < rearEnergy * .001, 'wake belongs behind the moving animal, not in front');
  const airborne = sampleLagoonWater(10100);
  assert.equal(airborne.whales[0][3], 0); assert.equal(airborne.whales[1][3], 0);
});

test('lagoon water: impact crests propagate outward, form several rings and decay rather than remain painted circles', () => {
  const baseline = createLagoonWaterState(), state = createLagoonWaterState();
  state.impacts[0] = [LAGOON_WATER.x, LAGOON_WATER.z, 0, .16];
  const peaks = [];
  for (const age of [.5, 1.5, 2.5]) {
    state.impacts[0][2] = age;
    let peak = { radius: 0, value: 0 }, crossings = 0, last = 0;
    for (let radius = 0; radius < 6; radius += .025) {
      const value = sampleLagoonHeight(LAGOON_WATER.x + radius, LAGOON_WATER.z, state) - sampleLagoonHeight(LAGOON_WATER.x + radius, LAGOON_WATER.z, baseline);
      if (Math.abs(value) > peak.value) peak = { radius, value: Math.abs(value) };
      if (value * last < 0 && Math.abs(value) > .001) crossings++;
      last = value;
    }
    assert.ok(crossings >= 3, 'several positive and negative wave fronts, not a single disk');
    peaks.push(peak);
  }
  assert.ok(peaks[1].radius > peaks[0].radius + 1.1);
  assert.ok(peaks[2].radius > peaks[1].radius + 1.1);
  assert.ok(peaks[2].value < peaks[0].value * .65, 'outgoing wave energy attenuates');
  state.impacts[0][2] = LAGOON_WATER.impactLifetime;
  near(sampleLagoonHeight(-64, 19, state), sampleLagoonHeight(-64, 19, baseline));
  const landing = LAGOON_CONTACTS.find(event => event.landing);
  const real = sampleLagoonWater(landing.time + 1800);
  assert.ok(real.impacts.some(event => event[3] === landing.strength && Math.abs(event[2] - 1.8) < 1e-6));
});

test('lagoon water: displaced surface stays within the original elliptical wall and above the deepened bed', () => {
  let max = 0;
  for (let time = 0; time < 37000; time += 317) {
    const state = sampleLagoonWater(time);
    for (let ring = 0; ring <= 12; ring++) for (let angle = 0; angle < Math.PI * 2; angle += .19) {
      const radius = ring / 10, x = -64 + Math.cos(angle) * 8.45 * radius, z = 19 + Math.sin(angle) * 7.45 * radius;
      const height = sampleLagoonHeight(x, z, state);
      assert.ok(Number.isFinite(height));
      assert.ok(Math.abs(height) <= LAGOON_WATER.maxDisplacement);
      assert.ok(LAGOON_WATER.y + height > -.4 + .2, 'no trough exposes the physical island bed');
      if (radius >= 1) near(height, 0, 1e-12);
      max = Math.max(max, Math.abs(height));
    }
  }
  assert.ok(max > .07, 'not merely a colour animation: landing waves have measurable geometry');
});

test('lagoon water: changing heights produce normalized real surface normals; reduced motion is perfectly still', () => {
  for (const time of [0, 9000, 11700, 13100, 21500, 32000]) {
    const state = sampleLagoonWater(time), normal = sampleLagoonNormal(-63.5, 18.2, state);
    near(Math.hypot(...normal), 1); assert.ok(normal[1] > .5);
    assert.ok(Math.abs(normal[0]) + Math.abs(normal[2]) > .002);
  }
  const reference = sampleLagoonWater(0, true);
  for (const time of [0, 9000, 11700, 13100, 21500, 32000, 179999]) {
    const state = sampleLagoonWater(time, true);
    assert.deepEqual(state, reference);
    assert.equal(sampleLagoonHeight(-63.5, 18.2, state), 0);
    assert.deepEqual(sampleLagoonNormal(-63.5, 18.2, state), [-0, 1, -0]);
    assert.equal(state.impacts.some(event => event[3] > 0), false);
  }
});

const file = new URL('../src/components/town/TownWater.jsx', import.meta.url), require = createRequire(file);
const compiled = await transformWithEsbuild(fs.readFileSync(file, 'utf8'), 'TownWater.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
function mount(options = {}) {
  const frames = [], module = { exports: {} };
  vm.runInNewContext(compiled.code, { module, exports: module.exports, require(id) {
    if (id === 'react') return { ...React, useMemo: fn => fn(), useRef: current => ({ current }) };
    if (id === '@react-three/fiber') return { useFrame: fn => frames.push(fn) };
    return require(id);
  } });
  const timeRef = { current: 12000 }, lightTimeRef = { current: 45000 };
  const root = module.exports.default({ pool: true, timeRef, lightTimeRef, ...options });
  const children = React.Children.toArray(root.props.children), geometryNode = children.find(node => /Geometry$/.test(node.type)), materialNode = children.find(node => node.type === 'shaderMaterial');
  const geometry = new THREE[geometryNode.type[0].toUpperCase() + geometryNode.type.slice(1)](...geometryNode.props.args);
  const material = new THREE.ShaderMaterial({ uniforms: materialNode.props.uniforms, vertexShader: materialNode.props.vertexShader, fragmentShader: materialNode.props.fragmentShader });
  materialNode.props.ref.current = material;
  return { root, geometry, material, timeRef, lightTimeRef, frame() { frames.forEach(fn => fn()); }, dispose() { geometry.dispose(); material.dispose(); } };
}

test('lagoon water render: a single 2,993-vertex radial mesh really displaces world Y and uses those slopes for reflections', () => {
  const app = mount(), mesh = new THREE.Mesh(app.geometry, app.material);
  mesh.position.set(...app.root.props.position); mesh.rotation.set(...app.root.props.rotation); mesh.scale.set(...app.root.props.scale); mesh.updateMatrixWorld();
  const box = new THREE.Box3().setFromObject(mesh);
  near(box.min.x, -72.45, 1e-5); near(box.max.x, -55.55, 1e-5); near(box.min.z, 11.55, 1e-5); near(box.max.z, 26.45, 1e-5);
  near(box.min.y, -.025, 1e-5);
  assert.equal(app.geometry.attributes.position.count, 2993);
  assert.ok(app.geometry.index.count <= 18000, 'fixed mobile-safe single draw call, no per-wave meshes');
  assert.match(app.material.vertexShader, /p\.y\+=waveHeight/);
  assert.match(app.material.fragmentShader, /normalize\(waveNormal\)/);
  assert.match(app.material.fragmentShader, /reflect\(-v,n\)/);
  app.frame();
  const expected = sampleLagoonWater(app.timeRef.current);
  assert.deepEqual(Array.from(app.material.uniforms.whales.value, value => value.toArray()), expected.whales);
  assert.deepEqual(Array.from(app.material.uniforms.impacts.value, value => value.toArray()), expected.impacts);
  let geometriesDisposed = 0, materialsDisposed = 0;
  app.geometry.addEventListener('dispose', () => geometriesDisposed++); app.material.addEventListener('dispose', () => materialsDisposed++);
  app.dispose(); assert.equal(geometriesDisposed, 1); assert.equal(materialsDisposed, 1);
  const remounted = mount(); remounted.frame();
  assert.notEqual(remounted.geometry, app.geometry); assert.notEqual(remounted.material, app.material);
  assert.deepEqual(Array.from(remounted.material.uniforms.impacts.value, value => value.toArray()), expected.impacts);
  remounted.dispose();
});

test('lagoon water render: lighting previews do not move waves and pause/backward seek faithfully replace every uniform', () => {
  const app = mount(); app.frame();
  const before = Array.from(app.material.uniforms.impacts.value, value => value.toArray());
  for (const lightTime of [0, 45000, 90000, 135000]) {
    app.lightTimeRef.current = lightTime; app.frame();
    assert.equal(app.material.uniforms.daylight.value, sampleDayNight(lightTime).daylight);
    assert.deepEqual(Array.from(app.material.uniforms.impacts.value, value => value.toArray()), before);
    assert.equal(app.material.uniforms.time.value, 12);
  }
  for (const time of [12000, 27000, 1000, 12000]) {
    app.timeRef.current = time; app.frame();
    assert.deepEqual(Array.from(app.material.uniforms.impacts.value, value => value.toArray()), sampleLagoonWater(time).impacts);
  }
  app.dispose();
});

test('lagoon water render: reduced motion zeros geometry and impact uniforms while the common ocean remains untouched', () => {
  const still = mount({ reducedMotion: true }); still.frame();
  assert.equal(still.material.uniforms.motion.value, 0); assert.equal(still.material.uniforms.time.value, 0);
  assert.ok(still.material.uniforms.impacts.value.every(value => value.w === 0)); still.dispose();
  const sea = mount({ pool: false }); sea.frame();
  assert.equal(sea.root.props.name, 'shared-town-sea');
  assert.deepEqual(Array.from(sea.root.props.position), [0, -1.28, -16]);
  assert.equal(sea.geometry.parameters.width, 900); assert.equal(sea.geometry.parameters.height, 900);
  assert.equal(sea.material.uniforms.time.value, 12);
  assert.equal(sea.material.uniforms.whales, undefined);
  assert.doesNotMatch(sea.material.vertexShader, /waterHeight|waveNormal/); sea.dispose();
});
