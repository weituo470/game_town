import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithEsbuild } from 'vite';
import * as dayNight from '../shared/dayNight.js';

const require = createRequire(new URL('../src/components/town/TownEnvironment.jsx', import.meta.url));
const source = fs.readFileSync(new URL('../src/components/town/TownEnvironment.jsx', import.meta.url), 'utf8');
const compiled = await transformWithEsbuild(source, 'TownEnvironment.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
const React = require('react');
const frameCallbacks = [], warnings = [], paths = [];
const Environment = props => React.createElement('span', { 'data-environment': props.files });
const module = { exports: {} };
vm.runInNewContext(compiled.code, {
  module, exports: module.exports,
  console: { warn: (...args) => warnings.push(args) },
  require(id) {
    if (id === '@react-three/fiber') return { useFrame: callback => frameCallbacks.push(callback) };
    if (id === '@react-three/drei') return { Environment };
    if (id === '../../../shared/dayNight.js') return dayNight;
    if (id === '../../lib/appUrl.js') return { appUrl: path => { paths.push(path); return `/test-base${path}`; } };
    return require(id);
  },
});
const TownEnvironment = module.exports.default;

function mount(timeRef = { current: 0 }) {
  frameCallbacks.length = 0; warnings.length = 0; paths.length = 0;
  const node = TownEnvironment({ timeRef });
  return { node, boundary: new node.type(node.props), frame: frameCallbacks[0] };
}

test('town environment: default interface wraps only the optional HDR and retains deployment base', () => {
  const { node } = mount();
  assert.equal(typeof node.type.getDerivedStateFromError, 'function');
  assert.equal(node.props.children.type, Environment);
  assert.equal(node.props.children.props.files, '/test-base/wonders/coastal-sky.hdr');
  assert.equal(node.props.children.props.background, false);
  assert.equal(node.props.children.props.environmentIntensity, 0.5);
  assert.deepEqual(paths, ['/wonders/coastal-sky.hdr']);
  assert.equal(frameCallbacks.length, 1);
});

test('town environment: healthy boundary renders its child without a wrapper or fallback', () => {
  const { node, boundary } = mount();
  assert.equal(boundary.state.failed, false);
  assert.equal(boundary.render(), node.props.children);
  assert.equal(renderToStaticMarkup(node), '<span data-environment="/test-base/wonders/coastal-sky.hdr"></span>');
  assert.equal(warnings.length, 0);
});

test('town environment: failed fetch/decode state renders null instead of propagating an HDR child', () => {
  const { node, boundary } = mount();
  const error = new Error('HDR decode failed');
  const nextState = node.type.getDerivedStateFromError(error);
  assert.equal(nextState.failed, true);
  boundary.state = { ...boundary.state, ...nextState };
  assert.equal(boundary.render(), null);
  // Rerenders remain safely disabled, rather than retrying a failing asset per frame.
  boundary.props = { children: React.createElement('span', null, 'replacement') };
  assert.equal(boundary.render(), null);
});

test('town environment: failure warns once and does not misdiagnose WebGL or GPU failure', () => {
  const { boundary } = mount();
  const error = new Error('404 coastal-sky.hdr');
  boundary.componentDidCatch(error);
  boundary.componentDidCatch(error);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /可选 HDR.*跳过环境反射/);
  assert.match(warnings[0][0], /天空、灯光和小镇场景继续运行/);
  assert.doesNotMatch(warnings[0][0], /WebGL|GPU|硬件加速/);
  assert.equal(warnings[0][1], error);
});

test('town environment: HDR failure leaves sky, lighting and shared day/night frame updates intact', () => {
  const timeRef = { current: 0 }, { node, boundary, frame } = mount(timeRef);
  const environment = {}, background = {}, lights = [{}], fog = {};
  const scene = { environment, background, children: lights, fog, environmentIntensity: 1 };
  boundary.state = { ...boundary.state, ...node.type.getDerivedStateFromError(new Error('HDR unavailable')) };
  assert.equal(boundary.render(), null);
  frame({ scene });
  assert.equal(scene.environmentIntensity, 0.5);
  timeRef.current = 450000; frame({ scene });
  assert.equal(scene.environmentIntensity, 0.12);
  timeRef.current = NaN; frame({ scene });
  assert.ok(Number.isFinite(scene.environmentIntensity));
  assert.equal(scene.environment, environment);
  assert.equal(scene.background, background);
  assert.equal(scene.children, lights);
  assert.equal(scene.fog, fog);
  assert.equal(warnings.length, 0, 'frame updates do not produce repeated warnings');
});
