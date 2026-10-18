import { appUrl } from './appUrl.js';

export const NPC_CHAT_MAX_CHARS = 600;
export const NPC_SPEECH_MAX_BYTES = 2 * 1024 * 1024;

const ERROR_MESSAGES = {
  NOT_CONFIGURED: 'AI 聊天还未配置完成，可以先浏览上方的固定台词。',
  NPC_CHAT_DISABLED: 'AI 聊天还未配置完成，可以先浏览上方的固定台词。',
  CHAT_DISABLED: 'AI 聊天还未配置完成，可以先浏览上方的固定台词。',
  RATE_LIMITED: '说得有点快，请稍等片刻再重试。',
  TOO_MANY_REQUESTS: '说得有点快，请稍等片刻再重试。',
  REQUEST_IN_PROGRESS: '这条消息还在处理，稍等后可重试同一条消息。',
  NPC_CHAT_IN_FLIGHT: '上一条消息还在处理，请稍等片刻后重试。',
  NPC_CHAT_TIMEOUT: '等候时间较长，暂未收到回复。可以重试这条消息。',
  CONVERSATION_NOT_FOUND: '这段对话已过期，请重新连接对话。',
  CONVERSATION_EXPIRED: '这段对话已过期，请重新连接对话。',
  CONVERSATION_FORBIDDEN: '暂时无法继续这段对话，请重新连接。',
  INVALID_MESSAGE: '消息需要包含 1–600 个字符，且不能含有特殊控制字符。',
  INVALID_GUEST: '聊天身份已过期，请重新连接对话。',
  REQUEST_ID_REUSED: '这条消息的标识已失效，请重新连接后再发送。',
  INVALID_TOKEN: '聊天身份已过期，请重新打开居民册后再试。',
  UNAUTHORIZED: '聊天身份已过期，请重新打开居民册后再试。',
};

export class NpcChatError extends Error {
  constructor(code, message, { status = 0, retryable = true } = {}) {
    super(message);
    this.name = 'NpcChatError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function canceled() {
  return Object.assign(new Error('对话请求已取消。'), { name: 'AbortError' });
}

export function createNpcChatRequest({ npcId, message, conversationId }, createId = () => crypto.randomUUID()) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!/^[a-z0-9-]{1,80}$/.test(npcId ?? '') || !text || text.length > NPC_CHAT_MAX_CHARS) {
    throw new NpcChatError('INVALID_INPUT', `请输入 1–${NPC_CHAT_MAX_CHARS} 字的消息。`, { retryable: false });
  }
  if (conversationId !== undefined && (typeof conversationId !== 'string' || !conversationId || conversationId.length > 160)) {
    throw new NpcChatError('INVALID_INPUT', '对话标识无效，请重新连接对话。', { retryable: false });
  }
  return Object.freeze({ npcId, message: text, ...(conversationId ? { conversationId } : {}), requestId: createId() });
}

// One client keeps a guest identity in memory only. Chat requests are deliberately
// never retried here: the UI must explicitly resend the same immutable request.
export function createNpcChatClient({ fetchImpl = (...args) => fetch(...args), timeoutMs = 45000, statusTimeoutMs = 10000, speechTimeoutMs = 40000 } = {}) {
  let guest = null;

  async function request(path, { body, signal, timeout = timeoutMs, audio = false } = {}) {
    if (signal?.aborted) throw canceled();
    const controller = new AbortController();
    let timedOut = false;
    let rejectStopped;
    const stopped = new Promise((_, reject) => { rejectStopped = reject; });
    // Keep the whole fetch/body-read bounded, including custom transports which
    // do not reject their pending body reader when fetch's signal is aborted.
    const guarded = operation => Promise.race([operation, stopped]);
    const abort = () => { controller.abort(); rejectStopped(canceled()); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); rejectStopped(new NpcChatError('TIMEOUT', '请求超时。')); }, timeout);
    try {
      const response = await guarded(fetchImpl(appUrl(path), {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: audio ? 'audio/mpeg, application/json' : 'application/json', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        credentials: 'same-origin',
        cache: 'no-store',
      }));
      let data;
      if (audio && response.ok) {
        if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'audio/mpeg'
          || Number(response.headers.get('content-length')) > NPC_SPEECH_MAX_BYTES || !response.body?.getReader) {
          void response.body?.cancel().catch(() => {});
          throw new NpcChatError('INVALID_AUDIO', '语音格式或大小不正确，请稍后重试。');
        }
        const reader = response.body.getReader();
        const chunks = [];
        let bytes = 0;
        try {
          for (;;) {
            const item = await guarded(reader.read());
            if (item.done) break;
            bytes += item.value.byteLength;
            if (bytes > NPC_SPEECH_MAX_BYTES) throw new NpcChatError('INVALID_AUDIO', '语音文件过大，请稍后重试。');
            if (signal?.aborted) throw canceled();
            chunks.push(item.value);
          }
          if (!bytes) throw new NpcChatError('INVALID_AUDIO', '没有收到可播放的语音，请稍后重试。');
          data = new Blob(chunks, { type: 'audio/mpeg' });
        } catch (error) {
          void reader.cancel().catch(() => {});
          throw error;
        } finally { reader.releaseLock(); }
      } else data = await guarded(response.json().catch(() => null));
      if (signal?.aborted) throw canceled();
      if (timedOut) throw new NpcChatError('TIMEOUT', '等候时间较长，暂未收到回复。可重试这条消息，不会自动重发。');
      if (!response.ok) {
        const code = typeof data?.code === 'string' ? data.code : 'SERVICE_ERROR';
        if (response.status === 401) guest = null;
        const speechMessage = code === 'NPC_SPEECH_ANIMAL_AUDIO_PENDING' ? '这位动物伙伴的叫声音效还未就绪，可以先阅读文字回复。'
          : code === 'NPC_SPEECH_VOICE_PENDING' ? '这位居民的配音身份还待确认，暂不套用其他角色的声音；文字聊天仍可使用。'
          : code === 'CONVERSATION_EXPIRED' || code === 'NPC_SPEECH_REPLY_NOT_FOUND'
          ? '这条回复已过期，暂时无法生成语音。请继续聊天获取新回复。'
          : response.status === 401 || response.status === 403 ? '语音身份已失效，请重新连接对话。'
            : response.status === 429 ? '语音服务正忙，请稍等后再点击播放。'
              : response.status === 503 ? '语音服务尚未启用，文字聊天仍可使用。'
                : '语音暂时生成失败，请稍后再点击播放。';
        const message = audio ? speechMessage : ERROR_MESSAGES[code] || (response.status === 429
          ? '现在聊天的人较多，请稍等片刻再重试。'
          : response.status === 503 ? 'AI 聊天暂时不可用，可以先浏览上方的固定台词。'
            : '暂时没有收到回复，请稍后重试。');
        throw new NpcChatError(code, message, { status: response.status, retryable: ![400, 401, 403, 404].includes(response.status) && code !== 'REQUEST_ID_REUSED' });
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new NpcChatError('INVALID_RESPONSE', '聊天服务返回了无法识别的结果，请稍后重试。');
      return data;
    } catch (error) {
      if (signal?.aborted) throw canceled();
      if (timedOut) throw new NpcChatError('TIMEOUT', audio ? '语音生成超时，请稍后再点击播放；不会自动重试。' : '等候时间较长，暂未收到回复。可重试这条消息，不会自动重发。');
      if (error instanceof NpcChatError) throw error;
      throw new NpcChatError('NETWORK_ERROR', audio ? '语音连接中断，请检查网络后再点击播放。' : '连接中断，暂未收到回复。请检查网络后重试这条消息。');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async function ensureGuest(signal) {
    if (signal?.aborted) throw canceled();
    if (!guest || guest.expiresAt <= Date.now() + 60000) {
      const data = await request('/api/guest', { body: { name: '小镇旅人', ...(guest?.token ? { token: guest.token } : {}) }, signal, timeout: statusTimeoutMs });
      if (typeof data.token !== 'string' || !data.token || !Number.isFinite(data.expiresAt)) throw new NpcChatError('INVALID_RESPONSE', '暂时无法建立聊天身份，请稍后重试。');
      guest = { token: data.token, expiresAt: data.expiresAt };
    }
    return guest.token;
  }

  return {
    async status({ signal } = {}) {
      const data = await request('/api/npc/chat/status', { signal, timeout: statusTimeoutMs });
      if (typeof data.enabled !== 'boolean' || typeof data.model !== 'string' || !data.model || typeof data.provider !== 'string') {
        throw new NpcChatError('INVALID_RESPONSE', '暂时无法确认 AI 聊天状态，请稍后重新检查。');
      }
      return { enabled: data.enabled, model: data.model, provider: data.provider, maxMessageChars: Math.min(NPC_CHAT_MAX_CHARS, Number.isInteger(data.maxMessageChars) && data.maxMessageChars > 0 ? data.maxMessageChars : NPC_CHAT_MAX_CHARS) };
    },
    async send(chatRequest, { signal } = {}) {
      const token = await ensureGuest(signal);
      const data = await request('/api/npc/chat', { body: { ...chatRequest, token }, signal });
      if (typeof data.reply !== 'string' || !data.reply.trim() || data.reply.length > 12000
        || typeof data.conversationId !== 'string' || !data.conversationId || data.conversationId.length > 160
        || data.requestId !== chatRequest.requestId || data.npcId !== chatRequest.npcId || typeof data.model !== 'string') {
        throw new NpcChatError('INVALID_RESPONSE', '聊天服务返回了无法识别的结果，请重试这条消息。');
      }
      return { reply: data.reply.trim(), conversationId: data.conversationId, requestId: data.requestId, npcId: data.npcId, model: data.model };
    },
    async speechStatus({ signal, npcId } = {}) {
      if (npcId !== undefined && (typeof npcId !== 'string' || !/^npc-[a-z0-9-]{1,60}$/.test(npcId))) throw new NpcChatError('INVALID_INPUT', '居民语音标识无效。', { retryable: false });
      const data = await request(`/api/npc/speech/status${npcId ? `?npcId=${encodeURIComponent(npcId)}` : ''}`, { signal, timeout: statusTimeoutMs });
      if (typeof data.enabled !== 'boolean' || !['Doubao', ...(npcId ? ['Local'] : [])].includes(data.provider) || !Number.isInteger(data.maxTextChars) || data.maxTextChars < 1) throw new NpcChatError('INVALID_RESPONSE', '暂时无法确认语音服务状态。');
      if (npcId !== undefined && (data.npcId !== npcId || typeof data.voiceReady !== 'boolean' || !['speech', 'animal'].includes(data.voiceKind) || (data.voiceLabel !== null && (typeof data.voiceLabel !== 'string' || data.voiceLabel.length > 80)))) throw new NpcChatError('INVALID_RESPONSE', '暂时无法确认这位居民的配音状态。');
      return { enabled: data.enabled, provider: data.provider, maxTextChars: Math.min(data.maxTextChars, 420), ...(npcId ? { voiceReady: data.voiceReady, voiceLabel: data.voiceLabel, voiceKind: data.voiceKind, reason: ['voice-pending', 'animal-audio-pending'].includes(data.reason) ? data.reason : null } : {}) };
    },
    async speech({ npcId, conversationId, requestId }, { signal } = {}) {
      if (![npcId, conversationId, requestId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value))) throw new NpcChatError('INVALID_INPUT', '这条回复缺少语音标识，请继续聊天获取新回复。', { retryable: false });
      const token = await ensureGuest(signal);
      return request('/api/npc/speech', { body: { token, npcId, conversationId, requestId }, signal, timeout: speechTimeoutMs, audio: true });
    },
    async greetingSpeech({ npcId }, { signal } = {}) {
      if (typeof npcId !== 'string' || !/^npc-[a-z0-9-]{1,60}$/.test(npcId)) throw new NpcChatError('INVALID_INPUT', '居民语音标识无效。', { retryable: false });
      const token = await ensureGuest(signal);
      return request('/api/npc/speech/greeting', { body: { token, npcId }, signal, timeout: speechTimeoutMs, audio: true });
    },
  };
}

export const npcChatClient = createNpcChatClient();
