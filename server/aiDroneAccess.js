import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const HASH = /^scrypt1\$([0-9a-f]{32})\$([0-9a-f]{64})$/;
const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
export const AI_DRONE_ACCESS_LIMITS = Object.freeze({ passwordChars: 128, failures: 5, windowMs: 60_000, concurrent: 2, trackedIps: 4096 });
const validPassword = value => typeof value === 'string' && value.length > 0 && value.length <= AI_DRONE_ACCESS_LIMITS.passwordChars;
export const isAiDroneAccessHash = value => typeof value === 'string' && HASH.test(value);

/** Server-only provisioning helper. The salt is its 32-character hexadecimal
 * ASCII representation, not decoded bytes. Never log either argument or result. */
export async function createAiDroneAccessHash(password) {
  if (!validPassword(password)) throw new TypeError('测试密码需要包含 1 至 128 个字符。');
  const salt = randomBytes(16).toString('hex');
  const digest = await derive(password, salt, 32, SCRYPT);
  return `scrypt1$${salt}$${digest.toString('hex')}`;
}

/** Provisioning/check helper. HTTP callers must use the bounded gate below. */
export async function verifyAiDroneAccessPassword(password, passwordHash) {
  if (!validPassword(password) || !isAiDroneAccessHash(passwordHash)) return false;
  const [, salt, expected] = HASH.exec(passwordHash);
  const actual = await derive(password, salt, 32, SCRYPT);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export class AiDroneAccessError extends Error {
  constructor(status, code, message) { super(message); this.name = 'AiDroneAccessError'; this.status = status; this.code = code; }
}
const denied = () => new AiDroneAccessError(403, 'AI_DRONE_ACCESS_DENIED', '开发中，请输入正确测试密码');
const limited = () => new AiDroneAccessError(429, 'AI_DRONE_ACCESS_RATE_LIMIT', '尝试过于频繁，请稍后再试');
const busy = () => new AiDroneAccessError(503, 'AI_DRONE_ACCESS_BUSY', '测试验证繁忙，请稍后再试');

/** No passwords, hashes, guest identities or generation data are retained in the
 * attempt map. Fixed-size failure windows plus in-flight reservations prevent
 * concurrent guesses from bypassing the five-per-IP limit. */
export function createAiDroneAccess({ required = false, passwordHash, now = Date.now } = {}) {
  const configured = !required || isAiDroneAccessHash(passwordHash);
  const attempts = new Map();
  let active = 0, closed = false;
  function prune(entry, time) { entry.failed = entry.failed.filter(at => at > time - AI_DRONE_ACCESS_LIMITS.windowMs); }
  function entryFor(ip, time) {
    let entry = attempts.get(ip);
    if (entry) { prune(entry, time); return entry; }
    // Only expired, inactive entries may be evicted. Saturation fails closed.
    for (const [key, candidate] of attempts) {
      prune(candidate, time);
      if (!candidate.pending && !candidate.failed.length) attempts.delete(key);
    }
    if (attempts.size >= AI_DRONE_ACCESS_LIMITS.trackedIps) throw busy();
    entry = { failed: [], pending: 0 }; attempts.set(ip, entry); return entry;
  }
  async function verify({ password, ip }) {
    if (closed) throw busy();
    if (!required) return;
    if (!configured) throw new AiDroneAccessError(503, 'AI_DRONE_DISABLED', 'AI 编导暂未开启，请先欣赏精选演出。');
    if (typeof ip !== 'string' || !ip || ip.length > 160) throw denied();
    const entry = entryFor(ip, now());
    if (entry.failed.length + entry.pending >= AI_DRONE_ACCESS_LIMITS.failures) throw limited();
    if (!validPassword(password)) { entry.failed.push(now()); throw denied(); }
    if (active >= AI_DRONE_ACCESS_LIMITS.concurrent) throw busy();
    entry.pending++; active++;
    let accepted = false;
    try { accepted = await verifyAiDroneAccessPassword(password, passwordHash); }
    catch { throw busy(); }
    finally { entry.pending--; active--; }
    if (closed) throw busy();
    if (!accepted) { entry.failed.push(now()); throw denied(); }
    if (!entry.pending && !entry.failed.length) attempts.delete(ip);
  }
  return { required: required === true, configured, verify, close() { closed = true; attempts.clear(); } };
}
