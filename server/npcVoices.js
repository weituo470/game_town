// Server-owned, explicitly approved Doubao 2.0 IDs. The author authorized visual
// casting of these fictional dolls; these are art-direction choices, not claims
// about real people's gender/age. Browser inputs never select a speaker.
export const NPC_VOICE_RESOURCE = 'seed-tts-2.0';
const profile = (speaker, label, speechRate) => Object.freeze({
  speaker, label, resourceId: NPC_VOICE_RESOURCE,
  audioParams: Object.freeze({ format: 'mp3', sample_rate: 24000, speech_rate: speechRate, loudness_rate: 0, pitch_rate: 0 }),
});

export const NPC_VOICE_PROFILES = Object.freeze({
  xiaohe: profile('zh_female_xiaohe_uranus_bigtts', '小何 2.0 · 温和', -15),
  sisi: profile('zh_female_shuangkuaisisi_uranus_bigtts', '爽快思思 2.0 · 爽朗', -5),
  yunzhou: profile('zh_male_m191_uranus_bigtts', '云舟 2.0', -10),
  boy: profile('zh_male_tiancaitongsheng_uranus_bigtts', '男孩 · 天才童声 2.0', -10),
  girl: profile('zh_female_mengyatou_uranus_bigtts', '女孩 · 萌丫头 2.0', -10),
  grandmother: profile('ICL_uranus_zh_female_heainainai_tob', '和蔼奶奶 2.0', -15),
});

const human = (voiceKey, voiceGender, ageFeel, speechRate) => Object.freeze({ kind: 'speech', voiceKey, voiceGender, ageFeel, speechRate });
const animal = Object.freeze({ kind: 'animal', voiceKey: null, voiceGender: null, ageFeel: null });
// Reviewed against public/npc/{id}.jpg and the authored personality.voice text.
// No elderly figure was present; the approved grandmother voice stays unused.
export const NPC_VOICE_ASSIGNMENTS = Object.freeze({
  'npc-ali': human('boy', 'male', '少年感，温和不催促', -15),
  'npc-huaya': human('girl', 'female', '少女感，轻快轻声', -5),
  'npc-nuannuan': human('xiaohe', 'female', '年轻温柔，不故作长辈', -20),
  'npc-beidong': human('yunzhou', 'male', '年轻稳重，简短朴实', -15),
  'npc-juya': animal,
  'npc-lituan': animal,
  'npc-lanyue': human('boy', 'male', '少年感，轻快活泼', 0),
  'npc-maipao': animal,
  'npc-lanjian': human('xiaohe', 'female', '年轻克制，有分寸', -15),
  'npc-chengsu': human('sisi', 'female', '年轻爽朗，生活感', -5),
  'npc-rongrong': animal,
  'npc-yubai': human('xiaohe', 'female', '年轻柔和，表达具体', -12),
  'npc-miaomu': human('boy', 'male', '少年感，朴实有节奏', -12),
  'npc-dengcheng': human('yunzhou', 'male', '年轻沉稳，简短不炫技', -18),
  'npc-xiaotai': human('girl', 'female', '少女感，平和好奇', -15),
  'npc-alan': human('boy', 'male', '少年感，明快友好', -3),
});

const resolved = Object.freeze(Object.fromEntries(Object.entries(NPC_VOICE_ASSIGNMENTS).map(([id, assignment]) => {
  const original = NPC_VOICE_PROFILES[assignment.voiceKey];
  return [id, original ? Object.freeze({ ...original, audioParams: Object.freeze({ ...original.audioParams, speech_rate: assignment.speechRate }) }) : null];
})));

export function getNpcVoice(npcId) {
  if (typeof npcId !== 'string' || !Object.hasOwn(NPC_VOICE_ASSIGNMENTS, npcId)) return null;
  return resolved[npcId];
}

export function getNpcVoiceKind(npcId) { return Object.hasOwn(NPC_VOICE_ASSIGNMENTS, npcId) ? NPC_VOICE_ASSIGNMENTS[npcId].kind : null; }

export function npcVoiceFingerprint(voice, text) {
  // Includes every synthesized audio parameter and resource version so a future
  // authored assignment change cannot replay the previous voice's cached audio.
  return JSON.stringify({ speaker: voice.speaker, resourceId: voice.resourceId, audioParams: voice.audioParams, text });
}
