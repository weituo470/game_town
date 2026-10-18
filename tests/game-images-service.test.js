import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createGameImageModule, GAME_IMAGE_COOKIE } from '../server/gameImages/index.js';
import { normalizeImage } from '../server/gameImages/media.js';
import { buildGameImagePrompt } from '../server/gameImages/prompts.js';
import { createGameImageBridgeProvider } from '../server/gameImages/provider.js';

const CONFIG = { enabled: true, dailyBudget: 50, ownerDailyBudget: 2, providerTimeoutMs: 1000, maintenanceIntervalMs: 10, lookupIntervalMs: 1000 };
const picture = async (color = '#aaddff', size = 64) => sharp({ create: { width: size, height: size, channels: 3, background: color } }).png().toBuffer();
let inputBytes, outputBytes;
test.before(async () => { inputBytes = await picture(); outputBytes = await picture('#ffbb99', 1024); });
const good = async () => ({ mime: 'image/png', buffer: outputBytes, requestedModel: 'gpt-image-2.5-flare', returnedModel: 'unreported' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(overrides = {}) {
  const dir = overrides.dir || await mkdtemp(join(tmpdir(), 'game-images-test-'));
  const dbPath = join(dir, 'private.sqlite');
  const module = await createGameImageModule({ config: CONFIG, provider: { generate: good }, ...overrides, dbPath });
  const server = createServer(async (req, res) => { if (!await module.handle(req, res, { originAllowed: req.headers.origin === 'http://game.test' })) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { body, cookie, origin = 'http://game.test', key, method, binary = false } = {}) {
    const response = await fetch(`${url}/api/game-images${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, body: binary ? Buffer.from(await response.arrayBuffer()) : await response.json() };
  }
  async function session() { const result = await request('/bootstrap'); return { ...result, cookie: result.headers.get('set-cookie')?.split(';')[0] }; }
  async function upload(cookie, bytes = inputBytes) { return request('/inputs', { cookie, body: { mime: 'image/png', data: bytes.toString('base64'), consent: true } }); }
  async function create(cookie, inputAssetId, options = {}) { return request('/jobs', { cookie, key: options.key || randomUUID(), body: { inputAssetId, styleId: options.styleId || 'storybook', consent: true } }); }
  async function state(cookie, id, statuses = ['succeeded', 'failed', 'outcome_unknown']) {
    for (let i = 0; i < 100; i += 1) { const result = await request(`/jobs/${id}`, { cookie }); if (statuses.includes(result.body.job?.status)) return result.body.job; await pause(10); }
    assert.fail('Task did not reach an expected state');
  }
  return { module, dir, dbPath, request, session, upload, create, state, async close(remove = true) { await module.close(); await new Promise(resolve => server.close(resolve)); if (remove) await rm(dir, { recursive: true, force: true }); } };
}

test('disabled bootstrap is safe and does not accept photos or make provider calls', async () => {
  const app = await fixture({ config: {}, provider: { generate: () => assert.fail('No generation while disabled') } });
  try {
    const session = await app.session();
    assert.equal(session.body.enabled, false); assert.equal(session.body.outputKind, '2d');
    assert.equal(session.body.maxUploadBytes, 5 * 1024 * 1024);
    assert.match(session.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.match(session.headers.get('set-cookie'), /Path=\/api;/);
    assert.doesNotMatch(JSON.stringify(session.body), /private\.sqlite|token_hash|apiKey|bridgeToken|owner_id/);
    assert.equal((await app.upload(session.cookie)).status, 503);
    const db = new DatabaseSync(app.dbPath); assert.equal(db.prepare('SELECT COUNT(*) n FROM assets').get().n, 0); db.close();
  } finally { await app.close(); }
});

test('trusted Origin, independent cookie auth and owner-scoped private assets are enforced', async () => {
  const app = await fixture();
  try {
    assert.equal((await app.request('/mine')).status, 401);
    const a = await app.session(), b = await app.session();
    const body = { mime: 'image/png', data: inputBytes.toString('base64'), consent: true };
    assert.equal((await app.request('/inputs', { cookie: a.cookie, body, origin: '' })).status, 403);
    assert.equal((await app.request('/inputs', { cookie: a.cookie, body, origin: 'https://evil.invalid' })).status, 403);
    const asset = (await app.upload(a.cookie)).body.inputAssetId;
    assert.equal((await app.request(`/assets/${asset}`, { cookie: b.cookie })).status, 404);
    const valid = await app.request(`/assets/${asset}`, { cookie: a.cookie, binary: true });
    assert.equal(valid.status, 200); assert.equal(valid.headers.get('content-type'), 'image/png'); assert.match(valid.headers.get('cache-control'), /no-store/);
    const db = new DatabaseSync(app.dbPath); const token = a.cookie.slice(GAME_IMAGE_COOKIE.length + 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash=?').get(token).n, 0); db.close();
  } finally { await app.close(); }
});

test('real decoding strips metadata, rejects spoofed/truncated/oversized/animated formats and checks non-identical output pixels', async () => {
  const jpeg = await sharp(inputBytes).withExif({ IFD0: { Artist: 'private-test-metadata' } }).jpeg().toBuffer();
  const cleaned = await normalizeImage({ mime: 'image/jpeg', buffer: jpeg });
  const metadata = await sharp(cleaned.buffer).metadata();
  assert.equal(metadata.format, 'png'); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
  for (const bad of [{ mime: 'image/png', buffer: jpeg }, { mime: 'image/svg+xml', buffer: Buffer.from('<svg/>') }, { mime: 'image/png', buffer: inputBytes.subarray(0, 20) }, { mime: 'image/png', data: 'Zm9v%%==' }]) await assert.rejects(normalizeImage(bad));
  const huge = await picture('#ffffff', 4096); await assert.rejects(normalizeImage({ mime: 'image/png', buffer: huge }));
  const animationControl = Buffer.alloc(20); animationControl.writeUInt32BE(8); animationControl.write('acTL', 4); animationControl.writeUInt32BE(2, 8);
  const animated = Buffer.concat([inputBytes.subarray(0, 33), animationControl, inputBytes.subarray(33)]);
  await assert.rejects(normalizeImage({ mime: 'image/png', buffer: animated }), /ANIMATED_IMAGE_UNSUPPORTED/);
  const original = await normalizeImage({ mime: 'image/png', buffer: outputBytes });
  await assert.rejects(normalizeImage({ mime: 'image/png', buffer: outputBytes }, { output: true, inputHash: original.sha256, inputPixelHash: original.pixelHash }), /OUTPUT_UNCHANGED/);
  await assert.rejects(normalizeImage({ mime: 'image/png', buffer: inputBytes }, { output: true }), /OUTPUT_DIMENSIONS/);
});

test('same client key creates one task, changed body conflicts, server ID is distinct, dispatch is durable first', async () => {
  let calls = 0, seen;
  const app = await fixture({ provider: { generate: async payload => {
    calls += 1; seen = payload;
    const db = new DatabaseSync(app.dbPath); const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(payload.requestId); db.close();
    assert.equal(row.dispatch_count, 1); assert.equal(row.status, 'running');
    return good();
  } } });
  try {
    const user = await app.session(), asset = (await app.upload(user.cookie)).body.inputAssetId, key = randomUUID();
    const first = await app.create(user.cookie, asset, { key });
    assert.equal(first.status, 202); assert.notEqual(first.body.job.id, key);
    const retry = await app.create(user.cookie, asset, { key }); assert.equal(retry.body.job.id, first.body.job.id);
    assert.equal((await app.create(user.cookie, asset, { key, styleId: 'clay' })).status, 409);
    const job = await app.state(user.cookie, first.body.job.id);
    assert.equal(job.status, 'succeeded'); assert.equal(calls, 1); assert.equal(job.returnedModel, 'unreported');
    assert.match(seen.prompt, /A-pose/); assert.match(seen.prompt, /完整全身人物/); assert.match(seen.prompt, /不执行/);
    assert.equal((await app.request(`/assets/${job.outputAssetId}`, { cookie: user.cookie, binary: true })).status, 200);
  } finally { await app.close(); }
});

test('queued requests run through only one worker and disconnection does not cancel an accepted job', async () => {
  let active = 0, max = 0;
  const app = await fixture({ provider: { generate: async () => { active += 1; max = Math.max(max, active); await pause(30); active -= 1; return good(); } } });
  try {
    const a = await app.session(), b = await app.session();
    const inputA = (await app.upload(a.cookie)).body.inputAssetId, inputB = (await app.upload(b.cookie)).body.inputAssetId;
    const [ja, jb] = await Promise.all([app.create(a.cookie, inputA), app.create(b.cookie, inputB)]);
    assert.equal(ja.status, 202); assert.equal(jb.status, 202);
    await Promise.all([app.state(a.cookie, ja.body.job.id), app.state(b.cookie, jb.body.job.id)]);
    assert.equal(max, 1);
  } finally { await app.close(); }
});

test('timeout is outcome_unknown, recovery is lookup-only, and missing cached results never regenerate', async () => {
  let calls = 0, lookups = 0, clock = 1000;
  const app = await fixture({ now: () => clock, config: { ...CONFIG, providerTimeoutMs: 10, lookupIntervalMs: 1, maxLookups: 2 }, provider: { generate: async () => { calls += 1; throw new Error('RAW_SECRET_PROVIDER_ERROR'); }, lookup: async () => { lookups += 1; return { status: 'not_found' }; } } });
  try {
    const user = await app.session(), asset = (await app.upload(user.cookie)).body.inputAssetId, job = (await app.create(user.cookie, asset)).body.job;
    assert.equal((await app.state(user.cookie, job.id)).status, 'outcome_unknown');
    for (let i = 0; i < 4; i += 1) { clock += 2; await pause(25); }
    const result = (await app.request(`/jobs/${job.id}`, { cookie: user.cookie })).body;
    assert.equal(calls, 1); assert.equal(lookups, 2); assert.equal(result.job.status, 'outcome_unknown');
    assert.doesNotMatch(JSON.stringify(result), /RAW_SECRET|prompt|buffer/);
  } finally { await app.close(); }
});

test('a restarted in-flight job keeps its session and paid ledger and recovers only via lookup', async () => {
  let calls = 0;
  const app = await fixture({ provider: { generate: async () => { calls += 1; return new Promise(() => {}); } } });
  const user = await app.session(), asset = (await app.upload(user.cookie)).body.inputAssetId, key = randomUUID();
  const job = (await app.create(user.cookie, asset, { key })).body.job;
  await app.state(user.cookie, job.id, ['running']);
  await app.close(false);
  let time = Date.now() + 5000, lookups = 0;
  const reopened = await fixture({ dir: app.dir, now: () => time, provider: { generate: () => assert.fail('Restart must not redispatch'), lookup: async () => { lookups += 1; return { status: 'succeeded', result: await good() }; } } });
  try {
    const recovered = await reopened.state(user.cookie, job.id, ['succeeded']);
    assert.equal(recovered.status, 'succeeded'); assert.equal(calls, 1); assert.equal(lookups, 1);
    assert.equal((await reopened.create(user.cookie, asset, { key })).body.job.id, job.id);
    const db = new DatabaseSync(reopened.dbPath); assert.equal(db.prepare('SELECT dispatch_count FROM jobs WHERE id=?').get(job.id).dispatch_count, 1); db.close();
  } finally { await reopened.close(); }
});

test('daily and cumulative budgets survive deletion and restart; deleting an asset retains idempotency and dispatch audit', async () => {
  const app = await fixture({ config: { ...CONFIG, totalBudget: 1 } });
  const user = await app.session(), asset = (await app.upload(user.cookie)).body.inputAssetId, key = randomUUID();
  const job = (await app.create(user.cookie, asset, { key })).body.job;
  const ready = await app.state(user.cookie, job.id);
  assert.equal((await app.request('/avatar', { cookie: user.cookie, body: { assetId: ready.outputAssetId } })).status, 200);
  assert.equal((await app.request(`/jobs/${job.id}/delete`, { cookie: user.cookie, body: {} })).status, 200);
  assert.equal((await app.request('/mine', { cookie: user.cookie })).body.selectedAssetId, null);
  assert.equal((await app.request(`/assets/${ready.outputAssetId}`, { cookie: user.cookie })).status, 404);
  assert.equal((await app.create(user.cookie, asset, { key })).body.job.status, 'deleted');
  await app.close(false);
  const reopened = await fixture({ dir: app.dir, config: { ...CONFIG, totalBudget: 1 } });
  try {
    const input2 = (await reopened.upload(user.cookie)).body.inputAssetId;
    assert.equal((await reopened.create(user.cookie, input2)).body.code, 'TOTAL_IMAGE_BUDGET');
    const db = new DatabaseSync(reopened.dbPath); assert.equal(db.prepare('SELECT dispatch_count FROM jobs WHERE id=?').get(job.id).dispatch_count, 1); db.close();
  } finally { await reopened.close(); }
});

test('same database cannot be consumed by two worker instances', async () => {
  const app = await fixture();
  try { await assert.rejects(createGameImageModule({ dbPath: app.dbPath }), /already in use/); }
  finally { await app.close(); }
});

test('image adapter cannot point at the legacy broker or arbitrary external endpoints', () => {
  const token = 'fake-independent-token-which-is-not-a-real-secret';
  for (const url of ['http://127.0.0.1:8323/v1/images/edits', 'https://external.invalid/v1/images/edits', 'http://localhost:8794/v1/images/edits', 'http://127.0.0.1:8794/other']) assert.throws(() => createGameImageBridgeProvider({ url, token }));
  assert.ok(createGameImageBridgeProvider({ url: 'http://127.0.0.1:8794/v1/images/edits', token }));
  assert.match(buildGameImagePrompt({ styleId: 'adventure', sceneSeed: 'test' }), /背景必须是干净的单色浅灰/);
});
