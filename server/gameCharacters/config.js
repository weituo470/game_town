import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_GAME_CHARACTER_CONFIG = fileURLToPath(new URL('../../game-characters.local.json', import.meta.url));
export const CHARACTER_MODEL = 'meshy-t2.5';
export const ESTIMATED_CHARACTER_CREDITS = 20; // 15 textured model + 5 rig; pricing must be rechecked before enabling.
const integer = (value, fallback, max) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Math.min(Number(value), max) : fallback;

export function loadGameCharacterConfig({ env = process.env, configPath = env.GAME_CHARACTER_CONFIG || DEFAULT_GAME_CHARACTER_CONFIG } = {}) {
  try {
    const local = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
    const config = {
      enabled: (env.GAME_CHARACTER_ENABLED ?? String(local.enabled ?? false)) === 'true',
      totalBudget: integer(env.GAME_CHARACTER_TOTAL_BUDGET ?? local.totalBudget, 0, 50),
      creditBudget: integer(env.GAME_CHARACTER_CREDIT_BUDGET ?? local.creditBudget, 0, 1000),
      estimatedCreditsPerCharacter: ESTIMATED_CHARACTER_CREDITS,
      model: CHARACTER_MODEL,
      ...(env.GAME_CHARACTER_DB ? { dbPath: env.GAME_CHARACTER_DB } : {}),
    };
    let apiKey = env.MESHY_API_KEY;
    // Only the explicitly selected file and exact TTS-independent variable are read.
    // A configured key can support read-only recovery while admission is disabled.
    if (!apiKey && local.credentialEnvFile) {
      if (typeof local.credentialEnvFile !== 'string' || !isAbsolute(local.credentialEnvFile)) throw new Error();
      const info = statSync(local.credentialEnvFile);
      if (!info.isFile() || info.size > 64 * 1024) throw new Error();
      const lines = readFileSync(local.credentialEnvFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
      const matches = lines.map(line => line.match(/^\s*(?:export\s+)?MESHY_API_KEY\s*=\s*(.*?)\s*$/)).filter(Boolean);
      if (matches.length !== 1) throw new Error();
      apiKey = matches[0][1];
      if (/^(["']).*\1$/.test(apiKey)) apiKey = apiKey.slice(1, -1);
    }
    if (!apiKey) return { ...config, enabled: false, reason: 'provider-unconfigured' };
    if (typeof apiKey !== 'string' || apiKey.length < 16 || apiKey.length > 2048 || /[\s\u0000-\u001f]/.test(apiKey)) throw new Error();
    if (config.totalBudget === 0 || config.creditBudget < ESTIMATED_CHARACTER_CREDITS) return { ...config, enabled: false, reason: 'budget-not-authorized', apiKey };
    return { ...config, apiKey, ...(!config.enabled ? { reason: 'disabled' } : {}) };
  } catch { return { enabled: false, totalBudget: 0, creditBudget: 0, estimatedCreditsPerCharacter: ESTIMATED_CHARACTER_CREDITS, reason: 'invalid-config' }; }
}
