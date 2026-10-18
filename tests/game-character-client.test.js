import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGameCharacterClient, createGameCharacterJobRequest, isPrivateCharacterUrl } from '../src/lib/gameCharacterClient.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const url = '/api/game-characters/assets/11111111-1111-4111-8111-111111111111.glb';
const walk = '/api/game-characters/assets/22222222-2222-4222-8222-222222222222.glb';
const ready = { id: 'job-1', referenceAssetId: 'reference-1', status: 'succeeded', stage: 'ready', progress: 100, modelUrl: url, walkingUrl: walk };
const selected = { id: 'job-1', modelUrl: url, walkingUrl: walk, facing: 'positive-z' };
const prepared = () => createGameCharacterJobRequest({ referenceAssetId: 'reference-1', consent: true }, () => '00000000-0000-4000-8000-000000000001');

test('3D requires distinct explicit Meshy consent and freezes original submission', () => {
  assert.throws(() => createGameCharacterJobRequest({ referenceAssetId: 'reference-1', consent: false }), { code: 'INVALID_INPUT' });
  const request = prepared(); assert.equal(Object.isFrozen(request), true); assert.equal(Object.isFrozen(request.body), true);
  assert.deepEqual(request.body, { referenceAssetId: 'reference-1', consent: true });
});

test('3D assets only accept private local UUID GLB URLs', () => {
  assert.equal(isPrivateCharacterUrl(url), true);
  for (const value of ['https://meshy.ai/model.glb', `${url}?token=secret`, '/api/game-images/assets/abc', '/api/game-characters/assets/../x.glb', 'data:model/gltf-binary;base64,a']) assert.equal(isPrivateCharacterUrl(value), false);
});

test('status and mine only read with shared cookie identity, without bootstrapping or submitting', async () => {
  const calls = [];
  const client = createGameCharacterClient({ fetchImpl: async (path, options) => { calls.push({ path, options }); return json({ enabled: false, reason: 'budget', provider: 'Meshy', estimatedCredits: 20, jobs: [], selectedCharacter: null }); } });
  assert.equal((await client.status()).enabled, false); assert.equal((await client.mine()).selectedCharacter, null);
  assert.deepEqual(calls.map(call => call.path), ['/api/game-characters/status', '/api/game-characters/mine']);
  assert.ok(calls.every(call => call.options.method === 'GET' && call.options.credentials === 'same-origin' && !call.options.body));
});

test('status rejects unknown provider or fee estimate instead of enabling generation', async () => {
  const client = createGameCharacterClient({ fetchImpl: async () => json({ enabled: true, provider: 'other', estimatedCredits: 20, jobs: [] }) });
  await assert.rejects(client.status(), { code: 'INVALID_RESPONSE' });
});

test('create transmits reference ID not image bytes or provider credentials', async () => {
  let options;
  const client = createGameCharacterClient({ fetchImpl: async (_, init) => { options = init; return json({ job: { ...ready, status: 'queued', stage: 'model' } }, 202); } });
  await client.createJob(prepared());
  assert.deepEqual(JSON.parse(options.body), { referenceAssetId: 'reference-1', consent: true });
  assert.equal(options.headers.Authorization, undefined); assert.equal(options.method, 'POST');
});

test('unknown POST never auto retries and original-key recovery preserves exact body', async () => {
  const calls = [];
  const client = createGameCharacterClient({ fetchImpl: async (_, options) => { calls.push(options); if (calls.length === 1) throw new Error('offline'); return json({ job: ready }); } });
  const request = prepared();
  await assert.rejects(client.createJob(request), error => error.ambiguous && error.code === 'NETWORK_ERROR');
  assert.equal(calls.length, 1); await client.createJob(request);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']); assert.equal(calls[0].body, calls[1].body);
});

test('3D creation timeout is ambiguous, no automatic paid attempt', async () => {
  let count = 0;
  const client = createGameCharacterClient({ timeoutMs: 5, fetchImpl: () => { count += 1; return new Promise(() => {}); } });
  await assert.rejects(client.createJob(prepared()), error => error.code === 'TIMEOUT' && error.ambiguous);
  assert.equal(count, 1);
});

test('success requires both true model and walking GLBs plus ready stage', async () => {
  for (const mutation of [{ walkingUrl: undefined }, { modelUrl: '/api/game-images/assets/image-1' }, { stage: 'rig' }, { walkingUrl: 'https://external.invalid/walk.glb' }]) {
    const client = createGameCharacterClient({ fetchImpl: async () => json({ job: { ...ready, ...mutation } }) });
    await assert.rejects(client.createJob(prepared()), { code: 'INVALID_RESPONSE' });
  }
});

test('only genuine backend progress is preserved; invalid percentages are omitted', async () => {
  for (const progress of [undefined, -1, 101, '40']) {
    const client = createGameCharacterClient({ fetchImpl: async () => json({ jobs: [{ ...ready, status: 'running', stage: 'rig', progress }], selectedCharacter: null }) });
    assert.equal((await client.mine()).jobs[0].progress, undefined);
  }
  const client = createGameCharacterClient({ fetchImpl: async () => json({ job: { ...ready, status: 'running', stage: 'download', progress: 48 } }) });
  assert.equal((await client.job('job-1')).job.progress, 48);
});

test('outcome_unknown is never promoted to completion', async () => {
  const client = createGameCharacterClient({ fetchImpl: async () => json({ jobs: [{ ...ready, status: 'outcome_unknown', stage: 'rig' }], selectedCharacter: null }) });
  assert.equal((await client.mine()).jobs[0].status, 'outcome_unknown');
});

test('select and reset are explicit POST; returned identity must match', async () => {
  const calls = [];
  const client = createGameCharacterClient({ fetchImpl: async (path, options) => { calls.push({ path, body: JSON.parse(options.body), method: options.method }); return json({ selectedCharacter: calls.length === 1 ? selected : null }); } });
  assert.equal((await client.select('job-1')).selectedCharacter.id, 'job-1');
  assert.equal((await client.select(null)).selectedCharacter, null);
  assert.deepEqual(calls.map(call => call.body), [{ jobId: 'job-1' }, { jobId: null }]);
  assert.ok(calls.every(call => call.method === 'POST'));
  const mismatch = createGameCharacterClient({ fetchImpl: async () => json({ selectedCharacter: selected }) });
  await assert.rejects(mismatch.select('different'), { code: 'INVALID_RESPONSE' });
});

test('private selected character must include walking data and correct facing', async () => {
  const client = createGameCharacterClient({ fetchImpl: async () => json({ jobs: [], selectedCharacter: { ...selected, walkingUrl: undefined } }) });
  await assert.rejects(client.mine(), { code: 'INVALID_RESPONSE' });
});

test('delete only executes on explicit request and validates confirmation', async () => {
  let path, method;
  const client = createGameCharacterClient({ fetchImpl: async (p, options) => { path = p; method = options.method; return json({ deleted: true }); } });
  await client.deleteJob('job-1'); assert.equal(path, '/api/game-characters/jobs/job-1/delete'); assert.equal(method, 'POST');
});

test('errors hide provider data and preserve 401 for App read-only restore', async () => {
  const client = createGameCharacterClient({ fetchImpl: async () => json({ code: 'INVALID_GUEST', error: 'secret-provider-config' }, 401) });
  await assert.rejects(client.mine(), error => error.status === 401 && !error.message.includes('secret-provider-config'));
});

test('cancel stops local wait, not server job, with no retry', async () => {
  const controller = new AbortController(); let count = 0;
  const client = createGameCharacterClient({ fetchImpl: async () => { count += 1; queueMicrotask(() => controller.abort()); return new Promise(() => {}); } });
  await assert.rejects(client.createJob(prepared(), { signal: controller.signal }), { name: 'AbortError' }); assert.equal(count, 1);
});

test('UI gates entering town on real preview readiness and discloses Meshy fees/multiplayer limits', async () => {
  const jsx = await readFile(new URL('../src/components/CharacterStudio.jsx', import.meta.url), 'utf8');
  const preview = await readFile(new URL('../src/components/CharacterModelPreview.jsx', import.meta.url), 'utf8');
  assert.match(jsx, /!modelPreviewReady \|\| !previewCharacterJob/);
  assert.match(jsx, /我同意将这张参考图发送给 Meshy/); assert.match(jsx, /独立费用/); assert.match(jsx, /尚未同步多人外观/);
  assert.match(jsx, /服务端进度：\{item\.progress\}%/);
  assert.match(preview, /GeneratedPlayerModel/); assert.match(preview, /fallback=\{null\}/);
  assert.doesNotMatch(preview, /<img|billboard|localStorage/);
});

test('main entry restores privately via read-only mine and opens studio only on explicit navigation', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /React\.lazy\(\(\) => import\('\.\/components\/CharacterStudio\.jsx'\)\)/);
  assert.match(app, /gameCharacterClient\.mine\(\{ signal: controller\.signal \}\)/);
  assert.match(app, /error\.status !== 401/);
  assert.doesNotMatch(app, /game(?:Image|Character)Client\.(?:bootstrap|createJob|select)\(/);
  assert.match(app, /characterRevision\.current === revision/);
  assert.match(app, /modelUrl: selectedCharacter\.modelUrl, walkingUrl: selectedCharacter\.walkingUrl, facing: selectedCharacter\.facing/);
  assert.match(app, /<CharacterStudio onCharacterChanged=\{onCharacterChanged\} onEnterTown=\{enterTownWithCharacter\}/);
  assert.match(app, /照片与 AI 服务需另行授权/);
});

test('stable shared player model swaps only self, retaining decorations and near third-person visibility', async () => {
  const town = await readFile(new URL('../src/components/Town.jsx', import.meta.url), 'utf8');
  const controller = await readFile(new URL('../src/components/town/PlayerController.jsx', import.meta.url), 'utf8');
  assert.match(town, /function PlayerModel\(props\)/);
  assert.match(town, /if \(!props\.self \|\| !character\?\.asset\) return <AvatarVisual/);
  assert.match(town, /<PlayerController Model=\{PlayerModel\}/);
  assert.match(town, /<AvatarVisual \{\.\.\.props\} bodyVisible=\{modelState !== 'ready'\}/);
  assert.match(town, /fallback=\{null\} onStatus=\{reportStatus\}/);
  assert.match(town, /3D 角色未能加载，暂用默认人物/);
  assert.match(controller, /<Model poseRef=\{pose\} self/);
  assert.doesNotMatch(controller, /!firstPerson && <Model/, 'near third-person mode keeps both the default and generated avatar visible');
  assert.doesNotMatch(town, /network\.(?:send|update)\([^\n]*character/);
});

test('four mobile navigation labels keep semantic control size without icon crowding', async () => {
  const css = await readFile(new URL('../src/character-studio-entry.css', import.meta.url), 'utf8');
  const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(css, /repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /font-size: var\(--text-control\)/);
  assert.match(css, /min-height: 44px/);
  assert.doesNotMatch(css, /font-size:\s*(?:\d|1[0-3])px\b|zoom\s*:|transform:\s*scale/);
  assert.match(main, /import '\.\/character-studio-entry\.css'/);
});
