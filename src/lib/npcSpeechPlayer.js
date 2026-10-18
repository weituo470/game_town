// One player and one most-recent Blob, never an unbounded per-resident audio cache.
// Object URLs live only while an audio element is in use; a blocked autoplay keeps
// the Blob, so the next user click does not repeat a paid generation request.
export function createNpcSpeechPlayer({
  loadSpeech,
  audioFactory = url => new Audio(url),
  createURL = blob => URL.createObjectURL(blob),
  revokeURL = url => URL.revokeObjectURL(url),
  onState = () => {},
} = {}) {
  let sequence = 0, disposed = false, controller = null, live = null, cached = null;
  const emit = state => { if (!disposed) onState(state); };
  function releaseAudio() {
    if (!live) return;
    const { audio, url, ended, error } = live;
    live = null;
    audio.removeEventListener('ended', ended);
    audio.removeEventListener('error', error);
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    revokeURL(url);
  }
  function stop() {
    sequence += 1;
    controller?.abort();
    controller = null;
    releaseAudio();
    emit({ messageId: null, status: 'idle', error: '' });
  }
  async function play(source) {
    if (disposed) return;
    stop();
    const current = sequence;
    const messageId = source.id;
    const greeting = source.kind === 'greeting';
    const key = greeting ? `${source.npcId}:fixed-greeting` : `${source.npcId}:${source.conversationId}:${source.requestId}`;
    const abortController = new AbortController();
    controller = abortController;
    emit({ messageId, status: 'loading', error: '' });
    const finish = (status, error = '') => {
      if (current !== sequence || disposed) return;
      sequence += 1;
      controller = null;
      releaseAudio();
      emit({ messageId, status, error });
    };
    try {
      let blob = cached?.key === key ? cached.blob : null;
      if (!blob) {
        blob = await loadSpeech(greeting ? { npcId: source.npcId, kind: 'greeting' } : { npcId: source.npcId, conversationId: source.conversationId, requestId: source.requestId }, { signal: abortController.signal });
        if (current !== sequence || disposed || abortController.signal.aborted) return;
        cached = { key, blob };
      }
      const url = createURL(blob);
      let audio;
      try { audio = audioFactory(url); }
      catch (error) { revokeURL(url); throw error; }
      const ended = () => finish('idle');
      const error = () => finish('error', '这段语音暂时无法播放，请再次点击播放。');
      live = { audio, url, ended, error };
      audio.addEventListener('ended', ended);
      audio.addEventListener('error', error);
      await audio.play();
      if (current !== sequence || disposed || abortController.signal.aborted) return;
      controller = null;
      emit({ messageId, status: 'playing', error: '' });
    } catch (error) {
      if (current !== sequence || disposed || abortController.signal.aborted || error?.name === 'AbortError') return;
      if (error?.name === 'NotAllowedError') finish('blocked', '语音已准备好；浏览器需要你点击“播放语音”后才能播报。');
      else finish('error', error?.name === 'NpcChatError' ? error.message : '语音暂时无法播放，请稍后再点击播放。');
    }
  }
  return {
    play, stop,
    dispose() { stop(); cached = null; disposed = true; },
  };
}
