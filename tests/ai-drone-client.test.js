import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiDroneClient, createAiDroneRequest, readAiDroneUsage, AI_DRONE_GUEST_KEY } from '../src/lib/aiDroneClient.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const usage = { limit: 5, used: 1, remaining: 4, resetAt: 1800000000000 };
const guest = { token: 'signed-guest-token', expiresAt: Date.now() + 1000000 };
const createRequest = (values = {}) => createAiDroneRequest({ mode: 'prompt', prompt: '星海相遇', ...values }, () => '00000000-0000-4000-8000-000000000001');
const result = () => ({ show: { id: 'show-1', createdAt: 1700000000000, mode: 'prompt', prompt: '星海相遇', provider: 'DeepSeek', model: 'deepseek-flash', score: { version: 1 } }, usage, replayed: false });
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values };
}

test('AI request bounds input and requires a stable UUID without executing content', () => {
  const input = createRequest({ prompt: '  星海相遇  ' });
  assert.equal(input.prompt, '星海相遇');
  assert.equal(Object.isFrozen(input), true);
  assert.equal(createRequest({ mode: 'improv', prompt: '' }).prompt, '');
  for (const override of [{ mode: 'code' }, { prompt: '' }, { prompt: 'x'.repeat(401) }, { prompt: '\u0000' }]) assert.throws(() => createRequest(override), { code: 'INVALID_INPUT' });
  assert.throws(() => createAiDroneRequest({ mode: 'improv' }, () => 'no-id'), { code: 'INVALID_INPUT' });
});

test('status is GET-only and does not establish a guest or fabricate enabled status', async () => {
  const calls = [];
  const client = createAiDroneClient({ storage: null, fetchImpl: async (url, options) => { calls.push({ url, options }); return json({ enabled: false }); } });
  assert.equal((await client.status()).enabled, false);
  assert.equal(await client.usage(), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/drone-director/status');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
});

test('generation persists guest before the paid call and reuses it across client recreation', async () => {
  const storage = memoryStorage();
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return json(url === '/api/guest' ? guest : result()); };
  const stages = [];
  const first = createAiDroneClient({ fetchImpl, storage });
  await first.generate(createRequest(), { onStage: value => stages.push(value) });
  await createAiDroneClient({ fetchImpl, storage }).generate(createRequest());
  assert.deepEqual(calls.map(call => call.url), ['/api/guest', '/api/drone-director/generate', '/api/drone-director/generate']);
  assert.deepEqual(stages, ['identity', 'generating', 'validating']);
  assert.deepEqual(Object.keys(calls[1].body).sort(), ['mode', 'prompt', 'requestId', 'token']);
  assert.deepEqual(JSON.parse(storage.getItem(AI_DRONE_GUEST_KEY)), guest);
});

test('session expiry is checked without proactively changing a valid identity', async () => {
  const storage = memoryStorage({ [AI_DRONE_GUEST_KEY]: JSON.stringify({ token: 'old-token', expiresAt: 123 }) });
  const calls = [];
  const client = createAiDroneClient({ storage, now: () => 124, fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return json(url === '/api/guest' ? guest : result()); } });
  await client.generate(createRequest());
  assert.equal(calls[0].url, '/api/guest');
  assert.equal(calls[0].body.token, 'old-token');
});

test('corrupt or oversized session is ignored and unavailable persistence blocks paid calls', async () => {
  for (const raw of ['{bad', 'x'.repeat(3000), '{"token":42,"expiresAt":100}']) {
    const storage = memoryStorage({ [AI_DRONE_GUEST_KEY]: raw });
    const calls = [];
    const client = createAiDroneClient({ storage, fetchImpl: async url => { calls.push(url); return json(url === '/api/guest' ? guest : result()); } });
    await client.generate(createRequest());
    assert.equal(calls[0], '/api/guest');
  }
  let calls = 0;
  const client = createAiDroneClient({ storage: null, fetchImpl: async () => { calls++; return json(guest); } });
  await assert.rejects(client.generate(createRequest()), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(calls, 0);
  const writeBlocked = createAiDroneClient({ storage: { getItem: () => null, setItem: () => { throw Error('private'); } }, fetchImpl: async () => { calls++; return json(guest); } });
  await assert.rejects(writeBlocked.generate(createRequest()), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(calls, 1);
});

test('401 invalidates session but never retries a provider request or creates another guest automatically', async () => {
  const storage = memoryStorage({ [AI_DRONE_GUEST_KEY]: JSON.stringify(guest) });
  let calls = 0;
  const client = createAiDroneClient({ storage, fetchImpl: async () => { calls++; return json({ error: 'secret upstream token' }, 401); } });
  await assert.rejects(client.generate(createRequest()), error => error.code === 'EXPIRED' && !error.message.includes('secret'));
  assert.equal(calls, 1);
  assert.equal(storage.getItem(AI_DRONE_GUEST_KEY), null);
});

test('paid failure preserves safe usage and never echoes provider errors', async () => {
  let calls = 0;
  const client = createAiDroneClient({ storage: memoryStorage({ [AI_DRONE_GUEST_KEY]: JSON.stringify(guest) }), fetchImpl: async () => { calls++; return json({ error: 'sk-private-provider-error', code: 'SECRET', usage }, 502); } });
  await assert.rejects(client.generate(createRequest()), error => error.code === 'SERVICE_ERROR' && error.usage.remaining === 4 && !error.message.includes('sk-'));
  assert.equal(calls, 1);
});

test('model format and provider failures show distinct safe messages without retries', async () => {
  for (const [serverCode, expected] of [['AI_DRONE_INVALID_SCORE', 'INVALID_SCORE'], ['AI_DRONE_UPSTREAM', 'UPSTREAM']]) {
    let calls = 0;
    const client = createAiDroneClient({ storage: memoryStorage({ [AI_DRONE_GUEST_KEY]: JSON.stringify(guest) }), fetchImpl: async () => {
      calls++; return json({ error: 'sk-private-provider-error', code: serverCode, usage }, 502);
    } });
    await assert.rejects(client.generate(createRequest()), error => error.code === expected && error.usage.remaining === 4 && error.message.includes('本次计入额度') && !error.message.includes('sk-'));
    assert.equal(calls, 1);
  }
});

test('usage validates counters and Beijing-reset timestamp with no identity creation', async () => {
  const client = createAiDroneClient({ storage: memoryStorage({ [AI_DRONE_GUEST_KEY]: JSON.stringify(guest) }), fetchImpl: async (url, options) => { assert.equal(url, '/api/drone-director/usage'); assert.deepEqual(JSON.parse(options.body), { token: guest.token }); return json({ usage }); } });
  assert.deepEqual(await client.usage(), usage);
  for (const invalid of [{ ...usage, remaining: 3 }, { ...usage, used: -1 }, { ...usage, resetAt: 'nope' }, { ...usage, limit: 0 }]) assert.equal(readAiDroneUsage(invalid), null);
});

test('base-prefixed routes stay same-origin', async () => {
  const urls = [];
  const client = createAiDroneClient({ resolveUrl: path => `/game-town${path}`, storage: memoryStorage(), fetchImpl: async url => { urls.push(url); return json(url.endsWith('/guest') ? guest : result()); } });
  await client.generate(createRequest());
  assert.deepEqual(urls, ['/game-town/api/guest', '/game-town/api/drone-director/generate']);
});

test('timeout bounds an uncooperative transport and does not retry', async () => {
  let calls = 0;
  const client = createAiDroneClient({ timeoutMs: 8, storage: memoryStorage({ [AI_DRONE_GUEST_KEY]: JSON.stringify(guest) }), fetchImpl: async () => { calls++; return new Promise(() => {}); } });
  await assert.rejects(client.generate(createRequest()), { code: 'TIMEOUT' });
  assert.equal(calls, 1);
});

test('the generation deadline includes guest identity setup rather than resetting for the provider', async () => {
  const urls = [];
  const client = createAiDroneClient({ timeoutMs: 8, statusTimeoutMs: 1000, storage: memoryStorage(), fetchImpl: async url => { urls.push(url); return new Promise(() => {}); } });
  await assert.rejects(client.generate(createRequest()), { code: 'TIMEOUT' });
  assert.deepEqual(urls, ['/api/guest']);
});

test('external abort interrupts body reads and abort-before-start sends nothing', async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = createAiDroneClient({ storage: memoryStorage({ [AI_DRONE_GUEST_KEY]: JSON.stringify(guest) }), fetchImpl: async () => {
    calls++;
    setTimeout(() => controller.abort(), 2);
    return new Response(new ReadableStream({ start() {} }));
  } });
  await assert.rejects(client.generate(createRequest(), { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(client.generate(createRequest(), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('invalid and oversized responses cannot become show metadata', async () => {
  for (const response of [new Response('<html>error</html>'), json({ ...result(), usage: null }), json({ ...result(), show: { ...result().show, mode: 'wrong' } }), new Response('x'.repeat(262145))]) {
    const client = createAiDroneClient({ storage: memoryStorage({ [AI_DRONE_GUEST_KEY]: JSON.stringify(guest) }), fetchImpl: async () => response });
    await assert.rejects(client.generate(createRequest()), { code: 'INVALID_RESPONSE' });
  }
});

test('client guards duplicate concurrent generation', async () => {
  const controller = new AbortController();
  const client = createAiDroneClient({ storage: memoryStorage({ [AI_DRONE_GUEST_KEY]: JSON.stringify(guest) }), fetchImpl: async () => new Promise(() => {}) });
  const first = client.generate(createRequest(), { signal: controller.signal });
  await assert.rejects(client.generate(createRequest()), { code: 'IN_FLIGHT' });
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
});
