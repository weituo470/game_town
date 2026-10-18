/**
 * Fictional carrier/air-drone cinema choreography, not targeting or fire-control
 * software. Paths, encounters, misses and outcomes are authored stage events.
 * Absolute milliseconds are the only clock: pause, reverse seek and replay all
 * produce the same poses without accumulating physics or modifying town state.
 */
export const CARRIER_BATTLE_DURATION = 150000;
export const CARRIER_BATTLE_COUNTS = Object.freeze({ attack: 48, defense: 32, shots: 64 });
// Aircraft speed is a trajectory choice, not a playback-rate or score change.
export const CARRIER_BATTLE_FLIGHT = Object.freeze({
  attackAngularSpeed: 0.46, defenseAngularSpeed: 0.42,
  approachMs: 5000, clearDeckMs: 1000, formationMs: 2600,
  protectedExitMs: 300, originalClearDeckMs: 1600, bankWindowMs: 120,
});
export const CARRIER_BATTLE_SCORE = Object.freeze({
  warningEnd: 14000, interceptStart: 38000, transformStart: 58000, liftStart: 78000,
  launchStart: 98000, duelStart: 114000, returnStart: 136000, end: CARRIER_BATTLE_DURATION,
  center: Object.freeze([63, 0, 20]), liftHeight: 30,
});
export const CARRIER_BATTLE_MOUNTS = Object.freeze([
  [55.4, 1.1, 7.5], [70.6, 1.1, 7.5], [55.4, 1.1, 32.5], [70.6, 1.1, 32.5],
].map(Object.freeze));
export const CARRIER_BATTLE_TURRETS = CARRIER_BATTLE_MOUNTS;
export const CARRIER_BATTLE_CHAPTERS = Object.freeze([
  { id: 'warning', label: '港口警戒', start: 0, end: 14000, description: '熟悉的航母港进入科幻演出，海面尽头出现赤色无人机群。' },
  { id: 'approach', label: '赤潮来袭', start: 14000, end: 38000, description: '赤色机群高速逼近，甲板四座近防炮交错连射，金色曳光在海面上空展开。' },
  { id: 'intercept', label: '近防屏障', start: 38000, end: 58000, description: '四座炮持续交错扫射，密集曳光织成火网，命中火花与高速掠过的机影交错。' },
  { id: 'transform', label: '空天觉醒', start: 58000, end: 78000, description: '舰侧装甲展开，升力引擎翻转，普通航母变为空天母舰。' },
  { id: 'lift', label: '母舰升空', start: 78000, end: 98000, description: '四组引擎推开海雾，巨舰缓缓离水，原来的港口仍在下方。' },
  { id: 'launch', label: '苍翼出击', start: 98000, end: 114000, description: '机库开启，三十二架青色无人机逐架出舱，在空天母舰前方展开。' },
  { id: 'duel', label: '双群交锋', start: 114000, end: 136000, description: '赤青两支机群穿插盘旋，电影式能量航迹在母舰周围交错。' },
  { id: 'home', label: '归港收束', start: 136000, end: 150000, description: '赤色机群撤离，青色机群归舱；母舰降回原港，装甲与引擎恢复初始状态。' },
].map(Object.freeze));

const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const u = clamp(value); return u * u * (3 - 2 * u); };
const mix = (a, b, t) => a + (b - a) * t;
const lerp = (a, b, t) => a.map((value, axis) => mix(value, b[axis], t));
const time = value => Number.isFinite(value) ? Math.max(0, Math.min(CARRIER_BATTLE_DURATION, value)) : 0;
const idIn = (value, count) => Number.isFinite(value) ? Math.max(0, Math.min(count - 1, Math.floor(value))) : 0;

function carrierAt(ms, reducedMotion = false) {
  const t = time(ms);
  if (reducedMotion) return { height: 0, deploy: 0, hangar: 0, engine: 0 };
  const home = smooth((t - 136000) / 14000);
  return {
    height: 30 * smooth((t - 78000) / 20000) * (1 - home),
    deploy: smooth((t - 58000) / 18000) * (1 - smooth((t - 143000) / 7000)),
    hangar: smooth((t - 96000) / 2000) * (1 - smooth((t - 148000) / 2000)),
    engine: smooth((t - 72000) / 6000) * (1 - smooth((t - 147000) / 3000)),
  };
}

export function sampleCarrierBattle(ms = 0, { reducedMotion = false } = {}) {
  const elapsed = time(ms);
  const chapter = CARRIER_BATTLE_CHAPTERS.find(item => elapsed >= item.start && elapsed < item.end) || CARRIER_BATTLE_CHAPTERS.at(-1);
  const progress = clamp((elapsed - chapter.start) / (chapter.end - chapter.start));
  const attack = smooth((elapsed - 14000) / 8000) * (1 - smooth((elapsed - 136000) / 13000));
  const defense = smooth((elapsed - 98000) / 12000) * (1 - smooth((elapsed - 136000) / 12000));
  return { program: 'carrier-battle', elapsed, seconds: elapsed / 1000, phase: chapter.id, label: chapter.label,
    cue: chapter.id, cueLabel: chapter.label, description: chapter.description, cueDescription: chapter.description,
    progress, cueProgress: progress, active: elapsed < CARRIER_BATTLE_DURATION, nextIn: 0,
    energy: elapsed >= CARRIER_BATTLE_DURATION ? 0 : reducedMotion ? 0.35 : 0.2 + 0.8 * Math.max(attack, defense),
    carrier: carrierAt(elapsed, reducedMotion), attack, defense };
}

// The stage encounters deliberately include near misses. No nearest-target
// search, projectile ballistics, interception solver or threat optimisation.
export const CARRIER_BATTLE_EVENTS = Object.freeze(Array.from({ length: CARRIER_BATTLE_COUNTS.shots }, (_, index) => {
  if (index < 32) return Object.freeze({ id: index, kind: 'intercept', mountId: index % 4,
    team: 'defense', victimTeam: 'attack', victimId: Math.floor(index / 2) * 3, attackerId: -1, hitTime: 22400 + index * 1100,
    flightMs: 420, willHit: index % 2 === 0 });
  if (index >= 48 && index < 56) {
    const local = index - 48;
    return Object.freeze({ id: index, kind: 'attack', team: 'attack', victimTeam: 'carrier', mountId: -1, victimId: -1,
      attackerId: local * 6 + 2, hitTime: 26000 + local * 3700, flightMs: 560, willHit: local % 2 === 0,
      target: Object.freeze([58 + local % 4 * 3.2, 0.35, 10 + Math.floor(local / 4) * 15]) });
  }
  if (index >= 56) {
    const local = index - 56, team = local % 2 === 0 ? 'attack' : 'defense';
    return Object.freeze({ id: index, kind: 'duel', team, victimTeam: team === 'attack' ? 'defense' : 'attack', mountId: -1,
      attackerId: team === 'attack' ? local * 6 + 2 : local * 4,
      victimId: team === 'attack' ? local * 4 : local * 6 + 2,
      hitTime: 116200 + local * 2200, flightMs: 450, willHit: false });
  }
  const local = index - 32;
  const team = local % 2 === 0 ? 'defense' : 'attack';
  return Object.freeze({ id: index, kind: 'duel', mountId: -1, team, victimTeam: team === 'defense' ? 'attack' : 'defense',
    victimId: team === 'defense' ? local * 3 + 1 : local * 2,
    attackerId: team === 'defense' ? local * 2 : local * 3 + 2,
    hitTime: 115500 + local * 1150, flightMs: 500, willHit: team === 'defense' });
}));

const attackStart = id => 14000 + Math.floor(id / 8) * 850 + (id % 8) * 70;
const defenseStart = id => 98000 + id * 360;
const deathTime = id => id % 3 === 0 ? 22400 + (id / 3) * 2200
  : id % 3 === 1 && ((id - 1) / 3) % 2 === 0 ? 115500 + ((id - 1) / 3) * 1150 : Infinity;

function attackBase(ms, id) {
  const t = time(ms), s = t / 1000;
  const theta = id / 48 * TAU + s * CARRIER_BATTLE_FLIGHT.attackAngularSpeed;
  const lift = carrierAt(t).height;
  let orbit = [78 + Math.cos(theta) * (20 + id % 3 * 2),
    14 + id % 6 * 2.5 + Math.sin(theta * 0.7) * 2 + lift * 0.55,
    23 + Math.sin(theta) * (29 + id % 4)];
  const start = [112 + id % 4 * 2, 16 + id % 6 * 3, -18 + Math.floor(id / 6) * 9];
  orbit = lerp(start, orbit, smooth((t - attackStart(id)) / CARRIER_BATTLE_FLIGHT.approachMs));
  return lerp(orbit, [118 - id % 3, 51 + id % 4 * 2, 71 - id % 5], smooth((t - 136000) / 13000));
}

function deckClearProgress(age) {
  const flight = CARRIER_BATTLE_FLIGHT;
  // Preserve the first 300 ms exactly: both launch lanes stay inside the tested
  // sliding-roof aperture. A Hermite continuation accelerates only once clear,
  // matching position/velocity at this seam and settling at the new 1 s exit.
  if (age <= flight.protectedExitMs) return smooth(age / flight.originalClearDeckMs);
  const u = clamp((age - flight.protectedExitMs) / (flight.clearDeckMs - flight.protectedExitMs));
  const a = flight.protectedExitMs / flight.originalClearDeckMs;
  const start = smooth(a);
  const tangent = 6 * a * (1 - a) / flight.originalClearDeckMs * (flight.clearDeckMs - flight.protectedExitMs);
  return (2 * u ** 3 - 3 * u ** 2 + 1) * start + (u ** 3 - 2 * u ** 2 + u) * tangent + (-2 * u ** 3 + 3 * u ** 2);
}

function defenseBase(ms, id) {
  const t = time(ms), age = t - defenseStart(id), height = carrierAt(t).height;
  const lane = id % 2 ? 0.65 : -0.65;
  const exit = [63 + lane, height + 0.85, 13];
  const clearDeck = [63 + lane, height + 6, 3];
  const theta = id / 32 * TAU - t / 1000 * CARRIER_BATTLE_FLIGHT.defenseAngularSpeed;
  const orbit = [77 + Math.cos(theta) * (14 + id % 4 * 2), 35 + id % 5 * 2 + Math.sin(theta) * 4, 23 + Math.sin(theta) * 25];
  let position = age < CARRIER_BATTLE_FLIGHT.clearDeckMs ? lerp(exit, clearDeck, deckClearProgress(age))
    : lerp(clearDeck, orbit, smooth((age - CARRIER_BATTLE_FLIGHT.clearDeckMs) / CARRIER_BATTLE_FLIGHT.formationMs));
  position = lerp(position, exit, smooth((t - 136000) / (12000 - id * 70)));
  return position;
}

function attackPosition(ms, id) {
  const death = deathTime(id), age = Math.max(0, (time(ms) - death) / 1000);
  const position = attackBase(Math.min(time(ms), death + 1600), id);
  if (age > 0) {
    const u = Math.min(age, 1.6);
    // A short, non-ballistic cinema breakup; a hull never hits the town.
    position[0] = Math.min(119, position[0] + u * u * 1.3);
    position[1] = Math.max(1, position[1] - u * u * 3.2);
    position[2] = Math.min(74, position[2] + u * u * (id % 2 ? 0.8 : -0.8));
  }
  return position;
}

/** Model nose is -Z. Apply Euler(pitch, yaw, bank, 'YXZ'). */
export function sampleBattleDrone(ms, index, team = 'attack', reducedMotion = false) {
  const side = team === 'defense' ? 'defense' : 'attack';
  const id = idIn(index, CARRIER_BATTLE_COUNTS[side]), t = time(ms);
  if (reducedMotion) {
    const row = Math.floor(id / 8), col = id % 8;
    return { id, team: side, position: [side === 'attack' ? 87 + row * 4 : 48 + row * 4,
      18 + row * 2, -14 + col * 9], yaw: side === 'attack' ? Math.PI / 2 : -Math.PI / 2,
      pitch: 0, bank: 0, visible: t >= 14000 && t < 150000, opacity: t >= 14000 && t < 150000 ? 0.65 : 0,
      hit: 0, impactAge: -1, scale: 1 };
  }
  const sample = side === 'attack' ? attackPosition : defenseBase;
  const position = sample(t, id), before = sample(Math.max(0, t - 10), id), after = sample(Math.min(150000, t + 10), id);
  const dx = after[0] - before[0], dy = after[1] - before[1], dz = after[2] - before[2];
  const moving = Math.hypot(dx, dy, dz) > 1e-8;
  const birth = side === 'attack' ? attackStart(id) : defenseStart(id);
  const death = side === 'attack' ? deathTime(id) : Infinity;
  const impactAge = t >= death ? (t - death) / 1000 : -1;
  const hit = impactAge >= 0 && impactAge < 0.9 ? Math.sin(impactAge / 0.9 * Math.PI) : 0;
  const exit = side === 'attack' ? smooth((t - 146000) / 3000)
    : smooth((smooth((t - 136000) / (12000 - id * 70)) - 0.86) / 0.14);
  const opacity = smooth((t - birth) / 500) * (1 - smooth((t - death) / 1600)) * (1 - exit);
  // Coordinate the roll with the actual curved flight path, rather than a
  // separate sine sway. A symmetric time window keeps fast turns smooth and
  // seek-safe; speed gating removes undefined curvature at a stationary exit.
  const bankWindow = CARRIER_BATTLE_FLIGHT.bankWindowMs;
  const bankBefore = sample(Math.max(0, t - bankWindow), id), bankAfter = sample(Math.min(150000, t + bankWindow), id);
  const span = bankWindow / 1000;
  const vx = (bankAfter[0] - bankBefore[0]) / (2 * span), vz = (bankAfter[2] - bankBefore[2]) / (2 * span);
  const ax = (bankAfter[0] - 2 * position[0] + bankBefore[0]) / span ** 2;
  const az = (bankAfter[2] - 2 * position[2] + bankBefore[2]) / span ** 2;
  const horizontalSpeed = Math.hypot(vx, vz);
  const turnRate = horizontalSpeed > 0.01 ? (vz * ax - vx * az) / horizontalSpeed ** 2 : 0;
  const bankEnvelope = smooth((t - birth - (side === 'defense' ? CARRIER_BATTLE_FLIGHT.clearDeckMs : 0))
    / (side === 'defense' ? CARRIER_BATTLE_FLIGHT.formationMs : CARRIER_BATTLE_FLIGHT.approachMs)) * (1 - smooth((t - 136000) / 10000));
  const bank = 0.24 * Math.tanh(horizontalSpeed * turnRate / 4) * smooth(horizontalSpeed / 3) * opacity * bankEnvelope;
  return { id, team: side, position, yaw: moving ? Math.atan2(-dx, -dz) : side === 'attack' ? Math.PI / 2 : 0,
    pitch: moving ? Math.atan2(dy, Math.hypot(dx, dz)) : 0,
    bank,
    visible: t >= birth && t < 150000 && opacity > 0.001, opacity, hit, impactAge, scale: 1 };
}

function eventEnd(event) {
  const point = event.victimTeam === 'carrier' ? [event.target[0], event.target[1] + carrierAt(event.hitTime).height, event.target[2]]
    : event.victimTeam === 'defense' ? defenseBase(event.hitTime, event.victimId) : attackBase(event.hitTime, event.victimId);
  if (!event.willHit) { point[0] += 2.4; point[1] += 3; point[2] += 1.5; }
  return point;
}

function muzzleAt(base, target) {
  const pivot = [base[0], base[1] + 1.4, base[2]];
  const length = Math.max(1e-8, Math.hypot(target[0] - pivot[0], target[1] - pivot[1], target[2] - pivot[2]));
  return { pivot, muzzle: pivot.map((value, axis) => value + (target[axis] - value) / length * 1.45) };
}

/** Shared authored barrel pose; renderer and tracer consume the same muzzle. */
export function sampleBattleTurret(ms, index, reducedMotion = false) {
  const id = idIn(index, 4), t = time(ms), mount = CARRIER_BATTLE_MOUNTS[id];
  const base = [mount[0], mount[1] + carrierAt(t, reducedMotion).height, mount[2]];
  const events = CARRIER_BATTLE_EVENTS.filter(event => event.mountId === id);
  let next = events.find(event => event.hitTime >= t) || events.at(-1);
  const previous = events[Math.max(0, events.indexOf(next) - 1)];
  const target = reducedMotion ? [base[0] + 16, base[1] + 10, base[2] - 20]
    : lerp(eventEnd(previous), eventEnd(next), smooth((t - previous.hitTime - 250) / Math.max(1, next.hitTime - next.flightMs - previous.hitTime - 400)));
  const { pivot, muzzle } = muzzleAt(base, target);
  return { id, base, pivot, muzzle, target,
    active: !reducedMotion && events.some(event => t >= event.hitTime - event.flightMs && t < event.hitTime) };
}

/** start/end are the complete authored segment; progress locates its tracer head. */
export function sampleBattleShot(ms, index, reducedMotion = false) {
  const event = CARRIER_BATTLE_EVENTS[idIn(index, CARRIER_BATTLE_COUNTS.shots)], t = time(ms);
  const startTime = event.hitTime - event.flightMs;
  const end = eventEnd(event), progress = clamp((t - startTime) / event.flightMs);
  const start = event.mountId >= 0 ? sampleBattleTurret(t, event.mountId, reducedMotion).muzzle
    : event.team === 'attack' ? attackPosition(t, event.attackerId) : defenseBase(t, event.attackerId);
  const visible = !reducedMotion && t >= startTime && t < event.hitTime;
  const impactAge = !reducedMotion && event.willHit && t >= event.hitTime ? (t - event.hitTime) / 1000 : -1;
  const hit = impactAge >= 0 && impactAge < 0.9 ? Math.sin(impactAge / 0.9 * Math.PI) : 0;
  return { id: event.id, kind: event.kind, team: event.team, mountId: event.mountId, victimId: event.victimId, victimTeam: event.victimTeam,
    start, end, impact: end.slice(), progress, visible, opacity: visible ? 0.8 : 0,
    hit, impactAge, willHit: event.willHit };
}
