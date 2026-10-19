import test from 'node:test';
import assert from 'node:assert/strict';
import { DRONE_SAMPLE_PROGRAMS, createDroneSampleRuntime } from '../shared/droneSamplePrograms.js';
import { AI_DRONE_LIMITS, validateAiDroneScore } from '../shared/aiDroneScore.js';
import { createAiDroneRuntime } from '../shared/aiDroneShow.js';
import { isAiDroneRuntime, getDroneProgram, sampleDroneProgram, updateDroneProgram } from '../shared/dronePrograms.js';
import { WHALE_STORY_MEMBERS, sampleWhaleStoryMembers } from '../shared/droneShortShow.js';

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
  assert.deepEqual(DRONE_SAMPLE_PROGRAMS.map(show => show.duration), [108000, 118000, 100000]);
  assert.ok(Object.isFrozen(DRONE_SAMPLE_PROGRAMS));
  for (const entry of DRONE_SAMPLE_PROGRAMS) {
    const runtime = createDroneSampleRuntime(entry.id), program = runtime.program;
    assert.equal(createDroneSampleRuntime(entry.id), runtime); assert.ok(Object.isFrozen(entry)); assert.ok(Object.isFrozen(runtime)); assert.ok(Object.isFrozen(runtime.score));
    assert.equal(program.id, 'ai'); assert.equal(program.sampleId, entry.id); assert.equal(program.sampleVisual, 'spectacle-v2');
    assert.equal(program.duration, entry.duration); assert.ok(entry.duration < 120000);
    assert.equal(program.cinematic, true); assert.equal(program.supportsAudio, entry.id === 'tidal-whale'); assert.equal(typeof runtime.visualFactory, 'function');
    assert.equal(program.chapters.filter(ch => ch.id === 'ascent').length, 1); assert.equal(program.chapters.filter(ch => ch.id === 'returning').length, 1); assert.equal(program.chapters.filter(ch => ch.id === 'blackout').length, 1);
    assert.equal(program.returnStart, program.duration - (entry.id === 'tidal-whale' ? 10000 : 14000));
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
      const whale = entry.id === 'tidal-whale';
      assert.ok(box.max[1] < (whale ? 175 : 151), `${entry.id}/${time} sky bound`);
      assert.ok(box.min[0] > (whale ? -140 : -90) && box.max[0] < (whale ? 120 : 90));
      assert.ok(box.min[2] > (whale ? -130 : -90) && box.max[2] < 90);
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

test('phoenix folds into a low fire seed and re-expands without changes to its existing choreography', () => {
  const value = fleet(4096), phoenix = createDroneSampleRuntime('phoenix-rebirth');
  phoenix.update(value, 37000); const high = bounds(value); phoenix.update(value, 62000); const low = bounds(value); phoenix.update(value, 81000); const reborn = bounds(value);
  assert.ok(high.max[0] - high.min[0] > 130); assert.ok(low.max[0] - low.min[0] < 15); assert.ok(low.max[1] < 28); assert.ok(reborn.max[0] - reborn.min[0] > 130);
});

test('whale story keeps five persistent identities, a recognisably smaller warm calf and sequential family arrivals', () => {
  assert.deepEqual(WHALE_STORY_MEMBERS.map(member => member.id), ['mother', 'calf', 'companion', 'elder', 'sibling']);
  assert.equal(WHALE_STORY_MEMBERS.reduce((sum, member) => sum + member.count, 0), 4096);
  assert.ok(WHALE_STORY_MEMBERS[0].count >= 2048); assert.ok(WHALE_STORY_MEMBERS[1].warmth >= .5 && WHALE_STORY_MEMBERS[1].warmth <= .65);
  const first = sampleWhaleStoryMembers(34000), pair = sampleWhaleStoryMembers(46000), all = sampleWhaleStoryMembers(70000);
  assert.deepEqual(first.map(member => member.formed), [1, 0, 0, 0, 0]);
  assert.deepEqual(pair.map(member => member.formed), [1, 1, 0, 0, 0]);
  assert.ok(pair[1].scale < pair[0].scale * .5);
  assert.ok(Math.hypot(...pair[0].position.map((value, axis) => value - pair[1].position[axis])) < 65);
  assert.ok(all.every(member => member.formed === 1));
  for (let time = 70000; time <= 108000; time += 500) {
    const actors = sampleWhaleStoryMembers(time);
    assert.deepEqual(actors.map(member => member.id), all.map(member => member.id));
    assert.ok(actors.every(member => member.formed === 1), 'formed whales never dissolve into a different motif');
    assert.ok(actors[1].scale < actors[0].scale * .53);
    for (let index = 0; index < actors.length; index++) for (let other = index + 1; other < actors.length; other++) {
      const nearFamily = index === 0 && other === 1;
      assert.ok(Math.hypot(...actors[index].position.map((value, axis) => value - actors[other].position[axis])) > (nearFamily ? 32 : 40), 'distinct depth lanes, with the calf sheltered close to its mother');
    }
  }
});

test('whale family rises together, glides home with the calf, and each drone returns to its own launch site', () => {
  const runtime = createDroneSampleRuntime('tidal-whale'), value = fleet(4096);
  const before = sampleWhaleStoryMembers(84000), leap = sampleWhaleStoryMembers(90000), home = sampleWhaleStoryMembers(108000);
  before.forEach((member, index) => {
    assert.ok(leap[index].position[1] > member.position[1] + 14);
    assert.ok(leap[index].pitch < -.35, 'all family members visibly lift their noses');
    assert.ok(home[index].position[2] < leap[index].position[2] - 20, 'the family heads towards depth rather than disappearing');
  });
  assert.ok(Math.hypot(...home[0].position.map((value, axis) => value - home[1].position[axis])) < 45);
  assert.deepEqual(runtime.program.chapters.filter(chapter => chapter.sceneIndex !== undefined).map(chapter => chapter.id),
    ['tide', 'mother-call', 'calf-answer', 'family-arrives', 'reunion', 'family-breach', 'homecoming']);
  assert.equal(runtime.program.heroTime, 46000); assert.equal(runtime.program.highlightTime, 90000);
  assert.equal(runtime.program.returnStart, 108000); assert.equal(runtime.program.duration, 118000);
  assert.equal(runtime.program.supportsAudio, true); assert.equal(runtime.program.soundtrackDurationMs, runtime.program.duration);
  assert.equal(runtime.program.soundtrackUrl, '/audio/whale-homecoming.mp3');
  for (const time of [116000, 118000]) { runtime.update(value, time); assert.deepEqual(value.positions, value.bases); }
  assert.ok(value.sizes.every(size => size === 0)); assert.ok(value.colors.every(channel => channel === 0));
});

test('every whale path and colour is continuous at story transitions, including arbitrary reverse seeks', () => {
  const runtime = createDroneSampleRuntime('tidal-whale'), value = fleet(4096);
  const boundaries = [8000, 20000, 30000, 36000, 45000, 46000, 52000, 58000, 61000, 62000, 66000, 70000, 78000, 84000, 90000, 96000, 100000, 108000, 116000];
  for (const time of boundaries) {
    runtime.update(value, time - .01); const positions = value.positions.slice(), colors = value.colors.slice();
    runtime.update(value, time); assert.ok(delta(positions, value.positions) < .01); assert.ok(delta(colors, value.colors) < .001);
    const exact = value.positions.slice(); runtime.update(value, 117000); runtime.update(value, 21000); runtime.update(value, time);
    assert.deepEqual(value.positions, exact);
  }
});

test('small whales regenerate an even local golden-angle skin instead of aliasing a strided full-size cloud into ribs', () => {
  const runtime = createDroneSampleRuntime('tidal-whale'), actors = sampleWhaleStoryMembers(78000), value = fleet(4096);
  runtime.update(value, 78000); const golden = Math.PI * (3 - Math.sqrt(5)), tau = Math.PI * 2, counts = Array(5).fill(0);
  for (let id = 0; id < value.count; id++) {
    const globalRank = (id * 1597) % 4096; let member = 0, start = 0;
    while (globalRank >= start + WHALE_STORY_MEMBERS[member].count) { start += WHALE_STORY_MEMBERS[member].count; member++; }
    const actor = actors[member], count = WHALE_STORY_MEMBERS[member].count, rank = ((globalRank - start) * 1597) % count;
    if (rank >= Math.round(count * .61)) continue;
    const k = id * 3, dx = value.positions[k] - actor.position[0], dy = value.positions[k + 1] - actor.position[1];
    const c = Math.cos(actor.pitch), s = Math.sin(actor.pitch), x = (dx * c + dy * s) / actor.scale;
    let y = (-dx * s + dy * c) / actor.scale, z = (value.positions[k + 2] - actor.position[2]) / actor.scale;
    const weight = Math.max(0, Math.min(1, (x + 10) / 64));
    y -= Math.sin(78 * .77 + actor.phase + weight * 2.4) * weight * weight * 4.2;
    z -= Math.cos(78 * .58 + actor.phase + weight) * weight * 2.1;
    const unrolledY = y * .921 + z * .389, unrolledZ = -y * .389 + z * .921;
    const angle = Math.atan2(unrolledZ / .83, unrolledY), expected = rank * golden;
    const error = Math.abs(Math.atan2(Math.sin(angle - expected), Math.cos(angle - expected)));
    assert.ok(error < .001, `local surface resonance in ${actor.id}: ${error}`); counts[member]++;
  }
  assert.deepEqual(counts, WHALE_STORY_MEMBERS.map(member => Math.round(member.count * .61)));
});
