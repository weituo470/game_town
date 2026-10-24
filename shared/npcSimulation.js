// Short resident patrols remain independent of the longer theatre night.
const DAY_NIGHT_CYCLE_MS = 180_000;
import { FOUNTAIN, WORLD_BOUNDS, WORLD_LOCATIONS, TREE_POSITIONS, isWalkable } from './world.js';

// Ambient residents are not authoritative players or solid obstacles. Every
// client samples the same server-derived world time, without sending NPC ticks.
export const NPC_BODY_RADIUS = 0.65;
const DAY_START_MS = 130_000;
const ACTIVE_DURATION_MS = 100_000;
const mod = value => ((value % DAY_NIGHT_CYCLE_MS) + DAY_NIGHT_CYCLE_MS) % DAY_NIGHT_CYCLE_MS;
const timeOf = value => mod(Number.isFinite(value) ? value : 0);
const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

/** Exact body clearance against the same solids that constrain players. */
export function isNpcWalkable(x, z) {
  if (!isWalkable(x, z)) return false;
  const r = NPC_BODY_RADIUS;
  if (x - r < WORLD_BOUNDS.minX || x + r > WORLD_BOUNDS.maxX || z - r < WORLD_BOUNDS.minZ || z + r > WORLD_BOUNDS.maxZ) return false;
  if (Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < FOUNTAIN.radius + r) return false;
  if (WORLD_LOCATIONS.some(place => Math.hypot(Math.max(Math.abs(x - place.x) - 3.22, 0), Math.max(Math.abs(z - place.z) - 2.8, 0)) < r)) return false;
  return !TREE_POSITIONS.some(([tx, tz, scale]) => Math.hypot(x - tx, z - tz) < 0.5 * scale + r);
}

// These are public outdoor work points, not promises of as-yet unbuilt shops.
// The path closes at home. Remaining active time is divided into job dwells,
// rather than speeding up a character to fill a hard-coded sequence of times.
const definitions = [
  {
    id: 'npc-ali', speed: 0.95, activity: 'stock', activityLabel: '整理物资与标签', locationLabel: '广场西侧物资点',
    walkLabel: '巡看物资配送点', homeLabel: '西侧廊边休息点',
    points: [[-9.6, 8.5, 1], [-9.6, 12, 3], [-9.4, 15, 1], [-6.5, 15, 1]],
  },
  {
    id: 'npc-huaya', speed: 0.9, activity: 'garden', activityLabel: '观察花色与花圃布局', locationLabel: '西北花圃工作点',
    walkLabel: '查看花圃', homeLabel: '花圃边休息点',
    points: [[-9, -4, 1], [-12, -4, 2], [-14, -6, 2], [-10, -6, 1]],
  },
  {
    id: 'npc-nuannuan', speed: 0.85, activity: 'knit', activityLabel: '整理围巾与织补材料', locationLabel: '广场织补角',
    walkLabel: '散步舒展双手', homeLabel: '织补角休息点',
    points: [[-6.3, 10.3, 2], [-5.8, 12.2, 2], [-3.8, 13, 2], [-4.8, 10.8, 1]],
  },
  {
    id: 'npc-beidong', speed: 1.15, activity: 'inspect', activityLabel: '检查路面与路标', locationLabel: '北环街维护路线',
    walkLabel: '巡查北环步道', homeLabel: '北环街路边休息点',
    points: [[-24, -21, 1], [-24, -25, 2], [-31, -25, 2], [-31, -21, 1]],
  },
  {
    id: 'npc-juya', speed: 1.0, activity: 'guide', activityLabel: '停下等候花园同行者', locationLabel: '喷泉南侧导览点',
    walkActivity: 'guide', walkLabel: '沿花园小径巡游', homeLabel: '花园入口休息点',
    points: [[-5.2, 12.5, 0.5], [-2.5, 12, 6], [-5.2, 10.4, 1], [-7.5, 7, 1], [-8.2, 3, 1], [-7.5, 7, 0.5], [-5.2, 10.4, 0.5]],
  },
  {
    id: 'npc-lituan', speed: 0.8, activity: 'sort', activityLabel: '比对并整理小木块', locationLabel: '东侧木作工作点',
    walkLabel: '搬运轻巧的木作材料', homeLabel: '木作角软垫休息点',
    points: [[11, 4, 2], [14, 4, 2], [16, 4, 1], [14, 5, 1]],
  },
  {
    id: 'npc-lanyue', speed: 1.7, activity: 'warmup', activityLabel: '热身并检查路线方向', locationLabel: '南环街慢跑路线',
    walkActivity: 'jog', walkLabel: '沿南环街慢跑', homeLabel: '南岸路线休息点',
    points: [[3, 20, 1], [3, 29, 1], [-3, 29, 1], [-3, 20, 1]],
  },
  {
    id: 'npc-maipao', speed: 1.6, activity: 'deliveryWait', activityLabel: '坐下核对轻件标签', locationLabel: '游艺街配送路线',
    walkActivity: 'deliver', walkLabel: '进行短途送货巡游', homeLabel: '西侧配送休息点',
    points: [[-11, 15, 2], [-7, 15, 0.5], [7, 15, 0.5], [11, 15, 3], [7, 15, 0.5], [-7, 15, 0.5]],
  },
  {
    id: 'npc-lanjian', speed: 0.9, activity: 'archive', activityLabel: '整理公开信件与小镇记录', locationLabel: '东北公共留言角',
    walkLabel: '巡看公共留言点', homeLabel: '留言角休息点',
    points: [[9, -2, 2], [10, -5, 2], [13, -5, 1], [13, -1, 1]],
  },
  {
    id: 'npc-chengsu', speed: 0.95, activity: 'bake', activityLabel: '核对面包展示篮与取餐牌', locationLabel: '西环街面包工作点',
    walkLabel: '查看面包展示点', homeLabel: '西环街休息点',
    points: [[-26, 5, 2], [-24, 8, 1], [-24, 12, 2], [-26, 12, 1]],
  },
  {
    id: 'npc-rongrong', speed: 0.8, activity: 'read', activityLabel: '翻看绘本与整理书页', locationLabel: '南侧安静阅读角',
    walkLabel: '轻步巡看阅读角', homeLabel: '阅读角软垫休息点',
    points: [[10, 19, 3], [12, 19, 1], [14, 21, 1], [10, 21, 1]],
  },
  {
    id: 'npc-yubai', speed: 0.9, activity: 'paint', activityLabel: '比较色卡并记录绘画灵感', locationLabel: '东环街绘画工作点',
    walkLabel: '退后观察光照与配色', homeLabel: '绘画角休息点',
    points: [[24, -8, 2], [27, -8, 1], [27, -3, 2], [24, -3, 1]],
  },
  {
    id: 'npc-miaomu', speed: 0.95, activity: 'water', activityLabel: '查看菜园与浇水记录', locationLabel: '西南菜园工作点',
    walkLabel: '沿菜园边缘巡视', homeLabel: '菜园边休息点',
    points: [[-29, 20, 2], [-32, 20, 1], [-32, 24, 2], [-29, 24, 1]],
  },
  {
    id: 'npc-dengcheng', speed: 1.25, activity: 'inspectLamp', activityLabel: '检查暖灯的照明方向', locationLabel: '广场暖灯巡检路线',
    walkActivity: 'patrol', walkLabel: '沿广场巡视夜灯', homeLabel: '东侧灯具工作点', activeStartMs: 40_000,
    restingActivity: 'repair', restingActivityLabel: '日间整理灯罩与维修工具',
    points: [[7.8, 9, 1], [7.8, 3, 1], [7.8, -6, 1], [-7.8, -6, 1], [-7.8, 3, 1], [-7.8, 9, 1], [0, 12, 1]],
  },
  {
    id: 'npc-xiaotai', speed: 0.85, activity: 'observe', activityLabel: '观察叶片并绘制记录', locationLabel: '东林自然观察点',
    walkLabel: '寻找不同的叶影', homeLabel: '东林步道休息点',
    points: [[30, 10, 2], [31, 15, 1], [28, 15, 2], [28, 10, 1]],
  },
  {
    id: 'npc-alan', speed: 1.0, activity: 'welcome', activityLabel: '招呼来访者并核对介绍卡', locationLabel: '喷泉南侧迎宾点',
    walkLabel: '检查广场通行方向', homeLabel: '东侧迎宾休息点',
    points: [[2.7, 12.2, 0.5], [3, 10.8, 6], [5.2, 10.8, 0.5], [6.8, 13.6, 0.5]],
  },
];

function compilePlan(definition) {
  const waypoints = definition.points.map(([x, z, dwellWeight]) => Object.freeze({
    x, z, dwellWeight, activity: definition.activity,
    activityLabel: definition.activityLabel, locationLabel: definition.locationLabel,
  }));
  const pathLength = waypoints.reduce((length, point, i) => length + distance(point, waypoints[(i + 1) % waypoints.length]), 0);
  const walkDurationMs = pathLength / definition.speed * 1000;
  if (walkDurationMs >= ACTIVE_DURATION_MS) throw new Error(`NPC route exceeds available time: ${definition.id}`);
  const weightSum = waypoints.reduce((sum, point) => sum + point.dwellWeight, 0);
  const dwellBudget = ACTIVE_DURATION_MS - walkDurationMs;
  const segments = [];
  let cursor = 0;
  for (let i = 0; i < waypoints.length; i++) {
    const point = waypoints[i], next = waypoints[(i + 1) % waypoints.length];
    const yaw = Math.atan2(next.x - point.x, next.z - point.z);
    const dwell = dwellBudget * point.dwellWeight / weightSum;
    segments.push(Object.freeze({ from: point, to: point, start: cursor, end: cursor + dwell, moving: false, yaw }));
    cursor += dwell;
    const walk = distance(point, next) / definition.speed * 1000;
    segments.push(Object.freeze({ from: point, to: next, start: cursor, end: cursor + walk, moving: true, yaw }));
    cursor += walk;
  }
  return Object.freeze({
    id: definition.id, speed: definition.speed,
    home: Object.freeze({ x: waypoints[0].x, z: waypoints[0].z, yaw: segments[0].yaw, locationLabel: definition.homeLabel }),
    waypoints: Object.freeze(waypoints), segments: Object.freeze(segments),
    activeStartMs: definition.activeStartMs ?? DAY_START_MS, activeDurationMs: ACTIVE_DURATION_MS,
    activity: definition.activity, activityLabel: definition.activityLabel, locationLabel: definition.locationLabel,
    walkActivity: definition.walkActivity ?? 'walk', walkLabel: definition.walkLabel,
    restingActivity: definition.restingActivity ?? 'rest', restingActivityLabel: definition.restingActivityLabel ?? '夜间休息，仍可轻声交谈',
  });
}

export const NPC_PLANS = Object.freeze(Object.fromEntries(definitions.map(definition => [definition.id, compilePlan(definition)])));

/** Pure, allocation-light sampling; frame rate, tab backgrounding and join order do not alter a route. */
export function sampleNpc(id, timeMs = 0) {
  if (typeof id !== 'string' || !Object.hasOwn(NPC_PLANS, id)) return null;
  const plan = NPC_PLANS[id];
  const elapsed = mod(timeOf(timeMs) - plan.activeStartMs);
  if (elapsed >= plan.activeDurationMs) {
    return { id, x: plan.home.x, z: plan.home.z, yaw: plan.home.yaw, moving: false,
      activity: plan.restingActivity, activityLabel: plan.restingActivityLabel, locationLabel: plan.home.locationLabel };
  }
  const segment = plan.segments.find(item => elapsed < item.end) ?? plan.segments.at(-1);
  const progress = Math.max(0, Math.min(1, (elapsed - segment.start) / (segment.end - segment.start)));
  return {
    id,
    x: segment.from.x + (segment.to.x - segment.from.x) * progress,
    z: segment.from.z + (segment.to.z - segment.from.z) * progress,
    yaw: segment.yaw, moving: segment.moving,
    activity: segment.moving ? plan.walkActivity : segment.from.activity,
    activityLabel: segment.moving ? plan.walkLabel : segment.from.activityLabel,
    locationLabel: segment.from.locationLabel,
  };
}

function hasSightline(a, b) {
  const steps = Math.max(1, Math.ceil(distance(a, b) / 0.15));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

/** A nearby interaction never reaches through the fountain, trees or a building. */
export function findNearestNpc(player, timeMs = 0, maxDistance = 4) {
  if (!Number.isFinite(player?.x) || !Number.isFinite(player?.z) || !Number.isFinite(maxDistance) || maxDistance <= 0) return null;
  let nearest = null;
  for (const id of Object.keys(NPC_PLANS)) {
    const npc = sampleNpc(id, timeMs);
    const separation = distance(player, npc);
    if (separation > maxDistance || (nearest && separation >= nearest.distance)) continue;
    if (hasSightline(player, npc)) nearest = { ...npc, distance: separation };
  }
  return nearest;
}
