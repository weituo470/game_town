import { getDroneProgram, sampleDroneProgram } from '../../shared/dronePrograms.js';

/** Read the same absolute clock as geometry, not the HUD's 250 ms snapshot. */
export function sampleDroneAudioFrame(timeRef, state = {}) {
  const program = getDroneProgram(state.program);
  const current = timeRef?.current;
  const time = Number.isFinite(current) ? current : Number.isFinite(state.elapsedMs) ? state.elapsedMs : 0;
  const elapsedMs = Math.min(program.duration, Math.max(0, time));
  const ended = elapsedMs >= program.duration;
  const chapters = program.chapters.filter(chapter => chapter.start < program.duration);
  const chapter = ended ? chapters.length - 1
    : Math.max(0, chapters.findIndex(item => elapsedMs >= item.start && elapsedMs < item.end));
  const sample = sampleDroneProgram(elapsedMs, program.id);
  return { ...state, elapsedMs, program: program.id, ended,
    active: Boolean(state.active), paused: Boolean(state.paused) || ended,
    chapter, energy: sample.energy };
}

/**
 * No React writes and no independent time accumulation. The audio owner keeps
 * opt-in/disposal responsibility; this scheduler only delivers exact samples.
 * sync() also applies pause/seek changes immediately, without awaiting a frame.
 * Inject frame functions and the clock for deterministic non-browser tests.
 */
export function createDroneAudioScheduler({
  timeRef, getState, update,
  requestFrame = callback => globalThis.requestAnimationFrame?.(callback),
  cancelFrame = id => globalThis.cancelAnimationFrame?.(id),
}) {
  let running = false, disposed = false, frameId = null, lastSample = null;
  const sync = () => {
    if (disposed || !running) return false;
    const sample = sampleDroneAudioFrame(timeRef, getState());
    const keys = ['elapsedMs', 'program', 'active', 'paused', 'reducedMotion', 'chapter', 'energy'];
    if (lastSample && keys.every(key => Object.is(lastSample[key], sample[key]))) return false;
    lastSample = sample;
    update(sample);
    return true;
  };
  const schedule = () => {
    if (!running || disposed || frameId !== null) return;
    frameId = requestFrame(() => {
      frameId = null;
      if (disposed || !running) return;
      sync();
      schedule();
    }) ?? null;
  };
  return {
    start() {
      if (disposed) return false;
      if (!running) { running = true; sync(); schedule(); }
      return true;
    },
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
    },
  };
}
