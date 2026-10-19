import test from 'node:test';
import assert from 'node:assert/strict';
import { DRONE_SAMPLE_PROGRAMS, createDroneSampleRuntime } from '../shared/droneSamplePrograms.js';
import { createCuratedAiDroneRuntime, createAiDroneRuntime } from '../shared/aiDroneShow.js';
import { AI_DRONE_LIMITS, validateAiDroneScore } from '../shared/aiDroneScore.js';
import { isAiDroneRuntime, getDroneProgram, sampleDroneProgram, updateDroneProgram } from '../shared/dronePrograms.js';

const fleet = (count = 256) => {
  const item = { count, positions: new Float32Array(count * 3), colors: new Float32Array(count * 3), sizes: new Float32Array(count), bases: new Float32Array(count * 3), identities: new Uint16Array(count) };
  for (let i = 0; i < count; i++) {
    const id = Math.floor(i * 4096 / count); item.identities[i] = id;
    item.bases[i * 3] = (id % 64 - 31.5) * .25;
    item.bases[i * 3 + 1] = .65;
    item.bases[i * 3 + 2] = (Math.floor(id / 64) - 31.5) * .25;
  }
  return item;
};
const delta = (a, b) => a.reduce((max, value, index) => Math.max(max, Math.abs(value - b[index])), 0);
const clone = value => JSON.parse(JSON.stringify(value));

test('three direct-authored bundled shows have exact 10/4/5-minute complete programmes', () => {
  assert.deepEqual(DRONE_SAMPLE_PROGRAMS.map(show => show.duration), [600000, 240000, 300000]);
  assert.deepEqual(DRONE_SAMPLE_PROGRAMS.map(show => show.sceneCount), [32, 12, 16]);
  assert.ok(Object.isFrozen(DRONE_SAMPLE_PROGRAMS));
  for (const entry of DRONE_SAMPLE_PROGRAMS) {
    const runtime = createDroneSampleRuntime(entry.id), program = runtime.program;
    assert.equal(createDroneSampleRuntime(entry.id), runtime);
    assert.ok(Object.isFrozen(entry)); assert.ok(Object.isFrozen(runtime)); assert.ok(Object.isFrozen(runtime.score.scenes));
    assert.equal(program.id, 'ai'); assert.equal(program.sampleId, entry.id);
    assert.equal(program.duration, entry.duration); assert.equal(program.cinematic, true); assert.equal(program.supportsAudio, false);
    assert.equal(program.chapters.filter(ch => ch.id === 'ascent').length, 1);
    assert.equal(program.chapters.filter(ch => ch.id === 'returning').length, 1);
    assert.equal(program.chapters.filter(ch => ch.id === 'blackout').length, 1);
    assert.equal(program.returnStart, program.duration - 14000);
    assert.ok(new Set(runtime.score.scenes.map(scene => scene.name)).size === entry.sceneCount);
    assert.ok(new Set(runtime.score.scenes.map(scene => `${scene.shape}:${JSON.stringify(scene.paths || [])}`)).size >= 8);
    for (let index = 1; index < program.chapters.length; index++) assert.equal(program.chapters[index].start, program.chapters[index - 1].end);
    assert.equal(program.chapters.at(-1).end, entry.duration);
    assert.ok(isAiDroneRuntime(runtime)); assert.equal(getDroneProgram('ai', runtime), program);
    assert.equal(sampleDroneProgram(10000, 'ai', runtime).phase, 'ascent');
  }
  assert.throws(() => createDroneSampleRuntime('injected'), /未找到/);
});

test('long samples do not widen public AI validation or trust copied/JSON score data', () => {
  assert.equal(AI_DRONE_LIMITS.maxScenes, 7); assert.equal(AI_DRONE_LIMITS.maxDuration, 18);
  const source = createDroneSampleRuntime(DRONE_SAMPLE_PROGRAMS[0].id).score;
  for (const data of [source, clone(source), JSON.stringify(source)]) {
    assert.throws(() => validateAiDroneScore(data), error => error.code === 'AI_SCORE_SCENES');
  }
  assert.throws(() => createAiDroneRuntime(clone(source)), error => error.code === 'AI_SCORE_SCENES');
  for (const count of [3, 33]) assert.throws(() => createCuratedAiDroneRuntime({ ...clone(source), scenes: Array(count).fill(source.scenes[0]) }), RangeError);
  assert.throws(() => createCuratedAiDroneRuntime({ ...clone(source), scenes: Array(32).fill(source.scenes[0]) }), /10 分钟/);
  assert.throws(() => createCuratedAiDroneRuntime({ ...clone(source), remoteUrl: 'https://invalid.test' }), TypeError);
  const invalid = clone(source); invalid.scenes[0].motion = 'run-script';
  assert.throws(() => createCuratedAiDroneRuntime(invalid), error => error.code === 'AI_SCORE_CHOICE');
  const longScene = clone(source); longScene.scenes[0].duration = 19;
  assert.throws(() => createCuratedAiDroneRuntime(longScene), error => error.code === 'AI_SCORE_DURATION');
  let getterRead = false; const accessor = { ...clone(source) };
  Object.defineProperty(accessor, 'scenes', { get() { getterRead = true; return []; } });
  assert.throws(() => createCuratedAiDroneRuntime(accessor), TypeError); assert.equal(getterRead, false);
  const arrayAccessor = clone(source);
  Object.defineProperty(arrayAccessor.scenes, 0, { get() { getterRead = true; return source.scenes[0]; } });
  assert.throws(() => createCuratedAiDroneRuntime(arrayAccessor), RangeError); assert.equal(getterRead, false);
});

test('all chapter positions are finite, deterministic and continuous, with one full recovery', () => {
  for (const entry of DRONE_SAMPLE_PROGRAMS) {
    const runtime = createDroneSampleRuntime(entry.id), value = fleet(), program = runtime.program;
    const buffers = [value.positions, value.colors, value.sizes];
    for (const chapter of program.chapters) {
      const time = (chapter.start + chapter.end) / 2;
      updateDroneProgram(value, time, { program: 'ai', aiRuntime: runtime });
      assert.ok(value.positions.every(Number.isFinite)); assert.ok(value.colors.every(Number.isFinite));
      assert.ok(value.sizes.every(size => size >= 0 && size <= .220001));
      assert.ok(value.positions.every((position, index) => index % 3 !== 1 || position >= value.bases[index]));
      const snapshot = value.positions.slice(); runtime.update(value, 0); runtime.update(value, time);
      assert.deepEqual(value.positions, snapshot);
      runtime.update(value, Math.max(0, chapter.start - .01)); const before = value.positions.slice();
      runtime.update(value, chapter.start);
      assert.ok(delta(before, value.positions) < .006, `${entry.id}/${chapter.id} has no position jump`);
    }
    assert.equal(value.positions, buffers[0]); assert.equal(value.colors, buffers[1]); assert.equal(value.sizes, buffers[2]);
    runtime.update(value, program.duration);
    assert.deepEqual(value.positions, value.bases);
    assert.ok(value.sizes.every(size => size === 0)); assert.ok(value.colors.every(channel => channel === 0));
    assert.equal(runtime.sample(program.duration).active, false);
    assert.equal(runtime.sample(Infinity).elapsed, 0);
  }
});

test('long-form outlines keep separated emitters and stable low-tier fleet identities', () => {
  const runtime = createDroneSampleRuntime('voyage-of-light'), full = fleet(4096), low = fleet(2048);
  for (const sceneIndex of [2, 9, 17, 20, 27]) {
    const chapter = runtime.program.chapters[sceneIndex + 2], time = chapter.end - .001;
    runtime.update(full, time); runtime.update(low, time);
    const active = [];
    for (let index = 0; index < full.count; index++) if (full.sizes[index] > .01) active.push(index);
    assert.ok(active.length >= 100 && active.length < 1300);
    for (let a = 0; a < active.length; a++) for (let b = a + 1; b < active.length; b++) {
      const one = active[a] * 3, two = active[b] * 3;
      assert.ok(Math.hypot(full.positions[one] - full.positions[two], full.positions[one + 1] - full.positions[two + 1]) > .8998);
    }
    for (let index = 0; index < low.count; index++) {
      const id = low.identities[index]; assert.equal(low.sizes[index], full.sizes[id]);
      for (let axis = 0; axis < 3; axis++) assert.equal(low.positions[index * 3 + axis], full.positions[id * 3 + axis]);
    }
  }
});
