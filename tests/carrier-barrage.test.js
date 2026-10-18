import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformWithEsbuild } from 'vite';
import * as battle from '../shared/carrierBattle.js';
import { BARRAGE_COUNT, BARRAGE_PER_MOUNT, BARRAGE_WINDOW, sampleBarrageRound, sampleBarrageMount } from '../shared/carrierBarrage.js';

const vectorClose = (a, b, tolerance = 1e-9) => a.forEach((value, axis) => assert.ok(Math.abs(value - b[axis]) <= tolerance, `${a} differs from ${b}`));
const countAt = (time, reduced = false) => {
  const counts = [0, 0, 0, 0];
  for (let index = 0; index < BARRAGE_COUNT; index++) { const round = sampleBarrageRound(time, index, reduced); if (round.visible) counts[round.mountId]++; }
  return counts;
};

test('decorative barrage has fixed capacity, stable turret assignment, bounded time and no new encounters', () => {
  assert.equal(BARRAGE_COUNT, 256); assert.equal(BARRAGE_PER_MOUNT, 64);
  assert.deepEqual(BARRAGE_WINDOW, { start: 22000, dense: 38000, end: 58000 });
  const events = structuredClone(battle.CARRIER_BATTLE_EVENTS);
  for (let index = 0; index < BARRAGE_COUNT; index++) {
    const round = sampleBarrageRound(43000, index);
    assert.equal(round.id, index); assert.equal(round.mountId, Math.floor(index / BARRAGE_PER_MOUNT));
  }
  assert.deepEqual(battle.CARRIER_BATTLE_EVENTS, events);
  assert.equal(battle.CARRIER_BATTLE_COUNTS.shots, 64);
});

test('22–38 seconds remain substantial, then 38–57 seconds form a continuous four-turret fire net', () => {
  for (let time = 24000; time <= 35000; time += 100) {
    const counts = countAt(time), total = counts.reduce((a, b) => a + b);
    assert.ok(total >= 115 && total <= 180, `early density at ${time}: ${counts}`);
  }
  for (let time = 38000; time <= 57000; time += 100) {
    const counts = countAt(time), total = counts.reduce((a, b) => a + b);
    assert.ok(total >= 200 && total <= 252, `peak density at ${time}: ${counts}`);
    assert.ok(counts.every(value => value >= 48 && value <= 64), `a turret lost its dense stream at ${time}: ${counts}`);
  }
});

test('every short stroke is derived from its exact shared barrel muzzle, never a full-length laser', () => {
  for (const time of [23000, 31050, 38000, 42000, 51000, 57500]) {
    for (let index = 0; index < BARRAGE_COUNT; index++) {
      const round = sampleBarrageRound(time, index), mount = sampleBarrageMount(time, round.mountId);
      vectorClose(round.origin, battle.sampleBattleTurret(time, round.mountId).muzzle);
      assert.equal(round.start, round.tail); assert.equal(round.end, round.head);
      if (!round.visible) continue;
      assert.ok(round.length > 0 && round.length <= mount.distance * .063);
      const toHead = round.head.map((value, axis) => value - round.origin[axis]), distance = Math.hypot(...toHead);
      const alignment = toHead.reduce((sum, value, axis) => sum + value * mount.direction[axis], 0) / distance;
      assert.ok(alignment > .995, 'small authored fan must not spray all over the ship');
      assert.ok(round.opacity > 0 && round.opacity <= .82 && round.radius > 0 && round.radius < .05);
    }
  }
});

test('opening, finale and reduced-motion modes are completely quiet with finite safe results', () => {
  for (const time of [-1000, NaN, Infinity, undefined, 0, 21999, 22000, 58000, 90000, 150000, 999999]) {
    assert.deepEqual(countAt(time), [0, 0, 0, 0]);
    for (let mount = 0; mount < 4; mount++) {
      const sample = sampleBarrageMount(time, mount);
      assert.equal(sample.firing, false); assert.equal(sample.strength, 0);
      assert.ok([...sample.origin, ...sample.target, sample.spin].every(Number.isFinite));
    }
  }
  for (const time of [22000, 32000, 43000, 57500]) {
    assert.deepEqual(countAt(time, true), [0, 0, 0, 0]);
    for (let mount = 0; mount < 4; mount++) {
      const sample = sampleBarrageMount(time, mount, true);
      assert.equal(sample.firing, false); assert.equal(sample.strength, 0); assert.equal(sample.spin, 0);
    }
  }
  for (const index of [-10, NaN, Infinity, undefined, null, '2', 1e9]) {
    const sample = sampleBarrageRound(42000, index);
    assert.ok([...sample.head, ...sample.tail, sample.progress, sample.opacity].every(Number.isFinite));
  }
});

test('pause, backwards seek and shuffled queries are deterministic without mutable shared vectors', () => {
  const times = [22100, 28555, 39900, 48271, 57850], expected = new Map();
  for (const time of times) expected.set(time, Array.from({ length: BARRAGE_COUNT }, (_, index) => sampleBarrageRound(time, index)));
  for (const time of [...times].reverse()) for (let index = BARRAGE_COUNT - 1; index >= 0; index--) {
    assert.deepEqual(sampleBarrageRound(time, index), expected.get(time)[index]);
    assert.ok(Object.isFrozen(sampleBarrageRound(time, index).origin));
  }
  const before = sampleBarrageRound(42000, 23); before.head[0] = 99999;
  assert.notEqual(sampleBarrageRound(42000, 23).head[0], 99999, 'returned strokes cannot corrupt the pose cache');
});

test('256 strokes and four barrel/glow queries sample the expensive turret score only four times per frame', async () => {
  const source = fs.readFileSync(new URL('../shared/carrierBarrage.js', import.meta.url), 'utf8');
  const compiled = await transformWithEsbuild(source, 'carrierBarrage.js', { format: 'cjs' });
  let calls = 0;
  const module = { exports: {} };
  vm.runInNewContext(compiled.code, { module, exports: module.exports, require() { return { ...battle, sampleBattleTurret(...args) { calls++; return battle.sampleBattleTurret(...args); } }; } });
  for (const time of [42000, 42000, 43000, 42000]) {
    for (let index = 0; index < BARRAGE_COUNT; index++) module.exports.sampleBarrageRound(time, index);
    for (let mount = 0; mount < 4; mount++) module.exports.sampleBarrageMount(time, mount);
  }
  assert.equal(calls, 12, 'only the three distinct consecutive frame snapshots should be sampled');
});
