import { appUrl } from './appUrl.js';

export const GAME_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const GAME_IMAGE_STYLES = Object.freeze([
  { id: 'storybook', label: '绘本居民', description: '温暖柔和的绘本人物，适合小镇生活。' },
  { id: 'clay', label: '黏土玩偶', description: '圆润的手作黏土质感，保留人物特征。' },
  { id: 'adventure', label: '冒险旅人', description: '轻快的冒险装束，准备出发探索。' },
]);
const STYLE_IDS = new Set(GAME_IMAGE_STYLES.map(item => item.id));
const STATUS_IDS = new Set(['queued', 'running', 'succeeded', 'failed', 'outcome_unknown', 'deleted']);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const abortError = () => Object.assign(new Error('请求已取消。'), { name: 'AbortError' });

export class GameImageError extends Error {
  constructor(code, message, { status = 0, ambiguous = false } = {}) {
    super(message); this.name = 'GameImageError'; this.code = code; this.status = status; this.ambiguous = ambiguous;
  }
}

export function validateImageFile(file, maxBytes = GAME_IMAGE_MAX_BYTES) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new GameImageError('INVALID_FILE', '请选择 PNG、JPEG 或 WebP 图片。');
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > Math.min(maxBytes, GAME_IMAGE_MAX_BYTES)) throw new GameImageError('INVALID_FILE', '照片不能是空文件，大小须不超过 5 MiB。');
  return file;
}

export function readImageBase64(file, { signal, Reader = globalThis.FileReader } = {}) {
  validateImageFile(file);
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const reader = new Reader();
    const cleanup = () => { signal?.removeEventListener('abort', cancel); reader.onload = reader.onerror = reader.onabort = null; };
    const cancel = () => { reader.abort(); cleanup(); reject(abortError()); };
    signal?.addEventListener('abort', cancel, { once: true });
    reader.onerror = () => { cleanup(); reject(new GameImageError('FILE_READ_ERROR', '照片读取失败，请重新选择图片。')); };
    reader.onabort = () => { cleanup(); reject(abortError()); };
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result.split(',')[1] : '';
      cleanup();
      if (!result || !/^[A-Za-z0-9+/]+=*$/.test(result)) reject(new GameImageError('FILE_READ_ERROR', '照片读取失败，请重新选择图片。'));
      else resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

export function gameImageAssetUrl(id) {
  if (!validId(id)) throw new GameImageError('INVALID_ASSET', '图片标识无效。');
  return appUrl(`/api/game-images/assets/${encodeURIComponent(id)}`);
}

export function createGameImageJobRequest({ inputAssetId, styleId, consent }, createId = () => crypto.randomUUID()) {
  if (!validId(inputAssetId) || !STYLE_IDS.has(styleId) || consent !== true) throw new GameImageError('INVALID_INPUT', '请先上传照片、选择风格并确认授权。');
  return Object.freeze({ key: createId(), body: Object.freeze({ inputAssetId, styleId, consent: true }) });
}

function parseJob(job) {
  if (!job || !validId(job.id) || !STATUS_IDS.has(job.status) || !STYLE_IDS.has(job.styleId)
    || (job.outputAssetId != null && !validId(job.outputAssetId))) throw new GameImageError('INVALID_RESPONSE', '无法确认任务状态，请刷新我的作品。', { ambiguous: true });
  return { id: job.id, status: job.status, styleId: job.styleId, createdAt: job.createdAt, updatedAt: job.updatedAt,
    ...(Number.isInteger(job.queuePosition) && job.queuePosition > 0 ? { queuePosition: job.queuePosition } : {}),
    ...(job.outputAssetId ? { outputAssetId: job.outputAssetId } : {}),
    ...(typeof job.errorCode === 'string' ? { errorCode: job.errorCode } : {}),
    ...(typeof job.requestedModel === 'string' ? { requestedModel: job.requestedModel } : {}),
    ...(typeof job.returnedModel === 'string' ? { returnedModel: job.returnedModel } : {}),
  };
}

function parseMine(data) {
  if (!data || !Array.isArray(data.jobs) || (data.selectedAssetId != null && !validId(data.selectedAssetId))) throw new GameImageError('INVALID_RESPONSE', '无法读取我的作品，请稍后刷新。');
  return { jobs: data.jobs.map(parseJob), selectedAssetId: data.selectedAssetId || null };
}

export function createGameImageClient({ fetchImpl = (...args) => fetch(...args), timeoutMs = 25000 } = {}) {
  async function request(path, { body, signal, key, mayCreate = false } = {}) {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    let rejectStop, timedOut = false;
    const stopped = new Promise((_, reject) => { rejectStop = reject; });
    const guard = operation => Promise.race([operation, stopped]);
    const abort = () => { controller.abort(); rejectStop(abortError()); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); rejectStop(new Error('timeout')); }, timeoutMs);
    try {
      const response = await guard(fetchImpl(appUrl(`/api/game-images${path}`), {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      const data = await guard(response.json().catch(() => null));
      if (!response.ok) {
        const code = typeof data?.code === 'string' ? data.code : 'SERVICE_ERROR';
        const message = response.status === 413 ? '照片过大，请选择不超过 5 MiB 的图片。'
          : response.status === 429 ? '工坊正在忙，请稍等片刻再试。'
            : response.status === 401 || response.status === 403 ? '浏览器身份或授权已失效，请重新打开人物工坊。'
              : response.status === 503 ? '专用图像生成服务尚未配置或暂未启用，照片仍可在本地预览。'
                : response.status === 404 ? '未找到这份作品，可能已删除或当前浏览器身份已改变。'
                  : response.status === 409 ? '任务状态已变化，请刷新我的作品；不要重复创建任务。'
                    : '操作暂未完成，请刷新状态后再试。';
        throw new GameImageError(code, message, { status: response.status, ambiguous: mayCreate && response.status >= 500 });
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new GameImageError('INVALID_RESPONSE', '未能确认服务结果，请先找回任务或刷新作品。', { ambiguous: mayCreate });
      return data;
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (error instanceof GameImageError) throw error;
      throw new GameImageError(timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', mayCreate
        ? '尚未确认任务是否创建。请使用“找回此任务”，不要反复生成。'
        : '连接暂时中断，请检查网络后再试。', { ambiguous: mayCreate });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return {
    async bootstrap(options) {
      const data = await request('/bootstrap', options);
      if (typeof data.enabled !== 'boolean' || data.outputKind !== '2d' || !Array.isArray(data.styles)
        || !Number.isFinite(data.maxUploadBytes) || data.maxUploadBytes < 1) throw new GameImageError('INVALID_RESPONSE', '无法确认工坊配置，暂不上传照片。');
      const styles = data.styles.filter(style => STYLE_IDS.has(style?.id)).map(style => ({ id: style.id, label: typeof style.label === 'string' ? style.label : style.id, description: typeof style.description === 'string' ? style.description : '' }));
      return { ...parseMine(data), enabled: data.enabled, reason: data.reason, styles, maxUploadBytes: Math.min(data.maxUploadBytes, GAME_IMAGE_MAX_BYTES), outputKind: '2d' };
    },
    async upload({ mime, data, consent }, options) {
      if (consent !== true || !['image/png', 'image/jpeg', 'image/webp'].includes(mime) || typeof data !== 'string' || !data || data.length > Math.ceil(GAME_IMAGE_MAX_BYTES / 3) * 4) throw new GameImageError('INVALID_INPUT', '请检查照片格式、大小与授权。');
      const result = await request('/inputs', { ...options, body: { mime, data, consent: true } });
      if (!validId(result.inputAssetId)) throw new GameImageError('INVALID_RESPONSE', '尚未确认照片上传结果，请重新上传。');
      return { inputAssetId: result.inputAssetId };
    },
    async createJob(prepared, options) {
      if (!prepared?.key || !prepared.body) throw new GameImageError('INVALID_INPUT', '缺少原任务标识，请刷新我的作品。');
      const data = await request('/jobs', { ...options, body: prepared.body, key: prepared.key, mayCreate: true });
      return { job: parseJob(data.job) };
    },
    async mine(options) { return parseMine(await request('/mine', options)); },
    async job(id, options) { if (!validId(id)) throw new GameImageError('INVALID_INPUT', '任务标识无效。'); return { job: parseJob((await request(`/jobs/${encodeURIComponent(id)}`, options)).job) }; },
    async avatar(assetId, options) {
      gameImageAssetUrl(assetId);
      const data = await request('/avatar', { ...options, body: { assetId } });
      if (data.selectedAssetId !== assetId) throw new GameImageError('INVALID_RESPONSE', '未能确认头像设置结果，请刷新作品。');
      return { selectedAssetId: data.selectedAssetId };
    },
    async deleteJob(id, options) {
      if (!validId(id)) throw new GameImageError('INVALID_INPUT', '任务标识无效。');
      const data = await request(`/jobs/${encodeURIComponent(id)}/delete`, { ...options, body: {} });
      if (data.deleted !== true) throw new GameImageError('INVALID_RESPONSE', '未能确认删除结果，请刷新作品。');
      return { deleted: true };
    },
  };
}

export const gameImageClient = createGameImageClient();

// Poll only GET requests. Hidden documents pause; returning runs one fresh read.
export function startGameImagePolling({ refresh, documentRef = globalThis.document, setTimer = setTimeout, clearTimer = clearTimeout, intervalMs = 4000, onError = () => {} }) {
  let disposed = false, timer = null, active = null;
  const schedule = () => { if (!disposed && !documentRef.hidden) timer = setTimer(tick, intervalMs); };
  const tick = async () => {
    timer = null;
    if (disposed || documentRef.hidden || active) return;
    const controller = new AbortController(); active = controller;
    try { await refresh({ signal: controller.signal }); }
    catch (error) { if (!disposed && !controller.signal.aborted && error.name !== 'AbortError') onError(error); }
    finally { if (active === controller) { active = null; schedule(); } }
  };
  const visibility = () => {
    if (timer !== null) clearTimer(timer); timer = null;
    if (documentRef.hidden) { active?.abort(); active = null; }
    else void tick();
  };
  documentRef.addEventListener('visibilitychange', visibility);
  schedule();
  return () => { disposed = true; if (timer !== null) clearTimer(timer); active?.abort(); documentRef.removeEventListener('visibilitychange', visibility); };
}
