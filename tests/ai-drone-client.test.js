import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiDroneClient, createAiDroneRequest, readAiDroneUsage, validateAiDroneAccessPassword, AI_DRONE_GUEST_KEY, AI_DRONE_MAX_ACCESS_PASSWORD } from '../src/lib/aiDroneClient.js';
import { randomUUID } from 'node:crypto';

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
    await assert.rejects(client.generate(createRequest()), error => error.code === expected && error.usage.remaining === 4 && error.message.includes('不会自动重试') && !/sk-|计入|扣次|额度/.test(error.message));
    assert.equal(calls, 1);
  }
});

test('usage validates counters and Beijing-reset timestamp with no identity creation', async () => {
  const client = createAiDroneClient({ storage: memoryStorage({ [AI_DRONE_GUEST_KEY]: JSON.stringify(guest) }), fetchImpl: async (url, options) => { assert.equal(url, '/api/drone-director/usage'); assert.deepEqual(JSON.parse(options.body), { token: guest.token }); return json({ usage }); } });
  assert.deepEqual(await client.usage(), usage);
  for (const invalid of [{ ...usage, remaining: 3 }, { ...usage, used: -1 }, { ...usage, resetAt: 'nope' }, { ...usage, limit: 0 }]) assert.equal(readAiDroneUsage(invalid), null);
});

test('unlimited usage requires explicit true with null bounds and retains real usage counts', () => {
  const unlimited = { unlimited: true, limit: null, used: 182, remaining: null, resetAt: usage.resetAt };
  assert.deepEqual(readAiDroneUsage(unlimited), unlimited);
  assert.deepEqual(readAiDroneUsage({ ...unlimited, used: 0 }), { ...unlimited, used: 0 });
  assert.deepEqual(readAiDroneUsage({ ...usage, used: 182, remaining: 0 }), { ...usage, used: 182, remaining: 0 });
  for (const invalid of [
    { ...unlimited, unlimited: false }, { ...unlimited, unlimited: 'true' },
    { ...unlimited, unlimited: undefined }, { ...unlimited, limit: 0 },
    { ...unlimited, remaining: 0 }, { ...unlimited, used: -1 },
    { ...unlimited, used: Number.MAX_SAFE_INTEGER + 1 }, { ...unlimited, resetAt: null },
    { ...usage, used: 182, remaining: -177 },
  ]) assert.equal(readAiDroneUsage(invalid), null);
});

test('status announces unlimited before guest creation while legacy status remains limited', async () => {
  const calls = [];
  const unlimited = createAiDroneClient({ storage: null, fetchImpl: async url => { calls.push(url); return json({ enabled: true, unlimited: true, limit: null, limits: { daily: 0, ipDaily: 0 } }); } });
  assert.equal((await unlimited.status()).unlimited, true);
  assert.deepEqual(calls, ['/api/drone-director/status']);
  const legacy = createAiDroneClient({ storage: null, fetchImpl: async () => json({ enabled: true, limit: 5 }) });
  assert.equal((await legacy.status()).unlimited, false);
  assert.equal((await legacy.status()).limit, 5);
  for (const malformed of [{ enabled: true, unlimited: 'true', limit: null }, { enabled: true, unlimited: true, limit: 5 }]) {
    const client = createAiDroneClient({ storage: null, fetchImpl: async () => json(malformed) });
    await assert.rejects(client.status(), { code: 'INVALID_RESPONSE' });
  }
});

test('access status exposes only public flags and accepts fail-closed development state', async () => {
  const calls = [];
  const client = createAiDroneClient({ storage: null, fetchImpl: async url => {
    calls.push(url);
    return json({ enabled: false, accessRequired: true, development: true, unlimited: true, limit: null, privateHash: 'not-returned' });
  } });
  const status = await client.status();
  assert.equal(status.accessRequired, true);
  assert.equal(status.development, true);
  assert.equal(status.enabled, false);
  assert.equal(status.privateHash, undefined);
  assert.deepEqual(calls, ['/api/drone-director/status']);
  for (const invalid of [{ enabled: true, accessRequired: 'true' }, { enabled: true, development: 'true' }]) {
    await assert.rejects(createAiDroneClient({ storage: null, fetchImpl: async () => json(invalid) }).status(), { code: 'INVALID_RESPONSE' });
  }
});

test('password input is exact, bounded and never added to the reusable show request', () => {
  const password = ` ${randomUUID()} `;
  assert.equal(validateAiDroneAccessPassword(password, true), password);
  assert.equal(validateAiDroneAccessPassword(undefined, false), undefined);
  assert.equal(validateAiDroneAccessPassword('', false), undefined);
  for (const missing of [undefined, '']) assert.throws(() => validateAiDroneAccessPassword(missing, true), { code: 'ACCESS_REQUIRED' });
  for (const invalid of [null, 42, 'x'.repeat(AI_DRONE_MAX_ACCESS_PASSWORD + 1)]) assert.throws(() => validateAiDroneAccessPassword(invalid, true), { code: 'ACCESS_DENIED' });
  const request = createRequest({ accessPassword: password });
  assert.deepEqual(Object.keys(request).sort(), ['mode', 'prompt', 'requestId']);
  assert.equal(JSON.stringify(request).includes(password), false);
});

test('required password blocks locally before guest setup or generation without extra fetches', async () => {
  const calls = [];
  const client = createAiDroneClient({ storage: memoryStorage(), fetchImpl: async url => {
    calls.push(url); return json({ enabled: true, accessRequired: true, development: true });
  } });
  await client.status();
  await assert.rejects(client.generate(createRequest()), { code: 'ACCESS_REQUIRED' });
  await assert.rejects(client.generate(createRequest(), { accessPassword: '' }), { code: 'ACCESS_REQUIRED' });
  assert.deepEqual(calls, ['/api/drone-director/status']);
});

test('password is sent only as a separate generation field and never persisted or returned with the show', async () => {
  const password = randomUUID();
  const calls = [];
  const storage = memoryStorage();
  const client = createAiDroneClient({ storage, fetchImpl: async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body });
    if (url.endsWith('/status')) return json({ enabled: true, accessRequired: true, development: true });
    if (url === '/api/guest') return json(guest);
    return json({ ...result(), show: { ...result().show, accessPassword: password } });
  } });
  await client.status();
  const response = await client.generate(createRequest(), { accessPassword: password });
  assert.equal(calls[1].url, '/api/guest');
  assert.equal(calls[1].body.accessPassword, undefined);
  assert.equal(calls[2].body.accessPassword, password);
  assert.equal(calls[2].body.prompt, createRequest().prompt);
  assert.deepEqual(Object.keys(calls[2].body).sort(), ['accessPassword', 'mode', 'prompt', 'requestId', 'token']);
  assert.equal(JSON.stringify([...storage.values]).includes(password), false);
  assert.equal(JSON.stringify(response).includes(password), false);
  await assert.rejects(client.generate(createRequest()), { code: 'ACCESS_REQUIRED' });
  assert.equal(calls.length, 3, 'password must not be retained by the client for a later request');
});

test('wrong password, attempt rate limit and verification busy are safe non-retrying errors', async () => {
  const password = randomUUID();
  for (const [status, serverCode, expected] of [[403, 'AI_DRONE_ACCESS_DENIED', 'ACCESS_DENIED'], [429, 'AI_DRONE_ACCESS_RATE_LIMIT', 'ACCESS_RATE_LIMIT'], [503, 'AI_DRONE_ACCESS_BUSY', 'ACCESS_BUSY']]) {
    let calls = 0;
    const storage = memoryStorage({ [AI_DRONE_GUEST_KEY]: JSON.stringify(guest) });
    const client = createAiDroneClient({ storage, fetchImpl: async () => { calls++; return json({ code: serverCode, error: password }, status); } });
    await assert.rejects(client.generate(createRequest(), { accessPassword: password }), error => {
      assert.equal(error.code, expected);
      assert.match(error.message, /本次未调用 AI/);
      assert.match(error.message, /不会自动重试/);
      assert.equal(error.message.includes(password), false);
      return true;
    });
    assert.equal(calls, 1);
    assert.equal(JSON.stringify([...storage.values]).includes(password), false);
  }
});

test('unlimited generation and error responses preserve usage without fictional remaining counts', async () => {
  const unlimited = { unlimited: true, limit: null, used: 37, remaining: null, resetAt: usage.resetAt };
  const storage = memoryStorage({ [AI_DRONE_GUEST_KEY]: JSON.stringify(guest) });
  let calls = 0;
  const client = createAiDroneClient({ storage, fetchImpl: async () => { calls++; return json({ ...result(), usage: unlimited }); } });
  assert.deepEqual((await client.generate(createRequest())).usage, unlimited);
  assert.equal(calls, 1);
  for (const [serverCode, expected] of [['AI_DRONE_IP_RATE_LIMIT', 'LIMITED'], ['AI_DRONE_IN_FLIGHT', 'IN_FLIGHT'], ['AI_DRONE_DAILY_LIMIT', 'DAILY_LIMIT']]) {
    const failed = createAiDroneClient({ storage, fetchImpl: async () => json({ code: serverCode, usage: unlimited }, 429) });
    await assert.rejects(failed.generate(createRequest()), error => {
      assert.equal(error.code, expected);
      assert.deepEqual(error.usage, unlimited);
      if (expected === 'LIMITED') { assert.match(error.message, /请求过于频繁/); assert.doesNotMatch(error.message, /今日|每日|用完|扣次/); }
      return true;
    });
  }
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
