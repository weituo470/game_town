/** Original stage interpretation of the human fleet's defeat in The Dark Forest.
 * 216 vessels are a representative formation, not the novel's exact fleet count.
 * The probe is a separate mirror-surface object: NO drone impersonates it.
 * All 4096 drone identities remain available for the cube, ships and recovery.
 */
export const DROPLET_DURATION = 150000;
export const DROPLET_CYCLE = 180000;
const TAU = Math.PI * 2;
const clamp = v => Math.min(1, Math.max(0, v));
const smooth = v => { const u = clamp(v); return u * u * (3 - 2 * u); };
const mix = (a, b, u) => a + (b - a) * u;
const timeInCycle = value => Number.isFinite(value) ? ((value % DROPLET_CYCLE) + DROPLET_CYCLE) % DROPLET_CYCLE : 0;
const STRIKE_START_MS = 64000;
const PASS_MS = 280;
const TURN_MS = 70;
const PASS_SECONDS = PASS_MS / 1000;
const TURN_SECONDS = TURN_MS / 1000;
const FIRST_HIT_MS = STRIKE_START_MS + PASS_MS / 4;
const LAST_HIT_MS = STRIKE_START_MS + 35 * (PASS_MS + TURN_MS) + PASS_MS * 3 / 4;
const POST_HIT_SILENCE_MS = 1250;
// One fixed offset for every vessel: the explosion sequence is an exact time
// translation of the penetration sequence, and cannot begin before ALL hits.
const EXPLOSION_DELAY_SECONDS = (LAST_HIT_MS - FIRST_HIT_MS + POST_HIT_SILENCE_MS) / 1000;
const PASS_HALF_WIDTH = 150;
const TURN_APEX = 190;
const ROWS = Object.freeze(Array.from({ length: 36 }, (_, row) => {
  const layer = Math.floor(row / 6), rank = row % 6;
  return Object.freeze({ row, layer, yIndex: layer % 2 ? 5 - rank : rank,
    y: 55 + (layer % 2 ? 5 - rank : rank) * 30, z: -125 + layer * 30,
    direction: row % 2 ? -1 : 1, start: (STRIKE_START_MS + row * (PASS_MS + TURN_MS)) / 1000,
    end: (STRIKE_START_MS + row * (PASS_MS + TURN_MS) + PASS_MS) / 1000 });
}));
export const DROPLET_SCORE = Object.freeze({
  fleetStart: 28000, cubeHoldEnd: 36000, morphEnd: 44000,
  detailStart: 44000, detailHold: 50000, warningStart: 60000, strikeStart: STRIKE_START_MS,
  firstTurn: ROWS[0].end * 1000, collapseStart: LAST_HIT_MS + POST_HIT_SILENCE_MS,
  firstHit: FIRST_HIT_MS, lastHit: LAST_HIT_MS, postHitSilence: POST_HIT_SILENCE_MS,
  explosionDelay: EXPLOSION_DELAY_SECONDS * 1000,
  lastExplosion: LAST_HIT_MS + EXPLOSION_DELAY_SECONDS * 1000,
  silenceStart: 104000, silenceHold: 108000, returnStart: 114000,
  landingStart: 134000, blackoutStart: 148000, end: DROPLET_DURATION,
  count: 4096, ships: 216, shipEnd: 4096, dropletEnd: 4096,
  cubeCenter: Object.freeze([0, 130, -50]), cubeEdge: 150,
  detailCenter: Object.freeze([0, 135, 65]),
  passSeconds: PASS_SECONDS, turnSeconds: TURN_SECONDS,
  passHalfWidth: PASS_HALF_WIDTH, turnApex: TURN_APEX,
  attackEnd: ROWS.at(-1).end * 1000,
  passes: Object.freeze(ROWS.map(row => Object.freeze([row.start, row.end]))),
});

/** Seconds, not milliseconds. Hit time is derived from geometric center crossing. */
export const DROPLET_SHIPS = Object.freeze(Array.from({ length: 216 }, (_, index) => {
  const xIndex = index % 6, yIndex = Math.floor(index / 6) % 6, zIndex = Math.floor(index / 36);
  const row = ROWS[zIndex * 6 + (zIndex % 2 ? 5 - yIndex : yIndex)];
  const x = -75 + xIndex * 30;
  const fraction = (row.direction > 0 ? x + PASS_HALF_WIDTH : PASS_HALF_WIDTH - x) / (PASS_HALF_WIDTH * 2);
  const hitTime = row.start + fraction * PASS_SECONDS;
  return Object.freeze({ index, position: Object.freeze([x, 55 + yIndex * 30, -125 + zIndex * 30]),
    hitTime, explodeTime: hitTime + EXPLOSION_DELAY_SECONDS });
}));

export const DROPLET_CHAPTERS = Object.freeze([
  { id: 'lighting', label: '群星待命', start: 0, end: 8000, description: '四千零九十六架无人机点亮，准备演绎人类联合舰队的命运。' },
  { id: 'ascent', label: '舰队升空', start: 8000, end: 28000, description: '机群离开四座起降阵列，在广阔夜空构筑三维立方点阵。' },
  { id: 'fleet', label: '钢铁的自信', start: 28000, end: 44000, description: '立方光阵幻化为二百一十六艘太空战舰，代表庞大人类联合舰队，并非原著舰数。' },
  { id: 'droplet', label: '完美的水滴', start: 44000, end: 60000, description: '独立的银色镜面探测器显露圆头尖尾，表面完整如镜，不由无人机组成。' },
  { id: 'warning', label: '骤静', start: 60000, end: 64000, description: '无声的镜面水滴转向舰阵；规则而自信的队列尚未意识到危险。' },
  { id: 'strike', label: '极速贯穿', start: STRIKE_START_MS, end: DROPLET_SCORE.attackEnd, description: '水滴以更快速度穿过全部二百一十六艘战舰，锐角折返不减速；此刻舰体只留下热灼光，尚无一舰爆炸。' },
  { id: 'suspense', label: '命中后的寂静', start: DROPLET_SCORE.attackEnd, end: DROPLET_SCORE.collapseStart, description: '全部穿透已经完成。完整的舰阵停在寂静中，最后一次命中后仍留出一瞬空白。' },
  { id: 'collapse', label: '人类舰队溃灭', start: DROPLET_SCORE.collapseStart, end: 104000, description: '毁灭终于追上舰队：每艘战舰统一延迟 13.64 秒爆炸，顺序与时间间隔精确重现刚才的撞击节奏。' },
  { id: 'silence', label: '寂静的宇宙', start: 104000, end: 114000, description: '没有胜利烟火，只有完整的镜面水滴与暗淡残骸。这是这支编队的覆灭，不是全人类的终结。' },
  { id: 'returning', label: '众星归航', start: 114000, end: 134000, description: '故事结束，所有灯点重新成为无人机，沿四条光河返回起降区；毁灭的战舰不会复活。' },
  { id: 'landing', label: '落星成阵', start: 134000, end: 148000, description: '每一架无人机降回最初的位置，完成整场演出的回收。' },
  { id: 'blackout', label: '余光谢幕', start: 148000, end: 150000, description: '四座起降阵列熄灯，夜空恢复宁静。' },
  { id: 'waiting', label: '静候星起', start: 150000, end: 180000, description: '无人机已全部回收，等待下一场演出。' },
].map(Object.freeze));

export function sampleDropletShow(timeMs = 0) {
  const elapsed = timeInCycle(timeMs), seconds = elapsed / 1000;
  const chapter = DROPLET_CHAPTERS.find(item => elapsed >= item.start && elapsed < item.end);
  const progress = (elapsed - chapter.start) / (chapter.end - chapter.start);
  const energy = seconds < 8 ? .42 * smooth(seconds / 8)
    : seconds < 28 ? mix(.42, 1, smooth((seconds - 8) / 20))
      : seconds < 60 ? 1 : seconds < 64 ? mix(1, .7, smooth((seconds - 60) / 4))
        : seconds < 104 ? .7 : seconds < 114 ? .32 : seconds < 134 ? mix(.32, .5, smooth((seconds - 114) / 20))
          : seconds < 148 ? .5 : seconds < 150 ? .5 * (1 - smooth((seconds - 148) / 2)) : 0;
  return { program: 'droplet', elapsed, seconds, phase: chapter.id, label: chapter.label,
    description: chapter.description, progress, active: elapsed < DROPLET_DURATION, energy,
    cue: chapter.id, cueLabel: chapter.label, cueDescription: chapter.description, cueProgress: progress,
    nextIn: elapsed >= DROPLET_DURATION ? DROPLET_CYCLE - elapsed : 0 };
}

/** [x,y,z,headingXY,scale,dirX,dirY,dirZ]. Geometry's rounded nose points +X.
 * Old five-element callers remain supported. Position is continuous, but attack
 * direction changes INSTANTLY at each corner; it is intentionally not a spline.
 */
export function sampleDropletHead(timeMs, output = new Float64Array(8), options = null) {
  const s = timeInCycle(timeMs) / 1000;
  let x = 0, y = 135, z = 65, dx = 1, dy = 0, dz = 0, scale = 0;
  if (options?.reducedMotion) {
    scale = 4 * smooth((s - 44) / 6) * (1 - smooth((s - 114) / 2));
  } else if (s >= 44 && s < 60) {
    const u = smooth((s - 44) / 6);
    x = mix(-120, 0, u); y = mix(205, 135, u); scale = mix(1.4, 4, u);
  } else if (s >= 60 && s < 64) {
    const u = smooth((s - 60) / 4);
    x = mix(0, -PASS_HALF_WIDTH, u); y = mix(135, 55, u); z = mix(65, -125, u); scale = mix(4, 1.4, u);
  } else if (s >= 64 && s <= ROWS.at(-1).end) {
    scale = 1.4;
    const index = Math.min(35, Math.floor((s - 64) / (PASS_SECONDS + TURN_SECONDS)));
    const row = ROWS[index];
    if (s <= row.end || index === 35) {
      const u = clamp((s - row.start) / PASS_SECONDS);
      x = row.direction * mix(-PASS_HALF_WIDTH, PASS_HALF_WIDTH, u); y = row.y; z = row.z; dx = row.direction;
    } else {
      const next = ROWS[index + 1], u = clamp((s - row.end) / TURN_SECONDS);
      const half = u < .5 ? 0 : 1;
      // Two straight segments meet at an exterior point: the interior angle
      // is acute, while velocity direction jumps with no slowing or banking.
      x = row.direction * (half ? mix(TURN_APEX, PASS_HALF_WIDTH, (u - .5) * 2) : mix(PASS_HALF_WIDTH, TURN_APEX, u * 2));
      y = mix(row.y, next.y, u); z = mix(row.z, next.z, u);
      dx = row.direction * (half ? -1 : 1) * (TURN_APEX - PASS_HALF_WIDTH) * 2;
      dy = next.y - row.y; dz = next.z - row.z;
    }
  } else if (s > ROWS.at(-1).end && s < 104) {
    // The complete attack has ended before any explosion. Finish the straight
    // exit, then remain visible while the delayed hit rhythm is replayed.
    const exitEnd = ROWS.at(-1).end + .6;
    if (s < exitEnd) {
      const u = clamp((s - ROWS.at(-1).end) / .6);
      x = mix(-PASS_HALF_WIDTH, -TURN_APEX, u); y = 55; z = 25; dx = -1;
    } else {
      const u = smooth((s - exitEnd) / (104 - exitEnd));
      x = mix(-TURN_APEX, -85, u); y = mix(55, 105, u); z = mix(25, 55, u);
      dx = 105; dy = 50; dz = 30;
    }
    scale = 1.4;
  } else if (s >= 104 && s < 116) {
    const u = smooth((s - 104) / 4);
    x = mix(-85, 0, u); y = mix(105, 135, u); z = mix(55, 65, u);
    scale = mix(1.4, 4, u) * (1 - smooth((s - 114) / 2));
  }
  const length = Math.hypot(dx, dy, dz) || 1;
  output[0] = x; output[1] = y; output[2] = z;
  output[3] = Math.atan2(dy, dx); output[4] = scale;
  output[5] = dx / length; output[6] = dy / length; output[7] = dz / length;
  return output;
}

/** Reusable renderer state: [x,y,z,scale,opacity,heat,explosion,debrisProgress].
 * heat begins AFTER center penetration. Explosion begins only after its delay.
 * Ship entities fade in behind the drone-to-hull morph and never return alive.
 */
export function sampleDoomsdayShip(shipIndex, timeMs, output = new Float32Array(8), options = null) {
  const ship = DROPLET_SHIPS[shipIndex];
  if (!ship) { output.fill(0); return output; }
  const s = timeInCycle(timeMs) / 1000, age = s - ship.explodeTime;
  const formed = smooth((s - 38) / 6), reduced = Boolean(options?.reducedMotion);
  const present = s >= 36 && s < 114;
  const destruction = reduced ? smooth(age / 6) : smooth(age / .8);
  output[0] = ship.position[0]; output[1] = ship.position[1]; output[2] = ship.position[2];
  output[3] = present ? mix(.75, 1, formed) : 0;
  output[4] = present ? formed * (1 - destruction) : 0;
  output[5] = present && !reduced && s > ship.hitTime ? smooth((s - ship.hitTime) / (ship.explodeTime - ship.hitTime)) * (1 - smooth(age / .65)) : 0;
  output[6] = present && !reduced && age > 0 ? smooth(age / .08) * (1 - smooth((age - .12) / .85)) : 0;
  output[7] = present && !reduced ? smooth(age / 4) : 0;
  return output;
}

const SHIP_HULL = Object.freeze([
  [5.5, 0, 0], [2.2, 1.2, 2], [-4, 1.2, 2], [-5.5, .5, 1.7],
  [-5.5, -.8, 1.7], [2.6, -.9, 1.4], [5.5, 0, 0],
]);
function samplePolyline(points, fraction, output, offset, side = 1) {
  const coordinate = Math.min(points.length - 1, Math.max(0, fraction * (points.length - 1)));
  const index = Math.min(points.length - 2, Math.floor(coordinate)), u = coordinate - index;
  output[offset] = mix(points[index][0], points[index + 1][0], u);
  output[offset + 1] = mix(points[index][1], points[index + 1][1], u);
  output[offset + 2] = mix(points[index][2], points[index + 1][2], u) * side;
}
function createBuffers(fleet) {
  const { count, identities } = fleet;
  const b = { roles: new Uint8Array(count), shipIndices: new Uint16Array(count),
    anchors: new Float32Array(count * 3), offsets: new Float32Array(count * 3),
    cube: new Float32Array(count * 3), scatter: new Float32Array(count * 3),
    hitTimes: new Float64Array(count), explodeTimes: new Float64Array(count),
    finale: new Float32Array(count * 3), finaleReduced: new Float32Array(count * 3) };
  for (let i = 0; i < count; i++) {
    const identity = identities[i], k = i * 3;
    const shipIndex = Math.floor(identity * 216 / 4096), ship = DROPLET_SHIPS[shipIndex];
    const first = Math.ceil(shipIndex * 4096 / 216), local = identity - first;
    const n = Math.ceil((shipIndex + 1) * 4096 / 216) - first;
    b.shipIndices[i] = shipIndex;
    b.hitTimes[i] = ship.hitTime; b.explodeTimes[i] = ship.explodeTime;
    b.anchors.set(ship.position, k);
    // Exact 16^3 cube with 10-unit spacing and no lights reserved for a probe.
    b.cube[k] = -75 + (identity % 16) * 10;
    b.cube[k + 1] = 55 + (Math.floor(identity / 16) % 16) * 10;
    b.cube[k + 2] = -125 + Math.floor(identity / 256) * 10;
    if (local < 16) samplePolyline(SHIP_HULL, (local % 8) / 7, b.offsets, k, local < 8 ? -1 : 1);
    else {
      b.offsets[k] = -5.5;
      b.offsets[k + 1] = local === n - 1 ? 1.9 : -.1;
      b.offsets[k + 2] = local === 16 ? -1 : local === 17 ? 1 : 0;
    }
    // Match the 1.55x solid warship geometry without changing cube spacing,
    // ship centers, penetration times or the independent mirror-probe route.
    b.offsets[k] *= 1.55; b.offsets[k + 1] *= 1.55; b.offsets[k + 2] *= 1.55;
    const phase = identity * 2.399963229728653;
    b.scatter[k] = Math.sin(phase) * (3 + local % 5);
    b.scatter[k + 1] = -2 - (local % 11) * .45;
    b.scatter[k + 2] = Math.cos(phase) * (2 + local % 7) * .8;
    for (let axis = 0; axis < 3; axis++) {
      b.finale[k + axis] = b.anchors[k + axis] + b.offsets[k + axis] + b.scatter[k + axis];
      b.finaleReduced[k + axis] = b.anchors[k + axis] + b.offsets[k + axis];
    }
  }
  return b;
}

/** Absolute-time deterministic sampling. Mutates only reusable typed buffers. */
export function updateDropletFleet(fleet, timeMs, { reducedMotion = false } = {}) {
  const state = sampleDropletShow(timeMs), s = state.seconds;
  const b = fleet.dropletBuffers ??= createBuffers(fleet);
  const finale = reducedMotion ? b.finaleReduced : b.finale;
  const morph = reducedMotion ? 1 : smooth((s - 36) / 6);
  const hullFade = 1 - smooth((s - 40) / 4);
  for (let i = 0; i < fleet.count; i++) {
    const k = i * 3, identity = fleet.identities[i], pad = fleet.pads?.[i] ?? Math.floor(identity / 1024);
    const bx = fleet.bases[k], by = fleet.bases[k + 1], bz = fleet.bases[k + 2];
    const age = s - b.explodeTimes[i];
    const dispersion = reducedMotion ? 0 : smooth(age / 4);
    if (s < 8 || s >= 148) {
      fleet.positions[k] = bx; fleet.positions[k + 1] = by; fleet.positions[k + 2] = bz;
    } else if (s < 28) {
      const u = clamp((s - 8 - fleet.launchDelays[i]) / 16);
      const lift = smooth(u / .28), travel = smooth((u - .22) / .78);
      const target = reducedMotion ? b.finaleReduced : b.cube;
      fleet.positions[k] = mix(bx, target[k], travel);
      fleet.positions[k + 1] = mix(mix(by, 15 + pad * 1.5, lift), target[k + 1], travel);
      fleet.positions[k + 2] = mix(bz, target[k + 2], travel);
    } else if (s < 114) {
      for (let axis = 0; axis < 3; axis++) {
        const hull = b.anchors[k + axis] + b.offsets[k + axis] + b.scatter[k + axis] * dispersion;
        fleet.positions[k + axis] = mix(b.cube[k + axis], hull, morph);
      }
    } else if (s < 134) {
      const delay = (identity % 32) / 31 * 3 + pad * .4;
      const u = smooth((s - 114 - delay) / (20 - delay));
      const arch = reducedMotion ? 0 : Math.sin(Math.PI * u) * 6;
      fleet.positions[k] = mix(finale[k], bx, u);
      fleet.positions[k + 1] = mix(finale[k + 1], 18 + pad * 2, u) + arch;
      fleet.positions[k + 2] = mix(finale[k + 2], bz, u);
    } else {
      const delay = fleet.returnDelays[i] * .65, u = smooth((s - 134 - delay) / (14 - delay));
      fleet.positions[k] = bx; fleet.positions[k + 1] = mix(18 + pad * 2, by, u); fleet.positions[k + 2] = bz;
    }
    let red = .55, green = .9, blue = 1.2;
    if (s >= 28 && s < 114) {
      // After the morph the real hulls carry the scene: no point-cloud probe,
      // fake bright wake or permanent laser-like lines are drawn by this fleet.
      const remaining = reducedMotion ? 1 - smooth(age / 6) : 1 - smooth(age / .8);
      const intact = hullFade * remaining;
      const ember = !reducedMotion && age > 0 ? .08 * smooth(age / .1) * (1 - smooth((age - .1) / 3.5)) : 0;
      red = .62 * intact + ember;
      green = .95 * intact + ember * .18;
      blue = 1.3 * intact + ember * .04;
    }
    const recovery = smooth((s - 114) / 20);
    if (s >= 114) {
      const reveal = smooth((s - 114) / 2);
      red = .6 * reveal; green = .85 * reveal; blue = 1.05 * reveal;
    }
    let intensity = s < 8 ? .42 * smooth(s / 8) * smooth((s - fleet.launchDelays[i] * .8) / 3.5)
      : s < 28 ? mix(.42, 1, smooth((s - 8) / 20)) : s < 148 ? 1 : s < 150 ? 1 - smooth((s - 148) / 2) : 0;
    if (s >= 114) intensity *= mix(1, .5, recovery);
    fleet.colors[k] = red * intensity; fleet.colors[k + 1] = green * intensity; fleet.colors[k + 2] = blue * intensity;
    const emitter = s < 28 ? mix(.2, 1, smooth((s - 12) / 16)) : s < 114 ? 1 : mix(1, .2, recovery);
    fleet.sizes[i] = .27 * emitter;
  }
  fleet.state = state;
  return state;
}
