import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_GAME_IMAGE_CONFIG = fileURLToPath(new URL('../../game-images.local.json', import.meta.url));
const integer = (value, fallback, max) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Math.min(Number(value), max) : fallback;
export function loadGameImageConfig({ env = process.env, configPath = env.GAME_IMAGE_CONFIG || DEFAULT_GAME_IMAGE_CONFIG } = {}) {
  try {
    const local = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
    const config = {
      enabled: (env.GAME_IMAGE_ENABLED ?? String(local.enabled ?? false)) === 'true',
      dailyBudget: integer(env.GAME_IMAGE_DAILY_BUDGET ?? local.dailyBudget, 0, 100),
      ownerDailyBudget: integer(env.GAME_IMAGE_OWNER_DAILY_BUDGET ?? local.ownerDailyBudget, 2, 10),
      maxQueue: integer(env.GAME_IMAGE_MAX_QUEUE ?? local.maxQueue, 8, 32),
      maxStorageBytes: integer(env.GAME_IMAGE_MAX_STORAGE_BYTES ?? local.maxStorageBytes, 128 * 1024 * 1024, 512 * 1024 * 1024),
      ...(env.GAME_IMAGE_DB ? { dbPath: env.GAME_IMAGE_DB } : {}),
      ...(local.secureCookie === true ? { secureCookie: true } : {}),
    };
    // Disabled-by-default means no credential file access and no provider object.
    if (!config.enabled || config.dailyBudget === 0) return config;
    const tokenFile = env.GAME_IMAGE_BRIDGE_TOKEN_FILE || local.bridgeTokenFile;
    if (typeof tokenFile !== 'string' || !tokenFile || statSync(tokenFile).size > 4096) return { ...config, enabled: false, reason: 'provider-unconfigured' };
    const token = readFileSync(tokenFile, 'utf8').trim();
    return { ...config, bridge: { url: env.GAME_IMAGE_BRIDGE_URL || local.bridgeUrl || 'http://127.0.0.1:8794/v1/images/edits', token } };
  } catch { return { enabled: false, dailyBudget: 0, reason: 'invalid-config' }; }
}
