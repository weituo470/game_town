import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_NIGHT_CYCLE_MS } from '../shared/dayNight.js';
import { FOUNTAIN, WORLD_BOUNDS, WORLD_LOCATIONS, TREE_POSITIONS, SPAWN, isWalkable } from '../shared/world.js';
import { NPC_BODY_RADIUS, NPC_PLANS, sampleNpc, findNearestNpc, isNpcWalkable } from '../shared/npcSimulation.js';

const ids = ['npc-ali', 'npc-huaya', 'npc-nuannuan', 'npc-beidong', 'npc-juya', 'npc-lituan', 'npc-lanyue', 'npc-maipao', 'npc-lanjian', 'npc-chengsu', 'npc-rongrong', 'npc-yubai', 'npc-miaomu', 'npc-dengcheng', 'npc-xiaotai', 'npc-alan'];
const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const close = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('all sixteen source residents have immutable public outdoor plans and closed paths', () => {
  assert.deepEqual(Object.keys(NPC_PLANS), ids);
  assert.equal(NPC_BODY_RADIUS, 0.65);
  assert.ok(Object.isFrozen(NPC_PLANS));
  for (const id of ids) {
    const plan = NPC_PLANS[id];
    assert.equal(plan.id, id);
    assert.ok(Object.isFrozen(plan));
    assert.ok(Object.isFrozen(plan.home));
    assert.ok(Object.isFrozen(plan.waypoints));
    assert.ok(plan.waypoints.length >= 4);
    assert.ok(plan.speed >= 0.8 && plan.speed <= 1.7);
    assert.ok(plan.home.locationLabel.length > 0);
    const last = plan.segments.at(-1);
    close(last.to.x, plan.home.x);
    close(last.to.z, plan.home.z);
    close(last.end, plan.activeDurationMs);
    for (const point of plan.waypoints) {
      assert.ok(Object.isFrozen(point));
      assert.ok(isNpcWalkable(point.x, point.z));
      assert.ok(point.activity && point.activityLabel && point.locationLabel);
    }
    const serialized = JSON.stringify(plan);
    assert.doesNotMatch(serialized, /hiddenTruth|revealCondition|questRef|backstory|reward/);
  }
});

for (const id of ids) {
  test(`${id}: every 50 ms over a complete day stays walkable, bounded, finite and within walking speed`, () => {
    const plan = NPC_PLANS[id];
    let previous = sampleNpc(id, 0), movingCount = 0, stoppedCount = 0;
    for (let ms = 0; ms <= DAY_NIGHT_CYCLE_MS; ms += 50) {
      const npc = sampleNpc(id, ms);
      assert.ok(isNpcWalkable(npc.x, npc.z), `body intersects a solid at ${ms}: ${npc.x}, ${npc.z}`);
      for (const field of ['x', 'z', 'yaw']) assert.ok(Number.isFinite(npc[field]), `${field} invalid at ${ms}`);
      assert.equal(typeof npc.moving, 'boolean');
      assert.ok(npc.activity && npc.activityLabel && npc.locationLabel);
      assert.ok(distance(previous, npc) <= plan.speed * 0.05 + 1e-8, `teleport / speeding at ${ms}`);
      if (npc.moving) movingCount++; else stoppedCount++;
      previous = npc;
    }
    assert.ok(movingCount > 100, 'route must include visible walking, not just changing labels');
    assert.ok(stoppedCount > 100, 'resident must stop to work / rest');
  });
}

test('dawn, dusk, segment junctions and day wrapping have no positional jumps', () => {
  for (const id of ids) {
    const plan = NPC_PLANS[id];
    const boundaries = [0, DAY_NIGHT_CYCLE_MS, plan.activeStartMs, plan.activeStartMs + plan.activeDurationMs,
      ...plan.segments.map(segment => plan.activeStartMs + segment.end)];
    for (const boundary of boundaries) {
      assert.ok(distance(sampleNpc(id, boundary - 0.001), sampleNpc(id, boundary + 0.001)) <= plan.speed * 0.000002 + 1e-7,
        `${id} jumps at ${boundary}`);
    }
  }
});

test('ordinary residents rest at midnight while the lamplighter works a night route', () => {
  for (const id of ids.filter(id => id !== 'npc-dengcheng')) {
    const night = sampleNpc(id, 90_000), home = NPC_PLANS[id].home;
    assert.equal(night.activity, 'rest');
    assert.equal(night.moving, false);
    close(night.x, home.x);
    close(night.z, home.z);
    assert.match(night.activityLabel, /仍可.*交谈/);
    assert.notEqual(sampleNpc(id, 0).activity, 'rest');
  }
  assert.equal(sampleNpc('npc-dengcheng', 0).activity, 'repair');
  assert.notEqual(sampleNpc('npc-dengcheng', 90_000).activity, 'rest');
  const nightPositions = [60_000, 75_000, 90_000, 105_000, 120_000].map(ms => sampleNpc('npc-dengcheng', ms));
  assert.ok(nightPositions.some(npc => npc.moving && npc.activity === 'patrol'));
  assert.ok(distance(nightPositions[0], nightPositions.at(-1)) > 5);
});

test('same world time produces the same position regardless of sample history, frame rate or day number', () => {
  for (const id of ids) {
    for (const time of [0, 12_345, 49_999, 60_000, 90_000, 130_000, 179_999]) {
      const expected = sampleNpc(id, time);
      sampleNpc(id, 5_000);
      sampleNpc(id, 170_000);
      assert.deepEqual(sampleNpc(id, time), expected);
      assert.deepEqual(sampleNpc(id, time + DAY_NIGHT_CYCLE_MS * 100), expected);
      assert.deepEqual(sampleNpc(id, time - DAY_NIGHT_CYCLE_MS * 100), expected);
    }
    const result = sampleNpc(id, 0);
    result.x = 999;
    result.activityLabel = 'mutated';
    assert.notEqual(sampleNpc(id, 0).x, 999);
    assert.notEqual(sampleNpc(id, 0).activityLabel, 'mutated');
  }
});

test('invalid ids fail closed and invalid clocks use the noon baseline', () => {
  for (const id of [null, undefined, '', 'missing', '__proto__', 'constructor', {}, [], 0]) assert.equal(sampleNpc(id, 0), null);
  for (const invalid of [NaN, Infinity, -Infinity, undefined, null, '90000', {}, []]) {
    assert.deepEqual(sampleNpc('npc-alan', invalid), sampleNpc('npc-alan', 0));
  }
  assert.deepEqual(sampleNpc('npc-alan', -90_000), sampleNpc('npc-alan', 90_000));
});

test('the resident body margin excludes fountains, building edges, trees and world edges', () => {
  assert.ok(isWalkable(FOUNTAIN.radius + 0.1, FOUNTAIN.z));
  assert.equal(isNpcWalkable(FOUNTAIN.radius + 0.1, FOUNTAIN.z), false);
  assert.ok(isNpcWalkable(FOUNTAIN.radius + NPC_BODY_RADIUS + 0.01, FOUNTAIN.z));
  for (const place of WORLD_LOCATIONS) {
    assert.ok(isWalkable(place.x + 3.32, place.z));
    assert.equal(isNpcWalkable(place.x + 3.32, place.z), false);
  }
  for (const [x, z, scale] of TREE_POSITIONS) assert.equal(isNpcWalkable(x + 0.5 * scale + 0.1, z), false);
  assert.equal(isNpcWalkable(WORLD_BOUNDS.maxX - 0.1, 0), false);
  assert.equal(isNpcWalkable(0, WORLD_BOUNDS.minZ + 0.1), false);
  for (const invalid of [NaN, Infinity, undefined, '0']) assert.equal(isNpcWalkable(invalid, 10), false);
});

test('new players can immediately talk to a nearby resident with a four-unit range', () => {
  const nearest = findNearestNpc(SPAWN, 0);
  assert.equal(nearest.id, 'npc-alan');
  assert.ok(nearest.distance > 0 && nearest.distance < 4);
  close(nearest.distance, distance(nearest, SPAWN));
  assert.ok(distance(sampleNpc('npc-juya', 0), SPAWN) < 4, 'animal guide also starts near the player');
  assert.equal(findNearestNpc(SPAWN, 0, 0.5), null);
});

test('night rest does not disable interaction and an exactly matching position is valid', () => {
  for (const id of ids) {
    const npc = sampleNpc(id, 90_000);
    const nearest = findNearestNpc(npc, 90_000, 0.01);
    assert.equal(nearest.id, id);
    assert.equal(nearest.distance, 0);
  }
});

test('nearby selection uses a clear sightline rather than reaching through solid scenery', () => {
  // 北冬 is geometrically closest, but the tree at (-28, -28.7) hides the
  // diagonal. All other residents are farther than the interaction radius.
  const player = { x: -27, z: -31 };
  assert.ok(isWalkable(player.x, player.z));
  const npc = sampleNpc('npc-beidong', 0);
  assert.ok(distance(player, npc) < 8);
  assert.equal(findNearestNpc(player, 0, 8), null);
  assert.equal(findNearestNpc({ x: FOUNTAIN.x, z: FOUNTAIN.z }, 0, 100), null);
});

test('invalid proximity inputs never produce an interaction', () => {
  for (const invalid of [null, undefined, {}, { x: NaN, z: 0 }, { x: 0, z: Infinity }, { x: '0', z: 0 }]) {
    assert.equal(findNearestNpc(invalid, 0), null);
  }
  for (const range of [0, -1, NaN, Infinity, '4', null]) assert.equal(findNearestNpc(SPAWN, 0, range), null);
});
