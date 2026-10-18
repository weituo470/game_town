import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const GUEST_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Names are display data only. Authorization always comes from a server signature.
export function cleanName(value) {
  if (typeof value !== 'string') return '小镇旅人';
  const name = value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}<>]/gu, '').trim();
  return Array.from(name).slice(0, 16).join('') || '小镇旅人';
}

export function createGuestIdentity({ secret = randomBytes(32), now = Date.now } = {}) {
  if (Buffer.byteLength(secret) < 32) throw new Error('GUEST_SECRET must contain at least 32 bytes.');
  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  const verify = token => {
    if (typeof token !== 'string' || token.length > 1024) return null;
    const pieces = token.split('.');
    if (pieces.length !== 2) return null;
    const [payload, signature] = pieces;
    if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
    const expected = sign(payload);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (data.v !== 1 || typeof data.guestId !== 'string' || !/^[0-9a-f-]{36}$/.test(data.guestId) || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now()) return null;
      return { guestId: data.guestId, expiresAt: data.expiresAt };
    } catch { return null; }
  };
  const issue = ({ token, name } = {}) => {
    const previous = verify(token);
    const data = { v: 1, guestId: previous?.guestId || randomUUID(), expiresAt: now() + GUEST_TOKEN_TTL_MS };
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    return { guestId: data.guestId, name: cleanName(name), token: `${payload}.${sign(payload)}`, expiresAt: data.expiresAt };
  };
  return { issue, verify };
}

export function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 4096 }) {
  const windows = new Map();
  return {
    take(key) {
      const time = now();
      let bucket = windows.get(key);
      if (!bucket || bucket.until <= time) {
        if (windows.size >= maxKeys) {
          for (const [id, item] of windows) if (item.until <= time) windows.delete(id);
          if (windows.size >= maxKeys) return false;
        }
        bucket = { used: 0, until: time + windowMs };
        windows.set(key, bucket);
      }
      bucket.used += 1;
      return bucket.used <= limit;
    },
    clear() { windows.clear(); },
  };
}
