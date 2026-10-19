import { appUrl } from './appUrl.js';

/** One media element, driven by the show's absolute clock; never its own timer. */
export function createDroneSoundtrack({ url, timeRef, getState, onStatus = () => {},
  createAudio = () => new Audio(), document: doc = globalThis.document,
  fetchAudio = (...args) => fetch(...args), URLApi = globalThis.URL,
  requestFrame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id),
}) {
  const audio = createAudio();
  audio.preload = 'auto'; audio.loop = false; audio.volume = .78;
  const sourceUrl = appUrl(url);
  let disposed = false, enabled = true, blocked = false, atEnd = false, frame = null, pending = null, generation = 0, status = '';
  let objectUrl = null, loading = null, download = null;
  const report = (next, message = '') => { if (!disposed && status !== `${next}:${message}`) { status = `${next}:${message}`; onStatus({ status: next, message }); } };
  const desired = () => { const state = getState(); return enabled && !blocked && !disposed && !atEnd && state.active && !state.paused && !state.ended && !doc?.hidden; };
  const halt = () => { generation++; audio.pause(); };
  const play = () => {
    if (!objectUrl || pending || !audio.paused || !desired()) return;
    const token = generation;
    report('starting');
    pending = Promise.resolve().then(() => {
      if (disposed || token !== generation || !desired()) return;
      return audio.play();
    }).then(() => {
      if (disposed) return;
      if (token !== generation || !desired()) { audio.pause(); return; }
      report('on');
    }, error => {
      if (disposed || token !== generation || !enabled) return;
      blocked = true; audio.pause();
      report('blocked', error?.name === 'NotAllowedError' ? '浏览器需要一次点击，请开启配乐。' : '配乐暂未播放，请点击重试；画面不受影响。');
    }).finally(() => { pending = null; });
  };
  const sync = () => {
    if (disposed || !objectUrl) return;
    const state = getState();
    const current = timeRef?.current;
    const seconds = Math.max(0, (Number.isFinite(current) ? current : state.elapsedMs || 0) / 1000);
    atEnd = Number.isFinite(audio.duration) && seconds >= audio.duration;
    const speed = state.speed === 2 ? 2 : 1;
    if (audio.playbackRate !== speed) audio.playbackRate = speed;
    // The same-origin MP3 is fully buffered into a local Blob first. This makes
    // seeking reliable even when production serves HTTP 200 without Range.
    if (audio.readyState >= 1 && Math.abs((audio.currentTime || 0) - seconds) > .12) { try { audio.currentTime = Math.min(seconds, Number.isFinite(audio.duration) ? audio.duration : seconds); } catch { /* retry after metadata */ } }
    if (!desired()) { if (!audio.paused || pending) halt(); return; }
    play();
  };
  const tick = () => { frame = null; if (disposed) return; sync(); frame = requestFrame(tick); };
  const visibility = () => { if (doc?.hidden) halt(); sync(); };
  const clearSource = () => {
    audio.removeAttribute?.('src'); audio.load?.();
    if (objectUrl) URLApi.revokeObjectURL(objectUrl);
    objectUrl = null;
  };
  const failed = () => { blocked = true; halt(); clearSource(); if (enabled) report('blocked', '配乐载入失败，请点击重试；画面不受影响。'); };
  const loadSource = () => {
    if (disposed || objectUrl || loading) return;
    download = new AbortController();
    const signal = download.signal;
    if (enabled) report('starting');
    loading = Promise.resolve().then(() => disposed || signal.aborted ? null : fetchAudio(sourceUrl, { signal, credentials: 'same-origin' })).then(async response => {
      if (!response || disposed || signal.aborted) return;
      if (!response.ok) throw new Error('Audio download failed');
      const blob = await response.blob();
      if (disposed || signal.aborted) return;
      if (!blob.size) throw new Error('Empty audio file');
      objectUrl = URLApi.createObjectURL(blob);
      audio.src = objectUrl; audio.load();
      if (enabled) report('on');
      sync();
    }).catch(() => {
      if (disposed || signal.aborted) return;
      blocked = true;
      if (enabled) report('blocked', '配乐下载失败，请点击重试；画面不受影响。');
    }).finally(() => { loading = null; });
  };
  audio.addEventListener?.('error', failed);
  audio.addEventListener?.('loadedmetadata', sync);
  audio.addEventListener?.('canplay', sync);
  doc?.addEventListener?.('visibilitychange', visibility);
  loadSource(); frame = requestFrame(tick);
  return {
    sync,
    setEnabled(value) {
      if (disposed) return;
      enabled = Boolean(value); blocked = false; generation++;
      if (!enabled) { audio.pause(); report('off'); }
      else { report(objectUrl ? 'on' : 'starting'); if (!objectUrl) loadSource(); else sync(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation++; audio.pause();
      download?.abort();
      if (frame !== null) cancelFrame(frame);
      doc?.removeEventListener?.('visibilitychange', visibility);
      audio.removeEventListener?.('error', failed);
      audio.removeEventListener?.('loadedmetadata', sync);
      audio.removeEventListener?.('canplay', sync);
      clearSource();
    },
  };
}
