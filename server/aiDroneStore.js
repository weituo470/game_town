import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { AI_DRONE_CHOICE_FIELDS, AI_DRONE_LIMITS as SCORE_LIMITS } from '../shared/aiDroneScore.js';
import { AI_DRONE_V2_CHOICE_FIELDS } from '../shared/aiDroneScoreV2.js';

export const AI_DRONE_DEFAULT_LIMITS = Object.freeze({ daily: 5, ipMinute: 3, ipDaily: 30, concurrent: 2, guestConcurrent: 1 });
export const AI_DRONE_FAILURE_PHASES = Object.freeze(['provider_request', 'provider_body', 'provider_output', 'score_json', 'score_schema', 'storage', 'lifecycle', 'unknown']);
export const AI_DRONE_FAILURE_REASONS = Object.freeze([
  'provider_http', 'provider_network', 'provider_body_failed', 'invalid_provider_json', 'response_too_large',
  'finish_length', 'finish_content_filter', 'finish_other', 'message_missing', 'content_missing', 'unsupported_tools',
  'invalid_json', 'schema_invalid', 'timeout', 'cancelled', 'interrupted', 'lease_expired', 'storage_failure', 'unknown',
  'AI_SCORE_FORMAT', 'AI_SCORE_FIELDS', 'AI_SCORE_TEXT', 'AI_SCORE_CHOICE', 'AI_SCORE_COLOR', 'AI_SCORE_OUTLINE',
  'AI_SCORE_TOO_LARGE', 'AI_SCORE_JSON', 'AI_SCORE_VERSION', 'AI_SCORE_SEED', 'AI_SCORE_SCENES', 'AI_SCORE_DURATION',
  'AI_SCORE_CAST', 'AI_SCORE_ACTORS', 'AI_SCORE_LAYOUT', 'AI_SCORE_SCALE', 'AI_SCORE_QUALITY',
]);
/** Fixed enums and numbers only: never echo a provider string into diagnostics. */
export function sanitizeAiDroneFailureMetadata(value) {
  return { phase: AI_DRONE_FAILURE_PHASES.includes(value?.phase) ? value.phase : 'unknown',
    reason: AI_DRONE_FAILURE_REASONS.includes(value?.reason) ? value.reason : 'unknown',
    ...(value?.reason === 'AI_SCORE_CHOICE' && [...AI_DRONE_CHOICE_FIELDS, ...AI_DRONE_V2_CHOICE_FIELDS].includes(value?.field) && Number.isSafeInteger(value?.sceneIndex) && value.sceneIndex >= 0 && value.sceneIndex < SCORE_LIMITS.maxScenes
      ? { field: value.field, sceneIndex: value.sceneIndex } : {}),
    ...(Number.isSafeInteger(value?.finishedAt) && value.finishedAt >= 0 ? { finishedAt: value.finishedAt } : {}),
    ...(Number.isSafeInteger(value?.durationMs) && value.durationMs >= 0 ? { durationMs: value.durationMs } : {}) };
}
const FAILURE_MESSAGES = Object.freeze({
  AI_DRONE_UPSTREAM: { status: 502, message: 'AI 编导暂时未完成，请稍后再试；不会自动重试本次请求。' },
  AI_DRONE_INVALID_SCORE: { status: 502, message: 'AI 返回的编排未通过安全校验，未启动演出；不会自动重试。' },
  AI_DRONE_QUALITY_FAILED: { status: 502, message: '本次编排缺少足够的场景层次或故事连续性，尚未达到舞台质量门槛；未启动演出，不会自动重试。' },
  AI_DRONE_TIMEOUT: { status: 504, message: 'AI 编导超过45秒未完成；不会自动重试，请稍后再试。' },
  AI_DRONE_CANCELLED: { status: 499, message: '此次编排已取消；不会自动重试已开始的请求。' },
  AI_DRONE_INTERRUPTED: { status: 503, message: '编导服务正在重启；同一请求不会重复调用模型。' },
});
const DAY = 86_400_000;
const OFFSET = 8 * 60 * 60 * 1000;
export function aiDroneDay(time) {
  const index = Math.floor((time + OFFSET) / DAY);
  return { key: String(index), start: index * DAY - OFFSET, resetAt: (index + 1) * DAY - OFFSET };
}
export class AiDroneStoreError extends Error {
  constructor(status, code, message) { super(message); this.name = 'AiDroneStoreError'; this.status = status; this.code = code; this.charged = false; }
}
const interrupted = Object.freeze({ status: 503, code: 'AI_DRONE_INTERRUPTED', message: '编导请求已中断；同一请求不会再次调用模型。', charged: true });

/** Atomic, persistent reservations: once claimed, one request ID can never call the provider again. */
export function createAiDroneStore({ dbPath = '.data/ai-drone.sqlite', db, now = Date.now, limits = AI_DRONE_DEFAULT_LIMITS } = {}) {
  const settings = { ...AI_DRONE_DEFAULT_LIMITS, ...limits };
  for (const key of Object.keys(AI_DRONE_DEFAULT_LIMITS)) {
    const minimum = key === 'daily' || key === 'ipDaily' ? 0 : 1;
    if (!Number.isSafeInteger(settings[key]) || settings[key] < minimum || Object.is(settings[key], -0)) throw new Error('Invalid AI director quota configuration.');
  }
  const ownDb = !db;
  if (!db) {
    if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
    db = new DatabaseSync(dbPath === ':memory:' ? dbPath : resolve(dbPath));
  }
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS ai_drone_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_drone_requests (
      guest_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      day TEXT NOT NULL, ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL, lease_until INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','done','failed')), result TEXT, error TEXT,
      PRIMARY KEY (guest_id, request_id));
    CREATE INDEX IF NOT EXISTS ai_drone_guest_day ON ai_drone_requests(guest_id,day);
    CREATE INDEX IF NOT EXISTS ai_drone_ip_time ON ai_drone_requests(ip_hash,created_at);
    CREATE INDEX IF NOT EXISTS ai_drone_pending ON ai_drone_requests(state,lease_until);`);
  db.prepare('INSERT OR IGNORE INTO ai_drone_metadata(key,value) VALUES (?,?)').run('ip-salt', randomBytes(32).toString('hex'));
  const salt = db.prepare('SELECT value FROM ai_drone_metadata WHERE key=?').get('ip-salt').value;
  let closed = false;
  const checkOpen = () => { if (closed) throw new Error('AI director store is closed.'); };
  function usage(guestId, time = now()) {
    checkOpen();
    const day = aiDroneDay(time);
    const used = Number(db.prepare('SELECT count(*) AS n FROM ai_drone_requests WHERE guest_id=? AND day=?').get(guestId, day.key).n);
    return settings.daily === 0
      ? { unlimited: true, limit: null, remaining: null, used, resetAt: day.resetAt }
      : { limit: settings.daily, used, remaining: Math.max(0, settings.daily - used), resetAt: day.resetAt };
  }
  function request(guestId, requestId, time = now()) {
    checkOpen();
    let row = db.prepare('SELECT * FROM ai_drone_requests WHERE guest_id=? AND request_id=?').get(guestId, requestId);
    if (row?.state === 'pending' && row.lease_until <= time) {
      const error = { ...interrupted, phase: 'lifecycle', reason: 'lease_expired', finishedAt: time, durationMs: Math.max(0, time - row.created_at) };
      db.prepare("UPDATE ai_drone_requests SET state='failed',error=? WHERE guest_id=? AND request_id=? AND state='pending'").run(JSON.stringify(error), guestId, requestId);
      row = db.prepare('SELECT * FROM ai_drone_requests WHERE guest_id=? AND request_id=?').get(guestId, requestId);
    }
    if (!row) return null;
    let error = row.error ? JSON.parse(row.error) : null;
    // Old finite-mode failures may mention a deducted allowance. Keep the audit
    // row intact, but project fixed neutral messages after opting into unlimited.
    if (error && settings.daily === 0) {
      const code = Object.hasOwn(FAILURE_MESSAGES, error.code) ? error.code : 'AI_DRONE_UPSTREAM';
      error = { ...FAILURE_MESSAGES[code], code, charged: true, ...sanitizeAiDroneFailureMetadata(error) };
    }
    return { state: row.state, fingerprint: row.fingerprint, result: row.result ? JSON.parse(row.result) : null, error };
  }
  function reserve({ guestId, requestId, fingerprint, ip, timeoutMs = 45_000 }) {
    checkOpen();
    const time = now(), day = aiDroneDay(time);
    const ipHash = createHmac('sha256', salt).update(ip).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      const prior = request(guestId, requestId, time);
      if (prior) { db.exec('COMMIT'); return { prior, usage: usage(guestId, time) }; }
      const count = (sql, ...args) => Number(db.prepare(sql).get(...args).n);
      if (settings.daily !== 0 && usage(guestId, time).remaining < 1) throw new AiDroneStoreError(429, 'AI_DRONE_DAILY_LIMIT', '今天的 AI 编导额度已用完，北京时间零点恢复。');
      if (settings.ipDaily !== 0 && count('SELECT count(*) AS n FROM ai_drone_requests WHERE ip_hash=? AND created_at>=?', ipHash, day.start) >= settings.ipDaily) throw new AiDroneStoreError(429, 'AI_DRONE_IP_DAILY_LIMIT', '当前网络今天的 AI 编导请求较多，请明天再试。');
      if (count('SELECT count(*) AS n FROM ai_drone_requests WHERE ip_hash=? AND created_at>?', ipHash, time - 60_000) >= settings.ipMinute) throw new AiDroneStoreError(429, 'AI_DRONE_IP_RATE_LIMIT', '当前网络请求较快，请一分钟后再试。');
      if (count("SELECT count(*) AS n FROM ai_drone_requests WHERE guest_id=? AND state='pending' AND lease_until>?", guestId, time) >= settings.guestConcurrent) throw new AiDroneStoreError(429, 'AI_DRONE_IN_FLIGHT', '请等待你正在编排的演出完成。');
      if (count("SELECT count(*) AS n FROM ai_drone_requests WHERE state='pending' AND lease_until>?", time) >= settings.concurrent) throw new AiDroneStoreError(503, 'AI_DRONE_CAPACITY', 'AI 编导正在服务其他观众，请稍后再试。');
      db.prepare("INSERT INTO ai_drone_requests(guest_id,request_id,fingerprint,day,ip_hash,created_at,lease_until,state) VALUES (?,?,?,?,?,?,?,'pending')").run(guestId, requestId, fingerprint, day.key, ipHash, time, time + timeoutMs + 5000);
      db.exec('COMMIT');
      return { prior: null, usage: usage(guestId, time) };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function complete(guestId, requestId, result) {
    checkOpen();
    db.prepare("UPDATE ai_drone_requests SET state='done',result=? WHERE guest_id=? AND request_id=? AND state='pending'").run(JSON.stringify(result), guestId, requestId);
  }
  function fail(guestId, requestId, error) {
    checkOpen();
    const row = db.prepare('SELECT created_at FROM ai_drone_requests WHERE guest_id=? AND request_id=?').get(guestId, requestId);
    const code = Object.hasOwn(FAILURE_MESSAGES, error?.code) ? error.code : 'AI_DRONE_UPSTREAM';
    const diagnostic = sanitizeAiDroneFailureMetadata(error);
    const finishedAt = diagnostic.finishedAt ?? now();
    const safe = { ...FAILURE_MESSAGES[code], code, charged: true, ...diagnostic,
      finishedAt, durationMs: Math.max(0, finishedAt - (row?.created_at ?? finishedAt)) };
    db.prepare("UPDATE ai_drone_requests SET state='failed',error=? WHERE guest_id=? AND request_id=? AND state='pending'").run(JSON.stringify(safe), guestId, requestId);
    return safe;
  }
  return { usage, request, reserve, complete, fail, close() { if (closed) return; closed = true; if (ownDb) db.close(); } };
}
