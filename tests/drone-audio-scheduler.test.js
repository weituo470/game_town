import test from 'node:test';
import assert from 'node:assert/strict';
import { createDroneAudioScheduler, sampleDroneAudioFrame } from '../src/lib/droneAudioScheduler.js';
import { createDroneShowClock } from '../src/lib/droneShowClock.js';
import { createDroneShowAudio, sampleDroneAudioCue } from '../src/lib/droneShowAudio.js';
import { DRONE_STUNT } from '../shared/droneShow.js';

function fixture(options = {}) {
  let now = 0, nextId = 0;
  const queue = new Map(), samples = [];
  const clock = createDroneShowClock({ now: () => now });
  clock.start(options);
  let state = clock.snapshot();
  const scheduler = createDroneAudioScheduler({
    timeRef: clock.timeRef, getState: () => state,
    update: sample => { samples.push(sample); options.update?.(sample); },
    requestFrame: callback => { const id = ++nextId; queue.set(id, callback); return id; },
    cancelFrame: id => queue.delete(id),
  });
  return {
    clock, scheduler, queue, samples,
    frame(milliseconds = 16) {
      now += milliseconds;
      const jobs = [...queue.values()]; queue.clear(); jobs.forEach(callback => callback(now));
    },
    refresh() { state = clock.snapshot(); scheduler.sync(); },
    get state() { return state; },
  };
}

function audioHarness() {
  const parameter = () => ({ value: 0, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; }, exponentialRampToValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} });
  const node = () => ({ connect(target) { return target; }, disconnect() {}, start() {}, stop() { this.stopped = true; }, gain: parameter(), frequency: parameter() });
  let context;
  class AudioContextClass {
    constructor() { context = this; this.gains = []; this.oscillators = []; this.currentTime = 0; this.sampleRate = 100; this.state = 'suspended'; this.destination = node(); }
    createGain() { const result = node(); this.gains.push(result); return result; }
    createOscillator() { const result = node(); this.oscillators.push(result); return result; }
    createDynamicsCompressor() { return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter() }; }
    createBufferSource() { return node(); }
    createBuffer(_, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
    createBiquadFilter() { return node(); }
    async resume() { this.state = 'running'; }
    async close() { this.closed = true; }
  }
  const audio = createDroneShowAudio({ AudioContextClass });
  return { audio, context };
}

test('audio scheduler is opt-in, starts once, and never requests HUD state updates', () => {
  const h = fixture({ elapsedMs: 88000 });
  assert.equal(h.samples.length, 0); assert.equal(h.queue.size, 0);
  assert.equal(h.scheduler.sync(), false, 'even a premature sync cannot start playback');
  const hudSnapshot = h.state;
  h.scheduler.start(); h.scheduler.start();
  assert.equal(h.queue.size, 1); assert.equal(h.samples.length, 1);
  for (let i = 0; i < 60; i++) h.frame();
  assert.equal(h.samples.length, 61);
  assert.equal(h.queue.size, 1);
  assert.equal(h.state, hudSnapshot, 'the HUD can retain its old 250 ms object while audio advances');
  assert.equal(h.state.elapsedMs, 88000);
  assert.equal(h.samples.at(-1).elapsedMs, 88960);
  h.scheduler.dispose();
});

test('2x playback samples the absolute clock and reaches each batch/reignition within one visual frame', () => {
  const h = fixture({ elapsedMs: 87900, speed: 2 });
  h.scheduler.start();
  for (let i = 0; i < 150; i++) h.frame(16);
  for (const boundary of [...DRONE_STUNT.batchStarts, DRONE_STUNT.brakeStart]) {
    const first = h.samples.find(sample => sample.elapsedMs >= boundary);
    assert.ok(first.elapsedMs - boundary < 32, `${boundary} is not held until a HUD refresh`);
  }
  const before = h.samples.findLast(sample => sample.elapsedMs < DRONE_STUNT.brakeStart);
  const after = h.samples.find(sample => sample.elapsedMs >= DRONE_STUNT.brakeStart);
  assert.equal(sampleDroneAudioCue(before.elapsedMs).impact, false);
  assert.equal(sampleDroneAudioCue(after.elapsedMs).impact, true);
  assert.ok(h.samples.some(sample => sample.elapsedMs > 88400 && sample.elapsedMs < 88540), 'short second-batch motor decay is sampled');
  h.scheduler.dispose();
});

test('seek, immediate pause and resume use current controls without replaying one-shot ignition', async () => {
  const { audio, context } = audioHarness();
  await audio.start();
  const h = fixture({ elapsedMs: 90000, update: sample => audio.update(sample) });
  h.scheduler.start();
  const before = context.oscillators.length;
  h.clock.seek(DRONE_STUNT.brakeStart); h.refresh();
  assert.equal(context.oscillators.length, before + 3, 'one ignition and two harmonic bells');
  h.scheduler.sync(); h.scheduler.sync(); h.frame();
  assert.equal(context.oscillators.length, before + 3, 'same cue does not re-fire on HUD or RAF samples');
  h.clock.togglePause(); h.refresh();
  assert.equal(context.gains[0].gain.value, 0, 'pause mutes in sync(), before another RAF');
  const pausedSamples = h.samples.length;
  for (let i = 0; i < 10; i++) h.frame();
  assert.equal(h.samples.length, pausedSamples, 'paused identical samples are deduplicated');
  h.clock.togglePause(); h.refresh(); h.frame();
  assert.ok(context.gains[0].gain.value > 0);
  assert.equal(context.oscillators.length, before + 3, 'resume in the same cue does not re-fire');
  h.clock.seek(90000); h.refresh();
  h.clock.seek(DRONE_STUNT.brakeStart); h.refresh();
  assert.equal(context.oscillators.length, before + 6, 'an intentional replay gets exactly one new ignition');
  h.scheduler.dispose(); audio.dispose();
});

test('completion mutes from the absolute clock even if the HUD still reports playing', () => {
  const h = fixture({ elapsedMs: 149990 }); h.scheduler.start(); h.frame(16);
  assert.equal(h.state.paused, false);
  assert.equal(h.samples.at(-1).elapsedMs, 150000);
  assert.equal(h.samples.at(-1).ended, true);
  assert.equal(h.samples.at(-1).paused, true);
  assert.equal(h.samples.at(-1).chapter, 8);
  h.scheduler.dispose();
});

test('programme and reduced-motion updates use their own score, not cached avatar chapter/energy', () => {
  const h = fixture({ elapsedMs: DRONE_STUNT.brakeStart }); h.scheduler.start();
  h.clock.setProgram('droplet'); h.clock.seek(107000); h.refresh();
  assert.equal(h.samples.at(-1).program, 'droplet');
  assert.equal(h.samples.at(-1).elapsedMs, 107000);
  h.clock.setReducedMotion(true); h.refresh();
  assert.equal(h.samples.at(-1).reducedMotion, true);
  h.clock.setProgram('avatar'); h.clock.seek(90000); h.refresh();
  assert.equal(h.samples.at(-1).program, 'avatar');
  assert.equal(h.samples.at(-1).energy, DRONE_STUNT.navigationEnergy);
  assert.equal(sampleDroneAudioCue(h.samples.at(-1).elapsedMs, h.samples.at(-1).reducedMotion).id, 'ambient');
  h.scheduler.dispose();
});

test('dispose cancels the only RAF and a stale in-flight callback cannot resurrect playback', () => {
  const h = fixture({ elapsedMs: 90000 }); h.scheduler.start();
  const stale = [...h.queue.values()][0];
  h.scheduler.dispose(); h.scheduler.dispose();
  assert.equal(h.queue.size, 0);
  const count = h.samples.length;
  stale(16); h.frame();
  assert.equal(h.samples.length, count); assert.equal(h.queue.size, 0);
  assert.equal(h.scheduler.sync(), false); assert.equal(h.scheduler.start(), false);
});

test('frame sampling is defensive and reads a getter clock exactly once', () => {
  let reads = 0;
  const frame = sampleDroneAudioFrame({ get current() { reads++; return 48000; } }, { active: true, elapsedMs: 1000 });
  assert.equal(reads, 1); assert.equal(frame.elapsedMs, 48000); assert.equal(frame.chapter, 3);
  assert.equal(sampleDroneAudioFrame({ current: NaN }, { elapsedMs: 44000 }).elapsedMs, 44000);
  assert.equal(sampleDroneAudioFrame({ current: -100 }).elapsedMs, 0);
  assert.equal(sampleDroneAudioFrame({ current: 160000 }).elapsedMs, 150000);
});
