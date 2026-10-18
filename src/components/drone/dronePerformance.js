// Performance is a renderer policy, never a change to the shared choreography
// or aircraft identities. The DOM UI is not scaled with the WebGL buffer.
const renderRatios = new WeakMap();

export function setSceneRenderRatio(renderer, ratio) {
  if (ratio === null) renderRatios.delete(renderer);
  else if (Number.isFinite(ratio) && ratio > 0) renderRatios.set(renderer, ratio);
}

export function getSceneRenderRatio(renderer) {
  return renderRatios.get(renderer) ?? renderer.getPixelRatio();
}

export function sceneRenderProfile({ mode = 'town', width = 1280, pixelRatio = 1, stage = 0, maxSamples = 4 } = {}) {
  const drone = mode === 'drone';
  const mobile = width < 700;
  const tier = Math.min(drone ? 2 : 1, Math.max(0, Math.floor(stage)));
  const cap = mobile || tier ? 1.25 : 1.5;
  // Scale the effective starting resolution, not just a device-DPR cap: on a
  // DPR=1 screen, changing a cap from 1.25 to 1 previously did no work at all.
  const initialRatio = Math.min(Math.max(.65, pixelRatio), 1.25);
  const droneRatio = tier === 0 ? initialRatio
    : tier === 1 ? Math.max(initialRatio * .85, .65 + (initialRatio - .65) * .25)
      : Math.max(.65, initialRatio * .72);
  return {
    pixelRatio: drone ? droneRatio : Math.min(Math.max(0.5, pixelRatio), cap),
    samples: Math.min(drone ? 2 : 4, Math.max(0, maxSamples)),
    ao: !drone && !mobile && tier === 0,
    bloom: true,
    quality: drone ? ['drone-cinematic', 'drone-balanced', 'drone-fluid'][tier] : !mobile && tier === 0 ? 'high' : 'balanced',
  };
}

export function createFrameBudget(mode = 'town') {
  return { mode, stage: 0, warmup: 0, elapsed: 0, frames: 0, slowWindows: 0 };
}

/** Require sustained slow windows. A tab wake, a seek or shader compilation
 * spike cannot on its own permanently lower quality. No per-frame allocation. */
export function sampleFrameBudget(state, delta, hidden = false) {
  if (hidden || !Number.isFinite(delta) || delta <= 0 || delta > 1) return null;
  const drone = state.mode === 'drone';
  state.warmup += delta;
  if (state.warmup < (drone ? 3 : 6)) return null;
  state.elapsed += delta;
  state.frames++;
  if (state.elapsed < (drone ? 1.5 : 2)) return null;
  const fps = state.frames / state.elapsed;
  const threshold = drone ? (state.stage ? 35 : 42) : 28;
  state.slowWindows = fps < threshold ? state.slowWindows + 1 : 0;
  const changed = state.slowWindows >= 2 && state.stage < (drone ? 2 : 1);
  if (changed) { state.stage++; state.slowWindows = 0; }
  state.elapsed = 0;
  state.frames = 0;
  return { fps, changed, stage: state.stage };
}

/** A paused fleet is immutable, except for reduced-motion or FPV-seat changes.
 * Cache only the last sample; seeking backwards always recomputes exact data. */
export function createFleetUpdateGate() {
  let time = NaN, reduced = null, seat = undefined;
  return (nextTime, nextReduced, nextSeat) => {
    if (time === nextTime && reduced === nextReduced && seat === nextSeat) return false;
    time = nextTime; reduced = nextReduced; seat = nextSeat;
    return true;
  };
}
