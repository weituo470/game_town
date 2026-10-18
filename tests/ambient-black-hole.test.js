import test from 'node:test';
import assert from 'node:assert/strict';
import { AMBIENT_BLACK_HOLE, createAmbientBlackHoleClock } from '../shared/ambientBlackHole.js';

function advanceBy(clock, durationMs, options) {
  let state = clock.advance(0, options);
  for (let left = durationMs; left > 0; left -= Math.min(1000, left)) {
    state = clock.advance(Math.min(1000, left), options);
  }
  return state;
}
const startEvent = clock => advanceBy(clock, clock.advance().nextInMs);

test('ambient timing contract is independent from the cinematic show clock', () => {
  assert.deepEqual(AMBIENT_BLACK_HOLE, {
    firstWaitMinMs: 35000, firstWaitMaxMs: 65000,
    repeatWaitMinMs: 180000, repeatWaitMaxMs: 360000,
    durationMs: 90000, fadeInMs: 8000, fadeOutMs: 10000, maxDeltaMs: 1000,
  });
  assert.ok(Object.isFrozen(AMBIENT_BLACK_HOLE));
});

test('first encounter includes both random interval endpoints', () => {
  for (const [random, wait] of [[0, 35000], [.5, 50000], [1, 65000]]) {
    const clock = createAmbientBlackHoleClock({ random: () => random });
    assert.deepEqual(clock.advance(), { active: false, phase: 'waiting', elapsedMs: 0, opacity: 0, eventId: 0, nextInMs: wait });
    assert.equal(advanceBy(clock, wait - 1).nextInMs, 1);
    assert.deepEqual(clock.advance(1), { active: true, phase: 'appearing', elapsedMs: 0, opacity: 0, eventId: 1, nextInMs: 0 });
  }
});

test('full event has an 8 second appearance, 72 second hold and 10 second fade', () => {
  const clock = createAmbientBlackHoleClock({ random: () => 0 });
  startEvent(clock);
  let state = advanceBy(clock, 4000);
  assert.equal(state.phase, 'appearing'); assert.equal(state.opacity, .5);
  state = advanceBy(clock, 3999);
  assert.equal(state.phase, 'appearing'); assert.ok(state.opacity > .999);
  state = clock.advance(1);
  assert.equal(state.phase, 'holding'); assert.equal(state.elapsedMs, 8000); assert.equal(state.opacity, 1);
  state = advanceBy(clock, 71999);
  assert.equal(state.phase, 'holding'); assert.equal(state.elapsedMs, 79999); assert.equal(state.opacity, 1);
  state = clock.advance(1);
  assert.equal(state.phase, 'fading'); assert.equal(state.elapsedMs, 80000); assert.equal(state.opacity, 1);
  state = advanceBy(clock, 5000);
  assert.equal(state.opacity, .5);
  state = advanceBy(clock, 4999);
  assert.equal(state.active, true); assert.equal(state.phase, 'fading'); assert.ok(state.opacity < .000001);
  assert.deepEqual(clock.advance(1), { active: false, phase: 'waiting', elapsedMs: 0, opacity: 0, eventId: 1, nextInMs: 180000 });
});

test('successive events wait a freshly sampled 180 to 360 seconds and increment identities', () => {
  const samples = [0, 1, 0]; let calls = 0;
  const clock = createAmbientBlackHoleClock({ random: () => { calls += 1; return samples.shift(); } });
  assert.equal(calls, 1);
  assert.equal(startEvent(clock).eventId, 1);
  assert.equal(calls, 1);
  assert.equal(advanceBy(clock, 90000).nextInMs, 360000);
  assert.equal(calls, 2);
  assert.equal(advanceBy(clock, 359999).active, false);
  assert.equal(clock.advance(1).eventId, 2);
  assert.equal(advanceBy(clock, 90000).nextInMs, 180000);
  assert.equal(calls, 3);
  assert.equal(startEvent(clock).eventId, 3);
});

test('disabled waiting does not accumulate foreground time or consume new random samples', () => {
  let calls = 0;
  const clock = createAmbientBlackHoleClock({ random: () => { calls += 1; return 0; } });
  advanceBy(clock, 12000);
  const before = clock.advance();
  assert.deepEqual(advanceBy(clock, 3600000, { enabled: false }), before);
  assert.equal(calls, 1);
  assert.equal(advanceBy(clock, 22999).active, false);
  assert.equal(clock.advance(1).eventId, 1);
});

test('disabled active events disappear, preserve progress, and resume instead of restarting', () => {
  const clock = createAmbientBlackHoleClock({ random: () => 0 });
  startEvent(clock);
  const before = advanceBy(clock, 4000);
  const hidden = advanceBy(clock, 3600000, { enabled: false });
  assert.equal(hidden.active, false); assert.equal(hidden.opacity, 0);
  assert.equal(hidden.phase, 'appearing'); assert.equal(hidden.elapsedMs, 4000); assert.equal(hidden.eventId, 1);
  assert.deepEqual(clock.advance(0, { enabled: true }), before);
  assert.equal(clock.advance(1000).elapsedMs, 5000);
});

test('disabled state also freezes a nearly completed fade', () => {
  const clock = createAmbientBlackHoleClock({ random: () => 0 });
  startEvent(clock); advanceBy(clock, 89999);
  assert.equal(clock.advance(100000000, { enabled: false }).elapsedMs, 89999);
  assert.equal(clock.advance(0).phase, 'fading');
  assert.equal(clock.advance(1).nextInMs, 180000);
});

test('oversized frame deltas are capped and cannot jump across events or loop', () => {
  let calls = 0;
  const clock = createAmbientBlackHoleClock({ random: () => { calls += 1; return 0; } });
  assert.equal(clock.advance(Number.MAX_VALUE).nextInMs, 34000);
  startEvent(clock);
  assert.equal(clock.advance(Number.MAX_VALUE).elapsedMs, 1000);
  assert.equal(calls, 1);
  advanceBy(clock, 88000);
  const state = clock.advance(Number.MAX_VALUE);
  assert.equal(state.active, false); assert.equal(state.nextInMs, 180000); assert.equal(state.eventId, 1);
  assert.equal(calls, 2);
});

test('frame remainders cross one boundary without losing elapsed time', () => {
  const clock = createAmbientBlackHoleClock({ random: () => 0 });
  advanceBy(clock, 34750);
  assert.equal(clock.advance(1000).elapsedMs, 750);
  advanceBy(clock, 89000);
  const state = clock.advance(1000);
  assert.equal(state.phase, 'waiting'); assert.equal(state.nextInMs, 179250);
  assert.equal(state.eventId, 1);
});

test('invalid and negative deltas are inert in every stage', () => {
  const clock = createAmbientBlackHoleClock({ random: () => 0 });
  for (const elapsed of [0, 4000, 12000, 85000]) {
    if (elapsed === 4000) startEvent(clock);
    if (elapsed) advanceBy(clock, elapsed - clock.advance().elapsedMs);
    const before = clock.advance();
    for (const delta of [NaN, Infinity, -Infinity, -1, '1000', null, {}, undefined]) {
      assert.deepEqual(clock.advance(delta), before);
    }
  }
});

test('random samples are finite, safely clamped, and never schedule immediate re-entry', () => {
  for (const [sample, first, repeat] of [
    [NaN, 50000, 270000], [Infinity, 50000, 270000], [-Infinity, 50000, 270000],
    [undefined, 50000, 270000], [null, 50000, 270000], ['1', 50000, 270000],
    [-4, 35000, 180000], [4, 65000, 360000],
  ]) {
    const clock = createAmbientBlackHoleClock({ random: () => sample });
    assert.equal(clock.advance().nextInMs, first);
    startEvent(clock);
    assert.equal(advanceBy(clock, 90000).nextInMs, repeat);
  }
});

test('unavailable or throwing random source uses the interval midpoint', () => {
  for (const random of [null, 5, () => { throw new Error('random unavailable'); }]) {
    const clock = createAmbientBlackHoleClock({ random });
    assert.equal(clock.advance().nextInMs, 50000);
    startEvent(clock);
    assert.equal(advanceBy(clock, 90000).nextInMs, 270000);
  }
});

test('fade opacity is bounded and continuous at every lifecycle transition', () => {
  const clock = createAmbientBlackHoleClock({ random: () => 0 });
  startEvent(clock);
  let previous = clock.advance();
  for (let time = 100; time <= 90000; time += 100) {
    const state = clock.advance(100);
    assert.ok(state.opacity >= 0 && state.opacity <= 1);
    assert.ok(Math.abs(state.opacity - previous.opacity) < .019);
    previous = state;
  }
});

test('reduced-motion presentation preferences do not alter random event timing', () => {
  const moving = createAmbientBlackHoleClock({ random: () => .25 });
  const still = createAmbientBlackHoleClock({ random: () => .25 });
  for (let step = 0; step < 700; step += 1) {
    const enabled = step < 55 || step >= 80;
    assert.deepEqual(moving.advance(1000, { enabled }), still.advance(1000, { enabled, reducedMotion: true }));
  }
});

test('snapshots cannot mutate the clock or another clock instance', () => {
  const clock = createAmbientBlackHoleClock({ random: () => 0 });
  const other = createAmbientBlackHoleClock({ random: () => 1 });
  const state = clock.advance(); state.nextInMs = 0; state.eventId = 100;
  assert.equal(clock.advance().nextInMs, 35000); assert.equal(clock.advance().eventId, 0);
  startEvent(clock);
  assert.equal(other.advance().nextInMs, 65000); assert.equal(other.advance().eventId, 0);
  assert.ok(Object.isFrozen(clock));
});
