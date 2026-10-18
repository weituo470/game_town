import { DatabaseSync } from 'node:sqlite';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { INPUT_BYTES, OUTPUT_BYTES, digest, normalizeImage, GameImageMediaError } from './media.js';
import { STYLES, PROMPT_VERSION, IMAGE_MODEL, buildGameImagePrompt } from './prompts.js';
import { createGameImageBridgeProvider } from './provider.js';
export { loadGameImageConfig } from './config.js';

export const GAME_IMAGE_COOKIE = 'game_town_images_v1';
export const GAME_IMAGE_DEFAULTS = Object.freeze({ dailyBudget: 0, totalBudget: 50, ownerDailyBudget: 2, maxQueue: 8, maxOwnerPending: 1,
  maxStorageBytes: 128 * 1024 * 1024, maxOwnerStorageBytes: 24 * 1024 * 1024, maxInputAssets: 8,
  maxJobs: 5000, maxSessions: 1000, inputTtlMs: 24 * 60 * 60_000, outputTtlMs: 7 * 24 * 60 * 60_000,
  sessionTtlMs: 7 * 24 * 60 * 60_000, providerTimeoutMs: 1070_000, lookupTimeoutMs: 45_000,
  recoveryWindowMs: 20 * 60_000, lookupIntervalMs: 60_000, maxLookups: 24, maintenanceIntervalMs: 15_000 });
const PREFIX = '/api/game-images';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminal = new Set(['succeeded', 'failed', 'outcome_unknown', 'deleted']);
const modelPattern = /^[A-Za-z0-9._:/-]{1,120}$/;
class RequestError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const fail = (status, code, message) => new RequestError(status, code, message);
const hashToken = token => digest(Buffer.from(token));
const json = (res, status, body) => { if (res.destroyed || res.writableEnded) return; res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };
const keysExactly = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

async function readJson(req, limit = 4096) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'JSON_REQUIRED', '请使用 JSON 请求。');
  if (Number(req.headers['content-length']) > limit) { req.resume(); throw fail(413, 'UPLOAD_TOO_LARGE', '上传内容过大。'); }
  const chunks = []; let size = 0;
  try {
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail(413, 'UPLOAD_TOO_LARGE', '上传内容过大。'); chunks.push(chunk); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) { if (error instanceof RequestError) throw error; throw fail(400, 'INVALID_REQUEST', '请求内容无法识别。'); }
}

export async function takeInstanceLock(path) {
  const stamp = JSON.stringify({ pid: process.pid, instance: randomUUID() });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const file = await open(path, 'wx', 0o600); await file.writeFile(stamp); await file.close();
      return async () => { try { if (await readFile(path, 'utf8') === stamp) await unlink(path); } catch {} };
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt) throw new Error('Game image database is already in use or unavailable');
      try {
        const content = await readFile(path, 'utf8');
        if (content.length > 256) throw new Error();
        const previous = JSON.parse(content);
        if (!Number.isInteger(previous.pid) || previous.pid < 1) throw new Error();
        try { process.kill(previous.pid, 0); } catch (check) { if (check.code === 'ESRCH') { await unlink(path); continue; } }
      } catch {}
      throw new Error('Game image database is already in use or unavailable');
    }
  }
}

/** Stage 1 produces private 2D reference art only; it is NOT a rigged 3D avatar. */
export async function createGameImageModule({ config = {}, provider, dbPath, now = Date.now } = {}) {
  const settings = { ...GAME_IMAGE_DEFAULTS };
  const configurableCeilings = { dailyBudget: 100, ownerDailyBudget: 10, maxQueue: 32, maxStorageBytes: 512 * 1024 * 1024 };
  for (const key of Object.keys(settings)) if (Number.isSafeInteger(config[key]) && config[key] >= 0) settings[key] = Math.min(config[key], configurableCeilings[key] ?? GAME_IMAGE_DEFAULTS[key]);
  // Test image authorization is a cumulative 50-image ceiling, not 50/day.
  settings.totalBudget = Math.min(settings.totalBudget, 50);
  if (!provider && config.bridge) { try { provider = createGameImageBridgeProvider(config.bridge); } catch {} }
  const enabled = config.enabled === true && settings.dailyBudget > 0 && settings.totalBudget > 0 && typeof provider?.generate === 'function';
  const reason = enabled ? null : config.enabled !== true ? 'disabled' : settings.dailyBudget === 0 || settings.totalBudget === 0 ? 'budget-zero' : 'provider-unconfigured';
  const databasePath = dbPath || config.dbPath || fileURLToPath(new URL('../../.data/game-images/game-images.sqlite', import.meta.url));
  await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
  const unlock = await takeInstanceLock(`${databasePath}.lock`);
  let db;
  try { db = new DatabaseSync(databasePath); } catch { await unlock(); throw new Error('Game image storage unavailable'); }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000; PRAGMA journal_size_limit=16777216;
    CREATE TABLE IF NOT EXISTS owners(id TEXT PRIMARY KEY, selected_asset_id TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, bytes BLOB NOT NULL, mime TEXT NOT NULL,
      sha256 TEXT NOT NULL,pixel_hash TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS assets_owner ON assets(owner_id);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,client_key TEXT NOT NULL,body_hash TEXT NOT NULL,input_asset_id TEXT NOT NULL,
      input_hash TEXT NOT NULL,input_pixel_hash TEXT NOT NULL,style_id TEXT NOT NULL,prompt_version INTEGER NOT NULL,scene_seed TEXT NOT NULL,prompt TEXT NOT NULL,
      status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,output_asset_id TEXT,error_code TEXT,
      requested_model TEXT NOT NULL,returned_model TEXT,dispatch_count INTEGER NOT NULL DEFAULT 0,dispatched_at INTEGER,
      lookup_count INTEGER NOT NULL DEFAULT 0,next_lookup_at INTEGER,recovery_deadline INTEGER,UNIQUE(owner_id,client_key));
    CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner_id,created_at);
    CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,created_at);
    CREATE TABLE IF NOT EXISTS daily_usage(day TEXT NOT NULL,owner_id TEXT NOT NULL,used INTEGER NOT NULL,PRIMARY KEY(day,owner_id));`);
  let closed = false, closing = false, work = null, currentAbort = null, decodes = 0;
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const count = (sql, ...params) => Number(one(sql, ...params)?.n || 0);
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  run("UPDATE jobs SET status='outcome_unknown',error_code='RESTARTED_OUTCOME_UNKNOWN',updated_at=?,next_lookup_at=? WHERE status='running'", now(), now());

  function publicJob(row) {
    return { id: row.id, status: row.status, styleId: row.style_id, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
      ...(row.status === 'queued' ? { queuePosition: count("SELECT COUNT(*) n FROM jobs WHERE status='queued' AND (created_at < ? OR (created_at=? AND rowid <= (SELECT rowid FROM jobs WHERE id=?)))", row.created_at, row.created_at, row.id) } : {}),
      ...(row.output_asset_id && row.status === 'succeeded' ? { outputAssetId: row.output_asset_id } : {}),
      ...(row.error_code ? { errorCode: row.error_code } : {}), requestedModel: row.requested_model, ...(row.returned_model ? { returnedModel: row.returned_model } : {}) };
  }
  function mine(ownerId) { return { jobs: all('SELECT * FROM jobs WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100', ownerId).map(publicJob), selectedAssetId: one('SELECT selected_asset_id FROM owners WHERE id=?', ownerId)?.selected_asset_id || null }; }
  function getSession(req) {
    const cookie = req.headers.cookie || '';
    if (cookie.length > 4096) return null;
    const values = cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(`${GAME_IMAGE_COOKIE}=`));
    if (values.length !== 1) return null;
    const token = values[0].slice(GAME_IMAGE_COOKIE.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return one('SELECT owner_id FROM sessions WHERE token_hash=? AND expires_at>?', hashToken(token), now())?.owner_id || null;
  }
  function requireSession(req) { const owner = getSession(req); if (!owner) throw fail(401, 'IMAGE_SESSION_REQUIRED', '请重新打开人物工坊后再试。'); return owner; }
  function bootstrap(req, res) {
    let owner = getSession(req);
    if (!owner) {
      if (count('SELECT COUNT(*) n FROM sessions') >= settings.maxSessions) throw fail(503, 'STUDIO_BUSY', '人物工坊暂时较忙，请稍后再试。');
      const token = randomBytes(32).toString('base64url'); owner = randomUUID();
      transaction(() => { run('INSERT INTO owners(id,created_at) VALUES(?,?)', owner, now()); run('INSERT INTO sessions VALUES(?,?,?)', hashToken(token), owner, now() + settings.sessionTtlMs); });
      res.setHeader('Set-Cookie', `${GAME_IMAGE_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(settings.sessionTtlMs / 1000)}${config.secureCookie === true || req.socket.encrypted ? '; Secure' : ''}`);
    }
    return { enabled, reason, styles: STYLES, maxUploadBytes: INPUT_BYTES, outputKind: '2d', ...mine(owner) };
  }
  function assertEnabled() { if (!enabled) throw fail(503, 'GAME_IMAGES_DISABLED', '人物参考图生成尚未启用，目前不会上传照片或发起生成。'); }
  function asset(owner, id) { const row = UUID.test(id || '') && one('SELECT * FROM assets WHERE id=? AND owner_id=? AND expires_at>?', id, owner, now()); if (!row) throw fail(404, 'ASSET_NOT_FOUND', '图片已过期或不存在。'); return row; }
  function ownedJob(owner, id) { const row = UUID.test(id || '') && one('SELECT * FROM jobs WHERE id=? AND owner_id=?', id, owner); if (!row) throw fail(404, 'JOB_NOT_FOUND', '未找到这项任务。'); return row; }
  function storageAvailable(owner, adding, reserve = 0) {
    const total = count('SELECT COALESCE(SUM(length(bytes)),0) n FROM assets');
    const ownerTotal = count('SELECT COALESCE(SUM(length(bytes)),0) n FROM assets WHERE owner_id=?', owner);
    const pending = count("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')");
    const ownerPending = count("SELECT COUNT(*) n FROM jobs WHERE owner_id=? AND status IN ('queued','running')", owner);
    if (total + adding + pending * OUTPUT_BYTES + reserve > settings.maxStorageBytes || ownerTotal + adding + ownerPending * OUTPUT_BYTES + reserve > settings.maxOwnerStorageBytes) throw fail(429, 'IMAGE_STORAGE_FULL', '图片空间暂时不足，请先删除不需要的作品。');
  }
  async function normalize(value, options) {
    if (decodes >= 2) throw fail(429, 'IMAGE_PROCESSING_BUSY', '正在处理其他图片，请稍后再试。');
    decodes += 1;
    try { return await normalizeImage(value, options); }
    finally { decodes -= 1; }
  }
  function insertAsset(owner, kind, image) {
    const id = randomUUID();
    run('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?)', id, owner, kind, image.buffer, image.mime, image.sha256, image.pixelHash, image.width, image.height, now(), now() + (kind === 'input' ? settings.inputTtlMs : settings.outputTtlMs));
    return id;
  }
  function deleteAsset(id) {
    run('UPDATE owners SET selected_asset_id=NULL WHERE selected_asset_id=?', id);
    run('DELETE FROM assets WHERE id=?', id);
  }
  function maintain() {
    if (closing || closed) return;
    transaction(() => {
      run('DELETE FROM sessions WHERE expires_at<=?', now());
      for (const row of all('SELECT id,kind FROM assets WHERE expires_at<=?', now())) {
        if (row.kind === 'input' && count("SELECT COUNT(*) n FROM jobs WHERE input_asset_id=? AND status IN ('queued','running')", row.id)) continue;
        if (row.kind === 'output') run("UPDATE jobs SET status='deleted',output_asset_id=NULL,error_code='ARTWORK_EXPIRED',updated_at=? WHERE output_asset_id=?", now(), row.id);
        deleteAsset(row.id);
      }
      // Counts remain embodied in the immutable job ledger. Old daily buckets
      // may be dropped without allowing any old client key or dispatch again.
      run('DELETE FROM daily_usage WHERE day<?', new Date(now() - 32 * 24 * 60 * 60_000).toISOString().slice(0, 10));
      run('DELETE FROM owners WHERE id NOT IN (SELECT owner_id FROM sessions) AND id NOT IN (SELECT owner_id FROM jobs) AND id NOT IN (SELECT owner_id FROM assets)');
    });
    db.exec('PRAGMA wal_checkpoint(PASSIVE)'); kick();
  }

  async function boundedCall(fn, timeoutMs) {
    const controller = new AbortController(); currentAbort = controller;
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = () => rejectAbort(new Error('OUTCOME_UNKNOWN'));
    controller.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try { return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), aborted]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); if (currentAbort === controller) currentAbort = null; }
  }
  async function saveSuccess(job, result) {
    if (!result || typeof result !== 'object' || result.requestedModel !== undefined && result.requestedModel !== job.requested_model) throw new Error('INVALID_OUTPUT');
    const returned = result.returnedModel === undefined ? 'unreported' : result.returnedModel;
    if (typeof returned !== 'string' || !modelPattern.test(returned)) throw new Error('INVALID_OUTPUT');
    const image = await normalize(result, { output: true, inputHash: job.input_hash, inputPixelHash: job.input_pixel_hash });
    if (closing) throw new Error('OUTCOME_UNKNOWN');
    transaction(() => {
      const current = one('SELECT status FROM jobs WHERE id=?', job.id);
      if (!['running', 'outcome_unknown'].includes(current?.status)) return;
      const total = count('SELECT COALESCE(SUM(length(bytes)),0) n FROM assets');
      const ownerTotal = count('SELECT COALESCE(SUM(length(bytes)),0) n FROM assets WHERE owner_id=?', job.owner_id);
      if (total + image.buffer.length > settings.maxStorageBytes || ownerTotal + image.buffer.length > settings.maxOwnerStorageBytes) throw new Error('OUTPUT_STORAGE_FULL');
      const id = insertAsset(job.owner_id, 'output', image);
      run("UPDATE jobs SET status='succeeded',output_asset_id=?,returned_model=?,error_code=NULL,updated_at=? WHERE id=?", id, returned, now(), job.id);
    });
  }
  async function dispatch(job) {
    const input = one('SELECT * FROM assets WHERE id=? AND owner_id=?', job.input_asset_id, job.owner_id);
    if (!input) { run("UPDATE jobs SET status='failed',error_code='INPUT_EXPIRED',updated_at=? WHERE id=?", now(), job.id); return; }
    // Durable reservation BEFORE external work; there is no retry path back to queued.
    transaction(() => { run("UPDATE jobs SET status='running',dispatch_count=dispatch_count+1,dispatched_at=?,updated_at=?,recovery_deadline=? WHERE id=? AND status='queued' AND dispatch_count=0", now(), now(), now() + settings.recoveryWindowMs, job.id); });
    const current = one('SELECT * FROM jobs WHERE id=?', job.id);
    if (current.status !== 'running' || current.dispatch_count !== 1) return;
    try {
      const result = await boundedCall(signal => provider.generate({ requestId: job.id, namespace: 'game-town-v1', input: { mime: 'image/png', buffer: Buffer.from(input.bytes) }, prompt: job.prompt, promptVersion: job.prompt_version, styleId: job.style_id, sceneSeed: job.scene_seed, requestedModel: job.requested_model, signal }), settings.providerTimeoutMs);
      await saveSuccess(current, result);
    } catch {
      run("UPDATE jobs SET status='outcome_unknown',error_code='OUTCOME_UNKNOWN',updated_at=?,next_lookup_at=? WHERE id=? AND status='running'", now(), now() + settings.lookupIntervalMs, job.id);
    }
  }
  async function recover(job) {
    run('UPDATE jobs SET lookup_count=lookup_count+1,next_lookup_at=? WHERE id=?', now() + settings.lookupIntervalMs, job.id);
    try {
      const value = await boundedCall(signal => provider.lookup({ requestId: job.id, namespace: 'game-town-v1', signal }), settings.lookupTimeoutMs);
      if (value?.status === 'succeeded') await saveSuccess(job, value.result);
      else if (value?.status === 'failed' && !closing) run("UPDATE jobs SET status='failed',error_code='PROVIDER_FAILED',updated_at=? WHERE id=? AND status='outcome_unknown'", now(), job.id);
      // not_found, unknown, timeout, malformed output remain ambiguous. Never generate().
    } catch {}
  }
  function kick() {
    if (closing || closed || work) return;
    work = (async () => {
      while (!closing) {
        const next = enabled && one("SELECT * FROM jobs WHERE status='queued' AND dispatch_count=0 ORDER BY created_at,rowid LIMIT 1");
        if (next) { await dispatch(next); continue; }
        const recoverable = typeof provider?.lookup === 'function' && one("SELECT * FROM jobs WHERE status='outcome_unknown' AND lookup_count<? AND next_lookup_at<=? AND recovery_deadline>=? ORDER BY next_lookup_at LIMIT 1", settings.maxLookups, now(), now());
        if (recoverable) { await recover(recoverable); continue; }
        break;
      }
    })().catch(() => {}).finally(() => { work = null; if (!closing && enabled && count("SELECT COUNT(*) n FROM jobs WHERE status='queued' AND dispatch_count=0")) queueMicrotask(kick); });
  }
  maintain();
  const timer = setInterval(maintain, Math.max(10, settings.maintenanceIntervalMs)); timer.unref?.();

  async function handle(req, res, { originAllowed = false } = {}) {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
    try {
      if (closing || closed) throw fail(503, 'STUDIO_CLOSED', '人物工坊暂时不可用。');
      if (req.method === 'POST' && (originAllowed !== true || typeof req.headers.origin !== 'string' || !/^https?:\/\//.test(req.headers.origin))) throw fail(403, 'ORIGIN_DENIED', '请从游戏小镇页面提交请求。');
      if (!['GET', 'POST'].includes(req.method)) throw fail(405, 'METHOD_NOT_ALLOWED', '不支持此操作。');
      if (path === `${PREFIX}/bootstrap` && req.method === 'GET') { maintain(); json(res, 200, bootstrap(req, res)); return true; }
      const owner = requireSession(req);
      if (path === `${PREFIX}/mine` && req.method === 'GET') { maintain(); json(res, 200, mine(owner)); return true; }
      if (path === `${PREFIX}/inputs` && req.method === 'POST') {
        assertEnabled();
        const body = await readJson(req, Math.ceil(INPUT_BYTES / 3) * 4 + 2048);
        if (!keysExactly(body, ['mime', 'data', 'consent']) || body.consent !== true) throw fail(400, 'CONSENT_REQUIRED', '请确认拥有照片使用权并同意私有处理。');
        if (count("SELECT COUNT(*) n FROM assets WHERE owner_id=? AND kind='input'", owner) >= settings.maxInputAssets) throw fail(429, 'INPUT_LIMIT', '待处理照片较多，请稍后或先删除作品。');
        const image = await normalize(body);
        const id = transaction(() => { storageAvailable(owner, image.buffer.length); return insertAsset(owner, 'input', image); });
        json(res, 201, { inputAssetId: id }); return true;
      }
      if (path === `${PREFIX}/jobs` && req.method === 'POST') {
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || !UUID.test(key)) throw fail(400, 'IDEMPOTENCY_KEY_REQUIRED', '请使用有效的任务请求编号。');
        const body = await readJson(req);
        if (!keysExactly(body, ['inputAssetId', 'styleId', 'consent']) || body.consent !== true || !UUID.test(body.inputAssetId || '') || !STYLES.some(style => style.id === body.styleId)) throw fail(400, 'INVALID_JOB', '请选取照片与受支持风格，并确认生成许可。');
        const fingerprint = digest(Buffer.from(JSON.stringify({ inputAssetId: body.inputAssetId, styleId: body.styleId, consent: true })));
        const job = transaction(() => {
          const previous = one('SELECT * FROM jobs WHERE owner_id=? AND client_key=?', owner, key.toLowerCase());
          if (previous) { if (previous.body_hash !== fingerprint) throw fail(409, 'IDEMPOTENCY_CONFLICT', '该请求编号已用于不同内容，请勿重复提交。'); return previous; }
          assertEnabled();
          const original = asset(owner, body.inputAssetId);
          if (original.kind !== 'input') throw fail(400, 'INVALID_INPUT_ASSET', '请选择已授权的原始参考照片。');
          const existingJobs = count('SELECT COUNT(*) n FROM jobs');
          if (existingJobs >= settings.maxJobs || existingJobs >= settings.totalBudget) throw fail(429, 'TOTAL_IMAGE_BUDGET', '本轮图片测试次数已达上限，未再发起生成。');
          if (count("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')") >= settings.maxQueue || count("SELECT COUNT(*) n FROM jobs WHERE owner_id=? AND status IN ('queued','running')", owner) >= settings.maxOwnerPending) throw fail(429, 'IMAGE_QUEUE_FULL', '已有任务正在排队，请等待后再创建。');
          const day = new Date(now()).toISOString().slice(0, 10);
          if ((one('SELECT used FROM daily_usage WHERE day=? AND owner_id=?', day, '*')?.used || 0) >= settings.dailyBudget || (one('SELECT used FROM daily_usage WHERE day=? AND owner_id=?', day, owner)?.used || 0) >= settings.ownerDailyBudget) throw fail(429, 'DAILY_IMAGE_BUDGET', '今日图片生成次数已达上限，请稍后再来。');
          storageAvailable(owner, 0, OUTPUT_BYTES);
          const id = randomUUID(), seed = randomUUID(), stamp = now();
          run(`INSERT INTO jobs(id,owner_id,client_key,body_hash,input_asset_id,input_hash,input_pixel_hash,style_id,prompt_version,scene_seed,prompt,status,created_at,updated_at,requested_model)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued',?,?,?)`, id, owner, key.toLowerCase(), fingerprint, original.id, original.sha256, original.pixel_hash, body.styleId, PROMPT_VERSION, seed, buildGameImagePrompt({ styleId: body.styleId, sceneSeed: seed }), stamp, stamp, IMAGE_MODEL);
          for (const quotaOwner of ['*', owner]) run('INSERT INTO daily_usage VALUES(?,?,1) ON CONFLICT(day,owner_id) DO UPDATE SET used=used+1', day, quotaOwner);
          return one('SELECT * FROM jobs WHERE id=?', id);
        });
        json(res, 202, { job: publicJob(job) }); kick(); return true;
      }
      const jobRoute = new RegExp(`^${PREFIX}/jobs/([^/]+)$`).exec(path);
      if (jobRoute && req.method === 'GET') { json(res, 200, { job: publicJob(ownedJob(owner, jobRoute[1])) }); return true; }
      const assetRoute = new RegExp(`^${PREFIX}/assets/([^/]+)$`).exec(path);
      if (assetRoute && req.method === 'GET') {
        const row = asset(owner, assetRoute[1]);
        const bytes = Buffer.from(row.bytes);
        if (!res.destroyed) { res.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes.length, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" }); res.end(bytes); }
        return true;
      }
      if (path === `${PREFIX}/avatar` && req.method === 'POST') {
        const body = await readJson(req);
        if (!keysExactly(body, ['assetId'])) throw fail(400, 'INVALID_AVATAR', '请选择自己的已完成参考图。');
        const row = asset(owner, body.assetId);
        if (row.kind !== 'output' || !one("SELECT id FROM jobs WHERE output_asset_id=? AND owner_id=? AND status='succeeded'", row.id, owner)) throw fail(400, 'INVALID_AVATAR', '请选择自己的已完成参考图。');
        run('UPDATE owners SET selected_asset_id=? WHERE id=?', row.id, owner);
        json(res, 200, { selectedAssetId: row.id }); return true;
      }
      const deletion = new RegExp(`^${PREFIX}/jobs/([^/]+)/delete$`).exec(path);
      if (deletion && req.method === 'POST') {
        const body = await readJson(req);
        if (!keysExactly(body, [])) throw fail(400, 'INVALID_REQUEST', '删除请求格式不正确。');
        transaction(() => {
          const row = ownedJob(owner, deletion[1]);
          if (!terminal.has(row.status)) throw fail(409, 'JOB_NOT_TERMINAL', '生成中的任务不能删除，请等待结果确认。');
          if (row.output_asset_id) deleteAsset(row.output_asset_id);
          run("UPDATE jobs SET status='deleted',output_asset_id=NULL,error_code=NULL,updated_at=? WHERE id=?", now(), row.id);
          if (!count("SELECT COUNT(*) n FROM jobs WHERE input_asset_id=? AND status!='deleted'", row.input_asset_id)) deleteAsset(row.input_asset_id);
        });
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); json(res, 200, { deleted: true }); return true;
      }
      throw fail(404, 'IMAGE_ROUTE_NOT_FOUND', '未找到此操作。');
    } catch (error) {
      if (error instanceof RequestError) json(res, error.status, { error: error.message, code: error.code });
      else if (error instanceof GameImageMediaError) json(res, 400, { error: '请使用有效的单帧 PNG、JPEG 或 WebP 照片，大小不超过 5 MiB、像素不超过 1600 万。', code: error.code });
      else json(res, 500, { error: '人物工坊暂时无法完成操作，请稍后再试。', code: 'STUDIO_ERROR' });
      return true;
    }
  }
  return { handle, authenticate: requireSession, readOwnedAsset({ ownerId, assetId }) { const row = asset(ownerId, assetId); return { buffer: Buffer.from(row.bytes), mime: row.mime }; }, async close() {
    if (closed) return; closing = true; clearInterval(timer); currentAbort?.abort();
    await work;
    while (decodes) await new Promise(resolve => setTimeout(resolve, 5));
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); closed = true; await unlock();
  } };
}
