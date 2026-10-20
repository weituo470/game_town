import { loadNpcLlmConfig } from '../npcLlmConfig.js';
import { isArchitectPasswordHash } from './access.js';

export function loadArchitectConfig({ env = process.env, npcConfig } = {}) {
  const timeout = Number(env.ARCHITECT_TIMEOUT_MS);
  const base = { enabled: false, provider: 'DeepSeek', model: 'deepseek-flash',
    dbPath: env.ARCHITECT_DB || '.data/architect.sqlite',
    autonomousEnabled: env.ARCHITECT_AUTONOMOUS_ENABLED !== 'false',
    timeoutMs: Number.isSafeInteger(timeout) && timeout >= 1000 ? Math.min(45_000, timeout) : 45_000, maxTokens: 1500 };
  if (env.ARCHITECT_ENABLED !== 'true') return Object.freeze({ ...base, reason: 'disabled' });
  if (!isArchitectPasswordHash(env.ARCHITECT_APPROVAL_HASH))
    return Object.freeze({ ...base, reason: 'approval-not-configured' });
  const npc = npcConfig || loadNpcLlmConfig({ env });
  if (!npc.enabled) return Object.freeze({ ...base, reason: 'model-not-configured' });
  return Object.freeze({ ...base, enabled: true, apiKey: npc.apiKey, baseURL: npc.baseURL, model: npc.model,
    passwordHash: env.ARCHITECT_APPROVAL_HASH });
}
