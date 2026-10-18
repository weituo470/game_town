import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNpcChatClient, NPC_SPEECH_MAX_BYTES } from '../src/lib/npcChatClient.js';
import { createNpcSpeechPlayer } from '../src/lib/npcSpeechPlayer.js';

const source = (id = 'a') => ({ id, npcId: 'npc-ali', conversationId: 'conversation-ali', requestId: `reply-${id}` });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const guest = () => json({ token: 'signed-token', expiresAt: Date.now() + 3600000 });
const mp3 = () => new Blob([new Uint8Array([73, 68, 51, 4, 0, 0])], { type: 'audio/mpeg' });
const audioResponse = () => new Response(mp3(), { headers: { 'Content-Type': 'audio/mpeg' } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

class FakeAudio {
  listeners = new Map();
  pauses = 0;
  loads = 0;
  playCalls = 0;
  constructor(playResult) { this.playResult = playResult; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); }
  fire(name) { this.listeners.get(name)?.(); }
  play() { this.playCalls += 1; return this.playResult ?? Promise.resolve(); }
  pause() { this.pauses += 1; }
  removeAttribute(name) { this.removed = name; }
  load() { this.loads += 1; }
}

function playerFixture({ loadSpeech, playResults = [] } = {}) {
  const states = [], audios = [], revoked = [], requests = [];
  let urlCount = 0;
  const player = createNpcSpeechPlayer({
    loadSpeech: loadSpeech || (async (body, options) => { requests.push({ body, options }); return mp3(); }),
    audioFactory: url => { const audio = new FakeAudio(playResults[audios.length]); audio.url = url; audios.push(audio); return audio; },
    createURL: () => `blob:test-${++urlCount}`,
    revokeURL: url => revoked.push(url),
    onState: state => states.push(state),
  });
  return { player, states, audios, revoked, requests };
}

test('speech status is free GET with no guest or synthesis', async () => {
  const calls = [];
  const client = createNpcChatClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); return json({ enabled: true, provider: 'Doubao', maxTextChars: 420 }); } });
  assert.deepEqual(await client.speechStatus(), { enabled: true, provider: 'Doubao', maxTextChars: 420 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/npc/speech/status');
  assert.equal(calls[0].options.method, 'GET');
});

test('speech status validates provider and advertised text limit', async () => {
  for (const value of [{ enabled: true, provider: 'other', maxTextChars: 420 }, { enabled: 'yes', provider: 'Doubao', maxTextChars: 420 }, { enabled: false, provider: 'Doubao', maxTextChars: -1 }]) {
    const client = createNpcChatClient({ fetchImpl: async () => json(value) });
    await assert.rejects(client.speechStatus(), { code: 'INVALID_RESPONSE' });
  }
});

test('per-resident voice status is identity bound and distinguishes animal cues', async () => {
  const values = { enabled: true, provider: 'Doubao', maxTextChars: 420, npcId: 'npc-juya', voiceReady: true, voiceKind: 'animal', voiceLabel: '猫叫回应 · 非逐字朗读', reason: null };
  let url;
  const client = createNpcChatClient({ fetchImpl: async path => { url = path; return json(values); } });
  const state = await client.speechStatus({ npcId: 'npc-juya' });
  assert.equal(url, '/api/npc/speech/status?npcId=npc-juya');
  assert.equal(state.voiceKind, 'animal');
  assert.equal(state.voiceLabel, values.voiceLabel);
  values.npcId = 'npc-chengsu';
  await assert.rejects(client.speechStatus({ npcId: 'npc-juya' }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(client.speechStatus({ npcId: '../other' }), { code: 'INVALID_INPUT' });
});

test('animal pending and identity pending are distinct bounded status reasons', async () => {
  for (const reason of ['voice-pending', 'animal-audio-pending']) {
    const client = createNpcChatClient({ fetchImpl: async () => json({ enabled: false, provider: 'Doubao', maxTextChars: 420, npcId: 'npc-juya', voiceReady: false, voiceKind: 'animal', voiceLabel: null, reason }) });
    assert.equal((await client.speechStatus({ npcId: 'npc-juya' })).reason, reason);
  }
});

test('speech uses the same chat guest, sends reply identifiers only and returns an MP3 Blob', async () => {
  const calls = [];
  const client = createNpcChatClient({ fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url === '/api/guest') return guest();
    if (url === '/api/npc/chat') return json({ npcId: body.npcId, requestId: body.requestId, conversationId: 'conversation-ali', model: 'deepseek-flash', reply: '你好。' });
    return audioResponse();
  } });
  await client.send({ npcId: 'npc-ali', requestId: 'reply-a', message: '你好' });
  const blob = await client.speech({ ...source(), text: 'must-not-leave-client', voice: 'not-allowed' });
  assert.deepEqual(calls.map(call => call.url), ['/api/guest', '/api/npc/chat', '/api/npc/speech']);
  assert.deepEqual(calls[2].body, { token: 'signed-token', npcId: 'npc-ali', conversationId: 'conversation-ali', requestId: 'reply-a' });
  assert.equal(blob.type, 'audio/mpeg');
  assert.equal(blob.size, 6);
});

test('speech rejects absent identifiers before touching the network', async () => {
  let calls = 0;
  const client = createNpcChatClient({ fetchImpl: async () => { calls += 1; return guest(); } });
  await assert.rejects(client.speech({ npcId: 'npc-ali' }), { code: 'INVALID_INPUT' });
  assert.equal(calls, 0);
});

test('speech rejects wrong MIME, empty, oversized declared or streamed audio', async () => {
  const responses = [
    () => json({ disguised: 'audio' }),
    () => new Response('', { headers: { 'Content-Type': 'audio/mpeg' } }),
    () => new Response('abc', { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': `${NPC_SPEECH_MAX_BYTES + 1}` } }),
    () => new Response(new Uint8Array(NPC_SPEECH_MAX_BYTES + 1), { headers: { 'Content-Type': 'audio/mpeg' } }),
  ];
  for (const response of responses) {
    const client = createNpcChatClient({ fetchImpl: async url => url === '/api/guest' ? guest() : response() });
    await assert.rejects(client.speech(source()), { code: 'INVALID_AUDIO' });
  }
});

test('speech POST failure is sanitized and never automatically retried', async () => {
  let posts = 0;
  const client = createNpcChatClient({ fetchImpl: async url => {
    if (url === '/api/guest') return guest();
    posts += 1;
    return json({ code: 'NPC_SPEECH_UPSTREAM', error: 'secret-provider-key' }, 502);
  } });
  await assert.rejects(client.speech(source()), error => error.status === 502 && !error.message.includes('secret-provider-key'));
  assert.equal(posts, 1);
});

test('speech timeout also bounds a stalled audio stream and cancels its body', async () => {
  let canceled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([73])); }, cancel() { canceled = true; } });
  const client = createNpcChatClient({ speechTimeoutMs: 5, fetchImpl: async url => url === '/api/guest' ? guest() : new Response(stream, { headers: { 'Content-Type': 'audio/mpeg' } }) });
  await assert.rejects(client.speech(source()), { code: 'TIMEOUT' });
  assert.equal(canceled, true);
});

test('speech user cancellation is AbortError, never timeout/retry', async () => {
  const controller = new AbortController();
  let requests = 0;
  const client = createNpcChatClient({ fetchImpl: async url => {
    if (url === '/api/guest') return guest();
    requests += 1;
    queueMicrotask(() => controller.abort());
    return new Promise(() => {});
  } });
  await assert.rejects(client.speech(source(), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('player emits loading/playing and cleans up audio/object URL on ended', async () => {
  const fixture = playerFixture();
  await fixture.player.play(source());
  assert.equal(fixture.states.at(-1).status, 'playing');
  assert.equal(fixture.requests.length, 1);
  fixture.audios[0].fire('ended');
  assert.equal(fixture.states.at(-1).status, 'idle');
  assert.equal(fixture.states.at(-1).messageId, 'a');
  assert.deepEqual(fixture.revoked, ['blob:test-1']);
  assert.equal(fixture.audios[0].removed, 'src');
  assert.equal(fixture.audios[0].loads, 1);
});

test('blocked autoplay retains Blob and a manual replay calls play synchronously without regeneration', async () => {
  const blocked = deferred();
  const fixture = playerFixture({ playResults: [blocked.promise] });
  const playing = fixture.player.play(source());
  await Promise.resolve();
  blocked.reject(Object.assign(new Error('gesture needed'), { name: 'NotAllowedError' }));
  await playing;
  assert.equal(fixture.states.at(-1).status, 'blocked');
  assert.equal(fixture.revoked.length, 1);
  const replaying = fixture.player.play(source());
  assert.equal(fixture.audios[1].playCalls, 1);
  await replaying;
  assert.equal(fixture.states.at(-1).status, 'playing');
  assert.equal(fixture.requests.length, 1);
  fixture.player.dispose();
});

test('stopping during generation aborts and ignores a late successful Blob', async () => {
  const waiting = deferred();
  let signal;
  const fixture = playerFixture({ loadSpeech: async (_, options) => { signal = options.signal; return waiting.promise; } });
  const playing = fixture.player.play(source());
  fixture.player.stop();
  assert.equal(signal.aborted, true);
  waiting.resolve(mp3());
  await playing;
  assert.equal(fixture.audios.length, 0);
  assert.equal(fixture.states.at(-1).status, 'idle');
});

test('a late play promise cannot revive stopped audio or overwrite a newer playback', async () => {
  const firstPlay = deferred();
  const fixture = playerFixture({ playResults: [firstPlay.promise] });
  const first = fixture.player.play(source('a'));
  await Promise.resolve();
  await fixture.player.play(source('b'));
  firstPlay.resolve();
  await first;
  assert.equal(fixture.states.at(-1).messageId, 'b');
  assert.equal(fixture.states.at(-1).status, 'playing');
  assert.equal(fixture.audios[0].pauses, 1);
  assert.equal(fixture.audios[0].listeners.size, 0);
  fixture.player.dispose();
  assert.equal(fixture.revoked.length, 2);
});

test('player stores only the latest Blob, releasing every replaced object URL', async () => {
  const fixture = playerFixture();
  await fixture.player.play(source('a'));
  await fixture.player.play(source('a'));
  await fixture.player.play(source('b'));
  await fixture.player.play(source('a'));
  assert.equal(fixture.requests.length, 3);
  fixture.player.dispose();
  assert.equal(fixture.revoked.length, 4);
  await fixture.player.play(source('c'));
  assert.equal(fixture.requests.length, 3);
});

test('media error and rejected play clean up URLs; decode errors do not become fake speech', async () => {
  const fixture = playerFixture();
  await fixture.player.play(source());
  fixture.audios[0].fire('error');
  assert.equal(fixture.states.at(-1).status, 'error');
  assert.equal(fixture.revoked.length, 1);
  const rejected = deferred();
  const another = playerFixture({ playResults: [rejected.promise] });
  const playing = another.player.play(source());
  await Promise.resolve();
  rejected.reject(new Error('decoder failed'));
  await playing;
  assert.equal(another.states.at(-1).status, 'error');
  assert.equal(another.revoked.length, 1);
});

test('disposal during pending play rejects any late status updates', async () => {
  const pending = deferred();
  const fixture = playerFixture({ playResults: [pending.promise] });
  const playing = fixture.player.play(source());
  await Promise.resolve();
  fixture.player.dispose();
  const stateCount = fixture.states.length;
  pending.reject(Object.assign(new Error('late rejection'), { name: 'NotAllowedError' }));
  await playing;
  assert.equal(fixture.states.length, stateCount);
  assert.equal(fixture.revoked.length, 1);
});

test('speech UI defaults on with an explicit per-directory opt-out, saves reply identifiers and explains privacy', async () => {
  const jsx = await readFile(new URL('../src/components/NpcChat.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/components/npc-chat.css', import.meta.url), 'utf8');
  assert.match(jsx, /\[autoSpeech, setAutoSpeech\] = useState\(\(\) => speechPreference\?\.enabled !== false\)/);
  assert.match(jsx, /requestId: response\.requestId, conversationId: response\.conversationId/);
  assert.match(jsx, /Array\.from\(source\.text\)\.length <= speechStatus\.maxTextChars/);
  assert.match(jsx, /暂不支持完整播报/);
  assert.match(jsx, /不会把你的原话单独发送用于配音/);
  assert.match(jsx, /if \(!enabled\) speechPlayer\.current\?\.stop\(\)/);
  assert.match(jsx, /speechPlayer\.current\?\.dispose\(\)/);
  assert.match(jsx, /speechState\.messageId === message\.id && speechState\.status === 'idle' && <span role="status">\{animalVoice \? '叫声播放完毕' : '播报完毕'\}/);
  assert.match(jsx, /叫声不是逐字朗读/);
  assert.match(jsx, /不会把聊天文字发送给语音服务/);
  assert.match(css, /\.npc-speech-reply button[^}]*min-height: 44px/);
});
