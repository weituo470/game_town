import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, loadProfile, saveProfile, clearProfile, addVisit, getDimensions, getCompletion, getRecommendations } from '../src/lib/profile.js';
import { auditSources } from '../scripts/check-readability.mjs';

const empty = () => ({ version: 1, visits: [], dismissed: [] });
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const result = (gameId = 'balloons', score = 75, extra = {}) => ({
  gameId, score, completed: true, metrics: { summary: '完成练习', hits: 6 }, durationSeconds: 30,
  inputDevice: 'keyboard-mouse', difficulty: 'standard', ...extra,
});
const feedback = (enjoyment = 5, wantsMore = true, comfort = 'gentle') => ({ enjoyment, wantsMore, comfort });
const dimension = (profile, id = 'balloons') => getDimensions(profile).find(item => item.gameId === id);

test('zero data remains unknown, not zero; discovery text does not invent evidence', () => {
  const profile = loadProfile(memoryStorage());
  assert.deepEqual(profile, empty());
  assert.equal(getCompletion(profile), 0);
  for (const item of getDimensions(profile)) {
    assert.equal(item.score, null);
    assert.equal(item.enjoyment, null);
    assert.equal(item.plays, 0);
  }
  const recommendations = getRecommendations(profile);
  assert.equal(recommendations.length, 4);
  assert.ok(recommendations.every(item => item.id.endsWith('-discovery') && item.description.includes('不是适合度判断')));
});

test('missing, corrupt, unsupported and oversized storage fail safely', () => {
  const storage = memoryStorage();
  for (const raw of ['{bad json', 'null', '[]', '{}', '{"version":2,"visits":[]}', '{"version":1,"visits":{}}', 'x'.repeat(500001)]) {
    storage.setItem(STORAGE_KEY, raw);
    assert.deepEqual(loadProfile(storage), empty());
  }
  assert.deepEqual(loadProfile({ getItem() { throw new Error('blocked'); } }), empty());
  assert.equal(saveProfile(empty(), { setItem() { throw new Error('quota'); } }), false);
  assert.equal(clearProfile({ removeItem() { throw new Error('blocked'); } }), false);
  assert.deepEqual(loadProfile(null), empty());
  assert.equal(saveProfile(empty(), null), false);
  assert.equal(clearProfile(null), false);
});

test('valid visits round-trip without unrelated data and are immutable', () => {
  const storage = memoryStorage();
  const original = empty();
  const next = addVisit(original, result(), feedback());
  assert.equal(original.visits.length, 0);
  assert.equal(next.visits.length, 1);
  assert.equal(saveProfile(next, storage), true);
  assert.deepEqual(loadProfile(storage), next);
  assert.equal(next.visits[0].metrics.summary, '完成练习');
  assert.ok(Number.isFinite(Date.parse(next.visits[0].createdAt)));
  assert.equal(getCompletion(next), 1);
});

test('finite scores are constrained; invalid scores or game ids cannot poison the profile', () => {
  let profile = addVisit(empty(), result('balloons', 1000, { durationSeconds: -10 }), feedback());
  assert.equal(profile.visits[0].score, 100);
  assert.equal(profile.visits[0].durationSeconds, 0);
  profile = addVisit(profile, result('puzzle', -50), feedback());
  assert.equal(dimension(profile, 'puzzle').score, 0);
  for (const bad of [NaN, Infinity, -Infinity, '80', null, undefined]) {
    assert.equal(addVisit(profile, { ...result(), score: bad }, feedback()).visits.length, 2);
  }
  assert.equal(addVisit(profile, result('unknown'), feedback()).visits.length, 2);
  assert.equal(addVisit(profile, result('balloons', 90, { completed: 'false' }), feedback()).visits.length, 2);
});

test('stored untrusted values are sanitized, not blindly trusted', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, visits: [
    { ...result(), createdAt: 'invalid', feedback: { enjoyment: 999, wantsMore: 'yes', comfort: 'scary' }, metrics: { summary: 'x'.repeat(500), nested: { value: 4 }, huge: 1e30 } },
    { ...result(), gameId: 'made-up-game' },
    null,
  ], dismissed: ['balloons-preference', {}, 'balloons-preference', '<script>'] }));
  const profile = loadProfile(storage);
  assert.equal(profile.visits.length, 1);
  assert.deepEqual(profile.visits[0].feedback, { enjoyment: null, wantsMore: null, comfort: null });
  assert.equal(profile.visits[0].metrics.summary.length, 240);
  assert.equal(profile.visits[0].metrics.nested, undefined);
  assert.equal(profile.visits[0].metrics.huge, 1e9);
  assert.deepEqual(profile.dismissed, ['balloons-preference']);
  assert.equal(getRecommendations(profile).some(item => item.id === 'balloons-preference'), false);
});

test('aborted visits do not count as low ability, completion or dislike', () => {
  const profile = addVisit(empty(), result('haunted', 0, { completed: false }), feedback(1, false));
  assert.equal(profile.visits.length, 1);
  assert.equal(getCompletion(profile), 0);
  assert.deepEqual(dimension(profile, 'haunted'), { gameId: 'haunted', label: '探索与刺激', score: null, plays: 0, enjoyment: null });
  assert.ok(getRecommendations(profile).some(item => item.id === 'haunted-discovery'));
  const previous = addVisit(empty(), result('haunted'), feedback(5));
  const abortedLater = addVisit(previous, result('haunted', 0, { completed: false }), feedback(1));
  assert.equal(dimension(abortedLater, 'haunted').enjoyment, 5);
});

test('recent five completed scores aggregate; latest explicit preference can correct history', () => {
  let profile = empty();
  for (const score of [100, 10, 20, 30, 40, 50]) profile = addVisit(profile, result('balloons', score), feedback(5));
  assert.equal(dimension(profile).score, 30);
  assert.equal(dimension(profile).plays, 6);
  assert.equal(getCompletion(profile), 1);
  assert.equal(getRecommendations(profile)[0].confidence, '更多线索');
  profile = addVisit(profile, result(), feedback(1, false));
  assert.equal(dimension(profile).enjoyment, 1);
  assert.equal(getRecommendations(profile).some(item => item.id === 'balloons-preference'), false);
  profile = addVisit(profile, result('balloons', 10), feedback(5));
  assert.equal(getRecommendations(profile)[0].id, 'balloons-preference');
  assert.equal(getRecommendations(profile)[0].confidence, '初步线索');
});

test('enjoyment outranks skill and low score still gets a beginner recommendation', () => {
  let profile = addVisit(empty(), result('balloons', 12), feedback(5));
  profile = addVisit(profile, result('rhythm', 100), feedback(4));
  const recommendations = getRecommendations(profile);
  assert.equal(recommendations[0].gameId, 'balloons');
  assert.match(recommendations[0].description, /新手难度/);
  profile = addVisit(profile, result('balloons', 100), feedback(1, false));
  assert.equal(getRecommendations(profile)[0].gameId, 'rhythm');
  assert.equal(getRecommendations(profile).some(item => item.gameId === 'balloons'), false);
});

test('identical game scores with different self-reports produce different recommendations', () => {
  const liked = addVisit(empty(), result('puzzle', 80), feedback(5, true));
  const disliked = addVisit(empty(), result('puzzle', 80), feedback(1, false));
  assert.equal(dimension(liked, 'puzzle').score, dimension(disliked, 'puzzle').score);
  assert.ok(getRecommendations(liked).some(item => item.id === 'puzzle-preference'));
  assert.equal(getRecommendations(disliked).some(item => item.id === 'puzzle-preference'), false);
});

test('missing rating is not silently converted to liking; neutral requires wanting more', () => {
  let profile = addVisit(empty(), result('balloons', 100));
  assert.equal(dimension(profile).enjoyment, null);
  assert.equal(getRecommendations(profile).some(item => item.gameId === 'balloons'), false);
  profile = addVisit(profile, result(), feedback(3, false));
  assert.equal(getRecommendations(profile).some(item => item.gameId === 'balloons'), false);
  profile = addVisit(profile, result(), feedback(3, true));
  assert.equal(getRecommendations(profile)[0].gameId, 'balloons');
});

test('comfort changes suggestions; fear-related performance is not a personality verdict', () => {
  let profile = addVisit(empty(), result('haunted', 100), feedback(5, true, 'gentle'));
  assert.equal(getRecommendations(profile)[0].title, '轻悬疑叙事探索');
  profile = addVisit(profile, result('haunted', 20), feedback(5, true, 'intense'));
  assert.equal(getRecommendations(profile)[0].title, '悬疑与恐怖探索');
  assert.match(getRecommendations(profile)[0].description, /不能预测/);
  assert.equal(getRecommendations(profile)[0].reasons.some(reason => reason.includes('/100')), false);
});

test('dismissed IDs are honored for both preference and discovery', () => {
  const profile = addVisit(empty(), result(), feedback());
  profile.dismissed = ['balloons-preference', 'haunted-discovery'];
  assert.equal(getRecommendations(profile).some(item => profile.dismissed.includes(item.id)), false);
});

test('visits cap at 40 and completion counts distinct games', () => {
  let profile = empty();
  for (let i = 0; i < 45; i += 1) profile = addVisit(profile, result(['balloons', 'haunted', 'rhythm', 'puzzle'][i % 4], i), feedback());
  assert.equal(profile.visits.length, 40);
  assert.equal(profile.visits[0].score, 5);
  assert.equal(getCompletion(profile), 4);
});

test('clearing removes this profile only and leaves a fresh unknown state', () => {
  const storage = memoryStorage();
  storage.setItem('another-app', 'keep');
  saveProfile(addVisit(empty(), result(), feedback()), storage);
  assert.equal(clearProfile(storage), true);
  assert.equal(storage.getItem('another-app'), 'keep');
  assert.deepEqual(loadProfile(storage), empty());
});

const semanticCss = ':root { --text-body: 1.125rem; --text-control: 1rem; --text-meta: .875rem; --text-title: 2.5rem; } html { font-size: 100%; } body { font-size: var(--text-body); } button { font-size: var(--text-control); }';
const auditFixture = (css = '', jsx = '') => auditSources([
  { path: 'src/styles.css', content: semanticCss + css },
  { path: 'src/Example.jsx', content: jsx },
]);

test('readability audit accepts semantic defaults and safe clamp titles', () => {
  assert.deepEqual(auditFixture('h1 { font-size: clamp(2rem, 4vw, 4rem); }', '<p>正文</p>').issues, []);
});

test('readability audit catches px/rem, font shorthand, variables and media overrides', () => {
  for (const css of [
    '.tiny { font-size: 12px; }',
    '.tiny { font-size: .7rem; }',
    '.tiny { font: 600 12px/1.5 sans-serif; }',
    ':root { --text-body: 1rem; }',
    '.tiny { --bad: 12px; font-size: var(--bad); }',
    '@media (max-width: 400px) { p { font-size: 16px; } }',
    '.tiny { font-size: var(--undefined); }',
    '.tiny { font-size: var(--font-body, 18px); }',
    'html { font-size: 80%; }',
    'body { zoom: .8; }',
    'body { transform: scale(.8); }',
    '#root { scale: .8; }',
  ]) assert.ok(auditFixture(css).issues.length > 0, `should reject ${css}`);
});

test('readability audit connects element semantics to CSS class overrides', () => {
  assert.ok(auditFixture('.intro { font-size: 16px; }', '<p className="intro">正文</p>').issues.length);
  assert.ok(auditFixture('.reset-view { font-size: 14px; }', '<button className="reset-view">返回</button>').issues.length);
  assert.deepEqual(auditFixture('.metadata { font-size: 14px; }', '<small className="metadata">元信息</small>').issues, []);
});

test('readability audit catches JSX numeric size, shorthand and responsive utility classes', () => {
  for (const jsx of [
    '<span style={{ fontSize: 12 }}>小字</span>',
    '<p style={{ fontSize: "1rem" }}>正文</p>',
    '<button style={{ font: "14px sans-serif" }}>按钮</button>',
    '<span className="text-xs">小字</span>',
    '<p className="text-lg sm:text-base">手机正文</p>',
    '<span className="text-[12px]">小字</span>',
    '<span className={"text-xs"}>小字</span>',
    '<p className={compact ? "text-base" : "text-lg"}>正文</p>',
  ]) assert.ok(auditFixture('', jsx).issues.length > 0, `should reject ${jsx}`);
});
