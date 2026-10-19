import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiDroneStore, aiDroneDay, sanitizeAiDroneFailureMetadata, AI_DRONE_FAILURE_PHASES, AI_DRONE_FAILURE_REASONS } from '../server/aiDroneStore.js';
import { DatabaseSync } from 'node:sqlite';

const entry = (overrides = {}) => ({ guestId: randomUUID(), requestId: randomUUID(), fingerprint: 'same-topic', ip: '127.0.0.1', ...overrides });
test('AI daily usage uses Beijing calendar midnight rather than server timezone or rolling 24 hours', () => {
  const before = Date.parse('2026-10-18T15:59:59.999Z');
  assert.equal(aiDroneDay(before).resetAt, Date.parse('2026-10-18T16:00:00.000Z'));
  assert.notEqual(aiDroneDay(before).key, aiDroneDay(before + 1).key);
});

test('AI store persists successful/failed request IDs, usage and hashed IP limits across reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-drone-store-')), dbPath = join(dir, 'test.sqlite');
  let time = Date.parse('2026-10-18T08:00:00Z');
  let store = createAiDroneStore({ dbPath, now: () => time });
  const a = entry(), b = entry({ guestId: a.guestId });
  try {
    assert.equal(store.reserve(a).usage.used, 1);
    store.complete(a.guestId, a.requestId, { id: 'show', score: { version: 1 } });
    store.reserve(b); store.fail(b.guestId, b.requestId, { status: 502, code: 'AI_DRONE_UPSTREAM', message: 'safe' });
    store.close(); store = createAiDroneStore({ dbPath, now: () => time });
    assert.equal(store.reserve(a).prior.result.id, 'show');
    assert.equal(store.reserve(b).prior.error.charged, true);
    assert.equal(store.usage(a.guestId).used, 2);
    const c = entry(); store.reserve(c); store.complete(c.guestId, c.requestId, {});
    assert.throws(() => store.reserve(entry()), { code: 'AI_DRONE_IP_RATE_LIMIT' });
    time += 60_001; assert.equal(store.reserve(entry()).prior, null);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test('AI store quota reset does not permit repeating an old request or charge it twice', () => {
  let time = Date.parse('2026-10-18T15:59:59Z');
  const store = createAiDroneStore({ dbPath: ':memory:', now: () => time, limits: { daily: 1 } });
  const a = entry();
  try {
    store.reserve(a); store.complete(a.guestId, a.requestId, { id: 'original' });
    assert.throws(() => store.reserve(entry({ guestId: a.guestId })), { code: 'AI_DRONE_DAILY_LIMIT' });
    time += 1001;
    assert.equal(store.usage(a.guestId).remaining, 1);
    assert.equal(store.reserve(a).prior.result.id, 'original');
    assert.equal(store.usage(a.guestId).used, 0);
  } finally { store.close(); }
});

test('AI store enforces single guest concurrency and global concurrency atomically without consuming denied quota', () => {
  const store = createAiDroneStore({ dbPath: ':memory:' }), a = entry(), b = entry({ ip: 'other' });
  try {
    store.reserve(a);
    assert.throws(() => store.reserve(entry({ guestId: a.guestId, ip: 'another' })), { code: 'AI_DRONE_IN_FLIGHT' });
    store.reserve(b);
    const c = entry({ ip: 'third' });
    assert.throws(() => store.reserve(c), { code: 'AI_DRONE_CAPACITY' });
    assert.equal(store.usage(c.guestId).used, 0);
    assert.equal(store.usage(a.guestId).used, 1);
    store.complete(a.guestId, a.requestId, {});
    assert.equal(store.reserve(c).usage.used, 1);
  } finally { store.close(); }
});

test('IP day quota survives guest changes and minute expiry; stale pending requests remain charged and never resubmit', () => {
  let time = Date.parse('2026-10-18T08:00:00Z');
  const store = createAiDroneStore({ dbPath: ':memory:', now: () => time, limits: { ipDaily: 1 } }), a = entry();
  try {
    store.reserve(a);
    time += 60_001;
    assert.equal(store.request(a.guestId, a.requestId).error.code, 'AI_DRONE_INTERRUPTED');
    assert.equal(store.reserve(a).prior.state, 'failed');
    assert.throws(() => store.reserve(entry()), { code: 'AI_DRONE_IP_DAILY_LIMIT' });
    assert.equal(store.usage(a.guestId).used, 1);
  } finally { store.close(); }
});

test('failure metadata is an allowlist of enums and integer timing, never arbitrary provider strings', () => {
  assert.ok(Object.isFrozen(AI_DRONE_FAILURE_PHASES)); assert.ok(Object.isFrozen(AI_DRONE_FAILURE_REASONS));
  assert.deepEqual(sanitizeAiDroneFailureMetadata({ phase: 'score_schema', reason: 'AI_SCORE_OUTLINE', finishedAt: 100, durationMs: 25, prompt: 'PRIVATE', token: 'PRIVATE', rawResponse: 'PRIVATE' }), { phase: 'score_schema', reason: 'AI_SCORE_OUTLINE', finishedAt: 100, durationMs: 25 });
  for (const value of [null, {}, { phase: 'PRIVATE KEY', reason: 'PRIVATE MODEL JSON', finishedAt: '100', durationMs: -1 }, { phase: {}, reason: [], finishedAt: Infinity, durationMs: NaN }]) assert.deepEqual(sanitizeAiDroneFailureMetadata(value), { phase: 'unknown', reason: 'unknown' });
});

test('store persists only sanitized failure diagnostics and never supplied failure message or prompt', () => {
  let time = Date.parse('2026-10-19T04:00:00Z');
  const db = new DatabaseSync(':memory:');
  const store = createAiDroneStore({ db, now: () => time });
  const request = entry({ prompt: 'PRIVATE USER PROMPT', token: 'PRIVATE TOKEN' });
  try {
    store.reserve(request); time += 152;
    const stored = store.fail(request.guestId, request.requestId, { status: 999, code: 'AI_DRONE_INVALID_SCORE', message: 'PRIVATE RAW MODEL JSON', phase: 'score_schema', reason: 'AI_SCORE_FIELDS', finishedAt: time, durationMs: 999999, prompt: 'PRIVATE USER PROMPT', rawResponse: 'PRIVATE MODEL RESPONSE' });
    assert.equal(stored.status, 502); assert.equal(stored.durationMs, 152);
    assert.equal(stored.finishedAt, time); assert.equal(stored.reason, 'AI_SCORE_FIELDS');
    const row = db.prepare('SELECT * FROM ai_drone_requests').get();
    assert.equal(row.result, null); assert.doesNotMatch(JSON.stringify(row), /PRIVATE|TOKEN|RAW MODEL/);
    assert.deepEqual(JSON.parse(row.error), stored);
    assert.deepEqual(store.request(request.guestId, request.requestId).error, stored);
  } finally { store.close(); db.close(); }
});

test('expired pending requests acquire safe terminal timestamps and remain idempotent', () => {
  let time = Date.parse('2026-10-19T04:00:00Z');
  const store = createAiDroneStore({ dbPath: ':memory:', now: () => time });
  const request = entry();
  try {
    store.reserve(request); time += 55_000;
    const first = store.request(request.guestId, request.requestId).error;
    assert.equal(first.phase, 'lifecycle'); assert.equal(first.reason, 'lease_expired');
    assert.equal(first.finishedAt, time); assert.equal(first.durationMs, 55_000);
    time += 10_000;
    assert.deepEqual(store.reserve(request).prior.error, first);
    assert.equal(store.usage(request.guestId).used, 1);
  } finally { store.close(); }
});
