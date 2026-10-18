import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_VERSION, INTEREST_TAGS, MARKET_GAMES } from '../src/lib/marketCatalog.js';

const expectedTitles = [
  'CS2', 'Apex Legends', '守望先锋', '毁灭战士：永恒', '深岩银河',
  '黑神话：悟空', '艾尔登法环', 'Hades', '博德之门 3', '原神',
  '极限竞速：地平线 5', '赛道狂飙', '神力科莎', '极品飞车：热度', '拉力赛艺术',
  '传送门 2', 'Baba Is You', '见证者', '塔罗斯的法则 2', '奥伯拉丁的回归',
  '冰与火之舞', '节奏医生', '形状与节奏', '节奏光剑', 'Spin Rhythm XD',
  '英雄联盟', 'Dota 2', '文明 VI', '杀戮尖塔', 'Balatro',
  '星露谷物语', '城市：天际线', '双点医院', '动物园之星', '异星工厂',
  '我的世界', '泰拉瑞亚', '英灵神殿', '饥荒联机版', '深海迷航',
  '双人成行', '胡闹厨房 2', '毛线小精灵 2', '胡闹搬家 2', '人类一败涂地',
  '恐鬼症', '致命公司', '生化危机 2 重制版', '异形：隔离', '小小梦魇',
];

const byId = (id) => {
  const result = MARKET_GAMES.find((entry) => entry.id === id);
  assert.ok(result, `missing ${id}`);
  return result;
};

test('catalog has the approved 50 titles, unique slugs and a fixed version', () => {
  assert.equal(CATALOG_VERSION, '2026-10-17-v1');
  assert.equal(MARKET_GAMES.length, 50);
  assert.equal(new Set(MARKET_GAMES.map((entry) => entry.id)).size, 50);
  assert.equal(new Set(MARKET_GAMES.map((entry) => entry.title)).size, 50);
  assert.deepEqual(MARKET_GAMES.map((entry) => entry.title).sort(), [...expectedTitles].sort());
  for (const entry of MARKET_GAMES) assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test('interest vocabulary is the agreed readable 13-tag vocabulary', () => {
  const expected = ['shooting', 'driving', 'puzzle', 'rhythm', 'exploration', 'strategy', 'management', 'building', 'action', 'story', 'cooperation', 'competition', 'horror'];
  assert.deepEqual(INTEREST_TAGS.map((tag) => tag.id), expected);
  assert.equal(new Set(INTEREST_TAGS.map((tag) => tag.id)).size, expected.length);
  for (const tag of INTEREST_TAGS) assert.ok(typeof tag.label === 'string' && tag.label.trim());
});

test('every game exposes validated fields and 2 to 4 legal editorial tags', () => {
  const tags = new Set(INTEREST_TAGS.map((tag) => tag.id));
  const fields = ['id', 'title', 'category', 'tags', 'intensity', 'modes', 'requiresVR', 'requiresPartner', 'storeUrl', 'entryTip', 'cautions', 'sourceCheckedAt', 'tagBasis'];
  for (const entry of MARKET_GAMES) {
    assert.deepEqual(Object.keys(entry).sort(), [...fields].sort(), entry.id);
    for (const key of ['title', 'category', 'entryTip']) {
      assert.ok(typeof entry[key] === 'string' && entry[key].trim(), `${entry.id}.${key}`);
    }
    assert.ok(Array.isArray(entry.tags) && entry.tags.length >= 2 && entry.tags.length <= 4, entry.id);
    assert.equal(new Set(entry.tags).size, entry.tags.length, entry.id);
    for (const tag of entry.tags) assert.ok(tags.has(tag), `${entry.id}: ${tag}`);
    assert.ok(['gentle', 'balanced', 'intense'].includes(entry.intensity), entry.id);
    assert.ok(Array.isArray(entry.modes) && entry.modes.length >= 1 && entry.modes.length <= 3, entry.id);
    assert.equal(new Set(entry.modes).size, entry.modes.length, entry.id);
    for (const mode of entry.modes) assert.ok(['solo', 'coop', 'competitive'].includes(mode), entry.id);
    assert.equal(typeof entry.requiresVR, 'boolean', entry.id);
    assert.equal(typeof entry.requiresPartner, 'boolean', entry.id);
    assert.ok(Array.isArray(entry.cautions) && entry.cautions.length > 0, entry.id);
    assert.ok(entry.cautions.every((value) => typeof value === 'string' && value.trim()), entry.id);
    assert.equal(entry.sourceCheckedAt, '2026-10-17', entry.id);
    assert.equal(entry.tagBasis, 'editorial-v1', entry.id);
  }
});

test('store links use HTTPS on the approved official domains, without tracking or credentials', () => {
  const hosts = new Set(['store.steampowered.com', 'genshin.hoyoverse.com', 'www.leagueoflegends.com', 'www.minecraft.net']);
  assert.equal(new Set(MARKET_GAMES.map((entry) => entry.storeUrl)).size, 50);
  for (const entry of MARKET_GAMES) {
    const url = new URL(entry.storeUrl);
    assert.equal(url.protocol, 'https:', entry.id);
    assert.ok(hosts.has(url.hostname), entry.id);
    assert.equal(url.username + url.password + url.port + url.search + url.hash, '', entry.id);
    if (url.hostname === 'store.steampowered.com') assert.match(url.pathname, /^\/app\/\d+\/$/, entry.id);
  }
});

test('each approved title points to its own reviewed official product, not merely an official domain', () => {
  const sourceKeys = [
    '730', '1172470', '2357570', '782330', '548430',
    '2358720', '1245620', '1145360', '1086940', 'https://genshin.hoyoverse.com/',
    '1551360', '2225070', '244210', '1222680', '550320',
    '620', '736260', '210970', '835960', '653530',
    '977950', '774181', '531510', '620980', '1058830',
    'https://www.leagueoflegends.com/en-us/', '570', '289070', '646570', '2379780',
    '413150', '255710', '535930', '703080', '427520',
    'https://www.minecraft.net/zh-hans', '105600', '892970', '322330', '264710',
    '1426210', '728880', '1225570', '1641700', '477160',
    '739630', '1966720', '883710', '214490', '424840',
  ];
  assert.equal(sourceKeys.length, expectedTitles.length);
  const actual = new Map(MARKET_GAMES.map((entry) => [entry.title, entry.storeUrl]));
  for (const [index, title] of expectedTitles.entries()) {
    const key = sourceKeys[index];
    const expected = key.startsWith('https:') ? key : `https://store.steampowered.com/app/${key}/`;
    assert.equal(actual.get(title), expected, title);
  }
});

test('VR and mandatory-partner constraints are explicit and not applied to whole categories', () => {
  const beatSaber = byId('beat-saber');
  assert.equal(beatSaber.requiresVR, true);
  assert.match(beatSaber.cautions.join(' '), /VR/);
  assert.deepEqual(MARKET_GAMES.filter((entry) => entry.requiresVR).map((entry) => entry.id), ['beat-saber']);
  const itTakesTwo = byId('it-takes-two');
  assert.equal(itTakesTwo.requiresPartner, true);
  assert.deepEqual(itTakesTwo.modes, ['coop']);
  assert.match(itTakesTwo.cautions.join(' '), /必须双人/);
  assert.deepEqual(MARKET_GAMES.filter((entry) => entry.requiresPartner).map((entry) => entry.id), ['it-takes-two']);
  assert.ok(byId('unravel-two').modes.includes('solo'));
  assert.ok(byId('unravel-two').modes.includes('coop'));
  assert.equal(byId('unravel-two').requiresPartner, false);
});

test('team PvP and single-player strategy retain distinct modes and tags', () => {
  for (const id of ['league-of-legends', 'dota-2', 'counter-strike-2', 'apex-legends', 'overwatch']) {
    assert.ok(byId(id).tags.includes('competition'), id);
    assert.ok(byId(id).modes.includes('competitive'), id);
    assert.equal(byId(id).requiresPartner, false, 'matchmaking is not a known-partner prerequisite');
  }
  for (const id of ['slay-the-spire', 'balatro']) assert.deepEqual(byId(id).modes, ['solo']);
  assert.deepEqual(byId('baldurs-gate-3').modes, ['solo', 'coop']);
  assert.equal(byId('baldurs-gate-3').tags.includes('action'), false, 'turn-based RPG must not inherit an action-group label');
});

test('all five horror picks are labeled and contain explicit content warnings', () => {
  const horrorIds = ['phasmophobia', 'lethal-company', 'resident-evil-2', 'alien-isolation', 'little-nightmares'];
  assert.deepEqual(MARKET_GAMES.filter((entry) => entry.category === '悬疑／恐怖').map((entry) => entry.id), horrorIds);
  for (const id of horrorIds) {
    const entry = byId(id);
    assert.ok(entry.tags.includes('horror'), id);
    assert.equal(entry.intensity, 'intense', id);
    assert.match(entry.cautions.join(' '), /惊吓|追逐|追猎|鬼怪|怪物/, id);
  }
  assert.ok(byId('phasmophobia').modes.includes('solo'));
  assert.ok(byId('phasmophobia').modes.includes('coop'));
  assert.deepEqual(byId('resident-evil-2').modes, ['solo']);
  assert.match(byId('subnautica').cautions.join(' '), /不保证无惊悚/);
});

test('catalog supports all 13 interests and keeps ten display categories at five games each', () => {
  const covered = new Set(MARKET_GAMES.flatMap((entry) => entry.tags));
  assert.deepEqual([...covered].sort(), INTEREST_TAGS.map((tag) => tag.id).sort());
  const counts = new Map();
  for (const entry of MARKET_GAMES) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  assert.equal(counts.size, 10);
  for (const [category, count] of counts) assert.equal(count, 5, category);
});

test('shared catalog data cannot be accidentally mutated by recommendations or UI', () => {
  assert.ok(Object.isFrozen(MARKET_GAMES));
  assert.ok(Object.isFrozen(INTEREST_TAGS));
  for (const tag of INTEREST_TAGS) assert.ok(Object.isFrozen(tag));
  for (const entry of MARKET_GAMES) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.tags));
    assert.ok(Object.isFrozen(entry.modes));
    assert.ok(Object.isFrozen(entry.cautions));
  }
  assert.throws(() => { MARKET_GAMES[0].intensity = 'gentle'; }, TypeError);
});
