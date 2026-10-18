import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMeshyProvider, validateMeshyAssetUrl } from '../server/gameCharacters/meshyProvider.js';
import { loadGameCharacterConfig } from '../server/gameCharacters/config.js';

const KEY = 'fixture-api-key-not-a-real-credential';
const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MODEL = `https://assets.meshy.ai/fixture/tasks/${ID}/output/model.glb?Expires=123`;
const WALK = `https://assets.meshy.ai/fixture/tasks/${ID}/output/walk.glb?Expires=123`;
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('Meshy uses pinned model, server-controlled A-pose/texturing and only the exact API endpoint', async () => {
  let observed;
  const provider = createMeshyProvider({ apiKey: KEY, fetchImpl: async (url, options) => { observed = { url, options }; return json({ result: ID }); } });
  assert.deepEqual(await provider.createModel({ image: { mime: 'image/png', buffer: Buffer.from('fixture') } }), { taskId: ID });
  assert.equal(observed.url, 'https://api.meshy.ai/openapi/v1/image-to-3d');
  assert.equal(observed.options.redirect, 'error');
  const body = JSON.parse(observed.options.body);
  assert.equal(body.ai_model, 'meshy-t2.5');
  assert.equal(body.model_type, 'smart-topology');
  assert.equal(body.pose_mode, 'a-pose');
  assert.equal(body.target_polycount, 8000);
  assert.equal(body.should_texture, true);
  assert.equal(body.moderation, true);
  assert.deepEqual(body.target_formats, ['glb']);
  assert.ok(body.image_url.startsWith('data:image/png;base64,'));
  await provider.createRig({ taskId: ID });
  assert.equal(observed.url, 'https://api.meshy.ai/openapi/v1/rigging');
  assert.deepEqual(JSON.parse(observed.options.body), { input_task_id: ID, height_meters: 2.1 });
});

test('Meshy accepts valid task progress and requires both rig and walking GLB URLs', async () => {
  let result = { id: ID, status: 'IN_PROGRESS', progress: 42, consumed_credits: 15 };
  const provider = createMeshyProvider({ apiKey: KEY, fetchImpl: async () => json(result) });
  assert.deepEqual(await provider.getModel({ taskId: ID }), { status: 'IN_PROGRESS', progress: 42, consumedCredits: 15 });
  result = { id: ID, status: 'SUCCEEDED', progress: 100, result: { rigged_character_glb_url: MODEL, basic_animations: { walking_glb_url: WALK } } };
  assert.equal((await provider.getRig({ taskId: ID })).walkingUrl, WALK);
  delete result.result.basic_animations;
  await assert.rejects(provider.getRig({ taskId: ID }), { code: 'invalid_response' });
  result = { id: 'someone-else', status: 'SUCCEEDED', progress: 100 };
  await assert.rejects(provider.getModel({ taskId: ID }), { code: 'invalid_response' });
});

test('model downloads never forward API credentials and reject arbitrary destinations', async () => {
  let calls = 0;
  const provider = createMeshyProvider({ apiKey: KEY, fetchImpl: async (url, options) => { calls++; assert.equal(url, MODEL); assert.equal(options.headers.Authorization, undefined); assert.equal(options.redirect, 'error'); return new Response('glb-test', { headers: { 'content-type': 'model/gltf-binary' } }); } });
  assert.equal((await provider.download({ url: MODEL })).toString(), 'glb-test');
  for (const url of ['http://assets.meshy.ai/a.glb', 'https://assets.meshy.ai.evil.test/a.glb', 'https://127.0.0.1/a.glb', 'https://assets.meshy.ai:444/a.glb', 'https://user@assets.meshy.ai/a.glb', 'https://assets.meshy.ai/a.png', `${MODEL}#x`]) assert.throws(() => validateMeshyAssetUrl(url));
  assert.equal(calls, 1);
});

test('paid create has no retry, rejects invalid id and sanitizes upstream errors', async () => {
  let calls = 0;
  const provider = createMeshyProvider({ apiKey: KEY, fetchImpl: async () => { calls++; return new Response('provider secret and raw input', { status: 504 }); } });
  await assert.rejects(provider.createRig({ taskId: ID }), error => error.code === 'outcome_unknown' && !error.message.includes('secret'));
  assert.equal(calls, 1);
  await assert.rejects(provider.createRig({ taskId: '../private' }));
  assert.equal(calls, 1);
});

test('bounded transfer rejects lying content type, huge length and stalled body', async () => {
  for (const response of [new Response('{}', { headers: { 'content-type': 'text/html' } }), new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '999999999' } })]) {
    const provider = createMeshyProvider({ apiKey: KEY, fetchImpl: async () => response });
    await assert.rejects(provider.getModel({ taskId: ID }), { code: 'invalid_response' });
  }
  const provider = createMeshyProvider({ apiKey: KEY, timeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(provider.getModel({ taskId: ID }), { code: 'outcome_unknown' });
});

test('config stays closed without separate explicit budget; exact selected credential is server-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'game-meshy-config-'));
  try {
    const configPath = join(root, 'config.json');
    const envPath = join(root, 'private.env');
    assert.equal(loadGameCharacterConfig({ env: {}, configPath }).enabled, false);
    await writeFile(envPath, `UNRELATED_KEY=do-not-read\nMESHY_API_KEY=${KEY}\n`);
    await writeFile(configPath, JSON.stringify({ enabled: true, credentialEnvFile: envPath, totalBudget: 1, creditBudget: 0 }));
    assert.equal(loadGameCharacterConfig({ env: {}, configPath }).reason, 'budget-not-authorized');
    await writeFile(configPath, JSON.stringify({ enabled: true, credentialEnvFile: envPath, totalBudget: 1, creditBudget: 20 }));
    const config = loadGameCharacterConfig({ env: {}, configPath });
    assert.equal(config.enabled, true);
    assert.equal(config.apiKey, KEY);
    assert.equal(config.estimatedCreditsPerCharacter, 20);
    await writeFile(envPath, `MESHY_API_KEY=${KEY}\nMESHY_API_KEY=duplicate\n`);
    assert.equal(loadGameCharacterConfig({ env: {}, configPath }).enabled, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
