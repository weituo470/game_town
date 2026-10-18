import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadNpcLlmConfig } from '../server/npcLlmConfig.js';

test('NPC provider config is explicit and fails closed without disclosing file contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'npc-config-'));
  try {
    const configPath = join(dir, 'local.json');
    assert.equal(loadNpcLlmConfig({ env: {}, configPath }).enabled, false);
    writeFileSync(configPath, 'not JSON, private data');
    const invalid = loadNpcLlmConfig({ env: {}, configPath });
    assert.equal(invalid.reason, 'invalid-config');
    assert.doesNotMatch(JSON.stringify(invalid), /private data/);
    const router = join(dir, 'router.json');
    writeFileSync(router, JSON.stringify({providers:[{id:'flash',model:'deepseek-flash',baseURL:'https://api.deepseek.com/v1',apiKey:'fake-test-secret'}]}));
    writeFileSync(configPath, JSON.stringify({routerConfigFile:router,providerId:'flash'}));
    const loaded = loadNpcLlmConfig({ env: {}, configPath });
    assert.equal(loaded.enabled,true); assert.equal(loaded.apiKey,'fake-test-secret');
    assert.equal(loaded.model,'deepseek-flash'); assert.equal(loaded.timeoutMs,20000);
    assert.equal(loadNpcLlmConfig({env:{NPC_LLM_ENABLED:'false'},configPath}).enabled,false);
  } finally { for (const file of ['local.json','router.json']) rmSync(join(dir,file),{force:true}); rmdirSync(dir); }
});

test('NPC configuration pins the requested official provider and never falls back', () => {
  const configPath = join(tmpdir(), 'no-npc-provider-config-file.json');
  for (const value of ['http://api.deepseek.com/v1','https://evil.invalid/v1','https://api.deepseek.com/v1?key=secret','https://user:secret@api.deepseek.com/v1','https://api.deepseek.com/v1/chat/completions']) {
    assert.equal(loadNpcLlmConfig({env:{NPC_LLM_API_KEY:'test',NPC_LLM_BASE_URL:value},configPath}).enabled,false,value);
  }
  assert.equal(loadNpcLlmConfig({env:{NPC_LLM_API_KEY:'test',NPC_LLM_MODEL:'different-model'},configPath}).enabled,false);
  assert.equal(loadNpcLlmConfig({env:{NPC_LLM_API_KEY:'bad\nheader'},configPath}).enabled,false);
  const config = loadNpcLlmConfig({env:{NPC_LLM_API_KEY:'test',NPC_LLM_TIMEOUT_MS:'999999',NPC_LLM_MAX_TOKENS:'99999'},configPath});
  assert.equal(config.timeoutMs,30000); assert.equal(config.maxTokens,512);
});
