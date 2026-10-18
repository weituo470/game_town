import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PREFERENCES_KEY, defaultPreferences, sanitizePreferences, loadPreferences, savePreferences,
  clearPreferences, deriveInterests, recommendGames,
} from '../src/lib/marketRecommendations.js';
import { MARKET_GAMES } from '../src/lib/marketCatalog.js';

const game = (id, tags, category = tags[0], extra = {}) => ({
  id, title: `游戏 ${id}`, category, tags, intensity: 'balanced', modes: ['solo'],
  requiresVR: false, requiresPartner: false, storeUrl: `https://example.com/games/${id}`,
  entryTip: '先体验基础玩法。', cautions: [], sourceCheckedAt: '2026-10-17', tagBasis: '人工标注', ...extra,
});
const catalog = [
  game('shooter-a', ['shooting', 'action'], '射击'),
  game('shooter-b', ['shooting'], '射击'),
  game('shooter-c', ['shooting'], '射击'),
  game('puzzle', ['puzzle', 'exploration'], '解谜', { intensity: 'gentle' }),
  game('rhythm', ['rhythm'], '节奏', { intensity: 'intense' }),
  game('racing', ['driving'], '驾驶'),
  game('horror', ['horror', 'exploration'], '恐怖'),
  game('vr', ['rhythm'], '节奏', { requiresVR: true }),
  game('duo', ['cooperation', 'puzzle'], '合作', { modes: ['coop'], requiresPartner: true }),
  game('solo-coop', ['cooperation', 'building'], '建造', { modes: ['solo', 'coop'] }),
  game('competitive', ['shooting', 'competition'], '射击', { modes: ['competitive'] }),
];
const visit = (gameId = 'balloons', rating = 5, score = 75, extra = {}) => ({
  gameId, completed: true, score, feedback: { enjoyment: rating }, ...extra,
});
const profile = (...visits) => ({ version: 1, visits });
const ids = results => results.map(result => result.id);
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test('defaults are separate mutable values and contain no inferred consent', () => {
  const first = defaultPreferences();
  first.interests.push('horror');
  first.feedback.puzzle = 'want';
  assert.deepEqual(defaultPreferences(), {
    interests: [], excludedTags: [], comfort: 'auto', playMode: 'any',
    hasVR: false, hasPartner: false, allowHorror: false, feedback: {},
  });
});

test('dirty preferences are sanitized without coercion or prototype pollution', () => {
  const dirty = JSON.parse('{"interests":["puzzle","puzzle","unknown",null],"excludedTags":["horror",{}],"comfort":"scary","playMode":"multi","hasVR":"true","hasPartner":1,"allowHorror":"yes","feedback":{"puzzle":"want","rhythm":"played","shooter-a":"dislike","constructor":"want","__proto__":"want","bad value":"want","other":"invalid"}}');
  assert.deepEqual(sanitizePreferences(dirty), {
    interests: ['puzzle'], excludedTags: ['horror'], comfort: 'auto', playMode: 'any',
    hasVR: false, hasPartner: false, allowHorror: false,
    feedback: { puzzle: 'want', rhythm: 'played', 'shooter-a': 'dislike' },
  });
  for (const invalid of [null, [], false, 'puzzle', NaN]) assert.deepEqual(sanitizePreferences(invalid), defaultPreferences());
  assert.equal({}.polluted, undefined);
});

test('storage round trips only sanitized preferences and clears only its key', () => {
  const local = storage();
  local.setItem('another-app', 'keep');
  const prefs = { ...defaultPreferences(), interests: ['puzzle'], feedback: { puzzle: 'want' } };
  assert.equal(savePreferences(prefs, local), true);
  assert.deepEqual(loadPreferences(local), prefs);
  assert.equal(clearPreferences(local), true);
  assert.deepEqual(loadPreferences(local), defaultPreferences());
  assert.equal(local.getItem('another-app'), 'keep');
});

test('missing, blocked, malformed and oversized storage fail safely', () => {
  const local = storage();
  for (const raw of ['{invalid', 'null', '[]', 'false', 'x'.repeat(100001)]) {
    local.setItem(PREFERENCES_KEY, raw);
    assert.deepEqual(loadPreferences(local), defaultPreferences());
  }
  assert.deepEqual(loadPreferences(null), defaultPreferences());
  assert.deepEqual(loadPreferences({ getItem() { throw new Error('blocked'); } }), defaultPreferences());
  assert.equal(savePreferences({}, null), false);
  assert.equal(savePreferences({}, { setItem() { throw new Error('quota'); } }), false);
  assert.equal(clearPreferences(null), false);
  assert.equal(clearPreferences({ removeItem() { throw new Error('blocked'); } }), false);
  assert.doesNotThrow(() => loadPreferences());
});

test('blocked storage retains preferences across remount-like loads within this session', () => {
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  const prefs = { ...defaultPreferences(), interests: ['puzzle'], feedback: { puzzle: 'want' } };
  assert.equal(savePreferences(prefs, blocked), false);
  assert.deepEqual(loadPreferences(blocked), prefs);
  const mountOne = loadPreferences(blocked);
  mountOne.interests.push('shooting');
  assert.deepEqual(loadPreferences(blocked), prefs, 'returned values must not mutate the session cache');
  assert.equal(clearPreferences(blocked), false);
  assert.deepEqual(loadPreferences(blocked), defaultPreferences());
  assert.deepEqual(loadPreferences({ getItem() { throw new Error('blocked'); } }), defaultPreferences(), 'storage instances are isolated');
});

test('absent storage has a shared session fallback which clear also resets', () => {
  clearPreferences(null);
  const prefs = { ...defaultPreferences(), interests: ['driving'] };
  assert.equal(savePreferences(prefs, null), false);
  assert.deepEqual(loadPreferences(null), prefs);
  assert.equal(clearPreferences(null), false);
  assert.deepEqual(loadPreferences(null), defaultPreferences());
});

test('quota failure preserves the latest session value until genuinely new storage data arrives', () => {
  const local = storage();
  const original = { ...defaultPreferences(), interests: ['puzzle'] };
  assert.equal(savePreferences(original, local), true);
  const writer = local.setItem;
  local.setItem = () => { throw new Error('quota'); };
  const pending = { ...defaultPreferences(), interests: ['rhythm'] };
  assert.equal(savePreferences(pending, local), false);
  assert.deepEqual(loadPreferences(local), pending);
  const external = { ...defaultPreferences(), interests: ['driving'] };
  writer(PREFERENCES_KEY, JSON.stringify(external));
  assert.deepEqual(loadPreferences(local), external);
  local.removeItem(PREFERENCES_KEY);
  assert.deepEqual(loadPreferences(local), defaultPreferences());
  local.getItem = () => { throw new Error('blocked after external clear'); };
  assert.deepEqual(loadPreferences(local), defaultPreferences(), 'cleared storage must not resurrect an old session snapshot');
});

test('external deletion also supersedes an unpersisted pending value', () => {
  const local = storage();
  savePreferences({ interests: ['puzzle'] }, local);
  local.setItem = () => { throw new Error('quota'); };
  savePreferences({ interests: ['driving'] }, local);
  local.removeItem(PREFERENCES_KEY);
  assert.deepEqual(loadPreferences(local), defaultPreferences());
});

test('failed clear suppresses the stale readable value without suppressing newer external data', () => {
  const local = storage();
  savePreferences({ interests: ['puzzle'] }, local);
  local.removeItem = () => { throw new Error('blocked removal'); };
  assert.equal(clearPreferences(local), false);
  assert.deepEqual(loadPreferences(local), defaultPreferences());
  const external = { ...defaultPreferences(), interests: ['rhythm'] };
  local.setItem(PREFERENCES_KEY, JSON.stringify(external));
  assert.deepEqual(loadPreferences(local), external);
});

test('no evidence yields labelled exploration without fabricated performance', () => {
  assert.deepEqual(deriveInterests(profile()), []);
  const results = recommendGames(profile(), {}, catalog);
  assert.equal(results.length, 3);
  assert.ok(results.every(item => item.kind === '探索推荐' && item.confidence === '探索推荐'));
  assert.ok(results.every(item => item.reasons.some(reason => reason.includes('不是适合度判断'))));
  assert.ok(results.every(item => !JSON.stringify(item.reasons).includes('/5')));
  assert.ok(new Set(results.map(item => item.category)).size > 1);
  assert.ok(results.every(item => !Object.hasOwn(item, 'rank') && !Object.hasOwn(item, 'matchPercent')));
});

test('a high score without explicit enjoyment never becomes interest evidence', () => {
  for (const rating of [undefined, null, '5', 0, 6, NaN]) {
    const input = profile(visit('balloons', 5, 100, { feedback: { enjoyment: rating } }));
    assert.deepEqual(deriveInterests(input), []);
    assert.ok(recommendGames(input, {}, catalog).every(item => item.confidence === '探索推荐'));
  }
});

test('a high score with dislike does not produce a shooter recommendation', () => {
  const input = profile(visit('balloons', 1, 100));
  assert.equal(deriveInterests(input)[0].value, -1);
  const results = recommendGames(input, {}, catalog);
  assert.ok(results.length > 0);
  assert.ok(results.every(item => !item.tags.includes('shooting')));
  assert.ok(!JSON.stringify(results).includes('天赋'));
});

test('low score and liking still recommend shooting, with bounded practice advice', () => {
  const input = profile(visit('balloons', 5, 12));
  const results = recommendGames(input, {}, catalog);
  assert.equal(results[0].id, 'shooter-a');
  assert.equal(results[0].kind, '兴趣匹配');
  assert.equal(results[0].confidence, '初步线索');
  assert.ok(results[0].reasons.includes('你最近一次将气球靶场的乐趣评为 5/5。'));
  assert.match(results[0].entryTip, /仍可练习/);
  assert.ok(results.some(item => item.category !== '射击'));
});

test('scores never alter the ordering for identical stated preferences', () => {
  const low = recommendGames(profile(visit('balloons', 5, 1)), {}, catalog);
  const high = recommendGames(profile(visit('balloons', 5, 100)), {}, catalog);
  assert.deepEqual(ids(low), ids(high));
  assert.deepEqual(low.map(item => item.reasons), high.map(item => item.reasons));
});

test('latest valid completed feedback corrects earlier preference; neutral is not liking', () => {
  const input = profile(visit('balloons', 5), visit('balloons', 1));
  assert.equal(deriveInterests(input)[0].value, -1);
  input.visits.push(visit('balloons', 5, 0, { completed: false }));
  input.visits.push(visit('balloons', null));
  assert.equal(deriveInterests(input)[0].value, -1);
  input.visits.push(visit('balloons', 3));
  assert.equal(deriveInterests(input)[0].value, 0);
  assert.ok(recommendGames(input, {}, catalog).every(item => item.confidence === '探索推荐'));
});

test('valid timestamps identify latest feedback when visit array is out of order', () => {
  const input = profile(
    visit('puzzle', 1, 80, { createdAt: '2026-10-17T10:00:00.000Z' }),
    visit('puzzle', 5, 80, { createdAt: '2026-10-16T10:00:00.000Z' }),
  );
  assert.equal(deriveInterests(input)[0].value, -1);
});

test('replaying and duplicate run ids cannot manufacture greater interest weight', () => {
  const run = visit('balloons', 5, 75, { id: 'same-run' });
  const single = profile(run);
  const repeated = profile(...Array.from({ length: 40 }, () => ({ ...run })));
  assert.deepEqual(deriveInterests(single), deriveInterests(repeated));
  assert.deepEqual(recommendGames(single, {}, catalog), recommendGames(repeated, {}, catalog));
});

test('unknown games, incomplete runs and invalid scores do not create evidence', () => {
  for (const bad of [NaN, Infinity, -Infinity, '80', undefined, null]) {
    assert.deepEqual(deriveInterests(profile(visit('balloons', 5, 75, { score: bad }))), []);
  }
  assert.deepEqual(deriveInterests(profile(visit('unknown', 5), visit('puzzle', 5, 10, { completed: 'true' }))), []);
  assert.deepEqual(recommendGames(null, null, catalog), recommendGames(profile(), {}, catalog));
});

test('supported room aliases map to the proper gameplay interest, not repeated votes', () => {
  for (const id of ['aim-lab', 'aim', 'aim_lab', 'cs-room', 'cs_room', 'cs-room-tinystrike']) {
    assert.equal(deriveInterests(profile(visit(id, 5)))[0].id, 'shooting');
  }
  for (const id of ['karting', 'kart', 'racing']) assert.equal(deriveInterests(profile(visit(id, 5)))[0].id, 'driving');
  assert.equal(deriveInterests(profile(visit('balloons', 5), visit('aim', 5), visit('cs-room', 5))).length, 1);
});

test('a mild haunted maze suggests exploration but never fear tolerance or horror consent', () => {
  const input = profile(visit('haunted', 5, 100));
  assert.deepEqual(deriveInterests(input).map(item => item.id), ['exploration']);
  const results = recommendGames(input, {}, catalog);
  assert.equal(results[0].id, 'puzzle');
  assert.ok(results.every(item => !item.tags.includes('horror')));
  assert.ok(!JSON.stringify(results).includes('胆量'));
});

test('manual interest explicitly overrides an observed dislike without inventing a run', () => {
  const input = profile(visit('balloons', 1, 100));
  const interests = deriveInterests(input, { interests: ['shooting'] });
  assert.equal(interests[0].value, 2);
  assert.equal(interests[0].source, 'manual');
  assert.match(interests[0].evidence, /主动选择/);
  assert.equal(recommendGames(input, { interests: ['shooting'] }, catalog)[0].id, 'shooter-a');
});

test('all-negative evidence never fills the top slot from the same disliked categories', () => {
  assert.deepEqual(recommendGames(profile(visit('balloons', 1)), {}, catalog.slice(0, 3)), []);
  const input = profile(visit('balloons', 1), visit('puzzle', 1), visit('rhythm', 2), visit('karting', 1));
  const results = recommendGames(input, {}, catalog);
  assert.ok(results.every(item => !item.tags.some(tag => ['shooting', 'puzzle', 'rhythm', 'driving'].includes(tag))));
});

test('negative taste is a penalty, not a permanent ban on mixed experiences', () => {
  const input = profile(visit('balloons', 1));
  const results = recommendGames(input, { interests: ['action'] }, [catalog[0]]);
  assert.equal(results.length, 1);
  assert.ok(results[0].reasons.some(reason => reason.includes('评价较低')));
});

test('VR, required partners, horror and excluded tags are hard constraints', () => {
  const constrained = catalog.filter(item => ['vr', 'duo', 'horror'].includes(item.id));
  assert.deepEqual(recommendGames(profile(), { interests: ['rhythm', 'puzzle', 'horror'] }, constrained), []);
  const open = { hasVR: true, hasPartner: true, allowHorror: true, interests: ['rhythm', 'puzzle', 'horror'] };
  assert.equal(recommendGames(profile(), open, constrained).length, 3);
  assert.deepEqual(recommendGames(profile(), { ...open, excludedTags: ['rhythm', 'puzzle', 'horror'] }, constrained), []);
  assert.deepEqual(recommendGames(profile(), { feedback: { vr: 'want', duo: 'want', horror: 'want' } }, constrained), []);
});

test('mode filtering respects required companions and offers a real solo alternative', () => {
  const results = recommendGames(profile(), { interests: ['building'], hasPartner: false }, catalog);
  const mixed = results.find(item => item.id === 'solo-coop');
  assert.equal(mixed.selectedMode, 'solo');
  assert.ok(mixed.reasons.some(reason => reason.includes('不要求你先找同伴')));
  assert.deepEqual(recommendGames(profile(), { playMode: 'coop', hasPartner: false }, catalog), []);
  assert.ok(recommendGames(profile(), { playMode: 'coop', hasPartner: true }, catalog).every(item => item.modes.includes('coop')));
  assert.ok(recommendGames(profile(), { playMode: 'solo' }, catalog).every(item => item.modes.includes('solo')));
  assert.deepEqual(ids(recommendGames(profile(), { playMode: 'competitive' }, catalog)), ['competitive']);
});

test('played and disliked games are removed, wants help but never bypass filters', () => {
  const prefs = { interests: ['shooting'], feedback: { 'shooter-a': 'played', 'shooter-b': 'dislike', puzzle: 'want' } };
  const results = recommendGames(profile(), prefs, catalog);
  assert.equal(results[0].id, 'puzzle');
  assert.ok(results[0].reasons.some(reason => reason.includes('想玩')));
  assert.ok(!ids(results).includes('shooter-a'));
  assert.ok(!ids(results).includes('shooter-b'));
});

test('changing explicit interest updates top recommendation without playing again', () => {
  assert.equal(recommendGames(profile(), { interests: ['puzzle'] }, catalog)[0].id, 'puzzle');
  assert.equal(recommendGames(profile(), { interests: ['rhythm'] }, catalog)[0].id, 'rhythm');
  assert.equal(recommendGames(profile(), { interests: ['driving'] }, catalog)[0].id, 'racing');
});

test('comfort is a secondary ordering signal, not stronger than a known liking', () => {
  const input = profile(visit('rhythm', 5));
  assert.equal(recommendGames(input, { comfort: 'gentle' }, catalog)[0].id, 'rhythm');
  assert.equal(recommendGames(profile(), { comfort: 'gentle' }, catalog)[0].id, 'puzzle');
});

test('default auto comfort follows the latest valid gameplay comfort and names its source', () => {
  const choices = [game('intense-shot', ['shooting'], '射击', { intensity: 'intense' }),
    game('gentle-shot', ['shooting'], '射击', { intensity: 'gentle' })];
  const gentle = visit('balloons', 5, 80, { feedback: { enjoyment: 5, comfort: 'gentle' }, createdAt: '2026-10-17T10:00:00Z' });
  const intense = visit('balloons', 5, 80, { feedback: { enjoyment: 5, comfort: 'intense' }, createdAt: '2026-10-17T11:00:00Z' });
  const gentleResults = recommendGames(profile(gentle), {}, choices);
  assert.equal(gentleResults[0].id, 'gentle-shot');
  assert.ok(gentleResults[0].reasons.some(reason => reason.includes('气球靶场游玩反馈中选择了轻松')));
  assert.equal(recommendGames(profile(intense, gentle), { comfort: 'auto' }, choices)[0].id, 'intense-shot');
});

test('explicit comfort overrides automatic feedback and stored any continues to mean unrestricted', () => {
  const choices = [game('intense-shot', ['shooting'], '射击', { intensity: 'intense' }),
    game('gentle-shot', ['shooting'], '射击', { intensity: 'gentle' })];
  const input = profile(visit('balloons', 5, 80, { feedback: { enjoyment: 5, comfort: 'gentle' } }));
  const manual = recommendGames(input, { comfort: 'intense' }, choices);
  assert.equal(manual[0].id, 'intense-shot');
  assert.ok(manual[0].reasons.some(reason => reason.includes('推荐设置中选择了挑战')));
  assert.ok(manual[0].reasons.every(reason => !reason.includes('游玩反馈中')));
  const unrestricted = recommendGames(input, { comfort: 'any' }, choices);
  assert.equal(unrestricted[0].id, 'intense-shot');
  assert.ok(unrestricted[0].reasons.every(reason => !reason.includes('人工强度标签')));
  assert.equal(sanitizePreferences({ comfort: 'any' }).comfort, 'any');
  const local = storage();
  local.setItem(PREFERENCES_KEY, JSON.stringify({ comfort: 'any' }));
  assert.equal(loadPreferences(local).comfort, 'any');
});

test('unknown comfort, unknown games and incomplete gameplay cannot infer intensity', () => {
  const choices = [game('intense-shot', ['shooting'], '射击', { intensity: 'intense' }),
    game('gentle-shot', ['shooting'], '射击', { intensity: 'gentle' })];
  for (const comfort of [undefined, null, 'auto', 'any', 'scary', 5]) {
    const input = profile(visit('balloons', 5, 80, { feedback: { enjoyment: 5, comfort } }));
    const result = recommendGames(input, {}, choices);
    assert.equal(result[0].id, 'intense-shot');
    assert.ok(result[0].reasons.every(reason => !reason.includes('人工强度标签')));
  }
  const invalid = profile(
    visit('unknown', 5, 80, { feedback: { enjoyment: 5, comfort: 'gentle' } }),
    visit('balloons', 5, 80, { completed: false, feedback: { enjoyment: 5, comfort: 'gentle' } }),
    visit('balloons', 5, 80, { score: '80', feedback: { enjoyment: 5, comfort: 'gentle' } }),
  );
  assert.equal(recommendGames(invalid, {}, choices)[0].id, 'intense-shot');
});

test('catalogue intensity never accepts auto or any preference sentinels', () => {
  for (const intensity of ['auto', 'any', 'unknown', null]) {
    const results = recommendGames(profile(), {}, [game('invalid-intensity', ['puzzle'], '解谜', { intensity })]);
    assert.equal(results[0].intensity, 'balanced');
  }
});

test('diversity keeps the first strong matches and uses a different third experience', () => {
  const results = recommendGames(profile(visit('balloons', 5)), {}, catalog);
  assert.deepEqual(results.slice(0, 2).map(item => item.category), ['射击', '射击']);
  assert.notEqual(results[2].category, '射击');
  assert.equal(results[2].kind, '探索推荐');
  assert.equal(recommendGames(profile(visit('balloons', 5)), {}, catalog, 1)[0].id, 'shooter-a');
});

test('deterministic recommendations do not mutate inputs and cap at three', () => {
  const input = profile(visit('puzzle', 5), visit('rhythm', 4));
  const prefs = { interests: ['driving'], comfort: 'balanced' };
  const before = JSON.stringify({ input, prefs, catalog });
  assert.deepEqual(recommendGames(input, prefs, catalog), recommendGames(input, prefs, catalog));
  assert.equal(JSON.stringify({ input, prefs, catalog }), before);
  assert.equal(recommendGames(input, prefs, catalog, 99).length, 3);
  assert.deepEqual(recommendGames(input, prefs, catalog, 0), []);
  assert.deepEqual(recommendGames(input, prefs, null), []);
});

test('malformed catalogue entries and duplicate ids cannot break result safety', () => {
  const dirty = [null, {}, game('invalid-url', ['puzzle'], '解谜', { storeUrl: 'javascript:alert(1)' }),
    game('unknown-tag', ['invented']), game('unknown-mode', ['puzzle'], '解谜', { modes: ['invented'] }),
    game('valid', ['puzzle']), game('valid', ['rhythm'])];
  const results = recommendGames(profile(), {}, dirty);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'valid');
  assert.ok(results[0].storeUrl.startsWith('https://'));
});

test('the real catalogue produces unique bounded safe recommendations', () => {
  assert.equal(MARKET_GAMES.length, 50);
  const results = recommendGames(profile(visit('puzzle', 5)), { playMode: 'solo' });
  assert.equal(results.length, 3);
  assert.equal(new Set(ids(results)).size, results.length);
  assert.ok(results.every(item => !item.requiresVR && !item.requiresPartner && !item.tags.includes('horror')));
  assert.ok(results[0].tags.includes('puzzle'));
});
