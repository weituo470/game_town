import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGameImageClient, createGameImageJobRequest, GAME_IMAGE_MAX_BYTES, GAME_IMAGE_STYLES, gameImageAssetUrl, readImageBase64, startGameImagePolling, validateImageFile } from '../src/lib/gameImageClient.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const job = (status = 'queued') => ({ id: 'job-1', status, styleId: 'storybook', createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z', ...(status === 'succeeded' ? { outputAssetId: 'asset-output' } : {}) });
const bootstrap = enabled => ({ enabled, outputKind: '2d', maxUploadBytes: GAME_IMAGE_MAX_BYTES, styles: GAME_IMAGE_STYLES, jobs: [], selectedAssetId: null });
const prepare = () => createGameImageJobRequest({ inputAssetId: 'input-a', styleId: 'storybook', consent: true }, () => '00000000-0000-4000-8000-000000000001');

test('image file validation bounds MIME, nonempty bytes and max size', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) assert.equal(validateImageFile({ type, size: GAME_IMAGE_MAX_BYTES }).type, type);
  for (const file of [{ type: 'image/svg+xml', size: 5 }, { type: 'image/png', size: 0 }, { type: 'image/jpeg', size: GAME_IMAGE_MAX_BYTES + 1 }]) assert.throws(() => validateImageFile(file), { code: 'INVALID_FILE' });
});

test('base64 read stays local, strips data URL prefix and supports cancel', async () => {
  class Reader { readAsDataURL() { this.result = 'data:image/png;base64,YWJj'; queueMicrotask(() => this.onload?.()); } abort() { this.onabort?.(); } }
  assert.equal(await readImageBase64({ type: 'image/png', size: 3 }, { Reader }), 'YWJj');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readImageBase64({ type: 'image/png', size: 3 }, { Reader, signal: controller.signal }), { name: 'AbortError' });
});

test('generated asset URLs only allow same-origin private asset paths', () => {
  assert.equal(gameImageAssetUrl('image-1'), '/api/game-images/assets/image-1');
  for (const value of ['../secret', 'https://other.example/a', 'a?token=x', '']) assert.throws(() => gameImageAssetUrl(value), { code: 'INVALID_ASSET' });
});

test('job creation freezes exact key/body and requires consent plus known style', () => {
  const prepared = prepare();
  assert.equal(Object.isFrozen(prepared), true); assert.equal(Object.isFrozen(prepared.body), true);
  assert.throws(() => { prepared.body.styleId = 'clay'; }, TypeError);
  for (const mutation of [{ consent: false }, { styleId: 'real-3d' }, { inputAssetId: '../file' }]) assert.throws(() => createGameImageJobRequest({ inputAssetId: 'a', styleId: 'clay', consent: true, ...mutation }), { code: 'INVALID_INPUT' });
});

test('bootstrap uses cookie credentials, never uploads or generates', async () => {
  const calls = [];
  const client = createGameImageClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); return json(bootstrap(false)); } });
  const result = await client.bootstrap();
  assert.equal(result.enabled, false); assert.equal(result.outputKind, '2d');
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/game-images/bootstrap');
  assert.equal(calls[0].options.credentials, 'same-origin'); assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined); assert.equal(calls[0].options.headers.Authorization, undefined);
});

test('upload sends only consented image MIME/base64 and is not job creation', async () => {
  const calls = [];
  const client = createGameImageClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); return json({ inputAssetId: 'input-a' }); } });
  await client.upload({ mime: 'image/png', data: 'YWJj', consent: true, token: 'never-sent' });
  assert.equal(calls[0].url, '/api/game-images/inputs');
  assert.deepEqual(JSON.parse(calls[0].options.body), { mime: 'image/png', data: 'YWJj', consent: true });
  await assert.rejects(client.upload({ mime: 'image/png', data: 'YWJj', consent: false }), { code: 'INVALID_INPUT' });
  assert.equal(calls.length, 1);
});

test('uncertain creation never automatically retries; explicit recovery preserves identical key and body', async () => {
  const calls = [];
  const client = createGameImageClient({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new Error('connection lost');
    return json({ job: job() }, 202);
  } });
  const prepared = prepare();
  await assert.rejects(client.createJob(prepared), error => error.ambiguous && error.code === 'NETWORK_ERROR');
  assert.equal(calls.length, 1);
  await client.createJob(prepared);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
  assert.equal(calls[0].options.body, calls[1].options.body);
});

test('create timeout is ambiguous and does not turn into a new paid request', async () => {
  let count = 0;
  const client = createGameImageClient({ timeoutMs: 5, fetchImpl: () => { count += 1; return new Promise(() => {}); } });
  await assert.rejects(client.createJob(prepare()), error => error.code === 'TIMEOUT' && error.ambiguous);
  assert.equal(count, 1);
});

test('server errors are sanitized; explicit client rejections are not ambiguous', async () => {
  const client = createGameImageClient({ fetchImpl: async () => json({ code: 'NO_CONSENT', error: 'secret token and provider stack' }, 403) });
  await assert.rejects(client.createJob(prepare()), error => error.status === 403 && !error.ambiguous && !error.message.includes('secret'));
});

test('malformed success and unsupported job state never masquerade as success', async () => {
  for (const data of [{ job: { ...job(), status: 'completed-3d' } }, { job: { ...job('succeeded'), outputAssetId: 'https://bad.invalid/' } }, {}]) {
    const client = createGameImageClient({ fetchImpl: async () => json(data) });
    await assert.rejects(client.createJob(prepare()), error => error.code === 'INVALID_RESPONSE' && error.ambiguous);
  }
});

test('mine and individual job are read-only and preserve outcome_unknown', async () => {
  const calls = [];
  const client = createGameImageClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); return url.endsWith('/mine') ? json({ jobs: [job('outcome_unknown')], selectedAssetId: null }) : json({ job: job('running') }); } });
  assert.equal((await client.mine()).jobs[0].status, 'outcome_unknown');
  assert.equal((await client.job('job-1')).job.status, 'running');
  assert.ok(calls.every(call => call.options.method === 'GET'));
});

test('avatar and delete require explicit POST actions', async () => {
  const calls = [];
  const client = createGameImageClient({ fetchImpl: async (url, options) => { calls.push({ url, options }); return url.endsWith('/avatar') ? json({ selectedAssetId: 'asset-1' }) : json({ deleted: true }); } });
  await client.avatar('asset-1'); await client.deleteJob('job-1');
  assert.deepEqual(calls.map(call => call.url), ['/api/game-images/avatar', '/api/game-images/jobs/job-1/delete']);
  assert.ok(calls.every(call => call.options.method === 'POST'));
});

test('abort cancels client wait without deleting server job or replaying POST', async () => {
  const controller = new AbortController(); let count = 0;
  const client = createGameImageClient({ fetchImpl: async () => { count += 1; queueMicrotask(() => controller.abort()); return new Promise(() => {}); } });
  await assert.rejects(client.createJob(prepare(), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(count, 1);
});

test('polling is four-second read-only refresh, pauses when hidden and aborts on disposal', async () => {
  let listener, timer, cleared = 0, calls = 0, lastSignal;
  const documentRef = { hidden: false, addEventListener: (_, handler) => { listener = handler; }, removeEventListener: () => { listener = null; } };
  const stop = startGameImagePolling({ documentRef, setTimer: (handler, ms) => { assert.equal(ms, 4000); timer = handler; return 9; }, clearTimer: () => { cleared += 1; timer = null; }, refresh: async ({ signal }) => { calls += 1; lastSignal = signal; } });
  await timer(); assert.equal(calls, 1);
  documentRef.hidden = true; listener(); assert.equal(timer, null);
  documentRef.hidden = false; listener(); await Promise.resolve(); assert.equal(calls, 2);
  stop(); assert.equal(listener, null); assert.ok(cleared > 0);
  assert.ok(lastSignal instanceof AbortSignal);
});

test('studio is an honest three-stage UI with consent, bounded files, disabled 3D steps and no storage', async () => {
  const jsx = await readFile(new URL('../src/components/CharacterStudio.jsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/components/character-studio.css', import.meta.url), 'utf8');
  assert.match(jsx, /我的 3D 角色/); assert.match(jsx, /图片完成 ≠ 3D 完成/);
  assert.match(jsx, /!characterConfig\?\.enabled/); assert.match(jsx, /disabled=\{!modelPreviewReady \|\| !previewCharacterJob/);
  assert.match(jsx, /我有权使用此照片，并同意发送给图像生成服务/);
  assert.match(jsx, /URL\.revokeObjectURL\(url\)/);
  assert.doesNotMatch(jsx, /localStorage|sessionStorage|dangerouslySetInnerHTML/);
  assert.match(jsx, /!config\?\.enabled \|\| !file \|\| !consent/);
  assert.match(css, /min-height: 44px/); assert.match(css, /prefers-reduced-motion/);
});
