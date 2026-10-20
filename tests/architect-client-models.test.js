import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Box3 } from 'three';
import { ARCHITECT_KINDS, ARCHITECT_PALETTES, ARCHITECT_BUILDING_BOUNDS } from '../shared/architectPlan.js';
import { createArchitectBuilding, createArchitectResident } from '../src/components/architect/architectModels.js';
import { createArchitectClient } from '../src/lib/architectClient.js';
import { appUrl } from '../src/lib/appUrl.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const guest = { token: 'architect-client-test-signed-identity', expiresAt: 9999999999999 };
const ledger = { enabled: true, projects: [], day: '2026-10-20', autonomousUsed: false, phase: 'ready' };
const input = extra => ({ idempotencyKey: randomUUID(), brief: '添一间书屋', ...extra });

test('six original building types stay inside the same surveyed geometry envelope for every palette and quarter turn', () => {
  const fingerprints = new Set();
  for (const kind of ARCHITECT_KINDS) {
    for (const palette of Object.values(ARCHITECT_PALETTES)) {
      const model = createArchitectBuilding({ kind }, palette), { halfWidth, halfDepth, height } = ARCHITECT_BUILDING_BOUNDS;
      try {
        assert.ok(model.stats.drawCalls <= 6 && model.stats.drawCalls >= 1, kind);
        assert.ok(model.stats.triangles <= 2500 && model.stats.triangles >= 100, kind);
        assert.equal(model.stats.drawCalls, model.group.children.length);
        let triangles = 0;
        for (const mesh of model.group.children) {
          assert.equal(mesh.isMesh, true); assert.equal(mesh.material.map, null);
          const position = mesh.geometry.attributes.position;
          assert.ok([...position.array].every(Number.isFinite), kind);
          triangles += position.count / 3;
        }
        assert.equal(model.stats.triangles, triangles);
        for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
          model.group.rotation.y = angle; model.group.updateMatrixWorld(true);
          const box = new Box3().setFromObject(model.group);
          assert.ok(box.min.x >= -halfWidth && box.max.x <= halfWidth, `${kind} x`);
          assert.ok(box.min.z >= -halfDepth && box.max.z <= halfDepth, `${kind} z`);
          assert.ok(box.min.y >= -0.00001 && box.max.y <= height, `${kind} y`);
        }
      } finally { model.dispose(); }
    }
    const model = createArchitectBuilding({ kind }, ARCHITECT_PALETTES.coastal);
    const digest = createHash('sha256');
    model.group.children.forEach(mesh => digest.update(Buffer.from(mesh.geometry.attributes.position.array.buffer)));
    fingerprints.add(digest.digest('hex')); model.dispose();
  }
  assert.equal(fingerprints.size, 6, 'all six types have distinct actual geometry, not a label-only variation');
});

test('architect building and resident disposal is exact once and does not dispose another live instance', () => {
  for (const make of [() => createArchitectBuilding({ kind: 'greenhouse' }, ARCHITECT_PALETTES.sage), createArchitectResident]) {
    const first = make(), second = make();
    let geometryEvents = 0, materialEvents = 0, secondEvents = 0;
    const count = first.group.children.length;
    first.group.children.forEach(mesh => {
      mesh.geometry.addEventListener('dispose', () => geometryEvents++);
      mesh.material.addEventListener('dispose', () => materialEvents++);
    });
    second.group.children.forEach(mesh => mesh.geometry.addEventListener('dispose', () => secondEvents++));
    first.dispose(); first.dispose();
    assert.equal(geometryEvents, count); assert.equal(materialEvents, count);
    assert.equal(secondEvents, 0); assert.equal(first.group.children.length, 0);
    assert.ok(second.group.children.length > 0);
    second.dispose(); assert.equal(secondEvents, second.stats.drawCalls);
  }
  const resident = createArchitectResident(), box = new Box3().setFromObject(resident.group);
  assert.ok(box.max.y <= 2.2 && box.min.y >= 0); assert.ok(resident.stats.drawCalls <= 6 && resident.stats.triangles <= 2200);
  resident.dispose();
});

test('architect status is a base-path-safe GET, never creates a guest or calls the model', async () => {
  const calls = [];
  const client = createArchitectClient({ resolveUrl: path => appUrl(path, '/game-town/'), fetchImpl: async (url, options) => {
    calls.push({ url, options }); return json(ledger);
  } });
  await client.status(); await client.status();
  assert.equal(calls.length, 2);
  for (const { url, options } of calls) {
    assert.equal(url, '/game-town/api/architect/status');
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
  }
});

test('architect passwords exist only in the one approved POST and are never retained in client storage or future requests', async () => {
  const calls = [], password = 'browser-fixture-approval-only';
  const client = createArchitectClient({ resolveUrl: path => appUrl(path, '/game-town/'), fetchImpl: async (url, options) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : undefined });
    return json(url.endsWith('/api/guest') ? guest : url.endsWith('/status') ? ledger : { project: { id: 'fixture' } });
  } });
  const first = input({ password }); await client.generate(first); await client.status(); await client.generate(input());
  assert.deepEqual(calls.map(call => call.url), ['/game-town/api/guest', '/game-town/api/architect/generate', '/game-town/api/architect/status', '/game-town/api/architect/generate']);
  assert.equal(calls[1].body.password, password);
  assert.equal(calls[1].body.idempotencyKey, first.idempotencyKey);
  assert.deepEqual(Object.keys(calls[1].body).sort(), ['brief', 'idempotencyKey', 'password', 'token']);
  assert.equal(calls[3].body.password, undefined);
  assert.equal(JSON.stringify(calls[0]).includes(password), false); assert.equal(JSON.stringify(calls[2]).includes(password), false);
  const source = readFileSync(new URL('../src/lib/architectClient.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\s*\.\s*cookie|console\s*\./);
});

test('paid generation failure is not retried and the caller can explicitly reuse its idempotency key', async () => {
  const calls = [];
  const client = createArchitectClient({ fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return url.endsWith('/guest') ? json(guest) : json({ code: 'ARCHITECT_INVALID_PLAN', message: '方案未通过校验。' }, 502);
  } });
  const request = input();
  await assert.rejects(client.generate(request), { code: 'ARCHITECT_INVALID_PLAN' });
  assert.equal(calls.length, 2);
  await assert.rejects(client.generate(request), { code: 'ARCHITECT_INVALID_PLAN' });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].body.idempotencyKey, calls[2].body.idempotencyKey);
});

test('401 drops the expired guest but does not silently renew identity or retry a generation', async () => {
  const calls = [];
  const client = createArchitectClient({ fetchImpl: async url => {
    calls.push(url); return url.endsWith('/guest') ? json(guest) : json({ code: 'GUEST_EXPIRED', message: '身份过期。' }, 401);
  } });
  await assert.rejects(client.generate(input()), { status: 401 });
  assert.deepEqual(calls, ['/api/guest', '/api/architect/generate']);
  await assert.rejects(client.generate(input()), { status: 401 });
  assert.deepEqual(calls, ['/api/guest', '/api/architect/generate', '/api/guest', '/api/architect/generate']);
});

test('client rejects concurrent submissions and invalid input before another network or paid call', async () => {
  let calls = 0, release;
  const client = createArchitectClient({ fetchImpl: async url => {
    calls++; if (url.endsWith('/guest')) return json(guest);
    await new Promise(resolve => { release = resolve; }); return json({ project: {} });
  } });
  for (const values of [{ brief: 'x'.repeat(201) }, { password: 'x'.repeat(129) }, { brief: 3 }]) await assert.rejects(client.generate(input(values)));
  assert.equal(calls, 0);
  const current = client.generate(input());
  await assert.rejects(client.generate(input()), /正在提交/);
  // Observe the actual mocked request, not a fixed time delay.
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release(); await current; assert.equal(calls, 2);
});

test('already-aborted requests do not start a fetch', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const client = createArchitectClient({ fetchImpl: async () => { calls++; return json(ledger); } });
  await assert.rejects(client.status({ signal: controller.signal }), /不会重复提交/);
  await assert.rejects(client.generate(input({ signal: controller.signal })), /不会重复提交/);
  assert.equal(calls, 0);
});

test('declared oversized responses cancel their body before acquiring a reader', async () => {
  let cancels = 0, readers = 0;
  const client = createArchitectClient({ fetchImpl: async () => ({
    ok: true, headers: new Headers({ 'content-length': String(128 * 1024 + 1) }),
    body: { cancel() { cancels++; return Promise.resolve(); }, getReader() { readers++; throw Error('must not acquire reader'); } },
  }) });
  await assert.rejects(client.status(), /响应过大/);
  assert.equal(cancels, 1); assert.equal(readers, 0);
});

test('streaming and text-only response limits count UTF-8 bytes, not just characters', async () => {
  const value = '界'.repeat(45000);
  for (const response of [() => new Response(value), () => ({ ok: true, headers: new Headers(), text: async () => value })]) {
    const client = createArchitectClient({ fetchImpl: async () => response() });
    await assert.rejects(client.status(), /响应过大/);
  }
});

test('timeout covers a fetch, body read, and cleanup that ignore AbortSignal without retrying', async () => {
  let calls = 0;
  const stalledFetch = createArchitectClient({ timeoutMs: 5, fetchImpl: async () => { calls++; return new Promise(() => {}); } });
  await assert.rejects(stalledFetch.status(), /不会重复提交/); assert.equal(calls, 1);
  let cancelled = 0, released = 0;
  const stalledBody = createArchitectClient({ timeoutMs: 5, fetchImpl: async () => {
    calls++; return { ok: true, headers: new Headers(), body: { getReader() { return {
      read: () => new Promise(() => {}), cancel() { cancelled++; return new Promise(() => {}); }, releaseLock() { released++; },
    }; } } };
  } });
  await assert.rejects(stalledBody.status(), /不会重复提交/);
  assert.equal(calls, 2); assert.equal(cancelled, 1); assert.equal(released, 1);
});

test('aborted late fetches cancel any eventual response body and never publish a stale ledger', async () => {
  let release, cancels = 0;
  const client = createArchitectClient({ timeoutMs: 5, fetchImpl: async () => new Promise(resolve => { release = resolve; }) });
  await assert.rejects(client.status(), /不会重复提交/);
  release({ ok: true, headers: new Headers(), body: { cancel() { cancels++; return Promise.resolve(); } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancels, 1);
});

test('malformed or oversized status ledgers are rejected rather than clearing the established world', async () => {
  for (const result of [null, { enabled: true }, { enabled: 'yes', projects: [] }, { enabled: true, projects: Array(33).fill({}) }]) {
    const client = createArchitectClient({ fetchImpl: async () => json(result) });
    await assert.rejects(client.status(), /保留现有建筑/);
  }
});
