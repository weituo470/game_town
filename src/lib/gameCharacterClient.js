import { appUrl } from './appUrl.js';

const STATES = new Set(['queued', 'running', 'succeeded', 'failed', 'outcome_unknown', 'deleted']);
const STAGES = new Set(['model', 'rig', 'download', 'ready']);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const canceled = () => Object.assign(new Error('已停止等待；服务器任务不会因此取消。'), { name: 'AbortError' });

export class GameCharacterError extends Error {
  constructor(code, message, { status = 0, ambiguous = false } = {}) {
    super(message); this.name = 'GameCharacterError'; this.code = code; this.status = status; this.ambiguous = ambiguous;
  }
}

export function isPrivateCharacterUrl(value) {
  return typeof value === 'string' && /^\/api\/game-characters\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.glb$/i.test(value);
}

function selectedCharacter(value) {
  if (value == null) return null;
  if (!validId(value.id) || !isPrivateCharacterUrl(value.modelUrl) || !isPrivateCharacterUrl(value.walkingUrl) || value.facing !== 'positive-z') throw new GameCharacterError('INVALID_RESPONSE', '3D 角色资源尚不完整，暂时不能进入小镇。');
  return { id: value.id, modelUrl: value.modelUrl, walkingUrl: value.walkingUrl, facing: value.facing };
}

function job(value) {
  if (!value || !validId(value.id) || !validId(value.referenceAssetId) || !STATES.has(value.status) || !STAGES.has(value.stage)
    || (value.modelUrl != null && !isPrivateCharacterUrl(value.modelUrl)) || (value.walkingUrl != null && !isPrivateCharacterUrl(value.walkingUrl))
    || (value.status === 'succeeded' && (value.stage !== 'ready' || !isPrivateCharacterUrl(value.modelUrl) || !isPrivateCharacterUrl(value.walkingUrl)))) {
    throw new GameCharacterError('INVALID_RESPONSE', '无法确认完整 3D 角色状态，请刷新任务；不要重复付费生成。', { ambiguous: true });
  }
  return { id: value.id, referenceAssetId: value.referenceAssetId, status: value.status, stage: value.stage, createdAt: value.createdAt, updatedAt: value.updatedAt,
    ...(Number.isFinite(value.progress) && value.progress >= 0 && value.progress <= 100 ? { progress: value.progress } : {}),
    ...(value.modelUrl ? { modelUrl: value.modelUrl } : {}), ...(value.walkingUrl ? { walkingUrl: value.walkingUrl } : {}),
    ...(typeof value.errorCode === 'string' ? { errorCode: value.errorCode } : {}),
  };
}

function mine(data) {
  if (!data || !Array.isArray(data.jobs)) throw new GameCharacterError('INVALID_RESPONSE', '无法读取 3D 任务，请稍后刷新。');
  return { jobs: data.jobs.map(job), selectedCharacter: selectedCharacter(data.selectedCharacter) };
}

export function createGameCharacterJobRequest({ referenceAssetId, consent }, createId = () => crypto.randomUUID()) {
  if (!validId(referenceAssetId) || consent !== true) throw new GameCharacterError('INVALID_INPUT', '请选择参考图，并单独同意发送给 Meshy 生成 3D 角色。');
  return Object.freeze({ key: createId(), body: Object.freeze({ referenceAssetId, consent: true }) });
}

export function createGameCharacterClient({ fetchImpl = (...args) => fetch(...args), timeoutMs = 25000 } = {}) {
  async function request(path, { signal, body, key, mayCreate = false } = {}) {
    if (signal?.aborted) throw canceled();
    const controller = new AbortController(); let rejectStop, timedOut = false;
    const stopped = new Promise((_, reject) => { rejectStop = reject; });
    const guard = promise => Promise.race([promise, stopped]);
    const abort = () => { controller.abort(); rejectStop(canceled()); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); rejectStop(new Error('timeout')); }, timeoutMs);
    try {
      const response = await guard(fetchImpl(appUrl(`/api/game-characters${path}`), { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      const data = await guard(response.json().catch(() => null));
      if (!response.ok) {
        const message = response.status === 503 ? 'Meshy 专用配置或费用额度尚未启用，当前不会提交 3D 生成。'
          : response.status === 401 || response.status === 403 ? '浏览器身份或授权已失效，请重新打开角色工坊。'
            : response.status === 404 ? '未找到这项 3D 任务或资源，请刷新列表。'
              : response.status === 409 ? '任务状态已变化，请先刷新；不要重复提交付费生成。'
                : response.status === 429 ? '3D 服务正在忙或额度不足，请稍后检查状态。'
                  : '3D 操作暂未完成，请先刷新任务状态。';
        throw new GameCharacterError(typeof data?.code === 'string' ? data.code : 'SERVICE_ERROR', message, { status: response.status, ambiguous: mayCreate && response.status >= 500 });
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new GameCharacterError('INVALID_RESPONSE', '尚未确认 3D 任务结果，请先找回原任务。', { ambiguous: mayCreate });
      return data;
    } catch (error) {
      if (signal?.aborted) throw canceled();
      if (error instanceof GameCharacterError) throw error;
      throw new GameCharacterError(timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', mayCreate ? '尚未确认 3D 任务是否创建。请找回原任务，不要重新付费生成。' : '暂时无法连接 3D 服务，请稍后刷新。', { ambiguous: mayCreate });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return {
    async status(options) {
      const data = await request('/status', options);
      if (typeof data.enabled !== 'boolean' || data.provider !== 'Meshy' || !Number.isFinite(data.estimatedCredits) || data.estimatedCredits < 0) throw new GameCharacterError('INVALID_RESPONSE', '无法确认 Meshy 配置与费用，暂不提交生成。');
      return { ...mine(data), enabled: data.enabled, reason: data.reason, provider: data.provider, estimatedCredits: data.estimatedCredits };
    },
    async mine(options) { return mine(await request('/mine', options)); },
    async job(id, options) { if (!validId(id)) throw new GameCharacterError('INVALID_INPUT', '3D 任务标识无效。'); return { job: job((await request(`/jobs/${id}`, options)).job) }; },
    async createJob(prepared, options) {
      if (!prepared?.key || !prepared.body) throw new GameCharacterError('INVALID_INPUT', '缺少原 3D 任务标识。');
      return { job: job((await request('/jobs', { ...options, body: prepared.body, key: prepared.key, mayCreate: true })).job) };
    },
    async select(jobId, options) {
      if (jobId !== null && !validId(jobId)) throw new GameCharacterError('INVALID_INPUT', '3D 角色标识无效。');
      const result = selectedCharacter((await request('/select', { ...options, body: { jobId } })).selectedCharacter);
      if ((jobId === null && result !== null) || (jobId !== null && result?.id !== jobId)) throw new GameCharacterError('INVALID_RESPONSE', '未能确认角色选择，请刷新小镇角色。');
      return { selectedCharacter: result };
    },
    async deleteJob(id, options) {
      if (!validId(id)) throw new GameCharacterError('INVALID_INPUT', '3D 任务标识无效。');
      if ((await request(`/jobs/${id}/delete`, { ...options, body: {} })).deleted !== true) throw new GameCharacterError('INVALID_RESPONSE', '未能确认删除结果，请刷新 3D 任务。');
      return { deleted: true };
    },
  };
}
export const gameCharacterClient = createGameCharacterClient();
