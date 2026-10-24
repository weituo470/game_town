// Deterministic surface-space plans shared by rendering and authoritative
// movement. No Three.js, random seed, DOM state or independent collision map.
import { RING_STATION } from './ringStation.js';

export const RING_CITY_SURFACE_HEIGHT = 0.025;
export const RING_CITY_BUILDING_CLEARANCE = 0.35;
export const RING_CITY_MAIN_ROAD_XS = Object.freeze([-24, 24]);
export const RING_CITY_SIDE_ROAD_XS = Object.freeze([-132, -80, 72]);
const CROSS_ROAD_ZS = [-164, -252, -340, -428, 427, 339, 251, 163, 75];
const BUILDING_LANES = [-112, -56, 0, 50];
const STYLES = Object.freeze([
  Object.freeze({ style: 'cottage', floors: 1, height: 4.8, wallHeight: 3.4, roofHeight: 1.4 }),
  Object.freeze({ style: 'gable', floors: 2, height: 7.4, wallHeight: 5.8, roofHeight: 1.6 }),
  Object.freeze({ style: 'flat', floors: 2, height: 6.6, wallHeight: 6, roofHeight: 0.6 }),
  Object.freeze({ style: 'shop', floors: 1, height: 4.5, wallHeight: 4, roofHeight: 0.5 }),
]);

const segments = [
  { id: 'north', minZ: RING_STATION.logicalMinZ, maxZ: RING_STATION.northZ },
  { id: 'south', minZ: RING_STATION.southZ, maxZ: RING_STATION.logicalMaxZ },
];
export const RING_CITY_ROADS = Object.freeze([
  ...segments.flatMap(segment => [
    ...RING_CITY_MAIN_ROAD_XS.map(x => ({ x, width: 8, kind: 'main' })),
    ...RING_CITY_SIDE_ROAD_XS.map(x => ({ x, width: 5, kind: 'side' })),
  ].map(road => Object.freeze({
    id: `ring-road-${segment.id}-${road.x}`, ...road,
    z: (segment.minZ + segment.maxZ) / 2, depth: segment.maxZ - segment.minZ,
    height: RING_CITY_SURFACE_HEIGHT,
  }))),
  ...CROSS_ROAD_ZS.map((z, index) => Object.freeze({
    id: `ring-cross-${index + 1}`, x: (-136 + 77) / 2, z, width: 77 - (-136), depth: 6,
    kind: 'cross', height: RING_CITY_SURFACE_HEIGHT,
  })),
]);

const reservedSlot = districtIndex => ({ side: districtIndex % 2, lane: (districtIndex + 1) % BUILDING_LANES.length });
const rowZ = (z, districtIndex, side, lane) => z + (side === 0 ? -1 : 1) * (20 + (districtIndex + lane) % 4);

export const RING_CITY_DISTRICTS = Object.freeze(CROSS_ROAD_ZS.map((z, index) => {
  const id = `ring-district-${index + 1}`, slot = reservedSlot(index);
  // The first near-town row would intrude into the original sea (-144): leave
  // that WHOLE row untouched. Its garden instead uses spare land on the far row.
  const plaza = Object.freeze({
    id: `${id}-open-space`, district: id,
    x: index === 0 ? -96 : BUILDING_LANES[slot.lane],
    z: index === 0 ? z - 22 : rowZ(z, index, slot.side, slot.lane),
    width: 14, depth: 16, kind: index % 2 ? 'plaza' : 'garden',
  });
  return Object.freeze({ id, name: `星环街区 ${index + 1}`, z, plazas: Object.freeze([plaza]) });
}));
export const RING_CITY_PLAZAS = Object.freeze(RING_CITY_DISTRICTS.flatMap(district => district.plazas));

export const RING_CITY_BUILDINGS = Object.freeze(RING_CITY_DISTRICTS.flatMap((district, districtIndex) => {
  const reserved = reservedSlot(districtIndex), buildings = [];
  for (let side = 0; side < 2; side++) for (let lane = 0; lane < BUILDING_LANES.length; lane++) {
    if (districtIndex === 0 && side === 1) continue;
    if (districtIndex > 0 && side === reserved.side && lane === reserved.lane) continue;
    const seed = districtIndex * 8 + side * 4 + lane;
    buildings.push(Object.freeze({
      id: `${district.id}-building-${side + 1}-${lane + 1}`, district: district.id,
      x: BUILDING_LANES[lane], z: rowZ(district.z, districtIndex, side, lane),
      width: 6 + seed % 4, depth: 7 + (seed * 3 + districtIndex) % 4,
      ...STYLES[(districtIndex + lane + side * 2) % STYLES.length],
      colorIndex: (districtIndex * 2 + lane + side) % 6,
    }));
  }
  return buildings;
}));

const collisionRows = RING_CITY_DISTRICTS.map(district => ({
  z: district.z, buildings: RING_CITY_BUILDINGS.filter(building => building.district === district.id),
}));

/** Height includes the full roof; ALL visible parts must stay in the footprint.
 * A conservative roof-height slab matches the existing town's flight rules. */
export function ringCityBuildingAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)
    || x < RING_STATION.landMinX || x > RING_STATION.landMaxX
    || z <= RING_STATION.logicalMinZ || z > RING_STATION.logicalMaxZ
    || (z > RING_STATION.northZ && z < RING_STATION.southZ)) return null;
  for (const row of collisionRows) {
    if (Math.abs(z - row.z) > 29) continue;
    for (const building of row.buildings) {
      if (Math.abs(x - building.x) < building.width / 2 + RING_CITY_BUILDING_CLEARANCE
        && Math.abs(z - building.z) < building.depth / 2 + RING_CITY_BUILDING_CLEARANCE) return building;
    }
  }
  return null;
}

export function ringCitySolid(x, z) { return ringCityBuildingAt(x, z) !== null; }
export function ringCityFlightFloor(x, z) { return ringCityBuildingAt(x, z)?.height ?? 0; }
