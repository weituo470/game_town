import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_DRONE_SHAPES, validateAiDroneScore } from '../shared/aiDroneScore.js';
import { createAiDroneProgram, updateAiDroneFleet } from '../shared/aiDroneShow.js';

const scene = (shape, extra = {}) => ({ name: 'Particle formation', description: 'A readable constellation of separate lights.', shape,
  color: '#40AAFF', accent: '#FFCC66', duration: 10, motion: 'still', transition: 'morph',
  ...(shape === 'outline' ? { paths: [[[-1, 0], [1, 0]], [[0, -1], [0, 1]]] } : {}), ...extra });
const score = (shapes = ['star', 'whale', 'ring', 'city'], extra = {}) => validateAiDroneScore({ version: 1, title: 'Particle spacing', synopsis: 'No provider call is needed for this fixture.', seed: 24681, scenes: shapes.map(shape => scene(shape)), ...extra });
function fleet(count = 4096) {
  const value = { count, positions: new Float32Array(count * 3), colors: new Float32Array(count * 3), sizes: new Float32Array(count), identities: new Uint16Array(count), bases: new Float32Array(count * 3) };
  for (let i = 0; i < count; i++) {
    const id = Math.floor(i * 4096 / count); value.identities[i] = id;
    value.bases[i * 3] = (id % 64 - 31.5) * .25; value.bases[i * 3 + 1] = .65; value.bases[i * 3 + 2] = (Math.floor(id / 64) - 31.5) * .25;
  }
  return value;
}
const lit = value => Array.from(value.sizes, (size, i) => size > .01 ? i : -1).filter(i => i >= 0);
function separation(value, planar = true) {
  const indices = lit(value); let closest = Infinity;
  for (let a = 0; a < indices.length; a++) for (let b = a + 1; b < indices.length; b++) {
    const i = indices[a] * 3, j = indices[b] * 3;
    closest = Math.min(closest, Math.hypot(value.positions[i] - value.positions[j], value.positions[i + 1] - value.positions[j + 1], planar ? 0 : value.positions[i + 2] - value.positions[j + 2]));
  }
  return closest;
}
function distanceToLit(value, x, y) {
  let nearest = Infinity;
  for (const index of lit(value)) nearest = Math.min(nearest, Math.hypot(x - value.positions[index * 3], y - value.positions[index * 3 + 1]));
  return nearest;
}
const maxDelta = (one, two) => one.reduce((largest, value, index) => Math.max(largest, Math.abs(value - two[index])), 0);

test('simple contours keep physical dark gaps instead of packing 4096 lights onto a tube', () => {
  for (const shape of ['star', 'heart', 'whale', 'bird', 'flower', 'mountain', 'city', 'outline']) {
    const source = score(Array(4).fill(shape));
    for (const count of [512, 1024, 2048, 4096]) {
      const value = fleet(count); updateAiDroneFleet(value, 17000, { score: source });
      assert.ok(separation(value) >= .8999, `${shape}/${count} needs separated luminous cores`);
      assert.ok(lit(value).length >= 80, `${shape}/${count} must remain recognizable`);
      assert.ok(value.sizes.every(size => size === 0 || Math.abs(size - .22) < 1e-6));
      if (count === 4096) assert.ok(lit(value).length < 1600, `${shape} must not use thousands of overlapping lights`);
      for (let i = 0; i < count; i++) if (value.sizes[i] === 0) assert.ok(value.colors.slice(i * 3, i * 3 + 3).every(channel => channel === 0));
    }
  }
});

test('star tips and every short outline detail survive spacing in low and high quality', () => {
  const starScore = score(Array(4).fill('star'));
  const detailScore = score(Array(4).fill('outline'), { scenes: Array.from({ length: 4 }, () => scene('outline', { paths: [
    [[-1, -.5], [1, -.5]], [[-.8, .3], [-.74, .3]], [[.65, .55], [.71, .55]], [[-.1, -.95], [-.1, -.89]],
  ] })) });
  for (const count of [512, 1024, 2048, 4096]) {
    const star = fleet(count); updateAiDroneFleet(star, 17000, { score: starScore });
    for (let point = 0; point < 10; point++) {
      const angle = Math.PI / 2 + point / 10 * Math.PI * 2, radius = point % 2 ? .39 : .96;
      assert.ok(distanceToLit(star, Math.cos(angle) * radius * 48, 72 + Math.sin(angle) * radius * 34) < 2.2, `star tip ${point} has no conspicuous hole at ${count}`);
    }
    const detail = fleet(count); updateAiDroneFleet(detail, 17000, { score: detailScore });
    for (const [x, y] of [[-.77, .3], [.68, .55], [-.1, -.92]]) assert.ok(distanceToLit(detail, x * 48, 72 + y * 34) < 1.6, `short detail retained at ${count}`);
  }
});

test('overlapping and reversed paths cannot double-stack light cores or depend on random sampling', () => {
  const paths = Array.from({ length: 6 }, (_, index) => index % 2 ? [[1, 0], [-1, 0]] : [[-1, 0], [1, 0]]);
  const source = score(Array(4).fill('outline'), { scenes: Array.from({ length: 4 }, () => scene('outline', { paths })) });
  const value = fleet(); updateAiDroneFleet(value, 17000, { score: source });
  assert.ok(lit(value).length >= 60 && lit(value).length <= 108);
  assert.ok(separation(value) >= .8999);
  for (let x = -47; x <= 47; x += .5) assert.ok(distanceToLit(value, x, 72) < 1.3, 'uniform line coverage, not random deletion');
  const snapshot = [value.positions.slice(), value.colors.slice(), value.sizes.slice()];
  updateAiDroneFleet(value, 48000, { score: source }); updateAiDroneFleet(value, 17000, { score: source });
  assert.deepEqual([value.positions, value.colors, value.sizes], snapshot);
});

test('512, 1024 and 2048 tiers are exact identity subsets including visibility, size and color at every phase', () => {
  const source = score(['star', 'sphere', 'outline', 'galaxy']), full = fleet();
  for (const time of [0, 5100, 11999, 12000, 17000, 22000, 22817, 24999, 32000, 39000, 42300, 52000, 57123, 64000, 65999, 66000]) {
    updateAiDroneFleet(full, time, { score: source });
    for (const count of [512, 1024, 2048]) {
      const subset = fleet(count); updateAiDroneFleet(subset, time, { score: source });
      for (let i = 0; i < count; i++) {
        const identity = subset.identities[i]; assert.equal(subset.sizes[i], full.sizes[identity]);
        for (let axis = 0; axis < 3; axis++) { assert.equal(subset.positions[i * 3 + axis], full.positions[identity * 3 + axis]); assert.equal(subset.colors[i * 3 + axis], full.colors[identity * 3 + axis]); }
      }
    }
  }
});

test('visibility fades continuously across launch, all transitions, return and final blackout with no buffer churn', () => {
  for (const transition of ['morph', 'sweep', 'burst']) for (const reducedMotion of [false, true]) {
    const source = score(undefined, { scenes: ['star', 'sphere', 'city', 'outline'].map(shape => scene(shape, { transition, motion: 'wave' })) });
    const value = fleet(1024), program = createAiDroneProgram(source), references = [value.positions, value.colors, value.sizes];
    for (const boundary of [12000, 22000, 25000, 32000, 35000, 42000, 45000, program.returnStart, 64000, program.duration]) {
      updateAiDroneFleet(value, boundary - .01, { score: source, reducedMotion });
      const prior = [value.positions.slice(), value.colors.slice(), value.sizes.slice()];
      updateAiDroneFleet(value, boundary, { score: source, reducedMotion });
      for (let channel = 0; channel < 3; channel++) { assert.equal(references[channel], [value.positions, value.colors, value.sizes][channel]); assert.ok(maxDelta(prior[channel], references[channel]) < .005, `${transition}/${reducedMotion} channel ${channel} at ${boundary}`); }
    }
    assert.deepEqual(value.positions, value.bases); assert.ok(value.colors.every(v => v === 0)); assert.ok(value.sizes.every(v => v === 0));
  }
});

test('every 3D primitive keeps finite lights, world spacing and complete recovery without changing score contracts', () => {
  for (const shape of AI_DRONE_SHAPES.filter(value => ['sphere', 'ring', 'helix', 'galaxy'].includes(value))) {
    const source = score(Array(4).fill(shape)), value = fleet(); updateAiDroneFleet(value, 17000, { score: source });
    assert.ok(separation(value, false) >= .8999); assert.ok(lit(value).length > 150);
    assert.ok(value.positions.every(Number.isFinite));
    updateAiDroneFleet(value, createAiDroneProgram(source).duration, { score: source });
    assert.deepEqual(value.positions, value.bases); assert.ok(value.colors.every(v => v === 0)); assert.ok(value.sizes.every(v => v === 0));
  }
});

test('helix quality subsets retain both luminous strands rather than dropping every odd-side drone', () => {
  const source = score(Array(4).fill('helix')), full = fleet(); updateAiDroneFleet(full, 17000, { score: source });
  for (const count of [512, 1024, 2048]) {
    const value = fleet(count); updateAiDroneFleet(value, 17000, { score: source });
    const sides = [0, 0];
    for (const index of lit(value)) sides[(value.identities[index] >>> 3) & 1]++;
    assert.ok(sides.every(total => total >= 100), `both visible helix strands at ${count}: ${sides}`);
    for (let i = 0; i < count; i++) {
      const id = value.identities[i]; assert.equal(value.sizes[i], full.sizes[id]);
      for (let axis = 0; axis < 3; axis++) { assert.equal(value.positions[i * 3 + axis], full.positions[id * 3 + axis]); assert.equal(value.colors[i * 3 + axis], full.colors[id * 3 + axis]); }
    }
  }
  // A non-rung pair has equal height and opposing radii around CENTER_Z=-8.
  const a = 16 * 3, b = 24 * 3;
  assert.equal(full.positions[a + 1], full.positions[b + 1]);
  assert.ok(Math.abs(full.positions[a] + full.positions[b]) < 1e-5);
  assert.ok(Math.abs(full.positions[a + 2] + full.positions[b + 2] + 16) < 1e-5);
});
