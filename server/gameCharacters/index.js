import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { takeInstanceLock } from '../gameImages/index.js';
import { validateGlb } from '../../src/lib/characterModel.js';
import { createMeshyProvider } from './meshyProvider.js';

const PREFIX = '/api/game-characters';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_ID = /^[A-Za-z0-9_-]{1,120}$/;
const GLB_BYTES = 20 * 1024 * 1024;
const STORAGE_BYTES = 512 * 1024 * 1024;
const CREDIT_RESERVATION = 20;
const TERMINAL = new Set(['succeeded', 'failed', 'outcome_unknown', 'deleted']);
const json = (res, status, value) => { if (res.destroyed || res.writableEnded) return; res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
const hash = value => createHash('sha256').update(value).digest('hex');
class CharacterError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const fail = (status, code, message) => new CharacterError(status, code, message);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
async function bodyJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'JSON_REQUIRED', '请使用 JSON 请求。');
  if (Number(req.headers['content-length']) > 4096) { req.resume(); throw fail(413, 'REQUEST_TOO_LARGE', '请求内容过大。'); }
  const chunks = []; let size = 0;
  try { for await (const chunk of req) { size += chunk.length; if (size > 4096) throw fail(413, 'REQUEST_TOO_LARGE', '请求内容过大。'); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (error) { if (error instanceof CharacterError) throw error; throw fail(400, 'INVALID_REQUEST', '请求内容无法识别。'); }
}
const option = (config, name, fallback, max = fallback) => Number.isSafeInteger(config[name]) && config[name] >= 0 ? Math.min(config[name], max) : fallback;

// Structural declarations must describe an actually skinned mesh and at least
// one matching bone rotation track. The browser also validates decoded tracks.
function assertRigAndWalk(model, walking) {
  const jointNames = new Set();
  for (const node of model.nodes || []) {
    const skin = model.skins?.[node.skin], mesh = model.meshes?.[node.mesh];
    if (!skin || !mesh?.primitives?.some(primitive => {
      const attributes = primitive.attributes || {};
      const position = model.accessors?.[attributes.POSITION], joints = model.accessors?.[attributes.JOINTS_0], weights = model.accessors?.[attributes.WEIGHTS_0];
      return position?.type === 'VEC3' && position.count >= 3 && joints?.type === 'VEC4' && weights?.type === 'VEC4' && joints.count === position.count && weights.count === position.count;
    })) continue;
    for (const index of skin.joints) { const name = model.nodes[index]?.name; if (typeof name === 'string' && name) jointNames.add(name); }
  }
  const validWalk = (walking.animations || []).some(animation => (animation.channels || []).some(channel => {
    if (channel.target?.path !== 'rotation' || !jointNames.has(walking.nodes?.[channel.target.node]?.name)) return false;
    const sampler = animation.samplers?.[channel.sampler], input = walking.accessors?.[sampler?.input], output = walking.accessors?.[sampler?.output];
    return input?.type === 'SCALAR' && input.componentType === 5126 && input.count >= 2 && output?.type === 'VEC4' && output.componentType === 5126 && output.count === input.count * (sampler.interpolation === 'CUBICSPLINE' ? 3 : 1);
  }));
  if (!jointNames.size || !validWalk) throw new Error('MISSING_RIG_OR_WALK');
}

export async function createGameCharacterModule({ config = {}, provider, images, dbPath, now = Date.now } = {}) {
  if (!images || typeof images.authenticate !== 'function' || typeof images.readOwnedAsset !== 'function') throw new Error('Private image identity is required');
  if (!provider && config.apiKey) { try { provider = createMeshyProvider(config); } catch {} }
  const totalBudget = option(config, 'totalBudget', 0, 50), creditBudget = option(config, 'creditBudget', 0, 1000);
  const enabled = config.enabled === true && totalBudget > 0 && creditBudget >= CREDIT_RESERVATION && ['createModel', 'getModel', 'createRig', 'getRig', 'download'].every(name => typeof provider?.[name] === 'function');
  const allowedReasons = new Set(['disabled', 'provider-unconfigured', 'budget-not-authorized', 'budget-zero', 'invalid-config']);
  const reason = enabled ? null : allowedReasons.has(config.reason) ? config.reason : config.enabled !== true ? 'disabled' : totalBudget === 0 || creditBudget < CREDIT_RESERVATION ? 'budget-zero' : 'provider-unconfigured';
  const maxQueue = option(config, 'maxQueue', 8, 16), maxOwnerPending = 1;
  const pollIntervalMs = Math.max(1, option(config, 'pollIntervalMs', 5000));
  const maxPolls = option(config, 'maxPolls', 360);
  const callTimeoutMs = Math.max(1, option(config, 'callTimeoutMs', 120_000));
  const downloadAttempts = option(config, 'maxDownloadAttempts', 3);
  const assetTtlMs = option(config, 'assetTtlMs', 7 * 24 * 60 * 60_000);
  const maxStorageBytes = option(config, 'maxStorageBytes', STORAGE_BYTES);
  const databasePath = dbPath || config.dbPath || fileURLToPath(new URL('../../.data/game-characters/game-characters.sqlite', import.meta.url));
  await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
  const unlock = await takeInstanceLock(`${databasePath}.lock`);
  let db;
  try { db = new DatabaseSync(databasePath); } catch { await unlock(); throw new Error('Character storage unavailable'); }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000; PRAGMA journal_size_limit=16777216;
    CREATE TABLE IF NOT EXISTS character_jobs(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,client_key TEXT NOT NULL,body_hash TEXT NOT NULL,reference_asset_id TEXT NOT NULL,
      status TEXT NOT NULL,stage TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,error_code TEXT,
      reserved_credits INTEGER NOT NULL,model_dispatch_count INTEGER NOT NULL DEFAULT 0,rig_dispatch_count INTEGER NOT NULL DEFAULT 0,
      model_task_id TEXT,rig_task_id TEXT,model_dispatched_at INTEGER,rig_dispatched_at INTEGER,poll_count INTEGER NOT NULL DEFAULT 0,next_poll_at INTEGER NOT NULL,
      model_source_url TEXT,walking_source_url TEXT,model_asset_id TEXT,walking_asset_id TEXT,download_attempts INTEGER NOT NULL DEFAULT 0,
      reported_model_credits INTEGER,reported_rig_credits INTEGER,UNIQUE(owner_id,client_key));
    CREATE INDEX IF NOT EXISTS character_queue ON character_jobs(status,next_poll_at);
    CREATE TABLE IF NOT EXISTS character_assets(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,owner_id TEXT NOT NULL,kind TEXT NOT NULL,bytes BLOB NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS character_selections(owner_id TEXT PRIMARY KEY,job_id TEXT NOT NULL);`);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const count = (sql, ...params) => Number(one(sql, ...params)?.n || 0);
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  let closing = false, closed = false, closePromise = null, work = null, currentAbort = null;
  // A missing ID after a paid POST is ambiguous forever: never recreate it.
  run("UPDATE character_jobs SET status='outcome_unknown',error_code='CREATE_OUTCOME_UNKNOWN',updated_at=? WHERE status='running' AND ((model_dispatch_count>0 AND model_task_id IS NULL) OR (rig_dispatch_count>0 AND rig_task_id IS NULL))", now());
  run("UPDATE character_jobs SET next_poll_at=? WHERE status='running' AND (model_task_id IS NOT NULL OR rig_task_id IS NOT NULL)", now());
  function owned(ownerId, id) { const row = UUID.test(id || '') && one('SELECT * FROM character_jobs WHERE id=? AND owner_id=?', id, ownerId); if (!row) throw fail(404, 'CHARACTER_NOT_FOUND', '未找到此人物任务。'); return row; }
  function urls(row) { return { modelUrl: `${PREFIX}/assets/${row.model_asset_id}.glb`, walkingUrl: `${PREFIX}/assets/${row.walking_asset_id}.glb` }; }
  function dto(row) { return { id: row.id, referenceAssetId: row.reference_asset_id, status: row.status, stage: row.stage, progress: row.progress, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), ...(row.status === 'succeeded' && row.model_asset_id && row.walking_asset_id ? urls(row) : {}), ...(row.error_code ? { errorCode: row.error_code } : {}) }; }
  function selected(ownerId) { const row = one("SELECT j.* FROM character_jobs j JOIN character_selections s ON s.job_id=j.id WHERE s.owner_id=? AND j.owner_id=? AND j.status='succeeded'", ownerId, ownerId); return row ? { id: row.id, ...urls(row), facing: 'positive-z' } : null; }
  function mine(ownerId) { return { jobs: all('SELECT * FROM character_jobs WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100', ownerId).map(dto), selectedCharacter: selected(ownerId) }; }
  const update = (id, status, stage, progress, error = null) => run('UPDATE character_jobs SET status=?,stage=?,progress=?,error_code=?,updated_at=?,next_poll_at=? WHERE id=?', status, stage, progress, error, now(), now() + pollIntervalMs, id);
  function markUnknown(row, code) { update(row.id, 'outcome_unknown', row.stage, row.progress, code); }
  async function call(fn) {
    const controller = new AbortController(); currentAbort = controller;
    let rejectAbort; const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = () => rejectAbort(new Error('UNCONFIRMED'));
    controller.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), callTimeoutMs);
    try { return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), aborted]); }
    finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', abort); if (currentAbort === controller) currentAbort = null; }
  }
  const knownTask = value => value && typeof value.taskId === 'string' && TASK_ID.test(value.taskId);
  const creditValue = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
  const progress = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.floor(value))) : 0;
  function pending(row) { run('UPDATE character_jobs SET updated_at=?,next_poll_at=? WHERE id=?', now(), now() + pollIntervalMs, row.id); }

  async function createModel(row) {
    if (!enabled) { pending(row); return; }
    let image;
    try { image = images.readOwnedAsset({ ownerId: row.owner_id, assetId: row.reference_asset_id }); }
    catch { update(row.id, 'failed', 'model', 0, 'REFERENCE_EXPIRED'); return; }
    transaction(() => { run("UPDATE character_jobs SET status='running',model_dispatch_count=1,model_dispatched_at=?,updated_at=? WHERE id=? AND model_dispatch_count=0", now(), now(), row.id); });
    try {
      const result = await call(signal => provider.createModel({ image, signal }));
      if (!knownTask(result)) throw new Error('UNCONFIRMED');
      run('UPDATE character_jobs SET model_task_id=?,next_poll_at=?,updated_at=? WHERE id=?', result.taskId, now() + pollIntervalMs, now(), row.id);
    } catch { markUnknown({ ...row, stage: 'model' }, 'CREATE_OUTCOME_UNKNOWN'); }
  }
  async function createRig(row) {
    if (!enabled) { pending(row); return; }
    // 20 credits were reserved atomically at admission, including this 5-credit
    // stage. Commit the rig's one-shot dispatch reservation before its paid POST.
    transaction(() => { run("UPDATE character_jobs SET rig_dispatch_count=1,rig_dispatched_at=?,status='running',updated_at=? WHERE id=? AND rig_dispatch_count=0 AND reserved_credits>=20", now(), now(), row.id); });
    try {
      const result = await call(signal => provider.createRig({ taskId: row.model_task_id, signal }));
      if (!knownTask(result)) throw new Error('UNCONFIRMED');
      run('UPDATE character_jobs SET rig_task_id=?,next_poll_at=?,updated_at=? WHERE id=?', result.taskId, now() + pollIntervalMs, now(), row.id);
    } catch { markUnknown({ ...row, stage: 'rig' }, 'CREATE_OUTCOME_UNKNOWN'); }
  }
  async function poll(row) {
    if (row.poll_count >= maxPolls) { markUnknown(row, 'POLL_LIMIT'); return; }
    run('UPDATE character_jobs SET poll_count=poll_count+1,next_poll_at=? WHERE id=?', now() + pollIntervalMs, row.id);
    try {
      const result = await call(signal => row.stage === 'model' ? provider.getModel({ taskId: row.model_task_id, signal }) : provider.getRig({ taskId: row.rig_task_id, signal }));
      if (closing) return;
      if (!result || !['PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED'].includes(result.status)) throw new Error('INVALID_STATUS');
      if (['FAILED', 'CANCELED'].includes(result.status)) { update(row.id, 'failed', row.stage, row.progress, 'PROVIDER_TASK_FAILED'); return; }
      if (result.status !== 'SUCCEEDED') { update(row.id, 'running', row.stage, row.stage === 'model' ? Math.floor(progress(result.progress) / 2) : 50 + Math.floor(progress(result.progress) * 0.4)); return; }
      if (row.stage === 'model') {
        run("UPDATE character_jobs SET stage='rig',status='running',progress=50,reported_model_credits=?,next_poll_at=?,updated_at=?,error_code=NULL WHERE id=?", creditValue(result.consumedCredits), now(), now(), row.id);
      } else {
        if (typeof result.modelUrl !== 'string' || typeof result.walkingUrl !== 'string' || !result.modelUrl || !result.walkingUrl || result.modelUrl.length > 8192 || result.walkingUrl.length > 8192) { update(row.id, 'failed', 'rig', 90, 'WALKING_ANIMATION_MISSING'); return; }
        run("UPDATE character_jobs SET stage='download',status='running',progress=90,model_source_url=?,walking_source_url=?,reported_rig_credits=?,next_poll_at=?,updated_at=?,error_code=NULL WHERE id=?", result.modelUrl, result.walkingUrl, creditValue(result.consumedCredits), now(), now(), row.id);
      }
    } catch { if (!closing) pending(row); }
  }
  async function download(row) {
    if (row.download_attempts >= downloadAttempts) { markUnknown(row, 'DOWNLOAD_UNCONFIRMED'); return; }
    run('UPDATE character_jobs SET download_attempts=download_attempts+1,next_poll_at=? WHERE id=?', now() + pollIntervalMs, row.id);
    let model, walking;
    try {
      model = await call(signal => provider.download({ url: row.model_source_url, signal }));
      walking = await call(signal => provider.download({ url: row.walking_source_url, signal }));
    } catch { if (!closing) pending(row); return; }
    if (closing) return;
    try {
      if (!Buffer.isBuffer(model) || !Buffer.isBuffer(walking) || model.length > GLB_BYTES || walking.length > GLB_BYTES) throw new Error('INVALID_ASSET');
      const modelJson = validateGlb(model, { maxBytes: GLB_BYTES }).json;
      const walkingJson = validateGlb(walking, { maxBytes: GLB_BYTES }).json;
      assertRigAndWalk(modelJson, walkingJson);
      transaction(() => {
        const current = one('SELECT status FROM character_jobs WHERE id=?', row.id);
        if (current?.status !== 'running') return;
        if (count('SELECT COALESCE(SUM(length(bytes)),0) n FROM character_assets') + model.length + walking.length > maxStorageBytes) throw new Error('STORAGE_FULL');
        const modelId = randomUUID(), walkingId = randomUUID();
        for (const [id, kind, bytes] of [[modelId, 'model', model], [walkingId, 'walking', walking]]) run('INSERT INTO character_assets VALUES(?,?,?,?,?,?,?)', id, row.id, row.owner_id, kind, bytes, now(), now() + assetTtlMs);
        run("UPDATE character_jobs SET status='succeeded',stage='ready',progress=100,model_asset_id=?,walking_asset_id=?,model_source_url=NULL,walking_source_url=NULL,error_code=NULL,updated_at=? WHERE id=?", modelId, walkingId, now(), row.id);
      });
    } catch { update(row.id, 'failed', 'download', 90, 'INVALID_3D_ASSET'); }
  }
  async function step(row) {
    if (row.stage === 'download') { await download(row); return; }
    if (row.stage === 'model') {
      if (row.model_task_id) await poll(row);
      else if (!row.model_dispatch_count) await createModel(row);
      else markUnknown(row, 'CREATE_OUTCOME_UNKNOWN');
    } else if (row.stage === 'rig') {
      if (row.rig_task_id) await poll(row);
      else if (!row.rig_dispatch_count) await createRig(row);
      else markUnknown(row, 'CREATE_OUTCOME_UNKNOWN');
    }
  }
  function kick() {
    if (closing || closed || work || !provider) return;
    work = (async () => {
      while (!closing) {
        const row = one("SELECT * FROM character_jobs WHERE status IN ('queued','running') AND next_poll_at<=? ORDER BY next_poll_at,rowid LIMIT 1", now());
        if (!row) break;
        if (!enabled && !row.model_task_id && !row.rig_task_id) { pending(row); break; }
        await step(row);
      }
    })().catch(() => {}).finally(() => { work = null; });
  }
  function maintain() {
    if (closing || closed) return;
    transaction(() => {
      for (const row of all('SELECT DISTINCT job_id FROM character_assets WHERE expires_at<=?', now())) {
        run('DELETE FROM character_selections WHERE job_id=?', row.job_id);
        run('DELETE FROM character_assets WHERE job_id=?', row.job_id);
        run("UPDATE character_jobs SET status='deleted',model_asset_id=NULL,walking_asset_id=NULL,error_code='CHARACTER_EXPIRED',updated_at=? WHERE id=?", now(), row.job_id);
      }
    });
    db.exec('PRAGMA wal_checkpoint(PASSIVE)'); kick();
  }
  maintain();
  const timer = setInterval(maintain, Math.max(10, Math.min(pollIntervalMs, 15_000))); timer.unref?.();

  async function handle(req, res, { originAllowed = false } = {}) {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
    try {
      if (closing || closed) throw fail(503, 'CHARACTER_SERVICE_CLOSED', '3D 人物服务暂时不可用。');
      if (req.method === 'POST' && (originAllowed !== true || typeof req.headers.origin !== 'string' || !/^https?:\/\//.test(req.headers.origin))) throw fail(403, 'ORIGIN_DENIED', '请从游戏小镇页面提交请求。');
      if (!['GET', 'POST'].includes(req.method)) throw fail(405, 'METHOD_NOT_ALLOWED', '不支持此操作。');
      let owner;
      try { owner = images.authenticate(req); } catch { throw fail(401, 'IMAGE_SESSION_REQUIRED', '请重新打开人物工坊后再试。'); }
      if (path === `${PREFIX}/status` && req.method === 'GET') { maintain(); json(res, 200, { enabled, reason, provider: 'Meshy', estimatedCredits: CREDIT_RESERVATION, ...mine(owner) }); return true; }
      if (path === `${PREFIX}/mine` && req.method === 'GET') { maintain(); json(res, 200, mine(owner)); return true; }
      if (path === `${PREFIX}/jobs` && req.method === 'POST') {
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || !UUID.test(key)) throw fail(400, 'IDEMPOTENCY_KEY_REQUIRED', '请使用有效的任务请求编号。');
        const body = await bodyJson(req);
        if (!exact(body, ['referenceAssetId', 'consent']) || body.consent !== true || !UUID.test(body.referenceAssetId || '')) throw fail(400, 'INVALID_CHARACTER_REQUEST', '请选择本人参考图并确认 3D 生成许可。');
        const fingerprint = hash(JSON.stringify({ referenceAssetId: body.referenceAssetId, consent: true }));
        const job = transaction(() => {
          const previous = one('SELECT * FROM character_jobs WHERE owner_id=? AND client_key=?', owner, key.toLowerCase());
          if (previous) { if (previous.body_hash !== fingerprint) throw fail(409, 'IDEMPOTENCY_CONFLICT', '该请求编号已用于不同内容，请勿重复提交。'); return previous; }
          if (!enabled) throw fail(503, 'GAME_CHARACTERS_DISABLED', '3D 生成人物尚未启用，需要独立配置与费用额度。');
          try { images.readOwnedAsset({ ownerId: owner, assetId: body.referenceAssetId }); } catch { throw fail(404, 'REFERENCE_NOT_FOUND', '参考图已过期、删除或不属于当前会话。'); }
          if (count('SELECT COUNT(*) n FROM character_jobs') >= totalBudget || count('SELECT COALESCE(SUM(reserved_credits),0) n FROM character_jobs') + CREDIT_RESERVATION > creditBudget) throw fail(429, 'CHARACTER_CREDIT_BUDGET', '已达到本轮 3D 人物或积分额度，未再发起生成。');
          const pendingCount = count("SELECT COUNT(*) n FROM character_jobs WHERE status IN ('queued','running')");
          if (pendingCount >= maxQueue || count("SELECT COUNT(*) n FROM character_jobs WHERE owner_id=? AND status IN ('queued','running')", owner) >= maxOwnerPending) throw fail(429, 'CHARACTER_QUEUE_FULL', '已有 3D 人物正在生成，请等待后再创建。');
          if (count('SELECT COALESCE(SUM(length(bytes)),0) n FROM character_assets') + (pendingCount + 1) * GLB_BYTES * 2 > maxStorageBytes) throw fail(429, 'CHARACTER_STORAGE_FULL', '3D 人物空间暂时不足，请先删除不需要的作品。');
          const id = randomUUID();
          run("INSERT INTO character_jobs(id,owner_id,client_key,body_hash,reference_asset_id,status,stage,created_at,updated_at,reserved_credits,next_poll_at) VALUES(?,?,?,?,?,'queued','model',?,?,?,?)", id, owner, key.toLowerCase(), fingerprint, body.referenceAssetId, now(), now(), CREDIT_RESERVATION, now());
          return one('SELECT * FROM character_jobs WHERE id=?', id);
        });
        json(res, 202, { job: dto(job) }); kick(); return true;
      }
      const jobRoute = new RegExp(`^${PREFIX}/jobs/([^/]+)$`).exec(path);
      if (jobRoute && req.method === 'GET') { json(res, 200, { job: dto(owned(owner, jobRoute[1])) }); return true; }
      const assetRoute = new RegExp(`^${PREFIX}/assets/([^/]+)\\.glb$`).exec(path);
      if (assetRoute && req.method === 'GET') {
        const row = UUID.test(assetRoute[1]) && one('SELECT a.* FROM character_assets a JOIN character_jobs j ON j.id=a.job_id WHERE a.id=? AND a.owner_id=? AND a.expires_at>? AND j.status=\'succeeded\'', assetRoute[1], owner, now());
        if (!row) throw fail(404, 'CHARACTER_ASSET_NOT_FOUND', '3D 人物文件已过期或不存在。');
        const bytes = Buffer.from(row.bytes);
        if (!res.destroyed) { res.writeHead(200, { 'content-type': 'model/gltf-binary', 'content-length': bytes.length, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }); res.end(bytes); } return true;
      }
      if (path === `${PREFIX}/select` && req.method === 'POST') {
        const body = await bodyJson(req);
        if (!exact(body, ['jobId'])) throw fail(400, 'INVALID_SELECTION', '请选择已完成的人物。');
        if (body.jobId === null) run('DELETE FROM character_selections WHERE owner_id=?', owner);
        else {
          const row = owned(owner, body.jobId);
          if (row.status !== 'succeeded' || count('SELECT COUNT(*) n FROM character_assets WHERE job_id=? AND owner_id=? AND expires_at>?', row.id, owner, now()) !== 2) throw fail(409, 'CHARACTER_NOT_READY', '人物模型与行走动画尚未完整就绪。');
          run('INSERT INTO character_selections VALUES(?,?) ON CONFLICT(owner_id) DO UPDATE SET job_id=excluded.job_id', owner, row.id);
        }
        json(res, 200, { selectedCharacter: selected(owner) }); return true;
      }
      const deletion = new RegExp(`^${PREFIX}/jobs/([^/]+)/delete$`).exec(path);
      if (deletion && req.method === 'POST') {
        const body = await bodyJson(req); if (!exact(body, [])) throw fail(400, 'INVALID_REQUEST', '删除请求格式不正确。');
        transaction(() => {
          const row = owned(owner, deletion[1]); if (!TERMINAL.has(row.status)) throw fail(409, 'CHARACTER_NOT_TERMINAL', '生成中的人物不能删除，请等待结果确认。');
          run('DELETE FROM character_selections WHERE job_id=?', row.id); run('DELETE FROM character_assets WHERE job_id=?', row.id);
          run("UPDATE character_jobs SET status='deleted',model_asset_id=NULL,walking_asset_id=NULL,model_source_url=NULL,walking_source_url=NULL,error_code=NULL,updated_at=? WHERE id=?", now(), row.id);
        });
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); json(res, 200, { deleted: true }); return true;
      }
      throw fail(404, 'CHARACTER_ROUTE_NOT_FOUND', '未找到此操作。');
    } catch (error) { if (error instanceof CharacterError) json(res, error.status, { error: error.message, code: error.code }); else json(res, 500, { error: '3D 人物服务暂时无法完成操作，请稍后再试。', code: 'CHARACTER_SERVICE_ERROR' }); return true; }
  }
  return { handle, close() {
    if (closePromise) return closePromise;
    closing = true; clearInterval(timer); currentAbort?.abort();
    closePromise = (async () => { await work; db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); closed = true; await unlock(); })();
    return closePromise;
  } };
}
