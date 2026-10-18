import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldClock, cycleTime, sampleWorldTime } from '../src/lib/useWorldClock.js';
import { DAY_NIGHT_CYCLE_MS, sampleDayNight } from '../shared/dayNight.js';

test('world clock: the 180 second cycle wraps finite positive and negative times', () => {
  assert.equal(DAY_NIGHT_CYCLE_MS, 180000);
  assert.equal(cycleTime(180100), 100);
  assert.equal(cycleTime(-100), 179900);
  assert.equal(cycleTime(0), 0);
  for (const value of [NaN, Infinity, -Infinity, undefined, null, '100']) assert.equal(cycleTime(value), 0);
});

test('world clock: the server receipt anchor interpolates with monotonic time', () => {
  const snapshot = { serverTime: 180050, receivedAtPerf: 1000 };
  assert.equal(sampleWorldTime({ snapshot, nowPerf: 1250, fallbackEpoch: 40000, fallbackPerf: 1000 }), 300);
  assert.equal(sampleWorldTime({ snapshot, nowPerf: 181250 }), 300);
});

test('world clock: clients with different wall clocks share the same server phase', () => {
  const snapshot = { serverTime: 271000, receivedAtPerf: 2300 };
  const a = sampleWorldTime({ snapshot, nowPerf: 2400, fallbackEpoch: 50000 });
  const b = sampleWorldTime({ snapshot: { ...snapshot, receivedAtPerf: 9300 }, nowPerf: 9400, fallbackEpoch: 900000000000 });
  assert.equal(a, 91100);
  assert.equal(a, b);
});

test('world clock: malformed, absent and future receipt times use the local anchor', () => {
  const fallback = { nowPerf: 1200, fallbackEpoch: 10000, fallbackPerf: 1000 };
  for (const snapshot of [
    null, {}, { serverTime: 0, receivedAtPerf: 0 },
    { serverTime: NaN, receivedAtPerf: 1000 },
    { serverTime: Infinity, receivedAtPerf: 1000 },
    { serverTime: -1, receivedAtPerf: 1000 },
    { serverTime: Number.MAX_VALUE, receivedAtPerf: 1000 },
    { serverTime: '90000', receivedAtPerf: 1000 },
    { serverTime: 90000, receivedAtPerf: NaN },
    { serverTime: 90000, receivedAtPerf: -1 },
    { serverTime: 90000, receivedAtPerf: 1300 },
    { serverTime: 90000, receivedAtPerf: '1000' },
  ]) assert.equal(sampleWorldTime({ ...fallback, snapshot }), 10200);
});

test('world clock: bad fallback and performance times remain finite and bounded', () => {
  for (const nowPerf of [NaN, Infinity, -1, undefined, '12', Number.MAX_VALUE]) {
    const phase = sampleWorldTime({ nowPerf, fallbackEpoch: NaN, fallbackPerf: Infinity, snapshot: { serverTime: 90000, receivedAtPerf: 0 } });
    assert.equal(phase, 0);
  }
  const phase = sampleWorldTime({ nowPerf: Number.MAX_SAFE_INTEGER, snapshot: { serverTime: Number.MAX_SAFE_INTEGER, receivedAtPerf: 0 } });
  assert.ok(Number.isFinite(phase) && phase >= 0 && phase < DAY_NIGHT_CYCLE_MS);
});

test('world clock: local previews are fixed and automatic time keeps advancing underneath', () => {
  let perf = 1000;
  let mode = 'auto';
  const snapshot = { serverTime: 180050, receivedAtPerf: 1000 };
  const original = { ...snapshot };
  const clock = createWorldClock({ now: () => perf, wallNow: () => 99999, getSnapshot: () => snapshot, getMode: () => mode });
  assert.equal(clock.current, 50);
  mode = 'night'; perf += 30000;
  assert.equal(clock.current, 90000);
  mode = 'day'; perf += 30000;
  assert.equal(clock.current, 0);
  mode = 'auto';
  assert.equal(clock.current, 60050);
  assert.deepEqual(snapshot, original);
});

test('world clock: a getter sees new snapshots without React rerender or a new ref', () => {
  let perf = 1000;
  let snapshot = { serverTime: 50000, receivedAtPerf: 1000 };
  const clock = createWorldClock({ now: () => perf, wallNow: () => 10, getSnapshot: () => snapshot });
  assert.equal(clock.current, 50000);
  snapshot = { serverTime: 60000, receivedAtPerf: 2000 }; perf = 2300;
  assert.equal(clock.current, 60300);
  assert.ok(Object.isFrozen(clock));
});

test('world clock: offline time is monotonic even when the client wall clock changes', () => {
  let perf = 1000;
  let wall = 45000;
  const clock = createWorldClock({ now: () => perf, wallNow: () => wall });
  assert.equal(clock.current, 45000);
  wall += 1000000000; perf += 1000;
  assert.equal(clock.current, 46000);
});

test('world clock: hidden-tab time is not clamped to one frame or one timer interval', () => {
  let perf = 400;
  const clock = createWorldClock({ now: () => perf, wallNow: () => 10000 });
  perf += 90000;
  assert.equal(clock.current, 100000);
  perf += 180000 * 4 + 1234;
  assert.equal(clock.current, 101234);
});

test('world clock: preview labels use the same sky model contract', () => {
  assert.equal(sampleDayNight(sampleWorldTime({ mode: 'day' })).label, '白天');
  assert.equal(sampleDayNight(sampleWorldTime({ mode: 'night' })).label, '夜晚');
});
