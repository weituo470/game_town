import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createNpcSpeechService, NPC_SPEECH_LIMITS, NpcSpeechError } from '../server/npcSpeech.js';
import { getNpcVoice } from '../server/npcVoices.js';

const CONFIG = Object.freeze({ enabled: true, apiKey: 'test-only-speech-secret', endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse', resourceId: 'seed-tts-2.0', speaker: 'zh_female_shuangkuaisisi_uranus_bigtts', timeoutMs: 1000 });
const GUEST = '0a9c786f-1d5c-4f18-ad38-c57442eb9293';
const CONVERSATION = '8b5ca127-1fa4-4c87-83c7-52e787a01ef8';
const input = (overrides = {}) => ({ guestId: GUEST, npcId: 'npc-chengsu', conversationId: CONVERSATION, requestId: randomUUID(), ...overrides });
const resolve = values => ({ npcId: values.npcId, requestId: values.requestId, conversationId: values.conversationId, reply: '你好，我是橙酥，正在准备小镇的面包。' });
const deferred = () => { let done; const promise = new Promise(resolve => { done = resolve; }); return { promise, resolve: done }; };
const fails = (operation, code, status) => assert.rejects(operation, error => {
  assert.ok(error instanceof NpcSpeechError);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  assert.doesNotMatch(error.message, /test-only-speech-secret|raw-provider-secret|openspeech|base64/i);
  return true;
});

// Structurally valid MPEG-2 Layer III, 24kHz / 64kbps frames. This fixture is
// deliberately not claimed to be audible speech or a decoder acceptance test.
function mp3(frames = 6) {
  const data = Buffer.alloc(frames * 192);
  for (let index = 0; index < frames; index += 1) data.set([0xff, 0xf3, 0x84, 0x00], index * 192);
  return data;
}

const dataEvent = (payload, ending = '\n\n') => `data: ${JSON.stringify(payload)}${ending}`;
const speechText = (audio = mp3(), { ending = '\n\n', terminal = true } = {}) => dataEvent({ code: 0, data: audio.toString('base64') }, ending) + (terminal ? dataEvent({ code: 20000000, message: 'completed' }, ending) : '');
const response = (value = speechText(), options = {}) => new Response(value, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' }, ...options });
const serviceFor = (fetchImpl = async () => response(), overrides = {}) => createNpcSpeechService({ config: CONFIG, fetchImpl, resolveReply: resolve, ...overrides });

test('status is a credential-free public contract and disabled service never calls a provider', async () => {
  let authorized = 0;
  const service = serviceFor(() => assert.fail('No paid call without configuration'), { config: { enabled: false }, resolveReply: values => { authorized += 1; return resolve(values); } });
  assert.deepEqual(service.status(), { enabled: false, provider: 'Doubao', maxTextChars: 420 });
  await fails(service.synthesize(input()), 'NPC_SPEECH_DISABLED', 503);
  assert.equal(authorized, 1, 'reply ownership is still resolved before availability');
  assert.doesNotMatch(JSON.stringify(service.status()), /secret|speaker|endpoint|apiKey/);
  service.close();
});

test('all inputs are checked before reply lookup and provider work', async () => {
  const service = serviceFor(() => assert.fail('Invalid input must not call provider'), { resolveReply: () => assert.fail('Invalid IDs must not resolve a reply') });
  await fails(service.synthesize(null), 'NPC_SPEECH_INVALID_REQUEST', 400);
  await fails(service.synthesize(input({ guestId: 'not-uuid' })), 'NPC_SPEECH_INVALID_GUEST', 401);
  for (const npcId of ['npc-unknown', 'constructor', '__proto__']) await fails(service.synthesize(input({ npcId })), 'NPC_SPEECH_INVALID_NPC', 400);
  for (const conversationId of ['', 'bad', null]) await fails(service.synthesize(input({ conversationId })), 'NPC_SPEECH_INVALID_CONVERSATION', 400);
  for (const requestId of ['', '../bad', 'x'.repeat(81)]) await fails(service.synthesize(input({ requestId })), 'NPC_SPEECH_INVALID_REQUEST_ID', 400);
  service.close();
});

test('only the resolved reply and server voice reach the exact Doubao SSE request', async () => {
  let sent;
  const service = serviceFor(async (url, options) => { sent = { url, options, body: JSON.parse(options.body) }; return response(); });
  const result = await service.synthesize(input({ text: 'CLIENT_FORGED_TEXT', speaker: 'CLIENT_FORGED_SPEAKER', voice: 'CLIENT_FORGED_VOICE' }));
  assert.equal(sent.url, CONFIG.endpoint);
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.options.headers['X-Api-Key'], CONFIG.apiKey);
  assert.equal(sent.options.headers['X-Api-Resource-Id'], CONFIG.resourceId);
  assert.match(sent.options.headers['X-Api-Request-Id'], /^[0-9a-f-]{36}$/);
  assert.equal(sent.body.req_params.text, resolve(input()).reply);
  assert.equal(sent.body.req_params.speaker, CONFIG.speaker);
  assert.deepEqual(sent.body.req_params.audio_params, { format: 'mp3', sample_rate: 24000, speech_rate: -5, loudness_rate: 0, pitch_rate: 0 });
  assert.doesNotMatch(JSON.stringify(sent.body), /CLIENT_FORGED|test-only-speech-secret|0a9c786f/);
  assert.equal(result.contentType, 'audio/mpeg');
  assert.equal(result.voice, CONFIG.speaker);
  assert.deepEqual(result.audio, mp3());
  service.close();
});

test('per-NPC status is credential-free, validates IDs and reports speech versus animal availability', () => {
  const service = serviceFor(() => assert.fail('Status never calls a provider'), { animalAudioLoader: () => null });
  assert.deepEqual(service.status(), { enabled: true, provider: 'Doubao', maxTextChars: 420 });
  assert.deepEqual(service.status('npc-lanjian'), { enabled: true, provider: 'Doubao', maxTextChars: 420, npcId: 'npc-lanjian', voiceKind: 'speech', voiceReady: true, voiceLabel: '小何 2.0 · 温和', reason: null });
  const animal = service.status('npc-juya');
  assert.equal(animal.enabled, false); assert.equal(animal.voiceReady, false); assert.equal(animal.reason, 'animal-audio-pending'); assert.equal(animal.voiceKind, 'animal');
  assert.equal(animal.provider, 'Local');
  assert.match(animal.voiceLabel, /非逐字朗读/);
  assert.doesNotMatch(JSON.stringify(animal), /apiKey|endpoint|speaker|secret|resourceId/);
  for (const npcId of ['constructor', '__proto__', 'npc-bogus', '', null]) assert.throws(() => service.status(npcId), error => error.code === 'NPC_SPEECH_INVALID_NPC' && error.status === 400);
  service.close(); assert.equal(service.status('npc-lanjian').enabled, false);
});

test('client/config speaker overrides cannot change the stable NPC assignment or resource', async () => {
  const calls = [];
  const service = serviceFor(async (_, options) => { calls.push({ body: JSON.parse(options.body), headers: options.headers }); return response(); }, { config: { ...CONFIG, speaker: 'IGNORED_LEGACY_GLOBAL_VOICE' } });
  for (const npcId of ['npc-ali', 'npc-chengsu', 'npc-lanjian']) {
    const result = await service.synthesize(input({ npcId, speaker: 'CLIENT_VOICE', voice: 'CLIENT_VOICE', audio_params: { speech_rate: 100 } }));
    const expected = getNpcVoice(npcId), actual = calls.at(-1);
    assert.equal(actual.body.req_params.speaker, expected.speaker); assert.deepEqual(actual.body.req_params.audio_params, expected.audioParams);
    assert.equal(actual.headers['X-Api-Resource-Id'], 'seed-tts-2.0'); assert.equal(result.voice, expected.speaker);
  }
  assert.equal(calls.length, 3);
  service.close();
});

test('animal responses use authenticated local audio with no TTS configuration, upstream call or mutable Buffer leakage', async () => {
  const bytes = mp3(); let authorized = 0;
  const service = serviceFor(() => assert.fail('Animals never call TTS'), { config: { enabled: false }, animalAudioLoader: () => ({ audio: bytes, label: '猫叫' }), resolveReply: values => { authorized++; return resolve(values); } });
  const request = input({ npcId: 'npc-juya' });
  assert.equal(service.status().enabled, false, 'legacy no-argument status still reports TTS configuration');
  assert.equal(service.status('npc-juya').enabled, true);
  const first = await service.synthesize(request); first.audio.fill(0);
  assert.deepEqual((await service.synthesize(request)).audio, mp3()); assert.equal(authorized, 2);
  service.close(); assert.equal(service.status('npc-juya').enabled, false);
});

test('missing/bad/oversized animal audio never falls back to a human voice or bypasses reply ownership', async () => {
  for (const value of [null, { audio: Buffer.alloc(10) }, { audio: Buffer.alloc(256 * 1024 + 1) }]) {
    const service = serviceFor(() => assert.fail('No human TTS fallback'), { animalAudioLoader: () => value });
    assert.equal(service.status('npc-rongrong').voiceReady, false);
    await fails(service.synthesize(input({ npcId: 'npc-rongrong' })), 'NPC_SPEECH_ANIMAL_AUDIO_PENDING', 409);
    service.close();
  }
  const service = serviceFor(() => assert.fail('No TTS call'), { animalAudioLoader: () => assert.fail('Do not load audio before reply ownership'), resolveReply: () => { throw Object.assign(new Error('private'), { status: 403 }); } });
  await fails(service.synthesize(input({ npcId: 'npc-maipao' })), 'NPC_SPEECH_FORBIDDEN', 403); service.close();
});

test('cross-guest, cross-NPC, absent and pending replies fail before synthesis', async () => {
  const cases = [
    [() => { throw Object.assign(new Error('raw-provider-secret'), { status: 403 }); }, 'NPC_SPEECH_FORBIDDEN', 403],
    [() => null, 'NPC_SPEECH_REPLY_EXPIRED', 404],
    [() => Promise.resolve({}), 'NPC_SPEECH_REPLY_EXPIRED', 404],
    [values => ({ ...resolve(values), npcId: 'npc-nuannuan' }), 'NPC_SPEECH_FORBIDDEN', 403],
    [values => ({ ...resolve(values), conversationId: randomUUID() }), 'NPC_SPEECH_FORBIDDEN', 403],
    [values => ({ ...resolve(values), requestId: randomUUID() }), 'NPC_SPEECH_FORBIDDEN', 403],
  ];
  for (const [resolveReply, code, status] of cases) {
    const service = serviceFor(() => assert.fail('Unauthorized reply must not be synthesized'), { resolveReply });
    await fails(service.synthesize(input()), code, status);
    service.close();
  }
});

test('blank, invalid and over-420-character resolved replies are rejected without truncation', async () => {
  for (const reply of ['', '\0text', null]) {
    const service = serviceFor(() => assert.fail('Bad reply must not be synthesized'), { resolveReply: values => ({ ...resolve(values), reply }) });
    await fails(service.synthesize(input()), 'NPC_SPEECH_INVALID_REPLY', 400);
    service.close();
  }
  const service = serviceFor(() => assert.fail('Long reply must not be synthesized'), { resolveReply: values => ({ ...resolve(values), reply: '字'.repeat(421) }) });
  await fails(service.synthesize(input()), 'NPC_SPEECH_REPLY_TOO_LONG', 400);
  service.close();
});

test('valid audio is cached but cache replay always reauthorizes and returns an isolated Buffer', async () => {
  let calls = 0;
  let allowed = true;
  let resolutions = 0;
  const service = serviceFor(async () => { calls += 1; return response(); }, { resolveReply: values => { resolutions += 1; return allowed ? resolve(values) : null; } });
  const request = input();
  const first = await service.synthesize(request);
  first.audio.fill(0);
  const second = await service.synthesize(request);
  assert.deepEqual(second.audio, mp3());
  assert.equal(calls, 1);
  assert.equal(resolutions, 3, 'before/after generation and again before cache hit');
  allowed = false;
  await fails(service.synthesize(request), 'NPC_SPEECH_REPLY_EXPIRED', 404);
  assert.equal(calls, 1);
  service.close();
});

test('reply ownership is rechecked after generation and revoked replies are never cached', async () => {
  let resolutions = 0;
  const service = serviceFor(async () => response(), { resolveReply: values => ++resolutions === 1 ? resolve(values) : null });
  await fails(service.synthesize(input()), 'NPC_SPEECH_REPLY_EXPIRED', 404);
  service.close();
});

test('same-guest pending retries reject rather than sharing cancellation while two guests may synthesize', async () => {
  const gate = deferred();
  let calls = 0;
  const service = serviceFor(async () => { calls += 1; await gate.promise; return response(); });
  const request = input();
  const first = service.synthesize(request);
  const duplicateController = new AbortController();
  await fails(service.synthesize({ ...request, signal: duplicateController.signal }), 'NPC_SPEECH_IN_FLIGHT', 429);
  duplicateController.abort();
  const second = service.synthesize(input({ guestId: randomUUID() }));
  await fails(service.synthesize(input({ guestId: randomUUID() })), 'NPC_SPEECH_CAPACITY', 503);
  assert.equal(calls, 2);
  gate.resolve();
  await Promise.all([first, second]);
  await service.synthesize(request);
  assert.equal(calls, 2, 'successful replay does not call upstream');
  service.close();
});

test('SSE parses arbitrarily split CRLF, metadata, UTF-8 and audio across multiple events', async () => {
  const audio = mp3();
  const sse = ': heartbeat\r\n\r\n' + dataEvent({ code: 0, message: '准备语音' }, '\r\n\r\n')
    + dataEvent({ code: 0, data: audio.subarray(0, 111).toString('base64') }, '\r\n\r\n')
    + dataEvent({ code: 0, data: audio.subarray(111).toString('base64') }, '\r\n\r\n')
    + dataEvent({ code: 20000000 }, '');
  const bytes = Buffer.from(sse);
  const body = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.subarray(i, i + 7)); controller.close(); } });
  const service = serviceFor(async () => response(body));
  assert.deepEqual((await service.synthesize(input())).audio, audio);
  service.close();
});

test('completion requires a terminal success code and never returns partial or malformed provider output', async () => {
  const malformed = [
    speechText(mp3(), { terminal: false }),
    dataEvent({ code: 20000000 }),
    dataEvent({ code: 0, data: mp3().toString('base64') }) + dataEvent({ code: 40123, message: 'raw-provider-secret' }),
    speechText() + dataEvent({ code: 0, data: mp3().toString('base64') }),
    dataEvent({ data: mp3().toString('base64') }) + dataEvent({ code: 20000000 }),
    'data: {invalid}\n\n',
    dataEvent({ code: 0, data: 'bad%%%' }) + dataEvent({ code: 20000000 }),
    dataEvent({ code: 0, data: 'Zh==' }) + dataEvent({ code: 20000000 }),
    dataEvent({ code: 0, data: { audio: 'bad' } }) + dataEvent({ code: 20000000 }),
  ];
  for (const body of malformed) {
    const service = serviceFor(async () => response(body));
    await fails(service.synthesize(input()), 'NPC_SPEECH_UPSTREAM', 502);
    service.close();
  }
});

test('finished audio must contain complete consecutive 24kHz MPEG Layer III frames', async () => {
  const badAudio = [
    Buffer.from('ID3this is only a fake header'),
    Buffer.alloc(512), mp3(1), mp3().subarray(0, -1), Buffer.concat([mp3(), Buffer.from('trailing-junk')]),
    Buffer.from(JSON.stringify({ error: 'raw-provider-secret' })),
  ];
  for (const audio of badAudio) {
    const service = serviceFor(async () => response(speechText(audio)));
    await fails(service.synthesize(input()), 'NPC_SPEECH_INVALID_AUDIO', 502);
    service.close();
  }
  const id3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  const tagged = Buffer.concat([id3, mp3()]);
  const service = serviceFor(async () => response(speechText(tagged)));
  assert.deepEqual((await service.synthesize(input())).audio, tagged);
  service.close();
});

test('unexpected MIME, advertised huge bodies, huge SSE events and excessive control events are bounded', async () => {
  const cases = [
    () => response(speechText(), { headers: { 'content-type': 'application/json' } }),
    () => response('', { headers: { 'content-type': 'text/event-stream', 'content-length': String(NPC_SPEECH_LIMITS.upstreamBytes + 1) } }),
    () => response('data: ' + 'x'.repeat(NPC_SPEECH_LIMITS.eventBytes + 1)),
    () => response(dataEvent({ code: 0 }).repeat(NPC_SPEECH_LIMITS.events + 1)),
  ];
  for (const make of cases) {
    const service = serviceFor(async () => make());
    await fails(service.synthesize(input()), 'NPC_SPEECH_UPSTREAM', 502);
    service.close();
  }
});

test('decoded audio cannot exceed 2 MiB and overall upstream cannot exceed 8 MiB', async () => {
  const chunk = Buffer.alloc(128 * 1024).toString('base64');
  const tooMuchAudio = dataEvent({ code: 0, data: chunk }).repeat(17) + dataEvent({ code: 20000000 });
  const tooMuchUpstream = (':' + 'x'.repeat(500_000) + '\n\n').repeat(18);
  for (const text of [tooMuchAudio, tooMuchUpstream]) {
    const service = serviceFor(async () => response(text));
    await fails(service.synthesize(input()), 'NPC_SPEECH_UPSTREAM', 502);
    service.close();
  }
});

test('HTTP and transport failures never reflect vendor response bodies or credentials', async () => {
  for (const [status, code, expected] of [[429, 'NPC_SPEECH_BUSY', 429], [401, 'NPC_SPEECH_DISABLED', 503], [403, 'NPC_SPEECH_DISABLED', 503], [500, 'NPC_SPEECH_UPSTREAM', 502]]) {
    const service = serviceFor(async () => ({ ok: false, status, text: () => assert.fail('Provider errors must not be read'), json: () => assert.fail('Provider errors must not be read') }));
    await fails(service.synthesize(input()), code, expected);
    service.close();
  }
  const service = serviceFor(async () => { throw new Error('raw-provider-secret test-only-speech-secret'); });
  await fails(service.synthesize(input()), 'NPC_SPEECH_UPSTREAM', 502);
  service.close();
});

test('timeout covers both stalled headers and stalled SSE body and releases locks', async () => {
  for (const phase of ['headers', 'body']) {
    let calls = 0;
    let signal;
    const service = serviceFor(async (url, options) => {
      calls += 1; signal = options.signal;
      if (calls > 1) return response();
      if (phase === 'headers') return new Promise(() => {});
      return response(new ReadableStream({ start() {} }));
    }, { config: { ...CONFIG, timeoutMs: 15 } });
    await fails(service.synthesize(input()), 'NPC_SPEECH_TIMEOUT', 504);
    assert.equal(signal.aborted, true);
    assert.ok((await service.synthesize(input())).audio.length);
    service.close();
  }
});

test('client cancellation and service shutdown abort generation without caching late output', async () => {
  const gate = deferred();
  let calls = 0;
  let signal;
  const service = serviceFor(async (url, options) => { calls += 1; signal = options.signal; if (calls === 1) await gate.promise; return response(); });
  const controller = new AbortController();
  const request = input();
  const pending = service.synthesize({ ...request, signal: controller.signal });
  controller.abort();
  await fails(pending, 'NPC_SPEECH_CANCELLED', 499);
  assert.equal(signal.aborted, true);
  gate.resolve();
  await service.synthesize(request);
  assert.equal(calls, 2);
  service.close();
  const closed = serviceFor(() => new Promise(() => {}));
  const closing = closed.synthesize(input());
  closed.close();
  await fails(closing, 'NPC_SPEECH_CLOSED', 503);
  await fails(closed.synthesize(input()), 'NPC_SPEECH_CLOSED', 503);
  assert.equal(closed.status().enabled, false);
});

test('cached audio expires after ten minutes and the least recent cache item is bounded', async () => {
  let time = 0;
  let calls = 0;
  const service = serviceFor(async () => { calls += 1; return response(); }, { now: () => time });
  const oldest = input();
  await service.synthesize(oldest);
  time = NPC_SPEECH_LIMITS.cacheTtlMs;
  await service.synthesize(oldest);
  assert.equal(calls, 2);
  for (let i = 0; i < NPC_SPEECH_LIMITS.cacheItems; i += 1) await service.synthesize(input());
  const before = calls;
  await service.synthesize(oldest);
  assert.equal(calls, before + 1, 'oldest cache entry was evicted');
  service.close();
});

test('background cache cleanup runs without requests and close stops its timer', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let time = 0;
  let calls = 0;
  let reads = 0;
  const service = serviceFor(async () => { calls += 1; return response(); }, { now: () => { reads += 1; return time; } });
  const request = input();
  await service.synthesize(request);
  time = NPC_SPEECH_LIMITS.cacheTtlMs;
  context.mock.timers.tick(NPC_SPEECH_LIMITS.cleanupIntervalMs);
  time = 0;
  await service.synthesize(request);
  assert.equal(calls, 2, 'background pruning removed the expired entry before the clock rewind');
  service.close();
  const before = reads;
  context.mock.timers.tick(NPC_SPEECH_LIMITS.cleanupIntervalMs * 2);
  assert.equal(reads, before);
});
