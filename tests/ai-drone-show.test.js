import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_DRONE_SHAPES, validateAiDroneScore } from '../shared/aiDroneScore.js';
import { createAiDroneProgram, sampleAiDroneShow, updateAiDroneFleet, createAiDroneRuntime, AI_DRONE_LAUNCH_MS, AI_DRONE_RETURN_MS, AI_DRONE_BLACKOUT_MS } from '../shared/aiDroneShow.js';

const makeScene = (shape = 'whale', extra = {}) => ({ name: `${shape} 编队`, description: '星光描绘一个清晰的天空画面。', shape, color: '#21A9FF', accent: '#FFD285', duration: 10, motion: 'wave', transition: 'morph', ...(shape === 'outline' ? { paths: [[[-1, -.5], [-.3, .7], [.3, -.5], [1, .7]], [[-.7, -.8], [.7, -.8]]] } : {}), ...extra });
const makeScore = (shapes = ['ring', 'whale', 'flower', 'sphere'], extra = {}) => validateAiDroneScore({ version: 1, title: '星海来信', synopsis: '海洋与花园，一起飞向星空。', seed: 9876, scenes: shapes.map(shape => makeScene(shape)), ...extra });
function makeFleet(count = 4096) {
  const fleet = { count, positions: new Float32Array(count * 3), colors: new Float32Array(count * 3), sizes: new Float32Array(count), bases: new Float32Array(count * 3), identities: new Uint16Array(count) };
  for (let i = 0; i < count; i++) {
    const id = Math.floor(i * 4096 / count); fleet.identities[i] = id;
    const k = i * 3; fleet.bases[k] = (id % 32 - 15.5) * .23 + (id < 2048 ? -26 : 26); fleet.bases[k + 1] = .65; fleet.bases[k + 2] = (Math.floor(id / 32) % 32 - 15.5) * .23 + (id % 2048 < 1024 ? -24 : 24);
  }
  return fleet;
}
const maxDifference = (a, b) => a.reduce((max, value, index) => Math.max(max, Math.abs(value - b[index])), 0);

test('programme derives duration and every boundary from immutable score, enforcing launch/recovery/blackout', () => {
  const score = makeScore(), program = createAiDroneProgram(score);
  assert.equal(program.duration, 66000); assert.equal(program.returnStart, 52000);
  assert.equal(program.duration, AI_DRONE_LAUNCH_MS + 40000 + AI_DRONE_RETURN_MS + AI_DRONE_BLACKOUT_MS);
  assert.equal(program.id, 'ai'); assert.equal(program.supportsFpv, false); assert.equal(program.supportsAudio, false);
  assert.equal(createAiDroneProgram(score), program);
  assert.ok(Object.isFrozen(program)); assert.ok(Object.isFrozen(program.chapters));
  for (let i = 0; i < program.chapters.length; i++) {
    const chapter = program.chapters[i]; assert.ok(Object.isFrozen(chapter));
    assert.equal(sampleAiDroneShow(chapter.start, score).phase, chapter.id);
    if (i) assert.equal(chapter.start, program.chapters[i - 1].end);
  }
  const end = sampleAiDroneShow(program.duration, score);
  assert.equal(end.energy, 0); assert.equal(end.active, false); assert.equal(end.progress, 1);
  assert.equal(sampleAiDroneShow(program.duration + 1e8, score).elapsed, program.duration);
  for (const invalid of [NaN, Infinity, -1, undefined]) assert.equal(sampleAiDroneShow(invalid, score).elapsed, 0);
  const longest = makeScore(Array(7).fill('city'), { scenes: Array.from({ length: 7 }, () => makeScene('city', { duration: 18 })) });
  assert.equal(createAiDroneProgram(longest).duration, 152000);
});

test('all shapes produce distinct finite sky point clouds and full fixed-identity recovery', () => {
  const signatures = new Set();
  for (const shape of AI_DRONE_SHAPES) {
    const score = makeScore(Array(4).fill(shape)), fleet = makeFleet();
    updateAiDroneFleet(fleet, 17000, { score });
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < fleet.count; i++) {
      const k = i * 3;
      for (let axis = 0; axis < 3; axis++) assert.ok(Number.isFinite(fleet.positions[k + axis]));
      minX = Math.min(minX, fleet.positions[k]); maxX = Math.max(maxX, fleet.positions[k]); minY = Math.min(minY, fleet.positions[k + 1]); maxY = Math.max(maxY, fleet.positions[k + 1]);
      assert.ok(Math.abs(fleet.positions[k]) < 70); assert.ok(fleet.positions[k + 1] > 20 && fleet.positions[k + 1] < 125); assert.ok(Math.abs(fleet.positions[k + 2]) < 45);
      assert.ok(fleet.sizes[i] > 0 && fleet.sizes[i] < .5);
    }
    assert.ok(maxX - minX > 30, `${shape} needs legible width`); assert.ok(maxY - minY > 25, `${shape} needs legible height`);
    signatures.add(Array.from(fleet.positions.slice(0, 15)).join(','));
    updateAiDroneFleet(fleet, createAiDroneProgram(score).duration, { score });
    assert.deepEqual(fleet.positions, fleet.bases); assert.ok(fleet.colors.every(v => v === 0)); assert.ok(fleet.sizes.every(v => v === 0));
  }
  assert.equal(signatures.size, AI_DRONE_SHAPES.length);
});

test('render buffers remain stable and seek sampling is deterministic at every second', () => {
  const score = makeScore(), fleet = makeFleet(), program = createAiDroneProgram(score);
  const references = [fleet.positions, fleet.colors, fleet.sizes, fleet.bases, fleet.identities];
  for (const reducedMotion of [false, true]) for (let time = 0; time <= program.duration; time += 1000) {
    updateAiDroneFleet(fleet, time, { score, reducedMotion });
    assert.deepEqual([fleet.positions, fleet.colors, fleet.sizes, fleet.bases, fleet.identities], references);
    for (let i = 0; i < fleet.count; i++) {
      assert.ok(fleet.positions[i * 3 + 1] >= fleet.bases[i * 3 + 1]);
      assert.ok(fleet.colors[i * 3] >= 0 && fleet.colors[i * 3] <= 1.71);
    }
  }
  for (const time of [0, 12000, 15123, 22100, 42001, 51999, 58000, 65000, 66000]) {
    updateAiDroneFleet(fleet, time, { score }); const first = fleet.positions.slice(), colors = fleet.colors.slice();
    updateAiDroneFleet(fleet, 123, { score }); updateAiDroneFleet(fleet, time, { score });
    assert.deepEqual(fleet.positions, first); assert.deepEqual(fleet.colors, colors);
  }
});

test('all transition and motion modes remain continuous at scene, launch and recovery boundaries', () => {
  for (const motion of ['still', 'turn', 'breathe', 'wave']) for (const transition of ['morph', 'sweep', 'burst']) {
    const score = makeScore(undefined, { scenes: ['ring', 'whale', 'flower', 'city'].map(shape => makeScene(shape, { motion, transition })) });
    const fleet = makeFleet(256), program = createAiDroneProgram(score);
    for (const boundary of [...program.chapters.map(ch => ch.start), 25000, 35000, 45000, program.duration]) {
      updateAiDroneFleet(fleet, boundary - .01, { score }); const before = fleet.positions.slice();
      updateAiDroneFleet(fleet, boundary, { score });
      assert.ok(maxDifference(before, fleet.positions) < .005, `${motion}/${transition} discontinuity at ${boundary}`);
    }
  }
});

test('reduced motion suppresses shape dynamics and burst spread without flashing emitters', () => {
  const score = makeScore(undefined, { scenes: ['ring', 'whale', 'flower', 'city'].map(shape => makeScene(shape, { motion: 'wave', transition: 'burst' })) });
  const normal = makeFleet(256), reduced = makeFleet(256);
  for (const time of [22001, 23000, 23500, 24500, 26000]) {
    updateAiDroneFleet(normal, time, { score }); updateAiDroneFleet(reduced, time, { score, reducedMotion: true });
    assert.ok(maxDifference(normal.positions, reduced.positions) < 12);
    assert.deepEqual(normal.sizes, reduced.sizes); assert.deepEqual(normal.colors, reduced.colors);
  }
});

test('sweep starts continuously even at the widest planet and galaxy extent', () => {
  const score = makeScore(undefined, { scenes: ['sphere', 'galaxy', 'sphere', 'city'].map(shape => makeScene(shape, { transition: 'sweep' })) });
  const fleet = makeFleet();
  for (const time of [22000, 32000, 42000]) {
    updateAiDroneFleet(fleet, time - .01, { score }); const before = fleet.positions.slice();
    updateAiDroneFleet(fleet, time, { score });
    assert.ok(maxDifference(before, fleet.positions) < .005);
  }
});

test('2048-light tier preserves full-quality identity positions and colors', () => {
  const score = makeScore(), full = makeFleet(), low = makeFleet(2048);
  for (const time of [0, 5000, 14000, 23234, 32000, 45000, 57000, 66000]) {
    updateAiDroneFleet(full, time, { score }); updateAiDroneFleet(low, time, { score });
    for (let i = 0; i < low.count; i++) {
      const identity = low.identities[i];
      for (let axis = 0; axis < 3; axis++) {
        assert.equal(low.positions[i * 3 + axis], full.positions[identity * 3 + axis]);
        assert.equal(low.colors[i * 3 + axis], full.colors[identity * 3 + axis]);
      }
    }
  }
});

test('switching scores invalidates only the fleet cache, runtime wrappers stay isolated', () => {
  const one = createAiDroneRuntime(makeScore()), two = createAiDroneRuntime(makeScore(Array(4).fill('city'), { seed: 44 }));
  const fleet = makeFleet(256);
  one.update(fleet, 18000); const first = fleet.positions.slice();
  two.update(fleet, 18000); assert.notDeepEqual(fleet.positions, first);
  one.update(fleet, 18000); assert.deepEqual(fleet.positions, first);
  assert.equal(one.score.seed, 9876); assert.equal(two.score.seed, 44); assert.ok(Object.isFrozen(one));
  assert.deepEqual(one.sample(18000), sampleAiDroneShow(18000, one.score));
});

test('camera is deterministic, finite, portrait-aware and stationary in reduced-motion mode', () => {
  const runtime = createAiDroneRuntime(makeScore());
  for (const aspect of [16 / 9, 390 / 844, 0, NaN, Infinity, 4]) for (const time of [0, 12000, 30000, 66000, Infinity]) {
    const pose = runtime.camera(time, aspect, false);
    assert.deepEqual(pose, runtime.camera(time, aspect, false));
    assert.ok([...pose.position, ...pose.target, pose.fov, pose.near, pose.far].every(Number.isFinite));
    assert.ok(pose.far >= 600); assert.equal(pose.fov, 50);
  }
  assert.deepEqual(runtime.camera(0, 16 / 9, true), runtime.camera(30000, 16 / 9, true));
  assert.ok(runtime.camera(30000, 390 / 844).position[2] > runtime.camera(30000, 16 / 9).position[2]);
});

test('invalid buffers, identity values and unsafe scores fail before frame mutation', () => {
  const score = makeScore();
  for (const bad of [null, {}, { ...makeFleet(8), count: 0 }, { ...makeFleet(8), positions: new Float32Array(3) }, { ...makeFleet(8), count: 4097 }]) assert.throws(() => updateAiDroneFleet(bad, 1, { score }), TypeError);
  const fleet = makeFleet(8); fleet.identities[0] = 9999; assert.throws(() => updateAiDroneFleet(fleet, 0, { score }), TypeError);
  const invalidBase = makeFleet(8); invalidBase.bases[1] = -1; assert.throws(() => updateAiDroneFleet(invalidBase, 0, { score }), TypeError);
  assert.throws(() => updateAiDroneFleet(makeFleet(8), 0, { score: { ...score, script: 'eval()' } }), { code: 'AI_SCORE_FIELDS' });
});
