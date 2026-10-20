// One shared, deterministic sea route for the room authority and every renderer.
// This is a game experience, not a navigation system for a real vessel.
import { isOffshoreDeckWalkable } from './offshore-deck.js';
export const OFFSHORE_ISLAND = Object.freeze({ id: 'offshore', name: '远海浮动岛', x: 16, z: 85, width: 26, length: 38, deckY: 8 });
export const OFFSHORE_DOCK = Object.freeze({ x: 16, z: 58, width: 18, depth: 12 });
export const OFFSHORE_BRIDGE = Object.freeze({ x: 16, z: 46, width: 6, depth: 16 });
export const OFFSHORE_ARRIVAL = Object.freeze({ x: 16, z: 61, yaw: 0 });
export const OFFSHORE_CRUISE_MS = 150000;
export const OFFSHORE_SEATS = 8;
export const OFFSHORE_ACTIONS = Object.freeze(['board', 'depart', 'return', 'disembark']);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const inRect = (x, z, r) => Math.abs(x - r.x) <= r.width / 2 - 0.2 && Math.abs(z - r.z) <= r.depth / 2 - 0.2;

export function inOffshoreGround(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) && (inRect(x, z, OFFSHORE_DOCK) || inRect(x, z, OFFSHORE_BRIDGE));
}
export function offshoreDestination(id) { return id === 'offshore' ? { ...OFFSHORE_ARRIVAL } : null; }
export function offshorePlan(value) {
  return { startAt: Math.max(0, finite(value?.startAt ?? value?.offshoreStartAt)), returnAt: Math.max(0, finite(value?.returnAt ?? value?.offshoreReturnAt)) };
}
export function offshoreTime(snapshot, nowPerf, fallbackEpoch = 0, fallbackPerf = 0) {
  const now = Math.max(0, finite(nowPerf));
  if (Number.isFinite(snapshot?.serverTime) && snapshot.serverTime > 0 && Number.isFinite(snapshot.receivedAtPerf) && snapshot.receivedAtPerf <= now) {
    return snapshot.serverTime + now - snapshot.receivedAtPerf;
  }
  return Math.max(0, finite(fallbackEpoch)) + Math.max(0, now - finite(fallbackPerf));
}
export function offshoreReturnDuration(plan) {
  const p = offshorePlan(plan);
  const remaining = OFFSHORE_CRUISE_MS - Math.max(0, p.returnAt - p.startAt);
  return clamp(remaining, 1, 25000);
}
export function offshoreVoyageElapsed(plan, now) {
  const p = offshorePlan(plan);
  if (!p.startAt) return 0;
  const elapsed = Math.max(0, finite(now) - p.startAt);
  if (p.returnAt >= p.startAt && p.returnAt > 0 && now >= p.returnAt) {
    const anchor = clamp(p.returnAt - p.startAt, 0, OFFSHORE_CRUISE_MS);
    // Continue the same safe path. No teleport or straight shortcut through land.
    return clamp(anchor + (now - p.returnAt) / offshoreReturnDuration(p) * (OFFSHORE_CRUISE_MS - anchor), 0, OFFSHORE_CRUISE_MS);
  }
  return clamp(elapsed, 0, OFFSHORE_CRUISE_MS);
}

export function sampleOffshoreVoyage(plan, now) {
  const p = offshorePlan(plan), elapsed = offshoreVoyageElapsed(p, now), seconds = elapsed / 1000;
  const docked = !p.startAt || elapsed >= OFFSHORE_CRUISE_MS;
  let x = 16, z = 85, yaw = 0, phase = 'docked', label = '靠港待命';
  if (!docked && seconds < 28) {
    phase = 'departing'; label = '离港 · 驶向远海';
    z += 51 * smooth(seconds / 28);
    yaw = Math.PI / 2 * smooth((seconds - 22) / 6);
  } else if (!docked && seconds < 112) {
    phase = 'cruising'; label = '远海巡航';
    const a = Math.PI * 2 * smooth((seconds - 28) / 84);
    x = 16 + 48 * Math.sin(a); z = 184 - 48 * Math.cos(a);
    yaw = Math.PI / 2 - a;
  } else if (!docked && seconds < 122) {
    phase = 'observing'; label = '远海驻留 · 回望小镇';
    z = 136; yaw = Math.PI / 2 * (1 - smooth((seconds - 112) / 10));
  } else if (!docked) {
    phase = 'returning'; label = '返航 · 倒车靠泊';
    z = 136 - 51 * smooth((seconds - 122) / 28);
  }
  const returning = !docked && p.returnAt >= p.startAt && p.returnAt > 0 && now >= p.returnAt;
  if (returning) { phase = 'returning'; label = '提前返航 · 沿安全航线回港'; }
  const wave = docked ? 0 : Math.sin(Math.PI * clamp(elapsed / 4000, 0, 1) / 2) * Math.sin(Math.PI * clamp((OFFSHORE_CRUISE_MS - elapsed) / 4000, 0, 1) / 2);
  const t = finite(now) / 1000;
  const y = Math.sin(t * 0.75) * 0.11 * wave;
  const roll = Math.sin(t * 0.46) * 0.004 * wave, pitch = Math.sin(t * 0.38) * 0.003 * wave;
  const remainingMs = docked ? 0 : returning ? Math.max(0, p.returnAt + offshoreReturnDuration(p) - now) : OFFSHORE_CRUISE_MS - elapsed;
  const distanceFromPort = Math.hypot(x - OFFSHORE_ISLAND.x, z - OFFSHORE_ISLAND.z);
  return { x, y, z, yaw, pitch, roll, phase, label, progress: elapsed / OFFSHORE_CRUISE_MS, moving: !docked && phase !== 'observing', docked, remainingMs, distanceFromPort };
}

export function offshoreSeatLocal(seat = 0) {
  const i = clamp(Number.isInteger(seat) ? seat : 0, 0, OFFSHORE_SEATS - 1);
  // Left-side observation corridor, clear of the front cabin and cranes.
  return { x: -8, y: OFFSHORE_ISLAND.deckY, z: 4 + i };
}
export function offshoreLocalToWorld(ship, p) {
  // Matches a THREE Euler XYZ transform exactly, including deck heave and tilt.
  const cz = Math.cos(ship.roll), sz = Math.sin(ship.roll), cy = Math.cos(ship.yaw), sy = Math.sin(ship.yaw), cx = Math.cos(ship.pitch), sx = Math.sin(ship.pitch);
  const ax = p.x * cz - p.y * sz, ay = p.x * sz + p.y * cz;
  const bx = ax * cy + p.z * sy, bz = -ax * sy + p.z * cy;
  return { x: ship.x + bx, y: ship.y + ay * cx - bz * sx, z: ship.z + ay * sx + bz * cx };
}
export function worldToOffshoreLocal(ship, p) {
  // Reverse XYZ's actual multiplication order: inverse X, then Y, then Z.
  const x = p.x - ship.x, y = p.y - ship.y, z = p.z - ship.z;
  const cz = Math.cos(ship.roll), sz = Math.sin(ship.roll), cy = Math.cos(ship.yaw), sy = Math.sin(ship.yaw), cx = Math.cos(ship.pitch), sx = Math.sin(ship.pitch);
  const ay = y * cx + z * sx, az = -y * sx + z * cx;
  const bx = x * cy - az * sy, bz = x * sy + az * cy;
  return { x: bx * cz + ay * sz, y: -bx * sz + ay * cz, z: bz };
}
export function sampleOffshorePassenger(plan, now, seat = 0, local) {
  const ship = sampleOffshoreVoyage(plan, now), origin = offshoreSeatLocal(seat);
  const valid = isOffshoreDeckWalkable(local?.deckX, local?.deckZ);
  const p = valid ? { x: local.deckX, y: OFFSHORE_ISLAND.deckY, z: local.deckZ } : origin;
  const deckYaw = finite(local?.deckYaw);
  return { ...offshoreLocalToWorld(ship, p), yaw: ship.yaw + deckYaw,
    aboard: true, offshoreSeat: clamp(Number.isInteger(seat) ? seat : 0, 0, OFFSHORE_SEATS - 1),
    deckX: p.x, deckZ: p.z, deckYaw,
    vy: 0, moving: valid && local?.moving === true, jetpack: false, thrusting: false, hovering: false };
}
export function canBoardOffshore(player, plan, now) {
  return player?.connected !== false && player?.aboard !== true && finite(player?.y, 99) < 1.5
    && Math.hypot(finite(player?.x, 999) - OFFSHORE_ARRIVAL.x, finite(player?.z, 999) - OFFSHORE_ARRIVAL.z) <= 5
    && sampleOffshoreVoyage(plan, now).docked;
}
