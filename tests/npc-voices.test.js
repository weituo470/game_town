import test from 'node:test';
import assert from 'node:assert/strict';
import { NPCS } from '../src/lib/npcCatalog.js';
import { getNpcVoice, getNpcVoiceKind, NPC_VOICE_ASSIGNMENTS, NPC_VOICE_PROFILES, NPC_VOICE_RESOURCE, npcVoiceFingerprint } from '../server/npcVoices.js';

test('all 16 residents have an explicit speech or animal casting, never an implicit female default', () => {
  assert.deepEqual(Object.keys(NPC_VOICE_ASSIGNMENTS).sort(), NPCS.map(npc => npc.id).sort());
  assert.equal(Object.values(NPC_VOICE_ASSIGNMENTS).filter(assignment => assignment.kind === 'speech').length, 12);
  assert.equal(Object.values(NPC_VOICE_ASSIGNMENTS).filter(assignment => assignment.kind === 'animal').length, 4);
  for (const npcId of ['npc-ali', 'npc-beidong', 'npc-lanyue', 'npc-miaomu', 'npc-dengcheng', 'npc-alan']) {
    assert.equal(NPC_VOICE_ASSIGNMENTS[npcId].voiceGender, 'male'); assert.match(getNpcVoice(npcId).speaker, /^zh_male_/);
  }
  for (const npcId of ['npc-huaya', 'npc-nuannuan', 'npc-lanjian', 'npc-chengsu', 'npc-yubai', 'npc-xiaotai']) {
    assert.equal(NPC_VOICE_ASSIGNMENTS[npcId].voiceGender, 'female'); assert.match(getNpcVoice(npcId).speaker, /^zh_female_/);
  }
  for (const npcId of ['npc-juya', 'npc-lituan', 'npc-maipao', 'npc-rongrong']) { assert.equal(getNpcVoiceKind(npcId), 'animal'); assert.equal(getNpcVoice(npcId), null); }
});
test('approved 2.0 whitelist and mappings are immutable and unknown/prototype IDs never resolve', () => {
  assert.deepEqual(Object.values(NPC_VOICE_PROFILES).map(voice => voice.speaker).sort(), ['zh_female_xiaohe_uranus_bigtts', 'zh_female_shuangkuaisisi_uranus_bigtts', 'zh_male_m191_uranus_bigtts', 'zh_male_tiancaitongsheng_uranus_bigtts', 'zh_female_mengyatou_uranus_bigtts', 'ICL_uranus_zh_female_heainainai_tob'].sort());
  assert.equal(NPC_VOICE_RESOURCE, 'seed-tts-2.0');
  assert.ok(Object.isFrozen(NPC_VOICE_ASSIGNMENTS));
  for (const assignment of Object.values(NPC_VOICE_ASSIGNMENTS)) assert.ok(Object.isFrozen(assignment));
  for (const voice of Object.values(NPC_VOICE_PROFILES)) { assert.ok(Object.isFrozen(voice)); assert.ok(Object.isFrozen(voice.audioParams)); assert.equal(voice.resourceId, NPC_VOICE_RESOURCE); }
  for (const id of ['constructor', '__proto__', 'npc-missing', '', undefined, null]) { assert.equal(getNpcVoice(id), null); assert.equal(getNpcVoiceKind(id), null); }
  assert.equal(getNpcVoice('npc-lanjian').audioParams.speech_rate, -15);
  assert.equal(getNpcVoice('npc-chengsu').audioParams.speech_rate, -5);
  assert.equal(getNpcVoice('npc-ali').audioParams.speech_rate, -15);
  assert.equal(getNpcVoice('npc-lanyue').audioParams.speech_rate, 0);
});
test('cache identity includes speaker, resource and every audio parameter in addition to reply', () => {
  const voice = getNpcVoice('npc-lanjian'), baseline = npcVoiceFingerprint(voice, '你好');
  assert.equal(npcVoiceFingerprint(voice, '你好'), baseline);
  assert.notEqual(npcVoiceFingerprint({ ...voice, speaker: 'different' }, '你好'), baseline);
  assert.notEqual(npcVoiceFingerprint({ ...voice, resourceId: 'different' }, '你好'), baseline);
  assert.notEqual(npcVoiceFingerprint(voice, '你好呀'), baseline);
  for (const key of ['format', 'sample_rate', 'speech_rate', 'loudness_rate', 'pitch_rate']) assert.notEqual(npcVoiceFingerprint({ ...voice, audioParams: { ...voice.audioParams, [key]: 'changed' } }, '你好'), baseline);
});
