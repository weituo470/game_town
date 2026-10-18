import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as river from '../shared/river.js';
import * as surfaces from '../src/components/town/riverSurfaces.js';
import * as outdoor from '../src/minigames/outdoor.js';

const require = createRequire(import.meta.url);
const React = require('react');

async function loadComponent(filename, dependencies = {}) {
  const source = fs.readFileSync(new URL(`../src/components/town/${filename}`, import.meta.url), 'utf8');
  const compiled = await transformWithEsbuild(source, filename, { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
  const frames = [], module = { exports: {} };
  vm.runInNewContext(compiled.code, {
    module, exports: module.exports,
    require(id) {
      if (id === 'react') return { ...React, useMemo: factory => factory(), useRef: current => ({ current }), useLayoutEffect() {} };
      if (id === '@react-three/fiber') return { useFrame: callback => frames.push(callback) };
      if (id === '@react-three/drei') return { Html: 'html-label' };
      if (id === '../../../shared/river.js') return river;
      if (id === './riverSurfaces.js') return surfaces;
      if (id === '../../minigames/outdoor.js') return outdoor;
      if (dependencies[id]) return dependencies[id];
      return require(id);
    },
  });
  return { Component: module.exports.default, frames };
}

const bank = await loadComponent('Riverbank.jsx');
const scenery = await loadComponent('OutdoorScenery.jsx', { './Riverbank.jsx': { default: bank.Component } });
const children = node => React.Children.toArray(node.props.children);
const named = (node, name) => children(node).find(child => child.props.name === name);
const material = node => children(node).find(child => typeof child.type === 'string' && child.type.endsWith('Material'));

function flow(reducedMotion = false) {
  bank.frames.length = 0;
  const tree = bank.Component({ reducedMotion });
  const component = children(tree).find(child => child.type.name === 'RiverFlow');
  const node = component.type(component.props);
  const fish = named(node, 'river-fish-silhouettes'), streaks = named(node, 'river-flow-streaks');
  for (const mesh of [fish, streaks]) {
    mesh.props.ref.current = {
      matrices: [], instanceMatrix: {},
      setMatrixAt(index, matrix) { this.matrices[index] = matrix.clone(); },
    };
  }
  return { fish, streaks, frame: bank.frames[0] };
}

test('fishing surfaces: riverbed has real clearance below water, with no sea intersection', () => {
  const tree = bank.Component({ reducedMotion: false });
  const bedComponent = named(tree, 'riverbed');
  const bed = bedComponent.type(bedComponent.props), water = named(tree, 'river-water');
  const bedHeight = children(bed).find(child => child.type === 'boxGeometry').props.args[1];
  const bedTop = bed.props.position[1] + bedHeight / 2;
  const bedBottom = bed.props.position[1] - bedHeight / 2;
  assert.ok(Math.abs(water.props.position[1] - bedTop - 0.32) < 1e-10);
  assert.ok(bedBottom > -1.28, 'riverbed remains above the original shared sea surface');
  assert.ok(bed.props.receiveShadow && bed.props.castShadow, 'preserve real lighting instead of hiding the fault');
});

test('fishing surfaces: shared water height and playable map footprint are unchanged', () => {
  const water = named(bank.Component({ reducedMotion: false }), 'river-water');
  assert.deepEqual(Array.from(water.props.position), [river.RIVER.x, river.RIVER.waterY, river.RIVER.z]);
  assert.deepEqual(Array.from(children(water).find(child => child.type === 'planeGeometry').props.args), [river.RIVER.width, river.RIVER.depth]);
  assert.equal(river.RIVER.waterY, -0.28);
  assert.ok(river.onRiverPier(river.FISHING_SPOT.x, river.FISHING_SPOT.z));
});

test('fishing surfaces: transparent water keeps shadows and depth testing without masking surface details', () => {
  const water = named(bank.Component({ reducedMotion: false }), 'river-water');
  const props = material(water).props;
  assert.equal(water.props.receiveShadow, true);
  assert.equal(props.transparent, true);
  assert.equal(props.opacity, 0.94);
  assert.equal(props.depthWrite, false);
  assert.notEqual(props.depthTest, false, 'pier and banks must still occlude the water');
});

test('fishing surfaces: water, fish, streaks and fishing ripples have stable transparent layer order', () => {
  const water = named(bank.Component({ reducedMotion: false }), 'river-water');
  const { fish, streaks } = flow();
  const tree = scenery.Component({ reducedMotion: false });
  const fishingComponent = children(tree).find(child => child.type.name === 'FishingProps');
  const fishing = fishingComponent.type(fishingComponent.props);
  const ripples = children(fishing).filter(node => children(node).some(child => child.type === 'ringGeometry'));
  assert.equal(ripples.length, 3);
  assert.ok(water.props.renderOrder < fish.props.renderOrder);
  assert.ok(fish.props.renderOrder < streaks.props.renderOrder);
  for (const ripple of ripples) {
    assert.ok(streaks.props.renderOrder < ripple.props.renderOrder);
    assert.ok(ripple.props.position[1] > river.RIVER.waterY);
  }
  for (const mesh of [fish, streaks, ...ripples]) {
    assert.equal(material(mesh).props.depthWrite, false);
    assert.notEqual(material(mesh).props.depthTest, false);
  }
});

test('fishing surfaces: moving fish and streaks remain visible above water and continue animating', () => {
  const { fish, streaks, frame } = flow();
  frame({ clock: { elapsedTime: 0 } });
  const initial = fish.props.ref.current.matrices[0].elements.slice();
  for (const time of [0.01, 1, 35, 10000]) {
    frame({ clock: { elapsedTime: time } });
    for (const [mesh, halfHeight] of [[fish, 0.012], [streaks, 0.004]]) {
      for (const matrix of mesh.props.ref.current.matrices) {
        assert.ok(matrix.elements.every(Number.isFinite));
        assert.ok(matrix.elements[13] - halfHeight >= river.RIVER.waterY - 1e-10);
      }
      assert.equal(mesh.props.ref.current.instanceMatrix.needsUpdate, true);
    }
  }
  assert.notDeepEqual(fish.props.ref.current.matrices[0].elements, initial);
});

test('fishing surfaces: reduced motion leaves the fixed layer geometry unchanged across frames', () => {
  const { fish, streaks, frame } = flow(true);
  frame({ clock: { elapsedTime: 0 } });
  const initial = [fish, streaks].map(mesh => mesh.props.ref.current.matrices.map(matrix => matrix.elements.slice()));
  frame({ clock: { elapsedTime: 999 } });
  const after = [fish, streaks].map(mesh => mesh.props.ref.current.matrices.map(matrix => matrix.elements.slice()));
  assert.deepEqual(after, initial);
});
