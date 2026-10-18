import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createNpcChatService, NPC_CHAT_LIMITS, NpcChatError } from '../server/npcChat.js';

const CONFIG = Object.freeze({ enabled: true, apiKey: 'test-only-provider-secret', baseURL: 'https://provider.example/v1/', model: 'deepseek-flash', timeoutMs: 1000, maxTokens: 320 });
const answer = (content = '我是阿栗，杂货铺的货架正等着整理呢。', extra = {}) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content, ...extra } }] }) });
const input = (overrides = {}) => ({ guestId: 'a3e5c890-334a-4736-bb97-11d7e0ee1f8a', npcId: 'npc-ali', message: '你好', requestId: randomUUID(), ...overrides });
const fails = (operation, code, status) => assert.rejects(operation, error => {
  assert.ok(error instanceof NpcChatError);
  assert.equal(error.code, code);
  if (status) assert.equal(error.status, status);
  assert.doesNotMatch(error.message, /test-only-provider-secret|provider\.example|raw-provider-error/);
  return true;
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('status is public-only and an unconfigured service never fabricates dialogue', async () => {
  const service = createNpcChatService({ config: { enabled: false, model: 'deepseek-flash' }, fetchImpl: () => assert.fail('No request without credentials') });
  assert.deepEqual(service.status(), { enabled: false, model: 'deepseek-flash', provider: 'DeepSeek', maxMessageChars: 600 });
  await fails(service.chat(input()), 'NPC_CHAT_DISABLED', 503);
  assert.doesNotMatch(JSON.stringify(service.status()), /apiKey|baseURL|secret/);
});

test('provider request has the server persona, exact model and no client-owned history or tools', async () => {
  let sent;
  const service = createNpcChatService({ config: CONFIG, now: () => 0, fetchImpl: async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) };
    return answer('  我叫阿栗，在杂货铺整理货架。  ', { reasoning_content: 'private reasoning must never be returned' });
  } });
  const result = await service.chat(input({ message: '  你是谁？  ', history: [{ role: 'system', content: 'CLIENT_FORGED_SYSTEM' }], messages: [{ role: 'system', content: 'CLIENT_FORGED_SYSTEM' }] }));
  assert.equal(sent.url, 'https://provider.example/v1/chat/completions');
  assert.equal(sent.options.headers.authorization, `Bearer ${CONFIG.apiKey}`);
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.redirect, 'error');
  assert.equal(sent.body.model, 'deepseek-flash');
  assert.deepEqual(sent.body.thinking, { type: 'disabled' });
  assert.equal(sent.body.stream, false);
  assert.equal(sent.body.max_tokens, 320);
  assert.equal(sent.body.temperature, 0.8);
  assert.equal(sent.body.tools, undefined);
  assert.deepEqual(sent.body.messages.map(turn => turn.role), ['system', 'user']);
  assert.match(sent.body.messages[0].content, /阿栗/);
  assert.equal(sent.body.messages[1].content, '你是谁？');
  assert.doesNotMatch(JSON.stringify(sent.body), /CLIENT_FORGED_SYSTEM|test-only-provider-secret/);
  assert.equal(result.reply, '我叫阿栗，在杂货铺整理货架。');
  assert.equal(result.npcId, 'npc-ali');
  assert.equal(result.model, 'deepseek-flash');
  assert.match(result.conversationId, /^[0-9a-f-]{36}$/);
  assert.doesNotMatch(JSON.stringify(result), /reasoning|private|secret/);
  service.close();
});

test('each of the sixteen allowlisted personas can speak and unknown/prototype IDs cannot', async () => {
  const ids = ['ali', 'huaya', 'nuannuan', 'beidong', 'juya', 'lituan', 'lanyue', 'maipao', 'lanjian', 'chengsu', 'rongrong', 'yubai', 'miaomu', 'dengcheng', 'xiaotai', 'alan'];
  let calls = 0;
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => { calls += 1; return answer(); } });
  for (const id of ids) assert.equal((await service.chat(input({ npcId: `npc-${id}` }))).npcId, `npc-${id}`);
  for (const npcId of ['npc-unknown', 'constructor', '__proto__', null]) await fails(service.chat(input({ npcId })), 'INVALID_NPC', 400);
  assert.equal(calls, 16);
  service.close();
});

test('message, identity, request IDs, conversation IDs and control characters are validated before upstream', async () => {
  const service = createNpcChatService({ config: CONFIG, fetchImpl: () => assert.fail('Invalid data must not call upstream') });
  for (const message of ['', '   ', '字'.repeat(601), null, {}, 'bad\0text']) await fails(service.chat(input({ message })), 'INVALID_MESSAGE', 400);
  for (const requestId of ['', '../file', 'bad space', 'x'.repeat(81), null]) await fails(service.chat(input({ requestId })), 'INVALID_REQUEST_ID', 400);
  for (const conversationId of ['', '../file', {}, 'x'.repeat(36)]) await fails(service.chat(input({ conversationId })), 'INVALID_CONVERSATION', 400);
  await fails(service.chat(input({ guestId: 'arbitrary-string' })), 'INVALID_GUEST', 401);
  await fails(service.chat(null), 'INVALID_REQUEST', 400);
  await fails(service.chat([]), 'INVALID_REQUEST', 400);
  service.close();
});

test('the 600 character limit counts Unicode characters rather than UTF-16 halves', async () => {
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => answer() });
  assert.ok((await service.chat(input({ message: '🌱'.repeat(600) }))).reply);
  await fails(service.chat(input({ message: '🌱'.repeat(601) })), 'INVALID_MESSAGE', 400);
  service.close();
});

test('history belongs to the server, is capped at twelve messages and is isolated by guest and NPC', async () => {
  const calls = [];
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async (url, options) => { calls.push(JSON.parse(options.body)); return answer(`reply-${calls.length}`); } });
  let conversationId;
  for (let i = 0; i < 10; i += 1) {
    const result = await service.chat(input({ message: `turn-${i}`, conversationId }));
    conversationId = result.conversationId;
  }
  const latest = calls[9].messages;
  assert.equal(latest.length, 14, 'one system + twelve history messages + current message');
  assert.deepEqual(latest.slice(1, 3), [{ role: 'user', content: 'turn-3' }, { role: 'assistant', content: 'reply-4' }]);
  assert.deepEqual(latest.at(-1), { role: 'user', content: 'turn-9' });
  const newNpc = await service.chat(input({ npcId: 'npc-nuannuan', message: '暖暖你好' }));
  assert.notEqual(newNpc.conversationId, conversationId);
  assert.equal(calls[10].messages.length, 2);
  assert.match(calls[10].messages[0].content, /扮演暖暖/);
  await service.chat(input({ guestId: randomUUID() }));
  assert.equal(calls[11].messages.length, 2);
  await fails(service.chat(input({ guestId: randomUUID(), conversationId })), 'CONVERSATION_FORBIDDEN', 403);
  await fails(service.chat(input({ npcId: 'npc-nuannuan', conversationId })), 'CONVERSATION_FORBIDDEN', 403);
  assert.equal(calls.length, 12);
  service.close();
});

test('successful retries are idempotent even without the first conversation ID and do not duplicate history', async () => {
  const bodies = [];
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async (url, options) => { bodies.push(JSON.parse(options.body)); return answer(); } });
  const message = input();
  const first = await service.chat(message);
  const retry = await service.chat(message);
  assert.deepEqual(retry, first);
  assert.equal(bodies.length, 1);
  retry.reply = 'client mutation';
  assert.equal((await service.chat(message)).reply, first.reply);
  await fails(service.chat({ ...message, message: 'different payload' }), 'REQUEST_ID_REUSED', 409);
  await service.chat(input({ conversationId: first.conversationId }));
  assert.equal(bodies[1].messages.length, 4);
  service.close();
});

test('duplicate concurrent requests are rejected, then replay the successful cache without another upstream call', async () => {
  const gate = deferred();
  let calls = 0;
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => { calls += 1; await gate.promise; return answer(); } });
  const message = input();
  const first = service.chat(message);
  const duplicateController = new AbortController();
  await fails(service.chat({ ...message, signal: duplicateController.signal }), 'NPC_CHAT_IN_FLIGHT', 429);
  duplicateController.abort();
  await fails(service.chat(input()), 'NPC_CHAT_IN_FLIGHT', 429);
  await fails(service.chat(input({ npcId: 'npc-nuannuan' })), 'NPC_CHAT_IN_FLIGHT', 429);
  await fails(service.chat({ ...message, message: 'edited' }), 'REQUEST_ID_REUSED', 409);
  assert.equal(calls, 1);
  gate.resolve();
  const result = await first;
  assert.deepEqual(await service.chat(message), result);
  assert.equal(calls, 1, 'cancelling the rejected duplicate must not cancel the original or repeat upstream');
  assert.ok((await service.chat(input())).reply);
  assert.equal(calls, 2);
  service.close();
});

test('separate guests may chat concurrently', async () => {
  const gate = deferred();
  let calls = 0;
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => { calls += 1; await gate.promise; return answer(); } });
  const first = service.chat(input());
  const second = service.chat(input({ guestId: randomUUID() }));
  assert.equal(calls, 2);
  gate.resolve();
  await Promise.all([first, second]);
  service.close();
});

test('global concurrency is capped at four upstream calls and recovers after completion', async () => {
  const gate = deferred();
  let calls = 0;
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => { calls += 1; await gate.promise; return answer(); } });
  const active = Array.from({ length: NPC_CHAT_LIMITS.concurrentRequests }, () => service.chat(input({ guestId: randomUUID() })));
  await fails(service.chat(input({ guestId: randomUUID() })), 'NPC_CHAT_CAPACITY', 503);
  assert.equal(calls, 4);
  gate.resolve();
  await Promise.all(active);
  await service.chat(input({ guestId: randomUUID() }));
  assert.equal(calls, 5);
  service.close();
});

test('failed requests do not enter history and may retry the identical request ID', async () => {
  let calls = 0;
  const bodies = [];
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async (url, options) => {
    calls += 1; bodies.push(JSON.parse(options.body));
    if (calls === 1) throw new Error('raw-provider-error test-only-provider-secret');
    return answer();
  } });
  const message = input();
  await fails(service.chat(message), 'NPC_CHAT_UPSTREAM', 502);
  await fails(service.chat({ ...message, message: 'changed' }), 'REQUEST_ID_REUSED', 409);
  assert.ok((await service.chat(message)).reply);
  assert.equal(bodies[1].messages.length, 2);
  assert.equal(calls, 2);
  service.close();
});

test('provider HTTP errors are friendly and never read or reflect error bodies', async () => {
  for (const [status, code, expected] of [[429, 'NPC_CHAT_BUSY', 429], [401, 'NPC_CHAT_DISABLED', 503], [403, 'NPC_CHAT_DISABLED', 503], [500, 'NPC_CHAT_UPSTREAM', 502]]) {
    const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => ({ ok: false, status, json: () => assert.fail('Provider error body must not be read') }) });
    await fails(service.chat(input()), code, expected);
    service.close();
  }
});

test('malformed, empty, overlong, tool-only or reasoning-only replies fail instead of inventing dialogue', async () => {
  const variants = [
    answer(''), answer('  '), answer('字'.repeat(NPC_CHAT_LIMITS.replyChars + 1)), answer('bad\0reply'),
    answer(null), answer('text', { tool_calls: [{ function: { name: 'give_coins' } }] }),
    answer('text', { function_call: { name: 'give_coins' } }),
    { ok: true, json: async () => ({ choices: [{ message: { reasoning_content: 'hidden' } }] }) },
    { ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: 'unfinished' } }] }) },
    { ok: true, json: async () => ({ choices: [] }) },
    { ok: true, json: async () => { throw new Error('raw-provider-error'); } }, null,
  ];
  for (const response of variants) {
    const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => response });
    await fails(service.chat(input()), 'NPC_CHAT_UPSTREAM', 502);
    service.close();
  }
});

test('real response streams are bounded to 64 KB before parsing, including unexpected reasoning output', async () => {
  const oversized = JSON.stringify({ choices: [{ message: { content: '你好', reasoning_content: 'x'.repeat(NPC_CHAT_LIMITS.responseBytes) } }] });
  const cases = [
    new Response(oversized),
    new Response('{}', { headers: { 'content-length': String(NPC_CHAT_LIMITS.responseBytes + 1) } }),
    new Response('{invalid json'),
  ];
  for (const response of cases) {
    const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => response });
    await fails(service.chat(input()), 'NPC_CHAT_UPSTREAM', 502);
    service.close();
  }
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '阿栗向你挥挥手。' }, finish_reason: 'stop' }] })) });
  assert.equal((await service.chat(input())).reply, '阿栗向你挥挥手。');
  service.close();
});

test('timeout covers a fetch implementation that ignores abort and releases the guest lock', async () => {
  let upstreamSignal;
  let calls = 0;
  const service = createNpcChatService({ config: { ...CONFIG, timeoutMs: 15 }, fetchImpl: async (url, options) => {
    calls += 1; upstreamSignal = options.signal;
    if (calls === 1) return new Promise(() => {});
    return answer();
  } });
  await fails(service.chat(input()), 'NPC_CHAT_TIMEOUT', 504);
  assert.equal(upstreamSignal.aborted, true);
  assert.ok((await service.chat(input())).reply);
  service.close();
});

test('timeout also covers a stalled response body after headers arrive', async () => {
  let upstreamSignal;
  const service = createNpcChatService({ config: { ...CONFIG, timeoutMs: 15 }, fetchImpl: async (url, options) => {
    upstreamSignal = options.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  } });
  await fails(service.chat(input()), 'NPC_CHAT_TIMEOUT', 504);
  assert.equal(upstreamSignal.aborted, true);
  service.close();
});

test('client cancellation before or during a request is clean and never commits late output', async () => {
  let calls = 0;
  const gate = deferred();
  const bodies = [];
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async (url, options) => {
    calls += 1; bodies.push(JSON.parse(options.body));
    if (calls === 1) { await gate.promise; return answer('late output'); }
    return answer();
  } });
  const alreadyCancelled = new AbortController(); alreadyCancelled.abort();
  await fails(service.chat(input({ signal: alreadyCancelled.signal })), 'NPC_CHAT_CANCELLED', 499);
  assert.equal(calls, 0);
  const controller = new AbortController();
  const first = service.chat(input({ signal: controller.signal }));
  controller.abort();
  await fails(first, 'NPC_CHAT_CANCELLED', 499);
  gate.resolve();
  await service.chat(input());
  assert.equal(bodies[1].messages.length, 2);
  service.close();
});

test('closing the service cancels in-flight operations and disables new chat', async () => {
  const service = createNpcChatService({ config: CONFIG, fetchImpl: () => new Promise(() => {}) });
  const request = service.chat(input());
  service.close();
  await fails(request, 'NPC_CHAT_CLOSED', 503);
  await fails(service.chat(input()), 'NPC_CHAT_CLOSED', 503);
  assert.equal(service.status().enabled, false);
  service.close();
});

test('conversations expire after thirty minutes without retaining old history', async () => {
  let time = 0;
  const bodies = [];
  const service = createNpcChatService({ config: CONFIG, now: () => time, fetchImpl: async (url, options) => { bodies.push(JSON.parse(options.body)); return answer(); } });
  const first = await service.chat(input());
  time += NPC_CHAT_LIMITS.sessionTtlMs;
  await fails(service.chat(input({ conversationId: first.conversationId })), 'CONVERSATION_EXPIRED', 404);
  const fresh = await service.chat(input());
  assert.notEqual(fresh.conversationId, first.conversationId);
  assert.equal(bodies[1].messages.length, 2);
  service.close();
});

test('the sixty-second background sweep removes expired conversations even without a new request', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let time = 0;
  const service = createNpcChatService({ config: CONFIG, now: () => time, fetchImpl: async () => answer() });
  try {
    const first = await service.chat(input());
    time = NPC_CHAT_LIMITS.sessionTtlMs;
    context.mock.timers.tick(NPC_CHAT_LIMITS.cleanupIntervalMs);
    // Rewind only the injected clock so the next request's on-demand prune
    // cannot itself expire this session. Absence proves the timer removed it.
    time = 1;
    await fails(service.chat(input({ conversationId: first.conversationId })), 'CONVERSATION_EXPIRED', 404);
  } finally { service.close(); }
});

test('background cleanup preserves a conversation while its model response is pending', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let time = 0;
  const gate = deferred();
  const service = createNpcChatService({ config: CONFIG, now: () => time, fetchImpl: async () => { await gate.promise; return answer(); } });
  try {
    const pending = service.chat(input());
    time = NPC_CHAT_LIMITS.sessionTtlMs + 1;
    context.mock.timers.tick(NPC_CHAT_LIMITS.cleanupIntervalMs);
    gate.resolve();
    const first = await pending;
    const followup = await service.chat(input({ conversationId: first.conversationId }));
    assert.equal(followup.conversationId, first.conversationId);
  } finally { service.close(); }
});

test('closing the service clears its background cleanup timer', async context => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let clockReads = 0;
  const service = createNpcChatService({ config: CONFIG, now: () => { clockReads += 1; return 0; } });
  context.mock.timers.tick(NPC_CHAT_LIMITS.cleanupIntervalMs);
  assert.equal(clockReads, 1, 'maintenance runs before close');
  service.close();
  context.mock.timers.tick(NPC_CHAT_LIMITS.cleanupIntervalMs * 2);
  assert.equal(clockReads, 1, 'no maintenance runs after close');
});

test('session and request caches are bounded with recent successful retries preserved', async () => {
  let time = 0;
  let calls = 0;
  const service = createNpcChatService({ config: CONFIG, now: () => time, fetchImpl: async () => { calls += 1; return answer(); } });
  const oldest = await service.chat(input());
  for (let i = 0; i < NPC_CHAT_LIMITS.sessions; i += 1) { time += 1; await service.chat(input({ guestId: randomUUID() })); }
  await fails(service.chat(input({ conversationId: oldest.conversationId })), 'CONVERSATION_EXPIRED', 404);
  const guestId = randomUUID();
  let recent;
  for (let i = 0; i < NPC_CHAT_LIMITS.requestsPerSession + 8; i += 1) { recent = input({ guestId }); await service.chat(recent); }
  const before = calls;
  await service.chat(recent);
  assert.equal(calls, before);
  service.close();
});

const speechFails = (operation, code, status) => assert.throws(operation, error => {
  assert.ok(error instanceof NpcChatError);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  assert.doesNotMatch(error.message, /test-only-provider-secret|provider\.example|raw-provider-error|PRIVATE_PLAYER_TEXT/);
  return true;
});

test('speech lookup returns only a frozen copy of a completed owned reply without another upstream call', async () => {
  let calls = 0;
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => { calls += 1; return answer('我正在整理货架，欢迎来聊聊。'); } });
  try {
    const request = input({ message: 'PRIVATE_PLAYER_TEXT' });
    const result = await service.chat(request);
    const query = { guestId: request.guestId, npcId: request.npcId, conversationId: result.conversationId, requestId: request.requestId };
    const speech = service.getReplyForSpeech({ ...query, message: 'PRIVATE_PLAYER_TEXT', text: 'FORGED_SPEECH', reply: 'FORGED_REPLY' });
    assert.deepEqual(speech, { reply: result.reply, npcId: result.npcId, conversationId: result.conversationId, requestId: result.requestId });
    assert.ok(Object.isFrozen(speech));
    assert.throws(() => { speech.reply = 'mutated'; }, TypeError);
    assert.notEqual(service.getReplyForSpeech(query), speech);
    assert.deepEqual(service.getReplyForSpeech(query), speech);
    assert.doesNotMatch(JSON.stringify(speech), /PRIVATE_PLAYER_TEXT|FORGED_|apiKey|provider|model|history|system/);
    assert.equal(calls, 1, 'speech lookup must never invoke the language model');
  } finally { service.close(); }
});

test('speech lookup validates every required identifier and never creates a conversation', async () => {
  let calls = 0;
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => { calls += 1; return answer(); } });
  try {
    const query = { ...input(), conversationId: randomUUID() };
    for (const invalid of [undefined, null, [], 1]) speechFails(() => service.getReplyForSpeech(invalid), 'INVALID_REQUEST', 400);
    for (const guestId of [undefined, null, 'invalid', {}, 'a'.repeat(36)]) speechFails(() => service.getReplyForSpeech({ ...query, guestId }), 'INVALID_GUEST', 401);
    for (const npcId of [undefined, null, {}, 'npc-unknown', 'constructor', '__proto__']) speechFails(() => service.getReplyForSpeech({ ...query, npcId }), 'INVALID_NPC', 400);
    for (const conversationId of [undefined, null, '', {}, 'bad', 'a'.repeat(36)]) speechFails(() => service.getReplyForSpeech({ ...query, conversationId }), 'INVALID_CONVERSATION', 400);
    for (const requestId of [undefined, null, '', {}, '../secret', 'x'.repeat(81)]) speechFails(() => service.getReplyForSpeech({ ...query, requestId }), 'INVALID_REQUEST_ID', 400);
    speechFails(() => service.getReplyForSpeech(query), 'CONVERSATION_EXPIRED', 404);
    assert.equal(calls, 0);
    // Explicitly using that unknown ID for a later chat must still fail: a
    // speech lookup cannot silently allocate a session for the signed guest.
    await fails(service.chat(query), 'CONVERSATION_EXPIRED', 404);
    assert.equal(calls, 0);
    const created = await service.chat(input());
    assert.notEqual(created.conversationId, query.conversationId);
  } finally { service.close(); }
});

test('speech lookup rejects a different guest or NPC even with the correct conversation and request IDs', async () => {
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => answer() });
  try {
    const request = input();
    const result = await service.chat(request);
    const query = { ...request, conversationId: result.conversationId };
    speechFails(() => service.getReplyForSpeech({ ...query, guestId: randomUUID() }), 'CONVERSATION_FORBIDDEN', 403);
    speechFails(() => service.getReplyForSpeech({ ...query, npcId: 'npc-nuannuan' }), 'CONVERSATION_FORBIDDEN', 403);
    assert.equal(service.getReplyForSpeech(query).reply, result.reply);
  } finally { service.close(); }
});

test('speech lookup cannot read the player original, unknown, pending or failed replies', async () => {
  let calls = 0;
  const gate = deferred();
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => {
    calls += 1;
    if (calls === 2) { await gate.promise; return answer('稍后完成的回复'); }
    if (calls === 3) throw new Error('raw-provider-error');
    return answer('这是居民回复，不是玩家原文。');
  } });
  try {
    const firstRequest = input({ message: 'PRIVATE_PLAYER_TEXT' });
    const first = await service.chat(firstRequest);
    const query = { ...firstRequest, conversationId: first.conversationId };
    assert.notEqual(service.getReplyForSpeech(query).reply, firstRequest.message);
    speechFails(() => service.getReplyForSpeech({ ...query, requestId: 'PRIVATE_PLAYER_TEXT' }), 'REPLY_NOT_FOUND', 404);
    speechFails(() => service.getReplyForSpeech({ ...query, requestId: 'unknown-request' }), 'REPLY_NOT_FOUND', 404);
    const nextRequest = input({ conversationId: first.conversationId });
    const pending = service.chat(nextRequest);
    speechFails(() => service.getReplyForSpeech(nextRequest), 'REPLY_NOT_FOUND', 404);
    assert.equal(service.getReplyForSpeech(query).reply, first.reply, 'an earlier completed reply remains readable while another is pending');
    gate.resolve();
    const completed = await pending;
    assert.equal(service.getReplyForSpeech(nextRequest).reply, completed.reply);
    const failedRequest = input({ conversationId: first.conversationId });
    await fails(service.chat(failedRequest), 'NPC_CHAT_UPSTREAM', 502);
    speechFails(() => service.getReplyForSpeech(failedRequest), 'REPLY_NOT_FOUND', 404);
    assert.equal(calls, 3);
  } finally { gate.resolve(); service.close(); }
});

test('speech lookup cannot renew a conversation and expires at the original idle deadline', async () => {
  let time = 0;
  let calls = 0;
  const service = createNpcChatService({ config: CONFIG, now: () => time, fetchImpl: async () => { calls += 1; return answer(); } });
  try {
    const request = input();
    const result = await service.chat(request);
    const query = { ...request, conversationId: result.conversationId };
    for (const moment of [1, NPC_CHAT_LIMITS.sessionTtlMs / 2, NPC_CHAT_LIMITS.sessionTtlMs - 1]) {
      time = moment;
      assert.equal(service.getReplyForSpeech(query).reply, result.reply);
    }
    time = NPC_CHAT_LIMITS.sessionTtlMs;
    speechFails(() => service.getReplyForSpeech(query), 'CONVERSATION_EXPIRED', 404);
    // Rewinding the injected test clock proves lookup actually pruned, rather
    // than merely rejecting an expired entry left in the cache.
    time = 1;
    speechFails(() => service.getReplyForSpeech(query), 'CONVERSATION_EXPIRED', 404);
    assert.equal(calls, 1);
  } finally { service.close(); }
});

test('speech lookup cannot use an aged session retained only for an in-flight response', async () => {
  let time = 0;
  let calls = 0;
  const gate = deferred();
  const service = createNpcChatService({ config: CONFIG, now: () => time, fetchImpl: async () => {
    calls += 1;
    if (calls === 2) await gate.promise;
    return answer();
  } });
  try {
    const request = input();
    const result = await service.chat(request);
    const query = { ...request, conversationId: result.conversationId };
    const pending = service.chat(input({ conversationId: result.conversationId }));
    time = NPC_CHAT_LIMITS.sessionTtlMs;
    speechFails(() => service.getReplyForSpeech(query), 'CONVERSATION_EXPIRED', 404);
    gate.resolve();
    await pending;
  } finally { gate.resolve(); service.close(); }
});

test('speech lookup rejects evicted request entries and never falls back to history or player text', async () => {
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => answer() });
  try {
    const request = input({ message: 'PRIVATE_PLAYER_TEXT' });
    const result = await service.chat(request);
    for (let index = 0; index < NPC_CHAT_LIMITS.requestsPerSession; index += 1) {
      await service.chat(input({ conversationId: result.conversationId }));
    }
    speechFails(() => service.getReplyForSpeech({ ...request, conversationId: result.conversationId }), 'REPLY_NOT_FOUND', 404);
  } finally { service.close(); }
});

test('speech lookup is disabled after close and never leaks retained or caller-supplied text', async () => {
  const service = createNpcChatService({ config: CONFIG, fetchImpl: async () => answer() });
  const request = input({ message: 'PRIVATE_PLAYER_TEXT' });
  const result = await service.chat(request);
  service.close();
  speechFails(() => service.getReplyForSpeech({ ...request, conversationId: result.conversationId }), 'NPC_CHAT_CLOSED', 503);
  speechFails(() => service.getReplyForSpeech(null), 'NPC_CHAT_CLOSED', 503);
});
