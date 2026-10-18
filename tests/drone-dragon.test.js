import test from 'node:test';
import assert from 'node:assert/strict';
import { createDragonFormation, DRAGON_COUNT, DRAGON_PARTS } from '../shared/droneDragon.js';

const allIdentities = Uint16Array.from({ length: DRAGON_COUNT }, (_, i) => i);
const indicesFor = (formation, part) => Array.from(formation.parts.keys()).filter(i => formation.parts[i] === part);
const boundsFor = (formation, indices = Array.from(formation.parts.keys())) => {
  const bounds = Array.from({ length: 3 }, () => [Infinity, -Infinity]);
  for (const i of indices) for (let axis = 0; axis < 3; axis++) {
    const value = formation.positions[i * 3 + axis];
    bounds[axis][0] = Math.min(bounds[axis][0], value);
    bounds[axis][1] = Math.max(bounds[axis][1], value);
  }
  return bounds;
};

test('dragon uses exactly the existing 4096 real drone identities and typed buffers', () => {
  const result = createDragonFormation(allIdentities);
  assert.equal(DRAGON_COUNT, 4096);
  assert.ok(result.positions instanceof Float32Array);
  assert.ok(result.colors instanceof Float32Array);
  assert.ok(result.parts instanceof Uint8Array);
  assert.equal(result.positions.length, DRAGON_COUNT * 3);
  assert.equal(result.colors.length, DRAGON_COUNT * 3);
  assert.equal(result.parts.length, DRAGON_COUNT);
  assert.deepEqual(Object.keys(result).sort(), ['colors', 'parts', 'positions']);
});

test('every quality level and reordered subset keeps each identity bit-for-bit stable', () => {
  const full = createDragonFormation(allIdentities);
  for (const count of [2048, 997, 31, 1]) {
    const identities = Uint16Array.from({ length: count }, (_, i) => Math.floor(i * DRAGON_COUNT / count));
    const small = createDragonFormation(identities);
    for (let i = 0; i < count; i++) {
      const identity = identities[i];
      assert.deepEqual(small.positions.slice(i * 3, i * 3 + 3), full.positions.slice(identity * 3, identity * 3 + 3));
      assert.deepEqual(small.colors.slice(i * 3, i * 3 + 3), full.colors.slice(identity * 3, identity * 3 + 3));
      assert.equal(small.parts[i], full.parts[identity]);
    }
  }
  const reversed = createDragonFormation([4095, 12, 0, 12]);
  assert.deepEqual(reversed.positions.slice(0, 3), full.positions.slice(4095 * 3));
  assert.deepEqual(reversed.positions.slice(3, 6), reversed.positions.slice(9, 12));
});

test('cached source and caller identity arrays are never exposed or mutated', () => {
  const ids = new Uint16Array([11, 28, 123, 4042]);
  const originalIds = new Uint16Array(ids);
  const original = createDragonFormation(ids);
  const expected = { positions: original.positions.slice(), colors: original.colors.slice(), parts: original.parts.slice() };
  original.positions.fill(999);
  original.colors.fill(999);
  original.parts.fill(255);
  assert.deepEqual(ids, originalIds);
  assert.deepEqual(createDragonFormation(ids), expected);
});

test('all positions stay finite inside the shared show and camera envelope', () => {
  const formation = createDragonFormation(allIdentities);
  for (const value of formation.positions) assert.ok(Number.isFinite(value));
  const [[x0, x1], [y0, y1], [z0, z1]] = boundsFor(formation);
  assert.ok(x0 >= -61 && x1 <= 61);
  assert.ok(y0 >= 23.8 && y1 <= 116);
  assert.ok(z0 >= -22 && z1 <= 12);
  assert.ok(x1 - x0 > 115 && y1 - y0 > 90, 'spectacle retains its actual world-space scale');
  assert.ok(z1 - z0 > 28, 'not a flat billboard');
});

test('anatomical parts are stable, complete and represented at half resolution', () => {
  const expected = [540, 790, 1120, 430, 410, 300, 370, 136];
  assert.deepEqual(Object.values(DRAGON_PARTS), [0, 1, 2, 3, 4, 5, 6, 7]);
  for (const count of [4096, 2048]) {
    const formation = createDragonFormation(Uint16Array.from({ length: count }, (_, i) => i * DRAGON_COUNT / count));
    const counts = Array.from({ length: 8 }, () => 0);
    for (const part of formation.parts) counts[part]++;
    assert.deepEqual(counts, expected.map(value => value * count / DRAGON_COUNT));
  }
});

test('filled membrane wings occupy broad areas and two separated depths', () => {
  const formation = createDragonFormation(allIdentities);
  const far = indicesFor(formation, DRAGON_PARTS.FAR_WING);
  const near = indicesFor(formation, DRAGON_PARTS.NEAR_WING);
  const farBounds = boundsFor(formation, far), nearBounds = boundsFor(formation, near);
  assert.ok(farBounds[2][1] <= -11.9, 'far wing remains behind the body');
  assert.ok(nearBounds[2][0] >= -4.1 && nearBounds[2][1] > 4, 'near wing has its own depth sweep');
  assert.ok(farBounds[1][1] - farBounds[1][0] > 38);
  assert.ok(nearBounds[0][1] - nearBounds[0][0] > 50);
  // Substantial numbers of deep-blue lamps fill interior cells, not just a
  // collection of bright contour lines or a single regular triangular mesh.
  let nearInterior = 0, farInterior = 0;
  for (const i of near) {
    const [x, y] = formation.positions.subarray(i * 3, i * 3 + 2);
    if (x > 29 && x < 44 && y > 89 && y < 101 && formation.colors[i * 3] < 0.1) nearInterior++;
  }
  for (const i of far) {
    const [x, y] = formation.positions.subarray(i * 3, i * 3 + 2);
    if (x > -8 && x < 9 && y > 95 && y < 104 && formation.colors[i * 3] < 0.25) farInterior++;
  }
  assert.ok(nearInterior > 100, `near membrane interior has ${nearInterior} emitters`);
  assert.ok(farInterior > 100, `far membrane interior has ${farInterior} emitters`);
});

test('profile silhouette retains a left-facing head, open jaw, right curl and left-down breath', () => {
  const formation = createDragonFormation(allIdentities);
  const head = indicesFor(formation, DRAGON_PARTS.HEAD), tail = indicesFor(formation, DRAGON_PARTS.TAIL);
  const breath = indicesFor(formation, DRAGON_PARTS.BREATH);
  const headBounds = boundsFor(formation, head), tailBounds = boundsFor(formation, tail), breathBounds = boundsFor(formation, breath);
  assert.ok(headBounds[0][1] < 0 && headBounds[1][0] > 70);
  assert.ok(tailBounds[0][0] > 15 && tailBounds[1][0] < 25 && tailBounds[1][1] > 55);
  assert.ok(breathBounds[0][0] < -59 && breathBounds[1][0] < 29);
  assert.ok(breathBounds[0][1] < -30 && breathBounds[1][1] < 76);
  const darkMouth = head.filter(i => {
    const x = (formation.positions[i * 3] - 7) / 0.9, y = formation.positions[i * 3 + 1];
    return x > -41 && x < -37 && y > 75.2 && y < 76;
  });
  assert.ok(darkMouth.length < 5, 'the jaws do not fill the mouth with a solid bright patch');
});

test('dragon head has a compact wedge muzzle, rear-swept horns and no hanging smile', () => {
  const formation = createDragonFormation(allIdentities);
  const head = indicesFor(formation, DRAGON_PARTS.HEAD).map(i => ({
    x: (formation.positions[i * 3] - 7) / 0.9,
    y: formation.positions[i * 3 + 1], z: formation.positions[i * 3 + 2],
  }));
  assert.ok(Math.min(...head.map(p => p.x)) < -43.5, 'angular front of the muzzle remains readable');
  assert.ok(Math.min(...head.map(p => p.y)) >= 73.1, 'jaw does not droop into the old detached smile arc');
  assert.ok(Math.max(...head.map(p => p.y)) <= 90.6, 'horns are not long vertical ears');
  const horns = head.filter(p => p.y > 86.5);
  assert.ok(horns.length >= 20, 'both horn outlines remain represented');
  assert.ok(horns.every(p => p.x > -29), 'horns sweep backward from the crown, away from the muzzle');
  assert.ok(horns.some(p => p.x > -20 && p.y > 89.5), 'near horn ends in a rearward tapered tip');
  assert.ok(head.filter(p => p.x < -40 && p.y > 78 && p.y < 82).length >= 15,
    'muzzle has a substantial bevelled nose rather than a single thin line');
});

test('lower jaw remains connected through the cheek hinge at both fleet qualities', () => {
  const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
  for (const count of [4096, 2048]) {
    const formation = createDragonFormation(Uint16Array.from({ length: count }, (_, i) => i * DRAGON_COUNT / count));
    const head = indicesFor(formation, DRAGON_PARTS.HEAD).map(i => Array.from(formation.positions.slice(i * 3, i * 3 + 3)));
    const body = indicesFor(formation, DRAGON_PARTS.BODY).map(i => Array.from(formation.positions.slice(i * 3, i * 3 + 3)));
    const chin = head.reduce((lowest, point) => point[1] < lowest[1] ? point : lowest);
    const reached = new Set([chin]), queue = [chin];
    // A connected chain of actual lamps, not merely coincident polygon data.
    for (let cursor = 0; cursor < queue.length; cursor++) {
      for (const point of head) if (!reached.has(point) && distance(point, queue[cursor]) < 1.5) {
        reached.add(point); queue.push(point);
      }
    }
    const hinge = [-26 * 0.9 + 7, 77.4, 5];
    assert.ok([...reached].some(point => distance(point, hinge) < 0.8), `${count}: chin joins the real hinge`);
    assert.ok([...reached].some(point => point[1] > 83), `${count}: jaw is connected to the upper skull`);
    const neckGap = head.reduce((best, point) => Math.min(best, ...body.map(other => distance(point, other))), Infinity);
    assert.ok(neckGap < 1.7, `${count}: cheek blends into neck rather than floating (${neckGap})`);
  }
});

test('head highlights form a small slanted eye and breath starts inside the open lips', () => {
  for (const count of [4096, 2048]) {
    const formation = createDragonFormation(Uint16Array.from({ length: count }, (_, i) => i * DRAGON_COUNT / count));
    const eye = indicesFor(formation, DRAGON_PARTS.HEAD).filter(i => formation.colors[i * 3] > 0.6);
    assert.equal(eye.length, count / DRAGON_COUNT * 10, 'limit pale lamps so there is no circular white eye/pupil bloom');
    const [[x0, x1], [y0, y1]] = boundsFor(formation, eye);
    assert.ok(x1 - x0 < 2.2 && y1 - y0 < 1.3, 'eye stays small inside the brow');
    assert.ok(x0 > -24 && x1 < -21 && y0 > 80.8 && y1 < 82.2);
    const breath = indicesFor(formation, DRAGON_PARTS.BREATH);
    const start = breath.reduce((highest, i) => formation.positions[i * 3 + 1] > formation.positions[highest * 3 + 1] ? i : highest);
    const x = formation.positions[start * 3], y = formation.positions[start * 3 + 1];
    assert.ok(x > -31.4 && x < -30.5 && y > 75 && y < 75.9,
      'electrical breath emerges through the mouth, not from the lower jaw or a detached point');
  }
});

test('electrical breath includes separate forks instead of a single solid cone', () => {
  const formation = createDragonFormation(allIdentities);
  const breath = indicesFor(formation, DRAGON_PARTS.BREATH);
  const atLowerBand = breath.filter(i => formation.positions[i * 3 + 1] > 40 && formation.positions[i * 3 + 1] < 45);
  const xs = atLowerBand.map(i => formation.positions[i * 3]);
  assert.ok(xs.length > 15);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 12, 'left and right tributaries are visibly separated');
});

test('electric blue palette limits white bloom and retains brighter structural highlights', () => {
  const formation = createDragonFormation(allIdentities);
  let pale = 0, membrane = 0;
  for (let i = 0; i < DRAGON_COUNT; i++) {
    const [r, g, b] = formation.colors.subarray(i * 3, i * 3 + 3);
    assert.ok(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b));
    assert.ok(r >= 0 && g >= 0 && b > g && g >= r * 0.8);
    assert.ok(b <= 1.43 && r < 0.7);
    if (r > 0.6) pale++;
    if (r < 0.25 && b > 0.8 && g < 0.3) membrane++;
  }
  assert.ok(pale > 50 && pale < DRAGON_COUNT * 0.05, 'only selected eyes, claws and sparks use pale ice');
  assert.ok(membrane > 1300, 'wing membranes stay dark electric blue rather than white');
});

test('empty selections are supported and invalid identities are rejected explicitly', () => {
  const empty = createDragonFormation([]);
  assert.equal(empty.positions.length, 0);
  assert.equal(empty.colors.length, 0);
  assert.equal(empty.parts.length, 0);
  for (const invalid of [null, undefined, {}, new DataView(new ArrayBuffer(8)), 4096]) {
    assert.throws(() => createDragonFormation(invalid), TypeError);
  }
  for (const invalid of [[-1], [4096], [0.5], [NaN], [Infinity], [undefined], ['12']]) {
    assert.throws(() => createDragonFormation(invalid), RangeError);
  }
});
