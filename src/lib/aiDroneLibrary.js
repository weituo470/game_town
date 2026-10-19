import { validateAiDroneScore } from '../../shared/aiDroneScore.js';

export const AI_DRONE_LIBRARY_KEY = 'game-town.ai-drone.library.v1';
export const AI_DRONE_LIBRARY_LIMIT = 5;
const MAX_STORAGE_CHARS = 200 * 1024;
const localStorageOrNull = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const timestamp = value => Number.isSafeInteger(value) && value > 0;

// Explicit field selection: tokens, provider settings and response objects must
// never be serialized into the local show library.
function cleanEntry(value, savedAt = value?.savedAt) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.id)
    || !timestamp(value.createdAt) || !timestamp(savedAt) || !['prompt', 'improv'].includes(value.mode)) throw new Error('INVALID_ENTRY');
  return Object.freeze({ id: value.id, createdAt: value.createdAt, savedAt, mode: value.mode, score: validateAiDroneScore(value.score) });
}

export function createAiDroneLibrary({ storage = localStorageOrNull(), now = Date.now } = {}) {
  function read() {
    if (!storage) return { entries: [], available: false, corrupt: false };
    let raw;
    try { raw = storage.getItem(AI_DRONE_LIBRARY_KEY); } catch { return { entries: [], available: false, corrupt: false }; }
    try {
      if (!raw) return { entries: [], available: true, corrupt: false };
      if (raw.length > MAX_STORAGE_CHARS) return { entries: [], available: true, corrupt: true };
      const data = JSON.parse(raw);
      if (data?.version !== 1 || !Array.isArray(data.entries) || data.entries.length > AI_DRONE_LIBRARY_LIMIT) return { entries: [], available: true, corrupt: true };
      const entries = [];
      let corrupt = false;
      for (const value of data.entries) {
        try {
          const entry = cleanEntry(value);
          if (entries.some(item => item.id === entry.id)) { corrupt = true; continue; }
          entries.push(entry);
        } catch { corrupt = true; }
      }
      entries.sort((a, b) => b.savedAt - a.savedAt);
      return { entries, available: true, corrupt };
    } catch { return { entries: [], available: true, corrupt: true }; }
  }

  function write(entries) {
    if (!storage) return { entries: [], available: false, corrupt: false, ok: false };
    try {
      const raw = JSON.stringify({ version: 1, entries });
      if (raw.length > MAX_STORAGE_CHARS) throw new Error('TOO_LARGE');
      storage.setItem(AI_DRONE_LIBRARY_KEY, raw);
      return { entries, available: true, corrupt: false, ok: true };
    } catch { return { ...read(), ok: false }; }
  }

  return {
    read,
    save(show) {
      try {
        const entry = cleanEntry(show, now());
        const current = read();
        const entries = [entry, ...current.entries.filter(item => item.id !== entry.id)].slice(0, AI_DRONE_LIBRARY_LIMIT);
        return write(entries);
      } catch { return { ...read(), ok: false }; }
    },
    remove(id) {
      const current = read();
      return write(current.entries.filter(entry => entry.id !== id));
    },
  };
}
