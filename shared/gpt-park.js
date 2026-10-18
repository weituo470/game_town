// GPT 主题园区共享空间契约。地面、导航、碰撞与 3D 渲染只从这里取坐标。
export const GPT_PARK = Object.freeze({
  id: 'gpt',
  name: 'GPT 主题园区',
  subtitle: '灵感之环 · 创作花园 · 多模态剧场',
  x: 38,
  z: -58,
  width: 32,
  depth: 28,
  color: '#4de3b1',
});

export const GPT_BRIDGE = Object.freeze({ id: 'gpt', x: 38, z: -41, width: 7, depth: 8 });
export const GPT_ARRIVAL = Object.freeze({ x: 38, z: -43.5, yaw: Math.PI });
export const GPT_PEDESTAL = Object.freeze({ x: 38, z: -59, radius: 4.3 });

export const GPT_PAVILIONS = Object.freeze([
  Object.freeze({ id: 'create', name: '创作花园', x: 28, z: -52, radius: 2.25, color: '#93f2c3' }),
  Object.freeze({ id: 'code', name: '代码之门', x: 48, z: -52, radius: 2.25, color: '#4de3b1' }),
  Object.freeze({ id: 'voice', name: '共鸣剧场', x: 28, z: -66, radius: 2.25, color: '#a0ede0' }),
  Object.freeze({ id: 'explore', name: '探索星台', x: 48, z: -66, radius: 2.25, color: '#bcebdc' }),
]);

// 双侧门柱，通行净宽 6.1；门头高于角色，不参与平面碰撞。
export const GPT_PILLARS = Object.freeze([
  Object.freeze({ x: 34.5, z: -44.6, width: 0.9, depth: 0.9 }),
  Object.freeze({ x: 41.5, z: -44.6, width: 0.9, depth: 0.9 }),
]);

const insideRect = (x, z, rect, margin = 0) =>
  Math.abs(x - rect.x) <= rect.width / 2 + margin &&
  Math.abs(z - rect.z) <= rect.depth / 2 + margin;

/** 只开放园区岛面与实体步桥，拒绝非数坐标。 */
export function inGptGround(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) &&
    (insideRect(x, z, GPT_PARK) || insideRect(x, z, GPT_BRIDGE));
}

/** 中央镜池、四座场馆与入口立柱不可穿行，景观树不额外阻断道路。 */
export function gptSolid(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (Math.hypot(x - GPT_PEDESTAL.x, z - GPT_PEDESTAL.z) < GPT_PEDESTAL.radius) return true;
  if (GPT_PAVILIONS.some(p => Math.hypot(x - p.x, z - p.z) < p.radius)) return true;
  return GPT_PILLARS.some(p => insideRect(x, z, p, 0.22));
}

export function gptDestination(id) {
  return id === GPT_PARK.id ? { ...GPT_ARRIVAL } : null;
}
