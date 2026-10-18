import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';

export const DEFAULT_NPC_TTS_CONFIG_PATH = fileURLToPath(new URL('../npc-tts.local.json', import.meta.url));
const ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
const CREDENTIAL_FIELDS = new Set(['DOUBAO_TTS_API_KEY', 'VOLCENGINE_TTS_API_KEY', 'TTS_DOUBAO_API_KEY']);
const disabled = reason => Object.freeze({ enabled: false, provider: 'Doubao', reason });
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,160}$/.test(value);

// Read one explicitly selected TTS field, never execute/source a shared env file.
// No generic credential search and no automatic reuse of an ASR credential.
function readCredential(path, field) {
  if (typeof path !== 'string' || !isAbsolute(path) || !CREDENTIAL_FIELDS.has(field) || statSync(path).size > 1024 * 1024) throw new Error('Invalid credential reference');
  const source = readFileSync(path, 'utf8');
  const matches = source.split(/\r?\n/).map(line => line.replace(/^\uFEFF/, '').trim()).filter(line => line.startsWith(`${field}=`) || line.startsWith(`export ${field}=`));
  if (matches.length !== 1) throw new Error('Missing or ambiguous credential field');
  let value = matches[0].slice(matches[0].indexOf('=') + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value;
}

export function loadNpcTtsConfig({ env = process.env, configPath = env.NPC_TTS_CONFIG || DEFAULT_NPC_TTS_CONFIG_PATH } = {}) {
  if (env.NPC_TTS_ENABLED === 'false') return disabled('disabled');
  try {
    const local = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
    const apiKey = env.NPC_TTS_API_KEY || (local.credentialEnvFile ? readCredential(local.credentialEnvFile, local.apiKeyEnv) : undefined);
    if (!apiKey) return disabled('not-configured');
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 2048 || /[\r\n]/.test(apiKey)) return disabled('invalid-config');
    const endpoint = env.NPC_TTS_ENDPOINT || local.endpoint || ENDPOINT;
    if (endpoint !== ENDPOINT) return disabled('invalid-config');
    const speaker = env.NPC_TTS_SPEAKER || local.speaker || 'zh_female_shuangkuaisisi_uranus_bigtts';
    const resourceId = env.NPC_TTS_RESOURCE_ID || local.resourceId || 'seed-tts-2.0';
    if (!identifier(speaker) || !identifier(resourceId)) return disabled('invalid-config');
    const requestedTimeout = Number(env.NPC_TTS_TIMEOUT_MS ?? local.timeoutMs ?? 30000);
    return Object.freeze({ enabled: true, provider: 'Doubao', apiKey: apiKey.trim(), endpoint, resourceId, speaker, timeoutMs: Number.isFinite(requestedTimeout) ? Math.max(1000, Math.min(30000, Math.trunc(requestedTimeout))) : 30000 });
  } catch { return disabled('invalid-config'); }
}
