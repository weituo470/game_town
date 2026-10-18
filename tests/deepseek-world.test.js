import test from 'node:test';
import assert from 'node:assert/strict';
import { DEEPSEEK_PARK, PARK_SCALE, PARK_LOCAL_GROUND_Y, PARK_BRIDGE, PARK_BRIDGES, PARK_ARRIVAL, PARK_WALK_ROUTE,
  PARK_TOWERS, PARK_SOLIDS, PARK_PILLARS, PARK_PEDESTAL, PARK_FOUNTAIN, PARK_LAYER_STACK,
  inParkGround, parkSolid, parkFlightFloor, parkDestination, parkLocalToWorld } from '../shared/deepseek-park.js';
import { WORLD_BOUNDS, WORLD_LOCATIONS, DISTRICTS, SPAWN, PLAYER_SPEED, getDestination, isWalkable, movePlayer } from '../shared/world.js';
import { WONDERS, WONDER_MAP, EXPLORATION_BOUNDS } from '../shared/wonders.js';
import { GPT_PARK } from '../shared/gpt-park.js';
import { RIVER } from '../shared/river.js';
import { stepAvatar, flightFloor, safeLanding, stoppedVertical } from '../shared/jetpack.js';
import { followTarget, followOrbitCamera } from '../src/components/town/camera.js';
import { closeThirdPersonCamera } from '../src/components/town/firstPerson.js';

const overlap = (a, b) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('DeepSeek keeps the original local model at a compact shared waterfront scale', () => {
  assert.equal(PARK_SCALE, .48); assert.equal(PARK_LOCAL_GROUND_Y, .335);
  assert.deepEqual(parkLocalToWorld(0, 0), { x: -79, z: -80 });
  assert.equal(DEEPSEEK_PARK.width, 140 * PARK_SCALE); assert.equal(DEEPSEEK_PARK.depth, 140 * PARK_SCALE);
  assert.equal(DEEPSEEK_PARK.radius, 70 * PARK_SCALE);
  assert.equal(PARK_TOWERS.length, 6); assert.equal(PARK_PILLARS.length, 2);
  for (const tower of PARK_TOWERS) {
    close(Math.hypot(tower.x - DEEPSEEK_PARK.x, tower.z - DEEPSEEK_PARK.z), 30 * PARK_SCALE);
    close(tower.radius, 3.6 * PARK_SCALE);
    close(tower.height, (tower.localHeight + 2.87 - PARK_LOCAL_GROUND_Y) * PARK_SCALE);
  }
  close(PARK_PEDESTAL.visualRadius, 15.5 * PARK_SCALE);
  assert.deepEqual({ x: PARK_LAYER_STACK.x, z: PARK_LAYER_STACK.z }, parkLocalToWorld(0, -32));
  assert.deepEqual({ x: PARK_FOUNTAIN.x, z: PARK_FOUNTAIN.z }, parkLocalToWorld(0, 27));
});

test('northwest park and connecting promenade do not overlap GPT, wonders, town plots or river', () => {
  for (const location of [...WONDERS, GPT_PARK, RIVER]) assert.equal(overlap(DEEPSEEK_PARK, location), false, location.id || 'river');
  for (const bridge of PARK_BRIDGES) assert.equal(overlap(bridge, RIVER), false, bridge.id);
  assert.ok(DEEPSEEK_PARK.x + DEEPSEEK_PARK.width / 2 < WORLD_BOUNDS.minX);
  assert.ok(DEEPSEEK_PARK.z + DEEPSEEK_PARK.depth / 2 < WORLD_BOUNDS.minZ);
  assert.equal(PARK_BRIDGE.x, -38); assert.equal(PARK_BRIDGE.width, 7);
  const bounds = { minX: WONDER_MAP.centerX - WONDER_MAP.width / 2, maxX: WONDER_MAP.centerX + WONDER_MAP.width / 2,
    minZ: WONDER_MAP.centerZ - WONDER_MAP.depth / 2, maxZ: WONDER_MAP.centerZ + WONDER_MAP.depth / 2 };
  for (const area of [DEEPSEEK_PARK, GPT_PARK, ...WONDERS, ...PARK_BRIDGES]) {
    assert.ok(area.x - area.width / 2 > bounds.minX && area.x + area.width / 2 < bounds.maxX);
    assert.ok(area.z - area.depth / 2 > bounds.minZ && area.z + area.depth / 2 < bounds.maxZ);
  }
});

test('park travel is immutable and all existing destinations remain valid', () => {
  assert.deepEqual(parkDestination('deepseek'), PARK_ARRIVAL);
  assert.deepEqual(getDestination('deepseek'), PARK_ARRIVAL); assert.equal(parkDestination('gpt'), null);
  const copy = getDestination('deepseek'); copy.x = 0; assert.equal(getDestination('deepseek').x, -79);
  for (const id of ['deepseek', 'center', 'fishing', 'gpt', ...WONDERS.map(item => item.id), ...DISTRICTS.map(item => item.id), ...WORLD_LOCATIONS.map(item => item.id)]) {
    const arrival = getDestination(id); assert.ok(arrival && isWalkable(arrival.x, arrival.z), id);
  }
});

test('the whole L-shaped promenade is continuously walkable in both directions without teleportation', () => {
  let state = { ...PARK_WALK_ROUTE[0], yaw: Math.PI };
  for (const target of [...PARK_WALK_ROUTE.slice(1), ...PARK_WALK_ROUTE.slice(0, -1).reverse()]) {
    let count = 0;
    while (Math.hypot(target.x - state.x, target.z - state.z) > .001 && count++ < 2000) {
      const dx = target.x - state.x, dz = target.z - state.z, distance = Math.hypot(dx, dz);
      state = movePlayer(state, { x: dx / distance, z: dz / distance }, Math.min(.1, distance / PLAYER_SPEED));
      assert.ok(isWalkable(state.x, state.z));
    }
    assert.ok(count < 2000, `route stopped before ${target.x},${target.z}`);
    close(state.x, target.x); close(state.z, target.z);
  }
});

test('spawn reaches the new island on the same authoritative walk mesh', () => {
  const start = [Math.round(SPAWN.x), Math.round(SPAWN.z)], goal = [Math.round(PARK_ARRIVAL.x), Math.round(PARK_ARRIVAL.z)].join(',');
  const queue = [start], seen = new Set([start.join(',')]);
  for (let i = 0; i < queue.length && !seen.has(goal); i++) {
    const [x, z] = queue[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${x + dx},${z + dz}`;
      if (!seen.has(key) && isWalkable(x + dx, z + dz) && isWalkable(x + dx / 2, z + dz / 2)) { seen.add(key); queue.push([x + dx, z + dz]); }
    }
  }
  assert.ok(seen.has(goal));
});

test('sea, circular-island corners and malformed coordinates never become walkable land', () => {
  for (const [x, z] of [[-136, -131], [-54, -131], [-136, -49], [-54, -49], [-95, -135], [-140, -90], [-66.5, -38], [-66.5, -47]]) {
    assert.equal(inParkGround(x, z), false, `${x},${z}`); assert.equal(isWalkable(x, z), false, `${x},${z}`);
  }
  for (const invalid of [NaN, Infinity, -Infinity, null, '0', undefined]) {
    assert.equal(inParkGround(invalid, -90), false); assert.equal(inParkGround(-95, invalid), false);
    assert.equal(parkSolid(invalid, -90), false); assert.equal(parkFlightFloor(-95, invalid), 0);
  }
});

test('source-aligned structures stop walking and low flight but can be flown over and landed on', () => {
  for (const solid of PARK_SOLIDS) {
    assert.equal(parkSolid(solid.x, solid.z), true, solid.id); assert.equal(isWalkable(solid.x, solid.z), false, solid.id);
    close(flightFloor(solid.x, solid.z), parkFlightFloor(solid.x, solid.z)); assert.ok(solid.height > 0);
  }
  const tower = PARK_TOWERS[1], begin = { x: tower.x - 6, z: tower.z, yaw: 0, jetpack: true, thrusting: false };
  let low = { ...begin, y: .5, vy: 0 }, high = { ...begin, y: tower.height + 4, vy: 0 };
  for (let i = 0; i < 30; i++) {
    low = stepAvatar(low, { x: 1, z: 0, hover: true }, .05);
    high = stepAvatar(high, { x: 1, z: 0, hover: true }, .05);
  }
  assert.ok(low.x < tower.x - tower.radius, 'low pilot cannot pass through tower');
  assert.ok(high.x > tower.x + tower.radius, 'high pilot clears the real roof');
  let landing = { ...begin, x: tower.x, y: tower.height + 4, vy: 0 };
  for (let i = 0; i < 100; i++) landing = stepAvatar(landing, { x: 0, z: 0 }, .05);
  close(landing.y, tower.height); assert.equal(landing.vy, 0); assert.equal(landing.hovering, false);
});

test('following and close-third-person cameras use park terrain and roof collision at ground and flight heights', () => {
  for (const width of [390, 1280]) for (const pose of [PARK_ARRIVAL, { x: DEEPSEEK_PARK.x-26, z: DEEPSEEK_PARK.z }]) {
    const target = followTarget(pose, width);
    assert.equal(target.x, pose.x); assert.ok(Math.abs(target.z - pose.z) <= 2.5);
    assert.ok(target.x < WORLD_BOUNDS.minX);
  }
  const tower = PARK_TOWERS[1];
  const pose = { x: tower.x - tower.radius - .5, y: 0, z: tower.z };
  for (const orbit of [closeThirdPersonCamera, followOrbitCamera]) {
    const low = orbit(pose, -Math.PI / 2, .38, { aspect: 16 / 9 });
    assert.equal(low.clipped, true);
    const high = orbit({ ...pose, y: tower.height + 3 }, -Math.PI / 2, .38, { aspect: 16 / 9 });
    assert.equal(high.clipped, false);
  }
});

test('unlimited-altitude flight reaches the new island, remains horizontally bounded and descends safely', () => {
  let state = { ...PARK_WALK_ROUTE[0], y: 90, vy: 0, jetpack: true, hovering: true, thrusting: false };
  for (const target of [PARK_ARRIVAL, PARK_WALK_ROUTE[0]]) {
    for (let i = 0; i < 1000; i++) {
      const dx = target.x - state.x, dz = target.z - state.z, distance = Math.hypot(dx, dz);
      if (distance < .001) break;
      state = stepAvatar(state, { x: dx / distance, z: dz / distance, hover: true }, Math.min(.05, distance / 8));
    }
    close(state.x, target.x); close(state.z, target.z); assert.equal(state.y, 90);
  }
  state = { ...state, ...stoppedVertical(state) };
  for (let i = 0; i < 300; i++) state = stepAvatar(state, { x: 0, z: 0 }, .05);
  assert.equal(state.y, 0); assert.equal(state.hovering, false); assert.ok(isWalkable(state.x, state.z));
  state = { ...state, x: -137, z: -90, y: 90, jetpack: true };
  for (let i = 0; i < 100; i++) state = stepAvatar(state, { x: -1, z: -1, hover: true }, .05);
  assert.ok(state.x >= EXPLORATION_BOUNDS.minX && state.z >= EXPLORATION_BOUNDS.minZ);
  const rescued = safeLanding(-137, -90); assert.ok(isWalkable(rescued.x, rescued.z));
});
