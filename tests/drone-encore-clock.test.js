import test from 'node:test';
import assert from 'node:assert/strict';
import { createDroneShowClock } from '../src/lib/droneShowClock.js';

function legacyFixture(options = {}) {
  let now = 0;
  return { clock: createDroneShowClock({ now: () => now, allowEncore: true, ...options }), advance: value => { now += value; } };
}

test('legacy opt-in: update explicitly commits a natural droplet ending to the complete black hole encore', () => {
  const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet' });
  advance(149999); assert.equal(clock.update().program, 'droplet');
  advance(1); const state = clock.update();
  assert.equal(state.program, 'blackhole'); assert.equal(state.elapsedMs, 0);
  assert.equal(state.encoreFrom, 'droplet'); assert.equal(state.paused, false); assert.equal(state.ended, false);
  advance(250); assert.equal(clock.update().elapsedMs, 250);
});

test('legacy opt-in: RAF and snapshot reads remember natural completion without switching programme or elapsed domain', () => {
  const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet' }); advance(150020);
  assert.equal(clock.timeRef.current, 150000);
  for (let i = 0; i < 10; i++) {
    const state = clock.snapshot();
    assert.equal(state.program, 'droplet'); assert.equal(state.elapsedMs, 150000);
    assert.equal(state.ended, true); assert.equal(state.encoreFrom, null);
  }
  advance(230); const state = clock.update();
  assert.equal(state.program, 'blackhole'); assert.equal(state.elapsedMs, 0);
});

test('legacy opt-in: paused playback cannot naturally finish or resume into an encore', () => {
  const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet' }); advance(149000);
  clock.togglePause(); advance(900000);
  assert.equal(clock.update().program, 'droplet'); assert.equal(clock.snapshot().elapsedMs, 149000);
  clock.togglePause(); advance(999); assert.equal(clock.update().program, 'droplet');
  advance(1); assert.equal(clock.update().program, 'blackhole');
});

test('legacy opt-in: a pause action after the render loop reaches the ending cancels the pending hand-off', () => {
  const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet' }); advance(150000);
  assert.equal(clock.timeRef.current, 150000); clock.togglePause();
  advance(1000); assert.equal(clock.update().program, 'droplet'); assert.equal(clock.snapshot().paused, true);
  assert.equal(clock.playEncore().program, 'blackhole');
});

test('legacy opt-in: close cancels even an already detected natural ending and manual encore cannot reopen a closed show', () => {
  const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet' }); advance(150000);
  clock.timeRef.current; clock.close(); advance(50000);
  assert.equal(clock.update().program, 'droplet'); assert.equal(clock.snapshot().active, false);
  assert.equal(clock.playEncore().active, false); assert.equal(clock.snapshot().program, 'droplet');
});

test('legacy opt-in: manual programme choice clears pending transitions, including deliberate selection of the same score', () => {
  for (const target of ['avatar', 'droplet', 'blackhole']) {
    const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet' }); advance(150000);
    clock.timeRef.current; const selected = clock.setProgram(target);
    assert.equal(selected.program, target); assert.equal(selected.encoreFrom, null);
    assert.deepEqual(clock.update(), selected);
  }
});

test('legacy opt-in: seeking to the ending stops instead of forcing an encore, with an explicit manual entrance available', () => {
  const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet' }); clock.seek(150000);
  for (let i = 0; i < 5; i++) { advance(1000); assert.equal(clock.update().program, 'droplet'); }
  const encore = clock.playEncore();
  assert.equal(encore.program, 'blackhole'); assert.equal(encore.elapsedMs, 0); assert.equal(encore.encoreFrom, 'droplet');
  assert.deepEqual(clock.playEncore(), encore, 'repeat clicks cannot restart an already playing encore');
});

test('legacy opt-in: seeking after natural completion clears old pending state and only a new natural ending can chain', () => {
  const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet' }); advance(150000);
  clock.timeRef.current; clock.seek(40000);
  assert.equal(clock.update().program, 'droplet'); assert.equal(clock.snapshot().elapsedMs, 40000);
  advance(110000); assert.equal(clock.update().program, 'blackhole');
});

test('legacy opt-in: restart clears pending state and encore origin, and replays only the currently selected show', () => {
  const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet' }); advance(150000); clock.timeRef.current;
  clock.start(); assert.equal(clock.update().program, 'droplet'); assert.equal(clock.snapshot().elapsedMs, 0);
  advance(150000); clock.update(); assert.equal(clock.snapshot().encoreFrom, 'droplet');
  clock.start(); const replay = clock.update();
  assert.equal(replay.program, 'blackhole'); assert.equal(replay.elapsedMs, 0); assert.equal(replay.encoreFrom, null);
});

test('legacy opt-in: large background overshoot starts the full encore at zero and repeated polls do not restart it', () => {
  const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet' }); advance(3600000);
  const state = clock.update(); assert.equal(state.program, 'blackhole'); assert.equal(state.elapsedMs, 0);
  for (let i = 0; i < 10; i++) assert.deepEqual(clock.update(), state);
  advance(1000); const progressed = clock.update(); assert.equal(progressed.elapsedMs, 1000);
  for (let i = 0; i < 10; i++) assert.deepEqual(clock.update(), progressed);
});

test('legacy opt-in: automatic and manual encore preserve speed and reduced-motion while using the compatible cinematic view', () => {
  for (const manual of [false, true]) {
    const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet', speed: 2 }); clock.setReducedMotion(true);
    if (manual) clock.seek(150000); else advance(75000);
    const state = manual ? clock.playEncore() : clock.update();
    assert.equal(state.program, 'blackhole'); assert.equal(state.speed, 2); assert.equal(state.reducedMotion, true);
    assert.equal(state.view, 'cinematic'); advance(1000); assert.equal(clock.timeRef.current, 2000);
  }
});

test('legacy opt-in: black hole completion never chains or loops whether entered independently or as an encore', () => {
  for (const standalone of [false, true]) {
    const { clock, advance } = legacyFixture();
    if (standalone) clock.start({ program: 'blackhole' });
    else { clock.start({ program: 'droplet' }); advance(150000); clock.update(); }
    advance(90000); const state = clock.update();
    assert.equal(state.program, 'blackhole'); assert.equal(state.elapsedMs, 90000); assert.equal(state.ended, true);
    advance(360000); assert.deepEqual(clock.update(), state); assert.deepEqual(clock.playEncore(), state);
  }
});

test('legacy opt-in: manual encore is unavailable before the ending and for any non-droplet programme', () => {
  for (const program of ['avatar', 'droplet', 'blackhole']) {
    const { clock } = legacyFixture(); clock.start({ program, elapsedMs: 35000 });
    const before = clock.snapshot(); assert.deepEqual(clock.playEncore(), before);
  }
  const { clock } = legacyFixture(); clock.start({ program: 'avatar', elapsedMs: 150000 });
  const ended = clock.snapshot(); assert.deepEqual(clock.update(), ended); assert.deepEqual(clock.playEncore(), ended);
});

test('legacy opt-in: custom-duration clocks do not automatically join shows and explicit start-at-end stays stopped', () => {
  for (const duration of [1000, 150000]) {
    const { clock, advance } = legacyFixture({ duration }); clock.start({ program: 'droplet' }); advance(duration + 1);
    assert.equal(clock.update().program, 'droplet'); assert.equal(clock.snapshot().elapsedMs, duration);
  }
  const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet', elapsedMs: 150000 }); advance(5000);
  assert.equal(clock.update().program, 'droplet'); assert.equal(clock.snapshot().ended, true);
});

test('legacy opt-in: an explicit programme selection clears encore context without replaying its active timeline', () => {
  const { clock, advance } = legacyFixture(); clock.start({ program: 'droplet' }); advance(150000); clock.update();
  advance(12000); const before = clock.snapshot(); assert.equal(before.encoreFrom, 'droplet');
  const selected = clock.setProgram('blackhole');
  assert.equal(selected.elapsedMs, before.elapsedMs); assert.equal(selected.encoreFrom, null);
});


test('default show clocks never hand waterdrop completion to a black-hole show automatically or manually', () => {
  for (const speed of [1, 2]) for (const ending of ['natural', 'seek', 'background']) {
    let now = 0;
    const clock = createDroneShowClock({ now: () => now });
    clock.start({ program: 'droplet', speed });
    if (ending === 'seek') clock.seek(150000); else now = ending === 'background' ? 3600000 : 150000 / speed;
    assert.equal(clock.timeRef.current, 150000);
    for (let i = 0; i < 4; i++) {
      const state = clock.update();
      assert.equal(state.program, 'droplet'); assert.equal(state.ended, true); assert.equal(state.paused, true);
      assert.equal(state.encoreFrom, null); assert.equal(state.elapsedMs, 150000);
      assert.deepEqual(clock.playEncore(), state, 'legacy manual method is disabled unless explicitly opted in');
      now += 10000;
    }
    clock.start(); assert.equal(clock.snapshot().program, 'droplet'); assert.equal(clock.snapshot().elapsedMs, 0);
  }
});

test('only boolean true opts into legacy encore; false or truthy configuration mistakes do not', () => {
  for (const allowEncore of [false, undefined, 'false', 1]) {
    let now=0; const clock=createDroneShowClock({now:()=>now, allowEncore});
    clock.start({program:'droplet'}); now=150000;
    assert.equal(clock.update().program,'droplet'); assert.equal(clock.playEncore().program,'droplet');
  }
});
