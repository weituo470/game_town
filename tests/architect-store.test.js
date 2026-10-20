import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createArchitectStore, architectDay } from '../server/architect/store.js';
import { ARCHITECT_PLOTS } from '../shared/architectPlan.js';
const example = plotId => ({ version: 1, name: '海风书屋', description: '新增阅读空间。', plotId, kind: 'reading_room', palette: 'coastal', orientation: 0 });
const claim = (id, extra = {}) => ({ id, fingerprint: 'same-brief', owner: 'visitor', ...extra });
const removeFixture = dir => {
  assert.ok(dir.startsWith(join(tmpdir(), 'architect-store-')) && dir !== tmpdir());
  rmSync(dir, { recursive: true, force: true });
};
test('Beijing natural day changes at exactly 16:00 UTC', () => {
  assert.equal(architectDay(Date.parse('2026-10-20T15:59:59.999Z')).key, '2026-10-20');
  assert.equal(architectDay(Date.parse('2026-10-20T16:00:00.000Z')).key, '2026-10-21');
});
test('one autonomous reservation is global and persistent across connections/restarts, failure still consumes attempt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'architect-store-')), dbPath = join(dir, 'ledger.sqlite');
  let time = Date.parse('2026-10-20T08:00:00Z'), a, b;
  try {
    a = createArchitectStore({ dbPath, now: () => time }); b = createArchitectStore({ dbPath, now: () => time });
    assert.equal(a.reserve(claim('a')).source, 'autonomous');
    assert.throws(() => b.reserve(claim('b')), { code: 'ARCHITECT_APPROVAL_REQUIRED' });
    assert.throws(() => b.reserve(claim('b', { approved: true })), { code: 'ARCHITECT_BUSY' });
    a.fail('a', 'ARCHITECT_UPSTREAM'); a.close();
    assert.equal(b.snapshot().autonomousUsed, true);
    assert.throws(() => b.reserve(claim('a')), { code: 'ARCHITECT_UPSTREAM' });
    assert.throws(() => b.reserve(claim('a', { fingerprint: 'different' })), { code: 'ARCHITECT_KEY_REUSED' });
    assert.equal(b.reserve(claim('b', { approved: true })).source, 'approved');
    b.complete('b', example(ARCHITECT_PLOTS[0].id));
    assert.equal(b.request('b', 'same-brief', 'visitor').state, 'done');
    assert.equal(b.snapshot().projects.length, 1);
    time = Date.parse('2026-10-20T16:00:00Z');
    assert.equal(b.snapshot().autonomousUsed, false);
    assert.equal(b.reserve(claim('c')).source, 'autonomous');
  } finally { a?.close(); b?.close(); removeFixture(dir); }
});
test('SQL triggers prohibit changing or deleting a committed building, expired requests cannot finish', () => {
  let time = 1000; const db = new DatabaseSync(':memory:'), store = createArchitectStore({ db, now: () => time });
  try {
    store.reserve(claim('a')); const first = store.complete('a', example(ARCHITECT_PLOTS[0].id));
    assert.throws(() => db.prepare('UPDATE architect_projects SET plan=? WHERE id=?').run('{}', first.id), /append only/);
    assert.throws(() => db.prepare('DELETE FROM architect_projects WHERE id=?').run(first.id), /append only/);
    store.reserve(claim('b', { approved: true, timeoutMs: 1 })); time += 5002;
    assert.throws(() => store.complete('b', example(ARCHITECT_PLOTS[1].id)), { code: 'ARCHITECT_INTERRUPTED' });
    assert.equal(store.snapshot().projects.length, 1);
  } finally { store.close(); db.close(); }
});
test('full surveyed site budget stops construction instead of overwriting any existing project', () => {
  const store = createArchitectStore({ dbPath: ':memory:' });
  try {
    for (let i = 0; i < ARCHITECT_PLOTS.length; i++) {
      store.reserve(claim(`item-${i}`, { approved: true }));
      store.complete(`item-${i}`, example(ARCHITECT_PLOTS[i].id));
    }
    assert.equal(store.snapshot().projects.length, 12);
    assert.throws(() => store.reserve(claim('extra', { approved: true })), { code: 'ARCHITECT_SITES_FULL' });
  } finally { store.close(); }
});
test('independent Node processes racing for the same Beijing day produce exactly one autonomous claim', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'architect-store-')), dbPath = join(dir, 'ledger.sqlite');
  const initialize = createArchitectStore({ dbPath }); initialize.close();
  const module = new URL('../server/architect/store.js', import.meta.url).href;
  const run = id => new Promise((resolve, reject) => {
    const script = `import {createArchitectStore} from ${JSON.stringify(module)};
      const s=createArchitectStore({dbPath:process.argv[1]});
      try{s.reserve({id:process.argv[2],owner:process.argv[2],fingerprint:'test'});process.stdout.write('claimed');}
      catch(e){process.stdout.write(e.code||'unknown');}finally{s.close();}`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, dbPath, id], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { errors += value; });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`Fixture process failed: ${errors}`)));
  });
  try {
    const results = await Promise.all(['one', 'two', 'three', 'four'].map(run));
    assert.equal(results.filter(value => value === 'claimed').length, 1);
    assert.equal(results.filter(value => value === 'ARCHITECT_APPROVAL_REQUIRED').length, 3);
  } finally { removeFixture(dir); }
});
