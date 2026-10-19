import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAiDroneScore, AiDroneScoreError, AI_DRONE_SHAPES, AI_DRONE_MOTIONS, AI_DRONE_TRANSITIONS, AI_DRONE_CHOICE_FIELDS, AI_DRONE_LIMITS } from '../shared/aiDroneScore.js';

const scene = (extra = {}) => ({ name: '鲸向星河', description: '蓝鲸游过星环，花朵在天空绽放。', shape: 'whale', color: '#32abef', accent: '#ffe1a0', duration: 10, motion: 'wave', transition: 'morph', ...extra });
const score = (extra = {}) => ({ version: 1, title: ' 星海来信 ', synopsis: '一场从海洋驶向银河的天空故事。', seed: 428, scenes: Array.from({ length: 4 }, () => scene()), ...extra });
const rejected = (value, code) => assert.throws(() => validateAiDroneScore(value), error => error instanceof AiDroneScoreError && error.code === code && error.status === 422 && /[\u4e00-\u9fff]/u.test(error.message));

test('score validation owns and deeply freezes normalized JSON without changing callers', () => {
  const input = score(), value = validateAiDroneScore(input);
  assert.equal(value.title, '星海来信'); assert.equal(value.scenes[0].color, '#32ABEF');
  assert.equal(input.title, ' 星海来信 '); assert.equal(input.scenes[0].color, '#32abef');
  for (const part of [value, value.scenes, ...value.scenes]) assert.ok(Object.isFrozen(part));
  input.scenes[0].name = 'changed'; assert.equal(value.scenes[0].name, '鲸向星河');
  assert.equal(validateAiDroneScore(value), value);
  assert.deepEqual(validateAiDroneScore(JSON.stringify(value)), value);
});

test('all enum choices are accepted and exports cannot be mutated', () => {
  for (const shape of AI_DRONE_SHAPES) {
    const extra = shape === 'outline' ? { paths: [[[-1, 0], [0, 1], [1, 0]]] } : {};
    assert.equal(validateAiDroneScore(score({ scenes: Array.from({ length: 4 }, () => scene({ shape, ...extra })) })).scenes[0].shape, shape);
  }
  for (const motion of AI_DRONE_MOTIONS) assert.equal(validateAiDroneScore(score({ scenes: Array.from({ length: 4 }, () => scene({ motion })) })).scenes[0].motion, motion);
  for (const transition of AI_DRONE_TRANSITIONS) assert.equal(validateAiDroneScore(score({ scenes: Array.from({ length: 4 }, () => scene({ transition })) })).scenes[0].transition, transition);
  for (const values of [AI_DRONE_SHAPES, AI_DRONE_MOTIONS, AI_DRONE_TRANSITIONS, AI_DRONE_LIMITS]) assert.ok(Object.isFrozen(values));
});

for (const bad of [null, undefined, [], 1, false, () => {}, new Date()]) test(`reject non-JSON score type ${String(bad)}`, () => rejected(bad, 'AI_SCORE_FORMAT'));
test('reject malformed, fenced and over-budget JSON', () => {
  for (const bad of ['{', '```json\n{}\n```', '()=>{}']) rejected(bad, 'AI_SCORE_JSON');
  rejected(' '.repeat(AI_DRONE_LIMITS.bytes + 1), 'AI_SCORE_TOO_LARGE');
  rejected(JSON.stringify(score({ title: '鲸'.repeat(12000) })), 'AI_SCORE_TOO_LARGE');
});

test('unknown, missing, dangerous, accessor and prototype fields are rejected without executing getters', () => {
  rejected(score({ javascript: 'throw new Error()' }), 'AI_SCORE_FIELDS');
  rejected(JSON.parse(JSON.stringify(score()).replace('"version":1', '"version":1,"__proto__":{"polluted":true}')), 'AI_SCORE_FIELDS');
  const missing = score(); delete missing.seed; rejected(missing, 'AI_SCORE_FIELDS');
  rejected(score({ [Symbol('secret')]: 1 }), 'AI_SCORE_FIELDS');
  rejected(Object.assign(Object.create({ secret: true }), score()), 'AI_SCORE_FORMAT');
  const getter = score(); Object.defineProperty(getter, 'title', { get() { throw new Error('do not execute'); }, enumerable: true });
  rejected(getter, 'AI_SCORE_FORMAT');
  for (const extra of [{ url: 'https://evil.test' }, { count: 999999 }, { camera: 'javascript:1' }, { script: 'eval(1)' }]) rejected(score({ scenes: Array.from({ length: 4 }, () => scene(extra)) }), 'AI_SCORE_FIELDS');
});

test('root version, integer seed and scene count boundaries are strict', () => {
  for (const version of [0, 2, '1', NaN]) rejected(score({ version }), 'AI_SCORE_VERSION');
  for (const seed of [0, -1, 1.5, 2147483648, Infinity, NaN, '42']) rejected(score({ seed }), 'AI_SCORE_SEED');
  for (const seed of [1, 2147483647]) assert.equal(validateAiDroneScore(score({ seed })).seed, seed);
  for (const count of [0, 3, 8]) rejected(score({ scenes: Array.from({ length: count }, () => scene()) }), 'AI_SCORE_SCENES');
  rejected(score({ scenes: new Array(4) }), 'AI_SCORE_SCENES');
  assert.equal(validateAiDroneScore(score({ scenes: Array.from({ length: 7 }, () => scene()) })).scenes.length, 7);
});

test('all bounded human text fields count Unicode characters and reject controls', () => {
  for (const [key, max] of [['title', 48], ['synopsis', 240]]) {
    assert.equal(Array.from(validateAiDroneScore(score({ [key]: '鲸'.repeat(max) }))[key]).length, max);
    for (const value of ['', '   ', 'a\nsecret', 'a\u0000b', '鲸'.repeat(max + 1), 10]) rejected(score({ [key]: value }), 'AI_SCORE_TEXT');
  }
  for (const [key, max] of [['name', 32], ['description', 160]]) {
    for (const value of ['', '   ', '\tbad', '鲸'.repeat(max + 1)]) rejected(score({ scenes: Array.from({ length: 4 }, () => scene({ [key]: value })) }), 'AI_SCORE_TEXT');
    assert.ok(validateAiDroneScore(score({ scenes: Array.from({ length: 4 }, () => scene({ [key]: '🐋'.repeat(max) })) })));
  }
});

test('scene enums, hex color and integer second bounds are strict', () => {
  for (const duration of [7, 19, 8.5, '10', Infinity, NaN]) rejected(score({ scenes: Array.from({ length: 4 }, () => scene({ duration })) }), 'AI_SCORE_DURATION');
  for (const duration of [8, 18]) assert.equal(validateAiDroneScore(score({ scenes: Array.from({ length: 4 }, () => scene({ duration })) })).scenes[0].duration, duration);
  for (const key of ['color', 'accent']) for (const color of ['red', '#fff', '#FFFFFF80', 'url(test)', '#gg00ff', 0]) rejected(score({ scenes: Array.from({ length: 4 }, () => scene({ [key]: color })) }), 'AI_SCORE_COLOR');
  for (const key of ['shape', 'motion', 'transition']) rejected(score({ scenes: Array.from({ length: 4 }, () => scene({ [key]: 'arbitrary-script' })) }), 'AI_SCORE_CHOICE');
});

test('choice errors identify only a fixed field and bounded scene index without echoing model values', () => {
  assert.ok(Object.isFrozen(AI_DRONE_CHOICE_FIELDS));
  for (const field of AI_DRONE_CHOICE_FIELDS) for (let sceneIndex = 0; sceneIndex < 7; sceneIndex++) {
    const value = score({ scenes: Array.from({ length: 7 }, () => scene()) });
    value.scenes[sceneIndex][field] = 'PRIVATE MODEL VALUE';
    assert.throws(() => validateAiDroneScore(value), error => error.code === 'AI_SCORE_CHOICE' && error.field === field && error.sceneIndex === sceneIndex && !JSON.stringify(error).includes('PRIVATE') && !error.message.includes('PRIVATE'));
  }
  // Canonicalization belongs exclusively to the server provider boundary, not
  // to local imports, saved scores, runtime or untrusted renderer data.
  for (const [field, aliases] of [['shape', ['circle', ' RING ', 'Ring']], ['motion', ['rotate', 'rotation', 'static', 'breathing', 'pulse', ' TURN ']], ['transition', ['fade', ' MORPH ']]]) {
    for (const value of aliases) rejected(score({ scenes: Array.from({ length: 4 }, () => scene({ [field]: value })) }), 'AI_SCORE_CHOICE');
  }
});

test('outline uses frozen 2D normalized lines, never raw world points or degeneracy', () => {
  const input = score({ scenes: Array.from({ length: 4 }, () => scene({ shape: 'outline', paths: [[[-1, 0], [0, 1], [1, 0]]] })) });
  const value = validateAiDroneScore(input);
  for (const part of [value.scenes[0].paths, value.scenes[0].paths[0], ...value.scenes[0].paths[0]]) assert.ok(Object.isFrozen(part));
  input.scenes[0].paths[0][0][0] = .5; assert.equal(value.scenes[0].paths[0][0][0], -1);
  const badPaths = [undefined, [], new Array(2), [[[0, 0]]], [[[0, 0], [0, 0]]], [[[0, 0], [.001, .001]]], [[[0, 0, 0], [1, 1, 0]]], [[[0, 0], [2, 0]]], [[[NaN, 0], [1, 1]]], [[[0, 0], [Infinity, 1]]], [[[0, 0], ['1', 1]]], [[new Array(2), [1, 1]]], Array.from({ length: 7 }, () => [[0, 0], [1, 1]]), [Array.from({ length: 25 }, (_, i) => [i / 25, 0])], Array.from({ length: 6 }, () => Array.from({ length: 24 }, (_, i) => [i / 24, 0]))];
  for (const paths of badPaths) rejected(score({ scenes: Array.from({ length: 4 }, () => scene({ shape: 'outline', paths })) }), 'AI_SCORE_OUTLINE');
  rejected(score({ scenes: Array.from({ length: 4 }, () => scene({ paths: [[[0, 0], [1, 1]]] })) }), 'AI_SCORE_OUTLINE');
  assert.ok(validateAiDroneScore(score({ scenes: Array.from({ length: 4 }, () => scene({ shape: 'outline', paths: Array.from({ length: 5 }, () => Array.from({ length: 24 }, (_, i) => [i / 24, 0])) })) })));
});
