/** One deliberately short demo day. The server clock, not frame rate, owns time. */
export const DAY_NIGHT_CYCLE_MS = 180_000;

const clamp = value => Math.max(0, Math.min(1, value));
const smoothstep = (low, high, value) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};

/** Phase 0 is noon; .25 sunset; .5 midnight; .75 sunrise. Safe for clock corrections. */
export function sampleDayNight(worldTimeMs = 0) {
  const time = Number.isFinite(worldTimeMs) ? worldTimeMs : 0;
  const phase = ((time % DAY_NIGHT_CYCLE_MS) + DAY_NIGHT_CYCLE_MS) % DAY_NIGHT_CYCLE_MS / DAY_NIGHT_CYCLE_MS;
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
