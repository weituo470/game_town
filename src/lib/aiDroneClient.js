import { appUrl } from './appUrl.js';

export const AI_DRONE_MAX_PROMPT = 400;
export const AI_DRONE_GUEST_KEY = 'game-town.ai-drone.guest.v1';
const MAX_RESPONSE_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES = {
  INVALID_INPUT: '请填写 1–400 字的主题，或切换到即兴创作。',
  DISABLED: 'AI 编导暂未开放，仍可回放已保存的节目。',
  EXPIRED: '游客身份已失效。本次没有自动重试，请重新点击生成。',
  LIMITED: '今日额度已用完，或当前请求较多；请稍后再来。',
  TIMEOUT: '等候超时，未自动重试。此次调用可能已计入今日额度。',
  NETWORK_ERROR: '连接中断，未自动重试。请检查网络；此次调用可能已计入额度。',
  INVALID_RESPONSE: '暂未取得可用的节目，已保留上一份作品；不会自动重试。',
  SERVICE_ERROR: '本次编导未完成；如有上一份作品仍可回放，不会自动重试。',
  INVALID_SCORE: 'AI 返回的节目格式不合规，已安全拦截，未启动演出。本次计入额度，不会自动重试。',
  UPSTREAM: 'AI 服务本次未完成响应。本次计入额度，不会自动重试；如有已保存节目仍可回放。',
  STORAGE_UNAVAILABLE: '浏览器无法保存游客身份，请允许本机存储后再生成。',
  IN_FLIGHT: '已有一份节目正在生成，请等待完成或先取消。',
};

export class AiDroneClientError extends Error {
  constructor(code, { status = 0, usage = null } = {}) {
    super(MESSAGES[code] || MESSAGES.SERVICE_ERROR);
    this.name = 'AiDroneClientError';
    this.code = code;
    this.status = status;
    this.usage = usage;
  }
}

const canceled = () => Object.assign(new Error('已取消等待。此次调用可能已计入今日额度。'), { name: 'AbortError' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, required = true) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
const sessionStorageOrNull = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };

export function createAiDroneRequest({ mode, prompt = '' }, createId = () => crypto.randomUUID()) {
  if (!['prompt', 'improv'].includes(mode) || typeof prompt !== 'string') throw new AiDroneClientError('INVALID_INPUT');
  const cleaned = prompt.trim();
  if (cleaned.length > AI_DRONE_MAX_PROMPT || (mode === 'prompt' && !cleaned) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned)) throw new AiDroneClientError('INVALID_INPUT');
  const requestId = createId();
  if (!UUID.test(requestId)) throw new AiDroneClientError('INVALID_INPUT');
  return Object.freeze({ mode, prompt: cleaned, requestId });
}

export function readAiDroneUsage(value) {
  if (!object(value) || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 1000
    || !Number.isInteger(value.used) || value.used < 0 || value.used > value.limit
    || !Number.isInteger(value.remaining) || value.remaining !== value.limit - value.used) return null;
  const resetAt = typeof value.resetAt === 'string' ? Date.parse(value.resetAt) : value.resetAt;
  if (!Number.isSafeInteger(resetAt) || resetAt <= 0) return null;
  return { limit: value.limit, used: value.used, remaining: value.remaining, resetAt };
}

export function createAiDroneClient({ fetchImpl = (...args) => fetch(...args), storage = sessionStorageOrNull(), now = Date.now, timeoutMs = 60000, statusTimeoutMs = 10000, resolveUrl = appUrl } = {}) {
  let guest = null;
  let generating = false;
  try {
    const raw = storage?.getItem(AI_DRONE_GUEST_KEY);
    const data = raw && raw.length <= 2048 ? JSON.parse(raw) : null;
    if (object(data) && text(data.token, 1024) && Number.isSafeInteger(data.expiresAt) && data.expiresAt > 0) guest = { token: data.token, expiresAt: data.expiresAt };
  } catch { /* A corrupt optional session never reaches the provider. */ }

  function invalidateGuest() {
    guest = null;
    try { storage?.removeItem(AI_DRONE_GUEST_KEY); } catch { /* Read-only storage is handled before the next generation. */ }
  }

  async function request(path, { body, signal, timeout = statusTimeoutMs } = {}) {
    if (signal?.aborted) throw canceled();
    const controller = new AbortController();
    let timedOut = false;
    let rejectStopped;
    const stopped = new Promise((_, reject) => { rejectStopped = reject; });
    const guarded = operation => Promise.race([operation, stopped]);
    const abort = () => { controller.abort(); rejectStopped(canceled()); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); rejectStopped(new AiDroneClientError('TIMEOUT')); }, timeout);
    let reader;
    try {
      const response = await guarded(fetchImpl(resolveUrl(path), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
      }));
      if (Number(response.headers?.get('content-length')) > MAX_RESPONSE_BYTES) throw new AiDroneClientError('INVALID_RESPONSE');
      let raw = '';
      if (response.body?.getReader) {
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        for (;;) {
          const chunk = await guarded(reader.read());
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) throw new AiDroneClientError('INVALID_RESPONSE');
          raw += decoder.decode(chunk.value, { stream: true });
        }
        raw += decoder.decode();
      } else raw = await guarded(response.text());
      if (raw.length > MAX_RESPONSE_BYTES) throw new AiDroneClientError('INVALID_RESPONSE');
      let data;
      try { data = JSON.parse(raw); } catch { throw new AiDroneClientError('INVALID_RESPONSE'); }
      if (signal?.aborted) throw canceled();
      if (!response.ok) {
        if (response.status === 401) invalidateGuest();
        const code = response.status === 401 ? 'EXPIRED' : response.status === 429 ? 'LIMITED'
          : data?.code === 'AI_DRONE_DISABLED' ? 'DISABLED' : data?.code === 'AI_DRONE_IN_FLIGHT' ? 'IN_FLIGHT'
            : data?.code === 'AI_DRONE_INVALID_SCORE' ? 'INVALID_SCORE' : data?.code === 'AI_DRONE_UPSTREAM' ? 'UPSTREAM' : response.status === 504 ? 'TIMEOUT'
            : response.status === 400 ? 'INVALID_INPUT' : 'SERVICE_ERROR';
        throw new AiDroneClientError(code, { status: response.status, usage: readAiDroneUsage(data?.usage) });
      }
      if (!object(data)) throw new AiDroneClientError('INVALID_RESPONSE');
      return data;
    } catch (error) {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      if (signal?.aborted) throw canceled();
      if (timedOut) throw new AiDroneClientError('TIMEOUT');
      if (error instanceof AiDroneClientError) throw error;
      throw new AiDroneClientError('NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reader?.releaseLock();
    }
  }

  async function ensureGuest(signal) {
    if (signal?.aborted) throw canceled();
    if (guest && guest.expiresAt > now()) return guest.token;
    if (!storage) throw new AiDroneClientError('STORAGE_UNAVAILABLE');
    const data = await request('/api/guest', { body: { name: '无人机编导', ...(guest?.token ? { token: guest.token } : {}) }, signal });
    if (!text(data.token, 1024) || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now()) throw new AiDroneClientError('INVALID_RESPONSE');
    const next = { token: data.token, expiresAt: data.expiresAt };
    try { storage.setItem(AI_DRONE_GUEST_KEY, JSON.stringify(next)); } catch { throw new AiDroneClientError('STORAGE_UNAVAILABLE'); }
    guest = next;
    return guest.token;
  }

  return {
    async status({ signal } = {}) {
      const data = await request('/api/drone-director/status', { signal });
      if (typeof data.enabled !== 'boolean') throw new AiDroneClientError('INVALID_RESPONSE');
      return { enabled: data.enabled, provider: text(data.provider, 80, false) ? data.provider : 'DeepSeek', model: text(data.model, 120, false) ? data.model : '' };
    },
    async usage({ signal } = {}) {
      if (signal?.aborted) throw canceled();
      if (!guest || guest.expiresAt <= now()) return null;
      const data = await request('/api/drone-director/usage', { body: { token: guest.token }, signal });
      const usage = readAiDroneUsage(data.usage ?? data);
      if (!usage) throw new AiDroneClientError('INVALID_RESPONSE');
      return usage;
    },
    async generate(input, { signal, onStage = () => {} } = {}) {
      if (signal?.aborted) throw canceled();
      if (generating) throw new AiDroneClientError('IN_FLIGHT');
      const values = createAiDroneRequest(input, () => input.requestId);
      const operation = new AbortController();
      let totalTimedOut = false;
      const abort = () => operation.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const deadline = setTimeout(() => { totalTimedOut = true; operation.abort(); }, timeoutMs);
      generating = true;
      try {
        onStage('identity');
        const token = await ensureGuest(operation.signal);
        onStage('generating');
        const data = await request('/api/drone-director/generate', { body: { ...values, token }, signal: operation.signal, timeout: timeoutMs });
        const show = data.show;
        const usage = readAiDroneUsage(data.usage);
        if (!object(show) || !text(show.id, 160) || !['prompt', 'improv'].includes(show.mode) || show.mode !== values.mode
          || !text(show.prompt, AI_DRONE_MAX_PROMPT, false) || !text(show.provider, 80) || !text(show.model, 120)
          || !object(show.score) || !usage || typeof data.replayed !== 'boolean') throw new AiDroneClientError('INVALID_RESPONSE');
        const createdAt = typeof show.createdAt === 'string' ? Date.parse(show.createdAt) : show.createdAt;
        if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw new AiDroneClientError('INVALID_RESPONSE');
        onStage('validating');
        return { show: { id: show.id, mode: show.mode, prompt: show.prompt, provider: show.provider, model: show.model, createdAt, score: show.score }, usage, replayed: data.replayed };
      } catch (error) {
        if (signal?.aborted) throw canceled();
        if (totalTimedOut) throw new AiDroneClientError('TIMEOUT');
        throw error;
      } finally {
        clearTimeout(deadline);
        signal?.removeEventListener('abort', abort);
        generating = false;
      }
    },
  };
}
