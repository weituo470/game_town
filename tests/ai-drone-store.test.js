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

test('store allows numeric zero only for daily caps and rejects invalid protection configuration before opening a database', () => {
  for (const key of ['daily', 'ipDaily']) {
    const store = createAiDroneStore({ dbPath: ':memory:', limits: { [key]: 0 } });
    try { assert.equal(store.usage('guest').unlimited === true, key === 'daily'); }
    finally { store.close(); }
    for (const value of [-0, -1, .5, null, undefined, '', '0', false, true, NaN, Infinity]) assert.throws(() => createAiDroneStore({ dbPath: ':memory:', limits: { [key]: value } }), /Invalid AI director quota/);
  }
  for (const key of ['ipMinute', 'concurrent', 'guestConcurrent']) for (const value of [0, -0, -1, .5, null, undefined, '', '0', false, NaN, Infinity]) assert.throws(() => createAiDroneStore({ dbPath: ':memory:', limits: { [key]: value } }), /Invalid AI director quota/);
  const finite = createAiDroneStore({ dbPath: ':memory:' });
  try { assert.deepEqual(Object.keys(finite.usage('guest')).sort(), ['limit', 'used', 'remaining', 'resetAt'].sort()); assert.equal(finite.usage('guest').limit, 5); }
  finally { finite.close(); }
});

test('unlimited daily counters survive 35 requests, restart and Beijing midnight without resetting audit or request identity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-drone-unlimited-store-')), dbPath = join(dir, 'test.sqlite');
  let time = Date.parse('2026-10-18T08:00:00Z');
  const options = { dbPath, now: () => time, limits: { daily: 0, ipDaily: 0 } };
  let store = createAiDroneStore(options);
  const first = entry(), records = [];
  try {
    for (let index = 0; index < 35; index++) {
      const current = index === 0 ? first : entry({ guestId: first.guestId });
      records.push(current);
      const reserved = store.reserve(current);
      assert.deepEqual(reserved.usage, { unlimited: true, limit: null, remaining: null, used: index + 1, resetAt: Date.parse('2026-10-18T16:00:00Z') });
      if (index % 2) store.fail(current.guestId, current.requestId, { code: 'AI_DRONE_UPSTREAM' });
      else store.complete(current.guestId, current.requestId, { id: `show-${index}` });
      time += 60_001;
    }
    store.close(); store = createAiDroneStore(options);
    assert.equal(store.usage(first.guestId).used, 35);
    for (const current of records) assert.ok(store.reserve(current).prior);
    assert.equal(store.usage(first.guestId).used, 35);
    time = Date.parse('2026-10-18T16:00:00Z');
    assert.equal(store.usage(first.guestId).used, 0);
    assert.equal(store.reserve(first).prior.result.id, 'show-0');
    assert.equal(store.usage(first.guestId).used, 0);
    const next = entry({ guestId: first.guestId });
    assert.equal(store.reserve(next).usage.used, 1);
    store.complete(next.guestId, next.requestId, {});
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test('each daily cap is independently optional while short rate and concurrency remain enforced', () => {
  for (const [limits, code] of [[{ daily: 0, ipDaily: 2 }, 'AI_DRONE_IP_DAILY_LIMIT'], [{ daily: 2, ipDaily: 0 }, 'AI_DRONE_DAILY_LIMIT']]) {
    const store = createAiDroneStore({ dbPath: ':memory:', limits }), first = entry();
    try {
      for (let index = 0; index < 2; index++) { const current = entry({ guestId: first.guestId }); store.reserve(current); store.complete(current.guestId, current.requestId, {}); }
      assert.throws(() => store.reserve(first), { code });
      assert.equal(store.usage(first.guestId).used, 2);
    } finally { store.close(); }
  }
  let time = Date.parse('2026-10-18T08:00:00Z');
  const store = createAiDroneStore({ dbPath: ':memory:', now: () => time, limits: { daily: 0, ipDaily: 0 } }), first = entry();
  try {
    for (let index = 0; index < 3; index++) { const current = entry({ guestId: first.guestId }); store.reserve(current); store.complete(current.guestId, current.requestId, {}); }
    assert.throws(() => store.reserve(first), { code: 'AI_DRONE_IP_RATE_LIMIT', charged: false });
    assert.equal(store.usage(first.guestId).used, 3);
    time += 60_001;
    store.reserve(first);
    assert.throws(() => store.reserve(entry({ guestId: first.guestId, ip: 'other' })), { code: 'AI_DRONE_IN_FLIGHT', charged: false });
    const second = entry({ ip: 'other-two' }); store.reserve(second);
    assert.throws(() => store.reserve(entry({ ip: 'other-three' })), { code: 'AI_DRONE_CAPACITY', charged: false });
    assert.equal(store.reserve(first).prior.state, 'pending');
    assert.equal(store.usage(first.guestId).used, 4);
  } finally { store.close(); }
});

test('switching existing finite audit to unlimited preserves rows and neutralizes old replay wording without rewriting history', () => {
  const db = new DatabaseSync(':memory:');
  let time = Date.parse('2026-10-18T08:00:00Z');
  let store = createAiDroneStore({ db, now: () => time });
  const first = entry(), legacy = { status: 502, code: 'AI_DRONE_UPSTREAM', message: '本次已计入额度', charged: true, phase: 'provider_request', reason: 'provider_http', finishedAt: time, durationMs: 0 };
  try {
    store.reserve(first); store.fail(first.guestId, first.requestId, legacy);
    db.prepare('UPDATE ai_drone_requests SET error=? WHERE guest_id=? AND request_id=?').run(JSON.stringify(legacy), first.guestId, first.requestId);
    for (let index = 1; index < 5; index++) { time += 60_001; const current = entry({ guestId: first.guestId }); store.reserve(current); store.complete(current.guestId, current.requestId, {}); }
    assert.throws(() => store.reserve(entry({ guestId: first.guestId })), { code: 'AI_DRONE_DAILY_LIMIT' });
    store.close(); store = createAiDroneStore({ db, now: () => time, limits: { daily: 0, ipDaily: 0 } });
    assert.equal(store.usage(first.guestId).used, 5);
    const replay = store.reserve(first).prior.error;
    assert.doesNotMatch(replay.message, /额度|扣次/); assert.equal(replay.reason, 'provider_http'); assert.equal(replay.charged, true);
    assert.deepEqual(JSON.parse(db.prepare('SELECT error FROM ai_drone_requests WHERE request_id=?').get(first.requestId).error), legacy);
    const sixth = entry({ guestId: first.guestId }); assert.equal(store.reserve(sixth).usage.used, 6); store.complete(sixth.guestId, sixth.requestId, {});
    assert.equal(db.prepare('SELECT count(*) AS count FROM ai_drone_requests').get().count, 6);
  } finally { store.close(); db.close(); }
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
  for (const field of ['shape', 'motion', 'transition']) for (const sceneIndex of [0, 6]) assert.deepEqual(sanitizeAiDroneFailureMetadata({ phase: 'score_schema', reason: 'AI_SCORE_CHOICE', field, sceneIndex, value: 'PRIVATE MODEL' }), { phase: 'score_schema', reason: 'AI_SCORE_CHOICE', field, sceneIndex });
  for (const patch of [{ field: 'PRIVATE KEY' }, { field: '__proto__' }, { field: {} }, { sceneIndex: -1 }, { sceneIndex: 7 }, { sceneIndex: 0.5 }, { sceneIndex: '1' }, { sceneIndex: Infinity }]) assert.deepEqual(sanitizeAiDroneFailureMetadata({ phase: 'score_schema', reason: 'AI_SCORE_CHOICE', field: 'shape', sceneIndex: 0, ...patch }), { phase: 'score_schema', reason: 'AI_SCORE_CHOICE' });
  assert.deepEqual(sanitizeAiDroneFailureMetadata({ phase: 'provider_request', reason: 'provider_http', field: 'shape', sceneIndex: 0 }), { phase: 'provider_request', reason: 'provider_http' });
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
