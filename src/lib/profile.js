import { GAMES } from './catalog.js';

// Deliberately local-only: no network requests, analytics, identity or diagnoses.
export const STORAGE_KEY = 'game-town.profile.v1';
const VERSION = 1;
const MAX_VISITS = 40;
const GAME_IDS = new Set(GAMES.map(game => game.id));
const COMFORTS = new Set(['gentle', 'balanced', 'intense']);
const cleanText = (value, limit = 240) => typeof value === 'string' ? value.slice(0, limit) : '';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const emptyProfile = () => ({ version: VERSION, visits: [], dismissed: [] });

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function sanitizeMetrics(value) {
  const metrics = {};
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value).slice(0, 30)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      if (typeof item === 'string') metrics[key] = cleanText(item);
      else if (finite(item)) metrics[key] = clamp(item, -1e9, 1e9);
      else if (typeof item === 'boolean') metrics[key] = item;
    }
  }
  metrics.summary = cleanText(metrics.summary) || '本次游玩记录';
  return metrics;
}

function sanitizeFeedback(value) {
  const source = isRecord(value) ? value : {};
  return {
    enjoyment: Number.isInteger(source.enjoyment) && source.enjoyment >= 1 && source.enjoyment <= 5 ? source.enjoyment : null,
    wantsMore: typeof source.wantsMore === 'boolean' ? source.wantsMore : null,
    comfort: COMFORTS.has(source.comfort) ? source.comfort : null,
  };
}

function sanitizeVisit(value, index = 0) {
  if (!isRecord(value) || !GAME_IDS.has(value.gameId) || !finite(value.score) || typeof value.completed !== 'boolean') return null;
  const stamp = typeof value.createdAt === 'string' ? Date.parse(value.createdAt) : NaN;
  return {
    id: cleanText(value.id, 80) || `restored-${index}`,
    gameId: value.gameId,
    score: Math.round(clamp(value.score, 0, 100) * 10) / 10,
    completed: value.completed,
    metrics: sanitizeMetrics(value.metrics),
    durationSeconds: finite(value.durationSeconds) ? Math.round(clamp(value.durationSeconds, 0, 86400) * 10) / 10 : 0,
    inputDevice: cleanText(value.inputDevice, 40) || 'unknown',
    difficulty: cleanText(value.difficulty, 40) || 'standard',
    feedback: sanitizeFeedback(value.feedback),
    createdAt: Number.isFinite(stamp) ? new Date(stamp).toISOString() : '1970-01-01T00:00:00.000Z',
  };
}

function sanitizeProfile(value) {
  if (!isRecord(value) || value.version !== VERSION || !Array.isArray(value.visits)) return emptyProfile();
  return {
    version: VERSION,
    visits: value.visits.slice(-MAX_VISITS).map(sanitizeVisit).filter(Boolean),
    dismissed: Array.isArray(value.dismissed)
      ? [...new Set(value.dismissed.filter(item => typeof item === 'string' && /^[a-z0-9-]{1,80}$/.test(item)))].slice(-80)
      : [],
  };
}

export function loadProfile(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw || raw.length > 500000) return emptyProfile();
    return sanitizeProfile(JSON.parse(raw));
  } catch { return emptyProfile(); }
}

export function saveProfile(profile, storage = defaultStorage()) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitizeProfile(profile)));
    return true;
  } catch { return false; }
}

export function clearProfile(storage = defaultStorage()) {
  try {
    if (!storage || typeof storage.removeItem !== 'function') return false;
    // Never clear unrelated applications' data on the same origin.
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch { return false; }
}

export function addVisit(profile, result, feedback) {
  const clean = sanitizeProfile(profile);
  const visit = sanitizeVisit({
    ...(isRecord(result) ? result : {}),
    feedback,
    id: `visit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
  });
  if (!visit) return clean;
  return { ...clean, visits: [...clean.visits, visit].slice(-MAX_VISITS) };
}

function completedVisits(profile, gameId) {
  return profile.visits.filter(visit => visit.completed && visit.gameId === gameId);
}

function latestFeedback(visits) {
  return [...visits].reverse().find(visit => visit.feedback.enjoyment !== null)?.feedback ?? null;
}

export function getDimensions(profile) {
  const clean = sanitizeProfile(profile);
  return GAMES.map(game => {
    const visits = completedVisits(clean, game.id);
    const recent = visits.slice(-5);
    return {
      gameId: game.id,
      label: game.category,
      score: recent.length ? Math.round(recent.reduce((sum, visit) => sum + visit.score, 0) / recent.length) : null,
      plays: visits.length,
      enjoyment: latestFeedback(visits)?.enjoyment ?? null,
    };
  });
}

export function getCompletion(profile) {
  return getDimensions(profile).filter(dimension => dimension.plays > 0).length;
}

function preferredType(gameId, comfort, score) {
  const beginner = score < 55;
  switch (gameId) {
    case 'balloons':
      return {
        title: comfort === 'intense' && !beginner ? '快节奏动作射击' : '轻松合作射击',
        description: beginner
          ? '你喜欢瞄准的过程。可以从新手难度、辅助瞄准或合作练习开始，不必因一局分数放弃喜欢的玩法。'
          : comfort === 'intense'
            ? '可以试试节奏更快的射击闯关，先从普通难度感受操作与压力，再决定是否增加挑战。'
            : '可以试试低压力的合作闯关射击，把瞄准的乐趣放在前面，不必直接进入排位竞技。',
      };
    case 'haunted':
      return {
        title: comfort === 'intense' ? '悬疑与恐怖探索' : '轻悬疑叙事探索',
        description: comfort === 'intense'
          ? '可以尝试有内容警告、可调音量和随时退出选项的悬疑探索；这间小屋不能预测你对更强恐怖内容的反应。'
          : '优先试试没有突然惊吓、氛围柔和的寻物和叙事探索。是否喜欢恐怖题材，仍由你自己决定。',
      };
    case 'rhythm':
      return {
        title: comfort === 'intense' && !beginner ? '节拍挑战游戏' : '休闲音乐节奏',
        description: beginner
          ? '从慢速、少按键或练习模式开始，先享受音乐。设备延迟会影响本次表现，低分不等于不适合。'
          : '可以试试音乐节奏类游戏，按喜欢的曲风选择；先熟悉节拍，再逐步提高速度和难度。',
      };
    default:
      return {
        title: comfort === 'intense' && !beginner ? '机关与策略解谜' : '轻松机关解谜',
        description: beginner
          ? '可以从带提示、无时间限制的机关解谜开始。喜欢思考的过程，比这次用了多久更重要。'
          : '可以试试机关、路径或逻辑解谜，优先选择有撤销和提示的作品，再按体验增加难度。',
      };
  }
}

export function getRecommendations(profile) {
  const clean = sanitizeProfile(profile);
  const dimensions = getDimensions(clean);
  const preferred = [];
  const discoveries = [];
  for (const game of GAMES) {
    const visits = completedVisits(clean, game.id);
    const dimension = dimensions.find(item => item.gameId === game.id);
    const feedback = latestFeedback(visits);
    if (!visits.length) {
      discoveries.push({
        id: `${game.id}-discovery`,
        title: `去试试${game.name}`,
        description: '这是一条探索建议，不是适合度判断。完成一局，再告诉小镇你是否享受这个过程。',
        reasons: [`你还没有完成${game.name}，目前没有足够的体验记录。`],
        confidence: '初步线索',
        gameId: game.id,
      });
      continue;
    }
    // A high score alone is never evidence of preference. Latest explicit
    // enjoyment corrects earlier feedback instead of averaging away a dislike.
    if (!feedback || feedback.enjoyment <= 2 || (feedback.enjoyment === 3 && feedback.wantsMore !== true)) continue;
    const reasons = [`你最近一次将${game.name}的乐趣评为 ${feedback.enjoyment}/5。`];
    if (feedback.wantsMore === true) reasons.push('你表示愿意再玩一次。');
    if (feedback.comfort === 'gentle') reasons.push('你选择了轻松的体验强度，所以优先推荐低压力玩法。');
    if (feedback.comfort === 'intense') reasons.push('你表示愿意尝试更强的体验；你仍可随时降低难度或退出。');
    if (game.id !== 'haunted') reasons.push(`近 ${Math.min(visits.length, 5)} 局本项目平均 ${dimension.score}/100；它只用于建议起步难度，不是固定能力判断。`);
    const stablePositive = visits.filter(visit => visit.feedback.enjoyment !== null).slice(-3);
    preferred.push({
      id: `${game.id}-preference`,
      ...preferredType(game.id, feedback.comfort, dimension.score),
      reasons,
      confidence: stablePositive.length === 3 && stablePositive.every(visit => visit.feedback.enjoyment >= 4) ? '更多线索' : '初步线索',
      gameId: game.id,
      // Enjoyment dominates ranking; performance does not rank preferences.
      rank: feedback.enjoyment * 10 + (feedback.wantsMore === true ? 2 : 0),
    });
  }
  return [...preferred.sort((a, b) => b.rank - a.rank), ...discoveries]
    .filter(recommendation => !clean.dismissed.includes(recommendation.id))
    .slice(0, 4)
    .map(({ rank, ...recommendation }) => recommendation);
}
