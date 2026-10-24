import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAiDroneRuntime } from '../shared/aiDroneShow.js';
import { createDroneFleet, updateDroneFleet } from '../shared/droneShow.js';
import { getDroneProgram, sampleDroneProgram, updateDroneProgram } from '../shared/dronePrograms.js';
import { createDroneShowClock } from '../src/lib/droneShowClock.js';
const score = title => ({ version: 1, title, synopsis: '由小镇出发，追寻星空。', seed: 1987,
  scenes: ['city', 'bird', 'sphere', 'flower'].map((shape, i) => ({
    name: '章节' + (i + 1), description: '一幅星光画面。', shape, color: '#ffd18a', accent: '#6edfff',
    duration: 10, motion: 'breathe', transition: 'morph',
  })) });
test('personal AI clock derives duration, restarts/seeks and restores saved score after static shows', () => {
  let now = 0;
  const clock = createDroneShowClock({ now: () => now });
  const runtime = createAiDroneRuntime(score('追星之旅'));
  const start = clock.start({ program: 'ai', aiRuntime: runtime, view: 'fpv' });
  assert.equal(start.program, 'ai'); assert.equal(start.view, 'cinematic');
  assert.equal(getDroneProgram('ai', start.aiRuntime), runtime.program);
  now += 12000; assert.equal(clock.snapshot().elapsedMs, 12000);
  clock.togglePause(); now += 1000; assert.equal(clock.snapshot().elapsedMs, 12000);
  clock.seek(runtime.program.duration);
  assert.equal(clock.snapshot().ended, true);
  clock.start({ program: 'ai' }); assert.equal(clock.snapshot().elapsedMs, 0);
  clock.setProgram('droplet'); assert.equal(clock.snapshot().program, 'droplet');
  clock.setProgram('ai'); assert.equal(clock.snapshot().aiRuntime, runtime);
  assert.equal(clock.snapshot().elapsedMs, 0);
  clock.close(); now += 90000; assert.equal(clock.snapshot().active, false);
});
test('invalid AI entry is a no-op; separate viewers cannot overwrite one another', () => {
  const a = createDroneShowClock({ now: () => 0 }), b = createDroneShowClock({ now: () => 0 });
  const previous = a.start({ program: 'droplet', elapsedMs: 7000 });
  assert.deepEqual(a.start({ program: 'ai', aiRuntime: { program: { id: 'ai' } } }), previous);
  a.start({ program: 'ai', aiRuntime: createAiDroneRuntime(score('甲的天空')) });
  b.start({ program: 'ai', aiRuntime: createAiDroneRuntime(score('乙的天空')) });
  assert.equal(a.snapshot().aiRuntime.program.title, '甲的天空');
  assert.equal(b.snapshot().aiRuntime.program.title, '乙的天空');
});
test('dispatcher uses trusted runtime and can restore original fleet without stale data', () => {
  const runtime = createAiDroneRuntime(score('恢复'));
  const fleet = createDroneFleet(2048), original = createDroneFleet(2048);
  updateDroneProgram(fleet, 26000, { program: 'ai', aiRuntime: runtime });
  assert.deepEqual(sampleDroneProgram(26000, 'ai', runtime), runtime.sample(26000));
  updateDroneProgram(fleet, 76000, { program: 'avatar' }); updateDroneFleet(original, 76000);
  assert.deepEqual(fleet.positions, original.positions);
  assert.deepEqual(fleet.colors, original.colors);
});
test('AI editor and compiler stay lazy and reuse the single scene with explicit runtime', () => {
  const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
  assert.match(read('src/App.jsx'), /React\.lazy\(\(\) => import\('\.\/components\/drone\/AiDroneStudio\.jsx'\)\)/);
  assert.doesNotMatch(read('shared/dronePrograms.js'), /import.+aiDrone(?:Show|Score)/);
  assert.match(read('src/components/Town.jsx'), /<DroneShow aiRuntime=\{props\.droneFpv\?\.aiRuntime\}/);
  assert.match(read('src/components/drone/DroneShow.jsx'), /aiRuntime\.camera\(timeRef\.current,aspect,reducedMotion\)/);
  assert.match(read('src/components/drone/DroneShowControls.jsx'), /program\.supportsAudio === false \|\| audioStatus/);
});
