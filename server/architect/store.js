import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ARCHITECT_PLOTS, validateArchitectPlan } from '../../shared/architectPlan.js';
import { architectError, ARCHITECT_FAILURES } from './errors.js';

const DAY_MS = 86_400_000, OFFSET = 8 * 60 * 60_000;
export function architectDay(time = Date.now()) {
  const start = Math.floor((time + OFFSET) / DAY_MS) * DAY_MS - OFFSET;
  return { key: new Date(start + OFFSET).toISOString().slice(0, 10), resetAt: start + DAY_MS };
}
const serializeProject = row => ({ id: row.id, createdAt: row.created_at, day: row.day, source: row.source, plan: JSON.parse(row.plan) });
const safeFailure = code => Object.hasOwn(ARCHITECT_FAILURES, code) ? code : 'ARCHITECT_STORAGE';
/** Independent global ledger, not a per-browser or per-room quota. Requests are
 * immutable identities; committed projects have SQL-level update/delete guards. */
export function createArchitectStore({ dbPath = '.data/architect.sqlite', db, now = Date.now } = {}) {
  const ownDb = !db;
  if (!db) {
    if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
    db = new DatabaseSync(dbPath === ':memory:' ? dbPath : resolve(dbPath));
  }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS architect_days(day TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS architect_requests(
      id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, owner TEXT NOT NULL, day TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('autonomous','approved')),
      state TEXT NOT NULL CHECK(state IN ('pending','done','failed')),
      created_at INTEGER NOT NULL, lease_until INTEGER NOT NULL, failure_code TEXT);
    CREATE INDEX IF NOT EXISTS architect_pending ON architect_requests(state,lease_until);
    CREATE TABLE IF NOT EXISTS architect_projects(
      id TEXT PRIMARY KEY REFERENCES architect_requests(id), plot_id TEXT NOT NULL UNIQUE,
      day TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('autonomous','approved')),
      created_at INTEGER NOT NULL, plan TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS architect_projects_no_update BEFORE UPDATE ON architect_projects
      BEGIN SELECT RAISE(ABORT,'Architect projects are append only'); END;
    CREATE TRIGGER IF NOT EXISTS architect_projects_no_delete BEFORE DELETE ON architect_projects
      BEGIN SELECT RAISE(ABORT,'Architect projects are append only'); END;`);
  let closed = false;
  const checkOpen = () => { if (closed) throw architectError(503, 'ARCHITECT_STORAGE', '工程账本暂时不可用。'); };
  function reap(time = now()) {
    db.prepare("UPDATE architect_requests SET state='failed', failure_code='ARCHITECT_INTERRUPTED' WHERE state='pending' AND lease_until<=?").run(time);
  }
  function project(id) { const row = db.prepare('SELECT * FROM architect_projects WHERE id=?').get(id); return row ? serializeProject(row) : null; }
  function request(id, fingerprint, owner) {
    checkOpen(); reap();
    const row = db.prepare('SELECT * FROM architect_requests WHERE id=?').get(id);
    if (!row) return null;
    if (row.fingerprint !== fingerprint || row.owner !== owner)
      throw architectError(409, 'ARCHITECT_KEY_REUSED', '该工程编号已用于另一份需求，请新建工程。');
    if (row.state === 'done') return { state: row.state, project: project(id), source: row.source };
    if (row.state === 'failed') {
      const code = safeFailure(row.failure_code), item = ARCHITECT_FAILURES[code];
      throw architectError(item.status, code, item.message);
    }
    throw architectError(409, 'ARCHITECT_IN_FLIGHT', '这处工程正在设计，请等待结果；不会重复调用模型。');
  }
  function projects() { checkOpen(); return db.prepare('SELECT * FROM architect_projects ORDER BY created_at,id').all().map(serializeProject); }
  function snapshot() {
    checkOpen(); reap();
    const day = architectDay(now()), built = projects();
    const latest = db.prepare('SELECT id,state,source,created_at,failure_code FROM architect_requests ORDER BY created_at DESC,rowid DESC LIMIT 1').get();
    const available = ARCHITECT_PLOTS.filter(plot => !built.some(item => item.plan.plotId === plot.id)).map(plot => plot.id);
    return { day: day.key, resetAt: day.resetAt, autonomousUsed: !!db.prepare('SELECT 1 FROM architect_days WHERE day=?').get(day.key),
      projects: built, availablePlotIds: available,
      latest: latest ? { id: latest.id, state: latest.state, source: latest.source, createdAt: latest.created_at,
        message: latest.state === 'done' ? '新工程已加入小镇，原有内容保持不变。' : latest.state === 'pending' ? '建筑师正在设计一处新工程…'
          : ARCHITECT_FAILURES[safeFailure(latest.failure_code)].message } : null };
  }
  function reserve({ id, fingerprint, owner, approved = false, autonomousOnly = false, timeoutMs = 45_000 }) {
    checkOpen();
    db.exec('BEGIN IMMEDIATE');
    try {
      const prior = request(id, fingerprint, owner);
      if (prior) { db.exec('COMMIT'); return { prior }; }
      const time = now(), day = architectDay(time);
      const used = !!db.prepare('SELECT 1 FROM architect_days WHERE day=?').get(day.key);
      if (used && (autonomousOnly || !approved))
        throw architectError(403, 'ARCHITECT_APPROVAL_REQUIRED', '今日自主工程已使用；新增一处工程需要玩家输入审批密码。');
      if (db.prepare("SELECT 1 FROM architect_requests WHERE state='pending' LIMIT 1").get())
        throw architectError(409, 'ARCHITECT_BUSY', '建筑师正在处理一处工程，请完成后再申请。');
      const occupied = new Set(db.prepare('SELECT plot_id FROM architect_projects').all().map(row => row.plot_id));
      const availablePlotIds = ARCHITECT_PLOTS.filter(plot => !occupied.has(plot.id)).map(plot => plot.id);
      if (!availablePlotIds.length) throw architectError(409, 'ARCHITECT_SITES_FULL', '安全建设地块已用完，建筑师已停工；不会覆盖原有建筑。');
      const source = used ? 'approved' : 'autonomous';
      db.prepare("INSERT INTO architect_requests(id,fingerprint,owner,day,source,state,created_at,lease_until) VALUES (?,?,?,?,?,'pending',?,?)")
        .run(id, fingerprint, owner, day.key, source, time, time + timeoutMs + 5000);
      if (!used) db.prepare('INSERT INTO architect_days(day,request_id) VALUES (?,?)').run(day.key, id);
      const existingProjects = projects().map(item => ({ name: item.plan.name, kind: item.plan.kind, plotId: item.plan.plotId }));
      db.exec('COMMIT');
      return { prior: null, id, day: day.key, source, availablePlotIds, existingProjects };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function complete(id, rawPlan) {
    checkOpen();
    db.exec('BEGIN IMMEDIATE');
    try {
      reap();
      const row = db.prepare('SELECT * FROM architect_requests WHERE id=?').get(id);
      if (!row || row.state !== 'pending') throw architectError(409, 'ARCHITECT_INTERRUPTED', '该工程已停止，不会重复施工。');
      const occupied = new Set(db.prepare('SELECT plot_id FROM architect_projects').all().map(item => item.plot_id));
      const plan = validateArchitectPlan(rawPlan, { availablePlotIds: ARCHITECT_PLOTS.filter(plot => !occupied.has(plot.id)).map(plot => plot.id) });
      db.prepare('INSERT INTO architect_projects(id,plot_id,day,source,created_at,plan) VALUES (?,?,?,?,?,?)')
        .run(id, plan.plotId, row.day, row.source, now(), JSON.stringify(plan));
      db.prepare("UPDATE architect_requests SET state='done' WHERE id=? AND state='pending'").run(id);
      const committed = project(id);
      db.exec('COMMIT'); return committed;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function fail(id, code) {
    checkOpen();
    db.prepare("UPDATE architect_requests SET state='failed',failure_code=? WHERE id=? AND state='pending'").run(safeFailure(code), id);
  }
  return { request, projects, snapshot, reserve, complete, fail, close() { if (closed) return; closed = true; if (ownDb) db.close(); } };
}
