import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { transformWithEsbuild } from 'vite';
import * as dayNight from '../shared/dayNight.js';
import * as island from '../shared/realistic-island.js';
import * as metro from '../shared/metro-island.js';
import * as world from '../shared/world.js';
import { DAY_NIGHT_CYCLE_MS, sampleDayNight } from '../shared/dayNight.js';

const skySource = fs.readFileSync(new URL('../src/components/town/TownSky.jsx', import.meta.url), 'utf8');
const compiledSky = await transformWithEsbuild(skySource, 'TownSky.jsx', { loader: 'jsx', format: 'cjs' });
const skyModule = { exports: {} };
vm.runInNewContext(compiledSky.code, {
  module: skyModule, exports: skyModule.exports,
  require(id) {
    if (id === 'three') return THREE;
    if (id === '../../../shared/dayNight.js') return dayNight;
    if (id === '../../../shared/realistic-island.js') return island;
    if (id === '../../../shared/metro-island.js') return metro;
    if (id === '../../../shared/world.js') return world;
    if (id === 'react' || id === '@react-three/fiber') return {};
    throw new Error(`Unexpected import ${id}`);
  },
});
const { createSkyUniforms, updateSkyMaterial } = skyModule.exports;

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);

test('demo day is 900 seconds, starting at noon', () => {
  assert.equal(DAY_NIGHT_CYCLE_MS, 900_000);
  const noon = sampleDayNight(0);
  assert.equal(noon.phase, 0);
  assert.equal(noon.label, '白天');
  assert.equal(noon.daylight, 1);
  assert.equal(noon.nightOpacity, 0);
  assert.equal(noon.sunVisibility, 1);
  assert.equal(noon.moonVisibility, 0);
});

test('quarter phases identify sunset, midnight and sunrise', () => {
  assert.equal(sampleDayNight(150_000).label, '黄昏');
  const midnight = sampleDayNight(450_000);
  assert.equal(midnight.label, '夜晚');
  assert.equal(midnight.daylight, 0);
  assert.equal(midnight.nightOpacity, 1);
  assert.equal(midnight.sunVisibility, 0);
  assert.equal(midnight.moonVisibility, 1);
  assert.equal(sampleDayNight(750_000).label, '黎明');
});

test('clock wrapping, negative offsets and invalid input are safe', () => {
  assert.deepEqual(sampleDayNight(900_000), sampleDayNight(0));
  assert.deepEqual(sampleDayNight(-450_000), sampleDayNight(450_000));
  assert.deepEqual(sampleDayNight(12_345 + 900_000 * 100), sampleDayNight(12_345));
  for (const invalid of [NaN, Infinity, -Infinity, undefined, null, '90000']) {
    assert.deepEqual(sampleDayNight(invalid), sampleDayNight(0));
  }
});

test('celestial directions stay normalized, opposite and finite for the full cycle', () => {
  for (let ms = 0; ms <= DAY_NIGHT_CYCLE_MS; ms += 100) {
    const state = sampleDayNight(ms);
    close(Math.hypot(...state.sunDirection), 1);
    close(Math.hypot(...state.moonDirection), 1);
    state.sunDirection.forEach((axis, i) => close(axis, -state.moonDirection[i]));
    assert.ok(state.phase >= 0 && state.phase < 1);
    for (const name of ['daylight', 'nightOpacity', 'twilight', 'sunVisibility', 'moonVisibility', 'lampIntensity']) {
      assert.ok(Number.isFinite(state[name]) && state[name] >= 0 && state[name] <= 1, `${name} out of range at ${ms}`);
    }
  }
});

test('midnight moon takes the visible noon sun position', () => {
  sampleDayNight(0).sunDirection.forEach((axis, i) => close(axis, sampleDayNight(450_000).moonDirection[i]));
  assert.ok(sampleDayNight(0).sunDirection[1] > 0);
  assert.ok(sampleDayNight(450_000).sunDirection[1] < 0);
});

test('the lighting continuously fades at dawn, dusk and loop boundary', () => {
  for (const ms of [0, 150_000, 450_000, 750_000, 900_000]) {
    const before = sampleDayNight(ms - 1), after = sampleDayNight(ms + 1);
    for (const key of ['daylight', 'nightOpacity', 'twilight', 'ambientIntensity', 'hemisphereIntensity', 'sunIntensity', 'moonIntensity', 'lampIntensity']) {
      close(before[key], after[key], 0.002);
    }
  }
});

test('night remains navigable while sun lights fade and lamps brighten', () => {
  const noon = sampleDayNight(0), midnight = sampleDayNight(450_000);
  assert.ok(midnight.ambientIntensity >= 0.3);
  assert.ok(midnight.hemisphereIntensity >= 0.8);
  assert.ok(midnight.moonIntensity >= 0.6);
  assert.equal(midnight.sunIntensity, 0);
  assert.equal(noon.moonIntensity, 0);
  assert.ok(midnight.lampIntensity > noon.lampIntensity * 5);
});

test('sample is deterministic and returned vectors do not share mutable state', () => {
  const sample = sampleDayNight(66_666);
  sample.sunDirection[0] = 100;
  assert.notEqual(sampleDayNight(66_666).sunDirection[0], 100);
  assert.deepEqual(sampleDayNight(66_666), sampleDayNight(66_666));
});

test('sky is a depth-free backdrop with both real first-person and overview projections', () => {
  const source = fs.readFileSync(new URL('../src/components/town/TownSky.jsx', import.meta.url), 'utf8');
  assert.match(source, /depthWrite=\{false\}/);
  assert.match(source, /userData=\{\{ isSky: true \}\}/);
  assert.match(source, /camera\.isOrthographicCamera/);
  assert.match(source, /viewWorld \* vec4/);
  assert.match(source, /moonDisk/);
  assert.match(source, /sunDisk/);
  assert.match(source, /craters/);
  assert.match(source, /float clouds/);
  assert.match(source, /star \* shimmer \* nightOpacity/);
  assert.match(source, /reducedMotion \? 0 : clock\.elapsedTime/);
  assert.doesNotMatch(source, /setState|useState|Math\.random/);
});

test('postprocessing preserves the sky and excludes it from depth AO', () => {
  const source = fs.readFileSync(new URL('../src/components/town/SceneEffects.jsx', import.meta.url), 'utf8');
  assert.match(source, /object\.userData\?\.isSky/);
  assert.doesNotMatch(source, /scene\.background\s*=|duskBackdrop/);
  assert.match(fs.readFileSync(new URL('../src/components/town/GardenFireflies.jsx', import.meta.url), 'utf8'), /glow \* nightOpacity/);
});

test('scenery no longer owns global illumination and clones animated batch materials', () => {
  const source = fs.readFileSync(new URL('../src/components/DuskScenery.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<(ambientLight|hemisphereLight|directionalLight|fog|color)\b/);
  assert.match(source, /MATERIAL\.lamp\.clone\(\)/);
  assert.match(source, /materials\.lamp\.dispose\(\)/);
  assert.match(source, /MATERIAL\.glow\.clone\(\)/);
  assert.match(source, /materials\.glow\.dispose\(\)/);
  assert.match(source, /cycle\.lampIntensity/);
});

test('sky updates live material wrappers after React reconciliation clones the initial uniform props', () => {
  const initialProps = createSkyUniforms();
  const material = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(initialProps) });
  const frame = { camera: new THREE.PerspectiveCamera(70, 1.8, 0.08, 420), size: { width: 1280, height: 720 }, clock: { elapsedTime: 42 } };
  updateSkyMaterial(material, frame, sampleDayNight(450_000), false);
  assert.equal(material.uniforms.daylight.value, 0);
  assert.equal(material.uniforms.nightOpacity.value, 1);
  assert.equal(material.uniforms.sunVisibility.value, 0);
  assert.equal(material.uniforms.moonVisibility.value, 1);
  assert.equal(material.uniforms.orthographicView.value, 0);
  assert.equal(material.uniforms.animationTime.value, 42);
  assert.equal(initialProps.daylight.value, 1, 'must not rely on initial props alias');
  assert.equal(initialProps.nightOpacity.value, 0);

  const staleUniforms = material.uniforms;
  material.uniforms = THREE.UniformsUtils.clone(initialProps);
  updateSkyMaterial(material, frame, sampleDayNight(450_000), true);
  assert.equal(material.uniforms.nightOpacity.value, 1, 'must resolve the live object again after replacement');
  assert.equal(material.uniforms.animationTime.value, 0);
  updateSkyMaterial(material, frame, sampleDayNight(0), false);
  assert.equal(material.uniforms.daylight.value, 1);
  assert.equal(material.uniforms.nightOpacity.value, 0);
  assert.equal(staleUniforms.nightOpacity.value, 1, 'old material uniform wrappers must stay untouched');
  assert.match(skySource, /updateSkyMaterial\(material\.current/);
  assert.match(skySource, /<shaderMaterial ref=\{material\}/);
  material.dispose();
});
