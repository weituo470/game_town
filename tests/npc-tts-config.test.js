import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadNpcTtsConfig } from '../server/npcTtsConfig.js';

test('TTS config reads only the explicit dedicated credential field and fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'npc-tts-config-'));
  const configPath = join(dir, 'local.json');
  const source = join(dir, 'private.env');
  try {
    assert.equal(loadNpcTtsConfig({ env: {}, configPath }).enabled, false);
    writeFileSync(source, '# ignored\nDOUBAO_ASR_API_KEY=not-selected\nDOUBAO_TTS_API_KEY="fake-dedicated-key"\nOTHER_SECRET=not-selected\n');
    writeFileSync(configPath, JSON.stringify({ credentialEnvFile: source, apiKeyEnv: 'DOUBAO_TTS_API_KEY' }));
    const config = loadNpcTtsConfig({ env: {}, configPath });
    assert.equal(config.enabled, true); assert.equal(config.apiKey, 'fake-dedicated-key');
    assert.equal(config.provider, 'Doubao'); assert.equal(config.timeoutMs, 30000);
    assert.equal(config.endpoint, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse');
    assert.equal(loadNpcTtsConfig({ env: { NPC_TTS_ENABLED: 'false' }, configPath }).enabled, false);
    writeFileSync(configPath, JSON.stringify({ credentialEnvFile: source, apiKeyEnv: 'DOUBAO_ASR_API_KEY' }));
    assert.equal(loadNpcTtsConfig({ env: {}, configPath }).reason, 'invalid-config');
    assert.equal(loadNpcTtsConfig({ env: { NPC_TTS_API_KEY: 'explicit-env-key' }, configPath }).apiKey, 'explicit-env-key');
    writeFileSync(configPath, 'invalid private contents');
    const disabled = loadNpcTtsConfig({ env: {}, configPath });
    assert.equal(disabled.enabled, false); assert.doesNotMatch(JSON.stringify(disabled), /private contents|fake-dedicated-key/);
  } finally { for (const file of [configPath, source]) rmSync(file, { force: true }); rmdirSync(dir); }
});

test('TTS config pins official HTTPS SSE endpoint, voice identifiers and safe headers', () => {
  const configPath = join(tmpdir(), 'no-npc-tts-config.json');
  for (const endpoint of ['http://openspeech.bytedance.com/api/v3/tts/unidirectional/sse', 'https://evil.invalid/tts', 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse?secret=x']) {
    assert.equal(loadNpcTtsConfig({ env: { NPC_TTS_API_KEY: 'test', NPC_TTS_ENDPOINT: endpoint }, configPath }).enabled, false);
  }
  assert.equal(loadNpcTtsConfig({ env: { NPC_TTS_API_KEY: 'bad\nheader' }, configPath }).enabled, false);
  assert.equal(loadNpcTtsConfig({ env: { NPC_TTS_API_KEY: 'test', NPC_TTS_SPEAKER: '../other' }, configPath }).enabled, false);
  assert.equal(loadNpcTtsConfig({ env: { NPC_TTS_API_KEY: 'test', NPC_TTS_TIMEOUT_MS: '999999' }, configPath }).timeoutMs, 30000);
});
