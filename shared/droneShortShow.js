const COUNT = 4096, TAU = Math.PI * 2, GOLDEN = Math.PI * (3 - Math.sqrt(5));
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const hash = (id, salt = 0) => { let n = (id ^ Math.imul(salt + 13, 0x9e3779b1)) >>> 0; n = Math.imul(n ^ n >>> 16, 0x7feb352d); n = Math.imul(n ^ n >>> 15, 0x846ca68b); return ((n ^ n >>> 16) >>> 0) / 4294967296; };
const color = value => [1, 3, 5].map(index => (parseInt(value.slice(index, index + 2), 16) / 255) ** 2.2 * 1.65);
const FIRE = color('#FF7A35'), GOLD = color('#FFC96A'), WHITE = color('#FFF2CC');
const BLUE = color('#287CD8'), CYAN = color('#86F5FF'), VIOLET = color('#9B8CFF');
const geometries = new Map();
function cloud() { return { points: new Float32Array(COUNT * 3), colors: new Float32Array(COUNT * 3), parts: new Uint8Array(COUNT), weights: new Float32Array(COUNT) }; }
function put(target, id, x, y, z, first, second, blend, part = 0, weight = 0) {
  const k = id * 3, power = .88 + hash(id, 5) * .12;
  target.points[k] = x; target.points[k + 1] = y; target.points[k + 2] = z;
  for (let axis = 0; axis < 3; axis++) target.colors[k + axis] = mix(first[axis], second[axis], blend) * power;
  target.parts[id] = part; target.weights[id] = weight;
}
// Fixed identity permutation gives lower quality tiers an even subset of each
// anatomical part. All surfaces are authored volumes, never connected tubes.
function buildPhoenix() {
  const result = cloud();
  const featherX = [18, 25, 33, 42, 51, 59, 66, 72, 77, 72, 64, 55, 45, 35];
  const featherY = [-13, -16, -17, -15, -11, -6, 1, 9, 18, 25, 30, 31, 28, 24];
  for (let id = 0; id < COUNT; id++) {
    const rank = (id * 1597) % COUNT;
    let x = 0, y = 0, z = 0, part = 0, weight = 0, gold = 0;
    if (rank < 420) {
      const q = (rank + .5) / 420, v = 1 - 2 * q, r = Math.sqrt(1 - v * v), a = rank * GOLDEN;
      const chest = 5.5 + clamp((v + 1) / 2) * 5.2;
      x = Math.cos(a) * r * chest; y = v * 18 - 3; z = Math.sin(a) * r * 7.3;
      gold = clamp((z + 5) / 16) * .45;
    } else if (rank < 620) {
      const n = rank - 420, t = (n + .5) / 200, a = n * GOLDEN;
      const radius = 3.9 - t * 1.2;
      x = -1 + t * 10 + Math.sin(t * TAU) * 3 + Math.cos(a) * radius;
      y = 10 + t * 20; z = 1.4 + Math.sin(a) * radius;
      gold = .24 + .5 * t;
    } else if (rank < 800) {
      const n = rank - 620, v = 1 - 2 * (n + .5) / 180, r = Math.sqrt(1 - v * v), a = n * GOLDEN;
      x = 8 + Math.cos(a) * r * 6.8; y = 31 + v * 5.5; z = 2 + Math.sin(a) * r * 4.8;
      gold = .42 + .5 * clamp((y - 25) / 11);
    } else if (rank < 812) {
      const a = (rank - 800) / 12 * TAU;
      put(result, id, 10.2 + Math.cos(a) * 1.15, 32.7 + Math.sin(a) * .65, 6.8, WHITE, WHITE, 0, 5); continue;
    } else if (rank < 930) {
      const n = rank - 812, t = (n + .5) / 118, a = n * GOLDEN;
      x = 13 + t * 15; y = 30 - t * 3 + Math.cos(a) * 2.8 * (1 - t);
      z = 2 + Math.sin(a) * 2.3 * (1 - t); gold = 1;
    } else if (rank < 1062) {
      const n = rank - 930, feather = n % 5, t = (Math.floor(n / 5) + .5) / 27;
      x = 4 - t * (12 + feather * 2); y = 34 + Math.sin(t * Math.PI / 2) * (6 + feather * 2.2);
      z = -1 + (feather - 2) * .85 + Math.sin(t * Math.PI) * 1.2; gold = .45 + .55 * t;
    } else if (rank < 2918) {
      const n = rank - 1062, side = n < 928 ? -1 : 1, local = n % 928;
      if (local < 644) {
        const feather = local % 14, step = Math.floor(local / 14), t = (step + .5) / 46;
        const s = Math.min(feather, 9) / 9, a = step * GOLDEN, width = 2.2 * Math.sin(t * Math.PI) ** .65;
        const bx = 8 + s * 29, by = 10 + Math.sin(s * Math.PI * .85) * 13;
        x = side * (mix(bx, featherX[feather], t) + Math.cos(a) * width);
        y = mix(by, featherY[feather], t) + Math.sin(t * Math.PI) * 3 + Math.sin(a) * width * .65;
        z = -3 + Math.sin(t * Math.PI) * 5 - s * 5 + Math.sin(a) * width;
        gold = .17 + .83 * t ** 1.5;
      } else {
        const t = (local - 644 + .5) / 284, a = (local - 644) * GOLDEN, width = 7 * Math.sin(t * Math.PI) ** .65;
        x = side * (8 + t * 54); y = 11 + Math.sin(t * Math.PI * .9) * 15 + Math.cos(a) * width;
        z = -3 + Math.sin(a) * width * .43; gold = .16 + t * .35;
      }
      part = 1; weight = clamp((Math.abs(x) - 8) / 69);
    } else {
      const n = rank - 2918, feather = n % 5, t = (Math.floor(n / 5) + .5) / 236, side = feather - 2;
      const a = Math.floor(n / 5) * GOLDEN, width = (3.8 + Math.abs(side) * .4) * Math.sin(t * Math.PI) ** .6;
      x = side * (1.3 + t * 10.7) + Math.cos(a) * width + Math.sin(t * Math.PI * 1.35) * side * 5;
      y = -14 - t * (48 - Math.abs(side) * 4) + Math.sin(a) * width * .3;
      z = 1 + Math.sin(t * Math.PI) * 10 + Math.sin(a) * width * .9 + side * .8;
      part = 2; weight = t; gold = .16 + .82 * t ** 2;
    }
    put(result, id, x, y, z, FIRE, GOLD, gold, part, weight);
  }
  return result;
}
function buildWhale() {
  const result = cloud();
  for (let id = 0; id < COUNT; id++) {
    const rank = (id * 1597) % COUNT;
    let x, y, z, part = 0, weight = 0, pale = 0;
    if (rank < 2500) {
      const t = (rank + .5) / 2500, a = rank * GOLDEN, r = 18 * Math.sin(t * Math.PI) ** .42 * (1 - .63 * t * t);
      x = -58 + t * 111; y = Math.cos(a) * r; z = Math.sin(a) * r * .83;
      pale = .05 + .87 * smooth((-y + 1) / 14); weight = clamp((x + 10) / 64); part = 3;
    } else if (rank < 3020) {
      const n = rank - 2500, side = n < 260 ? -1 : 1, local = n % 260;
      const t = (local + .5) / 260, a = local * GOLDEN, w = 9 * Math.sin(t * Math.PI) ** .6;
      x = -20 + t * 31 + Math.cos(a) * w; y = -7 - t * 25 + Math.sin(a) * 1.7 * Math.sin(t * Math.PI);
      z = side * (10 + t * 17 + Math.sin(a) * w * .34); pale = .3 + t * .7; part = 4; weight = t;
    } else if (rank < 3620) {
      const n = rank - 3020, side = n < 300 ? -1 : 1, local = n % 300;
      const t = (local + .5) / 300, a = local * GOLDEN, w = 8.5 * Math.sin(t * Math.PI) ** .65;
      x = 49 + t * 17 + Math.cos(a) * w; y = Math.sin(t * Math.PI) * 3 + Math.sin(a) * w * .22;
      z = side * (t * 27 + Math.sin(a) * w * .7); pale = .24 + t * .7; part = 3; weight = 1;
    } else if (rank < 3712) {
      const n = rank - 3620, t = (n + .5) / 92, a = n * GOLDEN;
      x = 8 + t * 8 + Math.cos(a) * 4 * (1 - t); y = 11 + t * 15; z = Math.sin(a) * 1.5 * (1 - t); pale = .42 + .5 * t;
    } else if (rank < 3722) {
      const a = (rank - 3712) / 10 * TAU;
      // One small audience-facing eye. A point cloud has no opaque skin, so a
      // second far-side eye would shine through the head like a cartoon fish.
      put(result, id, -43 + Math.cos(a) * .8, 3.7 + Math.sin(a) * .42, 12.9, WHITE, CYAN, .22, 5); continue;
    } else if (rank < 3776) {
      const t = (rank - 3722 + .5) / 54;
      x = -53 + t * 24; y = 7 + Math.sin(t * Math.PI) * 4; z = 5 + Math.sin(t * Math.PI / 2) * 5;
      pale = .16;
    } else if (rank < 3936) {
      const n = rank - 3776;
      if (n < 60) {
        const t = (n + .5) / 60;
        x = -54 + t * 19; y = -3.6 - t * .8; z = 3.5 + Math.sin(t * Math.PI / 2) * 9;
        pale = .62;
      } else {
        const row = (n - 60) % 4, t = (Math.floor((n - 60) / 4) + .5) / 25;
        x = -43 + t * 43; y = -11.4 - Math.sin(t * Math.PI) * 4.5 + row * .9; z = 5 + row * 1.3;
        pale = .82;
      }
    } else {
      const n = rank - 3936, row = n % 5, t = (Math.floor(n / 5) + .5) / 32;
      x = -43 + t * 45; y = -10 - Math.sin(t * Math.PI) * 5.5 + row * .9; z = 6 + row * 1.3; pale = .85;
    }
    const oldY = y; y = y * .921 - z * .389; z = oldY * .389 + z * .921;
    put(result, id, x, y, z, BLUE, CYAN, pale, part, weight);
  }
  return result;
}
function buildOther(kind) {
  const result = cloud();
  for (let id = 0; id < COUNT; id++) {
    const rank = (id * 1597) % COUNT;
    let x, y, z, part = 0, weight = 0, first = BLUE, second = CYAN, blend = .5;
    if (kind === 'seed') {
      const strand = rank % 7, t = (Math.floor(rank / 7) + .5) / 586, a = t * TAU * 2.4 + strand * TAU / 7;
      const r = (3 + Math.sin(t * Math.PI) * 19) * (.88 + hash(id, 4) * .12);
      x = Math.cos(a) * r; y = -26 + t * 52; z = Math.sin(a) * r;
      part = 6; weight = t; first = FIRE; second = GOLD; blend = t;
    } else if (kind === 'waves') {
      const layer = rank % 3, n = Math.floor(rank / 3), u = (n % 53 + .5) / 53, v = (Math.floor(n / 53) + .5) / 26;
      x = -74 + u * 148; y = -30 + layer * 13 + Math.sin(u * TAU + layer * 1.7) * 9 + (v - .5) * 5;
      z = -27 + v * 46 + layer * 5; part = 7; weight = layer; blend = .18 + v * .7;
    } else if (kind === 'rain') {
      const v = 1 - 2 * (rank + .5) / COUNT, radial = Math.sqrt(1 - v * v), a = rank * GOLDEN;
      const depth = .45 + .55 * hash(id, 4) ** .3;
      x = Math.cos(a) * radial * 76 * depth; y = v * 40;
      z = Math.sin(a) * radial * 35 * depth; blend = hash(id, 7); part = 8; weight = hash(id, 2);
    } else {
      first = VIOLET; second = CYAN;
      if (rank < 1720) {
        const a = (rank + .5) / 1720 * TAU, b = rank * GOLDEN, r = 59 + Math.cos(b) * 3.3;
        x = Math.cos(a) * r; y = Math.sin(a) * r; z = Math.sin(b) * 3.3; blend = .1 + .65 * (.5 + .5 * Math.sin(a * 6)); part = 9;
      } else if (rank < 2800) {
        const n = rank - 1720, a = (n + .5) / 1080 * TAU, b = n * GOLDEN, r = 44 + Math.cos(b) * 2.6;
        x = Math.cos(a) * r; y = Math.sin(a) * r * .78; z = Math.sin(a) * r * .63 + Math.sin(b) * 2.6; blend = .65; part = 10;
      } else if (rank < 3350) {
        const n = rank - 2800, a = (n + .5) / 550 * TAU, b = n * GOLDEN, r = 30 + Math.cos(b) * 2.1;
        x = Math.cos(a) * r * .76; y = Math.sin(a) * r; z = Math.cos(a) * r * .65 + Math.sin(b) * 2.1;
        first = GOLD; second = WHITE; blend = .6; part = 11;
      } else if (rank < 3850) {
        const n = rank - 3350, v = 1 - 2 * (n + .5) / 500, r = Math.sqrt(1 - v * v), a = n * GOLDEN;
        x = Math.cos(a) * r * 14; y = v * 14; z = Math.sin(a) * r * 14; first = GOLD; second = WHITE; blend = .8; part = 12;
      } else {
        const n = rank - 3850, spoke = n % 12, t = (Math.floor(n / 12) + .5) / 21, a = spoke * TAU / 12, r = 34 + t * 21;
        x = Math.cos(a) * r; y = Math.sin(a) * r; z = Math.sin(t * Math.PI) * 11; first = GOLD; second = CYAN; blend = t; part = 9;
      }
    }
    put(result, id, x, y, z, first, second, blend, part, weight);
  }
  return result;
}
function geometry(kind) {
  if (geometries.has(kind)) return geometries.get(kind);
  let result;
  if (kind === 'phoenix') result = buildPhoenix();
  else if (kind === 'whale') result = buildWhale();
  else if (kind === 'school') {
    const whale = geometry('whale'); result = cloud();
    const xs = [-37, 36, -4], ys = [28, -1, -29], zs = [-17, 0, 18], angles = [-.14, .17, -.08], powers = [1, .88, .73];
    for (let id = 0; id < COUNT; id++) {
      const rank = (id * 1597) % COUNT, member = Math.floor(rank * 3 / COUNT), source = (id * 3) % COUNT;
      const k = id * 3, s = source * 3, c = Math.cos(angles[member]), n = Math.sin(angles[member]);
      result.points[k] = xs[member] + (whale.points[s] * c - whale.points[s + 1] * n) * .48;
      result.points[k + 1] = ys[member] + (whale.points[s] * n + whale.points[s + 1] * c) * .48;
      result.points[k + 2] = zs[member] + whale.points[s + 2] * .48;
      for (let axis = 0; axis < 3; axis++) result.colors[k + axis] = whale.colors[s + axis] * powers[member];
      result.parts[id] = 13; result.weights[id] = member;
    }
  } else result = buildOther(kind);
  geometries.set(kind, result); return result;
}
const pose = (time, kind, x = 0, y = 80, z = -10, scale = 1, rotation = 0, fold = 0, golden = 0, ease = 'smooth') => Object.freeze({ time, kind, x, y, z, scale, rotation, fold, golden, ease });
const RAILS = Object.freeze({
  'phoenix-rebirth': Object.freeze([
    pose(8000, 'seed', 0, 62), pose(18000, 'seed', 0, 80, -10, 1.08), pose(30000, 'phoenix'), pose(48000, 'phoenix'),
    pose(56000, 'phoenix', 12, 62, -10, .64, 2.8, .94), pose(60000, 'seed', 0, 18, -10, .29), pose(64000, 'seed', 0, 18, -10, .29),
    pose(74000, 'phoenix', 0, 80, -10, 1, 0, 0, .74), pose(94000, 'phoenix', 0, 80, -10, 1, 0, 0, .74),
  ]),
  'tidal-whale': Object.freeze([
    pose(8000, 'waves'), pose(22000, 'waves'), pose(38000, 'whale'), pose(50000, 'whale'),
    pose(59000, 'whale', 0, 92, -10, 1, -.72), pose(62000, 'whale', 0, 92, -10, 1, -.72),
    pose(70000, 'rain', 0, 93), pose(76000, 'rain', 0, 52), pose(84000, 'school'), pose(98000, 'school'),
  ]),
  'gravity-gate': Object.freeze([
    pose(8000, 'gate'), pose(24000, 'gate'), pose(40000, 'gate'), pose(50000, 'gate', 0, 108, -10, .48),
    pose(60000, 'gate', 0, 40, -10, .48, 0, 0, 0, 'gravity'), pose(70000, 'gate', 0, 80, -10, 1, 0, 0, .32), pose(86000, 'gate', 0, 80, -10, 1, 0, 0, .32),
  ]),
});
function writePose(frame, id, seconds, reduced, output) {
  const source = geometry(frame.kind), k = id * 3, part = source.parts[id], weight = source.weights[id];
  let x = source.points[k], y = source.points[k + 1], z = source.points[k + 2];
  if (!reduced) {
    if (part === 1) { y += Math.sin(seconds * .58) * weight * 9 * (1 - frame.fold); z += Math.cos(seconds * .58) * weight * 11; x *= 1 - frame.fold * .72; z -= frame.fold * weight * 34; }
    else if (part === 2) { x += Math.sin(seconds * .68 + weight * 3) * weight * 3.5; z += Math.cos(seconds * .55 + weight * 2) * weight * 3; }
    else if (part === 3) { y += Math.sin(seconds * .9 + weight * 2.4) * weight * weight * 4.2; z += Math.cos(seconds * .7 + weight) * weight * 2.4; }
    else if (part === 4) y += Math.sin(seconds * .9) * weight * 3;
    else if (part === 6) { const a = seconds * .25, c = Math.cos(a), s = Math.sin(a), oldX = x; x = x * c - z * s; z = oldX * s + z * c; }
    else if (part === 7) y += Math.sin(x * .075 + seconds * .75 + weight * 1.4) * 3.8;
    else if (part === 8) x += Math.sin(seconds * .22 + weight * TAU) * 1.2;
    else if (part >= 9 && part <= 11) { const a = seconds * (part === 10 ? -.07 : .045), c = Math.cos(a), s = Math.sin(a), oldX = x; x = x * c - y * s; y = oldX * s + y * c; }
    else if (part === 13) y += Math.sin(seconds * .65 + weight * 1.8) * 2.2;
  }
  const c = Math.cos(frame.rotation), s = Math.sin(frame.rotation), oldX = x;
  x = (x * c - y * s) * frame.scale; y = (oldX * s + y * c) * frame.scale; z *= frame.scale;
  output[0] = x + frame.x; output[1] = Math.max(8, y + frame.y); output[2] = z + frame.z;
  for (let axis = 0; axis < 3; axis++) output[axis + 3] = mix(source.colors[k + axis], GOLD[axis] * (.9 + hash(id, 5) * .1), frame.golden);
}
function makeProgram(definition) {
  const returnStart = definition.duration - 14000;
  const chapters = [
    { id: 'lighting', label: '星灯点火', description: '起降阵列依次亮起，所有机位等待出发。', start: 0, end: 1000 },
    { id: 'ascent', label: '机群升空', description: '完整机群离开起降坪，向演出空域展开。', start: 1000, end: 8000 },
    ...definition.scenes.map(([id, label, start, end, description], sceneIndex) => ({ id, label, name: label, start, end, description, sceneIndex })),
    { id: 'returning', label: '机群归航', description: '每架无人机返回自己的起降位，演出没有在空中直接消失。', start: returnStart, end: definition.duration - 2000 },
    { id: 'blackout', label: '余光谢幕', description: '最后的灯光缓缓熄灭，等待下一次起飞。', start: definition.duration - 2000, end: definition.duration },
  ];
  return Object.freeze({ id: 'ai', sampleId: definition.id, sampleVisual: 'spectacle-v2', title: definition.title,
    shortTitle: definition.title, subtitle: definition.subtitle, description: definition.description, duration: definition.duration, returnStart,
    chapters: Object.freeze(chapters.map(Object.freeze)), heroTime: definition.heroTime, highlightTime: definition.highlightTime, recoveryTime: returnStart,
    heroLabel: definition.heroLabel, highlightLabel: definition.highlightLabel, recoveryLabel: '完整归航', cinematic: true, supportsFpv: false, supportsAudio: false,
    note: '本会话直接编排的原创立体短秀，无模型调用；纯视觉、无配乐。烟花为虚拟特效，不是实体无人机飞行指令。减少动态时保持静态主形并关闭焰火。' });
}
/** Bundled definitions only; network-generated JSON never enters this factory. */
export function createDroneShortRuntime(definition) {
  const rail = RAILS[definition?.id];
  if (!rail) throw new RangeError('未知的短秀编舞。');
  const program = makeProgram(definition), scratchA = new Float64Array(6), scratchB = new Float64Array(6);
  for (const frame of rail) geometry(frame.kind);
  const heroKind = definition.id === 'phoenix-rebirth' ? 'phoenix' : definition.id === 'tidal-whale' ? 'whale' : 'gate';
  const staticHero = rail.find(frame => frame.kind === heroKind);
  const sample = timeMs => {
    const elapsed = Number.isFinite(timeMs) ? Math.max(0, Math.min(program.duration, timeMs)) : 0;
    const chapter = program.chapters.find(item => elapsed < item.end) || program.chapters.at(-1), progress = clamp((elapsed - chapter.start) / (chapter.end - chapter.start));
    let energy = elapsed < 1000 ? smooth(elapsed / 1000) : elapsed > program.duration - 2000 ? 1 - smooth((elapsed - program.duration + 2000) / 2000) : 1;
    if (definition.id === 'gravity-gate' && elapsed >= 40000 && elapsed < 70000) {
      energy *= elapsed < 50000 ? mix(1, .3, smooth((elapsed - 40000) / 10000)) : elapsed < 60000 ? .3 : mix(.3, 1, smooth((elapsed - 60000) / 10000));
    }
    return { elapsed, seconds: elapsed / 1000, phase: chapter.id, label: chapter.label, description: chapter.description, progress,
      active: elapsed < program.duration, energy, chapter, cue: chapter.id, cueLabel: chapter.label, cueDescription: chapter.description,
      cueProgress: progress, nextIn: 0, sceneIndex: chapter.sceneIndex ?? (elapsed < 8000 ? 0 : definition.scenes.length - 1) };
  };
  const update = (fleet, timeMs, { reducedMotion = false } = {}) => {
    const state = sample(timeMs), time = state.elapsed, seconds = time / 1000;
    let from = rail[0], to = rail[0], blend = 0;
    for (let index = 1; index < rail.length; index++) { from = rail[index - 1]; to = rail[index]; if (time <= to.time) break; }
    const raw = clamp((time - from.time) / Math.max(1, to.time - from.time));
    blend = to.ease === 'gravity' && !reducedMotion ? raw * raw : smooth(raw);
    if (reducedMotion) { from = to = staticHero; blend = 0; }
    const launch = time < 8000, returning = time >= program.returnStart;
    const envelope = time < 1000 ? smooth(time / 1000) : time > program.duration - 2000 ? 1 - smooth((time - program.duration + 2000) / 2000) : 1;
    for (let index = 0; index < fleet.count; index++) {
      const id = fleet.identities[index], k = index * 3;
      let groundMix = 0;
      if (launch) {
        writePose(reducedMotion ? staticHero : rail[0], id, 8, reducedMotion, scratchA);
        const stagger = hash(id, 12) * 800; groundMix = 1 - smooth((time - 1000 - stagger) / (7000 - stagger));
      } else if (returning) {
        writePose(reducedMotion ? staticHero : rail.at(-1), id, program.returnStart / 1000, reducedMotion, scratchA);
        const stagger = hash(id, 13) * 900; groundMix = smooth((time - program.returnStart - stagger) / (12000 - stagger));
      } else {
        writePose(from, id, seconds, reducedMotion, scratchA); writePose(to, id, seconds, reducedMotion, scratchB);
        for (let axis = 0; axis < 6; axis++) scratchA[axis] = mix(scratchA[axis], scratchB[axis], blend);
      }
      fleet.positions[k] = groundMix === 1 ? fleet.bases[k] : mix(scratchA[0], fleet.bases[k], groundMix);
      fleet.positions[k + 1] = groundMix === 1 ? fleet.bases[k + 1] : Math.max(fleet.bases[k + 1], mix(scratchA[1], fleet.bases[k + 1], groundMix));
      fleet.positions[k + 2] = groundMix === 1 ? fleet.bases[k + 2] : mix(scratchA[2], fleet.bases[k + 2], groundMix);
      fleet.sizes[index] = mix(.22, .08, groundMix) * envelope;
      const power = reducedMotion && time >= 8000 && time < program.returnStart ? 1 : state.energy;
      for (let axis = 0; axis < 3; axis++) fleet.colors[k + axis] = scratchA[axis + 3] * power;
    }
    fleet.state = state; return state;
  };
  return Object.freeze({ program, score: Object.freeze({ version: 'spectacle-v2', title: definition.title, localOnly: true }), sample, update });
}
