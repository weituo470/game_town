import test from 'node:test';
import assert from 'node:assert/strict';
import { CARRIER_BATTLE_DURATION, CARRIER_BATTLE_COUNTS, CARRIER_BATTLE_SCORE, CARRIER_BATTLE_CHAPTERS,
  CARRIER_BATTLE_MOUNTS, CARRIER_BATTLE_EVENTS, sampleCarrierBattle, sampleBattleDrone, sampleBattleShot, sampleBattleTurret } from '../shared/carrierBattle.js';

const close = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} ≈ ${b}`);
const vectorClose = (a, b, epsilon) => a.forEach((value, axis) => close(value, b[axis], epsilon));
const finiteVector = value => assert.ok(value.length === 3 && value.every(Number.isFinite));

test('carrier battle is an independent closed 150-second score with eight contiguous readable chapters', () => {
  assert.equal(CARRIER_BATTLE_DURATION, 150000);
  assert.deepEqual(CARRIER_BATTLE_COUNTS, { attack: 48, defense: 32, shots: 64 });
  assert.equal(CARRIER_BATTLE_CHAPTERS.length, 8);
  for (let index = 0; index < CARRIER_BATTLE_CHAPTERS.length; index++) {
    const chapter = CARRIER_BATTLE_CHAPTERS[index], sample = sampleCarrierBattle(chapter.start);
    assert.equal(chapter.start, index ? CARRIER_BATTLE_CHAPTERS[index - 1].end : 0);
    assert.equal(sample.phase, chapter.id); assert.equal(sample.progress, 0);
    assert.equal(sample.cueLabel, chapter.label); assert.equal(sample.description, chapter.description);
  }
  assert.equal(CARRIER_BATTLE_CHAPTERS.at(-1).end, 150000);
  assert.equal(sampleCarrierBattle(150000).active, false);
  assert.equal(sampleCarrierBattle(150000).progress, 1);
  assert.equal(sampleCarrierBattle(150000).phase, 'home');
});

test('all public samplers clamp invalid/out-of-range times and retain finite fixed identities', () => {
  for (const invalid of [NaN, Infinity, -Infinity, undefined, -500]) {
    assert.equal(sampleCarrierBattle(invalid).elapsed, 0);
    finiteVector(sampleBattleDrone(invalid, NaN).position);
    finiteVector(sampleBattleShot(invalid, Infinity).start);
    finiteVector(sampleBattleTurret(invalid, -50).muzzle);
  }
  assert.deepEqual(sampleCarrierBattle(150001), sampleCarrierBattle(150000));
  assert.equal(sampleBattleDrone(40000, 999).id, 47);
  assert.equal(sampleBattleDrone(105000, 999, 'defense').id, 31);
  assert.equal(sampleBattleDrone(40000, 0, 'unknown').team, 'attack');
});

test('mechanical deployment precedes lift and the carrier returns to its exact original harbour state', () => {
  const initial = sampleCarrierBattle(0).carrier;
  assert.deepEqual(initial, { height: 0, deploy: 0, hangar: 0, engine: 0 });
  assert.equal(sampleCarrierBattle(58000).carrier.deploy, 0);
  assert.equal(sampleCarrierBattle(78000).carrier.deploy, 1);
  assert.equal(sampleCarrierBattle(78000).carrier.height, 0);
  assert.equal(sampleCarrierBattle(98000).carrier.height, CARRIER_BATTLE_SCORE.liftHeight);
  assert.equal(sampleCarrierBattle(98000).carrier.hangar, 1);
  assert.deepEqual(sampleCarrierBattle(150000).carrier, initial);
  for (let time = 0; time <= 150000; time += 100) {
    const c = sampleCarrierBattle(time).carrier;
    assert.ok(c.height >= 0 && c.height <= 30);
    for (const key of ['deploy', 'hangar', 'engine']) assert.ok(c[key] >= 0 && c[key] <= 1);
  }
});

test('mechanical pose is position/velocity continuous at chapter and mechanism joins', () => {
  const joins = [...CARRIER_BATTLE_CHAPTERS.map(item => item.start), 72000, 76000, 96000, 143000, 147000, 148000, 150000];
  for (const time of joins) for (const key of ['height', 'deploy', 'hangar', 'engine']) {
    const before = sampleCarrierBattle(time - 1).carrier[key], exact = sampleCarrierBattle(time).carrier[key], after = sampleCarrierBattle(time + 1).carrier[key];
    close(before, exact, 0.004); close(after, exact, 0.004);
    close(exact - before, after - exact, 0.00001);
  }
});

test('all eighty drones have deterministic finite bounded world poses and lifecycle opacity', () => {
  for (let time = 0; time <= 150000; time += 250) for (const team of ['attack', 'defense']) {
    for (let id = 0; id < CARRIER_BATTLE_COUNTS[team]; id++) {
      const p = sampleBattleDrone(time, id, team);
      assert.equal(p.id, id); assert.equal(p.team, team); finiteVector(p.position);
      assert.ok(p.position[0] >= 35 && p.position[0] <= 120, `x ${time}/${team}/${id}`);
      assert.ok(p.position[1] >= 0.8 && p.position[1] <= 60, `y ${time}/${team}/${id}`);
      assert.ok(p.position[2] >= -25 && p.position[2] <= 75, `z ${time}/${team}/${id}`);
      assert.ok([p.yaw, p.pitch, p.bank, p.opacity, p.hit].every(Number.isFinite));
      assert.ok(p.opacity >= 0 && p.opacity <= 1 && p.hit >= 0 && p.hit <= 1);
      assert.ok(Math.abs(p.bank) <= 0.24);
      if (p.visible) assert.ok(p.opacity > 0.001);
    }
  }
});

test('launch is sequential through the actual carrier hangar and first clears the deck toward -Z', () => {
  for (let id = 0; id < 32; id++) {
    const birth = 98000 + id * 360;
    const before = sampleBattleDrone(birth - 1, id, 'defense');
    const launch = sampleBattleDrone(birth, id, 'defense');
    const clear = sampleBattleDrone(birth + 800, id, 'defense');
    assert.equal(before.visible, false);
    close(launch.position[0], 63 + (id % 2 ? 0.65 : -0.65));
    close(launch.position[1], sampleCarrierBattle(birth).carrier.height + 0.85);
    close(launch.position[2], 13);
    assert.ok(clear.visible && clear.position[2] < launch.position[2] && clear.position[1] > launch.position[1]);
  }
});

test('all combat outcomes are fixed authored events, including real incoming attacks and two-way air encounters', () => {
  assert.equal(CARRIER_BATTLE_EVENTS.length, CARRIER_BATTLE_COUNTS.shots);
  assert.equal(new Set(CARRIER_BATTLE_EVENTS.map(event => event.id)).size, 64);
  const incoming = CARRIER_BATTLE_EVENTS.filter(event => event.kind === 'attack');
  assert.equal(incoming.length, 8);
  assert.ok(incoming.every(event => event.team === 'attack' && event.victimTeam === 'carrier' && event.mountId === -1));
  assert.ok(incoming.some(event => event.willHit) && incoming.some(event => !event.willHit));
  assert.deepEqual(new Set(CARRIER_BATTLE_EVENTS.filter(event => event.kind === 'duel').map(event => event.team)), new Set(['attack', 'defense']));
  for (const event of CARRIER_BATTLE_EVENTS) {
    if (event.attackerId >= 0) assert.ok(sampleBattleDrone(event.hitTime - event.flightMs, event.attackerId, event.team).visible, `event ${event.id} shooter is present`);
    if (event.victimTeam === 'attack' && event.willHit) assert.ok(sampleBattleDrone(event.hitTime - 1, event.victimId).visible, `event ${event.id} victim exists before hit`);
  }
});

test('rendered barrel muzzle and interception tracer start are precisely the same clocked pose', () => {
  assert.deepEqual(CARRIER_BATTLE_MOUNTS, [[55.4, 1.1, 7.5], [70.6, 1.1, 7.5], [55.4, 1.1, 32.5], [70.6, 1.1, 32.5]]);
  for (const event of CARRIER_BATTLE_EVENTS.filter(event => event.kind === 'intercept')) {
    for (const time of [event.hitTime - event.flightMs, event.hitTime - 200, event.hitTime - 1]) {
      const shot = sampleBattleShot(time, event.id), turret = sampleBattleTurret(time, event.mountId);
      assert.equal(shot.visible, true); assert.equal(turret.active, true);
      vectorClose(shot.start, turret.muzzle); vectorClose(shot.end, turret.target);
      close(Math.hypot(...turret.muzzle.map((value, axis) => value - turret.pivot[axis])), 1.45);
    }
  }
});

test('aircraft shots originate from the actual visible actor, not a detached world-space effect', () => {
  for (const event of CARRIER_BATTLE_EVENTS.filter(event => event.mountId < 0)) {
    const time = event.hitTime - event.flightMs / 2;
    const shot = sampleBattleShot(time, event.id), drone = sampleBattleDrone(time, event.attackerId, event.team);
    vectorClose(shot.start, drone.position);
    assert.equal(shot.visible, true); close(shot.progress, 0.5);
  }
});

test('hit points, victim flashes, fade-out and finite impact lifetime share one authored instant', () => {
  for (const event of CARRIER_BATTLE_EVENTS) {
    const before = sampleBattleShot(event.hitTime - 1, event.id);
    const impact = sampleBattleShot(event.hitTime, event.id);
    assert.equal(before.impactAge, -1); assert.equal(impact.visible, false);
    if (!event.willHit) { assert.equal(impact.impactAge, -1); assert.equal(sampleBattleShot(event.hitTime + 200, event.id).hit, 0); continue; }
    close(impact.impactAge, 0);
    assert.ok(sampleBattleShot(event.hitTime + 200, event.id).hit > 0.6);
    assert.equal(sampleBattleShot(event.hitTime + 901, event.id).hit, 0);
    if (event.victimTeam === 'attack') {
      vectorClose(impact.impact, sampleBattleDrone(event.hitTime, event.victimId).position);
      close(sampleBattleShot(event.hitTime + 200, event.id).hit, sampleBattleDrone(event.hitTime + 200, event.victimId).hit);
      assert.equal(sampleBattleDrone(event.hitTime + 1601, event.victimId).visible, false);
    } else assert.ok(impact.impact[0] >= 54 && impact.impact[0] <= 72 && impact.impact[2] >= 5 && impact.impact[2] <= 35 && impact.impact[1] < 1);
  }
});

test('pure seeking in any order gives identical states, poses, tracers and turrets', () => {
  const times = [0, 14000, 35675, 58000, 78999, 98000, 110123, 125550, 139500, 150000];
  const capture = t => ({ state: sampleCarrierBattle(t), drones: ['attack', 'defense'].flatMap(team => Array.from({ length: CARRIER_BATTLE_COUNTS[team] }, (_, id) => sampleBattleDrone(t, id, team))),
    shots: CARRIER_BATTLE_EVENTS.map(event => sampleBattleShot(t, event.id)), turrets: CARRIER_BATTLE_MOUNTS.map((_, id) => sampleBattleTurret(t, id)) });
  const baselines = new Map(times.map(t => [t, capture(t)]));
  for (const t of [...times].reverse().concat(times)) assert.deepEqual(capture(t), baselines.get(t));
});

test('reduced motion fixes the carrier and both formations, with no shots, hit flashes or mechanical movement', () => {
  for (const t of [14000, 38000, 58000, 78000, 98000, 114000, 136000, 149999]) {
    assert.deepEqual(sampleCarrierBattle(t, { reducedMotion: true }).carrier, { height: 0, deploy: 0, hangar: 0, engine: 0 });
    for (const team of ['attack', 'defense']) for (let id = 0; id < CARRIER_BATTLE_COUNTS[team]; id++) {
      assert.deepEqual(sampleBattleDrone(t, id, team, true), sampleBattleDrone(14000, id, team, true));
    }
    for (const event of CARRIER_BATTLE_EVENTS) {
      const p = sampleBattleShot(t, event.id, true);
      assert.equal(p.visible, false); assert.equal(p.hit, 0); assert.equal(p.impactAge, -1);
    }
  }
});

test('the finished show has no residual drones, tracer, flash or active turret and can safely restart', () => {
  for (const team of ['attack', 'defense']) for (let id = 0; id < CARRIER_BATTLE_COUNTS[team]; id++) {
    assert.equal(sampleBattleDrone(0, id, team).visible, false);
    assert.equal(sampleBattleDrone(150000, id, team).visible, false);
    assert.equal(sampleBattleDrone(150000, id, team).opacity, 0);
  }
  for (const event of CARRIER_BATTLE_EVENTS) {
    const ended = sampleBattleShot(150000, event.id);
    assert.equal(ended.visible, false); assert.equal(ended.hit, 0);
  }
  for (let id = 0; id < 4; id++) assert.equal(sampleBattleTurret(150000, id).active, false);
});
