// Shared geometry and movement rules. Neither renderer nor client owns authority.
import { getArchitectProjects, isArchitectSolid } from './architectWorld.js';
import { architectPlot } from './architectPlan.js';
import { inWonderGround, wonderSolid, wonderDestination } from './wonders.js';
import { inGptGround, gptSolid, gptDestination } from './gpt-park.js';
import { inParkGround, parkSolid, parkDestination } from './deepseek-park.js';
import { onRiverPier, FISHING_SPOT } from './river.js';
import { inSphereGround, sphereSolid, sphereDestination } from './sphere-landmark.js';
import { inOffshoreGround, offshoreDestination } from './offshore-island.js';
import { inSpacePort, inRailStation, SPACE_ELEVATOR } from './space-layout.js';
import { inRealisticIsland, islandHeight, islandWalkable, islandCanStep, islandDestination } from './realistic-island.js';
import { inMetroIsland, metroSolid, metroDestination } from './metro-island.js';
import { inPixelIsland, pixelGroundHeight, pixelDestination, pixelCanStep } from './pixel-island.js';
export const WORLD_VERSION = 3;
export const WORLD_SIZE = Object.freeze({ baseWidth: 32, baseDepth: 29, scale: 3, width: 96, depth: 87, centerX: 0, centerZ: 0.4 });
export const WORLD_BOUNDS = Object.freeze({ minX: -42.9, maxX: 42.9, minZ: -38.9, maxZ: 40.3 });
export const FOUNTAIN = Object.freeze({ x: 0, z: 2, radius: 5.9, visualRadius: 5.6, plazaRadius: 11 });
export const PLAYER_SPEED = 5.2;
export const SPAWN = Object.freeze({ x: 0, z: 10.7, yaw: 0.65 });
export const WORLD_LOCATIONS = [
  { id: 'balloons', x: -15, z: -18, doorX: -15, doorZ: -14.8 },
  { id: 'haunted', x: 15, z: -18, doorX: 15, doorZ: -14.8 },
  { id: 'rhythm', x: -15, z: 10, doorX: -15, doorZ: 13.1 },
  { id: 'puzzle', x: 15, z: 10, doorX: 15, doorZ: 13.1 },
];

// Road rectangles are shared by the 3D scene and town map. The plaza joins the
// central crossroads around the fountain; buildings and players keep their size.
export const STREETS = [
  { id: 'north-south', name: '星光大道', x: 0, z: 0.7, width: 8, depth: 79.2, kind: 'main' },
  { id: 'east-west', name: '喷泉大道', x: 0, z: 2, width: 85.8, depth: 8, kind: 'main' },
  { id: 'ring-west', name: '西环街', x: -24, z: 2, width: 5, depth: 58, kind: 'ring' },
  { id: 'ring-east', name: '东环街', x: 24, z: 2, width: 5, depth: 58, kind: 'ring' },
  { id: 'ring-north', name: '北环街', x: 0, z: -25, width: 82, depth: 5, kind: 'ring' },
  { id: 'ring-south', name: '南环街', x: 0, z: 29, width: 82, depth: 5, kind: 'ring' },
  { id: 'outer-west', name: '西林步道', x: -38, z: 0.7, width: 3.5, depth: 79.2, kind: 'side' },
  { id: 'outer-east', name: '东林步道', x: 38, z: 0.7, width: 3.5, depth: 79.2, kind: 'side' },
  { id: 'arcade-north', name: '冒险街', x: 0, z: -13, width: 85.8, depth: 3.5, kind: 'side' },
  { id: 'arcade-south', name: '游艺街', x: 0, z: 15, width: 85.8, depth: 3.5, kind: 'side' },
];

export const DISTRICTS = [
  { id: 'north', name: '北境新区', x: 0, z: -33 },
  { id: 'east', name: '东林新区', x: 32, z: 2 },
  { id: 'south', name: '南岸新区', x: 0, z: 35.5 },
  { id: 'west', name: '西园新区', x: -32, z: 2 },
];

const plotColumns = [
  { x: -31.25, width: 7.5, district: 'west' },
  { x: -13.5, width: 13.5 },
  { x: 13.5, width: 13.5 },
  { x: 31.25, width: 7.5, district: 'east' },
];
const plotRows = [
  { z: -33, depth: 7.5 }, { z: -18.5, depth: 5.5 }, { z: -7, depth: 6 },
  { z: 9.5, depth: 4.5 }, { z: 21.5, depth: 7 }, { z: 35.75, depth: 6.5 },
];
export const EMPTY_PLOTS = plotRows.flatMap((row, rowIndex) => plotColumns.map((column, columnIndex) => ({
  id: `plot-${rowIndex + 1}-${columnIndex + 1}`,
  x: column.x, z: row.z, width: column.width, depth: row.depth,
  district: column.district || (row.z < FOUNTAIN.z ? 'north' : 'south'),
}))).filter(plot => {
  const nearX = Math.max(Math.abs(plot.x - FOUNTAIN.x) - plot.width / 2, 0);
  const nearZ = Math.max(Math.abs(plot.z - FOUNTAIN.z) - plot.depth / 2, 0);
  if (Math.hypot(nearX, nearZ) <= FOUNTAIN.plazaRadius) return false;
  return !WORLD_LOCATIONS.some(place => Math.abs(plot.x - place.x) < plot.width / 2 + 3.22 && Math.abs(plot.z - place.z) < plot.depth / 2 + 2.8);
});

// Tree belts sit outside the street rectangles, leaving intersections, doors,
// arrivals and the enlarged plaza free. Empty building plots stay traversable.
export const TREE_POSITIONS = [
  [-41.5, -34.5, 1.1], [-41.5, -19, 0.9], [-41.5, -6.5, 1.15], [-41.5, 10, 0.9], [-41.5, 22, 1.1], [-41.5, 36, 1],
  [41.5, -34.5, 1], [41.5, -19, 1.1], [41.5, -6.5, 0.9], [41.5, 10, 1.15], [41.5, 22, 0.9], [41.5, 36, 1.1],
  [-31, -38, 0.9], [-14, -38, 1], [14, -38, 1.1], [31, -38, 0.95],
  [-31, 39.6, 0.9], [-14, 39.6, 1.1], [14, 39.6, 0.95], [31, 39.6, 1],
  [-28, -28.7, 1.1], [28, -28.7, 0.95], [-20, -28.7, 0.8], [20, -28.7, 1.1],
  [-28, 32.8, 1], [28, 32.8, 1.1], [-20, 32.8, 0.9], [20, 32.8, 0.85],
  [-20, -8, 0.85], [20, -8, 0.9], [-20, 18.5, 0.85], [20, 18.5, 0.9],
];
export function isWalkable(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || isArchitectSolid(x, z)) return false;
  if (inPixelIsland(x, z)) return true;
  if (inMetroIsland(x, z)) return !metroSolid(x, z);
  if (inRealisticIsland(x, z)) return islandWalkable(x, z);
  const inTown = x >= WORLD_BOUNDS.minX && x <= WORLD_BOUNDS.maxX && z >= WORLD_BOUNDS.minZ && z <= WORLD_BOUNDS.maxZ;
  if (!inTown && !inSpacePort(x,z) && !inRailStation(x,z) && !inWonderGround(x, z) && !inGptGround(x, z) && !inParkGround(x, z) && !onRiverPier(x, z) && !inSphereGround(x, z) && !inOffshoreGround(x, z)) return false;
  if (wonderSolid(x, z) || gptSolid(x, z) || parkSolid(x, z) || sphereSolid(x, z)) return false;
  if (Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < FOUNTAIN.radius) return false;
  for (const place of WORLD_LOCATIONS) {
    if (Math.abs(x - place.x) < 3.22 && Math.abs(z - place.z) < 2.8) return false;
  }
  for (const [tx, tz, scale] of TREE_POSITIONS) if (Math.hypot(x - tx, z - tz) < 0.5 * scale) return false;
  return true;
}

/** Absolute support height; the original town and its existing decks stay Y=0. */
export function groundHeight(x, z) {
  if (inPixelIsland(x, z)) return pixelGroundHeight(x, z);
  return inRealisticIsland(x, z) ? Math.max(0, islandHeight(x, z)) : 0;
}
export function getDestination(id) {
  if (typeof id !== 'string') return null;
  const pixel = pixelDestination(id);
  if (pixel) return pixel;
  const metro = metroDestination(id);
  if (metro) return metro;
  const island = islandDestination(id);
  if (island) return island;
  if (id === 'spaceport') return {x:36,z:54.8,yaw:Math.PI/2};
  // Both the server and the browser resolve these named destinations. No
  // request supplies coordinates, and an unbuilt plot is never a destination.
  const safeArrival = (x, z) => [-0.45, 0, 0.45].every(dx =>
    [-0.45, 0, 0.45].every(dz => isWalkable(x + dx, z + dz)));
  if (id === 'architect') return safeArrival(-6, 25.5) ? { x: -6, z: 25.5, yaw: Math.PI } : null;
  if (id.startsWith('architect-project:')) {
    const projectId = id.slice('architect-project:'.length);
    if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(projectId)) return null;
    const project = getArchitectProjects().find(item => item.id === projectId);
    if (!project) return null;
    const plot = architectPlot(project.plan.plotId);
    const offsets = [[0, 3.3], [3.3, 0], [0, -3.3], [-3.3, 0]];
    const front = project.plan.orientation / 90;
    for (let step = 0; step < offsets.length; step++) {
      const [dx, dz] = offsets[(front + step) % offsets.length];
      const x = plot.x + dx, z = plot.z + dz;
      if (safeArrival(x, z)) return { x, z, yaw: Math.atan2(plot.x - x, plot.z - z) };
    }
    return null;
  }
  const offshore = offshoreDestination(id);
  if (offshore) return offshore;
  const sphere = sphereDestination(id);
  if (sphere) return sphere;
  if (id === 'fishing') return { ...FISHING_SPOT };
  const park = parkDestination(id);
  if (park) return park;
  const gpt = gptDestination(id);
  if (gpt) return gpt;
  const wonder = wonderDestination(id);
  if (wonder) return wonder;
  if (id === 'center') return { x: 0, z: 9.5, yaw: Math.PI };
  const place = WORLD_LOCATIONS.find(item => item.id === id);
  if (place) return { x: place.doorX, z: place.doorZ + 0.7, yaw: Math.PI };
  const district = DISTRICTS.find(item => item.id === id);
  return district ? { x: district.x, z: district.z, yaw: Math.PI } : null;
}
export function movePlayer(state, input, deltaSeconds) {
  let x = Number.isFinite(state?.x) ? state.x : SPAWN.x;
  let z = Number.isFinite(state?.z) ? state.z : SPAWN.z;
  let yaw = Number.isFinite(state?.yaw) ? state.yaw : SPAWN.yaw;
  let dx = Number.isFinite(input?.x) ? input.x : 0;
  let dz = Number.isFinite(input?.z) ? input.z : 0;
  const length = Math.hypot(dx, dz);
  if (length > 1) { dx /= length; dz /= length; }
  const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(0.1, deltaSeconds)) : 0;
  if (length > 0.001) yaw = Math.atan2(dx, dz);
  const steps = Math.max(1, Math.ceil(PLAYER_SPEED * dt / 0.12));
  const step = PLAYER_SPEED * dt / steps;
  const startX = x, startZ = z;
  for (let i = 0; i < steps; i++) {
    if (isWalkable(x + dx * step, z) && islandCanStep(x, z, x + dx * step, z) && pixelCanStep(x, z, x + dx * step, z)) x += dx * step;
    if (isWalkable(x, z + dz * step) && islandCanStep(x, z, x, z + dz * step) && pixelCanStep(x, z, x, z + dz * step)) z += dz * step;
  }
  return { x, z, yaw, moving: Math.hypot(x - startX, z - startZ) > 0.0001 };
}
