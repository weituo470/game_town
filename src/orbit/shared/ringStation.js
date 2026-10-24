// One shared cylindrical inner surface for the town, sea, islands and blank land.
// Physics uses the unrolled metric; rendering alone maps it into world XYZ.
const radius = 150;
const centerZ = 0.4;
const centerX = -31;
const width = 300;
const length = Math.PI * 2 * radius;

export const RING_STATION = Object.freeze({
  radius, width, halfWidth: width / 2, centerX, centerZ,
  minX: centerX - width / 2, maxX: centerX + width / 2,
  landMinX: -153, landMaxX: 91,
  flightMinX: centerX - width / 2 + 2.2, flightMaxX: centerX + width / 2 - 2.2,
  bottomY: 0, topY: radius * 2, centerY: radius,
  length, totalLength: length, straightLength: 0, arcLength: Math.PI * radius,
  logicalMinZ: centerZ - length / 2, logicalMaxZ: centerZ + length / 2,
  // These are the original water/land protection band, not flat curve endpoints.
  northZ: -145, southZ: 40, activeDeckMinZ: -145, activeDeckMaxZ: 40,
  connectorXs: Object.freeze([-24, 24]), connectorHalfWidth: 3.3,
  connectorMinZ: -145, connectorMaxZ: -38,
  southDeckMinZ: 40,
  maxAltitude: radius * 0.4, maxCurvedAltitude: radius * 0.4,
  walkable: true, topology: 'cylinder',
});

const finite = (number, fallback = 0) => Number.isFinite(number) ? number : fallback;

/** Canonical seam sits on the ring top, far from every original landmark. */
export function canonicalStationZ(z) {
  const value = finite(z);
  if (value > RING_STATION.logicalMinZ && value <= RING_STATION.logicalMaxZ) return value;
  const offset = ((RING_STATION.logicalMaxZ - value) % length + length) % length;
  return RING_STATION.logicalMaxZ - offset;
}

/** Signed shortest surface displacement, suitable for snapshot interpolation. */
export function stationDeltaZ(fromZ, toZ) {
  const difference = canonicalStationZ(toZ) - canonicalStationZ(fromZ);
  return difference > length / 2 ? difference - length
    : difference < -length / 2 ? difference + length : difference;
}

export function wrapRingProgress(progress) {
  const value = finite(progress);
  return ((value % 1) + 1) % 1;
}

/** Compatibility name: every valid longitude, including the old town, curves. */
export function isCurvedStationZ(z) {
  return Number.isFinite(z) && z > RING_STATION.logicalMinZ && z <= RING_STATION.logicalMaxZ;
}

/** Entire physical station domain, including water. This NEVER implies land. */
export function isStationDomain(x, z) {
  return Number.isFinite(x) && isCurvedStationZ(z)
    && x >= RING_STATION.minX && x <= RING_STATION.maxX;
}

/** Only additional land/bridges; old town and islands keep their own masks. */
export function isStationAdditionalGround(x, z) {
  if (!isStationDomain(x, z) || x < RING_STATION.landMinX || x > RING_STATION.landMaxX) return false;
  if (z <= RING_STATION.northZ || z >= RING_STATION.southZ) return true;
  return z <= RING_STATION.connectorMaxZ
    && RING_STATION.connectorXs.some(center => Math.abs(x - center) <= RING_STATION.connectorHalfWidth);
}

// Retained for callers, but explicitly not an alias for "all curved positions".
export const isRingWalkRegion = isStationAdditionalGround;

function sectionAt(progress) {
  if (progress < 0.125 || progress >= 0.875) return 'bottom';
  if (progress < 0.375) return 'north-arc';
  if (progress < 0.625) return 'top';
  return 'south-arc';
}

/**
 * Full circular path, never a flat segment. Ground is height=0. Heights and
 * object feet use the same local Y as the original collision and water data.
 * Local -Z follows tangent; local Y follows the inward normal.
 */
export function sampleRingPath(progress, lateral = 0, height = 0) {
  const normalized = wrapRingProgress(progress);
  const angle = normalized * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle);
  const altitude = finite(height), radial = altitude - radius;
  return {
    progress: normalized, distance: normalized * length,
    section: sectionAt(normalized), rotationX: angle,
    position: [finite(lateral), radius + radial * cos, centerZ + radial * sin],
    normal: [0, cos, sin], tangent: [0, sin, -cos],
  };
}

/** No identity/flat branch: town, sea, old islands, players and cameras share F. */
export function stationPoseFrame(pose = {}) {
  const z = canonicalStationZ(finite(pose.z));
  return sampleRingPath((centerZ - z) / length, finite(pose.x), finite(pose.y));
}

/** Legacy name means the original longitude band, not a flat physical deck. */
export function isOriginalTownDeck(sample) {
  if (!Number.isFinite(sample?.progress)) return false;
  const z = canonicalStationZ(centerZ - sample.progress * length);
  return z > RING_STATION.activeDeckMinZ && z < RING_STATION.activeDeckMaxZ;
}
