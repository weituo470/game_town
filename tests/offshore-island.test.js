import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Vector3 } from 'three';
import { OFFSHORE_ISLAND, OFFSHORE_DOCK, OFFSHORE_BRIDGE, OFFSHORE_ARRIVAL, OFFSHORE_CRUISE_MS, offshoreSeatLocal, inOffshoreGround, offshorePlan, offshoreTime, sampleOffshoreVoyage, sampleOffshorePassenger, canBoardOffshore } from '../shared/offshore-island.js';
import { getDestination, isWalkable, WORLD_BOUNDS, movePlayer } from '../shared/world.js';
import { EXPLORATION_BOUNDS, WONDER_MAP } from '../shared/wonders.js';
import { makeTownRoom, validOffshore } from '../server/TownRoom.js';
import { snapshotFromState, rosterSignature } from '../src/lib/useMultiplayer.js';
import { createOffshoreRuntime } from '../src/lib/useOffshoreCruise.js';

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} ~= ${b}`);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('offshore adds only a connected solid pier, not a walkable ocean or moving ship', () => {
  assert.deepEqual(OFFSHORE_ARRIVAL, { x: 16, z: 61, yaw: 0 });
  assert.deepEqual(getDestination('offshore'), OFFSHORE_ARRIVAL);
  for (let z = 37; z <= 63.5; z += .2) assert.equal(isWalkable(16, z), true, `bridge continuity ${z}`);
  for (const point of [[6, 58], [26, 58], [16, 67], [16, 85], [0, 180]]) assert.equal(isWalkable(...point), false);
  assert.equal(inOffshoreGround(NaN, 58), false);
  assert.equal(inOffshoreGround(16, Infinity), false);
  let pose = { x: 16, z: 37, yaw: 0 };
  for (let i = 0; i < 100; i++) pose = movePlayer(pose, { x: 0, z: 1 }, .1);
  assert.ok(pose.z >= 63 && pose.z <= 63.8);
  assert.deepEqual(WORLD_BOUNDS, { minX: -42.9, maxX: 42.9, minZ: -38.9, maxZ: 40.3 });
  assert.deepEqual(EXPLORATION_BOUNDS, { minX: -138, maxX: 77, minZ: -133, maxZ: 270 });
  assert.deepEqual(WONDER_MAP, { width: 230, depth: 264, centerX: -31, centerZ: -8 });
  assert.ok(OFFSHORE_DOCK.z + OFFSHORE_DOCK.depth / 2 <= 64);
  assert.ok(OFFSHORE_BRIDGE.z - OFFSHORE_BRIDGE.depth / 2 <= WORLD_BOUNDS.maxZ);
});

test('150 second absolute route closes with continuous phase boundaries and remains south of all islands', () => {
  const plan = { startAt: 1000, returnAt: 0 };
  for (const t of [0, 28000, 112000, 122000, 150000]) {
    const a = sampleOffshoreVoyage(plan, 1000 + Math.max(0, t - .001));
    const b = sampleOffshoreVoyage(plan, 1000 + t + .001);
    assert.ok(distance(a, b) < .001);
    assert.ok(Math.abs(Math.sin(a.yaw - b.yaw)) < .00001);
  }
  const phases = new Set();
  for (let elapsed = 0; elapsed <= OFFSHORE_CRUISE_MS; elapsed += 100) {
    const s = sampleOffshoreVoyage(plan, 1000 + elapsed); phases.add(s.phase);
    assert.ok([s.x, s.y, s.z, s.yaw, s.roll, s.pitch, s.remainingMs].every(Number.isFinite));
    assert.ok(s.x >= -33 && s.x <= 65 && s.z >= 85 && s.z <= 233);
    assert.ok(s.progress >= 0 && s.progress <= 1 && s.remainingMs >= 0);
  }
  assert.deepEqual([...phases], ['departing', 'cruising', 'observing', 'returning', 'docked']);
  const done = sampleOffshoreVoyage(plan, 151000);
  assert.deepEqual([done.x, done.y, done.z, done.yaw, done.roll, done.pitch], [16, 0, 85, 0, 0, 0]);
});

test('early return is position-continuous at every phase and safely docks within 25 seconds', () => {
  const original = { startAt: 1000, returnAt: 0 };
  for (const elapsed of [1, 10000, 27999, 28000, 70000, 112000, 117000, 121999, 140000, 149999]) {
    const now = 1000 + elapsed, plan = { ...original, returnAt: now };
    assert.ok(distance(sampleOffshoreVoyage(original, now), sampleOffshoreVoyage(plan, now)) < 1e-9);
    const next = sampleOffshoreVoyage(plan, now + 10);
    assert.ok(distance(sampleOffshoreVoyage(plan, now), next) < .5);
    const done = sampleOffshoreVoyage(plan, now + 25001);
    assert.equal(done.docked, true); assert.equal(done.z, 85);
  }
});

test('eight reserved passenger stations transform exactly with the tilted moving deck', () => {
  const seats = new Set(), plan = { startAt: 1000, returnAt: 0 };
  for (let seat = 0; seat < 8; seat++) {
    const local = offshoreSeatLocal(seat); seats.add(JSON.stringify(local));
    assert.equal(local.x, -8); assert.equal(local.y, OFFSHORE_ISLAND.deckY); assert.equal(local.z, 4 + seat);
    for (const now of [1000, 17000, 54000, 90000, 127000, 151000]) {
      const s = sampleOffshoreVoyage(plan, now), p = sampleOffshorePassenger(plan, now, seat);
      const expected = new Vector3(local.x, local.y, local.z).applyEuler(new Euler(s.pitch, s.yaw, s.roll)).add(new Vector3(s.x, s.y, s.z));
      close(p.x, expected.x); close(p.y, expected.y); close(p.z, expected.z);
      assert.equal(p.aboard, true); assert.equal(p.jetpack, false); assert.equal(p.moving, false);
    }
  }
  assert.equal(seats.size, 8);
});

test('offshore clock never mixes client wall time with server epoch or cycles day/night', () => {
  assert.equal(offshoreTime({ serverTime: 1000000, receivedAtPerf: 50 }, 80, 999, 0), 1000030);
  assert.equal(offshoreTime(null, 80, 999, 50), 1029);
  assert.deepEqual(offshorePlan({ offshoreStartAt: 2, offshoreReturnAt: 3 }), { startAt: 2, returnAt: 3 });
  assert.deepEqual(offshorePlan({ startAt: NaN, returnAt: Infinity }), { startAt: 0, returnAt: 0 });
  let network = null, now = 10;
  const runtime = createOffshoreRuntime({ getNetwork: () => network, now: () => now, wallNow: () => 9000000 });
  runtime.local.aboard = true; runtime.local.plan.startAt = 9000000;
  now += 1000; assert.equal(runtime.current.now, 9001000); assert.equal(runtime.current.aboard, true);
  network = { status: 'connected', snapshotRef: { current: { selfId: 'a', serverTime: 100000, receivedAtPerf: now, offshoreStartAt: 90000, offshoreReturnAt: 0, players: [{ id: 'a', aboard: true, offshoreSeat: 3 }] } } };
  assert.equal(runtime.current.seat, 3); assert.equal(runtime.current.now, 100000);
  network.status = 'reconnecting'; now += 1200;
  assert.equal(runtime.current.aboard, true); assert.equal(runtime.current.now, 101200);
  network.status = 'error'; assert.equal(runtime.current.aboard, false); assert.equal(runtime.current.sample.docked, true);
});

function harness() {
  let now = 100000;
  const Room = makeTownRoom({ identity: {}, roomCodes: new Map(), now: () => now });
  const room = Object.create(Room.prototype);
  Object.defineProperty(room, 'state', { value: { tick: 0, serverTime: now, offshoreStartAt: 0, offshoreReturnAt: 0, players: new Map() } });
  room.inputs = new Map(); room.controls = new Map(); room.trace = () => {};
  room.allowReconnection = () => Promise.resolve(); room.hasReservedSeat = () => true;
  const add = id => {
    const player = { ...OFFSHORE_ARRIVAL, id, y: 0, vy: 0, connected: true, seq: -1, aboard: false, offshoreSeat: -1, offshoreSeq: -1 };
    room.state.players.set(id, player);
    room.controls.set(id, { seq: -1, travelAt: -Infinity, noticesAt: -Infinity, invalid: 0, offshoreSeq: -1, offshoreAt: -Infinity });
    const notices = [], client = { sessionId: id, send: (_type, value) => notices.push(value), leave() {} };
    let seq = 0;
    return { player, client, notices, act: action => room.receiveOffshore(client, { action, seq: seq++ }) };
  };
  return { room, add, time: () => now, tick: (ms = 400) => { now += ms; room.step(ms); } };
}

test('authority rejects spoofed positions, stale sequence, remote boarding and command floods', () => {
  for (const v of [null, [], { action: 'board', seq: 0, x: 16 }, { action: 'warp', seq: 1 }, { action: 'board', seq: NaN }, { action: 'board', seq: 1.1 }]) assert.equal(validOffshore(v), false);
  assert.equal(validOffshore({ action: 'board', seq: 4 }, 4), false);
  const h = harness(), a = h.add('a'); a.player.x = 0; a.player.z = 0;
  a.act('board'); assert.equal(a.player.aboard, false); assert.equal(a.notices.at(-1).code, 'OFFSHORE_BOARD');
  Object.assign(a.player, OFFSHORE_ARRIVAL); h.tick(); a.act('board'); assert.equal(a.player.aboard, true);
  a.act('depart'); assert.equal(h.room.state.offshoreStartAt, 0, 'same-tick spam cannot change voyage');
  h.tick(); a.act('depart'); assert.equal(h.room.state.offshoreStartAt, h.time());
  h.room.receiveOffshore(a.client, { action: 'return', seq: 0 }); assert.equal(h.room.state.offshoreReturnAt, 0);
});

test('authority carries all eight seats, ignores walking/thrust, forbids travel and disembark at sea', () => {
  const h = harness(), passengers = Array.from({ length: 8 }, (_, i) => h.add(`p${i}`));
  passengers.forEach(p => p.act('board'));
  assert.equal(new Set(passengers.map(p => p.player.offshoreSeat)).size, 8);
  const ninth = h.add('ninth'); ninth.act('board'); assert.equal(ninth.player.aboard, false); assert.equal(ninth.notices.at(-1).code, 'OFFSHORE_FULL');
  h.tick(); passengers[0].act('depart'); h.tick(40000);
  for (const p of passengers) {
    const expect = sampleOffshorePassenger(offshorePlan(h.room.state), h.time(), p.player.offshoreSeat);
    close(p.player.x, expect.x); close(p.player.y, expect.y); close(p.player.z, expect.z);
    h.room.receiveInput(p.client, { seq: 0, x: 1, z: 1, thrust: true });
    assert.equal(p.player.jetpack, false); assert.equal(p.player.vy, 0);
  }
  const a = passengers[0], before = { ...a.player };
  h.room.receiveTravel(a.client, { id: 'center' }); close(a.player.z, before.z); assert.equal(a.player.aboard, true);
  h.tick(); a.act('disembark'); assert.equal(a.player.aboard, true);
  h.tick(); a.act('return'); assert.ok(h.room.state.offshoreReturnAt > 0);
  h.tick(25001); assert.equal(sampleOffshoreVoyage(offshorePlan(h.room.state), h.time()).docked, true);
  a.act('disembark'); assert.equal(a.player.aboard, false); assert.deepEqual([a.player.x, a.player.y, a.player.z], [16, 0, 61]);
  assert.ok(isWalkable(a.player.x, a.player.z));
});

test('drop/reconnect preserves reserved station while vessel moves; leave releases it atomically', () => {
  const h = harness(), a = h.add('a'), b = h.add('b'); a.act('board'); b.act('board');
  h.tick(); a.act('depart'); h.tick(10000);
  h.room.onDrop(a.client, 1006); assert.equal(a.player.aboard, true); assert.equal(a.player.connected, false);
  const seat = a.player.offshoreSeat, oldZ = a.player.z;
  h.tick(5000); assert.notEqual(a.player.z, oldZ); assert.equal(a.player.offshoreSeat, seat);
  h.room.onReconnect(a.client); assert.equal(a.player.connected, true); assert.equal(a.player.aboard, true); assert.equal(a.player.offshoreSeat, seat);
  h.room.onLeave(a.client, 1000); assert.equal(h.room.state.players.has('a'), false); assert.equal(h.room.controls.has('a'), false);
  h.tick(200000); const c = h.add('c'); c.act('board'); assert.equal(c.player.offshoreSeat, seat);
});

test('plain snapshots include vessel plan/seats and roster reacts only to membership changes', () => {
  const h = harness(), a = h.add('a'); a.act('board'); h.tick(); a.act('depart'); h.tick();
  const snap = snapshotFromState(h.room.state, 'a');
  assert.equal(snap.offshoreStartAt, h.room.state.offshoreStartAt); assert.equal(snap.players[0].aboard, true);
  const s = snap.players[0]; assert.notEqual(rosterSignature([s]), rosterSignature([{ ...s, aboard: false }]));
  assert.equal(rosterSignature([s]), rosterSignature([{ ...s, x: 77, offshoreSeq: 999 }]));
  assert.equal(canBoardOffshore({ ...OFFSHORE_ARRIVAL, y: 10 }, {}, h.time()), false);
});
