import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTownServer } from '../server/index.js';
import { readAiDroneUsage } from '../src/lib/aiDroneClient.js';
import { createAiDroneAccessHash } from '../server/aiDroneAccess.js';

test('AI HTTP development gate requires password before invalid prompt or replay and never leaks secret fields', async () => {
  const password = 'http-local-test-only-code';
  const passwordHash = await createAiDroneAccessHash(password);
  let calls = 0, time = 100_000, sent;
  const score = { version: 1, title: '开发测试', synopsis: '本地模拟提供方，不产生收费调用。', seed: 123, scenes: ['ring', 'whale', 'galaxy', 'heart'].map(shape => ({ name: '星幕', description: '本地模拟。', shape, color: '#40AAFF', accent: '#FFDD99', duration: 10, motion: 'turn', transition: 'morph' })) };
  const server = await createTownServer({ port: 0, secret: 'http-access-local-guest-secret-test-only', aiDroneNow: () => time,
    aiDroneConfig: { enabled: true, apiKey: 'mock-provider-only', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash', dbPath: ':memory:', limits: { daily: 0, ipDaily: 0 }, accessRequired: true, accessPasswordHash: passwordHash },
    aiDroneFetch: async (_url, options) => { calls++; sent = options.body; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(score) } }] })); } });
  const post = async (path, body, origin) => {
    const response = await fetch(server.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const status = await (await fetch(server.url + '/api/drone-director/status')).json();
    assert.equal(status.enabled, true); assert.equal(status.accessRequired, true); assert.equal(status.development, true); assert.equal(status.unlimited, true);
    assert.equal(status.limit, null); assert.equal(status.limits.ipMinute, 3); assert.equal(status.limits.concurrent, 2); assert.equal(status.limits.guestConcurrent, 1); assert.equal(status.limits.timeoutMs, 45000);
    assert.doesNotMatch(JSON.stringify(status), /scrypt1|Password|password|mock-provider|apiKey|baseURL/);
    const input = { requestId: randomUUID(), mode: 'prompt', prompt: '开发测试主题' };
    assert.equal((await post('/api/drone-director/generate', { ...input, accessPassword: password })).status, 401);
    input.token = (await post('/api/guest', {})).body.token;
    assert.equal((await post('/api/drone-director/generate', { ...input, accessPassword: password }, 'https://evil.invalid')).status, 403);
    for (const accessPassword of [undefined, {}, '', 123, 'wrong-test-code']) {
      const denied = await post('/api/drone-director/generate', { ...input, prompt: '', accessPassword });
      assert.equal(denied.status, 403); assert.equal(denied.body.code, 'AI_DRONE_ACCESS_DENIED');
      assert.deepEqual(Object.keys(denied.body).sort(), ['charged', 'code', 'error', 'replayed']);
      assert.equal(denied.body.charged, false); assert.equal(denied.body.replayed, false);
    }
    const locked = await post('/api/drone-director/generate', { ...input, accessPassword: password });
    assert.equal(locked.status, 429); assert.equal(locked.body.code, 'AI_DRONE_ACCESS_RATE_LIMIT');
    assert.equal(calls, 0); assert.equal((await post('/api/drone-director/usage', { token: input.token })).body.usage.used, 0);
    time += 60_000;
    const generated = await post('/api/drone-director/generate', { ...input, accessPassword: password });
    assert.equal(generated.status, 200); assert.equal(generated.body.usage.used, 1); assert.equal(calls, 1);
    assert.equal(sent.includes(password), false); assert.equal(sent.includes(passwordHash), false);
    assert.equal(JSON.stringify(generated.body).includes(password), false); assert.equal(JSON.stringify(generated.body).includes('accessPassword'), false);
    const missingReplay = await post('/api/drone-director/generate', input);
    assert.equal(missingReplay.status, 403); assert.equal(missingReplay.body.charged, false); assert.equal(missingReplay.body.replayed, false);
    const replay = await post('/api/drone-director/generate', { ...input, accessPassword: password });
    assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.equal(calls, 1);
    for (let i = 0; i < 2; i++) assert.equal((await post('/api/drone-director/generate', { ...input, requestId: randomUUID(), accessPassword: password })).status, 200);
    const protectedRate = await post('/api/drone-director/generate', { ...input, requestId: randomUUID(), accessPassword: password });
    assert.equal(protectedRate.status, 429); assert.equal(protectedRate.body.code, 'AI_DRONE_IP_RATE_LIMIT'); assert.equal(calls, 3);
  } finally { await server.close(); }
});

test('AI director HTTP uses signed guest/origin gates and does not expose credentials or accept browser quota overrides', async () => {
  let calls = 0;
  const score = { version: 1, title: '星海', synopsis: '星光中的鲸', seed: 123, scenes: ['ring', 'whale', 'galaxy', 'heart'].map(shape => ({ name: '星幕', description: '星海里的鲸', shape, color: '#40AAFF', accent: '#FFDD99', duration: 10, motion: 'turn', transition: 'morph' })) };
  const server = await createTownServer({ port: 0, secret: 'test-ai-director-persistent-guest-secret-only', aiDroneConfig: { enabled: true, apiKey: 'private-test-key', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash', dbPath: ':memory:', limits: { daily: 1 } }, aiDroneFetch: async () => { calls++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(score) } }] })); } });
  const post = async (path, body, origin) => { const response = await fetch(server.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  try {
    const status = await (await fetch(server.url + '/api/drone-director/status')).json();
    assert.equal(status.enabled, true); assert.equal(status.limit, 1); assert.doesNotMatch(JSON.stringify(status), /private-test|apiKey|baseURL|dbPath/);
    const input = { requestId: randomUUID(), mode: 'prompt', prompt: '鲸鱼的星空', limit: 1000 };
    assert.equal((await post('/api/drone-director/generate', input)).status, 401);
    const guest = (await post('/api/guest', {})).body;
    input.token = guest.token;
    assert.equal((await post('/api/drone-director/generate', input, 'https://evil.invalid')).status, 403);
    const usage = await post('/api/drone-director/usage', { token: guest.token });
    assert.equal(usage.body.usage.used, 0);
    const generated = await post('/api/drone-director/generate', input);
    assert.equal(generated.status, 200); assert.equal(generated.body.show.score.title, '星海'); assert.equal(generated.body.usage.used, 1);
    assert.equal((await post('/api/drone-director/generate', input)).body.replayed, true);
    const exhausted = await post('/api/drone-director/generate', { ...input, requestId: randomUUID() });
    assert.equal(exhausted.status, 429); assert.equal(exhausted.body.code, 'AI_DRONE_DAILY_LIMIT'); assert.equal(exhausted.body.charged, false); assert.equal(exhausted.body.usage.remaining, 0);
    assert.equal(calls, 1);
    assert.equal((await post('/api/drone-director/generate', { ...input, requestId: randomUUID(), prompt: 'x'.repeat(9000) })).status, 413);
  } finally { await server.close(); }
});

test('AI director unlimited HTTP crosses old guest and IP day caps while keeping signed identity and replay', async () => {
  let calls = 0;
  const score = { version: 1, title: '不限次模拟验收', synopsis: '仅本地模拟，不调用真实模型。', seed: 123,
    scenes: ['ring', 'whale', 'galaxy', 'heart'].map(shape => ({ name: '星幕', description: '本地模拟数据。', shape, color: '#40AAFF', accent: '#FFDD99', duration: 10, motion: 'turn', transition: 'morph' })) };
  const server = await createTownServer({ port: 0, secret: 'test-unlimited-persistent-guest-secret-only',
    aiDroneConfig: { enabled: true, apiKey: 'mock-only-key', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash', dbPath: ':memory:', limits: { daily: 0, ipDaily: 0, ipMinute: 100 } },
    aiDroneFetch: async () => { calls++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(score) } }] })); } });
  const post = async (path, body, origin) => {
    const response = await fetch(server.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const status = await (await fetch(server.url + '/api/drone-director/status')).json();
    assert.equal(status.unlimited, true); assert.equal(status.limit, null);
    assert.equal(status.limits.daily, 0); assert.equal(status.limits.ipDaily, 0);
    assert.equal(status.limits.concurrent, 2); assert.equal(status.limits.guestConcurrent, 1);
    assert.equal(status.limits.timeoutMs, 45000);
    const input = { requestId: randomUUID(), mode: 'prompt', prompt: '模拟不限次演出' };
    assert.equal((await post('/api/drone-director/generate', input)).status, 401);
    const guest = (await post('/api/guest', {})).body;
    input.token = guest.token;
    assert.equal((await post('/api/drone-director/generate', input, 'https://evil.invalid')).status, 403);
    assert.equal(calls, 0);
    for (let count = 1; count <= 32; count++) {
      input.requestId = randomUUID();
      const response = await post('/api/drone-director/generate', input);
      assert.equal(response.status, 200, `mock request ${count}`);
      const usage = readAiDroneUsage(response.body.usage);
      assert.ok(usage); assert.equal(usage.unlimited, true);
      assert.equal(usage.limit, null); assert.equal(usage.remaining, null); assert.equal(usage.used, count);
      assert.equal(usage.resetAt % 86400000, 57600000);
    }
    const replay = await post('/api/drone-director/generate', input);
    assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.usage.used, 32); assert.equal(calls, 32);
    assert.equal((await post('/api/drone-director/usage', { token: guest.token })).body.usage.used, 32);
  } finally { await server.close(); }
});
