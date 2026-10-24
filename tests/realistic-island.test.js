import test from 'node:test';
import assert from 'node:assert/strict';
import { REALISTIC_ISLAND as I, ISLAND_TRAIL, ISLAND_MAX_WALK_SLOPE, islandDistance, islandHeight, inRealisticIsland, islandSlope, islandWalkable, islandCanStep, islandDestination } from '../shared/realistic-island.js';
import { groundHeight, isWalkable, getDestination, movePlayer, SPAWN, PLAYER_SPEED } from '../shared/world.js';
import { EXPLORATION_BOUNDS, WONDERS } from '../shared/wonders.js';
import { stepAvatar, startAvatarJump, flightFloor, stoppedVertical, safeLanding } from '../shared/jetpack.js';
import { railPoint } from '../shared/space-rail.js';
import { sampleOffshoreVoyage } from '../shared/offshore-island.js';
import { makeTownRoom, validInput } from '../server/TownRoom.js';
import { JUMP_MAX_HEIGHT } from '../shared/jump.js';

const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const actor = (x = I.arrival.x, z = I.arrival.z) => ({ x, z, y: groundHeight(x, z), yaw: 0, vy: 0, jetpack: false, thrusting: false, hovering: false });
function run(state, input, seconds, fps = 60) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / fps) Object.assign(state, stepAvatar(state, input, Math.min(1 / fps, seconds - t)));
  return state;
}

test('the additive natural island fits exploration bounds without covering the town, ship or tube railway', () => {
  assert.deepEqual([I.x, I.z, I.width, I.depth], [280, 120, 220, 170]);
  assert.ok(I.x - I.width / 2 > 100);
  assert.ok(I.x + I.width / 2 < EXPLORATION_BOUNDS.maxX);
  assert.ok(I.z + I.depth / 2 < EXPLORATION_BOUNDS.maxZ);
  for (const point of [SPAWN, ...WONDERS]) assert.ok(islandDistance(point.x, point.z) > 1);
  for (let t = 0; t <= 1; t += .01) {
    const rail = railPoint(t); assert.ok(islandDistance(rail[0], rail[2]) > 1);
    const ship = sampleOffshoreVoyage({ startAt: 1 }, 1 + t * 150000); assert.ok(islandDistance(ship.x, ship.z) > 1);
  }
});

test('the shared heightfield is finite, deterministic, bounded and joins the existing sea through a submerged skirt', () => {
  let highest = -Infinity, lowest = Infinity;
  for (let x = 168; x <= 392; x += 2) for (let z = 33; z <= 207; z += 2) {
    const h = islandHeight(x, z); assert.ok(Number.isFinite(h)); assert.equal(h, islandHeight(x, z));
    highest = Math.max(highest, h); lowest = Math.min(lowest, h);
  }
  assert.ok(highest > 30 && highest < I.maxHeight); assert.ok(lowest >= -3.001);
  for (const [x, z] of [[170, 120], [390, 120], [280, 35], [280, 205]]) assert.equal(islandHeight(x, z), -3);
  assert.equal(I.seaLevel, -1.28);
  for (const [x, z] of [[NaN, 0], [Infinity, 0], [0, -Infinity], ['280', 120]]) {
    assert.equal(inRealisticIsland(x, z), false); assert.equal(islandWalkable(x, z), false); assert.equal(islandHeight(x, z), -3);
  }
});

test('server-approved arrival carries absolute height and cannot mutate the geometry contract', () => {
  const destination = getDestination(I.id);
  assert.deepEqual(destination, islandDestination(I.id)); assert.ok(destination.y > 1); assert.ok(isWalkable(destination.x, destination.z));
  close(destination.y, groundHeight(destination.x, destination.z)); destination.x = 0;
  assert.equal(getDestination(I.id).x, I.arrival.x); assert.equal(islandDestination('not-an-island'), null);
  assert.equal(groundHeight(SPAWN.x, SPAWN.z), 0);
});

test('a continuous hiking trail reaches the high overlook on the exact rendered support surface', () => {
  const state = actor();
  for (let index = 1; index < ISLAND_TRAIL.length; index++) {
    const next = ISLAND_TRAIL[index]; let frames = 0;
    while (Math.hypot(next.x - state.x, next.z - state.z) > .12 && frames++ < 3000) {
      const dx = next.x - state.x, dz = next.z - state.z, d = Math.hypot(dx, dz);
      Object.assign(state, stepAvatar(state, { x: dx / d, z: dz / d }, Math.min(1 / 60, d / PLAYER_SPEED)));
      assert.ok(isWalkable(state.x, state.z)); close(state.y, islandHeight(state.x, state.z)); assert.equal(state.jetpack, false);
    }
    assert.ok(frames < 3000, `trail segment ${index} is continuously reachable`);
  }
  assert.ok(state.y > 30);
});

test('steep eastern cliffs are solid to walking and low flight rather than invisible terrain', () => {
  let steep;
  for (let x = 348; x < 381 && !steep; x += .25) for (let z = 80; z <= 112; z += 1) {
    if (inRealisticIsland(x, z) && islandSlope(x, z) > ISLAND_MAX_WALK_SLOPE + .3) { steep = { x, z }; break; }
  }
  assert.ok(steep); assert.equal(isWalkable(steep.x, steep.z), false);
  close(flightFloor(steep.x, steep.z), islandHeight(steep.x, steep.z));
  assert.equal(islandCanStep(steep.x - .1, steep.z, steep.x, steep.z), false);
  const stopped = movePlayer({ ...steep, yaw: 0 }, { x: .2, z: .2 }, 0);
  close(stopped.x, steep.x); close(stopped.z, steep.z);
});

test('jumping and landing on a mountain use relative height, never the old global Y=0 floor', () => {
  for (const position of [I.arrival, ISLAND_TRAIL[4], I.summit]) {
    const state = actor(position.x, position.z), floor = state.y, jump = startAvatarJump(state);
    assert.ok(jump); Object.assign(state, jump); let peak = floor;
    for (let t = 0; t < 1.3; t += 1 / 120) { Object.assign(state, stepAvatar(state, {}, 1 / 120)); peak = Math.max(peak, state.y); assert.ok(state.y >= floor); }
    close(peak - floor, JUMP_MAX_HEIGHT, .002); close(state.y, floor); assert.equal(state.vy, 0); assert.ok(startAvatarJump(state));
  }
});

test('slope walking remains on the ground while downhill movement and moving jumps do not hover or bury feet', () => {
  const state = actor(269, 127);
  for (const input of [{ x: 1, z: -.3 }, { x: -1, z: .3 }]) {
    run(state, input, 1); close(state.y, groundHeight(state.x, state.z)); assert.equal(state.jetpack, false);
  }
  Object.assign(state, startAvatarJump(state));
  for (let i = 0; i < 150; i++) {
    Object.assign(state, stepAvatar(state, { x: -.5, z: .5 }, 1 / 120)); assert.ok(state.y >= groundHeight(state.x, state.z));
  }
  close(state.y, groundHeight(state.x, state.z));
});

test('jetpack launches, hovers and returns to walking on the island at different frame rates', () => {
  for (const fps of [15, 60, 120]) {
    const state = actor(282, 111), floor = state.y;
    run(state, { thrust: true }, 2, fps); assert.ok(state.y > floor + 10); assert.equal(state.jetpack, true);
    const altitude = state.y; run(state, { hover: true }, .7, fps); close(state.y, altitude); assert.equal(state.hovering, true);
    run(state, {}, 8, fps); close(state.y, floor); assert.equal(state.jetpack, false); assert.equal(state.hovering, false);
    Object.assign(state, stepAvatar(state, { x: .5, z: 0 }, .05)); close(state.y, groundHeight(state.x, state.z));
  }
});

test('stopping and safe landing preserve elevated ground without weakening intent validation', () => {
  const state = actor(I.summit.x, I.summit.z), stopped = stoppedVertical(state);
  close(stopped.y, state.y); assert.equal(stopped.jetpack, false);
  const safe = safeLanding(state.x, state.z); assert.deepEqual(safe, { x: state.x, z: state.z });
  assert.equal(validInput({ x: 0, z: 0, seq: 1, y: 30 }), false);
  const rescued = stepAvatar({ ...actor(184, 148), y: .01, vy: -3, jetpack: true }, {}, .1);
  assert.equal(rescued.rescued, true); assert.ok(isWalkable(rescued.x, rescued.z));
  close(rescued.y, groundHeight(rescued.x, rescued.z)); assert.ok(rescued.y > 0);
});

function roomHarness() {
  let now = 1000;
  const Room = makeTownRoom({ identity: {}, roomCodes: new Map(), now: () => now });
  const room = Object.create(Room.prototype), id = 'island-pilot', player = { ...actor(), connected: true, seq: -1 };
  Object.defineProperty(room, 'state', { value: { tick: 0, serverTime: now, players: new Map([[id, player]]) } });
  room.inputs = new Map(); room.controls = new Map([[id, { seq: -1, travelAt: -Infinity, noticesAt: -Infinity, invalid: 0 }]]);
  room.trace = () => {}; room.allowReconnection = () => Promise.resolve(); room.hasReservedSeat = () => true;
  const client = { sessionId: id, send() {}, leave() {} }; let sequence = 0;
  return { room, player, client, tick: () => { now += 50; room.step(50); }, wait: ms => { now += ms; },
    input: intent => room.receiveInput(client, { x: 0, z: 0, seq: sequence++, ...intent }) };
}

test('room authority approves the island, preserves elevated travel/drop/reconnect height, then returns to town', () => {
  const h = roomHarness(); Object.assign(h.player, actor(SPAWN.x, SPAWN.z));
  h.room.receiveTravel(h.client, { id: I.id }); close(h.player.y, groundHeight(I.arrival.x, I.arrival.z)); assert.ok(h.player.y > 0);
  h.input({ x: 1 }); for (let i = 0; i < 4; i++) h.tick(); close(h.player.y, groundHeight(h.player.x, h.player.z));
  const landing = { x: h.player.x, z: h.player.z };
  h.room.onDrop(h.client, 1001); assert.equal(h.player.connected, false); close(h.player.y, groundHeight(landing.x, landing.z));
  h.room.onReconnect(h.client); assert.equal(h.player.connected, true); close(h.player.y, groundHeight(landing.x, landing.z));
  h.wait(600); h.room.receiveTravel(h.client, { id: 'center' }); assert.equal(h.player.y, 0); assert.equal(h.player.x, 0);
});
