import { createHash, randomUUID } from 'node:crypto';
import { getNpcPersona } from './npcPersonas.js';
import { getNpcVoice, getNpcVoiceKind, npcVoiceFingerprint, NPC_VOICE_RESOURCE } from './npcVoices.js';
import { getNpcAnimalVoice } from './npcAnimalAudio.js';
import { NPC_MAP } from '../src/lib/npcCatalog.js';

export const NPC_SPEECH_LIMITS = Object.freeze({
  textChars: 420,
  upstreamBytes: 8 * 1024 * 1024,
  eventBytes: 512 * 1024,
  audioBytes: 2 * 1024 * 1024,
  events: 4096,
  concurrentRequests: 2,
  cacheBytes: 24 * 1024 * 1024,
  cacheItems: 12,
  cacheTtlMs: 10 * 60 * 1000,
  cleanupIntervalMs: 60 * 1000,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,80}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';

export class NpcSpeechError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'NpcSpeechError';
    this.status = status;
    this.code = code;
  }
}

const problem = (status, code, message) => new NpcSpeechError(status, code, message);
const unavailable = () => problem(503, 'NPC_SPEECH_DISABLED', '居民语音暂未启用，可以继续阅读文字回复。');
const upstreamFailed = () => problem(502, 'NPC_SPEECH_UPSTREAM', '这次语音没有生成完整，请稍后重试。');
const invalidAudio = () => problem(502, 'NPC_SPEECH_INVALID_AUDIO', '这次语音格式不完整，请稍后重试。');

function configured(config) {
  return config?.enabled === true && typeof config.apiKey === 'string' && config.apiKey.trim().length > 0
    && config.apiKey.length <= 2048 && !/[\r\n]/.test(config.apiKey)
    && config.endpoint === ENDPOINT && config.resourceId === NPC_VOICE_RESOURCE;
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw problem(400, 'NPC_SPEECH_INVALID_REQUEST', '语音请求格式不正确。');
  const { guestId, npcId, conversationId, requestId, signal } = input;
  if (typeof guestId !== 'string' || !UUID.test(guestId)) throw problem(401, 'NPC_SPEECH_INVALID_GUEST', '请重新连接居民对话后再试听。');
  if (typeof npcId !== 'string' || !getNpcPersona(npcId)) throw problem(400, 'NPC_SPEECH_INVALID_NPC', '这位居民暂时不在小镇。');
  if (typeof conversationId !== 'string' || !UUID.test(conversationId)) throw problem(400, 'NPC_SPEECH_INVALID_CONVERSATION', '请先让居民回复一句话，再点击试听。');
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw problem(400, 'NPC_SPEECH_INVALID_REQUEST_ID', '这条回复的语音标识无效，请重新打开对话。');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw problem(400, 'NPC_SPEECH_INVALID_REQUEST', '语音请求格式不正确。');
  return { guestId, npcId, conversationId, requestId, signal };
}

// Structural MPEG Layer III validation, not a substitute for real decoder/browser
// acceptance. Require every frame to be complete; reject header-only fake MP3s.
function validateMp3(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 256 || audio.length > NPC_SPEECH_LIMITS.audioBytes) throw invalidAudio();
  let offset = 0;
  let end = audio.length;
  if (audio.subarray(0, 3).toString('ascii') === 'ID3') {
    if (audio.length < 10 || ![2, 3, 4].includes(audio[3]) || audio.subarray(6, 10).some(byte => byte > 127)) throw invalidAudio();
    const tagSize = (audio[6] << 21) | (audio[7] << 14) | (audio[8] << 7) | audio[9];
    offset = 10 + tagSize + (audio[3] === 4 && (audio[5] & 0x10) ? 10 : 0);
    if (offset >= end) throw invalidAudio();
  }
  if (end - offset >= 128 && audio.subarray(end - 128, end - 125).toString('ascii') === 'TAG') end -= 128;
  let frames = 0;
  let sampleRate = 0;
  while (offset < end) {
    if (offset + 4 > end || audio[offset] !== 0xff || (audio[offset + 1] & 0xe0) !== 0xe0) throw invalidAudio();
    const version = (audio[offset + 1] >> 3) & 3;
    const layer = (audio[offset + 1] >> 1) & 3;
    const bitrateIndex = audio[offset + 2] >> 4;
    const frequencyIndex = (audio[offset + 2] >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || frequencyIndex === 3) throw invalidAudio();
    const rate = [44100, 48000, 32000][frequencyIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    if (sampleRate && sampleRate !== rate) throw invalidAudio();
    sampleRate = rate;
    const bitrates = version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const length = Math.floor((version === 3 ? 144000 : 72000) * bitrates[bitrateIndex] / rate) + ((audio[offset + 2] >> 1) & 1);
    if (length < 4 || offset + length > end) throw invalidAudio();
    offset += length;
    frames += 1;
  }
  if (offset !== end || frames < 2 || sampleRate !== 24000) throw invalidAudio();
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length > NPC_SPEECH_LIMITS.eventBytes || !value.length
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw upstreamFailed();
  const audio = Buffer.from(value, 'base64');
  if (!audio.length || audio.toString('base64') !== value) throw upstreamFailed();
  return audio;
}

async function readSseAudio(response, signal) {
  if (!response.body?.getReader || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers?.get?.('content-type') || '')) {
    response.body?.cancel?.().catch(() => {});
    throw upstreamFailed();
  }
  const length = Number(response.headers.get('content-length'));
  if (length > NPC_SPEECH_LIMITS.upstreamBytes) { response.body.cancel().catch(() => {}); throw upstreamFailed(); }
  const reader = response.body.getReader();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks = [];
  let buffer = '';
  let bytes = 0;
  let audioBytes = 0;
  let events = 0;
  let completed = false;
  let reachedEnd = false;

  function event(block) {
    if (Buffer.byteLength(block) > NPC_SPEECH_LIMITS.eventBytes) throw upstreamFailed();
    const lines = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, ''));
    if (!lines.length) return;
    if (++events > NPC_SPEECH_LIMITS.events) throw upstreamFailed();
    const data = JSON.parse(lines.join('\n'));
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.code !== 'number' || ![0, 20000000].includes(data.code) || completed) throw upstreamFailed();
    if (data.data !== undefined && data.data !== null && data.data !== '') {
      const audio = decodeBase64(data.data);
      audioBytes += audio.length;
      if (audioBytes > NPC_SPEECH_LIMITS.audioBytes) throw upstreamFailed();
      chunks.push(audio);
    }
    if (data.code === 20000000) completed = true;
  }

  function consume() {
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(buffer);
      if (!boundary) break;
      event(buffer.slice(0, boundary.index));
      buffer = buffer.slice(boundary.index + boundary[0].length);
    }
    if (Buffer.byteLength(buffer) > NPC_SPEECH_LIMITS.eventBytes) throw upstreamFailed();
  }

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) { reachedEnd = true; break; }
      bytes += value.byteLength;
      if (bytes > NPC_SPEECH_LIMITS.upstreamBytes) throw upstreamFailed();
      buffer += decoder.decode(value, { stream: true });
      consume();
    }
    if (signal.aborted) throw upstreamFailed();
    buffer += decoder.decode();
    consume();
    if (buffer.trim()) event(buffer);
    if (!completed || !chunks.length) throw upstreamFailed();
    const audio = Buffer.concat(chunks, audioBytes);
    validateMp3(audio);
    return audio;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!reachedEnd) cancel();
    reader.releaseLock();
  }
}

/** Authenticated completed replies or allowlisted fixed greetings; never browser text/voices. */
export function createNpcSpeechService({ config = {}, fetchImpl = fetch, now = Date.now, resolveReply, animalAudioLoader = getNpcAnimalVoice } = {}) {
  const settings = { ...config };
  const enabled = configured(settings) && typeof resolveReply === 'function';
  const timeoutMs = Number.isFinite(settings.timeoutMs) ? Math.min(30_000, Math.max(1, settings.timeoutMs)) : 30_000;
  const cache = new Map();
  const flights = new Map();
  let cacheBytes = 0;
  let closed = false;

  function animalAudio(npcId) {
    try {
      const value = animalAudioLoader(npcId);
      if (!value || !Buffer.isBuffer(value.audio) || !value.audio.length || value.audio.length > 256 * 1024) return null;
      validateMp3(value.audio);
      return value;
    } catch { return null; }
  }

  function drop(key) {
    const entry = cache.get(key);
    if (entry) { cacheBytes -= entry.audio.length; cache.delete(key); }
  }

  function prune() {
    for (const [key, entry] of cache) if (entry.expiresAt <= now()) drop(key);
  }

  const cleanupTimer = setInterval(prune, NPC_SPEECH_LIMITS.cleanupIntervalMs);
  cleanupTimer.unref?.();

  function authorizedReply(values) {
    if (typeof resolveReply !== 'function') throw unavailable();
    let reply;
    try { reply = resolveReply({ guestId: values.guestId, npcId: values.npcId, conversationId: values.conversationId, requestId: values.requestId }); }
    catch (error) {
      if (error?.status === 403) throw problem(403, 'NPC_SPEECH_FORBIDDEN', '无法试听这段对话，请重新打开自己的居民对话。');
      throw problem(404, 'NPC_SPEECH_REPLY_EXPIRED', '这条回复已过期或尚未完成，请先让居民重新回复。');
    }
    if (!reply || typeof reply !== 'object' || typeof reply.then === 'function') throw problem(404, 'NPC_SPEECH_REPLY_EXPIRED', '这条回复已过期或尚未完成，请先让居民重新回复。');
    if (reply.npcId !== values.npcId || reply.requestId !== values.requestId || reply.conversationId !== values.conversationId) throw problem(403, 'NPC_SPEECH_FORBIDDEN', '无法试听这段对话，请重新打开自己的居民对话。');
    if (typeof reply.reply !== 'string' || !reply.reply.trim() || CONTROL.test(reply.reply)) throw problem(400, 'NPC_SPEECH_INVALID_REPLY', '这条回复暂时不能朗读，请尝试新的简短对话。');
    const text = reply.reply.trim();
    if (Array.from(text).length > NPC_SPEECH_LIMITS.textChars) throw problem(400, 'NPC_SPEECH_REPLY_TOO_LONG', '这条回复超过 420 字，请先让居民简短回答再试听。');
    return text;
  }

  function fixedGreeting(values) {
    const text = NPC_MAP[values.npcId]?.dialogue.greeting;
    if (typeof text !== 'string' || !text.trim() || CONTROL.test(text) || Array.from(text).length > NPC_SPEECH_LIMITS.textChars) {
      throw problem(400, 'NPC_SPEECH_INVALID_NPC', '这位居民暂时没有可播报的问候。');
    }
    return text.trim();
  }

  async function generate(values, text, voice, controller) {
    let abortError;
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const stop = error => {
      if (abortError) return;
      abortError = error;
      controller.abort();
      rejectAbort(error);
    };
    const canceled = () => stop(problem(499, 'NPC_SPEECH_CANCELLED', '这次语音生成已取消。'));
    const serviceClosed = () => { if (!abortError) stop(problem(503, 'NPC_SPEECH_CLOSED', '居民语音暂时不可用，请稍后再来。')); };
    values.signal?.addEventListener('abort', canceled, { once: true });
    controller.signal.addEventListener('abort', serviceClosed, { once: true });
    const timer = setTimeout(() => stop(problem(504, 'NPC_SPEECH_TIMEOUT', '语音生成等得有些久，请稍后重试。')), timeoutMs);
    const operation = async () => {
      if (values.signal?.aborted) { canceled(); throw abortError; }
      const response = await fetchImpl(settings.endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': settings.apiKey, 'X-Api-Resource-Id': voice.resourceId, 'X-Api-Request-Id': randomUUID() },
        body: JSON.stringify({ user: { uid: 'game-town-npc' }, req_params: { text, speaker: voice.speaker, audio_params: voice.audioParams } }),
      });
      if (!response || typeof response.ok !== 'boolean') throw upstreamFailed();
      if (!response.ok) {
        response.body?.cancel?.().catch(() => {});
        if (response.status === 429) throw problem(429, 'NPC_SPEECH_BUSY', '居民语音现在有些忙，请稍后重试。');
        if (response.status === 401 || response.status === 403) throw unavailable();
        throw upstreamFailed();
      }
      return readSseAudio(response, controller.signal);
    };
    try { return await Promise.race([operation(), aborted]); }
    catch (error) {
      if (abortError) throw abortError;
      if (error instanceof NpcSpeechError) throw error;
      throw upstreamFailed();
    } finally {
      clearTimeout(timer);
      values.signal?.removeEventListener('abort', canceled);
      controller.signal.removeEventListener('abort', serviceClosed);
    }
  }

  async function synthesize(input, greeting = false) {
    if (closed) throw problem(503, 'NPC_SPEECH_CLOSED', '居民语音暂时不可用，请稍后再来。');
    // The greeting capability is selected by the server route, never by a flag
    // accepted from the existing reply endpoint. Reuse guest/NPC/signal checks.
    const values = validateInput(greeting && input && typeof input === 'object' && !Array.isArray(input)
      ? { guestId: input.guestId, npcId: input.npcId, signal: input.signal, conversationId: input.guestId, requestId: 'fixed-greeting' } : input);
    if (values.signal?.aborted) throw problem(499, 'NPC_SPEECH_CANCELLED', '这次语音生成已取消。');
    const text = greeting ? fixedGreeting(values) : authorizedReply(values);
    if (values.signal?.aborted) throw problem(499, 'NPC_SPEECH_CANCELLED', '这次语音生成已取消。');
    if (getNpcVoiceKind(values.npcId) === 'animal') {
      const animal = animalAudio(values.npcId);
      if (!animal) throw problem(409, 'NPC_SPEECH_ANIMAL_AUDIO_PENDING', '这位动物居民的叫声素材尚未就绪，暂时保留文字回复。');
      return { audio: Buffer.from(animal.audio), contentType: 'audio/mpeg', voice: 'animal' };
    }
    if (!enabled) throw unavailable();
    const voice = getNpcVoice(values.npcId);
    if (!voice) throw problem(409, 'NPC_SPEECH_VOICE_PENDING', '这位居民的配音身份尚待确认，暂时保留文字回复。');
    const fingerprint = createHash('sha256').update(npcVoiceFingerprint(voice, text)).digest('hex');
    // Fixed public lines can share a voice-fingerprinted cache across visitors;
    // private replies retain their original guest/conversation ownership key.
    const key = greeting ? `greeting:${values.npcId}:${fingerprint}` : `${values.guestId}:${values.npcId}:${values.conversationId}:${values.requestId}`;
    prune();
    const previous = cache.get(key);
    if (previous && previous.fingerprint === fingerprint) {
      cache.delete(key); cache.set(key, previous);
      return { audio: Buffer.from(previous.audio), contentType: 'audio/mpeg', voice: voice.speaker };
    }
    if (previous) drop(key);
    if (flights.has(values.guestId)) throw problem(429, 'NPC_SPEECH_IN_FLIGHT', '请先等上一条语音生成完成。');
    if (flights.size >= NPC_SPEECH_LIMITS.concurrentRequests) throw problem(503, 'NPC_SPEECH_CAPACITY', '现在有几位居民正在说话，请稍后试听。');
    const controller = new AbortController();
    const flight = { controller };
    flights.set(values.guestId, flight);
    try {
      const audio = await generate(values, text, voice, controller);
      if (closed) throw problem(503, 'NPC_SPEECH_CLOSED', '居民语音暂时不可用，请稍后再来。');
      if (values.signal?.aborted) throw problem(499, 'NPC_SPEECH_CANCELLED', '这次语音生成已取消。');
      // Recheck ownership after the provider completes: an expired/deleted reply
      // must not become a new cache entry while synthesis was in flight.
      if ((greeting ? fixedGreeting(values) : authorizedReply(values)) !== text) throw problem(409, 'NPC_SPEECH_REPLY_CHANGED', '这条回复已变化，请重新打开居民对话。');
      while (cache.size >= NPC_SPEECH_LIMITS.cacheItems || cacheBytes + audio.length > NPC_SPEECH_LIMITS.cacheBytes) drop(cache.keys().next().value);
      cache.set(key, { audio, fingerprint, expiresAt: now() + NPC_SPEECH_LIMITS.cacheTtlMs });
      cacheBytes += audio.length;
      return { audio: Buffer.from(audio), contentType: 'audio/mpeg', voice: voice.speaker };
    } finally { if (flights.get(values.guestId) === flight) flights.delete(values.guestId); }
  }

  return {
    status(npcId) {
      const base = { enabled: enabled && !closed, provider: 'Doubao', maxTextChars: NPC_SPEECH_LIMITS.textChars };
      if (npcId === undefined) return base;
      if (typeof npcId !== 'string' || !getNpcPersona(npcId)) throw problem(400, 'NPC_SPEECH_INVALID_NPC', '这位居民暂时不在小镇。');
      if (getNpcVoiceKind(npcId) === 'animal') {
        const cue = animalAudio(npcId);
        const ready = !!cue;
        return { ...base, provider: 'Local', enabled: !closed && typeof resolveReply === 'function' && ready, npcId, voiceKind: 'animal', voiceReady: ready, voiceLabel: cue?.label || '动物叫声回应（非逐字朗读）', reason: ready ? null : 'animal-audio-pending' };
      }
      const voice = getNpcVoice(npcId);
      return { ...base, enabled: base.enabled && !!voice, npcId, voiceKind: 'speech', voiceReady: !!voice, voiceLabel: voice?.label ?? null, reason: voice ? null : 'voice-pending' };
    },
    synthesize: input => synthesize(input),
    greeting: input => synthesize(input, true),
    close() {
      closed = true;
      clearInterval(cleanupTimer);
      for (const flight of flights.values()) flight.controller.abort();
      cache.clear(); cacheBytes = 0;
    },
  };
}
