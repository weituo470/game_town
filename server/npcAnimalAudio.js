import { readFileSync, statSync } from 'node:fs';

// Fixed, licensed local effects only. An animal response is a short vocal cue,
// never a claim that the chat text has been spoken in an animal language.
const EFFECTS = Object.freeze({
  'npc-juya': Object.freeze({ file: 'cat-meow.mp3', label: '猫叫回应 · 非逐字朗读' }),
  'npc-maipao': Object.freeze({ file: 'dog-bark.mp3', label: '犬吠回应 · 非逐字朗读' }),
  'npc-lituan': Object.freeze({ file: 'red-panda-call.mp3', label: '小熊猫叫声回应 · 非逐字朗读' }),
  'npc-rongrong': Object.freeze({ file: 'rabbit-call.mp3', label: '兔叫回应 · 非逐字朗读' }),
});
const MAX_AUDIO_BYTES = 256 * 1024;
const cache = new Map();

export function getNpcAnimalVoice(npcId) {
  if (!Object.hasOwn(EFFECTS, npcId)) return null;
  const effect = EFFECTS[npcId];
  try {
    const path = new URL(`../public/audio/npcs/${effect.file}`, import.meta.url);
    const info = statSync(path);
    if (!info.isFile() || info.size < 256 || info.size > MAX_AUDIO_BYTES) return null;
    let entry = cache.get(npcId);
    if (!entry || entry.mtime !== info.mtimeMs || entry.size !== info.size) {
      entry = { mtime: info.mtimeMs, size: info.size, audio: readFileSync(path) };
      cache.set(npcId, entry);
    }
    return { label: effect.label, audio: Buffer.from(entry.audio) };
  } catch { return null; }
}
