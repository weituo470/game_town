import { DRONE_PROGRAMS, getDroneProgram, isAiDroneRuntime } from '../../shared/dronePrograms.js';

export const DEFAULT_DRONE_SHOW_DURATION = 150_000;

const defaultNow = () => globalThis.performance?.now?.() ?? 0;
const clampTime = (value, duration) => Number.isFinite(value) ? Math.min(duration, Math.max(0, value)) : 0;

/** Lazy monotonic clock. Encore is opt-in legacy compatibility, never public default. */
export function createDroneShowClock({ now = defaultNow, duration, allowEncore = false } = {}) {
  const customDuration = Number.isFinite(duration) && duration > 0 ? duration : null;
  let length = customDuration ?? getDroneProgram('avatar').duration;
  let lastNow = 0;
  const readNow = () => {
    const candidate = now();
    if (Number.isFinite(candidate)) lastNow = Math.max(lastNow, candidate);
    return lastNow;
  };
  let anchorNow = readNow();
  let anchorElapsed = 0;
  let active = false;
  let paused = true;
  let speed = 1;
  let view = 'cinematic';
  let reducedMotion = false;
  let program = 'avatar';
  let aiRuntime = null;
  const metadata = () => getDroneProgram(program, aiRuntime);
  let encoreFrom = null;
  let pendingEncore = false;
  const current = () => {
    const time = readNow();
    const wasPlaying = active && !paused && anchorElapsed < length;
    const elapsed = clampTime(anchorElapsed + (active && !paused ? (time - anchorNow) * speed : 0), length);
    if (elapsed >= length) {
      // Render-loop reads may notice completion before the UI's next poll.
      // Record that natural edge, but NEVER switch a programme from a read:
      // the currently committed scene still owns this sample until update().
      if (allowEncore === true && wasPlaying && program === 'droplet' && customDuration === null) pendingEncore = true;
      anchorElapsed = length;
      anchorNow = time;
      paused = true;
    }
    return elapsed;
  };
  const freeze = () => {
    anchorElapsed = current();
    anchorNow = readNow();
  };
  const snapshot = () => {
    const elapsedMs = current();
    return { active, elapsedMs, paused, speed, view, program, reducedMotion, encoreFrom, ended: elapsedMs >= length, ...(aiRuntime ? { aiRuntime } : {}) };
  };
  const enterEncore = () => {
    pendingEncore = false;
    program = 'blackhole';
    length = customDuration ?? getDroneProgram(program).duration;
    anchorElapsed = 0;
    anchorNow = readNow();
    encoreFrom = 'droplet';
    view = 'cinematic';
    paused = false;
    return snapshot();
  };
  const timeRef = Object.freeze({ get current() { return current(); } });
  return {
    timeRef,
    snapshot,
    update() {
      const state = snapshot();
      // Overshoot (including a long background-tab suspension) is discarded:
      // every viewer gets the entire encore from its first frame.
      return allowEncore === true && pendingEncore && active && program === 'droplet' && state.ended
        ? enterEncore() : state;
    },
    playEncore() {
      const state = snapshot();
      return allowEncore === true && active && program === 'droplet' && state.ended ? enterEncore() : state;
    },
    start(options = {}) {
      // Invalid new AI scores must not replace the last working performance.
      if (options.program === 'ai' && !isAiDroneRuntime(options.aiRuntime || aiRuntime)) return snapshot();
      pendingEncore = false;
      encoreFrom = null;
      if (options.program === 'ai') { aiRuntime = options.aiRuntime || aiRuntime; program = 'ai'; }
      else if (DRONE_PROGRAMS.some(item => item.id === options.program)) program = options.program;
      length = customDuration ?? metadata().duration;
      anchorNow = readNow();
      anchorElapsed = clampTime(options.elapsedMs ?? 0, length);
      speed = options.speed === 2 ? 2 : 1;
      view = ['free', 'fpv'].includes(options.view) ? options.view : 'cinematic';
      if (!metadata().supportsFpv) view = 'cinematic';
      active = true;
      paused = anchorElapsed >= length;
      return snapshot();
    },
    close() {
      freeze();
      pendingEncore = false;
      active = false;
      paused = true;
      return snapshot();
    },
    togglePause() {
      freeze();
      pendingEncore = false;
      if (active && anchorElapsed < length) paused = !paused;
      return snapshot();
    },
    seek(value) {
      pendingEncore = false;
      const wasEnded = anchorElapsed >= length;
      anchorElapsed = clampTime(value, length);
      anchorNow = readNow();
      // Seeking back from a completed show starts the chosen chapter; an
      // explicitly paused show otherwise remains paused while scrubbing.
      if (active && wasEnded && anchorElapsed < length) paused = false;
      if (anchorElapsed >= length) paused = true;
      return snapshot();
    },
    setSpeed(value) {
      freeze();
      if (value === 1 || value === 2) speed = value;
      return snapshot();
    },
    setView(value) {
      if (!metadata().supportsFpv && value !== 'cinematic') return snapshot();
      if (['cinematic', 'free', 'fpv'].includes(value)) view = value;
      return snapshot();
    },
    setProgram(value) {
      if (!(value === 'ai' && aiRuntime) && !DRONE_PROGRAMS.some(item => item.id === value)) return snapshot();
      if (value === program) {
        // A deliberate re-selection still does not restart. It does cancel an
        // uncommitted automatic hand-off, including one detected by this read.
        snapshot(); pendingEncore = false; encoreFrom = null;
        return snapshot();
      }
      pendingEncore = false;
      encoreFrom = null;
      program = value;
      length = customDuration ?? metadata().duration;
      anchorElapsed = 0;
      anchorNow = readNow();
      paused = !active;
      view = 'cinematic';
      return snapshot();
    },
    setReducedMotion(value) {
      reducedMotion = Boolean(value);
      return snapshot();
    },
  };
}
