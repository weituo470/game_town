import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_DRONE_ACTOR_KINDS, createAiDroneActorGeometry } from '../shared/aiDroneActors.js';
import { createAiDroneStageRuntime } from '../shared/aiDroneStage.js';
import { createAiDroneRuntime, createAiDroneProgram, sampleAiDroneShow, updateAiDroneFleet } from '../shared/aiDroneShow.js';
import { validateAiDroneScore } from '../shared/aiDroneScore.js';

const fixture = (kind = 'whale', extra = {}) => ({ version: 2, title: '相遇与归航', synopsis: '具体角色相遇，共同飞过有纵深的天空。', seed: 712345,
  cast: [{ id: 'hero', kind, color: '#3EA4E8', accent: '#FFEAC1' }, { id: 'companion', kind: 'butterfly', color: '#FF983F', accent: '#FFF3CE' }],
  scenes: [
    { name: '独自远行', description: '主角完整出场。', duration: 14, layout: 'hero', camera: 'wide', effect: 'none', transition: 'morph', actors: [{ id: 'hero', motion: 'float', scale: .95 }] },
    { name: '相逢', description: '角色在不同纵深相逢。', duration: 16, layout: 'duet', camera: 'push', effect: 'none', transition: 'sweep', actors: [{ id: 'hero', motion: 'swim', scale: 1 }, { id: 'companion', motion: 'flap', scale: .7 }] },
    { name: '一起飞翔', description: '角色一起向上，烟花点亮远方。', duration: 18, layout: 'duet', camera: 'rise', effect: 'crown', transition: 'burst', actors: [{ id: 'hero', motion: 'ascend', scale: .95 }, { id: 'companion', motion: 'dive', scale: .75 }] },
    { name: '陪伴归航', description: '陪伴着回游，留下宁静星空。', duration: 16, layout: 'orbit', camera: 'orbit', effect: 'willow', transition: 'morph', actors: [{ id: 'hero', motion: 'orbit', scale: .9 }, { id: 'companion', motion: 'flap', scale: .7 }] },
  ], ...extra });
function fleet(count = 4096) {
  const result = { count, positions: new Float32Array(count * 3), colors: new Float32Array(count * 3), sizes: new Float32Array(count), bases: new Float32Array(count * 3), identities: new Uint16Array(count) };
  for (let i = 0; i < count; i++) { const id = Math.floor(i * 4096 / count), k = i * 3; result.identities[i] = id; result.bases[k] = (id % 64 - 31.5) * .25; result.bases[k + 1] = .65; result.bases[k + 2] = (Math.floor(id / 64) - 31.5) * .25; }
  return result;
}
const maxDelta = (a, b) => a.reduce((max, value, index) => Math.max(max, Math.abs(value - b[index])), 0);
const norm = a => { const n = Math.hypot(...a); return a.map(value => value / n); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
function project(point, camera, aspect) {
  const forward = norm(camera.target.map((value, i) => value - camera.position[i])), right = norm(cross(forward, [0, 1, 0])), up = cross(right, forward);
  const v = point.map((value, i) => value - camera.position[i]), depth = dot(v, forward), half = depth * Math.tan(camera.fov * Math.PI / 360);
  return [dot(v, right) / half / aspect, dot(v, up) / half, depth];
}

test('eleven original actor types have finite volumetric skins at their actual allocated density', () => {
  assert.equal(AI_DRONE_ACTOR_KINDS.length, 11); const signatures = new Set();
  for (const kind of AI_DRONE_ACTOR_KINDS) for (const count of [384, 768, 1536, 4096]) {
    const shape = createAiDroneActorGeometry(kind, count);
    assert.equal(shape.count, count); assert.equal(shape.points.length, count * 3); assert.equal(shape.accents.length, count);
    assert.ok(shape.points.every(Number.isFinite)); assert.ok(shape.accents.every(value => value >= 0 && value <= 1));
    const spans = shape.bounds.max.map((value, axis) => value - shape.bounds.min[axis]);
    assert.ok(Math.max(...spans) > 111.9 && Math.max(...spans) < 112.1); assert.ok(spans[2] > 12, `${kind} must not be a 2D outline`);
    assert.ok(spans[0] > 35 && spans[1] > 25); assert.equal(createAiDroneActorGeometry(kind, count), shape);
    if (count === 1536) signatures.add(Array.from(shape.points.slice(0, 24)).map(value => value.toFixed(3)).join(','));
  }
  assert.equal(signatures.size, 11); assert.throws(() => createAiDroneActorGeometry('__proto__', 1024)); assert.throws(() => createAiDroneActorGeometry('whale', 0));
});

test('low-count whales use their own local golden angle, not aliased strided ribs', () => {
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (const count of [384, 640, 768, 1536]) {
    const shape = createAiDroneActorGeometry('whale', count);
    for (let rank = 0; rank < 100; rank++) {
      const y = shape.points[rank * 3 + 1], z = shape.points[rank * 3 + 2], a = Math.atan2((-y * .389 + z * .921) / .83, y * .921 + z * .389);
      assert.ok(Math.abs(Math.atan2(Math.sin(a - rank * golden), Math.cos(a - rank * golden))) < .0001);
    }
  }
});

test('version dispatch exposes a full bounded HUD programme without changing v1 semantics', () => {
  const score = validateAiDroneScore(fixture()), runtime = createAiDroneRuntime(score), program = runtime.program;
  assert.equal(runtime, createAiDroneStageRuntime(score)); assert.equal(createAiDroneProgram(score), program); assert.equal(program.id, 'ai'); assert.equal(program.scoreVersion, 2);
  assert.equal(program.sampleVisual, 'spectacle-v2'); assert.equal(program.supportsAudio, false); assert.equal(program.duration, 90000); assert.equal(program.returnStart, 76000);
  assert.ok(program.duration <= 118000); assert.ok(Object.isFrozen(program)); assert.ok(Object.isFrozen(runtime));
  for (let i = 1; i < program.chapters.length; i++) assert.equal(program.chapters[i].start, program.chapters[i - 1].end);
  assert.equal(sampleAiDroneShow(18000, score).phase, 'ai-scene-0'); assert.equal(runtime.sample(program.duration).active, false);
  assert.equal(runtime.sample(Infinity).elapsed, 0); assert.equal(runtime.sample(NaN).elapsed, 0);
  const old = { version: 1, title: '旧节目', synopsis: '仍然保留原版轮廓。', seed: 73, scenes: Array.from({ length: 4 }, () => ({ name: '旧幕', description: '原样回放', shape: 'whale', color: '#45BFFF', accent: '#FFDE98', duration: 10, motion: 'wave', transition: 'morph' })) };
  const legacy = createAiDroneRuntime(old); assert.equal(legacy.score.version, 1); assert.equal(legacy.program.scoreVersion, undefined); assert.equal(legacy.program.sampleVisual, undefined); assert.equal(legacy.program.duration, 66000);
});

test('core scenes use all independent lights, with typed buffers, safe sky bounds and exact low-quality identity subsets', () => {
  for (const kind of AI_DRONE_ACTOR_KINDS) {
    const runtime = createAiDroneRuntime(fixture(kind)), full = fleet(), low = fleet(2048), references = [full.positions, full.colors, full.sizes];
    for (const chapter of runtime.program.chapters.filter(item => item.sceneIndex !== undefined)) {
      const at = chapter.start + (chapter.end - chapter.start) * .65;
      runtime.update(full, at); runtime.update(low, at);
      assert.ok(full.positions.every(Number.isFinite)); assert.ok(full.colors.every(Number.isFinite));
      assert.ok(full.sizes.filter(value => value > .2).length >= 4096 * .95, `${kind} actual lit fleet`);
      for (let index = 0; index < full.count; index++) assert.ok(full.positions[index * 3 + 1] >= 16);
      for (let i = 0; i < low.count; i++) { const id = low.identities[i]; assert.equal(low.sizes[i], full.sizes[id]); for (let axis = 0; axis < 3; axis++) { assert.equal(low.positions[i * 3 + axis], full.positions[id * 3 + axis]); assert.equal(low.colors[i * 3 + axis], full.colors[id * 3 + axis]); } }
    }
    assert.equal(full.positions, references[0]); assert.equal(full.colors, references[1]); assert.equal(full.sizes, references[2]);
    updateAiDroneFleet(full, runtime.program.duration, { score: runtime.score }); assert.deepEqual(full.positions, full.bases); assert.ok(full.sizes.every(value => value === 0)); assert.ok(full.colors.every(value => value === 0));
  }
});

test('chapter boundaries, arbitrary reverse seeks and all action/transition combinations remain deterministic and continuous', () => {
  const runtime = createAiDroneRuntime(fixture('phoenix')), value = fleet();
  for (const chapter of runtime.program.chapters) {
    runtime.update(value, Math.max(0, chapter.start - .01)); const positions = value.positions.slice(), colors = value.colors.slice();
    runtime.update(value, chapter.start); assert.ok(maxDelta(positions, value.positions) < .01, `${chapter.id} position jump`); assert.ok(maxDelta(colors, value.colors) < .001, `${chapter.id} color jump`);
    const at = chapter.start + (chapter.end - chapter.start) * .73; runtime.update(value, at); const exact = value.positions.slice(); runtime.update(value, 0); runtime.update(value, runtime.program.duration); runtime.update(value, at); assert.deepEqual(value.positions, exact);
  }
});

test('reduced-motion shows one finished formation and a fixed camera, while complete recovery still works', () => {
  const runtime = createAiDroneRuntime(fixture('dragon')), value = fleet(2048);
  runtime.update(value, 12000, { reducedMotion: true }); const positions = value.positions.slice(), colors = value.colors.slice(), camera = runtime.camera(12000, 16 / 9, true);
  for (let at = 14000; at < runtime.program.returnStart; at += 2000) { runtime.update(value, at, { reducedMotion: true }); assert.deepEqual(value.positions, positions); assert.deepEqual(value.colors, colors); assert.deepEqual(runtime.camera(at, 16 / 9, true), camera); }
  runtime.update(value, runtime.program.duration, { reducedMotion: true }); assert.deepEqual(value.positions, value.bases); assert.ok(value.sizes.every(value => value === 0));
});

test('trusted firework programmes remain bounded, sequenced behind actors and end before recovery', () => {
  const runtime = createAiDroneRuntime(fixture('planet')), effects = runtime.fireworkProgram;
  assert.equal(effects.end, runtime.program.returnStart / 1000); assert.ok(Object.isFrozen(effects)); assert.ok(Object.isFrozen(effects.cues));
  assert.ok(effects.cues.length >= 2 && effects.cues.length <= 6); assert.ok(effects.cues.reduce((sum, cue) => sum + cue.count * 3, 0) <= 8000);
  for (const cue of effects.cues) { assert.ok(cue.at > cue.launch && cue.at + cue.life < effects.end); assert.ok(cue.origin[2] < -80); assert.ok(cue.origin[1] > 80); assert.ok(cue.color.every(value => value >= 0 && value <= 1)); assert.ok(['peony', 'willow', 'crown'].includes(cue.style)); }
});

test('every actor kind clears the actual 720px playback HUD and fits desktop/390px cameras at its formed hero moments', () => {
  for (const kind of AI_DRONE_ACTOR_KINDS) {
    const runtime = createAiDroneRuntime(fixture(kind)), value = fleet(2048);
    for (const chapter of runtime.program.chapters.filter(item => item.sceneIndex !== undefined)) {
      const at = chapter.start + (chapter.end - chapter.start) * .65; runtime.update(value, at);
      for (const aspect of [16 / 9, 2560 / 1215, 390 / 844]) {
        const camera = runtime.camera(at, aspect); let inside = 0, lowest = -Infinity;
        for (let i = 0; i < value.count; i++) { const [x, y, depth] = project(Array.from(value.positions.subarray(i * 3, i * 3 + 3)), camera, aspect); if (Math.abs(x) < .98 && Math.abs(y) < .98 && depth > 40) inside++; lowest = Math.max(lowest, (1 - y) * 360); }
        assert.ok(inside / value.count > .995, `${kind}/${chapter.id}/${aspect} cropped`);
        if (aspect > 1) assert.ok(lowest < 455, `${kind}/${chapter.id} hidden by real HUD: ${lowest}`);
      }
    }
  }
});

test('low-tier even physical identities retain both source parities, all fourteen feathers and all six box faces', () => {
  for (const kind of ['phoenix', 'city']) for (const seed of [1, 123, 712345, 2147483647]) {
    const runtime = createAiDroneRuntime(fixture(kind, { seed })), shape = createAiDroneActorGeometry(kind, 4096), value = fleet(2048), ranksByPoint = new Map();
    const yaw = kind === 'city' ? -.18 : 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
    // At exactly launch completion the first actor is static: decode its actual
    // rendered points back to source indices, independent of runtime internals.
    for (let rank = 0; rank < 4096; rank++) {
      const x = shape.points[rank * 3] * .95, y = shape.points[rank * 3 + 1] * .95, z = shape.points[rank * 3 + 2] * .95;
      const key = [x * cy - z * sy, y + 129, x * sy + z * cy - 12].map(Math.fround).join(',');
      ranksByPoint.set(key, rank);
    }
    runtime.update(value, 12000);
    const ranks = Array.from({ length: value.count }, (_, index) => ranksByPoint.get(Array.from(value.positions.subarray(index * 3, index * 3 + 3)).join(',')));
    assert.ok(ranks.every(Number.isInteger), `${kind} must map to original individual points`);
    for (const parity of [0, 1]) assert.ok(ranks.filter(rank => rank % 2 === parity).length > 900, `${kind}/${seed} loses a parity`);
    for (const residue of [0, 1, 2, 3, 4, 5]) assert.ok(ranks.filter(rank => rank % 6 === residue).length > 260, `${kind}/${seed} loses a face residue`);
    if (kind === 'phoenix') {
      let begin = 0;
      while (shape.parts[begin] !== 3) begin++;
      let finish = begin; while (shape.parts[finish] === 3) finish++;
      const half = (finish - begin) / 2;
      for (let side = 0; side < 2; side++) for (let feather = 0; feather < 14; feather++) {
        const start = begin + half * side;
        assert.ok(ranks.filter(rank => rank >= start && rank < start + half && (rank - start) % 14 === feather).length > 20, `${seed}/${side}/${feather} missing flight feather`);
      }
    }
  }
});

function ensembleFixture(count = 3) {
  const score = fixture('lantern');
  score.cast[0].color = score.cast[0].accent = '#FF2020'; score.cast[1].color = score.cast[1].accent = '#20FF20';
  score.cast.push({ id: 'world', kind: 'lotus', color: '#2020FF', accent: '#2020FF' });
  if (count === 4) score.cast.push({ id: 'spark', kind: 'phoenix', color: '#FFFF20', accent: '#FFFF20' });
  score.scenes[2].layout = 'procession'; score.scenes[3].layout = 'orbit';
  score.scenes[2].actors = score.cast.map(actor => ({ id: actor.id, motion: 'float', scale: 1.15 }));
  score.scenes[3].actors = score.cast.map(actor => ({ id: actor.id, motion: 'orbit', scale: 1.15 }));
  return score;
}
function actorCentroids(value) {
  const sums = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  for (let i = 0; i < value.count; i++) {
    const rgb = Array.from(value.colors.subarray(i * 3, i * 3 + 3)), max = Math.max(...rgb);
    const actor = rgb[0] > max * .8 && rgb[1] > max * .8 ? 3 : rgb.indexOf(max);
    for (let axis = 0; axis < 3; axis++) sums[actor][axis] += value.positions[i * 3 + axis];
    sums[actor][3]++;
  }
  return sums.filter(sum => sum[3]).map(sum => sum.slice(0, 3).map(value => value / sum[3]));
}

test('orbit is a real tilted ensemble dance around the landmark, and procession travels together in one direction', () => {
  for (const count of [3, 4]) {
    const runtime = createAiDroneRuntime(ensembleFixture(count)), value = fleet(), scenes = runtime.program.chapters.filter(chapter => chapter.sceneIndex !== undefined);
    const centers = (chapter, phase) => { runtime.update(value, chapter.start + (chapter.end - chapter.start) * phase); return actorCentroids(value); };
    const moving = scenes[2], before = centers(moving, .23), after = centers(moving, .999999);
    for (let actor = 0; actor < count; actor++) { assert.ok(after[actor][0] - before[actor][0] > 50); assert.ok(after[actor][1] - before[actor][1] > 10); assert.ok(after[actor][2] - before[actor][2] < -34); }
    const orbit = scenes[3], home = centers(orbit, .999999), turn = centers(orbit, .5), outgoing = centers(orbit, .3), incoming = centers(orbit, .7);
    assert.ok(Math.hypot(...home[2].map((value, axis) => value - turn[2][axis])) < 2, 'lotus world remains the central landmark');
    for (let actor = 0; actor < count; actor++) if (actor !== 2) {
      assert.ok(Math.hypot(...home[actor].map((value, axis) => value - turn[actor][axis])) > 85, `actor ${actor} must travel, not jitter`);
      assert.ok(Math.hypot(...outgoing[actor].map((value, axis) => value - incoming[actor][axis])) < 9, 'orbital go/return path remains continuous');
    }
    for (let phase = .23; phase < 1; phase += .035) {
      const points = centers(orbit, phase);
      for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) assert.ok(Math.hypot(...points[a].map((value, axis) => value - points[b][axis])) > 50, 'different actors keep safe spatial separation');
    }
  }
});

test('three/four actor orbital and procession paths stay above the HUD and inside desktop/portrait cameras throughout their journey', () => {
  for (const count of [3, 4]) {
    const runtime = createAiDroneRuntime(ensembleFixture(count)), value = fleet(2048);
    for (const chapter of runtime.program.chapters.filter(chapter => chapter.sceneIndex >= 2)) for (const progress of [.23, .3, .4, .5, .6, .7, .8, .9, .999999]) {
      const at = chapter.start + (chapter.end - chapter.start) * progress; runtime.update(value, at);
      for (const aspect of [16 / 9, 390 / 844]) {
        const camera = runtime.camera(at, aspect); let inside = 0, lowest = 0;
        for (let i = 0; i < value.count; i++) { const [x, y, depth] = project(Array.from(value.positions.subarray(i * 3, i * 3 + 3)), camera, aspect); if (Math.abs(x) < .98 && Math.abs(y) < .98 && depth > 40) inside++; lowest = Math.max(lowest, (1 - y) * 360); }
        assert.ok(inside / value.count > .995, `${count}/${chapter.id}/${progress}/${aspect} cropped`);
        if (aspect > 1) assert.ok(lowest < 455, `${count}/${chapter.id}/${progress} hidden by HUD: ${lowest}`);
      }
    }
  }
});
