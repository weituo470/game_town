import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseRehearsalLrc, createRehearsalPlan, validateRehearsalPlan } from '../shared/musicRehearsal.js';
import { createMusicRehearsalRuntime } from '../src/components/drone/musicRehearsalRuntime.js';
import { createDroneFleet } from '../shared/droneShow.js';
import { createDroneShowClock } from '../src/lib/droneShowClock.js';
import { droneAudioUrl } from '../src/lib/droneAudioUrl.js';

test('LRC imports actual timestamps, multi-tags, fractional seconds and offset, not estimated timings', () => {
  const rows = parseRehearsalLrc('[offset:-100]\n[00:08.20][00:18.250]出发\n[00:08.20]重复翻译\n[00:29.5]归来', 32000);
  assert.deepEqual(rows.map(r => r.startMs), [8100, 18150, 29400]);
  assert.equal(rows[0].text, '出发'); assert.equal(rows[0].endMs, 18150); assert.equal(rows.at(-1).endMs, 32000);
  assert.throws(() => parseRehearsalLrc('只有文字，没有时间', 32000));
});
test('empty lyrics are explicitly a draft; imported LRC is review-needed, never automatically verified', () => {
  const draft = createRehearsalPlan({ durationMs: 32000 });
  assert.equal(draft.timing, 'draft-not-lyric-aligned'); assert.equal(draft.cues.length, 8);
  const lyrics = parseRehearsalLrc('[00:08.000]看见山海\n[00:20.000]城市的灯', 32000);
  const plan = createRehearsalPlan({ durationMs: 32000, lyrics });
  assert.equal(plan.timing, 'imported-lrc-needs-review'); assert.deepEqual(plan.cues.map(c => c.theme), ['mountains', 'city']);
  assert(!JSON.stringify(plan).includes('城市的灯'), 'exported choreography need not redistribute lyric text');
});
test('plans reject wrong durations, unordered timestamps and executable or unknown actor kinds', () => {
  const plan = createRehearsalPlan({ durationMs: 32000 });
  for (const durationMs of [NaN, 0, -1, 600001, Infinity]) assert.throws(() => validateRehearsalPlan({ ...plan, durationMs }));
  assert.throws(() => validateRehearsalPlan({ ...plan, cues: [{ startMs: 1, endMs: 100, theme: 'eval' }] }));
  assert.throws(() => validateRehearsalPlan({ ...plan, cues: [...plan.cues].reverse() }));
});
test('music runtime keeps all identities, finite buffers, deterministic seeks and exact physical return', () => {
  const runtime = createMusicRehearsalRuntime(createRehearsalPlan({ durationMs: 32000, beats: [8000, 16000] }));
  for (const count of [2048, 4096]) {
    const fleet = createDroneFleet(count), ids = fleet.identities.slice();
    for (const time of [0, 2000, 8000, 14000, 16000, 24000, 31999, 32000]) {
      runtime.update(fleet, time); assert(fleet.positions.every(Number.isFinite)); assert(fleet.colors.every(Number.isFinite)); assert.deepEqual(fleet.identities, ids);
    }
    assert.deepEqual(fleet.positions, fleet.bases); assert(fleet.colors.every(v => v === 0));
    runtime.update(fleet, 16000); const positions = fleet.positions.slice(); runtime.update(fleet, 26000); runtime.update(fleet, 16000); assert.deepEqual(fleet.positions, positions);
    for (const aspect of [.46, 1.78, 0]) assert(Object.values(runtime.camera(16000, aspect)).flat().every(Number.isFinite));
  }
});
function master() {
  return { currentTime: 0, paused: true, ended: false, playbackRate: 1, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
}
test('decoder playhead is the sole clock; stalls, backward seeks, pause, speed and close remain coherent', () => {
  const audio = master(), runtime = createMusicRehearsalRuntime(createRehearsalPlan({ durationMs: 32000 }), { audio });
  let now = 0;
  const clock = createDroneShowClock({ now: () => now }); clock.start({ program: 'ai', aiRuntime: runtime });
  audio.currentTime = 9.25; now = 123000;
  assert.equal(clock.timeRef.current, 9250); now += 10000; assert.equal(clock.timeRef.current, 9250, 'buffer stall does not advance the show');
  clock.togglePause(); assert(audio.paused); assert(clock.snapshot().paused);
  clock.seek(4000); assert.equal(audio.currentTime, 4); assert.equal(clock.timeRef.current, 4000); assert(audio.paused);
  clock.togglePause(); assert(!audio.paused); clock.setSpeed(2); assert.equal(audio.playbackRate, 2);
  audio.currentTime = 10; assert.equal(clock.snapshot().elapsedMs, 10000);
  clock.setProgram('avatar'); assert(audio.paused); clock.setProgram('ai'); assert.equal(audio.currentTime, 0);
  clock.close(); assert(audio.paused); assert(!clock.snapshot().aiRuntime);
});
test('a blocked media play remains paused rather than running a silent independent show', async () => {
  const audio = master(); audio.play = () => Promise.reject(new Error('blocked'));
  const runtime = createMusicRehearsalRuntime(createRehearsalPlan({ durationMs: 32000 }), { audio });
  const clock = createDroneShowClock(); clock.start({ program: 'ai', aiRuntime: runtime }); await Promise.resolve();
  assert(clock.snapshot().paused); assert.equal(clock.timeRef.current, 0); clock.close();
});
test('audio URLs retain same-origin enforcement while allowing browser-owned local media blobs', () => {
  assert.equal(droneAudioUrl('blob:http://localhost:4200/abc', 'http://localhost:4200'), 'blob:http://localhost:4200/abc');
  for (const u of ['blob:https://evil.invalid/id', 'https://evil.invalid/song.mp3', 'data:audio/wav;base64,AA==']) assert.throws(() => droneAudioUrl(u, 'http://localhost:4200'));
  assert.equal(droneAudioUrl('/audio/test.mp3'), '/audio/test.mp3');
});
test('music export takes H.264 presentation timestamps from the shared playback head, not wall time', () => {
  const code = fs.readFileSync(new URL('../src/components/drone/DroneVideoExport.jsx', import.meta.url), 'utf8');
  assert.match(code, /MediaRecorderClass: null, now: \(\) => source.controller.timeRef.current/);
  assert.match(code, /disabled=\{Boolean\(program.mediaMaster\)\}/);
});
