import { appUrl } from './appUrl.js';

const LIMIT = 128 * 1024;
export function createArchitectClient({ fetchImpl = (...args) => fetch(...args), resolveUrl = appUrl, now = Date.now, timeoutMs } = {}) {
  let guest, pending = false;
  async function request(path, body, signal) {
    const controller = new AbortController();
    const stoppedError = () => Error('等待已结束，不会重复提交。请刷新工程账本确认结果。');
    let rejectStopped;
    const stopped = new Promise((_, reject) => { rejectStopped = reject; });
    const abort = () => { controller.abort(); rejectStopped(stoppedError()); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const defaultTimeout = body ? 60000 : 10000;
    const duration = Number.isFinite(timeoutMs) && timeoutMs >= 1 ? Math.min(defaultTimeout, timeoutMs) : defaultTimeout;
    const timer = setTimeout(abort, duration);
    let reader;
    const cancelBody = response => { try { Promise.resolve(response.body?.cancel?.()).catch(() => {}); } catch { /* already closed */ } };
    try {
      const operation = (async () => {
        if (controller.signal.aborted) throw stoppedError();
        const response = await fetchImpl(resolveUrl(path), {
          method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
          headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal,
        });
        if (controller.signal.aborted) { cancelBody(response); throw stoppedError(); }
        if (Number(response.headers?.get?.('content-length')) > LIMIT) { cancelBody(response); throw Error('建筑师响应过大，请稍后刷新。'); }
        let raw = '';
        if (response.body?.getReader) {
          reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0;
          for (;;) {
            const part = await reader.read();
            if (controller.signal.aborted) throw stoppedError();
            if (part.done) break; bytes += part.value.byteLength;
            if (bytes > LIMIT) throw Error('建筑师响应过大。');
            raw += decoder.decode(part.value, { stream: true });
          }
          raw += decoder.decode();
        } else raw = await response.text();
        if (controller.signal.aborted) throw stoppedError();
        if (new TextEncoder().encode(raw).byteLength > LIMIT) throw Error('建筑师响应过大。');
        const data = JSON.parse(raw);
        if (!response.ok) {
          if (response.status === 401) guest = null;
          throw Object.assign(Error(typeof data.message === 'string' ? data.message.slice(0, 240) : '本次未完成，请检查工程状态后再操作。'), { code: data.code, status: response.status });
        }
        return data;
      })();
      return await Promise.race([operation, stopped]);
    } catch (error) {
      if (controller.signal.aborted) throw stoppedError();
      if (error instanceof SyntaxError || error instanceof TypeError) throw Error('暂时无法连接建筑师，请稍后刷新。');
      throw error;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      // Cleanup must not turn a bounded timeout into an unbounded wait when a
      // custom transport ignores AbortSignal or its cancellation never settles.
      if (reader) {
        try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* closed */ }
        try { reader.releaseLock(); } catch { /* a faulty transport may retain a pending read */ }
      }
    }
  }
  return {
    async status({ signal } = {}) {
      const value = await request('/api/architect/status', undefined, signal);
      if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.projects) || value.projects.length > 32) throw Error('工程账本格式异常，已保留现有建筑。');
      return value;
    },
    async generate({ brief = '', password = '', idempotencyKey = crypto.randomUUID(), signal } = {}) {
      if (pending) throw Error('已有工程正在提交，请稍候。');
      if (typeof brief !== 'string' || brief.length > 200 || typeof password !== 'string' || password.length > 128) throw Error('请检查工程建议或审批密码。');
      pending = true;
      try {
        if (!guest || guest.expiresAt <= now()) guest = await request('/api/guest', { name: '小镇建设者' }, signal);
        if (typeof guest?.token !== 'string' || !Number.isFinite(guest.expiresAt)) throw Error('未能取得游客身份。');
        return await request('/api/architect/generate', { token: guest.token, idempotencyKey, brief, ...(password ? { password } : {}) }, signal);
      } finally { pending = false; }
    },
  };
}
export const architectClient = createArchitectClient();
