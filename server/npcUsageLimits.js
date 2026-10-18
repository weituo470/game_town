import { createRateLimiter } from './identity.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_LIMIT = 500;

// Unlimited usage is an explicit operator choice. Missing, malformed, or
// negative values retain the bounded default instead of silently removing it.
export function createNpcDailyLimiter({ configuredLimit, now = Date.now } = {}) {
  const value = typeof configuredLimit === 'number' ? String(configuredLimit) : configuredLimit;
  const parsed = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  const limit = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_DAILY_LIMIT;
  if (limit === 0) return { take: () => true, clear() {} };
  return createRateLimiter({ limit, windowMs: DAY_MS, now, maxKeys: 1 });
}
