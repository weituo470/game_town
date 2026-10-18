import { randomUUID } from 'node:crypto';
import { buildNpcMessages, getNpcPersona } from './npcPersonas.js';

export const NPC_CHAT_LIMITS = Object.freeze({
  messageChars: 600,
  replyChars: 1600,
  historyMessages: 12,
  sessionTtlMs: 30 * 60 * 1000,
  cleanupIntervalMs: 60 * 1000,
  sessions: 200,
  requestsPerSession: 32,
  responseBytes: 64 * 1024,
  concurrentRequests: 4,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,80}$/;
const UNSAFE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export class NpcChatError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'NpcChatError';
    this.status = status;
    this.code = code;
  }
}

const problem = (status, code, message) => new NpcChatError(status, code, message);
const unavailable = () => problem(503, 'NPC_CHAT_DISABLED', '居民聊天尚未配置好，请稍后再来。');
const upstreamFailed = () => problem(502, 'NPC_CHAT_UPSTREAM', '居民暂时没听清，请稍后重试。');

async function readResponseData(response) {
  const advertisedLength = Number(response.headers?.get?.('content-length'));
  if (advertisedLength > NPC_CHAT_LIMITS.responseBytes) {
    response.body?.cancel?.().catch(() => {});
    throw upstreamFailed();
  }
  if (!response.body?.getReader) {
    // Injectable test transports may only implement json(); the real fetch path
    // below bounds bytes before allocating/parsing the complete response.
    const data = await response.json();
    if (Buffer.byteLength(JSON.stringify(data) ?? '') > NPC_CHAT_LIMITS.responseBytes) throw upstreamFailed();
    return data;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > NPC_CHAT_LIMITS.responseBytes) {
        reader.cancel().catch(() => {});
        throw upstreamFailed();
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  } finally { reader.releaseLock(); }
}

function configured(config) {
  if (config?.enabled !== true || typeof config.apiKey !== 'string' || !config.apiKey.trim()) return false;
  if (typeof config.model !== 'string' || !/^[A-Za-z0-9._:/-]{1,100}$/.test(config.model)) return false;
  try {
    const url = new URL(config.baseURL);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw problem(400, 'INVALID_REQUEST', '聊天请求格式不正确。');
  const { guestId, npcId, conversationId, requestId, signal } = input;
  if (typeof guestId !== 'string' || !UUID.test(guestId)) throw problem(401, 'INVALID_GUEST', '请重新连接小镇后再聊天。');
  if (typeof npcId !== 'string' || !getNpcPersona(npcId)) throw problem(400, 'INVALID_NPC', '这位居民暂时不在小镇。');
  if (typeof input.message !== 'string') throw problem(400, 'INVALID_MESSAGE', '请输入想对居民说的话。');
  const message = input.message.trim();
  if (!message || Array.from(message).length > NPC_CHAT_LIMITS.messageChars || UNSAFE_CONTROL.test(message)) {
    throw problem(400, 'INVALID_MESSAGE', '消息需要包含 1–600 个字符，且不能含有特殊控制字符。');
  }
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw problem(400, 'INVALID_REQUEST_ID', '消息编号无效，请重新发送。');
  if (conversationId !== undefined && conversationId !== null && (typeof conversationId !== 'string' || !UUID.test(conversationId))) {
    throw problem(400, 'INVALID_CONVERSATION', '对话编号无效，请重新打开居民聊天。');
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw problem(400, 'INVALID_REQUEST', '聊天请求格式不正确。');
  return { guestId, npcId, message, conversationId, requestId, signal };
}

/** A bounded, server-owned conversation store. No client history, tools, or game mutations. */
export function createNpcChatService({ config = {}, fetchImpl = fetch, now = Date.now } = {}) {
  const settings = { ...config };
  const enabled = configured(settings);
  const model = typeof settings.model === 'string' && /^[A-Za-z0-9._:/-]{1,100}$/.test(settings.model) ? settings.model : 'deepseek-flash';
  const timeoutMs = Number.isFinite(settings.timeoutMs) ? Math.max(1, Math.min(60_000, settings.timeoutMs)) : 20_000;
  const maxTokens = Number.isInteger(settings.maxTokens) ? Math.max(1, Math.min(1024, settings.maxTokens)) : 320;
  const sessions = new Map();
  const pairSessions = new Map();
  const inFlight = new Map();
  let closed = false;

  function removeSession(session) {
    sessions.delete(session.id);
    if (pairSessions.get(session.pair) === session.id) pairSessions.delete(session.pair);
  }

  function pruneSessions() {
    const cutoff = now() - NPC_CHAT_LIMITS.sessionTtlMs;
    for (const session of sessions.values()) {
      if (session.touchedAt <= cutoff && inFlight.get(session.guestId)?.sessionId !== session.id) removeSession(session);
    }
  }

  // Expired dialogue must not wait indefinitely for the next visitor to leave
  // memory. This maintenance timer must not keep an otherwise stopped process alive.
  const cleanupTimer = setInterval(pruneSessions, NPC_CHAT_LIMITS.cleanupIntervalMs);
  cleanupTimer.unref?.();

  function obtainSession({ guestId, npcId, conversationId }) {
    pruneSessions();
    if (conversationId) {
      const session = sessions.get(conversationId);
      if (!session) throw problem(404, 'CONVERSATION_EXPIRED', '这段对话已过期，请重新打开居民聊天。');
      if (session.guestId !== guestId || session.npcId !== npcId) throw problem(403, 'CONVERSATION_FORBIDDEN', '无法使用这段对话，请重新打开居民聊天。');
      session.touchedAt = now();
      return session;
    }
    const pair = `${guestId}:${npcId}`;
    const existing = sessions.get(pairSessions.get(pair));
    if (existing) { existing.touchedAt = now(); return existing; }
    if (sessions.size >= NPC_CHAT_LIMITS.sessions) {
      const oldest = [...sessions.values()]
        .filter(session => inFlight.get(session.guestId)?.sessionId !== session.id)
        .sort((a, b) => a.touchedAt - b.touchedAt)[0];
      if (!oldest) throw problem(503, 'NPC_CHAT_CAPACITY', '小镇现在有些热闹，请稍后再聊。');
      removeSession(oldest);
    }
    const session = { id: randomUUID(), pair, guestId, npcId, history: [], touchedAt: now(), requests: new Map() };
    sessions.set(session.id, session);
    pairSessions.set(pair, session.id);
    return session;
  }

  function trimRequests(session) {
    for (const [id, entry] of session.requests) {
      if (session.requests.size <= NPC_CHAT_LIMITS.requestsPerSession) break;
      if (entry.state !== 'pending') session.requests.delete(id);
    }
  }

  async function requestReply({ npcId, history, message, signal, controller }) {
    let abortError;
    let rejectAborted;
    const aborted = new Promise((_, reject) => { rejectAborted = reject; });
    const stop = error => {
      if (abortError) return;
      abortError = error;
      controller.abort();
      rejectAborted(error);
    };
    const onCancel = () => stop(problem(499, 'NPC_CHAT_CANCELLED', '这次聊天已取消。'));
    const onServiceStop = () => {
      if (!abortError) stop(problem(503, 'NPC_CHAT_CLOSED', '居民聊天暂时不可用，请稍后再来。'));
    };
    controller.signal.addEventListener('abort', onServiceStop, { once: true });
    signal?.addEventListener('abort', onCancel, { once: true });
    const timer = setTimeout(() => stop(problem(504, 'NPC_CHAT_TIMEOUT', '居民思考得有点久，请稍后重试。')), timeoutMs);

    // Race the entire operation, including response.json(), not only fetch headers.
    const operation = async () => {
      if (signal?.aborted) { onCancel(); throw abortError; }
      const response = await fetchImpl(`${settings.baseURL.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: buildNpcMessages({ npcId, history, message, worldTimeMs: now() }),
          stream: false,
          thinking: { type: 'disabled' },
          max_tokens: maxTokens,
          temperature: 0.8,
        }),
      });
      if (!response || typeof response.ok !== 'boolean') throw upstreamFailed();
      if (!response.ok) {
        // Never parse or reflect provider error bodies: they can contain credentials or infrastructure details.
        response.body?.cancel?.().catch(() => {});
        if (response.status === 429) throw problem(429, 'NPC_CHAT_BUSY', '居民现在有些忙，请稍后重试。');
        if (response.status === 401 || response.status === 403) throw unavailable();
        throw upstreamFailed();
      }
      const data = await readResponseData(response);
      if (data?.choices?.[0]?.finish_reason === 'length') throw upstreamFailed();
      const responseMessage = data?.choices?.[0]?.message;
      if (!responseMessage || typeof responseMessage.content !== 'string' || responseMessage.tool_calls?.length || responseMessage.function_call) throw upstreamFailed();
      const reply = responseMessage.content.trim();
      if (!reply || Array.from(reply).length > NPC_CHAT_LIMITS.replyChars || UNSAFE_CONTROL.test(reply)) throw upstreamFailed();
      return reply;
    };
    try {
      return await Promise.race([operation(), aborted]);
    } catch (error) {
      if (abortError) throw abortError;
      if (error instanceof NpcChatError) throw error;
      throw upstreamFailed();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCancel);
      controller.signal.removeEventListener('abort', onServiceStop);
    }
  }

  async function chat(input) {
    if (closed) throw problem(503, 'NPC_CHAT_CLOSED', '居民聊天暂时不可用，请稍后再来。');
    if (!enabled) throw unavailable();
    const values = validateInput(input);
    if (values.signal?.aborted) throw problem(499, 'NPC_CHAT_CANCELLED', '这次聊天已取消。');
    const session = obtainSession(values);
    const previous = session.requests.get(values.requestId);
    if (previous && previous.message !== values.message) throw problem(409, 'REQUEST_ID_REUSED', '这条消息的编号已使用，请重新发送。');
    if (previous?.state === 'done') return { ...previous.result };
    // Do not attach another HTTP caller to the first caller's cancellation
    // lifetime. A completed retry is cached; an in-flight retry must wait.
    if (previous?.state === 'pending') throw problem(429, 'NPC_CHAT_IN_FLIGHT', '请先等居民说完上一句话。');
    if (inFlight.has(values.guestId)) throw problem(429, 'NPC_CHAT_IN_FLIGHT', '请先等居民说完上一句话。');
    if (inFlight.size >= NPC_CHAT_LIMITS.concurrentRequests) throw problem(503, 'NPC_CHAT_CAPACITY', '小镇现在有些热闹，请稍后再聊。');

    const controller = new AbortController();
    const flight = { sessionId: session.id, controller };
    const entry = { message: values.message, state: 'pending', promise: null, result: null };
    session.requests.set(values.requestId, entry);
    trimRequests(session);
    inFlight.set(values.guestId, flight);
    entry.promise = (async () => {
      try {
        const reply = await requestReply({ ...values, history: session.history.map(item => ({ ...item })), controller });
        if (closed) throw problem(503, 'NPC_CHAT_CLOSED', '居民聊天暂时不可用，请稍后再来。');
        session.history.push({ role: 'user', content: values.message }, { role: 'assistant', content: reply });
        session.history = session.history.slice(-NPC_CHAT_LIMITS.historyMessages);
        session.touchedAt = now();
        entry.result = Object.freeze({ conversationId: session.id, requestId: values.requestId, npcId: values.npcId, model, reply });
        entry.state = 'done';
        return entry.result;
      } catch (error) {
        // A failed attempt may retry the same payload, but cannot reuse its ID for a different message.
        entry.state = 'failed';
        throw error;
      } finally {
        if (inFlight.get(values.guestId) === flight) inFlight.delete(values.guestId);
        trimRequests(session);
      }
    })();
    return { ...await entry.promise };
  }

  // Speech is authorized by a previously completed server-owned reply, never
  // by client-supplied text. A read must not create or keep a conversation alive.
  function getReplyForSpeech(input) {
    if (closed) throw problem(503, 'NPC_CHAT_CLOSED', '居民聊天暂时不可用，请稍后再来。');
    pruneSessions();
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw problem(400, 'INVALID_REQUEST', '语音请求格式不正确。');
    const { guestId, npcId, conversationId, requestId } = input;
    if (typeof guestId !== 'string' || !UUID.test(guestId)) throw problem(401, 'INVALID_GUEST', '请重新连接小镇后再聊天。');
    if (typeof npcId !== 'string' || !getNpcPersona(npcId)) throw problem(400, 'INVALID_NPC', '这位居民暂时不在小镇。');
    if (typeof conversationId !== 'string' || !UUID.test(conversationId)) throw problem(400, 'INVALID_CONVERSATION', '对话编号无效，请重新打开居民聊天。');
    if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw problem(400, 'INVALID_REQUEST_ID', '消息编号无效，请重新发送。');
    const session = sessions.get(conversationId);
    if (!session || session.touchedAt <= now() - NPC_CHAT_LIMITS.sessionTtlMs) {
      throw problem(404, 'CONVERSATION_EXPIRED', '这段对话已过期，请重新打开居民聊天。');
    }
    if (session.guestId !== guestId || session.npcId !== npcId) {
      throw problem(403, 'CONVERSATION_FORBIDDEN', '无法使用这段对话，请重新打开居民聊天。');
    }
    const entry = session.requests.get(requestId);
    if (entry?.state !== 'done' || typeof entry.result?.reply !== 'string') {
      throw problem(404, 'REPLY_NOT_FOUND', '这句居民回复暂时无法播放，请选择已完成的回复。');
    }
    return Object.freeze({
      reply: entry.result.reply,
      npcId: session.npcId,
      conversationId: session.id,
      requestId,
    });
  }

  return {
    status: () => ({ enabled: enabled && !closed, model, provider: 'DeepSeek', maxMessageChars: NPC_CHAT_LIMITS.messageChars }),
    chat,
    getReplyForSpeech,
    close() {
      closed = true;
      clearInterval(cleanupTimer);
      for (const flight of inFlight.values()) flight.controller.abort();
      sessions.clear();
      pairSessions.clear();
    },
  };
}
