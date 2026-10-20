import { createAiDroneAccessHash, isAiDroneAccessHash, verifyAiDroneAccessPassword } from '../aiDroneAccess.js';
import { architectError } from './errors.js';

// Reuse the audited server-only scrypt format, never the AI director's UI gate.
export const createArchitectPasswordHash = createAiDroneAccessHash;
export const isArchitectPasswordHash = isAiDroneAccessHash;
export const ARCHITECT_ACCESS_LIMITS = Object.freeze({ failures: 5, windowMs: 15 * 60_000, concurrent: 2, keys: 4096 });
export function createArchitectApproval({ passwordHash, now = Date.now } = {}) {
  const buckets = new Map(); let active = 0, closed = false;
  const configured = isArchitectPasswordHash(passwordHash);
  const denied = () => architectError(403, 'ARCHITECT_APPROVAL_DENIED', '审批密码不正确，未调用模型。');
  function prune() {
    const time = now();
    for (const [id, item] of buckets) {
      item.failures = item.failures.filter(at => at > time - ARCHITECT_ACCESS_LIMITS.windowMs);
      if (!item.failures.length && !item.pending) buckets.delete(id);
    }
  }
  function bucket(key) {
    if (!buckets.has(key)) {
      if (buckets.size >= ARCHITECT_ACCESS_LIMITS.keys) throw architectError(503, 'ARCHITECT_APPROVAL_BUSY', '审批验证繁忙，请稍后再试。');
      buckets.set(key, { failures: [], pending: 0 });
    }
    return buckets.get(key);
  }
  async function verify({ password, guestId, ip }) {
    if (closed || !configured) throw architectError(503, 'ARCHITECT_DISABLED', '建筑师尚未配置完成。');
    if (typeof ip !== 'string' || !ip || ip.length > 160 || typeof guestId !== 'string' || guestId.length > 100) throw denied();
    // Prune once before creating the pair: pruning between the IP and guest
    // lookup would evict a new empty IP bucket and silently disable its limit.
    prune();
    const entries = [bucket(`ip:${ip}`), bucket(`guest:${guestId}`)];
    if (entries.some(entry => entry.failures.length + entry.pending >= ARCHITECT_ACCESS_LIMITS.failures))
      throw architectError(429, 'ARCHITECT_APPROVAL_RATE_LIMIT', '审批尝试过于频繁，请稍后再试。');
    if (typeof password !== 'string' || !password.length || password.length > 128) {
      entries.forEach(entry => entry.failures.push(now())); throw denied();
    }
    if (active >= ARCHITECT_ACCESS_LIMITS.concurrent) throw architectError(503, 'ARCHITECT_APPROVAL_BUSY', '审批验证繁忙，请稍后再试。');
    entries.forEach(entry => entry.pending++); active++;
    let accepted = false;
    try { accepted = await verifyAiDroneAccessPassword(password, passwordHash); }
    catch { throw architectError(503, 'ARCHITECT_APPROVAL_BUSY', '审批验证繁忙，请稍后再试。'); }
    finally { entries.forEach(entry => entry.pending--); active--; }
    if (closed) throw architectError(503, 'ARCHITECT_DISABLED', '建筑师暂时不可用。');
    if (!accepted) { entries.forEach(entry => entry.failures.push(now())); throw denied(); }
  }
  return { configured, verify, close() { closed = true; buckets.clear(); } };
}
