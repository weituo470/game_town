import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GPT_PARK, GPT_BRIDGE, GPT_ARRIVAL, inGptGround } from '../shared/gpt-park.js';
import { GPT_GROUND_LAYERS, GPT_BRIDGE_SURFACE, GPT_GARDEN_BEDS } from '../src/components/town/gptParkSurfaces.js';

const epsilon = 1e-8;
const bounds = block => block.at.map((value, axis) => [value - block.size[axis] / 2, value + block.size[axis] / 2]);
const overlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
const footprintContains = (block, x, z) => {
  const b = bounds(block);
  return x >= b[0][0] - epsilon && x <= b[0][1] + epsilon && z >= b[2][0] - epsilon && z <= b[2][1] + epsilon;
};

// Ignore opposite-facing internal joining faces. Equal, outward-facing planes
// with a positive shared area are the z-fighting failure this regression guards.
function duplicatedOuterFaces(a, b) {
  const aa = bounds(a), bb = bounds(b), result = [];
  for (let axis = 0; axis < 3; axis++) for (const side of [0, 1]) {
    const tangents = [0, 1, 2].filter(i => i !== axis);
    if (Math.abs(aa[axis][side] - bb[axis][side]) < epsilon &&
      tangents.every(i => overlap(aa[i], bb[i]) > epsilon)) result.push({ axis, side });
  }
  return result;
}

test('GPT surface guard detects the old island top, wall and bridge duplicates', () => {
  const oldBase = { at: [38, -0.67, -58], size: [32, 1.34, 28] };
  const oldCap = { at: [38, -0.18, -58], size: [32, 0.36, 28] };
  const oldBridge = { at: [38, -0.25, -41], size: [7, 0.5, 8] };
  assert.deepEqual(duplicatedOuterFaces(oldBase, oldCap), [
    { axis: 0, side: 0 }, { axis: 0, side: 1 }, { axis: 1, side: 1 }, { axis: 2, side: 0 }, { axis: 2, side: 1 },
  ]);
  assert.ok(duplicatedOuterFaces(oldCap, oldBridge).some(face => face.axis === 1 && face.side === 1));
});

test('GPT foundation and stone cap have no duplicated exterior faces or overlapping volumes', () => {
  const [base, cap] = GPT_GROUND_LAYERS;
  assert.deepEqual(duplicatedOuterFaces(base, cap), []);
  assert.ok(overlap(bounds(base)[1], bounds(cap)[1]) <= epsilon);
  assert.equal(bounds(base)[1][0], -1.34);
  assert.equal(bounds(cap)[1][1], 0, 'original walk plane stays at zero');
  assert.ok(Math.abs(bounds(base)[1][1] - bounds(cap)[1][0]) < epsilon, 'stone fascia still meets foundation');
  for (const layer of GPT_GROUND_LAYERS) {
    assert.equal(layer.at[0], GPT_PARK.x); assert.equal(layer.at[2], GPT_PARK.z);
    assert.equal(layer.size[0], GPT_PARK.width); assert.equal(layer.size[2], GPT_PARK.depth);
  }
});

test('GPT bridge rendering meets the island without a coplanar overlap or a navigation gap', () => {
  const cap = GPT_GROUND_LAYERS[1], bridge = GPT_BRIDGE_SURFACE;
  assert.deepEqual(duplicatedOuterFaces(cap, bridge), []);
  assert.equal(bounds(cap)[2][1], bounds(bridge)[2][0]);
  assert.equal(bounds(bridge)[1][1], 0);
  assert.equal(bridge.size[0], GPT_BRIDGE.width);
  assert.ok(footprintContains(cap, GPT_ARRIVAL.x, GPT_ARRIVAL.z) || footprintContains(bridge, GPT_ARRIVAL.x, GPT_ARRIVAL.z));
  for (let x = 21; x <= 55; x += 0.25) for (let z = -73; z <= -36; z += 0.25) {
    const rendered = footprintContains(cap, x, z) || footprintContains(bridge, x, z);
    assert.equal(rendered, inGptGround(x, z), `footprint ${x},${z}`);
  }
});

test('GPT garden corner surfaces have no overlapping same-height top or side planes', () => {
  for (let i = 0; i < GPT_GARDEN_BEDS.length; i++) for (const other of GPT_GARDEN_BEDS.slice(i + 1)) {
    const bed = GPT_GARDEN_BEDS[i];
    assert.deepEqual(duplicatedOuterFaces(bed, other), [], `${bed.name}/${other.name}`);
  }
  for (const bed of GPT_GARDEN_BEDS) {
    const b = bounds(bed);
    assert.ok(b[0][0] >= GPT_PARK.x - GPT_PARK.width / 2 && b[0][1] <= GPT_PARK.x + GPT_PARK.width / 2);
    assert.ok(b[2][0] >= GPT_PARK.z - GPT_PARK.depth / 2 && b[2][1] <= GPT_PARK.z + GPT_PARK.depth / 2);
  }
  const original = [
    ...[-1, 1].map(side => ({ at: [38 + side * 14.15, 0.016, -58], size: [2.6, 0.04, 24.5] })),
    { at: [38, 0.016, -70.15], size: [27.5, 0.04, 2.7] },
  ];
  for (let x = 22; x <= 54; x += 0.2) for (let z = -72; z <= -44; z += 0.2) {
    assert.equal(GPT_GARDEN_BEDS.some(bed => footprintContains(bed, x, z)),
      original.some(bed => footprintContains(bed, x, z)), `garden footprint ${x},${z}`);
  }
});

test('shared town GPT renderer uses stable construction surfaces without disabling its architecture or motion', () => {
  const source = fs.readFileSync(new URL('../src/components/town/GptPark.jsx', import.meta.url), 'utf8');
  assert.match(source, /GPT_GROUND_LAYERS\.map/);
  assert.match(source, /<Block \{\.\.\.GPT_BRIDGE_SURFACE\}/);
  assert.match(source, /GPT_GARDEN_BEDS\.map/);
  assert.match(source, /transparent=\{opacity < 1\} opacity=\{opacity\} depthWrite=\{opacity >= 1\}/);
  for (const component of ['InspirationKnot', 'InspirationStream', 'Promenade', 'GardenTrees', 'GardenBorders', 'Entrance']) {
    assert.match(source, new RegExp(`<${component}[ />]`));
  }
  assert.doesNotMatch(source, /polygonOffset|depthTest=\{false\}|renderOrder=/, 'fix geometry rather than force draw order');
});
