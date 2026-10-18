// Original DeepSeek park geometry is kept in local source units. This single
// transform owns the renderer, navigation, server collision and flight roofs.
export const PARK_CONTRACT_VERSION = 2;
export const PARK_SCALE = 0.48;
export const PARK_LOCAL_GROUND_Y = 0.335;
export const DEEPSEEK_PARK = Object.freeze({
  id: 'deepseek', name: 'DeepSeek 主题园区',
  subtitle: '鲸园 · 六座专家塔 · 层析塔 · 数据喷泉',
  x: -79, z: -80, width: 67.2, depth: 67.2, radius: 33.6,
  // The sloped outer skirt is scenery, not an invisible square over the sea.
  walkRadius: 32.44, color: '#4d8bff',
});

export function parkLocalToWorld(x, z) {
  return { x: DEEPSEEK_PARK.x + x * PARK_SCALE, z: DEEPSEEK_PARK.z + z * PARK_SCALE };
}
const worldHeight = localY => Math.max(0, (localY - PARK_LOCAL_GROUND_Y) * PARK_SCALE);
const circle = (id, x, z, radius, top) => Object.freeze({ id, ...parkLocalToWorld(x, z), radius: radius * PARK_SCALE, height: worldHeight(top) });
const rect = (id, x, z, width, depth, top) => Object.freeze({ id, ...parkLocalToWorld(x, z), width: width * PARK_SCALE, depth: depth * PARK_SCALE, height: worldHeight(top) });

// An L-shaped promenade skirts the northern end of the western river. The
// town-end segment keeps the existing -38m street axis and opens its parapet.
export const PARK_BRIDGE = Object.freeze({ id: 'deepseek-town', x: -38, z: -40.5, width: 7, depth: 7 });
export const PARK_BRIDGES = Object.freeze([
  PARK_BRIDGE,
  Object.freeze({ id: 'deepseek-span', x: -58.5, z: -43, width: 48, depth: 6 }),
  Object.freeze({ id: 'deepseek-island', x: -79, z: -45.75, width: 7, depth: 11.5 }),
]);
export const PARK_ARRIVAL = Object.freeze({ x: -79, z: -50.75, yaw: Math.PI });
export const PARK_WALK_ROUTE = Object.freeze([
  Object.freeze({ x: -38, z: -36 }), Object.freeze({ x: -38, z: -43 }),
  Object.freeze({ x: -79, z: -43 }), PARK_ARRIVAL,
]);

export const PARK_PEDESTAL = Object.freeze({ ...circle('whale-pool', 0, 0, 16.05, .89), visualRadius: 15.5 * PARK_SCALE });
export const PARK_TOWERS = Object.freeze([30, 90, 150, 210, 270, 330].map((degrees, index) => {
  const angle = degrees * Math.PI / 180, localHeight = [13, 17.5, 11.5, 19, 14.5, 16][index];
  return Object.freeze({ ...circle(`expert-${index + 1}`, Math.sin(angle) * 30, Math.cos(angle) * 30, 3.6, localHeight + 2.87),
    localHeight, phase: index / 6 });
}));
export const PARK_LAYER_STACK = circle('layer-stack', 0, -32, 12.4, 11.1);
export const PARK_FOUNTAIN = circle('data-fountain', 0, 27, 5.2, 4.9);
export const PARK_PILLARS = Object.freeze([-1, 1].map(side => rect(`gate-${side}`, side * 8.8, 42, 3.8, 3.8, 12.475)));
export const PARK_SOLIDS = Object.freeze([PARK_PEDESTAL, ...PARK_TOWERS, PARK_LAYER_STACK, PARK_FOUNTAIN, ...PARK_PILLARS]);
export const PARK_PATH = Object.freeze({ ...parkLocalToWorld(0, 38), width: 7.5 * PARK_SCALE, depth: 20 * PARK_SCALE });

const finitePoint = (x, z) => Number.isFinite(x) && Number.isFinite(z);
const insideRect = (x, z, shape, margin = 0) => Math.abs(x - shape.x) <= shape.width / 2 + margin && Math.abs(z - shape.z) <= shape.depth / 2 + margin;
const inSolid = (x, z, solid) => solid.radius !== undefined
  ? Math.hypot(x - solid.x, z - solid.z) < solid.radius + 0.25
  : insideRect(x, z, solid, 0.25);

/** Only the circular island and its real bridge decks support walking. */
export function inParkGround(x, z) {
  return finitePoint(x, z) && (Math.hypot(x - DEEPSEEK_PARK.x, z - DEEPSEEK_PARK.z) <= DEEPSEEK_PARK.walkRadius
    || PARK_BRIDGES.some(bridge => insideRect(x, z, bridge, -0.2)));
}

/** Full-size source obstacles; the suspended whale and thin lights are scenic. */
export function parkSolid(x, z) {
  return finitePoint(x, z) && PARK_SOLIDS.some(solid => inSolid(x, z, solid));
}

/** Conservative actual roof heights let high flight and camera booms clear towers. */
export function parkFlightFloor(x, z) {
  if (!finitePoint(x, z)) return 0;
  let height = 0;
  for (const solid of PARK_SOLIDS) if (inSolid(x, z, solid)) height = Math.max(height, solid.height);
  return height;
}

export function parkDestination(id) {
  return id === DEEPSEEK_PARK.id ? { ...PARK_ARRIVAL } : null;
}
