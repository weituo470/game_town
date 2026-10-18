import { GPT_DESIGNS } from './designs.js';

export const GPT_ROUND_MS = 18000;

/** An unknown design first falls back to A, so its next design is B. */
export function nextGptDesign(id) {
  const index = Math.max(0, GPT_DESIGNS.findIndex(design => design.id === id));
  return GPT_DESIGNS[(index + 1) % GPT_DESIGNS.length].id;
}

/** Pure active-view countdown. No wall clock, browser state or side effects. */
export function advanceRotation(remainingMs, deltaMs, options = {}) {
  const { enabled = true, paused = false, hidden = false, transitioning = false, ready = true } = options ?? {};
  // Invalid state starts a fresh round; an explicit zero is an expired round.
  const remaining = Number.isFinite(remainingMs) && remainingMs >= 0
    ? Math.min(GPT_ROUND_MS, remainingMs)
    : GPT_ROUND_MS;
  if (!enabled || paused || hidden || transitioning || !ready) return { remainingMs: remaining, advance: false };
  const delta = Number.isFinite(deltaMs) ? Math.max(0, Math.min(1000, deltaMs)) : 0;
  const next = remaining - delta;
  // Discard overshoot: even a delayed frame can advance at most one candidate.
  return next <= 0
    ? { remainingMs: GPT_ROUND_MS, advance: true }
    : { remainingMs: next, advance: false };
}
