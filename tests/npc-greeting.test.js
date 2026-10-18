import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createTownServer } from '../server/index.js';
import { createNpcSpeechService } from '../server/npcSpeech.js';
import { getNpcVoice } from '../server/npcVoices.js';
import { NPC_MAP } from '../src/lib/npcCatalog.js';
import { createNpcChatClient } from '../src/lib/npcChatClient.js';

const AUDIO = readFileSync(new URL('./fixtures/npc-speech-silence.mp3', import.meta.url));
const CONFIG = { enabled: true, apiKey: 'fake-tts-key-never-expose', endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse', resourceId: 'seed-tts-2.0', timeoutMs: 1000 };
const response = () => new Response(`data: ${JSON.stringify({ code: 0, data: AUDIO.toString('base64') })}\n\ndata: {"code":20000000}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const post = (server, path, body, extra = {}) => fetch(server.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('fixed greeting HTTP authenticates guests, rejects foreign origins and selects only published text and per-NPC voice', async () => {
  const calls = [];
  const server = await createTownServer({ port: 0, npcConfig: { enabled: false }, npcFetch: () => assert.fail('A greeting must never call an LLM'), npcSpeechConfig: CONFIG,
    npcSpeechFetch: async (_, options) => { calls.push(JSON.parse(options.body).req_params); return response(); } });
  try {
    assert.equal((await post(server, '/api/npc/speech/greeting', { npcId: 'npc-ali' })).status, 401);
    const guest = await (await post(server, '/api/guest', {})).json();
    const input = { token: guest.token, npcId: 'npc-ali', text: 'FORGED_TEXT', voice: 'FORGED_VOICE', kind: 'reply', endpoint: 'https://evil.invalid' };
    assert.equal((await post(server, '/api/npc/speech/greeting', input, { origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await post(server, '/api/npc/speech/greeting', { ...input, npcId: 'constructor' })).status, 400);
    const audio = await post(server, '/api/npc/speech/greeting', input);
    assert.equal(audio.status, 200); assert.equal(audio.headers.get('content-type'), 'audio/mpeg'); assert.equal(audio.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()), AUDIO);
    assert.equal(calls.length, 1); assert.equal(calls[0].text, NPC_MAP['npc-ali'].dialogue.greeting); assert.equal(calls[0].speaker, getNpcVoice('npc-ali').speaker);
    assert.doesNotMatch(JSON.stringify(calls), /FORGED|evil\.invalid/);
    const other = await (await post(server, '/api/guest', {})).json();
    assert.equal((await post(server, '/api/npc/speech/greeting', { token: other.token, npcId: 'npc-ali' })).status, 200);
    assert.equal(calls.length, 1, 'public fixed greetings reuse a checked cross-guest cache');
    assert.equal((await post(server, '/api/npc/speech', { ...input, kind: 'greeting' })).status, 400, 'reply endpoint cannot be changed into a greeting/text capability by browser flags');
    assert.equal((await fetch(server.url + '/api/npc/speech/greeting?npcId=npc-ali')).status, 404);
    assert.equal(calls.length, 1);
  } finally { await server.close(); }
});

test('fixed greeting service validates guest and NPC before work, preserves cancellation, and animals never use human TTS', async () => {
  let calls = 0;
  const service = createNpcSpeechService({ config: CONFIG, resolveReply: () => assert.fail('Fixed greetings do not require or fabricate a prior LLM reply'), fetchImpl: async () => { calls++; return response(); } });
  try {
    for (const input of [null, [], { guestId: 'bad', npcId: 'npc-ali' }, { guestId: randomUUID(), npcId: '__proto__' }]) await assert.rejects(service.greeting(input));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(service.greeting({ guestId: randomUUID(), npcId: 'npc-ali', signal: controller.signal }), { code: 'NPC_SPEECH_CANCELLED' });
    assert.equal(calls, 0);
    const animal = await service.greeting({ guestId: randomUUID(), npcId: 'npc-juya' });
    assert.equal(animal.voice, 'animal'); assert.equal(animal.contentType, 'audio/mpeg'); assert.ok(animal.audio.length > 256); assert.equal(calls, 0);
  } finally { service.close(); }
  await assert.rejects(service.greeting({ guestId: randomUUID(), npcId: 'npc-ali' }), { code: 'NPC_SPEECH_CLOSED' });
});

test('greeting client submits only token and NPC identity, returns bounded audio, and pre-cancellation costs no request', async () => {
  const calls = [];
  const client = createNpcChatClient({ fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return url.endsWith('/api/guest') ? json({ token: 'signed-token', expiresAt: Date.now() + 3600000 }) : new Response(AUDIO, { headers: { 'content-type': 'audio/mpeg' } }); } });
  const blob = await client.greetingSpeech({ npcId: 'npc-ali', text: 'FORGED_TEXT', speaker: 'FORGED_VOICE' });
  assert.equal(blob.type, 'audio/mpeg'); assert.equal(blob.size, AUDIO.length);
  assert.deepEqual(calls.map(call => call.url), ['/api/guest', '/api/npc/speech/greeting']);
  assert.deepEqual(calls[1].body, { token: 'signed-token', npcId: 'npc-ali' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.greetingSpeech({ npcId: 'npc-ali' }, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(client.greetingSpeech({ npcId: '../bad' }), { code: 'INVALID_INPUT' }); assert.equal(calls.length, 2);
});
