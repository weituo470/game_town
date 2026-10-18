import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTownServer } from '../server/index.js';

test('main HTTP workshop routes share private identity and stay cost-free when unconfigured', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'town-workshop-http-'));
  const server = await createTownServer({ port: 0, npcConfig: { enabled: false }, npcSpeechConfig: { enabled: false },
    gameImageConfig: { enabled: false, dbPath: join(dir, 'images.sqlite') },
    gameCharacterConfig: { enabled: false, reason: 'provider-unconfigured', dbPath: join(dir, 'characters.sqlite') },
    gameImageProvider: { generate() { assert.fail('disabled generation must not run'); } },
  });
  try {
    assert.equal((await fetch(server.url + '/api/game-characters/mine')).status, 401);
    const bootstrap = await fetch(server.url + '/api/game-images/bootstrap');
    const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
    assert.match(bootstrap.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(bootstrap.headers.get('set-cookie'), /SameSite=Strict/i);
    assert.equal((await bootstrap.json()).enabled, false);
    const status = await fetch(server.url + '/api/game-characters/status', { headers: { cookie } });
    assert.equal(status.status, 200);
    const body = await status.json();
    assert.equal(body.enabled, false);
    assert.equal(body.reason, 'provider-unconfigured');
    assert.equal(body.selectedCharacter, null);
    assert.deepEqual(body.jobs, []);
    assert.doesNotMatch(JSON.stringify(body), /apiKey|credentialEnvFile|dbPath|[A-Z]:\\/);
    for (const path of ['/api/game-images/inputs', '/api/game-characters/select']) {
      const denied = await fetch(server.url + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
      assert.equal(denied.status, 403, 'state changes require an explicit allowed Origin');
      const foreign = await fetch(server.url + path, { method: 'POST', headers: { cookie, origin: 'https://other.invalid', 'content-type': 'application/json' }, body: '{}' });
      assert.equal(foreign.status, 403);
    }
    const selected = await fetch(server.url + '/api/game-characters/select', { method: 'POST', headers: { cookie, origin: server.url, 'content-type': 'application/json' }, body: '{"jobId":null}' });
    assert.equal(selected.status, 200);
    const preflight = await fetch(server.url + '/api/game-images/jobs', { method: 'OPTIONS', headers: { origin: server.url } });
    assert.match(preflight.headers.get('access-control-allow-headers'), /Idempotency-Key/);
    assert.equal((await fetch(server.url + '/game-characters.local.json')).status, 404);
    assert.equal((await fetch(server.url + '/.data/game-characters/game-characters.sqlite')).status, 404);
  } finally {
    await server.close();
    // Only our newly created and verified temporary test directory is removed.
    assert.ok(dir.startsWith(join(tmpdir(), 'town-workshop-http-')));
    await rm(dir, { recursive: true, force: true });
  }
});
