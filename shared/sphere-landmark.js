// One geometry contract for the facade, real island decks and authoritative movement.
export const SPHERE_LANDMARK = Object.freeze({ id: 'sphere', name: '球幕剧场', x: -108, z: 10, radius: 18, centerY: 11.8, baseY: 2, groundRadius: 27, faceYaw: 1.2 });
export const SPHERE_BRIDGE = Object.freeze({ id: 'sphere-orca', x: -81.2, z: 22, width: 16, depth: 6 });
export const SPHERE_ARRIVAL = Object.freeze({ x: -87.8, z: 22, yaw: Math.atan2(-20.2, -12) });
export const SPHERE_MODES = Object.freeze([
  ['auto', '自动轮播'], ['smile', '黄色表情'], ['eye', '巨型眼球'], ['earth', '蓝色星球'], ['basketball', '篮球'],
].map(([id, name]) => Object.freeze({ id, name })));
const finite = (x, z) => Number.isFinite(x) && Number.isFinite(z);
const distance = (x, z) => Math.hypot(x - SPHERE_LANDMARK.x, z - SPHERE_LANDMARK.z);
// Keep feet within visible decks. Do not turn the surrounding bounding box into land.
export function inSphereGround(x, z) {
  return finite(x, z) && (distance(x, z) <= SPHERE_LANDMARK.groundRadius - .2
    || (Math.abs(x - SPHERE_BRIDGE.x) <= SPHERE_BRIDGE.width / 2 - .2 && Math.abs(z - SPHERE_BRIDGE.z) <= SPHERE_BRIDGE.depth / 2 - .2));
}
// The heightfield cannot represent undercuts: conservatively exclude the sphere's
// complete horizontal silhouette, including its 18.3m stone plinth and foot radius.
export function sphereSolid(x, z) { return finite(x, z) && distance(x, z) < SPHERE_LANDMARK.radius + .35; }
export function sphereFlightFloor(x, z) {
  if (!sphereSolid(x, z)) return 0;
  const d = Math.max(0, distance(x, z) - .35), r = SPHERE_LANDMARK.radius;
  return SPHERE_LANDMARK.centerY + Math.sqrt(Math.max(0, r * r - d * d)) + .2;
}
export function sphereDestination(id) { return id === SPHERE_LANDMARK.id ? { ...SPHERE_ARRIVAL } : null; }
