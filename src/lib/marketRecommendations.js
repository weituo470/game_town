import { MARKET_GAMES, INTEREST_TAGS } from './marketCatalog.js';

// A transparent, local-only content matcher; these are not validated personality
// tests, ability diagnoses, or predictions of commercial-game proficiency.
export const PREFERENCES_KEY = 'game-town.market-preferences.v1';
const TAG_LABELS = {
  shooting: '射击瞄准', driving: '驾驶竞速', puzzle: '机关解谜', rhythm: '音乐节奏',
  exploration: '自由探索', strategy: '策略构筑', management: '经营生活', building: '建造创造',
  action: '动作挑战', story: '剧情体验', cooperation: '合作', competition: '竞技', horror: '惊悚恐怖',
};
const TAG_IDS = Object.keys(TAG_LABELS);
const TAG_SET = new Set(TAG_IDS);
const INTENSITIES = new Set(['gentle', 'balanced', 'intense']);
const COMFORTS = new Set(['auto', 'any', ...INTENSITIES]);
const MODES = new Set(['any', 'solo', 'coop', 'competitive']);
const FEEDBACK_VALUES = new Set(['want', 'dislike', 'played']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const safeId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value)
  && !['constructor', 'prototype', '__proto__'].includes(value);
const cleanTags = value => Array.isArray(value) ? [...new Set(value.filter(tag => TAG_SET.has(tag)))] : [];
const cleanText = value => typeof value === 'string' ? value.slice(0, 600) : '';

const SOURCES = {
  balloons: { tag: 'shooting', name: '气球靶场' },
  'aim-lab': { tag: 'shooting', name: '射击训练' },
  aim: { tag: 'shooting', name: '射击训练' },
  aim_lab: { tag: 'shooting', name: '射击训练' },
  'cs-room': { tag: 'shooting', name: 'CS 房间' },
  cs_room: { tag: 'shooting', name: 'CS 房间' },
  'cs-room-tinystrike': { tag: 'shooting', name: 'CS 房间' },
  karting: { tag: 'driving', name: '卡丁车' },
  kart: { tag: 'driving', name: '卡丁车' },
  racing: { tag: 'driving', name: '卡丁车' },
  puzzle: { tag: 'puzzle', name: '机关工坊' },
  rhythm: { tag: 'rhythm', name: '节奏舞台' },
  // The current haunted room is a mild maze, not a measure of fear tolerance.
  haunted: { tag: 'exploration', name: '鬼屋探险（温和探索）' },
};

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

// This is a per-page-session fallback, not persistent storage. Weak keys keep
// tests/alternate storage providers isolated and do not retain their objects.
const sessionPreferences = new WeakMap();
const missingStorage = {};
const unreadableStorage = Symbol('unreadable-storage');
const storageKey = storage => storage !== null && ['object', 'function'].includes(typeof storage) ? storage : missingStorage;
function readRaw(storage) {
  try {
    return typeof storage?.getItem === 'function' ? storage.getItem(PREFERENCES_KEY) : unreadableStorage;
  } catch { return unreadableStorage; }
}

export function defaultPreferences() {
  return {
    interests: [], excludedTags: [], comfort: 'auto', playMode: 'any',
    hasVR: false, hasPartner: false, allowHorror: false, feedback: {},
  };
}

export function sanitizePreferences(value) {
  const source = isRecord(value) ? value : {};
  const feedback = {};
  if (isRecord(source.feedback)) {
    for (const [id, response] of Object.entries(source.feedback).slice(0, 200)) {
      if (safeId(id) && FEEDBACK_VALUES.has(response)) feedback[id] = response;
    }
  }
  return {
    interests: cleanTags(source.interests),
    excludedTags: cleanTags(source.excludedTags),
    comfort: COMFORTS.has(source.comfort) ? source.comfort : 'auto',
    playMode: MODES.has(source.playMode) ? source.playMode : 'any',
    hasVR: source.hasVR === true,
    hasPartner: source.hasPartner === true,
    allowHorror: source.allowHorror === true,
    feedback,
  };
}

export function loadPreferences(storage = defaultStorage()) {
  const key = storageKey(storage);
  const remembered = sessionPreferences.get(key);
  const raw = readRaw(storage);
  if (raw === unreadableStorage) return sanitizePreferences(remembered?.preferences);
  // A failed write can leave an old but readable value behind (quota limits).
  // Keep the session update only while that exact old value remains unchanged.
  // A new value or an external removal takes precedence over the fallback.
  if (remembered?.pending && raw === remembered.baseline) return sanitizePreferences(remembered.preferences);
  try {
    if (typeof raw !== 'string' || raw.length > 100000) {
      sessionPreferences.delete(key);
      return defaultPreferences();
    }
    const preferences = sanitizePreferences(JSON.parse(raw));
    sessionPreferences.set(key, { preferences, baseline: raw, pending: false });
    return sanitizePreferences(preferences);
  } catch {
    sessionPreferences.delete(key);
    return defaultPreferences();
  }
}

export function savePreferences(preferences, storage = defaultStorage()) {
  const key = storageKey(storage);
  const clean = sanitizePreferences(preferences);
  const baseline = readRaw(storage);
  sessionPreferences.set(key, { preferences: clean, baseline, pending: true });
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    const raw = JSON.stringify(clean);
    storage.setItem(PREFERENCES_KEY, raw);
    sessionPreferences.set(key, { preferences: clean, baseline: raw, pending: false });
    return true;
  } catch { return false; }
}

export function clearPreferences(storage = defaultStorage()) {
  const key = storageKey(storage);
  // A tombstone prevents failed removal from restoring the stale readable
  // value on remount. A genuinely newer external write is still respected.
  sessionPreferences.set(key, { preferences: defaultPreferences(), baseline: readRaw(storage), pending: true });
  try {
    if (!storage || typeof storage.removeItem !== 'function') return false;
    storage.removeItem(PREFERENCES_KEY);
    sessionPreferences.delete(key);
    return true;
  } catch { return false; }
}

function labelFor(id) {
  const entry = Array.isArray(INTEREST_TAGS) ? INTEREST_TAGS.find(tag => tag?.id === id) : INTEREST_TAGS?.[id];
  return cleanText(typeof entry === 'string' ? entry : entry?.label) || TAG_LABELS[id];
}

function latestExperiences(profile) {
  const latest = new Map();
  const visits = Array.isArray(profile?.visits) ? profile.visits : [];
  visits.forEach((visit, index) => {
    if (!isRecord(visit) || visit.completed !== true || !isFiniteNumber(visit.score)) return;
    if (!Object.hasOwn(SOURCES, visit.gameId)) return;
    const rating = visit.feedback?.enjoyment;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;
    const source = SOURCES[visit.gameId];
    const timestamp = typeof visit.createdAt === 'string' ? Date.parse(visit.createdAt) : NaN;
    const previous = latest.get(source.tag);
    // Newest timestamp wins when both records have one; otherwise use the
    // append-only visit order. Replays/aliases never accumulate extra weight.
    if (previous && Number.isFinite(timestamp) && Number.isFinite(previous.timestamp)
      && (timestamp < previous.timestamp || (timestamp === previous.timestamp && index < previous.index))) return;
    latest.set(source.tag, { ...source, rating, score: visit.score, gameId: visit.gameId, index, timestamp });
  });
  return latest;
}

function resolveComfort(profile, prefs) {
  if (prefs.comfort !== 'auto') return { value: prefs.comfort, source: 'manual' };
  let latest;
  const visits = Array.isArray(profile?.visits) ? profile.visits : [];
  visits.forEach((visit, index) => {
    if (!isRecord(visit) || visit.completed !== true || !isFiniteNumber(visit.score)
      || !Object.hasOwn(SOURCES, visit.gameId) || !INTENSITIES.has(visit.feedback?.comfort)) return;
    const timestamp = typeof visit.createdAt === 'string' ? Date.parse(visit.createdAt) : NaN;
    if (latest && Number.isFinite(timestamp) && Number.isFinite(latest.timestamp)
      && (timestamp < latest.timestamp || (timestamp === latest.timestamp && index < latest.index))) return;
    latest = { value: visit.feedback.comfort, source: 'gameplay', name: SOURCES[visit.gameId].name, timestamp, index };
  });
  return latest ?? { value: 'any', source: 'unknown' };
}

export function deriveInterests(profile, preferences = {}) {
  const prefs = sanitizePreferences(preferences);
  const latest = latestExperiences(profile);
  return TAG_IDS.flatMap(id => {
    const label = labelFor(id);
    if (prefs.interests.includes(id)) return [{
      id, label, value: 2, source: 'manual', evidence: `你主动选择了「${label}」。`,
    }];
    const experience = latest.get(id);
    if (!experience) return [];
    return [{
      id, label,
      value: experience.rating >= 4 ? 1 : experience.rating <= 2 ? -1 : 0,
      source: 'gameplay',
      evidence: `你最近一次将${experience.name}的乐趣评为 ${experience.rating}/5。`,
    }];
  });
}

function normalizeGame(value) {
  if (!isRecord(value) || !safeId(value.id) || !cleanText(value.title)) return null;
  const tags = cleanTags(value.tags);
  const modes = Array.isArray(value.modes) ? [...new Set(value.modes.filter(mode => MODES.has(mode) && mode !== 'any'))] : [];
  if (!tags.length || !modes.length) return null;
  let storeUrl;
  try {
    const url = new URL(value.storeUrl);
    if (url.protocol !== 'https:') return null;
    storeUrl = url.href;
  } catch { return null; }
  return {
    id: value.id, title: cleanText(value.title), category: cleanText(value.category) || '其他玩法', tags, modes,
    intensity: INTENSITIES.has(value.intensity) ? value.intensity : 'balanced',
    requiresVR: value.requiresVR === true, requiresPartner: value.requiresPartner === true, storeUrl,
    entryTip: cleanText(value.entryTip),
    cautions: Array.isArray(value.cautions) ? value.cautions.map(cleanText).filter(Boolean).slice(0, 8) : [],
    sourceCheckedAt: cleanText(value.sourceCheckedAt), tagBasis: cleanText(value.tagBasis),
  };
}

function isEligible(game, prefs) {
  if (game.requiresVR && !prefs.hasVR) return false;
  if (game.requiresPartner && !prefs.hasPartner) return false;
  if (game.tags.includes('horror') && !prefs.allowHorror) return false;
  if (game.tags.some(tag => prefs.excludedTags.includes(tag))) return false;
  if (['dislike', 'played'].includes(prefs.feedback[game.id])) return false;
  if (prefs.playMode !== 'any' && !game.modes.includes(prefs.playMode)) return false;
  if (!prefs.hasPartner && game.modes.every(mode => mode === 'coop')) return false;
  if (prefs.playMode === 'coop' && !prefs.hasPartner) return false;
  return true;
}

function comfortScore(game, comfort) {
  if (comfort.value === 'any') return 0;
  if (game.intensity === comfort.value) return 6;
  if ([game.intensity, comfort.value].includes('balanced')) return 0;
  return -6;
}

function makeRecommendation(item, index, firstCategory, prefs, experiences, comfort) {
  const { game, matches, negatives, wanted } = item;
  const reasons = matches.slice(0, 3).map(interest => interest.evidence);
  if (wanted) reasons.unshift('你把这款游戏标记为「想玩」。');
  const supported = matches.length > 0 || wanted;
  if (!supported) reasons.push('你还没有对这款游戏的主要玩法给出明确喜好；这是一次探索推荐，不是适合度判断。');
  else if (matches.length) reasons.push(`它包含「${matches.map(match => match.label).join('、')}」体验，可作为下一次尝试。`);
  if (negatives.length) reasons.push(`你此前对「${negatives.map(interest => interest.label).join('、')}」的乐趣评价较低；本项仅因其他明确兴趣保留，你可以跳过。`);
  if (comfort.value !== 'any' && game.intensity === comfort.value) {
    const label = { gentle: '轻松', balanced: '适中', intense: '挑战' }[comfort.value];
    const source = comfort.source === 'gameplay'
      ? `你在最近一次有效的${comfort.name}游玩反馈中选择了${label}体验`
      : `你在推荐设置中选择了${label}体验`;
    reasons.push(`${source}，这款游戏的人工强度标签与之接近。`);
  }
  let selectedMode = prefs.playMode;
  if (selectedMode === 'any') selectedMode = game.modes.includes('solo') ? 'solo'
    : game.modes.includes('coop') && prefs.hasPartner ? 'coop' : game.modes[0];
  if (selectedMode === 'solo' && game.modes.includes('coop') && !prefs.hasPartner) {
    reasons.push('它支持单人体验；当前按单人入口推荐，不要求你先找同伴。');
  }
  let entryTip = game.entryTip;
  // Performance affects advice only, never ranking. Do not borrow a low score
  // from an unrelated minigame or infer broad talent from this short trial.
  const practice = matches.find(match => ['shooting', 'driving'].includes(match.id)
    && experiences.get(match.id)?.score >= 0 && experiences.get(match.id)?.score < 55);
  if (practice) entryTip += `${entryTip ? ' ' : ''}本次${experiences.get(practice.id).name}操作仍可练习；这不影响你喜欢这种玩法，建议先熟悉基础操作。`;
  return {
    ...game, reasons, entryTip, selectedMode,
    confidence: supported ? '初步线索' : '探索推荐',
    kind: !supported ? '探索推荐' : index > 0 && game.category !== firstCategory ? '换种体验' : '兴趣匹配',
  };
}

export function recommendGames(profile, preferences = {}, catalog = MARKET_GAMES, limit = 3) {
  const prefs = sanitizePreferences(preferences);
  const count = Number.isInteger(limit) ? Math.min(3, Math.max(0, limit)) : 3;
  if (!count || !Array.isArray(catalog)) return [];
  const interests = deriveInterests(profile, prefs);
  const experiences = latestExperiences(profile);
  const comfort = resolveComfort(profile, prefs);
  const seen = new Set();
  const candidates = catalog.flatMap((raw, order) => {
    const game = normalizeGame(raw);
    if (!game || seen.has(game.id)) return [];
    seen.add(game.id);
    if (!isEligible(game, prefs)) return [];
    const matches = interests.filter(interest => interest.value > 0 && game.tags.includes(interest.id));
    const negatives = interests.filter(interest => interest.value < 0 && game.tags.includes(interest.id));
    const wanted = prefs.feedback[game.id] === 'want';
    // Do not fill empty slots with a disliked experience solely because there
    // is no other evidence. Another positive tag or an explicit wish can still
    // justify a mixed recommendation; a later/manual preference corrects it.
    if (negatives.length && !matches.length && !wanted) return [];
    const rank = matches.reduce((sum, interest) => sum + interest.value * 100, 0)
      - negatives.length * 120 + (wanted ? 220 : 0) + comfortScore(game, comfort);
    return [{ game, matches, negatives, wanted, rank, order }];
  }).sort((a, b) => b.rank - a.rank || a.order - b.order);

  const selected = [];
  while (selected.length < count && candidates.length) {
    let nextIndex = 0;
    if (selected.length === 1) {
      // A small diversity tie-break must not outrank a strong explicit liking.
      const adjusted = item => item.rank - (item.game.category === selected[0].game.category ? 12 : 0);
      nextIndex = candidates.reduce((best, item, index) => adjusted(item) > adjusted(candidates[best]) ? index : best, 0);
    } else if (selected.length === 2 && selected.every(item => item.game.category === selected[0].game.category)) {
      // Keep the first two strong matches, then offer one safe different kind
      // where available. Never cross hard filters or a negative preference.
      const different = candidates.findIndex(item => item.game.category !== selected[0].game.category && !item.negatives.length);
      if (different >= 0) nextIndex = different;
    }
    selected.push(candidates.splice(nextIndex, 1)[0]);
  }
  return selected.map((item, index) => makeRecommendation(item, index, selected[0]?.game.category, prefs, experiences, comfort));
}
