import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTownServer } from '../server/index.js';
import { createArchitectPasswordHash } from '../server/architect/access.js';
import { ARCHITECT_PLOTS } from '../shared/architectPlan.js';

test('architect HTTP authenticates generation, keeps status public, limits daily project globally and never reflects secrets', async () => {
  let calls = 0, sent;
  const password = 'http-test-engineer-approval-only', passwordHash = await createArchitectPasswordHash(password);
  const server = await createTownServer({ port: 0, secret: 'architect-test-guest-signing-secret-only', architectSchedule: false,
    npcConfig: { enabled: false }, npcSpeechConfig: { enabled: false }, aiDroneConfig: { enabled: false },
    architectConfig: { enabled: true, apiKey: 'mock-engineer-key-only', model: 'deepseek-flash', baseURL: 'https://api.deepseek.com/v1', dbPath: ':memory:', passwordHash },
    architectFetch: async (_url, options) => { sent = options.body; const plotId = ARCHITECT_PLOTS[calls++].id;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ version: 1, name: '海风亭', description: '新增一处休憩亭。', plotId, kind: 'pavilion', palette: 'sage', orientation: 90 }) } }] })); } });
  const post = async (path, body, origin) => {
    const result = await fetch(server.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    return { status: result.status, body: await result.json() };
  };
  try {
    const status = await (await fetch(server.url + '/api/architect/status')).json(); assert.equal(status.enabled, true);
    const request = { idempotencyKey: randomUUID(), brief: '休憩亭' };
    assert.equal((await post('/api/architect/generate', request)).status, 401);
    const guest = (await post('/api/guest', {})).body;
    request.token = guest.token;
    assert.equal((await post('/api/architect/generate', request, 'https://untrusted.invalid')).status, 403);
    assert.equal(calls, 0);
    assert.equal((await post('/api/architect/generate', request)).status, 200); assert.equal(calls, 1);
    assert.equal((await post('/api/architect/generate', request)).body.replayed, true); assert.equal(calls, 1);
    const second = { ...request, idempotencyKey: randomUUID(), daily: 999, approved: true };
    assert.equal((await post('/api/architect/generate', second)).body.code, 'ARCHITECT_APPROVAL_REQUIRED'); assert.equal(calls, 1);
    assert.equal((await post('/api/architect/generate', { ...second, password: 'incorrect-test' })).body.code, 'ARCHITECT_APPROVAL_DENIED'); assert.equal(calls, 1);
    const result = await post('/api/architect/generate', { ...second, password });
    assert.equal(result.status, 200); assert.equal(calls, 2);
    assert.equal(result.body.project.source, 'approved');
    assert.equal(sent.includes(password), false); assert.equal(sent.includes(passwordHash), false);
    assert.doesNotMatch(JSON.stringify(result.body), /mock-engineer-key|scrypt1|passwordHash|apiKey|baseURL|owner|guestId/);
    const after = await (await fetch(server.url + '/api/architect/status')).json();
    assert.equal(after.projects.length, 2); assert.equal(after.autonomousUsed, true);
  } finally { await server.close(); }
});
