import { BLACK_HOLE_CENTER, BLACK_HOLE_DURATION } from '../../../shared/droneBlackHole.js';

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

/** A quiet frontal dolly: the town stays beneath a +Z-facing celestial plane. */
export function sampleBlackHoleCamera(timeMs, aspect = 16 / 9, reducedMotion = false) {
  const elapsed = Number.isFinite(timeMs) ? Math.max(0, Math.min(BLACK_HOLE_DURATION, timeMs)) : 0;
  const ratio = Number.isFinite(aspect) ? Math.max(.25, aspect) : 16 / 9;
  const advance = reducedMotion ? 1 : smooth((elapsed - 12000) / 23000);
  const retreat = reducedMotion ? 0 : smooth((elapsed - 80000) / 10000);
  const width = 335 - advance * 38 + retreat * 38;
  const fov = 48, tangent = Math.tan(fov * Math.PI / 360);
  // The original luminous disc is about 220 x 90 inside its 320 x 180
  // source-star-field plane. Peripheral stars may crop on narrow viewports.
  // Frame the actual artwork, not its transparent margin: large on desktop,
  // horizontally contained on phones, while retaining the top/bottom controls.
  const distance = Math.max(width / (2 * tangent * ratio), 230 / (2 * tangent));
  const target = [BLACK_HOLE_CENTER[0], 144, BLACK_HOLE_CENTER[2]];
  return { position: [target[0], target[1] + 10, target[2] + distance], target,
    fov, near: .1, far: 3000 };
}
