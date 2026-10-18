import { sampleDayNight } from './dayNight.js';

// A foreground-play-time clock. The host supplies frame deltas and whether
// ordinary town exploration is currently available; no wall clock is read.
export const AMBIENT_BLACK_HOLE = Object.freeze({
  firstWaitMinMs: 35000,
  firstWaitMaxMs: 65000,
  repeatWaitMinMs: 180000,
  repeatWaitMaxMs: 360000,
  durationMs: 90000,
  fadeInMs: 8000,
  fadeOutMs: 10000,
  maxDeltaMs: 1000,
});

const clamp01 = value => Math.min(1, Math.max(0, value));
const smoothstep = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };

/** Match the actual sky and preview clock, fading strictly inside its night. */
export function sampleAmbientBlackHoleNight(worldTimeMs = 0) {
  const sky = sampleDayNight(worldTimeMs);
  const eligible = sky.label === '夜晚';
  const solarElevation = Math.cos(sky.phase * Math.PI * 2);
  return { eligible, opacity: eligible ? smoothstep((-solarElevation - .30) / .18) : 0 };
}

/**
 * Deterministic with an injected random source and deltas. Waiting elapsed time
 * is intentionally not exposed: elapsedMs always belongs to the current event.
 * Disabled calls suppress visibility, but retain both wait and event progress.
 * Re-enabling resumes that progress, never catches up hidden/background time.
 */
export function createAmbientBlackHoleClock({ random = Math.random } = {}) {
  const sampleWait = (min, max) => {
    let sample;
    try { sample = typeof random === 'function' ? random() : .5; }
    catch { sample = .5; }
    const unit = Number.isFinite(sample) ? clamp01(sample) : .5;
    return min + (max - min) * unit;
  };
  let waitingMs = sampleWait(AMBIENT_BLACK_HOLE.firstWaitMinMs, AMBIENT_BLACK_HOLE.firstWaitMaxMs);
  let inEvent = false, elapsedMs = 0, eventId = 0;

  const snapshot = enabled => {
    const phase = !inEvent ? 'waiting'
      : elapsedMs < AMBIENT_BLACK_HOLE.fadeInMs ? 'appearing'
        : elapsedMs < AMBIENT_BLACK_HOLE.durationMs - AMBIENT_BLACK_HOLE.fadeOutMs ? 'holding'
          : 'fading';
    const opacity = !enabled || !inEvent ? 0
      : phase === 'appearing' ? smoothstep(elapsedMs / AMBIENT_BLACK_HOLE.fadeInMs)
        : phase === 'fading' ? smoothstep((AMBIENT_BLACK_HOLE.durationMs - elapsedMs) / AMBIENT_BLACK_HOLE.fadeOutMs)
          : 1;
    return {
      active: Boolean(enabled && inEvent), phase,
      elapsedMs: inEvent ? elapsedMs : 0,
      opacity, eventId, nextInMs: inEvent ? 0 : waitingMs,
    };
  };

  return Object.freeze({
    // Dawn terminates the sighting. It must not resume halfway next night.
    endEvent() {
      if (inEvent) {
        inEvent = false; elapsedMs = 0;
        waitingMs = sampleWait(AMBIENT_BLACK_HOLE.repeatWaitMinMs, AMBIENT_BLACK_HOLE.repeatWaitMaxMs);
      }
      return snapshot(false);
    },
    advance(deltaMs = 0, { enabled = true, allowStart = true } = {}) {
      if (!enabled) return snapshot(false);
      const delta = Number.isFinite(deltaMs) ? Math.min(AMBIENT_BLACK_HOLE.maxDeltaMs, Math.max(0, deltaMs)) : 0;
      if (inEvent) {
        elapsedMs += delta;
        if (elapsedMs >= AMBIENT_BLACK_HOLE.durationMs) {
          const remainder = elapsedMs - AMBIENT_BLACK_HOLE.durationMs;
          inEvent = false;
          elapsedMs = 0;
          waitingMs = sampleWait(AMBIENT_BLACK_HOLE.repeatWaitMinMs, AMBIENT_BLACK_HOLE.repeatWaitMaxMs) - remainder;
        }
      } else {
        waitingMs -= delta;
        if (!allowStart) waitingMs = Math.max(0, waitingMs);
        if (allowStart && waitingMs <= 0) {
          elapsedMs = Math.max(0, -waitingMs);
          waitingMs = 0;
          inEvent = true;
          eventId += 1;
        }
      }
      return snapshot(true);
    },
  });
}
