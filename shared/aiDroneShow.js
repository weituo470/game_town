import { validateAiDroneScore } from './aiDroneScore.js';
import { createAiDroneStageRuntime } from './aiDroneStage.js';

export const AI_DRONE_LAUNCH_MS = 12000;
export const AI_DRONE_RETURN_MS = 12000;
export const AI_DRONE_BLACKOUT_MS = 2000;
const TAU = Math.PI * 2;
const CENTER_Y = 72;
const CENTER_Z = -8;
const programs = new WeakMap();
// Curated, bundled long-form programmes never enter the public AI validator.
// Only this private registry can extend the scene count, after every scene has
// passed the unchanged v1 validator in a normal 4–7-scene packet.
const curatedScores = new WeakSet();
const resolveScore = input => curatedScores.has(input) ? input : validateAiDroneScore(input);
const caches = new WeakMap();
const canonicalFrames = new WeakMap();
const CANONICAL_COUNT = 4096;
const LIGHT_SPACING = .9;
const LIGHT_SIZE = .22;
const clamp = n => Math.max(0, Math.min(1, n));
const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const hash = (identity, seed, salt = 0) => { let n = (identity ^ seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0; n = Math.imul(n ^ n >>> 16, 0x7feb352d); n = Math.imul(n ^ n >>> 15, 0x846ca68b); return ((n ^ n >>> 16) >>> 0) / 4294967296; };
const safeTime = (time, duration) => Number.isFinite(time) ? Math.max(0, Math.min(duration, time)) : 0;
const line = (points, accent = false, weight = 1) => ({ points, accent, weight });
const curve = (fn, count = 96) => Array.from({ length: count + 1 }, (_, i) => fn(i / count));
const ellipse = (cx, cy, rx, ry, depth = 0) => curve(t => [cx + Math.cos(t * TAU) * rx, cy + Math.sin(t * TAU) * ry, depth]);

export function createAiDroneProgram(input) {
  const score = resolveScore(input);
  if (score.version === 2) return createAiDroneStageRuntime(score).program;
  if (programs.has(score)) return programs.get(score);
  const chapters = [
    { id: 'lighting', label: '星灯初醒', start: 0, end: 2000, description: '起降阵列依次点亮，等待这一场独一无二的演出。' },
    { id: 'ascent', label: '群星升空', start: 2000, end: AI_DRONE_LAUNCH_MS, description: '机群离地，在天空中织出第一幅画面。' },
  ];
  let cursor = AI_DRONE_LAUNCH_MS;
  score.scenes.forEach((scene, index) => {
    chapters.push({ id: `ai-scene-${index}`, label: scene.name, description: scene.description, start: cursor, end: cursor + scene.duration * 1000, sceneIndex: index });
    cursor += scene.duration * 1000;
  });
  const returnStart = cursor;
  chapters.push({ id: 'returning', label: '群星归航', start: cursor, end: cursor += AI_DRONE_RETURN_MS, description: '每一颗星返回自己的起降位置。' });
  chapters.push({ id: 'blackout', label: '余光谢幕', start: cursor, end: cursor += AI_DRONE_BLACKOUT_MS, description: '灯光缓缓熄灭，留住刚刚的天空记忆。' });
  const hero = chapters[2 + Math.floor(score.scenes.length / 2)];
  const program = Object.freeze({ id: 'ai', title: score.title, shortTitle: 'AI 即兴剧场', subtitle: '一句灵感 · 一场天空叙事', description: score.synopsis, chapters: Object.freeze(chapters.map(Object.freeze)), duration: cursor, returnStart, heroTime: Math.round((hero.start + hero.end) / 2), highlightTime: Math.round((hero.start + hero.end) / 2), recoveryTime: returnStart, heroLabel: '直达高光', highlightLabel: '天空画卷', recoveryLabel: '观看归航', supportsFpv: false, supportsAudio: false, note: 'AI 生成的是受限编舞数据；所有运动由虚拟舞台执行，不是实体无人机飞行指令。' });
  programs.set(score, program);
  return program;
}

export function sampleAiDroneShow(timeMs, input) {
  const score = resolveScore(input);
  if (score.version === 2) return createAiDroneStageRuntime(score).sample(timeMs);
  const program = createAiDroneProgram(score);
  const elapsed = safeTime(timeMs, program.duration);
  const chapter = program.chapters.find(item => elapsed < item.end) || program.chapters.at(-1);
  const progress = clamp((elapsed - chapter.start) / (chapter.end - chapter.start));
  const energy = elapsed < 2000 ? smooth(elapsed / 2000) * .52 : elapsed < AI_DRONE_LAUNCH_MS ? mix(.52, 1, smooth((elapsed - 2000) / 10000)) : elapsed < program.returnStart ? 1 : elapsed < program.duration - 2000 ? mix(1, .36, smooth((elapsed - program.returnStart) / AI_DRONE_RETURN_MS)) : .36 * (1 - smooth(progress));
  return { elapsed, seconds: elapsed / 1000, phase: chapter.id, label: chapter.label, description: chapter.description, progress, active: elapsed < program.duration, energy, cue: chapter.id, cueLabel: chapter.label, cueDescription: chapter.description, cueProgress: progress, nextIn: 0, sceneIndex: chapter.sceneIndex ?? (elapsed < AI_DRONE_LAUNCH_MS ? 0 : score.scenes.length - 1) };
}

function pathsForShape(scene) {
  if (scene.shape === 'outline') return scene.paths.map((path, i) => line(path.map(([x, y]) => [x, y, (i % 2) * .035]), i % 3 === 1));
  if (scene.shape === 'heart') return [line(curve(t => { const a = t * TAU; return [16 * Math.sin(a) ** 3 / 18, (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 18 + .08, 0]; }), false, 2), line(ellipse(-.31, .29, .12, .17, .1), true, .65)];
  if (scene.shape === 'star') {
    const points = Array.from({ length: 11 }, (_, i) => { const a = Math.PI / 2 + i / 10 * TAU, r = i % 2 ? .39 : .96; return [Math.cos(a) * r, Math.sin(a) * r, 0]; });
    return [line(points, false, 2), line(points.map(([x, y]) => [x * .64, y * .64, .15]), true), line(ellipse(0, 0, .19, .25, .2), true, .5)];
  }
  if (scene.shape === 'flower') {
    const paths = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      paths.push(line(curve(t => { const theta = t * TAU, radial = .36 + .28 * Math.cos(theta), tangent = .18 * Math.sin(theta); return [Math.cos(a) * radial - Math.sin(a) * tangent, .24 + Math.sin(a) * radial + Math.cos(a) * tangent, .08 * Math.sin(theta)]; }, 48), i % 3 === 0, 1.2));
    }
    paths.push(line(ellipse(0, .24, .18, .18, .12), true, 1.5), line([[0, .08, 0], [.05, -.35, 0], [-.02, -.92, 0]], true, .8), line([[.03, -.52, 0], [-.42, -.3, 0], [-.24, -.67, 0], [.03, -.52, 0]], false, .7), line([[.02, -.68, 0], [.39, -.49, 0], [.29, -.83, 0], [.02, -.68, 0]], false, .7));
    return paths;
  }
  if (scene.shape === 'whale') return [
    line([[-.94, -.01, 0], [-.91, .16, 0], [-.78, .3, 0], [-.59, .39, 0], [-.3, .42, 0], [-.02, .36, 0], [.27, .24, 0], [.55, .09, 0], [.74, .18, 0], [.94, .4, 0], [.91, .07, 0], [.79, -.09, 0], [.99, -.33, 0], [.72, -.28, 0], [.55, -.05, 0], [.26, -.2, 0], [-.07, -.31, 0], [-.4, -.34, 0], [-.68, -.26, 0], [-.87, -.15, 0], [-.94, -.01, 0]], false, 2),
    line([[-.31, -.17, .08], [-.14, -.62, .11], [.11, -.55, .08], [.14, -.25, 0]], true, 1.1),
    line([[-.04, .35, 0], [.07, .63, -.04], [.26, .25, 0]], true, .7),
    line([[-.88, -.1, .12], [-.66, -.18, .16], [-.38, -.15, .14]], true, .85),
    line(ellipse(-.6, .1, .035, .05, .18), true, 2),
    line([[-.49, .4, 0], [-.48, .68, 0], [-.62, .88, 0], [-.73, .87, 0]], true, .6),
    line([[-.48, .68, 0], [-.34, .89, 0], [-.23, .84, 0]], true, .6),
    line(curve(t => [t * 1.9 - .95, -.76 + Math.sin(t * TAU * 2) * .05, -.08]), true, .6),
  ];
  if (scene.shape === 'bird') return [
    line([[-.07, .28, 0], [-.42, .7, -.05], [-.96, .8, -.1], [-.78, .47, 0], [-.52, .23, .05], [-.2, -.02, .1], [-.08, -.25, .1], [-.25, -.68, 0], [0, -.5, .1], [.25, -.68, 0], [.08, -.25, .1], [.2, -.02, .1], [.52, .23, .05], [.78, .47, 0], [.96, .8, -.1], [.42, .7, -.05], [.07, .28, 0]], false, 2),
    line(ellipse(0, .29, .1, .16, .13), true, 1.4),
    ...[-1, 1].map(s => line([[s * .18, .03, .12], [s * .45, .37, .1], [s * .77, .62, .04]], true)),
  ];
  if (scene.shape === 'mountain') return [line([[-.98, -.58, 0], [-.63, .35, 0], [-.35, -.04, 0], [-.06, .89, -.05], [.28, .06, -.02], [.52, .55, -.1], [.98, -.58, 0]], false, 2), line([[-.27, .3, .1], [-.06, .89, .1], [.14, .4, .1], [.04, .46, .1], [-.06, .36, .1], [-.17, .47, .1], [-.27, .3, .1]], true), line(curve(t => [t * 1.96 - .98, -.62 + Math.sin(t * TAU) * .06, .08]), true), line(ellipse(.62, .75, .16, .2, -.05), true, .7)];
  if (scene.shape === 'city') {
    const skyline = [[-.98, -.67, 0]], paths = [];
    const heights = [-.08, .2, -.16, .55, .28, .85, .38, .03, .62, .16, -.13];
    for (let i = 0; i < heights.length; i++) {
      const x = -.94 + i * .174, w = .142, h = heights[i];
      skyline.push([x, -.67, 0], [x, h, 0], [x + w, h, 0], [x + w, -.67, 0]);
      for (let row = 0; row < Math.floor((h + .6) / .16); row++) paths.push(line([[x + .035, -.5 + row * .16, .05], [x + w - .035, -.5 + row * .16, .05]], true, .3));
      if (i === 5) paths.push(line([[x + w / 2, h, 0], [x + w / 2, 1, 0]], true, .7));
    }
    skyline.push([.98, -.67, 0]);
    paths.unshift(line(skyline, false, 2.1));
    paths.push(line([[-.98, -.78, -.1], [.98, -.78, -.1]], true, .65));
    return paths;
  }
  return null;
}

function segments(paths) {
  let total = 0;
  const result = [];
  for (const path of paths) for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0)) * path.weight;
    if (!length) continue;
    result.push({ a, b, start: total, end: total += length, accent: path.accent });
  }
  return { segments: result, total };
}
function rgb(value) { return [1, 3, 5].map(start => (parseInt(value.slice(start, start + 2), 16) / 255) ** 2.2 * 1.7); }

// Deterministic progressive order: the first 512 identities give coarse uniform
// coverage; 1024/2048/full then fill only genuinely empty gaps. This avoids
// random holes and makes every quality a strict subset of the
// same physical fleet. Grid work happens once per immutable score, never/frame.
function spacedLights(points, planar) {
  const lights = new Float32Array(CANONICAL_COUNT), cells = new Map();
  const spacing2 = LIGHT_SPACING * LIGHT_SPACING;
  for (let rank = 0; rank < CANONICAL_COUNT; rank++) {
    let id = 0, bits = rank;
    for (let bit = 0; bit < 12; bit++) { id = (id << 1) | (bits & 1); bits >>>= 1; }
    const k = id * 3, x = points[k], y = points[k + 1], z = planar ? 0 : points[k + 2];
    const cx = Math.floor(x / LIGHT_SPACING), cy = Math.floor(y / LIGHT_SPACING), cz = Math.floor(z / LIGHT_SPACING);
    let crowded = false;
    for (let dx = -1; dx <= 1 && !crowded; dx++) for (let dy = -1; dy <= 1 && !crowded; dy++) for (let dz = planar ? 0 : -1; dz <= (planar ? 0 : 1) && !crowded; dz++) {
      const cell = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!cell) continue;
      for (const other of cell) {
        const j = other * 3, ox = x - points[j], oy = y - points[j + 1], oz = planar ? 0 : z - points[j + 2];
        if (ox * ox + oy * oy + oz * oz < spacing2) { crowded = true; break; }
      }
    }
    if (crowded) continue;
    lights[id] = 1;
    const key = `${cx},${cy},${cz}`, cell = cells.get(key);
    if (cell) cell.push(id); else cells.set(key, [id]);
  }
  return lights;
}

function compileCanonical(score) {
  const existing = canonicalFrames.get(score);
  if (existing) return existing;
  const frames = score.scenes.map((scene, sceneIndex) => {
    const points = new Float32Array(CANONICAL_COUNT * 3), colors = new Float32Array(CANONICAL_COUNT * 3);
    const paths = pathsForShape(scene), outlines = paths ? segments(paths) : null;
    const base = rgb(scene.color), accent = rgb(scene.accent);
    for (let id = 0; id < CANONICAL_COUNT; id++) {
      const q = (id + .5) / 4096, a = q * TAU;
      let x = 0, y = 0, z = 0, highlight = false;
      if (outlines) {
        // A fixed identity permutation spreads contiguous launch racks over
        // whole outlines; it is identical at 2048 and 4096 light quality.
        const distance = (((id * 1597 + score.seed) % 4096) + .5) / 4096 * outlines.total;
        let lo = 0, hi = outlines.segments.length - 1;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (outlines.segments[mid].end < distance) lo = mid + 1; else hi = mid; }
        const segment = outlines.segments[lo], p = (distance - segment.start) / (segment.end - segment.start);
        x = mix(segment.a[0], segment.b[0], p); y = mix(segment.a[1], segment.b[1], p); z = mix(segment.a[2] || 0, segment.b[2] || 0, p);
        highlight = segment.accent;
      } else if (scene.shape === 'sphere') {
        if (id % 5 === 0) { const r = 1.09 + hash(id, score.seed, 1) * .12; x = Math.cos(a * 5) * r; y = Math.sin(a * 5) * .29; z = Math.sin(a * 5) * .85; highlight = true; }
        else { y = 1 - 2 * q; const r = Math.sqrt(1 - y * y); const angle = id * 2.399963229728653; x = Math.cos(angle) * r * .76; z = Math.sin(angle) * r; y *= .92; highlight = id % 17 < 2; }
      } else if (scene.shape === 'ring') {
        const band = id % 3, radius = [.9, .69, .47][band];
        x = Math.cos(a * 3) * radius; y = Math.sin(a * 3) * radius;
        z = Math.sin(a * 3 + band) * .3 + (band - 1) * .25; highlight = band === 1;
      } else if (scene.shape === 'helix') {
        // Side must not live in bit zero: the 2048 tier uses only even IDs.
        // Removing bit three from the height index preserves the full helix
        // point set while retaining both strands in every normal quality tier.
        const side = (id >>> 3) & 1, heightIndex = (id & 7) | ((id >>> 4) << 3);
        const t = (heightIndex + .5) / 2048, angle = t * TAU * 2.5 + side * Math.PI;
        x = Math.cos(angle) * .5; y = t * 1.85 - .925; z = Math.sin(angle) * .8; highlight = side === 1;
        if (id % 13 === 0) { x *= hash(id, score.seed); z *= hash(id, score.seed); }
      } else {
        const arm = id % 5, radius = Math.sqrt(q), angle = arm * TAU / 5 + radius * 5 + (hash(id, score.seed, 2) - .5) * .18;
        x = Math.cos(angle) * radius * 1.12; y = Math.sin(angle) * radius * .62; z = Math.sin(angle) * radius * .8; highlight = radius < .27 || arm === 0;
      }
      const k = id * 3;
      points[k] = x * 48; points[k + 1] = CENTER_Y + y * 34; points[k + 2] = CENTER_Z + z * 24;
      const chosen = highlight ? accent : base;
      const luminosity = .84 + hash(id, score.seed, sceneIndex + 3) * .16;
      for (let axis = 0; axis < 3; axis++) colors[k + axis] = chosen[axis] * luminosity;
    }
    // Front-facing outlines need a visible gap even where separate paths have
    // small decorative Z offsets. Volumetric formations keep 3D separation.
    return { points, colors, lights: spacedLights(points, Boolean(outlines)) };
  });
  canonicalFrames.set(score, frames);
  return frames;
}

function compile(score, fleet) {
  const frames = compileCanonical(score).map(canonical => {
    const points = new Float32Array(fleet.count * 3), colors = new Float32Array(fleet.count * 3), lights = new Float32Array(fleet.count);
    for (let i = 0; i < fleet.count; i++) {
      const id = fleet.identities[i], k = i * 3, source = id * 3;
      for (let axis = 0; axis < 3; axis++) { points[k + axis] = canonical.points[source + axis]; colors[k + axis] = canonical.colors[source + axis]; }
      lights[i] = canonical.lights[id];
    }
    return { points, colors, lights };
  });
  return { score, frames };
}

function cacheFor(fleet, score) {
  let cache = caches.get(fleet);
  if (cache?.score === score) return cache;
  const valid = Number.isInteger(fleet?.count) && fleet.count > 0 && fleet.count <= 4096 && ['positions', 'colors', 'bases'].every(key => fleet[key]?.length === fleet.count * 3) && fleet.sizes?.length === fleet.count && fleet.identities?.length === fleet.count;
  if (!valid) throw new TypeError('AI 演出需要有效的无人机缓冲区。');
  for (let i = 0; i < fleet.count; i++) if (!Number.isInteger(fleet.identities[i]) || fleet.identities[i] < 0 || fleet.identities[i] > 4095 || !Number.isFinite(fleet.bases[i * 3]) || !Number.isFinite(fleet.bases[i * 3 + 1]) || !Number.isFinite(fleet.bases[i * 3 + 2]) || fleet.bases[i * 3 + 1] < 0) throw new TypeError('AI 演出需要有效的固定身份与起降位置。');
  cache = compile(score, fleet);
  caches.set(fleet, cache);
  return cache;
}

// Write one sampled formation into a reusable scratch vector. Its motion fades
// at each chapter edge, so arbitrary seeks and all transition modes stay C0.
function pointAt(frame, scene, index, localMs, reduced, output) {
  const k = index * 3, p = clamp(localMs / (scene.duration * 1000));
  const envelope = Math.sin(p * Math.PI) ** 2;
  let x = frame.points[k], y = frame.points[k + 1] - CENTER_Y, z = frame.points[k + 2] - CENTER_Z;
  const strength = reduced ? .12 : 1;
  if (scene.motion === 'turn') { const a = Math.sin(p * TAU) * .34 * envelope * strength, c = Math.cos(a), s = Math.sin(a), oldX = x; x = oldX * c + z * s; z = z * c - oldX * s; }
  else if (scene.motion === 'breathe') { const scale = 1 + Math.sin(p * TAU * 1.5) * .065 * envelope * strength; x *= scale; y *= scale; z *= scale; }
  else if (scene.motion === 'wave') { y += Math.sin(x * .075 + p * TAU * 2) * 2.5 * envelope * strength; z += Math.cos(x * .06 + p * TAU) * 2 * envelope * strength; }
  output[0] = x; output[1] = CENTER_Y + y; output[2] = CENTER_Z + z;
}

/** Pure absolute-time sampling, in-place typed buffers, no per-light allocations. */
export function updateAiDroneFleet(fleet, timeMs, { score: input, reducedMotion = false } = {}) {
  const score = resolveScore(input);
  if (score.version === 2) return createAiDroneStageRuntime(score).update(fleet, timeMs, { reducedMotion });
  const program = createAiDroneProgram(score), cache = cacheFor(fleet, score);
  const state = sampleAiDroneShow(timeMs, score), time = state.elapsed;
  const sceneIndex = state.sceneIndex, frame = cache.frames[sceneIndex], scene = score.scenes[sceneIndex];
  const chapter = program.chapters[sceneIndex + 2], localMs = Math.max(0, time - chapter.start);
  const scratch = cache.scratch ||= new Float64Array(3);
  const sizeEnvelope = time < 2000 ? smooth(time / 2000) : time >= program.duration - AI_DRONE_BLACKOUT_MS ? 1 - smooth((time - program.duration + AI_DRONE_BLACKOUT_MS) / AI_DRONE_BLACKOUT_MS) : 1;
  const transitionMs = Math.min(3200, scene.duration * 1000 * .3);
  const transition = sceneIndex > 0 && time >= AI_DRONE_LAUNCH_MS && time < program.returnStart && localMs < transitionMs;
  for (let i = 0; i < fleet.count; i++) {
    const k = i * 3, id = fleet.identities[i], phase = hash(id, score.seed, 51);
    const ground = fleet.bases[k + 1];
    let x, y, z, emitter = LIGHT_SIZE, visibility = frame.lights[i], colorMix = 1, fromColors = frame.colors, toColors = frame.colors;
    if (time < AI_DRONE_LAUNCH_MS) {
      const p = smooth((time - 2000 - phase * 1500) / (10000 - phase * 1500));
      x = mix(fleet.bases[k], cache.frames[0].points[k], p); y = mix(ground, cache.frames[0].points[k + 1], p); z = mix(fleet.bases[k + 2], cache.frames[0].points[k + 2], p);
      emitter = mix(.08, LIGHT_SIZE, p); visibility = mix(1, cache.frames[0].lights[i], p);
    } else if (time >= program.returnStart) {
      const p = smooth((time - program.returnStart - phase * 1700) / (AI_DRONE_RETURN_MS - phase * 1700));
      const last = cache.frames.at(-1);
      x = mix(last.points[k], fleet.bases[k], p); y = mix(last.points[k + 1], ground, p); z = mix(last.points[k + 2], fleet.bases[k + 2], p);
      fromColors = toColors = last.colors; emitter = mix(LIGHT_SIZE, .08, p); visibility = mix(last.lights[i], 1, p);
    } else {
      pointAt(frame, scene, i, localMs, reducedMotion, scratch);
      x = scratch[0]; y = scratch[1]; z = scratch[2];
      if (transition) {
        const prior = cache.frames[sceneIndex - 1];
        const stagger = scene.transition === 'sweep' && !reducedMotion ? clamp(prior.points[k] / 120 + .5) * .35 : 0;
        colorMix = smooth((localMs / transitionMs - stagger) / (1 - stagger));
        x = mix(prior.points[k], x, colorMix); y = mix(prior.points[k + 1], y, colorMix); z = mix(prior.points[k + 2], z, colorMix);
        if (scene.transition === 'burst') {
          // One continuous scatter-and-regather arc, never a flashing strobe.
          const arc = Math.sin(colorMix * Math.PI) ** 2 * (reducedMotion ? .15 : 1);
          x += Math.cos(phase * TAU) * 8 * arc; y += (2 + phase * 8) * arc; z += Math.sin(phase * TAU) * 8 * arc;
        }
        fromColors = prior.colors;
        visibility = mix(prior.lights[i], frame.lights[i], colorMix);
      }
    }
    fleet.positions[k] = x; fleet.positions[k + 1] = Math.max(ground, y); fleet.positions[k + 2] = z;
    fleet.sizes[i] = emitter * visibility * sizeEnvelope;
    for (let axis = 0; axis < 3; axis++) fleet.colors[k + axis] = mix(fromColors[k + axis], toColors[k + axis], colorMix) * state.energy * visibility;
  }
  fleet.state = state;
  return state;
}

function cameraFor(timeMs, aspect, reducedMotion, score, program) {
  const time = safeTime(timeMs, program.duration);
  const safeAspect = Number.isFinite(aspect) ? Math.max(.25, Math.min(4, aspect)) : 16 / 9;
  const lift = reducedMotion ? 1 : smooth(time / AI_DRONE_LAUNCH_MS) * (1 - smooth((time - program.returnStart) / AI_DRONE_RETURN_MS));
  const yaw = reducedMotion ? 0 : Math.sin(time / program.duration * Math.PI * 2) * .045;
  const target = [0, mix(32, 64, lift), CENTER_Z];
  const position = [Math.sin(yaw) * 185, target[1] + 13, CENTER_Z + Math.cos(yaw) * 185];
  const distance = Math.hypot(position[0], position[1] - target[1], position[2] - target[2]);
  const required = 150 / (2 * Math.tan(25 * Math.PI / 180) * safeAspect);
  if (required > distance) for (let axis = 0; axis < 3; axis++) position[axis] = target[axis] + (position[axis] - target[axis]) * required / distance;
  return { position, target, fov: 50, near: .1, far: Math.max(600, required + 200) };
}

/** Runtime object stays outside persisted JSON; no global mutable programme registry. */
export function createAiDroneRuntime(input) {
  const score = resolveScore(input);
  if (score.version === 2) return createAiDroneStageRuntime(score);
  const program = createAiDroneProgram(score);
  return Object.freeze({ score, program, sample: ms => sampleAiDroneShow(ms, score), update: (fleet, ms, options = {}) => updateAiDroneFleet(fleet, ms, { score, reducedMotion: Boolean(options.reducedMotion) }), camera: (ms, aspect, reducedMotion = false) => cameraFor(ms, aspect, reducedMotion, score, program) });
}

/** Bundled editorial content only. This factory is not used by any API route,
 * JSON import, generated-score response, or local user-programme persistence.
 * Public scores retain the existing 4–7 scenes / 8–18 seconds limits. */
export function createCuratedAiDroneRuntime(input) {
  const keys = ['version', 'title', 'synopsis', 'seed', 'scenes'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Reflect.ownKeys(input).length !== keys.length
    || Reflect.ownKeys(input).some(key => !keys.includes(key))
    || keys.some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key) || {}, 'value'))) {
    throw new TypeError('样板节目必须是完整的纯数据对象。');
  }
  if (!Array.isArray(input.scenes) || input.scenes.length < 4 || input.scenes.length > 32
    || !Array.from({ length: input.scenes.length }, (_, index) => Object.hasOwn(Object.getOwnPropertyDescriptor(input.scenes, index) || {}, 'value')).every(Boolean)) {
    throw new RangeError('样板节目需要 4–32 个经过验证的章节。');
  }
  const scenes = []; let metadata;
  for (let offset = 0; offset < input.scenes.length;) {
    const remaining = input.scenes.length - offset;
    const count = remaining <= 7 ? remaining : Math.min(7, remaining - 4);
    const packet = validateAiDroneScore({ ...input, scenes: input.scenes.slice(offset, offset + count) });
    metadata ||= packet;
    scenes.push(...packet.scenes); offset += count;
  }
  const duration = AI_DRONE_LAUNCH_MS + AI_DRONE_RETURN_MS + AI_DRONE_BLACKOUT_MS
    + scenes.reduce((total, scene) => total + scene.duration * 1000, 0);
  if (duration > 600000) throw new RangeError('样板节目最长为 10 分钟，包含完整起飞与归航。');
  const score = Object.freeze({ ...metadata, scenes: Object.freeze(scenes) });
  curatedScores.add(score);
  return createAiDroneRuntime(score);
}
