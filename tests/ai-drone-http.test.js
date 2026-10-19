import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTownServer } from '../server/index.js';

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
