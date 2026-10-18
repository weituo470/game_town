import { appUrl } from './appUrl.js';

// Public, licensed cues only: user input can select an NPC, never an audio URL.
export const NPC_ANIMAL_CUES = Object.freeze({
  'npc-juya': Object.freeze({ path: '/audio/npcs/cat-meow.mp3', label: '猫叫' }),
  'npc-maipao': Object.freeze({ path: '/audio/npcs/dog-bark.mp3', label: '狗叫' }),
  'npc-lituan': Object.freeze({ path: '/audio/npcs/red-panda-call.mp3', label: '小熊猫叫声' }),
  'npc-rongrong': Object.freeze({ path: '/audio/npcs/rabbit-call.mp3', label: '兔叫' }),
});

export function getNpcAnimalCue(npcId) {
  return typeof npcId === 'string' && Object.hasOwn(NPC_ANIMAL_CUES, npcId) ? NPC_ANIMAL_CUES[npcId] : null;
}

export function createNpcAnimalPlayer({ audioFactory = url => new Audio(url), resolveUrl = appUrl } = {}) {
  let sequence = 0, live = null, disposed = false;
  let state = { npcId: null, status: 'idle', error: '' };
  const listeners = new Set();
  const emit = next => { state = next; if (!disposed) for (const listener of listeners) listener(state); };
  function release() {
    if (!live) return;
    const { audio, ended, error } = live;
    live = null;
    audio.removeEventListener('ended', ended);
    audio.removeEventListener('error', error);
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  function stop() {
    sequence += 1;
    release();
    emit({ npcId: null, status: 'idle', error: '' });
  }
  // Call directly inside the click/F-key handler: no status fetch, LLM request,
  // reply identifier or await may precede play(), preserving user activation.
  function play(npcId) {
    if (disposed) return Promise.resolve(false);
    stop();
    const cue = getNpcAnimalCue(npcId);
    if (!cue) return Promise.resolve(false);
    const current = sequence;
    const finish = (status, error = '') => {
      if (disposed || current !== sequence) return;
      sequence += 1;
      release();
      emit({ npcId, status, error });
    };
    const failed = error => {
      if (error?.name === 'NotAllowedError') finish('blocked', '浏览器暂未允许声音，请再点一次“打个招呼”。');
      else finish('error', '叫声暂时无法播放，请稍后再打个招呼。');
      return false;
    };
    emit({ npcId, status: 'loading', error: '' });
    try {
      const audio = audioFactory(resolveUrl(cue.path));
      const ended = () => finish('ended');
      const error = () => finish('error', '叫声暂时无法播放，请稍后再打个招呼。');
      live = { audio, ended, error };
      audio.addEventListener('ended', ended);
      audio.addEventListener('error', error);
      return Promise.resolve(audio.play()).then(() => {
        if (disposed || current !== sequence) return false;
        emit({ npcId, status: 'playing', error: '' });
        return true;
      }, failed);
    } catch (error) { return Promise.resolve(failed(error)); }
  }
  return {
    play, stop,
    getState: () => state,
    subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    dispose() { stop(); disposed = true; listeners.clear(); },
  };
}
