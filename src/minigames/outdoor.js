// Local practice rules, deliberately independent of room authority and currency.
import { FISHING_SPOT } from '../../shared/river.js';
export const OUTDOOR_GAMES = Object.freeze([
  { id: 'fishing', name: '钓鱼', place: '西岸河畔', ...FISHING_SPOT, color: '#69c6bc', description: '站在河岸木栈台上，把鱼钩抛向流水。浮漂下沉时，及时收竿。', controls: '空格 / 点按：抛竿、收竿。等“咬钩了”再提竿，太早或太晚都会空手而归。' },
  { id: 'hop', name: '跳一跳', place: '北境跳台', x: -17, z: -33, color: '#edb979', description: '按住蓄力，松开起跳，连续跳过 8 块平台。', controls: '按住空格或“蓄力”按钮，力度进入绿色区间时松开。' },
  { id: 'jetpack', name: '喷气背包', place: '全区域可用', global: true, color: '#b7a2ed', description: '不必进入场馆，随时长按空格升空，松开下落。', controls: '长按空格上升，松开下落；WASD 自由飞行。' },
]);
export const OUTDOOR_MAP = Object.fromEntries(OUTDOOR_GAMES.map(game => [game.id, game]));
export const FISH = Object.freeze([
  { id: 'crucian', name: '银鲫鱼', color: '#bdd8df', points: 10, rarity: '常见', length: [12, 25], weight: [0.12, 0.65] },
  { id: 'carp', name: '红锦鲤', color: '#f18b6f', points: 25, rarity: '少见', length: [22, 46], weight: [0.45, 1.9] },
  { id: 'gold', name: '金尾鱼', color: '#f1ce69', points: 50, rarity: '稀有', length: [18, 35], weight: [0.25, 1.2] },
]);
export const HOP_PLATFORMS = Object.freeze(Array.from({ length: 9 }, (_, i) => ({ x: -17 + i * 3.8, z: -33 + (i % 2 ? 0.7 : 0), y: 1.05, radius: 1.08 })));
export const OUTDOOR_STORAGE_KEY = 'playtown.outdoor.v1';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomUnit = random => clamp(Number(random()) || 0, 0, 0.999999);

export function createOutdoorGame(id) {
  if (!Object.hasOwn(OUTDOOR_MAP, id)) return null;
  const game = OUTDOOR_MAP[id];
  if (!game || game.global) return null;
  const p = id === 'hop' ? HOP_PLATFORMS[0] : { x: game.x, z: game.z, y: 0 };
  return { id, status: 'ready', phase: 'idle', paused: false, elapsed: 0, score: 0, held: false, left: false, right: false,
    pose: { ...p, yaw: id === 'hop' ? Math.PI / 2 : FISHING_SPOT.yaw, moving: false },
    message: game.description, event: 0, catches: [], fish: null, charge: 0, platform: 0, combo: 0,
    fuel: 100, vy: 0, ring: 0, hits: [], missed: [], won: false };
}
export function beginOutdoorGame(state) {
  if (!state || state.status !== 'ready') return;
  state.status = 'playing';
  state.paused = false;
  state.phase = state.id === 'hop' ? 'grounded' : 'idle';
  state.message = state.id === 'fishing' ? '水面很平静，抛一竿试试。' : state.id === 'hop' ? '按住蓄力，松开起跳。' : '按住上升，松开下降；先对准第 1 个圆环。';
}
export function cancelOutdoorInput(state) {
  if (!state) return;
  state.held = false; state.left = false; state.right = false;
  if (state.phase === 'charging') { state.phase = 'grounded'; state.charge = 0; }
}
export function setOutdoorPaused(state, value) {
  if (!state || state.status === 'finished') return;
  cancelOutdoorInput(state);
  state.paused = !!value;
}
export function hopChargeWindow(state) {
  const target = HOP_PLATFORMS[state.platform + 1];
  if (!target) return { min: 0, max: 0, ideal: 0 };
  const distance = Math.hypot(target.x - state.pose.x, target.z - state.pose.z);
  return { min: clamp((distance - 0.82 - 1) / 5.5, 0, 1), max: clamp((distance + 0.82 - 1) / 5.5, 0, 1), ideal: clamp((distance - 1) / 5.5, 0, 1) };
}
function finish(state, message, won = false) {
  state.status = 'finished'; state.message = message; state.won = won;
  cancelOutdoorInput(state); state.pose.moving = false; state.event += 1;
}
export function pressOutdoorAction(state, random = Math.random) {
  if (!state || state.status !== 'playing' || state.paused || state.held) return;
  state.held = true;
  if (state.id === 'fishing') {
    if (['idle', 'caught', 'missed'].includes(state.phase)) {
      state.phase = 'casting'; state.timer = 0; state.biteAt = 2.4 + randomUnit(random) * 2.4;
      state.fish = null; state.message = '抛竿中，鱼线正落向河面…';
    } else if (state.phase === 'waiting') {
      state.phase = 'missed'; state.message = '提竿早了，鱼儿还没咬钩。再试一竿吧。';
    } else if (state.phase === 'bite') {
      const roll = randomUnit(random);
      const species = FISH[roll < 0.62 ? 0 : roll < 0.9 ? 1 : 2];
      state.fish = { ...species, lengthCm: Math.round((species.length[0] + (species.length[1] - species.length[0]) * randomUnit(random)) * 10) / 10,
        weightKg: Math.round((species.weight[0] + (species.weight[1] - species.weight[0]) * randomUnit(random)) * 100) / 100 };
      state.catches.push(state.fish.id); state.score += state.fish.points; state.event += 1;
      state.phase = 'lifting'; state.timer = 0; state.message = '上钩了！正在收线，把鱼儿提上来…';
    }
  } else if (state.id === 'hop' && state.phase === 'grounded') {
    state.phase = 'charging'; state.charge = 0;
  }
}
export function releaseOutdoorAction(state) {
  if (!state) return;
  const wasHeld = state.held; state.held = false;
  if (!wasHeld || state.paused || state.status !== 'playing' || state.id !== 'hop' || state.phase !== 'charging') return;
  const target = HOP_PLATFORMS[state.platform + 1];
  if (!target) return;
  const distance = Math.hypot(target.x - state.pose.x, target.z - state.pose.z);
  const reach = 1 + state.charge * 5.5;
  state.launch = { x: state.pose.x, z: state.pose.z, toX: state.pose.x + (target.x - state.pose.x) / distance * reach, toZ: state.pose.z + (target.z - state.pose.z) / distance * reach, duration: 0.7 + state.charge * 0.25 };
  state.timer = 0; state.phase = 'flight'; state.pose.moving = true;
}

export function stepOutdoorGame(state, seconds) {
  if (!state || state.status !== 'playing' || state.paused || !Number.isFinite(seconds) || seconds <= 0) return state;
  // Substeps make flight/ring intersections stable, even on a low frame rate.
  let remaining = Math.min(seconds, 0.25);
  while (remaining > 0 && state.status === 'playing') {
    const dt = Math.min(remaining, 1 / 120); remaining -= dt; state.elapsed += dt;
    if (state.id === 'fishing') {
      if (state.phase === 'casting') {
        state.timer += dt;
        if (state.timer >= 0.65) { state.phase = 'waiting'; state.timer = 0; state.message = '鱼钩已入水，观察浮漂，等咬钩再收竿…'; }
      } else if (state.phase === 'lifting') {
        state.timer += dt;
        if (state.timer >= 0.85) { state.phase = 'caught'; state.timer = 0; state.message = `钓到了${state.fish.name}！+${state.fish.points} 分。`; }
      } else if (state.phase === 'waiting') {
        state.timer += dt;
        if (state.timer >= state.biteAt) { state.phase = 'bite'; state.timer = 0; state.message = '咬钩了！现在收竿！'; }
      } else if (state.phase === 'bite') {
        state.timer += dt;
        if (state.timer > 1.8) { state.phase = 'missed'; state.message = '慢了一点，鱼儿游走了。再来一竿？'; }
      }
    } else if (state.id === 'hop') {
      if (state.phase === 'charging') state.charge = Math.min(1, state.charge + dt / 1.1);
      if (state.phase === 'flight') {
        state.timer += dt;
        const t = Math.min(1, state.timer / state.launch.duration);
        state.pose.x = state.launch.x + (state.launch.toX - state.launch.x) * t;
        state.pose.z = state.launch.z + (state.launch.toZ - state.launch.z) * t;
        state.pose.y = 1.05 + Math.sin(t * Math.PI) * 2.4;
        if (t >= 1) {
          const target = HOP_PLATFORMS[state.platform + 1];
          const error = Math.hypot(state.pose.x - target.x, state.pose.z - target.z);
          state.pose.moving = false;
          if (error > 0.82) { state.phase = 'falling'; state.timer = 0; state.message = '没站稳，掉下去了…'; }
          else {
            state.platform += 1; state.combo = error < 0.28 ? state.combo + 1 : 0;
            const points = error < 0.28 ? 20 + state.combo * 5 : 10;
            state.score += points; state.charge = 0; state.event += 1; state.phase = 'grounded';
            state.message = error < 0.28 ? `正中靶心！${state.combo} 连击，+${points} 分。` : `站稳了！+${points} 分，继续蓄力。`;
            if (state.platform === HOP_PLATFORMS.length - 1) finish(state, `通关！连续越过 8 块跳台，获得 ${state.score} 分。`, true);
          }
        }
      } else if (state.phase === 'falling') {
        state.timer += dt; state.pose.y = Math.max(0, 1.05 - state.timer * 4);
        if (state.pose.y === 0) finish(state, `本次跳过 ${state.platform} 块平台，获得 ${state.score} 分。再来一次？`);
      }
    }
  }
  return state;
}

export function nearestOutdoorGame(pose, radius = 3.4) {
  return OUTDOOR_GAMES.find(game => !game.global && Math.hypot(pose.x - game.x, pose.z - game.z) < radius)?.id || null;
}
export function sanitizeOutdoorRecords(value) {
  const records = { best: { fishing: 0, hop: 0, jetpack: 0 }, fish: {} };
  for (const id of Object.keys(records.best)) {
    const score = value?.best?.[id];
    if (Number.isFinite(score)) records.best[id] = clamp(Math.floor(score), 0, 1000000);
  }
  for (const fish of FISH) if (Number.isSafeInteger(value?.fish?.[fish.id]) && value.fish[fish.id] > 0) records.fish[fish.id] = Math.min(1000000, value.fish[fish.id]);
  return records;
}
