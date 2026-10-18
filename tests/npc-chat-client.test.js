import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNpcChatClient, createNpcChatRequest, NPC_CHAT_MAX_CHARS, NpcChatError } from '../src/lib/npcChatClient.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const identity = () => json({ token: 'signed-guest-token', expiresAt: Date.now() + 3600000 });
const makeRequest = (overrides = {}) => createNpcChatRequest({ npcId: 'npc-ali', message: '今天忙什么？', ...overrides }, () => '00000000-0000-4000-8000-000000000001');
const reply = request => ({ reply: '在整理杂货铺的新货架呢。', npcId: request.npcId, conversationId: 'conversation-ali', requestId: request.requestId, model: 'deepseek-flash' });
const waitForAbort = signal => new Promise((resolve, reject) => {
  if (signal.aborted) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  else signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
});

test('chat request trims text and freezes a stable request ID for explicit retries', () => {
  const request = makeRequest({ message: '  你好，阿栗。  ', conversationId: 'previous' });
  assert.equal(request.message, '你好，阿栗。');
  assert.equal(request.conversationId, 'previous');
  assert.equal(Object.isFrozen(request), true);
  assert.throws(() => { request.requestId = 'different'; }, TypeError);
});

test('chat request rejects blank text, overlength text and invalid NPC or conversation IDs', () => {
  for (const fields of [{ message: ' ' }, { message: '啊'.repeat(NPC_CHAT_MAX_CHARS + 1) }, { npcId: '../../secret' }, { conversationId: '' }, { conversationId: 123 }]) {
    assert.throws(() => makeRequest(fields), error => error instanceof NpcChatError && error.code === 'INVALID_INPUT' && !error.retryable);
  }
  assert.equal(makeRequest({ message: '啊'.repeat(NPC_CHAT_MAX_CHARS) }).message.length, NPC_CHAT_MAX_CHARS);
});

test('status is a read-only GET and does not issue a guest or send an LLM request', async () => {
  const calls = [];
  const client = createNpcChatClient({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json({ enabled: true, model: 'deepseek-flash', provider: 'DeepSeek', maxMessageChars: 900 });
  } });
  assert.deepEqual(await client.status(), { enabled: true, model: 'deepseek-flash', provider: 'DeepSeek', maxMessageChars: 600 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/npc/chat/status');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
});

test('unconfigured status remains disabled rather than fabricating a reply', async () => {
  const client = createNpcChatClient({ fetchImpl: async () => json({ enabled: false, model: 'deepseek-flash', provider: 'DeepSeek', maxMessageChars: 600 }) });
  assert.equal((await client.status()).enabled, false);
});

test('status rejects malformed schemas and non-JSON successes', async () => {
  for (const response of [json({ enabled: 'yes', model: 'm', provider: 'DeepSeek' }), json({ enabled: true, provider: 'DeepSeek' }), new Response('<html>oops</html>')]) {
    const client = createNpcChatClient({ fetchImpl: async () => response });
    await assert.rejects(client.status(), { code: 'INVALID_RESPONSE' });
  }
});

test('send creates one in-memory guest, reuses it and sends only current message IDs', async () => {
  const calls = [];
  const client = createNpcChatClient({ fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    return url === '/api/guest' ? identity() : json(reply(body));
  } });
  const first = makeRequest();
  const result = await client.send(first);
  await client.send(makeRequest({ message: '货架上有什么？', conversationId: result.conversationId }));
  assert.deepEqual(calls.map(call => call.url), ['/api/guest', '/api/npc/chat', '/api/npc/chat']);
  assert.equal(calls[1].body.token, 'signed-guest-token');
  assert.deepEqual(Object.keys(calls[1].body).sort(), ['message', 'npcId', 'requestId', 'token']);
  assert.equal(calls[2].body.conversationId, 'conversation-ali');
  assert.equal(result.reply, '在整理杂货铺的新货架呢。');
});

test('failed POST is not automatically retried; explicit retry preserves requestId and message', async () => {
  const chatBodies = [];
  const client = createNpcChatClient({ fetchImpl: async (url, options) => {
    if (url === '/api/guest') return identity();
    const body = JSON.parse(options.body);
    chatBodies.push(body);
    return chatBodies.length === 1 ? json({ code: 'UPSTREAM_ERROR', error: 'provider error includes secret' }, 502) : json(reply(body));
  } });
  const request = makeRequest();
  await assert.rejects(client.send(request), error => error.code === 'UPSTREAM_ERROR' && !error.message.includes('secret'));
  assert.equal(chatBodies.length, 1);
  await client.send(request);
  assert.equal(chatBodies.length, 2);
  assert.deepEqual(chatBodies[0], chatBodies[1]);
});

test('chat timeout aborts pending fetch and does not silently repeat the POST', async () => {
  let posts = 0;
  const client = createNpcChatClient({ timeoutMs: 5, fetchImpl: async (url, options) => {
    if (url === '/api/guest') return identity();
    posts += 1;
    return waitForAbort(options.signal);
  } });
  await assert.rejects(client.send(makeRequest()), error => error.code === 'TIMEOUT' && error.retryable);
  assert.equal(posts, 1);
});

test('abort before status or send makes no network requests', async () => {
  let calls = 0;
  const client = createNpcChatClient({ fetchImpl: async () => { calls += 1; return identity(); } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.status({ signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(client.send(makeRequest(), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('abort while sending is distinguishable from timeout and does not retry', async () => {
  const controller = new AbortController();
  let posts = 0;
  const client = createNpcChatClient({ fetchImpl: async (url, options) => {
    if (url === '/api/guest') return identity();
    posts += 1;
    queueMicrotask(() => controller.abort());
    return waitForAbort(options.signal);
  } });
  await assert.rejects(client.send(makeRequest(), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(posts, 1);
});

test('malformed guest prevents a chat provider request', async () => {
  const urls = [];
  const client = createNpcChatClient({ fetchImpl: async url => { urls.push(url); return json({ guestId: 'x' }); } });
  await assert.rejects(client.send(makeRequest()), { code: 'INVALID_RESPONSE' });
  assert.deepEqual(urls, ['/api/guest']);
});

test('reply must be non-empty and match both request and NPC identities', async () => {
  const request = makeRequest();
  const invalid = [{ reply: '' }, { reply: ' '.repeat(20) }, { reply: 'a'.repeat(12001) }, { requestId: 'another' }, { npcId: 'npc-alan' }, { conversationId: '' }, { model: undefined }];
  for (const mutation of invalid) {
    const client = createNpcChatClient({ fetchImpl: async url => url === '/api/guest' ? identity() : json({ ...reply(request), ...mutation }) });
    await assert.rejects(client.send(request), { code: 'INVALID_RESPONSE' });
  }
});

test('rate limit gives a safe user-facing error, not provider internals', async () => {
  const client = createNpcChatClient({ fetchImpl: async url => url === '/api/guest' ? identity() : json({ code: 'RATE_LIMITED', error: 'secret-key-value' }, 429) });
  await assert.rejects(client.send(makeRequest()), error => error.status === 429 && error.retryable && !error.message.includes('secret-key-value'));
});

test('401 clears expired guest so a later explicit send may reconnect, with no automatic POST retry', async () => {
  let guests = 0, chats = 0;
  const client = createNpcChatClient({ fetchImpl: async (url, options) => {
    if (url === '/api/guest') { guests += 1; return identity(); }
    chats += 1;
    return chats === 1 ? json({ code: 'INVALID_TOKEN' }, 401) : json(reply(JSON.parse(options.body)));
  } });
  await assert.rejects(client.send(makeRequest()), error => error.code === 'INVALID_TOKEN' && !error.retryable);
  assert.equal(chats, 1);
  await client.send(makeRequest());
  assert.equal(guests, 2);
  assert.equal(chats, 2);
});

test('chat UI keeps IME guard, privacy notice, escaped text and fixed-dialogue distinction', async () => {
  const component = await readFile(new URL('../src/components/NpcChat.jsx', import.meta.url), 'utf8');
  const directory = await readFile(new URL('../src/components/NpcDirectory.jsx', import.meta.url), 'utf8');
  assert.match(component, /onCompositionStart/);
  assert.match(component, /event\.nativeEvent\.isComposing/);
  assert.match(component, /event\.shiftKey/);
  assert.match(component, /<p>\{message\.text\}<\/p>/);
  assert.doesNotMatch(component, /dangerouslySetInnerHTML|localStorage|sessionStorage/);
  assert.match(component, /请勿填写隐私/);
  assert.match(component, /服务器内存/);
  assert.match(directory, /固定台词/);
  assert.match(directory, /<NpcChat key=\{selected\.id\}/);
});

test('resident chat shortcut focuses the composer without sending and sticky portrait is height-aware', async () => {
  const directory = await readFile(new URL('../src/components/NpcDirectory.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/components/npc-directory.css', import.meta.url), 'utf8');
  const shortcut = directory.slice(directory.indexOf('function openFreeChat()'), directory.indexOf('\n  return <section', directory.indexOf('function openFreeChat()')));
  assert.match(shortcut, /querySelector\('textarea:not\(:disabled\)'\)/);
  assert.match(shortcut, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(shortcut, /npcChatClient|\.send\(|\.submit\(/);
  assert.match(directory, /portrait\.offsetHeight \+ headerHeight \+ 32 <= dialog\.clientHeight/);
  assert.match(directory, /observer\.disconnect\(\)/);
  assert.match(css, /@media \(min-width: 701px\)/);
  assert.match(css, /\.npc-chat-shortcut \{[^}]*min-height: 46px/);
  assert.throws(() => makeRequest({ conversationId: '' }), /请重新连接对话/);
});
