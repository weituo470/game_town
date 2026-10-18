import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createTownServer } from '../server/index.js';

const AUDIO = readFileSync(new URL('./fixtures/npc-speech-silence.mp3', import.meta.url));
const SPEECH_CONFIG = { enabled: true, apiKey: 'fake-tts-key-never-expose', endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse', speaker: 'zh_female_shuangkuaisisi_uranus_bigtts', resourceId: 'seed-tts-2.0', timeoutMs: 2000 };
const CHAT_CONFIG = { enabled: true, apiKey: 'fake-llm-test-key', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash', timeoutMs: 1000 };
const REPLY = '我是橙酥，欢迎来游戏小镇。';
const npcFetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: REPLY } }] }), { headers: { 'content-type': 'application/json' } });
const speechAnswer = () => new Response(`data: ${JSON.stringify({ code: 0, data: AUDIO.toString('base64') })}\n\ndata: {"code":20000000}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const post = (server, path, body, extra = {}) => fetch(server.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });

test('speech HTTP only narrates an owned completed reply, not arbitrary browser text', async () => {
  const calls = [];
  const server = await createTownServer({ port: 0, npcConfig: CHAT_CONFIG, npcFetch, npcSpeechConfig: SPEECH_CONFIG, npcSpeechFetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return speechAnswer(); } });
  try {
    const status = await (await fetch(server.url + '/api/npc/speech/status')).json();
    assert.equal(status.enabled, true); assert.equal(status.provider, 'Doubao');
    assert.equal(status.maxTextChars, 420);
    assert.doesNotMatch(JSON.stringify(status), /apiKey|fake-tts|endpoint|credentialEnvFile/);
    const npcStatus = await (await fetch(server.url + '/api/npc/speech/status?npcId=npc-ali')).json();
    assert.equal(npcStatus.voiceKind, 'speech'); assert.equal(npcStatus.voiceReady, true); assert.match(npcStatus.voiceLabel, /男孩/);
    const animalStatus = await (await fetch(server.url + '/api/npc/speech/status?npcId=npc-juya')).json();
    assert.equal(animalStatus.voiceKind, 'animal'); assert.equal(animalStatus.provider, 'Local'); assert.match(animalStatus.voiceLabel, /非逐字朗读/);
    const invalidStatus = await fetch(server.url + '/api/npc/speech/status?npcId=constructor');
    assert.equal(invalidStatus.status, 400); assert.equal((await invalidStatus.json()).code, 'NPC_SPEECH_INVALID_NPC');
    assert.equal((await post(server, '/api/npc/speech', {})).status, 401);
    const guest = await (await post(server, '/api/guest', {})).json();
    const chat = await (await post(server, '/api/npc/chat', { token: guest.token, npcId: 'npc-chengsu', message: '你好', requestId: randomUUID() })).json();
    const input = { token: guest.token, npcId: chat.npcId, conversationId: chat.conversationId, requestId: chat.requestId, text: 'FORGED_PLAYER_TEXT', speaker: 'UNAUTHORIZED_VOICE', endpoint: 'https://evil.invalid' };
    assert.equal((await post(server, '/api/npc/speech', input, { origin: 'https://evil.invalid' })).status, 403);
    const audio = await post(server, '/api/npc/speech', input);
    assert.equal(audio.status, 200); assert.match(audio.headers.get('content-type'), /^audio\/mpeg/);
    assert.equal(audio.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()), AUDIO);
    assert.equal(calls.length, 1); assert.equal(calls[0].body.req_params.text, REPLY);
    assert.equal(calls[0].body.req_params.speaker, SPEECH_CONFIG.speaker);
    assert.doesNotMatch(JSON.stringify(calls), /FORGED_PLAYER_TEXT|UNAUTHORIZED_VOICE|evil\.invalid/);
    assert.equal((await post(server, '/api/npc/speech', input)).status, 200);
    assert.equal(calls.length, 1, 'replay uses checked server cache, not another provider call');
    const other = await (await post(server, '/api/guest', {})).json();
    assert.equal((await post(server, '/api/npc/speech', { ...input, token: other.token })).status, 403);
    assert.equal((await post(server, '/api/npc/speech', { ...input, npcId: 'npc-alan' })).status, 403);
    assert.equal((await post(server, '/api/npc/speech', { ...input, requestId: randomUUID() })).status, 404);
    assert.equal((await post(server, '/api/npc/speech', { ...input, text: 'x'.repeat(5000) })).status, 413);
    assert.equal((await fetch(server.url + '/api/npc/speech?text=not-allowed')).status, 404);
    assert.equal((await fetch(server.url + '/npc-tts.local.json')).status, 404);
    assert.equal(calls.length, 1);
  } finally { await server.close(); }
});

test('disabled speech does not affect text chat and never returns fake generated audio', async () => {
  let speechCalls = 0;
  const server = await createTownServer({ port: 0, npcConfig: CHAT_CONFIG, npcFetch, npcSpeechConfig: { enabled: false }, npcSpeechFetch: () => { speechCalls += 1; throw new Error('must not call'); } });
  try {
    assert.equal((await (await fetch(server.url + '/api/npc/speech/status')).json()).enabled, false);
    const guest = await (await post(server, '/api/guest', {})).json();
    const chatResponse = await post(server, '/api/npc/chat', { token: guest.token, npcId: 'npc-chengsu', message: '你好', requestId: randomUUID() });
    assert.equal(chatResponse.status, 200);
    const chat = await chatResponse.json();
    const speech = await post(server, '/api/npc/speech', { token: guest.token, npcId: chat.npcId, conversationId: chat.conversationId, requestId: chat.requestId });
    assert.equal(speech.status, 503); assert.match(speech.headers.get('content-type'), /application\/json/);
    assert.equal(speechCalls, 0);
  } finally { await server.close(); }
});
