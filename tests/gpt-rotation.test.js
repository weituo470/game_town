import test from 'node:test';
import assert from 'node:assert/strict';
import { GPT_DESIGNS } from '../src/components/gpt/designs.js';
import { GPT_ROUND_MS, nextGptDesign, advanceRotation } from '../src/components/gpt/rotation.js';

test('GPT rotation: A, B and C cycle in the shared design order', () => {
  assert.equal(GPT_ROUND_MS, 18000);
  assert.deepEqual(GPT_DESIGNS.map(design => design.id), ['garden', 'orbit', 'citadel']);
  assert.equal(nextGptDesign('garden'), 'orbit');
  assert.equal(nextGptDesign('orbit'), 'citadel');
  assert.equal(nextGptDesign('citadel'), 'garden');
  let id = 'garden';
  for (let i = 0; i < GPT_DESIGNS.length * 3; i += 1) id = nextGptDesign(id);
  assert.equal(id, 'garden');
});

test('GPT rotation: unknown ids fall back to A before advancing to B', () => {
  for (const id of ['unknown', '', undefined, null, 0, {}, Symbol('invalid')]) assert.equal(nextGptDesign(id), 'orbit');
});

test('GPT rotation: disabled, paused, hidden, transitioning and not-ready states preserve time', () => {
  for (const options of [{ enabled: false }, { paused: true }, { hidden: true }, { transitioning: true }, { ready: false }]) {
    Object.freeze(options);
    assert.deepEqual(advanceRotation(7450, 600, options), { remainingMs: 7450, advance: false });
    assert.deepEqual(advanceRotation(0, 1000, options), { remainingMs: 0, advance: false });
  }
  assert.deepEqual(advanceRotation(7450, 600, { paused: true, hidden: true, transitioning: true }), { remainingMs: 7450, advance: false });
});

test('GPT rotation: only 18 active seconds advance once and reset a complete round', () => {
  let remaining = GPT_ROUND_MS, advances = 0;
  for (let second = 1; second <= 36; second += 1) {
    const result = advanceRotation(remaining, 1000);
    remaining = result.remainingMs;
    if (result.advance) advances += 1;
    assert.equal(result.advance, second % 18 === 0);
  }
  assert.equal(advances, 2);
  assert.equal(remaining, GPT_ROUND_MS);
  assert.deepEqual(advanceRotation(250, 249), { remainingMs: 1, advance: false });
  assert.deepEqual(advanceRotation(1, 1), { remainingMs: GPT_ROUND_MS, advance: true });
});

test('GPT rotation: long deltas clamp to one second and never cause chained advances', () => {
  for (const delta of [1001, 18000, 36000, Number.MAX_VALUE]) {
    assert.deepEqual(advanceRotation(GPT_ROUND_MS, delta), { remainingMs: GPT_ROUND_MS - 1000, advance: false });
    assert.deepEqual(advanceRotation(500, delta), { remainingMs: GPT_ROUND_MS, advance: true });
  }
});

test('GPT rotation: malformed inputs stay finite and do not coerce numeric strings', () => {
  for (const delta of [-1, -Infinity, Infinity, NaN, undefined, null, '1000', {}]) {
    assert.deepEqual(advanceRotation(9000, delta), { remainingMs: 9000, advance: false });
  }
  for (const remaining of [-1, Infinity, -Infinity, NaN, undefined, null, '9000', {}]) {
    assert.deepEqual(advanceRotation(remaining, 0), { remainingMs: GPT_ROUND_MS, advance: false });
  }
  assert.deepEqual(advanceRotation(Number.MAX_VALUE, 10), { remainingMs: GPT_ROUND_MS - 10, advance: false });
  assert.deepEqual(advanceRotation(0, 0), { remainingMs: GPT_ROUND_MS, advance: true });
  assert.deepEqual(advanceRotation(9000, 100, null), { remainingMs: 8900, advance: false });
});

test('GPT rotation: resume continues remaining active time without counting paused frames', () => {
  let state = advanceRotation(GPT_ROUND_MS, 1000);
  for (let i = 0; i < 120; i += 1) state = advanceRotation(state.remainingMs, 1000, { hidden: true });
  assert.deepEqual(state, { remainingMs: 17000, advance: false });
  state = advanceRotation(state.remainingMs, 250, { enabled: true, paused: false, hidden: false, transitioning: false, ready: true });
  assert.deepEqual(state, { remainingMs: 16750, advance: false });
});
