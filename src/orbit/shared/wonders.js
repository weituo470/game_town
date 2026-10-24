// Additive islands: the original town/plots and resident routes stay intact.
// Rendering, atlas, navigation and server collision all consume this contract.
export const WONDER_CYCLE_MS = 180000;
export const WONDER_MAP = Object.freeze({ width: 230, depth: 184, centerX: -31, centerZ: -48 });
export const EXPLORATION_BOUNDS = Object.freeze({ minX: -138, maxX: 77, minZ: -133, maxZ: 40.3 });
export const WONDERS = Object.freeze([
  { id: 'orca', name: '虎鲸湾', subtitle: '双鲸跃水 · 海湾剧场', x: -63, z: 20, width: 28, depth: 28, start: 0, duration: 40000, color: '#74d9dc', arrival: { x: -53, z: 22, yaw: -Math.PI / 2 } },
  { id: 'carrier', name: '航母港', subtitle: '甲板漫游 · 舰载机起飞', x: 63, z: 20, width: 28, depth: 30, start: 60000, duration: 45000, color: '#b3c7f0', arrival: { x: 58, z: 29, yaw: Math.PI } },
  { id: 'rocket', name: '星港展示场', subtitle: '舱内全息模型 · 非真实发射', x: 0, z: -60, width: 30, depth: 30, start: 120000, duration: 40000, color: '#ffd194', arrival: { x: 0, z: -48, yaw: Math.PI } },
]);
export const WONDER_BRIDGES = Object.freeze([
  { id: 'orca', x: -47.5, z: 22, width: 13, depth: 4 },
  { id: 'carrier', x: 48.5, z: 22, width: 15, depth: 4 },
  { id: 'rocket', x: 0, z: -42, width: 4, depth: 12 },
]);
export const CARRIER_SOLIDS = Object.freeze([
  { x: 69.5, z: 21, width: 3.4, depth: 7 }, // island / bridge
  { x: 69, z: 10, width: 4, depth: 4 }, // parked aircraft
  { x: 69, z: 31, width: 4, depth: 4 },
]);
export const insideRect = (x, z, rect, margin = 0) => Math.abs(x - rect.x) <= rect.width / 2 + margin && Math.abs(z - rect.z) <= rect.depth / 2 + margin;
export function inWonderGround(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (WONDER_BRIDGES.some(rect => insideRect(x, z, rect))) return true;
  if (insideRect(x, z, WONDERS[0])) return true;
  if (insideRect(x, z, WONDERS[2])) return true;
  // Carrier: only the deck and gangway support walking, not the surrounding sea.
  return insideRect(x, z, { x: 63, z: 20, width: 18, depth: 30 });
}
export function wonderSolid(x, z) {
  if (((x + 64) / 8.8) ** 2 + ((z - 19) / 7.8) ** 2 < 1) return true;
  if (CARRIER_SOLIDS.some(rect => insideRect(x, z, rect, 0.25))) return true;
  if (Math.hypot(x, z + 61) < 4.8) return true;
  if (insideRect(x, z, { x: -9, z: -70, width: 7, depth: 4 }, 0.3)) return true;
  if ([28, 29.5, 31].some(row => insideRect(x, z, { x: -64, z: row, width: 17, depth: 0.8 }, 0.2))) return true;
  return insideRect(x, z, { x: 5.6, z: -63, width: 2.8, depth: 6 }, 0.3);
}
export function wonderDestination(id) { const item = WONDERS.find(w => w.id === id); return item ? { ...item.arrival } : null; }
export function cycleWonderTime(time) { return Number.isFinite(time) ? ((time % WONDER_CYCLE_MS) + WONDER_CYCLE_MS) % WONDER_CYCLE_MS : 0; }
export function sampleWonder(id, time) {
  const wonder = WONDERS.find(w => w.id === id);
  if (!wonder) return null;
  const elapsed = cycleWonderTime(cycleWonderTime(time) - wonder.start);
  const active = elapsed < wonder.duration;
  const seconds = elapsed / 1000;
  let phase = 'waiting', label = '等待下一场';
  if (active && id === 'orca') { phase = 'show'; label = seconds < 8 ? '虎鲸巡游' : seconds < 33 ? '双鲸跃水' : '谢幕巡游'; }
  if (active && id === 'carrier') { phase = seconds < 8 ? 'taxi' : seconds < 15 ? 'takeoff' : seconds < 35 ? 'flight' : 'return'; label = { taxi: '甲板滑行', takeoff: '弹射起飞', flight: '空中巡航', return: '返航进场' }[phase]; }
  if (active && id === 'rocket') { phase = seconds < 10 ? 'countdown' : seconds < 13 ? 'ignition' : seconds < 32 ? 'ascent' : 'reset'; label = phase === 'countdown' ? `模型演示倒计时 ${Math.ceil(10 - seconds)}` : { ignition: '投影启动', ascent: '模型升降演示', reset: '演示结束 · 模型复位' }[phase]; }
  return { id, elapsed, seconds, active, phase, label, countdown: active && id === 'rocket' && seconds < 10 ? Math.ceil(10 - seconds) : null, nextIn: active ? 0 : WONDER_CYCLE_MS - elapsed };
}
// All trajectories are absolute-time samples: no accumulated delta, timers,
// random numbers, or per-client launch triggers that could drift in a room.
export function sampleOrca(time, index = 0, reduced = false) {
  const state = sampleWonder('orca', time);
  const t = reduced ? index * 1.7 : cycleWonderTime(time) / 1000;
  const angle = t * 0.35 + index * Math.PI;
  let x = -64 + Math.cos(angle) * 5.5, z = 19 + Math.sin(angle) * 4.6, y = -0.48, pitch = 0;
  let yaw = Math.atan2(5.5 * Math.sin(angle), -4.6 * Math.cos(angle));
  const beat = (state.seconds - 8 - index * 0.9) % 9;
  const jumping = !reduced && state.active && state.seconds >= 8 && state.seconds < 33 && beat >= 0 && beat < 3.4;
  if (jumping) { const p = beat / 3.4; x = -69 + p * 10; z = 17.8 + index * 2.5; y = -0.48 + Math.sin(p * Math.PI) * 5.2; pitch = Math.cos(p * Math.PI) * 0.9; yaw = -Math.PI / 2; }
  else if (!reduced && state.active && state.seconds >= 8 + index * 0.9 && state.seconds < 33 && beat >= 3.4) {
    // A submerged return arc joins the next leap; never snap across the pool
    // between consecutive jumps.
    const a = (beat - 3.4) / 5.6 * Math.PI;
    x = -64 + Math.cos(a) * 5; z = 17.8 + index * 2.5 + Math.sin(a) * 0.6;
    yaw = Math.atan2(5 * Math.sin(a), -0.6 * Math.cos(a));
  }
  return { x, y, z, yaw, pitch, splash: jumping && beat > 2.8 ? (beat - 2.8) / 0.6 : 0 };
}
export function sampleJet(time, reduced = false) {
  const s = sampleWonder('carrier', time), t = s.seconds;
  if (!s.active || reduced) return { x: 62, y: 0.8, z: 29, yaw: 0, pitch: 0, visible: true };
  if (t < 8) return { x: 62, y: 0.8, z: 29 - t * 0.9, yaw: 0, pitch: 0, visible: true };
  if (t < 15) { const p = (t - 8) / 7; return { x: 62, y: 0.8 + p * p * 10, z: 21.8 - p * 29, yaw: 0, pitch: p * 0.24, visible: true }; }
  if (t < 35) { const a = (t - 15) / 20 * Math.PI; return { x: 62 - Math.sin(a) * 23, y: 10.8, z: -7.2 - Math.sin(a) * 12 + (t - 15) / 20 * 9, yaw: Math.atan2(23 * Math.PI / 20 * Math.cos(a), 12 * Math.PI / 20 * Math.cos(a) - 0.45), pitch: 0, visible: true }; }
  const p = (t - 35) / 10;
  return { x: 62, y: 0.8 + (1 - p) * 10, z: 1.8 + p * 27.2, yaw: Math.PI, pitch: -0.12, visible: true };
}
export function sampleRocket(time, reduced = false) {
  const s = sampleWonder('rocket', time), t = s.seconds;
  const ignition = s.active && t >= 10 && t < 32;
  const ascent = Math.max(0, t - 13);
  return { height: reduced || !ignition ? 0 : ascent * ascent * 0.2, flame: ignition && !reduced, visible: !s.active || t < 32, smoke: ignition && !reduced ? Math.min(1, (t - 10) / 3) : 0 };
}
