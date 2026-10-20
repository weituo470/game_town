import test from 'node:test';
import assert from 'node:assert/strict';
import { stepAvatar, stepFlightVertical, stoppedVertical, flightFloor } from '../shared/jetpack.js';
import { SPAWN, getDestination, isWalkable } from '../shared/world.js';
import { INPUT_TIMEOUT_MS, PROTOCOL_VERSION } from '../shared/protocol.js';
import { makeTownRoom, validInput } from '../server/TownRoom.js';
import { sequencedInput } from '../src/components/town/inputSequence.js';
import { snapshotFromState } from '../src/lib/useMultiplayer.js';

const airborne = (height = 180) => ({ ...SPAWN, y: height, vy: 7, jetpack: true, thrusting: true, hovering: false });

test('hover locks the current altitude, not a client-supplied target, at every simulation rate', () => {
  for (const hz of [15, 20, 60, 120]) {
    let state = airborne();
    for (let i = 0; i < hz * 3; i++) state = { ...state, ...stepAvatar(state, { x: 1, z: 0, hover: true }, 1 / hz) };
    assert.equal(state.y, 180); assert.equal(state.vy, 0);
    assert.equal(state.hovering, true); assert.equal(state.thrusting, false);
    assert.equal(state.jetpack, true); assert.ok(state.x > SPAWN.x + 23);
  }
});

test('hover ignores a grounded request, clears on landing, and supports surfaces above the old 24 m ceiling', () => {
  const ground = stepFlightVertical({ y: 0, vy: 0 }, false, 0.1, 0, true);
  assert.deepEqual(ground, { y: 0, vy: 0, jetpack: false, thrusting: false, hovering: false });
  const roof = stepFlightVertical({ y: 35, vy: -1, hovering: true }, false, 0.1, 35, true);
  assert.equal(roof.y, 35); assert.equal(roof.vy, 0); assert.equal(roof.hovering, false);
  const landing = stepFlightVertical({ y: 35.05, vy: -8, hovering: true }, false, 0.1, 35);
  assert.equal(landing.y, 35); assert.equal(landing.hovering, false);
  const launched = stepFlightVertical(roof, true, 0.1, 35);
  assert.ok(launched.y > 35); assert.equal(launched.thrusting, true);
});

test('thrust takes priority; releasing or stopping hover immediately resumes gravity without teleporting', () => {
  const state = { ...airborne(), vy: 0, thrusting: false, hovering: true };
  const thrust = stepFlightVertical(state, true, 0.1, 0, true);
  assert.ok(thrust.y > state.y); assert.equal(thrust.hovering, false); assert.equal(thrust.thrusting, true);
  const release = stepFlightVertical(state, false, 0.1);
  assert.ok(release.y < state.y); assert.ok(release.vy < 0); assert.equal(release.hovering, false);
  const stopped = { ...state, ...stoppedVertical(state) };
  assert.equal(stopped.y, state.y); assert.equal(stopped.hovering, false);
  assert.ok(stepFlightVertical(stopped, false, 0.1).y < state.y);
});

test('finite-state guards remain strict without introducing an altitude cap or Infinity', () => {
  for (const state of [null, {}, { y: Infinity, vy: NaN }, { y: -Infinity, vy: Infinity }, { y: Number.MAX_VALUE, vy: Number.MAX_VALUE }]) {
    for (const seconds of [NaN, Infinity, -1, 0.1, 5]) {
      const result = stepFlightVertical(state, true, seconds);
      assert.ok(Number.isFinite(result.y)); assert.ok(Number.isFinite(result.vy));
      assert.doesNotMatch(JSON.stringify(result), /null|Infinity|NaN/);
    }
  }
  const high = stepFlightVertical({ y: 10000, vy: 7 }, true, 0.1);
  assert.ok(high.y > 10000);
  assert.equal(stepFlightVertical({ y: 10000, vy: 0 }, false, 0.1, 0, true).y, 10000);
});

test('hover crosses the protocol as boolean intent only, including explicit cancellation', () => {
  const snapshot = { selfId: 'self', players: [{ id: 'self', seq: 10, connected: true }] };
  for (const hover of [true, false]) {
    const packet = sequencedInput({ x: 0.5, z: 0, thrust: false, hover, y: 500, targetHeight: 500 }, 0, snapshot, 'self');
    assert.deepEqual(packet, { x: 0.5, z: 0, seq: 11, thrust: false, hover });
    assert.equal(validInput(packet, 10), true);
  }
  for (const extra of [{ hover: 1 }, { hover: 'true' }, { hover: null }, { hover: true, thrust: true }, { hover: true, jump: true }, { hover: true, stop: true }]) {
    const input = { x: 0, z: 0, seq: 11, ...extra };
    assert.equal(validInput(input, 10), false);
    assert.equal(sequencedInput(input, 0, snapshot, 'self'), null);
  }
  for (const extra of [{ y: 500 }, { vy: 99 }, { targetHeight: 500 }, { hovering: true }]) assert.equal(validInput({ x: 0, z: 0, seq: 11, hover: true, ...extra }, 10), false);
});

test('authoritative snapshots copy hover state safely without adding altitude limits', () => {
  const player = { ...airborne(10000), hovering: true, thrusting: false, vy: 0 };
  const state = { tick: 1, players: new Map([['self', player]]) };
  const snapshot = snapshotFromState(state, 'self');
  assert.equal(snapshot.players[0].hovering, true); assert.equal(snapshot.players[0].y, 10000);
  player.hovering = false; assert.equal(snapshot.players[0].hovering, true);
  player.hovering = 'true'; assert.equal(snapshotFromState(state, 'self').players[0].hovering, false);
});

function roomHarness() {
  let now = 1000;
  const Room = makeTownRoom({ identity: {}, roomCodes: new Map(), now: () => now });
  const room = Object.create(Room.prototype), id = 'pilot';
  const player = { ...SPAWN, y: 0, vy: 0, jetpack: false, thrusting: false, hovering: false, connected: true, seq: -1 };
  Object.defineProperty(room, 'state', { value: { tick: 0, serverTime: now, players: new Map([[id, player]]) } });
  room.inputs = new Map(); room.controls = new Map([[id, { seq: -1, travelAt: -Infinity, noticesAt: -Infinity, invalid: 0 }]]);
  room.trace = () => {};
  room.allowReconnection = () => Promise.resolve();
  room.hasReservedSeat = () => true;
  let sequence = 0;
  const client = { sessionId: id, send() {}, leave() {} };
  return {
    room, player, client,
    input: intent => room.receiveInput(client, { x: 0, z: 0, seq: sequence++, ...intent }),
    tick: (ms = 50) => { now += ms; room.step(ms); },
    wait: ms => { now += ms; },
  };
}

test('server owns unlimited ascent, horizontal hover movement and immediate stop cancellation', () => {
  const h = roomHarness();
  assert.equal(PROTOCOL_VERSION, 8);
  for (let i = 0; i < 1200; i++) { h.input({ thrust: true }); h.tick(); }
  assert.ok(h.player.y > 400);
  h.input({ hover: true }); h.tick(); const height = h.player.y, x = h.player.x;
  for (let i = 0; i < 60; i++) { h.input({ hover: true, x: 1 }); h.tick(); }
  assert.equal(h.player.y, height); assert.equal(h.player.vy, 0); assert.equal(h.player.hovering, true);
  assert.ok(h.player.x > x + 23);
  h.input({ stop: true, hover: false });
  assert.equal(h.player.hovering, false); assert.equal(h.player.y, height);
  h.tick(); assert.ok(h.player.y < height); assert.ok(h.player.vy < 0);
});

test('stale/disconnected input cannot hold a player hovering forever; travel and reconnect clear state', () => {
  const h = roomHarness();
  Object.assign(h.player, airborne(3));
  h.input({ hover: true }); h.tick(); const height = h.player.y;
  h.wait(INPUT_TIMEOUT_MS + 1); h.tick();
  assert.equal(h.player.hovering, false); assert.ok(h.player.y < height);
  for (let i = 0; i < 60; i++) h.tick();
  assert.equal(h.player.y, flightFloor(h.player.x, h.player.z)); assert.equal(h.player.hovering, false);
  Object.assign(h.player, airborne(100), { hovering: true });
  h.input({ hover: true }); h.room.onDrop(h.client, 1001);
  assert.equal(h.player.connected, false); assert.equal(h.player.hovering, false);
  assert.equal(h.player.y, 0); assert.ok(isWalkable(h.player.x, h.player.z)); assert.equal(h.room.inputs.size, 0);
  h.room.onReconnect(h.client); assert.equal(h.player.connected, true); assert.equal(h.player.hovering, false);
  Object.assign(h.player, airborne(100), { hovering: true }); h.input({ hover: true });
  h.room.receiveTravel(h.client, { id: 'puzzle' });
  assert.equal(h.player.hovering, false); assert.equal(h.player.y, 0);
  assert.equal(h.player.x, getDestination('puzzle').x); assert.equal(h.room.inputs.size, 0);
});
