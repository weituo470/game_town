import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAiDroneScore, AiDroneScoreError } from '../shared/aiDroneScore.js';
import { validateAiDroneScoreV2, AI_DRONE_V2_IDS, AI_DRONE_V2_KINDS, AI_DRONE_V2_LAYOUTS, AI_DRONE_V2_CAMERAS, AI_DRONE_V2_EFFECTS, AI_DRONE_V2_MOTIONS, AI_DRONE_V2_TRANSITIONS, AI_DRONE_V2_LIMITS } from '../shared/aiDroneScoreV2.js';
import { buildAiDroneV2Example } from '../server/aiDroneDirector.js';

const sample = () => buildAiDroneV2Example(123);
const copy = value => structuredClone(value);
const rejects = (value, code) => assert.throws(() => validateAiDroneScore(value), error => error instanceof AiDroneScoreError && error.code === code && error.status === 422);
function frozen(value) { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }

test('V2 dispatch accepts a real four-scene story, owns all objects and deeply freezes the result', () => {
  const raw = sample(); raw.title = ` ${raw.title} `; raw.cast[0].color = '#ffaa00';
  const value = validateAiDroneScore(raw); frozen(value);
  assert.equal(value.version, 2); assert.equal(value.title, '灯火引蝶'); assert.equal(value.cast[0].color, '#FFAA00');
  assert.equal(validateAiDroneScore(value), value); assert.equal(validateAiDroneScoreV2(value), value);
  assert.deepEqual(validateAiDroneScore(JSON.stringify(raw)), value);
  raw.scenes[0].actors[0].scale = 1.1; assert.equal(value.scenes[0].actors[0].scale, 1); assert.equal(raw.cast[0].color, '#ffaa00');
});

test('every V2 enum is frozen and each allowed actor kind/motion/camera/effect can be used without widening other fields', () => {
  for (const values of [AI_DRONE_V2_IDS, AI_DRONE_V2_KINDS, AI_DRONE_V2_LAYOUTS, AI_DRONE_V2_CAMERAS, AI_DRONE_V2_EFFECTS, AI_DRONE_V2_MOTIONS, AI_DRONE_V2_TRANSITIONS, AI_DRONE_V2_LIMITS]) assert.ok(Object.isFrozen(values));
  for (const kind of AI_DRONE_V2_KINDS) { const value = sample(); value.cast[0].kind = kind; assert.equal(validateAiDroneScore(value).cast[0].kind, kind); }
  for (const [field, values] of [['camera', AI_DRONE_V2_CAMERAS], ['effect', AI_DRONE_V2_EFFECTS], ['transition', AI_DRONE_V2_TRANSITIONS]]) for (const option of values) {
    const value = sample(); value.scenes[2][field] = option; assert.equal(validateAiDroneScore(value).scenes[2][field], option);
  }
  for (const motion of AI_DRONE_V2_MOTIONS) { const value = sample(); value.scenes[0].actors[0].motion = motion; assert.equal(validateAiDroneScore(value).scenes[0].actors[0].motion, motion); }
});

test('V2 rejects extra keys, symbols, forbidden resources and nested accessors without evaluating them', () => {
  for (const extra of [{ script: 'eval()' }, { paths: [] }, { url: 'https://untrusted.test' }, { coordinates: [0, 0, 0] }, { __unknown: true }, { [Symbol('x')]: 1 }]) {
    const root = sample(); Object.assign(root, extra); rejects(root, 'AI_SCORE_FIELDS');
    const cast = sample(); Object.assign(cast.cast[0], extra); rejects(cast, 'AI_SCORE_FIELDS');
    const scene = sample(); Object.assign(scene.scenes[0], extra); rejects(scene, 'AI_SCORE_FIELDS');
    const actor = sample(); Object.assign(actor.scenes[0].actors[0], extra); rejects(actor, 'AI_SCORE_FIELDS');
  }
  for (const locate of [value => [value, 'version'], value => [value.cast[0], 'id'], value => [value.scenes[0], 'duration'], value => [value.scenes[0].actors[0], 'scale']]) {
    const value = sample(), [target, key] = locate(value); Object.defineProperty(target, key, { get() { assert.fail('getter executed'); }, enumerable: true }); rejects(value, 'AI_SCORE_FORMAT');
  }
  const polluted = JSON.parse(JSON.stringify(sample()).replace('"version":2', '"version":2,"__proto__":{"polluted":true}')); rejects(polluted, 'AI_SCORE_FIELDS');
  const inherited = sample(); Object.setPrototypeOf(inherited.scenes[0], { secret: true }); rejects(inherited, 'AI_SCORE_FORMAT');
});

test('V2 arrays reject holes, accessor items, subclasses and extra named properties', () => {
  for (const locate of [v => [v, 'cast'], v => [v, 'scenes'], v => [v.scenes[1], 'actors']]) {
    for (const mutation of [array => { delete array[0]; }, array => { array.extra = 'no'; }, array => { Object.defineProperty(array, '0', { get() { assert.fail('array getter'); } }); }, array => { Object.setPrototypeOf(array, Object.create(Array.prototype)); }]) {
      const value = sample(), [target, key] = locate(value); mutation(target[key]); assert.throws(() => validateAiDroneScore(value), AiDroneScoreError);
    }
  }
});

test('V2 validates unique known cast IDs, required hero and every scene reference', () => {
  for (const count of [0, 1, 5]) { const value = sample(); value.cast = Array.from({ length: count }, () => value.cast[0]); rejects(value, 'AI_SCORE_CAST'); }
  const duplicate = sample(); duplicate.cast[1].id = 'hero'; rejects(duplicate, 'AI_SCORE_CAST');
  const noHero = sample(); noHero.cast[0].id = 'spark'; rejects(noHero, 'AI_SCORE_CAST');
  const unknown = sample(); unknown.cast[0].id = '__proto__'; rejects(unknown, 'AI_SCORE_CHOICE');
  const undefinedActor = sample(); undefinedActor.scenes[0].actors[0].id = 'spark'; rejects(undefinedActor, 'AI_SCORE_ACTORS');
  const duplicated = sample(); duplicated.scenes[1].actors[1].id = 'hero'; rejects(duplicated, 'AI_SCORE_ACTORS');
});

test('V2 composition counts, scales, duration and total duration are strict and finite', () => {
  for (const layout of ['duet', 'trio', 'procession', 'orbit']) { const value = sample(); value.scenes[0].layout = layout; rejects(value, 'AI_SCORE_LAYOUT'); }
  const tooMany = sample(); tooMany.scenes[1].layout = 'hero'; rejects(tooMany, 'AI_SCORE_LAYOUT');
  for (const scale of [.549, 1.151, 0, -1, '1', null, NaN, Infinity]) { const value = sample(); value.scenes[0].actors[0].scale = scale; rejects(value, 'AI_SCORE_SCALE'); }
  for (const scale of [.55, 1.15]) { const value = sample(); value.scenes[0].actors[0].scale = scale; assert.equal(validateAiDroneScore(value).scenes[0].actors[0].scale, scale); }
  for (const duration of [9, 19, 10.5, '12', NaN, Infinity]) { const value = sample(); value.scenes[0].duration = duration; rejects(value, 'AI_SCORE_DURATION'); }
  const large = sample(); large.scenes.push(copy(large.scenes[1]), copy(large.scenes[1])); large.scenes.forEach(s => { s.duration = 18; }); rejects(large, 'AI_SCORE_DURATION');
  large.scenes.forEach((s, i) => { s.duration = i < 2 ? 18 : 14; }); assert.equal(large.scenes.reduce((a, s) => a + s.duration, 0), 92); assert.equal(validateAiDroneScore(large).scenes.length, 6);
  for (const count of [3, 7]) { const value = sample(); value.scenes = Array.from({ length: count }, (_, i) => copy(value.scenes[i % 4])); rejects(value, 'AI_SCORE_SCENES'); }
});

test('V2 independently enforces each quality condition, but does not demand changing actor kinds', () => {
  const mutations = [
    v => { v.scenes.forEach(s => { s.layout = 'trio'; s.actors = copy(v.scenes[2].actors); }); },
    v => { v.scenes.forEach(s => { s.camera = 'wide'; }); },
    v => { v.scenes.forEach(s => s.actors.forEach(a => { a.motion = 'float'; })); },
    v => { v.scenes[1].layout = 'hero'; v.scenes[1].actors = [v.scenes[1].actors[0]]; v.scenes[2].layout = 'hero'; v.scenes[2].actors = [v.scenes[2].actors[0]]; },
    v => { v.scenes.forEach(s => { s.effect = 'none'; }); },
    v => { v.scenes.forEach(s => { s.effect = 'peony'; }); },
    v => { v.scenes[1].actors = [{ id: 'world', motion: 'float', scale: .8 }, { id: 'companion', motion: 'flap', scale: .8 }]; v.scenes[3].actors = copy(v.scenes[1].actors); },
    v => { v.cast.push({ id: 'spark', kind: 'comet', color: '#FFAA00', accent: '#FFFFFF' }); },
    v => { v.cast[0].color = '#000000'; v.cast[0].accent = '#6F6F6F'; },
  ];
  for (const mutate of mutations) { const value = sample(); mutate(value); rejects(value, 'AI_SCORE_QUALITY'); }
  const family = sample(); family.cast.forEach(actor => { actor.kind = 'whale'; }); assert.equal(validateAiDroneScore(family).cast.length, 3);
  const dimBoundary = sample(); dimBoundary.cast[0].color = '#700000'; dimBoundary.cast[0].accent = '#000000'; assert.equal(validateAiDroneScore(dimBoundary).version, 2);
});

test('V2 strings, colors, seed, byte cap and enums are strict; errors never echo arbitrary values', () => {
  for (const seed of [0, -1, 1.5, '1', Infinity, 2147483648]) { const value = sample(); value.seed = seed; rejects(value, 'AI_SCORE_SEED'); }
  for (const title of ['', ' ', 'x\nsecret', '鲸'.repeat(49)]) { const value = sample(); value.title = title; rejects(value, 'AI_SCORE_TEXT'); }
  for (const color of ['red', '#fff', '#FFFFFF00', null]) { const value = sample(); value.cast[0].color = color; rejects(value, 'AI_SCORE_COLOR'); }
  for (const key of ['layout', 'camera', 'effect', 'transition']) { const value = sample(); value.scenes[0][key] = 'PRIVATE_UNSUPPORTED'; assert.throws(() => validateAiDroneScore(value), e => e.code === 'AI_SCORE_CHOICE' && e.field === key && e.sceneIndex === 0 && !JSON.stringify(e).includes('PRIVATE')); }
  const value = sample(); value.scenes[0].actors[0].motion = 'rotate'; rejects(value, 'AI_SCORE_CHOICE');
  rejects(' '.repeat(32769), 'AI_SCORE_TOO_LARGE'); rejects('```json\n{}\n```', 'AI_SCORE_JSON');
  const padded = sample(); padded.title = ' '.repeat(32768) + '鲸'; rejects(padded, 'AI_SCORE_TOO_LARGE');
  assert.throws(() => validateAiDroneScoreV2({ ...sample(), version: 1 }), { code: 'AI_SCORE_VERSION' });
});

test('legacy V1 remains strict, accepted and visually-owned by its existing version', () => {
  const scene = { name: '旧节目', description: '保留旧版节目数据。', shape: 'whale', color: '#123456', accent: '#ABCDEF', duration: 10, motion: 'wave', transition: 'morph' };
  const old = validateAiDroneScore({ version: 1, title: '旧版', synopsis: '不迁移或替换旧节目。', seed: 1, scenes: [scene, scene, scene, scene] });
  assert.equal(old.version, 1); assert.equal(old.scenes[0].shape, 'whale'); assert.equal(validateAiDroneScore(old), old);
});
