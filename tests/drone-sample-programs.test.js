import test from 'node:test';
import assert from 'node:assert/strict';
import { DRONE_SAMPLE_PROGRAMS, createDroneSampleRuntime } from '../shared/droneSamplePrograms.js';
import { AI_DRONE_LIMITS, validateAiDroneScore } from '../shared/aiDroneScore.js';
import { createAiDroneRuntime } from '../shared/aiDroneShow.js';
import { isAiDroneRuntime, getDroneProgram, sampleDroneProgram, updateDroneProgram } from '../shared/dronePrograms.js';

const fleet = (count = 256) => {
  const item = { count, positions: new Float32Array(count * 3), colors: new Float32Array(count * 3), sizes: new Float32Array(count), bases: new Float32Array(count * 3), identities: new Uint16Array(count) };
  for (let i = 0; i < count; i++) {
    const id = Math.floor(i * 4096 / count); item.identities[i] = id;
    item.bases[i * 3] = (id % 64 - 31.5) * .25; item.bases[i * 3 + 1] = .65; item.bases[i * 3 + 2] = (Math.floor(id / 64) - 31.5) * .25;
  }
  return item;
};
const delta = (a, b) => a.reduce((max, value, index) => Math.max(max, Math.abs(value - b[index])), 0);
function bounds(value) {
  const result = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < value.count; i++) for (let axis = 0; axis < 3; axis++) {
    result.min[axis] = Math.min(result.min[axis], value.positions[i * 3 + axis]); result.max[axis] = Math.max(result.max[axis], value.positions[i * 3 + axis]);
  }
  return result;
}

test('three direct-authored volumetric programmes replace the long outline samples', () => {
  assert.deepEqual(DRONE_SAMPLE_PROGRAMS.map(show => show.id), ['phoenix-rebirth', 'tidal-whale', 'gravity-gate']);
  assert.deepEqual(DRONE_SAMPLE_PROGRAMS.map(show => show.duration), [108000, 112000, 100000]);
  assert.ok(Object.isFrozen(DRONE_SAMPLE_PROGRAMS));
  for (const entry of DRONE_SAMPLE_PROGRAMS) {
    const runtime = createDroneSampleRuntime(entry.id), program = runtime.program;
    assert.equal(createDroneSampleRuntime(entry.id), runtime); assert.ok(Object.isFrozen(entry)); assert.ok(Object.isFrozen(runtime)); assert.ok(Object.isFrozen(runtime.score));
    assert.equal(program.id, 'ai'); assert.equal(program.sampleId, entry.id); assert.equal(program.sampleVisual, 'spectacle-v2');
    assert.equal(program.duration, entry.duration); assert.ok(entry.duration < 120000);
    assert.equal(program.cinematic, true); assert.equal(program.supportsAudio, false); assert.equal(typeof runtime.visualFactory, 'function');
    assert.equal(program.chapters.filter(ch => ch.id === 'ascent').length, 1); assert.equal(program.chapters.filter(ch => ch.id === 'returning').length, 1); assert.equal(program.chapters.filter(ch => ch.id === 'blackout').length, 1);
    assert.equal(program.returnStart, program.duration - 14000);
    for (let index = 1; index < program.chapters.length; index++) assert.equal(program.chapters[index].start, program.chapters[index - 1].end);
    assert.equal(program.chapters.at(-1).end, entry.duration); assert.equal(program.chapters[0].start, 0);
    for (const chapter of program.chapters) assert.ok(chapter.id && chapter.label && chapter.description && chapter.end > chapter.start);
    assert.ok(isAiDroneRuntime(runtime)); assert.equal(getDroneProgram('ai', runtime), program); assert.equal(sampleDroneProgram(4000, 'ai', runtime).phase, 'ascent');
  }
  for (const id of ['injected', 'voyage-of-light', 'lanterns-home', 'stardust-return']) assert.throws(() => createDroneSampleRuntime(id), /未找到/);
});

test('local spectacle metadata does not widen or bypass public AI score validation', () => {
  assert.equal(AI_DRONE_LIMITS.maxScenes, 7); assert.equal(AI_DRONE_LIMITS.maxDuration, 18);
  for (const entry of DRONE_SAMPLE_PROGRAMS) {
    const score = createDroneSampleRuntime(entry.id).score;
    for (const copy of [score, JSON.parse(JSON.stringify(score)), JSON.stringify(score)]) assert.throws(() => validateAiDroneScore(copy));
    assert.throws(() => createAiDroneRuntime(JSON.parse(JSON.stringify(score))));
  }
});

test('full HUD state, finite typed buffers, deterministic seeks and continuous chapter edges', () => {
  for (const entry of DRONE_SAMPLE_PROGRAMS) {
    const runtime = createDroneSampleRuntime(entry.id), value = fleet(), program = runtime.program;
    const buffers = [value.positions, value.colors, value.sizes];
    for (const chapter of program.chapters) {
      const time = (chapter.start + chapter.end) / 2;
      const state = updateDroneProgram(value, time, { program: 'ai', aiRuntime: runtime });
      for (const key of ['elapsed', 'seconds', 'phase', 'label', 'description', 'progress', 'active', 'energy', 'cue', 'cueLabel', 'cueDescription', 'cueProgress', 'nextIn', 'sceneIndex']) assert.ok(Object.hasOwn(state, key), key);
      assert.ok(value.positions.every(Number.isFinite)); assert.ok(value.colors.every(Number.isFinite));
      assert.ok(value.sizes.every(size => size >= 0 && size <= .220001)); assert.ok(value.positions.every((p, i) => i % 3 !== 1 || p >= value.bases[i]));
      const snapshot = value.positions.slice(), colors = value.colors.slice(); runtime.update(value, 0); runtime.update(value, time);
      assert.deepEqual(value.positions, snapshot); assert.deepEqual(value.colors, colors);
      runtime.update(value, Math.max(0, chapter.start - .01)); const before = value.positions.slice(); runtime.update(value, chapter.start);
      assert.ok(delta(before, value.positions) < .01, `${entry.id}/${chapter.id} position jump`);
    }
    assert.equal(value.positions, buffers[0]); assert.equal(value.colors, buffers[1]); assert.equal(value.sizes, buffers[2]);
    runtime.update(value, program.duration); assert.deepEqual(value.positions, value.bases);
    assert.ok(value.sizes.every(size => size === 0)); assert.ok(value.colors.every(channel => channel === 0));
    assert.equal(runtime.sample(program.duration).active, false); assert.equal(runtime.sample(Infinity).elapsed, 0);
  }
});

test('2048-light quality is an exact subset of the same 4096 physical drone identities', () => {
  for (const entry of DRONE_SAMPLE_PROGRAMS) {
    const runtime = createDroneSampleRuntime(entry.id), full = fleet(4096), low = fleet(2048);
    for (const time of [0, 5000, 18000, 37000, 57000, 63000, 76000, runtime.program.returnStart + 6000, entry.duration]) {
      runtime.update(full, time); runtime.update(low, time);
      for (let index = 0; index < low.count; index++) {
        const id = low.identities[index]; assert.equal(low.sizes[index], full.sizes[id]);
        for (let axis = 0; axis < 3; axis++) { assert.equal(low.positions[index * 3 + axis], full.positions[id * 3 + axis]); assert.equal(low.colors[index * 3 + axis], full.colors[id * 3 + axis]); }
      }
    }
  }
});

test('hero forms use a genuine 3D fleet with broad silhouettes, finite bounds and compact emitters', () => {
  for (const entry of DRONE_SAMPLE_PROGRAMS) {
    const runtime = createDroneSampleRuntime(entry.id), value = fleet(4096);
    for (const time of [runtime.program.heroTime, runtime.program.highlightTime]) {
      runtime.update(value, time); const box = bounds(value);
      assert.ok(box.max[0] - box.min[0] > 95, `${entry.id} width`);
      assert.ok(box.max[2] - box.min[2] > 18, `${entry.id} volumetric depth`);
      assert.ok(value.sizes.every(size => size <= .220001 && size > .2));
    }
    for (let time = 8000; time < runtime.program.returnStart; time += 500) {
      runtime.update(value, time); const box = bounds(value);
      assert.ok(box.min[1] >= 7.999, `${entry.id}/${time} touches sea`);
      assert.ok(box.max[1] < 151, `${entry.id}/${time} sky bound`);
      assert.ok(box.min[0] > -90 && box.max[0] < 90);
      assert.ok(box.min[2] > -90 && box.max[2] < 90);
    }
  }
});

test('reduced motion freezes one finished beautiful formation and avoids dives, rain or color flashing', () => {
  for (const entry of DRONE_SAMPLE_PROGRAMS) {
    const runtime = createDroneSampleRuntime(entry.id), value = fleet(512);
    runtime.update(value, 8000, { reducedMotion: true }); const positions = value.positions.slice(), colors = value.colors.slice();
    for (let time = 9000; time < runtime.program.returnStart; time += 2000) {
      runtime.update(value, time, { reducedMotion: true }); assert.deepEqual(value.positions, positions); assert.deepEqual(value.colors, colors);
    }
    runtime.update(value, entry.duration, { reducedMotion: true }); assert.deepEqual(value.positions, value.bases); assert.ok(value.sizes.every(n => n === 0));
  }
});

test('gravity failure accelerates downward, stops above the sea and expands on the reverse ascent', () => {
  const runtime = createDroneSampleRuntime('gravity-gate'), value = fleet(4096);
  const centerY = time => { runtime.update(value, time); let sum = 0; for (let i = 0; i < value.count; i++) sum += value.positions[i * 3 + 1]; return sum / value.count; };
  const start = centerY(50000), middle = centerY(55000), low = centerY(60000), recovered = centerY(70000);
  assert.ok(start - middle > 10 && middle - low > 40); assert.ok(middle - low > (start - middle) * 2.5);
  assert.ok(recovered > low + 35); runtime.update(value, 60000); assert.ok(bounds(value).min[1] >= 8);
  assert.ok(runtime.sample(55000).energy < .4); assert.equal(runtime.sample(70000).energy, 1);
});

test('phoenix folds into a low fire seed and re-expands, whale jumps before dissolving into a wider star-rain field', () => {
  const value = fleet(4096), phoenix = createDroneSampleRuntime('phoenix-rebirth');
  phoenix.update(value, 37000); const high = bounds(value); phoenix.update(value, 62000); const low = bounds(value); phoenix.update(value, 81000); const reborn = bounds(value);
  assert.ok(high.max[0] - high.min[0] > 130); assert.ok(low.max[0] - low.min[0] < 15); assert.ok(low.max[1] < 28); assert.ok(reborn.max[0] - reborn.min[0] > 130);
  const whale = createDroneSampleRuntime('tidal-whale'); whale.update(value, 45000); const normal = bounds(value); whale.update(value, 59000); const jump = bounds(value); whale.update(value, 70000); const rain = bounds(value);
  assert.ok(jump.max[1] > normal.max[1] + 15); assert.ok(rain.max[2] - rain.min[2] > 60); assert.ok(rain.max[0] - rain.min[0] > 145);
});
