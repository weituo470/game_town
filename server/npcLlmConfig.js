import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_NPC_CONFIG_PATH = fileURLToPath(new URL('../npc-llm.local.json', import.meta.url));
const disabled = reason => Object.freeze({ enabled: false, provider: 'DeepSeek', model: 'deepseek-flash', reason });
const integer = (value, fallback, min, max) => Number.isInteger(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;

// Explicit server-only credential reference: no browser key, credential-folder
// search, model fallback, or silent changes to the source router configuration.
export function loadNpcLlmConfig({ env = process.env, configPath = env.NPC_LLM_CONFIG || DEFAULT_NPC_CONFIG_PATH } = {}) {
  if (env.NPC_LLM_ENABLED === 'false') return disabled('disabled');
  try {
    const local = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
    let provider = {};
    if (!env.NPC_LLM_API_KEY && local.routerConfigFile) {
      const router = JSON.parse(readFileSync(local.routerConfigFile, 'utf8'));
      provider = router.providers?.find(item => item.id === (local.providerId || 'flash')) || {};
    }
    const apiKey = env.NPC_LLM_API_KEY || provider.apiKey;
    if (!apiKey) return disabled('not-configured');
    if (typeof apiKey !== 'string' || apiKey.length > 1024 || /[\r\n]/.test(apiKey) || !apiKey.trim()) return disabled('invalid-config');
    const model = env.NPC_LLM_MODEL || provider.model || 'deepseek-flash';
    if (model !== 'deepseek-flash') return disabled('invalid-config');
    const url = new URL(env.NPC_LLM_BASE_URL || provider.baseURL || 'https://api.deepseek.com/v1');
    if (url.origin !== 'https://api.deepseek.com' || !['', '/', '/v1', '/v1/'].includes(url.pathname) || url.username || url.password || url.search || url.hash) return disabled('invalid-config');
    return Object.freeze({
      enabled: true, provider: 'DeepSeek', model, apiKey: apiKey.trim(), baseURL: url.href.replace(/\/+$/, ''),
      timeoutMs: integer(env.NPC_LLM_TIMEOUT_MS ?? local.timeoutMs, 20_000, 1000, 30_000),
      maxTokens: integer(env.NPC_LLM_MAX_TOKENS ?? local.maxTokens, 320, 64, 512),
    });
  } catch { return disabled('invalid-config'); }
}
