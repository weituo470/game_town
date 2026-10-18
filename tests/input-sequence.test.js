import test from 'node:test';
import assert from 'node:assert/strict';
import { sequencedInput } from '../src/components/town/inputSequence.js';
import { validInput } from '../server/TownRoom.js';

const stop = Object.freeze({ x: 0, z: 0 });
const snapshot = (seq, overrides = {}) => ({ selfId: 'self-session', players: [{ id: 'self-session', seq, connected: true }], ...overrides });

test('refresh stop before the first render frame starts above the retained server sequence', () => {
  const restored = snapshot(873);
  assert.equal(validInput({ ...stop, seq: 1 }, 873), false, 'the old effect-before-frame sequence remains invalid');
  const packet = sequencedInput(stop, 0, restored, 'self-session');
  assert.deepEqual(packet, { x: 0, z: 0, seq: 874 });
  assert.equal(validInput(packet, 873), true, 'initial cleanup/stop packet is accepted without weakening server validation');
  assert.equal(restored.players[0].seq, 873, 'authoritative snapshot is not mutated');
});

test('effect cleanup, blur, visibility and first-frame sends remain monotonic before a fresh patch', () => {
  const restored = snapshot(350);
  let local = 0, server = 350;
  for (let i = 0; i < 5; i++) {
    const packet = sequencedInput(i === 4 ? { x: 0.5, z: -0.5 } : stop, local, restored, 'self-session');
    assert.equal(validInput(packet, server), true);
    assert.equal(packet.seq, 351 + i);
    local = packet.seq;
    server = packet.seq;
  }
});

test('a newer authoritative patch raises the floor while an older patch cannot roll back local input', () => {
  assert.equal(sequencedInput(stop, 12, snapshot(500), 'self-session').seq, 501);
  assert.equal(sequencedInput(stop, 501, snapshot(490), 'self-session').seq, 502);
  assert.equal(sequencedInput(stop, 0, snapshot(-1), 'self-session').seq, 1, 'fresh room initialization remains supported');
});

test('no stop is guessed before a matching self snapshot or while a stale room snapshot is present', () => {
  for (const state of [undefined, {}, snapshot(10, { selfId: 'previous-room' }), snapshot(10, { players: [] }), snapshot(10, { players: [{ id: 'other-player', seq: 10 }] }), snapshot(10, { players: [{ id: 'self-session', seq: 10, connected: false }] })]) {
    assert.equal(sequencedInput(stop, 0, state, 'self-session'), null);
  }
  assert.equal(sequencedInput(stop, 0, snapshot(10), ''), null);
  const withPeer = snapshot(10);
  withPeer.players.unshift({ id: 'other-player', seq: 9000 });
  assert.equal(sequencedInput(stop, 0, withPeer, 'self-session').seq, 11, 'remote sequence is never used');
});

test('sequence allocation does not manufacture valid packets from malformed server state or directions', () => {
  for (const seq of [NaN, Infinity, -2, 1.5, Number.MAX_SAFE_INTEGER]) assert.equal(sequencedInput(stop, 0, snapshot(seq), 'self-session'), null);
  for (const input of [undefined, { x: Infinity, z: 0 }, { x: 0, z: NaN }, { x: 2, z: 0 }]) assert.equal(sequencedInput(input, 0, snapshot(10), 'self-session'), null);
  assert.equal(sequencedInput(stop, Number.MAX_SAFE_INTEGER, snapshot(10), 'self-session'), null);
});
