import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createGameCharacterModule } from '../server/gameCharacters/index.js';
import { createGameImageModule } from '../server/gameImages/index.js';

const CONFIG = { enabled: true, totalBudget: 50, creditBudget: 1000, pollIntervalMs: 1, callTimeoutMs: 1000 };
const ASSET_A = randomUUID(), ASSET_B = randomUUID();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Restart tests need a known, unfinished remote task, not hundreds of instantly
// completed polls. Hold the mocked read until shutdown aborts it; otherwise the
// 1 ms test poll interval can exhaust the poll budget before timers observe it.
const pendingRead = ({ signal }) => new Promise((resolve, reject) => {
  const abort = () => reject(new Error('Mock read canceled during shutdown'));
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
});
const images = {
  authenticate(req) { const owner = /^owner=([ab])$/.exec(req.headers.cookie || '')?.[1]; if (!owner) throw new Error('PRIVATE'); return owner; },
  readOwnedAsset({ ownerId, assetId }) { if (!['a', 'b'].includes(ownerId) || assetId !== (ownerId === 'a' ? ASSET_A : ASSET_B)) throw new Error('PRIVATE'); return { buffer: Buffer.from('mock normalized reference'), mime: 'image/png' }; },
};

// A minimal synthetic triangle and single-bone animation, not a generated avatar.
function rigGlb(walk = false, mutate = () => {}) {
  const binary = Buffer.alloc(220);
  for (const [offset, values] of [[0, [-1, 0, 0, 1, 0, 0, 0, 2, 0]], [60, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]], [116, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]], [180, [0, 1]], [188, [0, 0, 0, 1, 0, 0.1, 0, 0.994987]]]) values.forEach((value, index) => binary.writeFloatLE(value, offset + index * 4));
  [0, 1, 2].forEach((value, index) => binary.writeUInt16LE(value, 108 + index * 2));
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }], nodes: [{ name: 'Mesh', mesh: 0, skin: 0 }, { name: 'Hip' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }, indices: 3 }] }], skins: [{ joints: [1], inverseBindMatrices: 4 }],
    buffers: [{ byteLength: binary.length }], bufferViews: [[0, 36], [36, 24], [60, 48], [108, 6], [116, 64], [180, 8], [188, 32]].map(([byteOffset, byteLength]) => ({ buffer: 0, byteOffset, byteLength })),
    accessors: [['VEC3', 5126, 3], ['VEC4', 5123, 3], ['VEC4', 5126, 3], ['SCALAR', 5123, 3], ['MAT4', 5126, 1], ['SCALAR', 5126, 2], ['VEC4', 5126, 2]].map(([type, componentType, count], bufferView) => ({ bufferView, type, componentType, count })),
    ...(walk ? { animations: [{ name: 'Animation', samplers: [{ input: 5, output: 6, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }] }] } : {}),
  };
  mutate(json);
  const source = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(source.length / 4) * 4, 32); source.copy(padded);
  const output = Buffer.alloc(28 + padded.length + binary.length);
  output.writeUInt32LE(0x46546c67); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8); output.writeUInt32LE(padded.length, 12); output.writeUInt32LE(0x4e4f534a, 16); padded.copy(output, 20);
  output.writeUInt32LE(binary.length, 20 + padded.length); output.writeUInt32LE(0x004e4942, 24 + padded.length); binary.copy(output, 28 + padded.length);
  return output;
}
const MODEL = rigGlb(), WALK = rigGlb(true);
function provider(overrides = {}) {
  const calls = { model: 0, modelGet: 0, rig: 0, rigGet: 0, download: 0 };
  return { calls,
    async createModel() { calls.model++; return { taskId: 'model-task' }; },
    async getModel() { calls.modelGet++; return { status: 'SUCCEEDED', progress: 100, consumedCredits: 15 }; },
    async createRig() { calls.rig++; return { taskId: 'rig-task' }; },
    async getRig() { calls.rigGet++; return { status: 'SUCCEEDED', progress: 100, consumedCredits: 5, modelUrl: 'https://assets.meshy.ai/model.glb', walkingUrl: 'https://assets.meshy.ai/walk.glb' }; },
    async download({ url }) { calls.download++; return url.endsWith('/walk.glb') ? WALK : MODEL; },
    ...overrides,
  };
}
async function until(fn, message = 'Expected state was not reached') {
  for (let i = 0; i < 150; i++) { const value = await fn(); if (value) return value; await pause(10); }
  assert.fail(message);
}
async function fixture(overrides = {}) {
  const dir = overrides.dir || await mkdtemp(join(tmpdir(), 'game-characters-test-'));
  const dbPath = join(dir, 'characters.sqlite');
  const module = await createGameCharacterModule({ config: CONFIG, provider: provider(), images, ...overrides, dbPath });
  const server = createServer(async (req, res) => {
    if (!await module.handle(req, res, { originAllowed: req.headers.origin === 'http://game.test' })) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { body, cookie = 'owner=a', origin = 'http://game.test', key, method, binary = false } = {}) {
    const response = await fetch(`${url}/api/game-characters${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const result = { status: response.status, headers: response.headers };
    result.body = binary && response.ok ? Buffer.from(await response.arrayBuffer()) : await response.json(); return result;
  }
  async function create({ asset = ASSET_A, key = randomUUID(), cookie = 'owner=a' } = {}) { return request('/jobs', { cookie, key, body: { referenceAssetId: asset, consent: true } }); }
  async function state(id, statuses = ['succeeded', 'failed', 'outcome_unknown'], cookie = 'owner=a') { return until(async () => { const result = await request(`/jobs/${id}`, { cookie }); return statuses.includes(result.body.job?.status) && result.body.job; }); }
  const read = (sql, ...parameters) => { const db = new DatabaseSync(dbPath); try { return db.prepare(sql).get(...parameters); } finally { db.close(); } };
  let stopped = false;
  return { module, dir, dbPath, request, create, state, read, async close(remove = true) { if (!stopped) { await module.close(); await new Promise(resolve => server.close(resolve)); stopped = true; } if (remove) await rm(dir, { recursive: true, force: true }); } };
}

test('disabled or zero budget cannot dispatch, and status never discloses configuration', async () => {
  for (const config of [{}, { ...CONFIG, totalBudget: 0 }, { ...CONFIG, creditBudget: 19 }, { reason: 'provider-unconfigured' }, { reason: 'budget-not-authorized' }, { reason: 'invalid-config' }, { reason: 'provider-secret-error' }]) {
    const mock = provider(), app = await fixture({ config, provider: mock });
    try {
      const status = await app.request('/status'); assert.equal(status.body.enabled, false); assert.equal(status.body.estimatedCredits, 20); assert.equal(status.body.provider, 'Meshy');
      assert.doesNotMatch(JSON.stringify(status.body), /apiKey|characters.sqlite|owner_id/);
      if (config.reason) assert.equal(status.body.reason, config.reason === 'provider-secret-error' ? 'disabled' : config.reason);
      assert.equal((await app.create()).status, 503); assert.equal(mock.calls.model, 0);
      assert.equal(app.read('SELECT COUNT(*) n FROM character_jobs').n, 0);
    } finally { await app.close(); }
  }
});

test('paid stages are each dispatched once after durable 20-credit reservation; output is private and selectable', async () => {
  const mock = provider(); let app;
  mock.createModel = async () => { mock.calls.model++; const row = app.read('SELECT * FROM character_jobs'); assert.equal(row.model_dispatch_count, 1); assert.equal(row.reserved_credits, 20); assert.equal(row.status, 'running'); return { taskId: 'model-task' }; };
  mock.createRig = async ({ taskId }) => { mock.calls.rig++; assert.equal(taskId, 'model-task'); const row = app.read('SELECT * FROM character_jobs'); assert.equal(row.rig_dispatch_count, 1); assert.equal(row.model_dispatch_count, 1); assert.equal(row.reserved_credits, 20); return { taskId: 'rig-task' }; };
  app = await fixture({ provider: mock });
  try {
    const key = randomUUID(), first = await app.create({ key }); assert.equal(first.status, 202); assert.notEqual(first.body.job.id, key);
    const job = await app.state(first.body.job.id); assert.equal(job.status, 'succeeded'); assert.equal(job.stage, 'ready'); assert.equal(job.progress, 100);
    assert.match(job.modelUrl, /^\/api\/game-characters\/assets\/[\w-]+\.glb$/); assert.doesNotMatch(JSON.stringify(job), /assets.meshy|model-task|rig-task|owner_id/);
    const replay = await app.create({ key }); assert.equal(replay.body.job.id, job.id);
    const conflict = await app.create({ key, asset: randomUUID() }); assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(mock.calls.model, 1); assert.equal(mock.calls.rig, 1); assert.equal(mock.calls.download, 2);
    const asset = await app.request(job.modelUrl.replace('/api/game-characters', ''), { binary: true }); assert.equal(asset.status, 200); assert.deepEqual(asset.body, MODEL); assert.match(asset.headers.get('cache-control'), /private, no-store/); assert.equal(asset.headers.get('content-type'), 'model/gltf-binary');
    const selected = await app.request('/select', { body: { jobId: job.id } }); assert.equal(selected.body.selectedCharacter.facing, 'positive-z'); assert.equal(selected.body.selectedCharacter.id, job.id);
    assert.equal((await app.request('/mine')).body.selectedCharacter.id, job.id);
    assert.equal((await app.request('/select', { body: { jobId: null } })).body.selectedCharacter, null);
  } finally { await app.close(); }
});

test('authentication, trusted Origin, ownership and strict bodies are checked before private actions', async () => {
  const app = await fixture();
  try {
    assert.equal((await app.request('/status', { cookie: '' })).status, 401);
    for (const origin of ['', 'https://evil.invalid']) assert.equal((await app.request('/jobs', { origin, key: randomUUID(), body: { referenceAssetId: ASSET_A, consent: true } })).status, 403);
    assert.equal((await app.request('/jobs', { key: randomUUID(), body: { referenceAssetId: ASSET_A, consent: true, owner: 'a' } })).status, 400);
    assert.equal((await app.create({ asset: ASSET_B })).status, 404);
    const first = await app.create(), job = await app.state(first.body.job.id);
    assert.equal((await app.request(`/jobs/${job.id}`, { cookie: 'owner=b' })).status, 404);
    assert.equal((await app.request(job.modelUrl.replace('/api/game-characters', ''), { cookie: 'owner=b' })).status, 404);
    assert.equal((await app.request('/select', { cookie: 'owner=b', body: { jobId: job.id } })).status, 404);
    assert.equal((await app.request(`/jobs/${job.id}/delete`, { cookie: 'owner=b', body: {} })).status, 404);
  } finally { await app.close(); }
});

test('unknown create outcome and retry after restart never repeat the paid model POST', async () => {
  let paid = 0; const mock = provider({ createModel: async () => { paid++; throw new Error('secret-provider-body-token'); } });
  let app = await fixture({ provider: mock }); const dir = app.dir, key = randomUUID();
  try {
    const first = await app.create({ key }), job = await app.state(first.body.job.id); assert.equal(job.status, 'outcome_unknown'); assert.equal(job.errorCode, 'CREATE_OUTCOME_UNKNOWN'); assert.doesNotMatch(JSON.stringify(job), /secret-provider/);
    await app.close(false); app = await fixture({ dir, provider: mock });
    assert.equal((await app.create({ key })).body.job.id, job.id); await pause(40); assert.equal(paid, 1); assert.equal(mock.calls.rig, 0);
  } finally { await app.close(); }
});

test('unknown rig creation is never reissued and the model is not regenerated', async () => {
  let rigPaid = 0; const mock = provider({ createRig: async () => { rigPaid++; return {}; } });
  let app = await fixture({ provider: mock }); const dir = app.dir;
  try {
    const first = await app.create(), job = await app.state(first.body.job.id); assert.equal(job.status, 'outcome_unknown'); assert.equal(job.stage, 'rig');
    await app.close(false); app = await fixture({ dir, provider: mock }); await pause(30);
    assert.equal(mock.calls.model, 1); assert.equal(rigPaid, 1); assert.equal(mock.calls.download, 0);
  } finally { await app.close(); }
});

test('shutdown aborts an uncooperative paid request promptly and persists uncertainty', async () => {
  let started = false; const mock = provider({ createModel: () => { started = true; return new Promise(() => {}); } });
  const app = await fixture({ provider: mock });
  try {
    await app.create(); await until(() => started); const start = Date.now(); await Promise.all([app.module.close(), app.module.close()]); assert.ok(Date.now() - start < 500);
    assert.equal(app.read('SELECT status FROM character_jobs').status, 'outcome_unknown');
  } finally { await app.close(); }
});

test('paid request timeout records uncertainty without retrying even when provider ignores abort', async () => {
  let calls = 0; const mock = provider({ createModel: () => { calls++; return new Promise(() => {}); } });
  const app = await fixture({ provider: mock, config: { ...CONFIG, callTimeoutMs: 15 } });
  try { const first = await app.create(), job = await app.state(first.body.job.id); assert.equal(job.status, 'outcome_unknown'); await pause(30); assert.equal(calls, 1); }
  finally { await app.close(); }
});

test('a known rig task can finish read-only while admission is disabled after restart', async () => {
  const mock = provider({ getRig: pendingRead });
  let app = await fixture({ provider: mock }); const dir = app.dir;
  try {
    const first = await app.create(); await until(() => app.read('SELECT rig_task_id FROM character_jobs')?.rig_task_id); await app.close(false);
    mock.getRig = async () => ({ status: 'SUCCEEDED', progress: 100, modelUrl: 'https://assets.meshy.ai/model.glb', walkingUrl: 'https://assets.meshy.ai/walk.glb' });
    app = await fixture({ dir, provider: mock, config: { ...CONFIG, enabled: false } });
    assert.equal((await app.state(first.body.job.id)).status, 'succeeded'); assert.equal(mock.calls.model, 1); assert.equal(mock.calls.rig, 1);
  } finally { await app.close(); }
});

test('known model task ID resumes with read-only GETs across restart without duplicate creation', async () => {
  const mock = provider({ getModel: pendingRead });
  let app = await fixture({ provider: mock }); const dir = app.dir;
  try {
    const first = await app.create(); await until(() => app.read('SELECT model_task_id FROM character_jobs')?.model_task_id);
    await app.close(false); mock.getModel = async () => ({ status: 'SUCCEEDED', progress: 100 }); app = await fixture({ dir, provider: mock });
    assert.equal((await app.state(first.body.job.id)).status, 'succeeded'); assert.equal(mock.calls.model, 1); assert.equal(mock.calls.rig, 1);
  } finally { await app.close(); }
});

test('disabled admission allows only read-only known-task recovery, never a new rig POST', async () => {
  const mock = provider({ getModel: pendingRead });
  let app = await fixture({ provider: mock }); const dir = app.dir;
  try {
    await app.create(); await until(() => app.read('SELECT model_task_id FROM character_jobs')?.model_task_id); await app.close(false);
    mock.getModel = async () => ({ status: 'SUCCEEDED', progress: 100 }); app = await fixture({ dir, provider: mock, config: { ...CONFIG, enabled: false } });
    await until(() => app.read('SELECT stage FROM character_jobs')?.stage === 'rig'); await pause(30); assert.equal(mock.calls.rig, 0); assert.equal(mock.calls.model, 1);
  } finally { await app.close(); }
});

test('read-only polling and download recovery are bounded without additional paid stages', async () => {
  const stalled = provider({ getModel: async () => { throw new Error('private transport error'); } });
  const app = await fixture({ provider: stalled, config: { ...CONFIG, maxPolls: 3 } });
  try { const first = await app.create(), job = await app.state(first.body.job.id); assert.equal(job.errorCode, 'POLL_LIMIT'); assert.equal(app.read('SELECT poll_count FROM character_jobs').poll_count, 3); assert.equal(stalled.calls.model, 1); assert.equal(stalled.calls.rig, 0); }
  finally { await app.close(); }
  let gets = 0; const downloadable = provider({ download: async () => { gets++; throw new Error('private signed URL'); } });
  const second = await fixture({ provider: downloadable, config: { ...CONFIG, maxDownloadAttempts: 2 } });
  try { const first = await second.create(), job = await second.state(first.body.job.id); assert.equal(job.errorCode, 'DOWNLOAD_UNCONFIRMED'); assert.equal(gets, 2); assert.equal(downloadable.calls.model, 1); assert.equal(downloadable.calls.rig, 1); }
  finally { await second.close(); }
});

test('missing walking output and malformed, unrigged or incompatible GLBs cannot be selected', async () => {
  const variants = [
    provider({ getRig: async () => ({ status: 'SUCCEEDED', progress: 100, modelUrl: 'https://assets.meshy.ai/model.glb' }) }),
    provider({ download: async () => Buffer.from('not GLB') }),
    provider({ download: async ({ url }) => url.endsWith('/walk.glb') ? WALK : rigGlb(false, json => { delete json.nodes[0].skin; }) }),
    provider({ download: async ({ url }) => url.endsWith('/walk.glb') ? rigGlb(true, json => { json.animations[0].channels = []; }) : MODEL }),
    provider({ download: async ({ url }) => url.endsWith('/walk.glb') ? rigGlb(true, json => { json.nodes[1].name = 'OtherBone'; }) : MODEL }),
  ];
  for (const mock of variants) {
    const app = await fixture({ provider: mock });
    try { const first = await app.create(), job = await app.state(first.body.job.id); assert.equal(job.status, 'failed'); assert.equal((await app.request('/select', { body: { jobId: job.id } })).status, 409); assert.equal(app.read('SELECT COUNT(*) n FROM character_assets').n, 0); assert.equal(mock.calls.model, 1); assert.equal(mock.calls.rig, 1); }
    finally { await app.close(); }
  }
});

test('deletion and restart preserve idempotency, dispatch history and spent budget', async () => {
  const mock = provider(); const config = { ...CONFIG, totalBudget: 1, creditBudget: 20 }; let app = await fixture({ provider: mock, config }); const dir = app.dir, key = randomUUID();
  try {
    const first = await app.create({ key }), job = await app.state(first.body.job.id); await app.request('/select', { body: { jobId: job.id } });
    assert.equal((await app.request(`/jobs/${job.id}/delete`, { body: {} })).status, 200); assert.equal((await app.request('/mine')).body.selectedCharacter, null);
    assert.equal((await app.request(job.modelUrl.replace('/api/game-characters', ''))).status, 404); assert.equal(app.read('SELECT COUNT(*) n FROM character_assets').n, 0);
    await app.close(false); app = await fixture({ dir, provider: mock, config });
    const replay = await app.create({ key }); assert.equal(replay.body.job.status, 'deleted'); assert.equal(replay.body.job.id, job.id);
    const another = await app.create(); assert.equal(another.status, 429); assert.equal(another.body.code, 'CHARACTER_CREDIT_BUDGET');
    const row = app.read('SELECT * FROM character_jobs'); assert.equal(row.reserved_credits, 20); assert.equal(row.model_dispatch_count, 1); assert.equal(row.rig_dispatch_count, 1); assert.equal(mock.calls.model, 1);
  } finally { await app.close(); }
});

test('storage reservations and queue bounds reject before charging; accepted jobs use one worker', async () => {
  const tiny = await fixture({ config: { ...CONFIG, maxStorageBytes: 39 * 1024 * 1024 } });
  try { const result = await tiny.create(); assert.equal(result.status, 429); assert.equal(result.body.code, 'CHARACTER_STORAGE_FULL'); }
  finally { await tiny.close(); }
  let active = 0, maxActive = 0;
  const mock = provider({ createModel: async () => { active++; maxActive = Math.max(active, maxActive); await pause(40); active--; return { taskId: `model-${randomUUID()}` }; } });
  const app = await fixture({ provider: mock, config: { ...CONFIG, maxQueue: 2 } });
  try {
    const first = await app.create(); assert.equal((await app.create()).status, 429); const second = await app.create({ cookie: 'owner=b', asset: ASSET_B }); assert.equal(second.status, 202);
    assert.equal((await app.request(`/jobs/${first.body.job.id}/delete`, { body: {} })).status, 409);
    await app.state(first.body.job.id); await app.state(second.body.job.id, ['succeeded'], 'owner=b'); assert.equal(maxActive, 1);
  } finally { await app.close(); }
});

test('expired assets clear the local selection while retaining paid-stage accounting', async () => {
  let clock = Date.now(); const app = await fixture({ now: () => clock, config: { ...CONFIG, assetTtlMs: 50 } });
  try {
    const first = await app.create();
    const job = await until(async () => { clock += 2; const result = await app.request(`/jobs/${first.body.job.id}`); return result.body.job?.status === 'succeeded' && result.body.job; });
    await app.request('/select', { body: { jobId: job.id } }); clock += 51;
    const status = await app.request('/status'); assert.equal(status.body.selectedCharacter, null); assert.equal(status.body.jobs[0].status, 'deleted');
    assert.equal((await app.request(job.modelUrl.replace('/api/game-characters', ''))).status, 404); assert.equal(app.read('SELECT SUM(reserved_credits) n FROM character_jobs').n, 20);
  } finally { await app.close(); }
});

test('character module reuses the durable image cookie, not the chat guest identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'game-character-cookie-'));
  const imageModule = await createGameImageModule({ config: { enabled: true, dailyBudget: 1 }, provider: { generate: async () => { throw new Error('No image generation in this test'); } }, dbPath: join(dir, 'images.sqlite') });
  const app = await fixture({ images: imageModule });
  const server = createServer(async (req, res) => { if (!await imageModule.handle(req, res, { originAllowed: req.headers.origin === 'http://game.test' })) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const url = `http://127.0.0.1:${server.address().port}/api/game-images`;
  try {
    const response = await fetch(`${url}/bootstrap`), cookie = response.headers.get('set-cookie').split(';')[0];
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#aaddff' } }).png().toBuffer();
    const uploaded = await fetch(`${url}/inputs`, { method: 'POST', headers: { cookie, origin: 'http://game.test', 'content-type': 'application/json' }, body: JSON.stringify({ consent: true, mime: 'image/png', data: png.toString('base64') }) });
    const asset = (await uploaded.json()).inputAssetId; assert.ok(asset);
    assert.equal((await app.request('/status', { cookie })).status, 200);
    assert.equal((await app.request('/status', { cookie: 'guestId=chat-user' })).status, 401);
    const created = await app.create({ asset, cookie }); assert.equal(created.status, 202); assert.equal((await app.state(created.body.job.id, ['succeeded'], cookie)).status, 'succeeded');
  } finally { await app.close(); await imageModule.close(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
