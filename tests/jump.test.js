import test from 'node:test';
import assert from 'node:assert/strict';
import { JUMP_SPEED, JUMP_MAX_HEIGHT, JUMP_DURATION, startJump, stepJump, grounded } from '../shared/jump.js';
import { SPAWN, FOUNTAIN, movePlayer, isWalkable, getDestination } from '../shared/world.js';
import { validInput } from '../server/TownRoom.js';
import { sequencedInput } from '../src/components/town/inputSequence.js';
import { snapshotFromState } from '../src/lib/useMultiplayer.js';

test('a light jump reaches 1.6 metres and lasts about 0.89 seconds at different frame rates', () => {
  assert.equal(JUMP_MAX_HEIGHT, 1.6);
  assert.ok(JUMP_DURATION > 0.8 && JUMP_DURATION < 1);
  for (const hz of [20, 30, 60, 144]) {
    let state = startJump({ y: 0, vy: 0 }), peak = 0, elapsed = 0;
    while (!grounded(state) && elapsed < 2) {
      state = stepJump(state, 1 / hz); elapsed += 1 / hz;
      peak = Math.max(peak, state.y);
      assert.ok(state.y >= 0);
    }
    assert.ok(Math.abs(peak - 1.6) < 0.006, `${hz} Hz peak ${peak}`);
    assert.ok(elapsed >= JUMP_DURATION - 1e-8 && elapsed < JUMP_DURATION + 1 / hz + 1e-8);
    assert.deepEqual(state, { y: 0, vy: 0 });
  }
});

test('jump ignores repeat requests in the air and cannot buffer a second jump', () => {
  let state = startJump({ y: 0, vy: 0 });
  assert.equal(startJump(state), null, 'zero-height upward launch is already airborne');
  for (let i = 0; i < 17; i++) {
    state = stepJump(state, 0.05);
    assert.equal(startJump(state), null);
  }
  state = stepJump(state, 0.05);
  assert.deepEqual(state, { y: 0, vy: 0 });
  assert.deepEqual(stepJump(state, 0.05), state, 'no buffered launch on landing');
  assert.deepEqual(startJump(state), { y: 0, vy: JUMP_SPEED });
});

test('vertical simulation sanitizes invalid numbers and clamps a long background frame', () => {
  for (const state of [null, {}, { y: NaN, vy: Infinity }, { y: -3, vy: -4 }]) assert.deepEqual(stepJump(state, 0.05), { y: 0, vy: 0 });
  const launch = startJump({});
  assert.deepEqual(stepJump(launch, 10), stepJump(launch, 0.1));
  for (const dt of [NaN, Infinity, -1]) assert.deepEqual(stepJump(launch, dt), launch);
});

test('airborne movement retains fountain, building and map collisions', () => {
  for (const [position, direction] of [[{ x: 0, z: FOUNTAIN.z + FOUNTAIN.radius + 0.2 }, { x: 0, z: -1 }], [getDestination('puzzle'), { x: 0, z: -1 }], [SPAWN, { x: 1, z: 0 }]]) {
    let state = { ...position, ...startJump({}) };
    for (let frame = 0; frame < 160; frame++) {
      state = { ...state, ...movePlayer(state, direction, 0.05), ...stepJump(state, 0.05) };
      assert.ok(isWalkable(state.x, state.z));
    }
  }
});

test('only boolean jump and zero-direction stop intents can cross the protocol boundary', () => {
  assert.ok(validInput({ x: 0, z: 0, seq: 1, jump: true }));
  assert.ok(validInput({ x: 0, z: 0, seq: 1, stop: true }));
  for (const extra of [{ y: 8 }, { vy: 99 }, { jump: 1 }, { jump: 'true' }, { stop: 1 }, { stop: true, jump: true }, { stop: true, x: 1 }]) {
    assert.equal(validInput({ x: 0, z: 0, seq: 1, ...extra }), false);
  }
  assert.equal(validInput({ x: 0, z: 0, seq: 1, jump: true }, 1), false);
});

test('jump and cancellation keep the recovered sequence floor without forwarding arbitrary position', () => {
  const snapshot = { selfId: 'self', players: [{ id: 'self', seq: 900, connected: true }] };
  const jump = sequencedInput({ x: 1, z: 0, jump: true, y: 100 }, 0, snapshot, 'self');
  assert.deepEqual(jump, { x: 1, z: 0, seq: 901, jump: true });
  const stop = sequencedInput({ x: 0, z: 0, stop: true }, 901, snapshot, 'self');
  assert.deepEqual(stop, { x: 0, z: 0, seq: 902, stop: true });
  for (const input of [{ x: 1, z: 0, stop: true }, { x: 0, z: 0, stop: true, jump: true }, { x: 0, z: 0, jump: 'true' }]) assert.equal(sequencedInput(input, 0, snapshot, 'self'), null);
});

test('snapshot exposes authoritative jump height and monotonic world-clock receipt time', () => {
  const player = { x: 1, y: 1.4, z: 2, vy: -2, seq: 5 };
  const state = { tick: 19, serverTime: 123456789, players: new Map([['self', player]]) };
  const snapshot = snapshotFromState(state, 'self');
  assert.equal(snapshot.players[0].y, 1.4);
  assert.equal(snapshot.players[0].vy, -2);
  assert.equal(snapshot.serverTime, 123456789);
  assert.ok(Number.isFinite(snapshot.receivedAtPerf));
  player.y = 0;
  assert.equal(snapshot.players[0].y, 1.4);
});
