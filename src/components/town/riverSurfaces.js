import { RIVER } from '../../../shared/river.js';

// A real gap keeps the opaque riverbed out of the water plane's depth values.
// The old bed top was exactly RIVER.waterY, causing view-dependent z-fighting.
const bedHeight = 0.6;
export const RIVER_SURFACES = Object.freeze({
  bedHeight,
  bedY: RIVER.waterY - 0.32 - bedHeight / 2,
  // Transparent layers must not exchange draw order when the camera orbits.
  // Depth testing remains enabled so the pier/banks still occlude them.
  waterOrder: 1,
  fishOrder: 2,
  streakOrder: 3,
  rippleOrder: 4,
});
