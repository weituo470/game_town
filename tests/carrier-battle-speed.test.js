import test from 'node:test';
import assert from 'node:assert/strict';
import { CARRIER_BATTLE_FLIGHT, CARRIER_BATTLE_SCORE, CARRIER_BATTLE_CHAPTERS, CARRIER_BATTLE_EVENTS,
  sampleCarrierBattle, sampleBattleDrone, sampleBattleShot } from '../shared/carrierBattle.js';

const TAU = Math.PI * 2;
const smooth = value => { const u = Math.max(0, Math.min(1, value)); return u * u * (3 - 2 * u); };
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const close = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} ≈ ${b}`);
const closeVector = (a, b, epsilon) => a.forEach((value, axis) => close(value, b[axis], epsilon));

// The former cruise curves, recorded numerically rather than sampling a faster
// show clock. This reference makes a real metres-per-second regression test.
function cruise(ms, id, team, omega) {
  const theta = id / (team === 'attack' ? 48 : 32) * TAU + ms / 1000 * omega * (team === 'attack' ? 1 : -1);
  return team === 'attack' ? [78 + Math.cos(theta) * (20 + id % 3 * 2),
    14 + id % 6 * 2.5 + Math.sin(theta * 0.7) * 2 + sampleCarrierBattle(ms).carrier.height * 0.55,
    23 + Math.sin(theta) * (29 + id % 4)]
    : [77 + Math.cos(theta) * (14 + id % 4 * 2), 35 + id % 5 * 2 + Math.sin(theta) * 4, 23 + Math.sin(theta) * 25];
}

test('base cruise travels about 2.6 times farther in the same wall-clock second, without changing playback', context => {
  for (const team of ['attack', 'defense']) {
    const oldOmega = team === 'attack' ? 0.18 : 0.16;
    const omega = team === 'attack' ? CARRIER_BATTLE_FLIGHT.attackAngularSpeed : CARRIER_BATTLE_FLIGHT.defenseAngularSpeed;
    assert.ok(omega / oldOmega >= 2.4 && omega / oldOmega <= 2.8);
    const ids = team === 'attack' ? Array.from({ length: 16 }, (_, i) => i * 3 + 2) : Array.from({ length: 32 }, (_, i) => i);
    const first = team === 'attack' ? 60000 : 116000, last = team === 'attack' ? 76000 : 134000;
    let actual = 0, previous = 0;
    for (const id of ids) for (let time = first; time < last; time += 100) {
      actual += distance(sampleBattleDrone(time + 100, id, team).position, sampleBattleDrone(time, id, team).position);
      previous += distance(cruise(time + 100, id, team, oldOmega), cruise(time, id, team, oldOmega));
    }
    const ratio = actual / previous, seconds = ids.length * (last - first) / 1000;
    assert.ok(ratio > 2.4 && ratio < 2.8, `${team} observed speed ratio ${ratio}`);
    context.diagnostic(`${team}: ${(previous / seconds).toFixed(2)} -> ${(actual / seconds).toFixed(2)} m/s; ${ratio.toFixed(3)}x`);
  }
});

test('red ingress completes in five seconds while the existing birth beats stay fixed', () => {
  assert.equal(CARRIER_BATTLE_FLIGHT.approachMs, 5000);
  for (const id of [2, 17, 32, 47]) {
    const birth = 14000 + Math.floor(id / 8) * 850 + id % 8 * 70;
    assert.equal(sampleBattleDrone(birth - 1, id).visible, false);
    assert.ok(sampleBattleDrone(birth + 500, id).visible);
    closeVector(sampleBattleDrone(birth + 5000, id).position, cruise(birth + 5000, id, 'attack', CARRIER_BATTLE_FLIGHT.attackAngularSpeed));
  }
});

test('the first 300 ms retain the proven roof-safe path, then clear in 1 s and deploy in 3.6 s', () => {
  assert.equal(CARRIER_BATTLE_FLIGHT.clearDeckMs, 1000);
  assert.equal(CARRIER_BATTLE_FLIGHT.formationMs, 2600);
  for (let id = 0; id < 32; id++) {
    const birth = 98000 + id * 360, lane = id % 2 ? 0.65 : -0.65;
    for (const age of [0, 100, 200, 300]) {
      const height = sampleCarrierBattle(birth + age).carrier.height, u = smooth(age / 1600);
      closeVector(sampleBattleDrone(birth + age, id, 'defense').position,
        [63 + lane, height + 0.85 + (6 - 0.85) * u, 13 - 10 * u]);
    }
    closeVector(sampleBattleDrone(birth + 1000, id, 'defense').position, [63 + lane, 36, 3]);
    closeVector(sampleBattleDrone(birth + 3600, id, 'defense').position, cruise(birth + 3600, id, 'defense', CARRIER_BATTLE_FLIGHT.defenseAngularSpeed));
  }
});

test('accelerated ingress, protected launch seam and cruise transitions remain C1 in world coordinates', () => {
  const h = 0.01; // 10 microseconds: compare one-sided derivatives in m/s.
  for (const team of ['attack', 'defense']) for (const id of team === 'attack' ? [2, 17, 32, 47] : [0, 11, 31]) {
    const birth = team === 'attack' ? 14000 + Math.floor(id / 8) * 850 + id % 8 * 70 : 98000 + id * 360;
    const joins = team === 'attack' ? [birth, birth + 5000, 136000, 149000] : [birth, birth + 300, birth + 1000, birth + 3600, 136000, 148000 - id * 70];
    for (const time of joins) {
      const before = sampleBattleDrone(time - h, id, team).position;
      const exact = sampleBattleDrone(time, id, team).position;
      const after = sampleBattleDrone(time + h, id, team).position;
      for (let axis = 0; axis < 3; axis++) {
        close(before[axis], exact[axis], 0.0005); close(after[axis], exact[axis], 0.0005);
        close((exact[axis] - before[axis]) * 1000 / h, (after[axis] - exact[axis]) * 1000 / h, 0.005);
      }
    }
  }
});

test('banking follows the stable turn direction instead of a separate oscillation and never snaps at launch', () => {
  for (const team of ['attack', 'defense']) {
    const ids = team === 'attack' ? [2, 17, 32, 47] : [0, 11, 22, 31];
    for (const id of ids) {
      let previous = sampleBattleDrone(0, id, team);
      for (let time = 20; time <= 150000; time += 20) {
        const current = sampleBattleDrone(time, id, team);
        assert.ok(Number.isFinite(current.bank) && Math.abs(current.bank) <= 0.24);
        if (current.visible && previous.visible) assert.ok(Math.abs(current.bank - previous.bank) / 0.02 < 1.5, `${team} ${id} bank snap at ${time}`);
        previous = current;
      }
      const start = team === 'attack' ? 60000 : 116000;
      const signs = new Set(Array.from({ length: 80 }, (_, i) => Math.sign(sampleBattleDrone(start + i * 100, id, team).bank)));
      assert.equal(signs.size, 1, 'continuous one-way orbit should keep a coherent bank side');
      assert.equal(signs.has(0), false);
    }
  }
});

test('faster base motion preserves every chapter/shot beat and the same actual impact point', () => {
  assert.deepEqual(CARRIER_BATTLE_CHAPTERS.map(item => [item.start, item.end]),
    [[0, 14000], [14000, 38000], [38000, 58000], [58000, 78000], [78000, 98000], [98000, 114000], [114000, 136000], [136000, 150000]]);
  assert.equal(CARRIER_BATTLE_SCORE.end, 150000);
  for (const event of CARRIER_BATTLE_EVENTS) {
    if (event.kind === 'intercept') assert.equal(event.hitTime, 22400 + event.id * 1100);
    const hit = sampleBattleShot(event.hitTime, event.id);
    assert.equal(hit.progress, 1);
    if (event.willHit && event.victimTeam === 'attack') closeVector(hit.impact, sampleBattleDrone(event.hitTime, event.victimId).position);
    if (event.attackerId >= 0) {
      const time = event.hitTime - event.flightMs / 2;
      closeVector(sampleBattleShot(time, event.id).start, sampleBattleDrone(time, event.attackerId, event.team).position);
    }
  }
});

test('speed is stateless under reverse seeking, reduced motion is unchanged, and every survivor leaves by 150 s', () => {
  for (const team of ['attack', 'defense']) for (const id of team === 'attack' ? [2, 17, 32, 47] : [0, 11, 31]) {
    const moments = [25000, 85000, 99500, 112000, 120000, 142000, 150000];
    const expected = new Map(moments.map(t => [t, sampleBattleDrone(t, id, team)]));
    for (const time of moments.slice().reverse().concat(moments)) assert.deepEqual(sampleBattleDrone(time, id, team), expected.get(time));
    const quiet = sampleBattleDrone(20000, id, team, true);
    for (const time of [98000, 114000, 136000, 149000]) assert.deepEqual(sampleBattleDrone(time, id, team, true), quiet);
    assert.equal(sampleBattleDrone(150000, id, team).visible, false);
    assert.equal(sampleBattleDrone(150000, id, team).opacity, 0);
  }
  assert.deepEqual(sampleCarrierBattle(150000).carrier, sampleCarrierBattle(0).carrier);
});
