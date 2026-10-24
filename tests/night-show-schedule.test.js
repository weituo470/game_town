import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_DURATION_MS, NIGHT_DURATION_MS, DAY_NIGHT_CYCLE_MS, NIGHT_START_MS, NIGHT_END_MS, sampleDayNight, solarPhaseAtTime, worldTimeAtSolarPhase } from '../shared/dayNight.js';
import { NIGHT_SHOWS, sampleNightShow, createNightShowTimeRef } from '../shared/nightShowSchedule.js';
import { getDroneProgram } from '../shared/dronePrograms.js';
import { createFootprintRuntime } from '../src/components/drone/footprintFireworks.js';
import { createWorldClock } from '../src/lib/useWorldClock.js';
import { createDroneShowClock } from '../src/lib/droneShowClock.js';

test('theatre day is five minutes of daylight and ten minutes of night', () => {
  assert.equal(DAY_DURATION_MS, 300000); assert.equal(NIGHT_DURATION_MS, DAY_DURATION_MS * 2);
  assert.equal(DAY_NIGHT_CYCLE_MS, 900000); assert.equal(NIGHT_END_MS - NIGHT_START_MS, NIGHT_DURATION_MS);
  let day = 0, night = 0;
  for (let t = 0; t < DAY_NIGHT_CYCLE_MS; t += 1000) sampleNightShow(t).night ? night++ : day++;
  assert.equal(day, 300); assert.equal(night, 600);
});

test('four original full scores play in order with eight-second intervals and dark bookends', () => {
  assert.deepEqual(NIGHT_SHOWS.map(s => s.id), ['avatar', 'droplet', 'carrier-battle', 'footsteps-of-light']);
  for (const [i, show] of NIGHT_SHOWS.entries()) {
    const score = show.id === 'footsteps-of-light' ? createFootprintRuntime().program : getDroneProgram(show.id);
    assert.equal(show.duration, score.duration);
    if (i) assert.equal(show.start - NIGHT_SHOWS[i - 1].end, 8000);
    assert.equal(sampleNightShow(NIGHT_START_MS + show.start - 1).active, false);
    const first = sampleNightShow(NIGHT_START_MS + show.start);
    assert.equal(first.show.id, show.id); assert.equal(first.elapsedMs, 0);
    const last = sampleNightShow(NIGHT_START_MS + show.end - 1);
    assert.equal(last.elapsedMs, show.duration - 1); assert.equal(last.remainingMs, 1);
    assert.equal(sampleNightShow(NIGHT_START_MS + show.end).active, false);
    for (let t = show.start; t < show.end; t += 137) {
      const sky = sampleDayNight(NIGHT_START_MS + t);
      assert.equal(sky.label, '夜晚'); assert.equal(sky.daylight, 0);
    }
  }
  assert.equal(NIGHT_SHOWS[0].start, 12000);
  assert.equal(NIGHT_DURATION_MS - NIGHT_SHOWS.at(-1).end, 10000);
});

test('daytime never leaves a default drone show flying and the next-night countdown wraps correctly', () => {
  for (const t of [0, 149999, 750000, 899999]) {
    const s = sampleNightShow(t); assert.equal(s.active, false); assert.equal(s.phase, 'day');
    assert.equal(s.next.id, 'avatar'); assert(s.nextIn > 0);
    assert.equal(sampleNightShow(t + s.nextIn).show.id, 'avatar');
  }
  assert.equal(sampleNightShow(NIGHT_START_MS).phase, 'interval');
  assert.equal(sampleNightShow(NIGHT_END_MS - 1).phase, 'curtain');
});

test('late arrivals, hidden-tab jumps, negative times and many-day wraps never queue or restart old shows', () => {
  for (let t = 0; t < DAY_NIGHT_CYCLE_MS; t += 997) {
    const s = sampleNightShow(t);
    assert.deepEqual(sampleNightShow(t + DAY_NIGHT_CYCLE_MS * 100), s);
    assert.deepEqual(sampleNightShow(t - DAY_NIGHT_CYCLE_MS * 100), s);
    assert(Number.isFinite(s.nextIn) && s.nextIn >= 0 && s.nextIn < DAY_NIGHT_CYCLE_MS);
  }
  for (const t of [NaN, Infinity, undefined, 'night', null]) assert.deepEqual(sampleNightShow(t), sampleNightShow(0));
  const world = { current: NIGHT_START_MS + 540000 }, ref = createNightShowTimeRef(world);
  assert.equal(sampleNightShow(world.current).show.id, 'footsteps-of-light'); assert.equal(ref.current, 54000);
  world.current += DAY_NIGHT_CYCLE_MS * 3; assert.equal(ref.current, 54000);
  world.current = 0; assert.equal(ref.current, 0);
});

test('server receipts synchronize viewers regardless of local wall clock or joining time', () => {
  let perf = 1000;
  const snapshot = { serverTime: DAY_NIGHT_CYCLE_MS * 999 + NIGHT_START_MS + 220000, receivedAtPerf: perf };
  const a = createWorldClock({ now: () => perf, wallNow: () => 10, getSnapshot: () => snapshot });
  const b = createWorldClock({ now: () => perf, wallNow: () => 999999, getSnapshot: () => snapshot });
  assert.deepEqual(sampleNightShow(a.current), sampleNightShow(b.current));
  assert.equal(sampleNightShow(a.current).show.id, 'droplet'); assert.equal(createNightShowTimeRef(a).current, 50000);
  perf += 120000; assert.equal(sampleNightShow(a.current).show.id, 'carrier-battle');
});

test('old score is clamped at its end while React changes the stage, never reset to another score offset', () => {
  const world = { current: NIGHT_START_MS + 12000 }, ref = createNightShowTimeRef(world, NIGHT_SHOWS[0]);
  assert.equal(ref.current, 0); world.current += 149999; assert.equal(ref.current, 149999);
  world.current += 1; assert.equal(ref.current, 150000);
  world.current = NIGHT_START_MS + NIGHT_SHOWS[1].start + 100; assert.equal(ref.current, 150000);
});

test('manual pause and seeking do not alter the automatic world clock or future schedule', () => {
  let perf = 0; const world = { current: NIGHT_START_MS + 190000 };
  const before = sampleNightShow(world.current), clock = createDroneShowClock({ now: () => perf });
  clock.start({ program: before.show.id }); clock.seek(before.elapsedMs); clock.togglePause();
  perf += 60000; world.current += 60000;
  assert.equal(clock.timeRef.current, before.elapsedMs);
  assert.equal(sampleNightShow(world.current).elapsedMs, before.elapsedMs + 60000);
});

test('new piecewise solar path remains continuous and invertible at dusk, dawn, midnight and cycle seams', () => {
  for (let t = 0; t < DAY_NIGHT_CYCLE_MS; t += 193) assert(Math.abs(worldTimeAtSolarPhase(solarPhaseAtTime(t)) - t) < 1e-6);
  for (const t of [0, 150000, 160000, 450000, 740000, 750000, 900000]) {
    const a = sampleDayNight(t - .01), b = sampleDayNight(t + .01);
    for (const key of ['daylight', 'nightOpacity', 'lampIntensity']) assert(Math.abs(a[key] - b[key]) < .0001);
    for (let i = 0; i < 3; i++) assert(Math.abs(a.sunDirection[i] - b.sunDirection[i]) < .0001);
  }
});
