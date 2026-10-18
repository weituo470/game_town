import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithEsbuild } from 'vite';
import { createDroneShowClock, DEFAULT_DRONE_SHOW_DURATION } from '../src/lib/droneShowClock.js';
import * as clockModule from '../src/lib/droneShowClock.js';
import * as audioModule from '../src/lib/droneShowAudio.js';
import * as choreography from '../shared/droneShow.js';

function fixture() {
  let time = 1000;
  const clock = createDroneShowClock({ now: () => time });
  return { clock, advance: amount => { time += amount; }, setTime: value => { time = value; } };
}

test('drone clock starts idle and advances without animation-frame state writes', () => {
  const { clock, advance } = fixture();
  advance(1200);
  assert.equal(clock.timeRef.current, 0);
  assert.equal(clock.snapshot().active, false);
  clock.start();
  advance(1567);
  assert.equal(clock.timeRef.current, 1567);
  assert.equal(clock.snapshot().active, true);
  assert.equal(clock.snapshot().paused, false);
});

test('drone clock preserves elapsed time across pause and resume', () => {
  const { clock, advance } = fixture();
  clock.start(); advance(2300); clock.togglePause(); advance(8000);
  assert.equal(clock.timeRef.current, 2300);
  assert.equal(clock.snapshot().paused, true);
  clock.togglePause(); advance(1700);
  assert.equal(clock.timeRef.current, 4000);
});

test('speed changes do not jump and remain restricted to supported speeds', () => {
  const { clock, advance } = fixture();
  clock.start(); advance(1000); clock.setSpeed(2);
  assert.equal(clock.timeRef.current, 1000);
  advance(1500); assert.equal(clock.timeRef.current, 4000);
  clock.setSpeed(Infinity); assert.equal(clock.snapshot().speed, 2);
  clock.setSpeed(1); advance(500); assert.equal(clock.timeRef.current, 4500);
});

test('show finishes grounded and never wraps to a second performance', () => {
  const { clock, advance } = fixture();
  clock.start(); advance(200000);
  assert.equal(clock.timeRef.current, DEFAULT_DRONE_SHOW_DURATION);
  assert.deepEqual({ ended: clock.snapshot().ended, paused: clock.snapshot().paused, active: clock.snapshot().active }, { ended: true, paused: true, active: true });
  advance(500000); clock.togglePause();
  assert.equal(clock.timeRef.current, DEFAULT_DRONE_SHOW_DURATION);
  clock.seek(70000); advance(1000);
  assert.equal(clock.timeRef.current, 71000);
});

test('seek clamps, does not unpause a deliberate pause, and handles invalid values', () => {
  const { clock, advance } = fixture();
  clock.start(); clock.seek(-20); assert.equal(clock.timeRef.current, 0);
  clock.togglePause(); clock.seek(70000); advance(1000);
  assert.equal(clock.timeRef.current, 70000);
  clock.seek(NaN); assert.equal(clock.timeRef.current, 0);
  clock.seek(999999); assert.equal(clock.timeRef.current, DEFAULT_DRONE_SHOW_DURATION);
});

test('clock ignores a backwards or invalid source timestamp', () => {
  const { clock, setTime } = fixture();
  clock.start(); setTime(3000); assert.equal(clock.timeRef.current, 2000);
  setTime(2000); assert.equal(clock.timeRef.current, 2000);
  setTime(NaN); assert.equal(clock.timeRef.current, 2000);
  setTime(4000); assert.equal(clock.timeRef.current, 3000);
});

test('close freezes and restart resets; view and reduced-motion options remain explicit', () => {
  const { clock, advance } = fixture();
  clock.start({ elapsedMs: 5000, speed: 2, view: 'free' });
  clock.setReducedMotion(true); advance(1000); clock.close(); advance(1000);
  assert.equal(clock.timeRef.current, 7000);
  assert.equal(clock.snapshot().active, false);
  assert.equal(clock.snapshot().reducedMotion, true);
  clock.setView('anything'); assert.equal(clock.snapshot().view, 'free');
  clock.start();
  assert.equal(clock.timeRef.current, 0);
  assert.equal(clock.snapshot().speed, 1);
  assert.equal(clock.snapshot().view, 'cinematic');
});

test('show HUD exposes a labelled timeline, exit, pause and nine navigable chapters including dragon', async () => {
  const path = new URL('../src/components/drone/DroneShowControls.jsx', import.meta.url);
  const transformed = await transformWithEsbuild(fs.readFileSync(path, 'utf8'), 'DroneShowControls.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
  const require = createRequire(path);
  const module = { exports: {} };
  vm.runInNewContext(transformed.code, {
    module, exports: module.exports,
    require(id) {
      if (id.endsWith('droneShowClock.js')) return clockModule;
      if (id.endsWith('droneShowAudio.js')) return audioModule;
      if (id.endsWith('shared/droneShow.js')) return choreography;
      if (id.endsWith('.css')) return {};
      return require(id);
    },
  });
  const clock = createDroneShowClock({ now: () => 0 });
  clock.start({ elapsedMs: 82000 });
  const controller = { ...clock, state: clock.snapshot() };
  const html = renderToStaticMarkup(require('react').createElement(module.exports.default, { controller, onClose() {} }));
  assert.match(html, /class="drone-show-controls/);
  assert.match(html, /aria-label="退出观演，回到小镇"/);
  assert.match(html, /aria-label="调整无人机演出进度"/);
  assert.match(html, /max="150000"/);
  assert.match(html, /直达法相/);
  assert.match(html, /蓝焰翼龙/);
  assert.match(html, /<p class="drone-story-note">四批依次失重/);
  assert.match(html, /直达失重/);
  assert.match(html, /贴海复燃/);
  assert.match(html, /data-drone-cue=/);
  assert.match(html, /开启演出音效/);
  assert.match(html, /aria-controls="drone-show-details"/);
  assert.match(html, /id="drone-show-details"[^>]*hidden=""/);
  assert.equal((html.match(/class="drone-chapter(?: drone-chapter-active)?"/g) ?? []).length, 9);
  assert.doesNotMatch(html, /静候星起|自由镜头|autoplay/i);
  clock.seek(89000);
  clock.setReducedMotion(true);
  const calmHtml = renderToStaticMarkup(require('react').createElement(module.exports.default, { controller: { ...clock, state: clock.snapshot() }, onClose() {} }));
  assert.match(calmHtml, /class="drone-current-chapter"[^>]*>.*?法相 · 舒缓观演<\/div>/);
  assert.match(calmHtml, /aria-valuetext="法相 · 舒缓观演/);
});

function audioHarness() {
  const instances = [];
  const parameter = () => ({ value: 0, targets: [], setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; this.targets.push(value); }, cancelScheduledValues() {} });
  const node = () => ({ connect(target) { return target; }, disconnect() {}, start() {}, stop() { this.stopped = true; }, gain: parameter(), frequency: parameter() });
  class AudioContextClass {
    constructor() { this.gains = []; this.oscillators = []; this.currentTime = 0; this.sampleRate = 100; this.state = 'suspended'; this.destination = node(); instances.push(this); }
    createGain() { const gain = node(); this.gains.push(gain); return gain; }
    createOscillator() { const oscillator = node(); this.oscillators.push(oscillator); return oscillator; }
    createDynamicsCompressor() { return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter() }; }
    createBufferSource() { return node(); }
    createBuffer(_, length) { const values = new Float32Array(length); return { getChannelData: () => values }; }
    createBiquadFilter() { return node(); }
    async resume() { this.state = 'running'; }
    async close() { this.closed = true; this.state = 'closed'; }
  }
  return { instances, AudioContextClass };
}

test('original audio is opt-in and mutes on pause, completion, and disposal', async () => {
  const { instances, AudioContextClass } = audioHarness();
  assert.equal(instances.length, 0);
  const audio = audioModule.createDroneShowAudio({ AudioContextClass });
  const context = instances[0];
  assert.equal(context.gains[0].gain.value, 0);
  assert.equal(await audio.start(), true);
  audio.update({ elapsedMs: 82000, active: true, paused: false, chapter: 4, energy: 1 });
  assert.ok(context.gains[0].gain.value > 0);
  audio.update({ elapsedMs: 83000, active: true, paused: true, chapter: 4 });
  assert.equal(context.gains[0].gain.value, 0);
  audio.update({ elapsedMs: 150000, active: true, paused: false, chapter: 7 });
  assert.equal(context.gains[0].gain.value, 0);
  audio.dispose(); audio.dispose();
  assert.equal(context.closed, true);
  assert.ok(context.oscillators.every(oscillator => oscillator.stopped));
  assert.equal(await audio.start(), false);
});

test('audio support failure has a useful nonfatal message', () => {
  assert.throws(() => audioModule.createDroneShowAudio({ AudioContextClass: null }), /浏览器.*不支持/);
});

test('stunt audio loses motor hum in four batches and ignites at the shared thrust recovery', () => {
  const { DRONE_STUNT: stunt } = choreography;
  const gather = audioModule.sampleDroneAudioCue(stunt.fallStart - 100);
  assert.equal(gather.id, 'convergence');
  assert.ok(gather.pitch < 0.6 && gather.level < 0.3);
  for (let batch = 0; batch < stunt.batchCount; batch += 1) {
    const cue = audioModule.sampleDroneAudioCue(stunt.batchStarts[batch] + 150);
    assert.ok(Math.abs(cue.hum - 0.4 * (stunt.batchCount - batch - 1) / stunt.batchCount) < 1e-9);
    assert.equal(cue.impact, false);
  }
  assert.equal(audioModule.sampleDroneAudioCue(stunt.brakeStart - 1).impact, false);
  const saving = audioModule.sampleDroneAudioCue(stunt.brakeStart);
  assert.equal(saving.id, 'phoenix');
  assert.equal(saving.impact, true);
  assert.equal(audioModule.sampleDroneAudioCue(stunt.brakeStart + 2000).impact, false);
  assert.deepEqual(audioModule.sampleDroneAudioCue(stunt.recoverStart, true), audioModule.sampleDroneAudioCue(0));
  for (let elapsed = 0; elapsed <= 150000; elapsed += 100) {
    const cue = audioModule.sampleDroneAudioCue(elapsed);
    assert.ok(cue.level >= 0 && cue.level <= 1, `unexpected volume spike at ${elapsed}`);
  }
});

test('recovery sound is bounded, does not retrigger per update, and is absent in reduced-motion mode', async () => {
  const { instances, AudioContextClass } = audioHarness();
  const audio = audioModule.createDroneShowAudio({ AudioContextClass });
  await audio.start();
  const context = instances[0];
  const update = elapsedMs => audio.update({ elapsedMs, active: true, paused: false, chapter: 4 });
  update(choreography.DRONE_STUNT.fallStart + 500);
  assert.ok(context.gains[0].gain.value > 0, 'remaining hovering groups still hum');
  const before = context.oscillators.length;
  update(choreography.DRONE_STUNT.brakeStart);
  assert.equal(context.oscillators.length - before, 3, 'one low ignition and two soft bell partials');
  update(choreography.DRONE_STUNT.brakeStart + 250);
  update(choreography.DRONE_STUNT.recoverStart);
  assert.equal(context.oscillators.length - before, 3);
  audio.dispose();

  const calm = audioModule.createDroneShowAudio({ AudioContextClass });
  await calm.start();
  const calmContext = instances[1];
  calm.update({ elapsedMs: choreography.DRONE_STUNT.recoverStart, chapter: 4, reducedMotion: true });
  assert.equal(calmContext.oscillators.length, 5, 'only ambient harmonics and ordinary chapter bell');
  calm.dispose();
});
