/** One server-clock day: five minutes of daylight and ten minutes of night. */
export const DAY_DURATION_MS = 300_000;
export const NIGHT_DURATION_MS = 600_000;
export const DAY_NIGHT_CYCLE_MS = DAY_DURATION_MS + NIGHT_DURATION_MS;
export const NIGHT_START_MS = DAY_DURATION_MS / 2;
export const NIGHT_END_MS = NIGHT_START_MS + NIGHT_DURATION_MS;
export const MIDNIGHT_MS = DAY_NIGHT_CYCLE_MS / 2;
const EDGE_MS = 10_000;

/** Retain noon at zero and midnight at .5; twilight takes ten seconds per edge. */
export function solarPhaseAtTime(value = 0) {
  const time = Number.isFinite(value) ? ((value % DAY_NIGHT_CYCLE_MS) + DAY_NIGHT_CYCLE_MS) % DAY_NIGHT_CYCLE_MS : 0;
  if (time < NIGHT_START_MS) return .25 * time / NIGHT_START_MS;
  if (time < NIGHT_START_MS + EDGE_MS) return .25 + .07 * (time - NIGHT_START_MS) / EDGE_MS;
  if (time < NIGHT_END_MS - EDGE_MS) return .32 + .36 * (time - NIGHT_START_MS - EDGE_MS) / (NIGHT_DURATION_MS - EDGE_MS * 2);
  if (time < NIGHT_END_MS) return .68 + .07 * (time - NIGHT_END_MS + EDGE_MS) / EDGE_MS;
  return .75 + .25 * (time - NIGHT_END_MS) / (DAY_DURATION_MS / 2);
}

/** Inverse for deterministic previews, boundary tests and authoring tools. */
export function worldTimeAtSolarPhase(phase) {
  const p = Math.max(0, Math.min(1, Number.isFinite(phase) ? phase : 0));
  if (p < .25) return p / .25 * NIGHT_START_MS;
  if (p < .32) return NIGHT_START_MS + (p - .25) / .07 * EDGE_MS;
  if (p < .68) return NIGHT_START_MS + EDGE_MS + (p - .32) / .36 * (NIGHT_DURATION_MS - EDGE_MS * 2);
  if (p < .75) return NIGHT_END_MS - EDGE_MS + (p - .68) / .07 * EDGE_MS;
  return NIGHT_END_MS + (p - .75) / .25 * (DAY_DURATION_MS / 2);
}

const clamp = value => Math.max(0, Math.min(1, value));
const smoothstep = (low, high, value) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};

/** Phase 0 is noon; .25 sunset; .5 midnight; .75 sunrise. Safe for clock corrections. */
export function sampleDayNight(worldTimeMs = 0) {
  const time = Number.isFinite(worldTimeMs) ? worldTimeMs : 0;
  const phase = solarPhaseAtTime(time);
  const angle = phase * Math.PI * 2;
  const elevation = Math.cos(angle);
  const daylight = smoothstep(-0.16, 0.22, elevation);
  const nightOpacity = 1 - smoothstep(-0.30, 0.10, elevation);
  const twilight = (1 - smoothstep(0.02, 0.40, Math.abs(elevation)));
  const raw = [Math.sin(angle) * 0.9 + Math.cos(angle) * 0.36, elevation * 0.52, -Math.cos(angle) * 0.82];
  const length = Math.hypot(...raw);
  const sunDirection = raw.map(value => value / length);
  const moonDirection = sunDirection.map(value => -value);
  const label = elevation > 0.22 ? '白天' : elevation < -0.30 ? '夜晚' : phase < 0.5 ? '黄昏' : '黎明';
  return {
    phase, label, daylight, nightOpacity, twilight, sunDirection, moonDirection,
    sunVisibility: smoothstep(-0.16, 0.06, elevation),
    moonVisibility: 1 - smoothstep(-0.06, 0.16, elevation),
    // Even midnight retains enough neutral fill for paths and player silhouettes.
    ambientIntensity: 0.35 + daylight * 0.29,
    hemisphereIntensity: 0.95 + daylight * 0.52,
    sunIntensity: 2.7 * smoothstep(-0.04, 0.35, elevation),
    moonIntensity: 0.72 * (1 - smoothstep(-0.35, 0.04, elevation)),
    lampIntensity: 0.12 + 0.88 * nightOpacity,
  };
}
