import { sampleDayNight } from './dayNight.js';
import { toStationDirection } from './stationPhysics.js';

const rawSun = [-.62, .6, -.46];
const sunLength = Math.hypot(...rawSun);
// Direction FROM the station TOWARD the real, distant sun, in inertial axes.
// The sky disc, Three light and water glints must all use this same vector.
export const STATION_SUN_DIRECTION = Object.freeze(rawSun.map(value => value / sunLength));
export const STATION_SUN_INTENSITY = 2.4;

export function sampleStationLighting(physicsTimeMs = 0, lightingTimeMs = 0) {
  const daylight = sampleDayNight(lightingTimeMs).daylight;
  return {
    sunDirection: toStationDirection(STATION_SUN_DIRECTION, physicsTimeMs),
    sunIntensity: STATION_SUN_INTENSITY,
    // A deliberately small readability fill. Actual internal illumination
    // comes from the visible lighting spine, not three contradictory "suns".
    ambientIntensity: .18 + .08 * daylight,
    daylight,
  };
}
