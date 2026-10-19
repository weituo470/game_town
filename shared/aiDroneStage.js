import { validateAiDroneScore } from './aiDroneScore.js';
import { createAiDroneActorGeometry } from './aiDroneActors.js';

const COUNT = 4096, TAU = Math.PI * 2, LAUNCH = 12000, RETURN = 12000, BLACKOUT = 2000;
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => { const t = clamp(x); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const hash = (id, seed = 0) => { let n = (id ^ seed ^ 0x9e3779b9) >>> 0; n = Math.imul(n ^ n >>> 16, 0x7feb352d); n = Math.imul(n ^ n >>> 15, 0x846ca68b); return ((n ^ n >>> 16) >>> 0) / 4294967296; };
const rgb = hex => [1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255) ** 2.2 * 1.6);
const fireRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const runtimes = new WeakMap();
const plainBounds = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const include = (bounds, point) => { for (let axis = 0; axis < 3; axis++) { bounds.min[axis] = Math.min(bounds.min[axis], point[axis]); bounds.max[axis] = Math.max(bounds.max[axis], point[axis]); } };

// A bijection of the 12-bit physical ID space, not an odd-number stride.
// Low quality uses even IDs: mix high bits into low bits before each odd
// multiplication so that it retains both sides/faces/feathers of every actor.
function physicalRank(id, seed) {
  let rank = (id ^ (seed & 4095)) & 4095;
  rank ^= rank >>> 6;
  rank = Math.imul(rank, 1597) & 4095;
  rank ^= rank >>> 5;
  rank = Math.imul(rank, 2671) & 4095;
  return (rank ^ rank >>> 4) & 4095;
}

function layoutSlots(layout, count) {
  if (layout === 'hero') return [[0, 107, -12, 1]];
  if (layout === 'duet') return [[-44, 120, -16, .66], [45, 86, 14, .66]];
  if (layout === 'trio') return [[0, 129, 2, .65], [-71, 89, -29, .48], [71, 89, -24, .48]];
  if (layout === 'procession') return Array.from({ length: count }, (_, i) => [mix(-78, 78, i / Math.max(1, count - 1)), 91 + i * 16, 15 - i * 25, count === 2 ? .65 : count === 3 ? .48 : .37]);
  if (count === 2) return [[-51, 112, 19, .62], [51, 120, -38, .62]];
  if (count === 3) return [[-66, 101, 12, .51], [66, 101, 12, .51], [0, 155, -63, .51]];
  return [[-68, 98, 16, .46], [68, 98, 16, .46], [-43, 154, -54, .46], [43, 154, -54, .46]];
}
function allocation(count) {
  if (count === 1) return [4096];
  if (count === 2) return [2560, 1536];
  if (count === 3) return [2048, 1024, 1024];
  return [1792, 768, 768, 768];
}
function orbitFormation(actors) {
  const anchor = actors.findIndex(actor => actor.id === 'world' && ['lotus', 'city', 'planet', 'portal', 'tree'].includes(actor.kind));
  const travelers = actors.filter((_, index) => index !== anchor), count = travelers.length;
  const halfX = Math.max(...travelers.map(actor => (actor.shape.bounds.max[0] - actor.shape.bounds.min[0]) * actor.size / 2));
  const halfY = Math.max(...travelers.map(actor => (actor.shape.bounds.max[1] - actor.shape.bounds.min[1]) * actor.size / 2));
  const separation = count > 1 ? 2 * Math.sin(Math.PI / count) : 2;
  let radiusX = Math.max(count > 2 ? 88 : 66, (halfX * 2 + 22) / separation);
  let radiusY = Math.max(count > 2 ? 55 : 45, (halfY * 2 + 22) / separation);
  if (anchor >= 0) {
    const actor = actors[anchor], bounds = actor.shape.bounds;
    radiusX = Math.max(radiusX, (bounds.max[0] - bounds.min[0]) * actor.size / 2 + halfX + 22);
    radiusY = Math.max(radiusY, (bounds.max[1] - bounds.min[1]) * actor.size / 2 + halfY + 18);
  }
  const angles = count === 1 ? [-Math.PI / 2] : count === 2 ? [Math.PI, 0] : count === 3 ? [7 * Math.PI / 6, 11 * Math.PI / 6, Math.PI / 2] : [5 * Math.PI / 4, 7 * Math.PI / 4, Math.PI / 4, 3 * Math.PI / 4];
  return { anchor, radiusX, radiusY, radiusZ: 38, centerY: Math.max(147, 40 + radiusY + halfY), angles };
}
function compileScene(scene, score, sceneIndex, start) {
  const slots = layoutSlots(scene.layout, scene.actors.length), budgets = allocation(scene.actors.length), cast = new Map(score.cast.map(actor => [actor.id, actor]));
  const actors = scene.actors.map((actor, index) => {
    const definition = cast.get(actor.id), shape = createAiDroneActorGeometry(definition.kind, budgets[index]), slot = slots[index];
    return Object.freeze({ ...actor, kind: definition.kind, shape, color: rgb(definition.color), accent: rgb(definition.accent),
      position: [slot[0], slot[1] + 22, slot[2]], size: slot[3] * actor.scale, phase: hash(score.cast.findIndex(item => item.id === actor.id) + 31, score.seed) * TAU,
      // Keep a mild three-quarter view for architectural sculptures; organic
      // actors keep their audience-facing eye, not a transparent far-side eye.
      yaw: ['city', 'lantern', 'tree', 'lotus'].includes(definition.kind) ? -.18 : 0 });
  });
  const owners = new Uint8Array(COUNT), locals = new Uint16Array(COUNT), colors = new Float32Array(COUNT * 3);
  for (let id = 0; id < COUNT; id++) {
    const rank = physicalRank(id, score.seed); let member = 0, base = 0;
    while (rank >= base + budgets[member]) { base += budgets[member]; member++; }
    owners[id] = member; locals[id] = rank - base;
    const actor = actors[member], tint = actor.shape.accents[rank - base], power = .9 + hash(id, score.seed) * .1;
    for (let axis = 0; axis < 3; axis++) colors[id * 3 + axis] = mix(actor.color[axis], actor.accent[axis], tint) * power;
  }
  const compiled = { scene, sceneIndex, start, end: start + scene.duration * 1000, actors, owners, locals, colors,
    orbit: scene.layout === 'orbit' ? orbitFormation(actors) : null, bounds: plainBounds() };
  // Actual composed geometry, not guessed glyph dimensions, determines all
  // desktop/portrait camera safety. Sample the whole tilted orbit, not just its
  // start/end slots, including both quality tiers and every anatomical part.
  const scratch = new Float64Array(3);
  for (let step = 0; step <= 12; step++) {
    const phase = step / 12;
    const poses = actorPoses(compiled, phase, false);
    for (let id = 0; id < COUNT; id++) { pointFor(compiled, poses, id, scratch); include(compiled.bounds, scratch); }
  }
  return compiled;
}
function actorPoses(frame, progress, reduced) {
  const p = clamp(progress), envelope = reduced ? 0 : Math.sin(p * Math.PI) ** 2;
  return frame.actors.map((actor, index) => {
    let x = actor.position[0], y = actor.position[1], z = actor.position[2], pitch = 0, yaw = actor.yaw, pulse = 1;
    const phase = p * TAU + actor.phase;
    if (frame.orbit) {
      // The formation itself dances through 120 degrees and comes home. It is
      // tilted in height AND depth, so actors do not collapse into an XZ line.
      // A landmark/world actor remains the center of the dance when present.
      const orbit = frame.orbit;
      x = 0; y = orbit.centerY; z = -22;
      if (index !== orbit.anchor) {
        const traveler = orbit.anchor >= 0 && index > orbit.anchor ? index - 1 : index;
        const angle = orbit.angles[traveler] + (reduced ? 0 : TAU / 3 * envelope);
        x += Math.cos(angle) * orbit.radiusX;
        y += Math.sin(angle) * orbit.radiusY;
        z += Math.sin(angle) * orbit.radiusZ;
      }
    } else if (frame.scene.layout === 'procession') {
      // A shared diagonal journey has a beginning and destination; the camera
      // observes the traversal instead of cancelling it by following each step.
      const journey = reduced ? .5 : smooth(p);
      x += mix(-32, 32, journey); y += mix(-9, 9, journey); z += mix(22, -22, journey);
    }
    if (!reduced) {
      // In an orbit, large spatial motion belongs to the ensemble. Keep local
      // action small and audience-facing instead of steering silhouettes edge-on.
      const motion = frame.orbit ? (index === frame.orbit.anchor ? 0 : .22) : 1;
      if (actor.motion === 'swim') { x += Math.sin(p * TAU) * 10 * envelope * motion; y += Math.sin(phase) * 3 * envelope * motion; pitch = Math.sin(p * TAU) * .10 * envelope; }
      else if (actor.motion === 'flap') { y += Math.sin(p * Math.PI) * 13 * envelope * motion; pitch = Math.sin(p * TAU) * .09 * envelope; }
      else if (actor.motion === 'orbit') { x += Math.sin(p * TAU) * 12 * envelope * motion; z += Math.cos(p * TAU) * 16 * envelope * motion; yaw += Math.sin(p * TAU) * .18 * envelope * motion; }
      else if (actor.motion === 'ascend') { y += Math.sin(p * Math.PI) * 22 * motion; pitch = -.22 * envelope * motion; }
      else if (actor.motion === 'dive') { y -= Math.sin(p * TAU) * 31 * envelope * motion; pitch = Math.sin(p * TAU) * .40 * envelope * motion; }
      else { y += Math.sin(phase) * 3.2 * envelope * motion; pulse += Math.sin(p * TAU) * .025 * envelope; }
    }
    return { x, y, z, pitch, yaw, scale: actor.size * pulse, animation: envelope, phase: p * TAU * 2 + actor.phase, index };
  });
}
function pointFor(frame, poses, id, out) {
  const member = frame.owners[id], actor = frame.actors[member], pose = poses[member], source = frame.locals[id], k = source * 3;
  const shape = actor.shape, part = shape.parts[source], weight = shape.weights[source];
  let x = shape.points[k], y = shape.points[k + 1], z = shape.points[k + 2];
  const strength = pose.animation;
  if (part === 1) { y += Math.sin(pose.phase + weight * 2.4) * weight * weight * 4.3 * strength; z += Math.cos(pose.phase * .8 + weight) * weight * 2 * strength; }
  else if (part === 2) y += Math.sin(pose.phase) * weight * 3 * strength;
  else if (part === 3) { const flap = actor.motion === 'flap' ? 1 : .48; y += Math.sin(pose.phase) * weight * 7 * strength * flap; z += Math.cos(pose.phase) * weight * 13 * strength * flap; }
  else if (part === 4) { x += Math.sin(pose.phase + weight * 3) * weight * 2.3 * strength; z += Math.cos(pose.phase + weight) * weight * 3 * strength; }
  else if (part === 5) y += Math.sin(pose.phase) * weight * 2.3 * strength;
  else if (part === 6) { const angle = Math.sin(pose.phase * .5) * .22 * strength, c = Math.cos(angle), s = Math.sin(angle), oldX = x; x = x * c - z * s; z = oldX * s + z * c; }
  const c = Math.cos(pose.pitch), s = Math.sin(pose.pitch), oldX = x;
  x = (x * c - y * s) * pose.scale; y = (oldX * s + y * c) * pose.scale; z *= pose.scale;
  const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw), priorX = x;
  x = x * cy - z * sy; z = priorX * sy + z * cy;
  out[0] = pose.x + x; out[1] = Math.max(16, pose.y + y); out[2] = pose.z + z;
  return out;
}
function makeProgram(score, frames) {
  const chapters = [
    { id: 'lighting', label: '星灯初醒', start: 0, end: 2000, description: '所有独立灯点亮起，立体舞台即将展开。' },
    { id: 'ascent', label: '群星升空', start: 2000, end: LAUNCH, description: '机群从起降位出发，逐渐组成第一幕的立体演员。' },
    ...frames.map(frame => ({ id: `ai-scene-${frame.sceneIndex}`, label: frame.scene.name, description: frame.scene.description, start: frame.start, end: frame.end, sceneIndex: frame.sceneIndex })),
  ];
  const returnStart = frames.at(-1).end, duration = returnStart + RETURN + BLACKOUT;
  chapters.push({ id: 'returning', label: '群星归航', start: returnStart, end: returnStart + RETURN, description: '每架无人机回到自己的起降位置。' },
    { id: 'blackout', label: '余光谢幕', start: duration - BLACKOUT, end: duration, description: '归航完成后，灯点缓缓熄灭。' });
  let heroIndex = frames.findIndex(frame => frame.actors.length > 1); if (heroIndex < 0) heroIndex = 0;
  let highlightIndex = frames.findLastIndex(frame => frame.scene.effect !== 'none'); if (highlightIndex < 0) highlightIndex = Math.max(heroIndex, frames.length - 2);
  const hero = frames[heroIndex], highlight = frames[highlightIndex];
  return Object.freeze({ id: 'ai', scoreVersion: 2, title: score.title, shortTitle: 'AI 立体剧场', subtitle: '立体演员 · 多主体叙事 · 电影运镜', description: score.synopsis,
    chapters: Object.freeze(chapters.map(Object.freeze)), duration, returnStart, heroTime: Math.round(hero.start + (hero.end - hero.start) * .55),
    highlightTime: Math.round(highlight.start + (highlight.end - highlight.start) * .64), recoveryTime: returnStart,
    heroLabel: '主角登场', highlightLabel: '立体高光', recoveryLabel: '完整归航', supportsFpv: false, supportsAudio: false, cinematic: true, sampleVisual: 'spectacle-v2',
    note: 'AI 编排受限的立体演员与舞台动作，所有光点和烟花由本地引擎执行；不是实体无人机飞控。此节目无配乐。' });
}
function fireworkProgram(frames, score, end) {
  const selected = frames.filter(frame => frame.scene.effect !== 'none').slice(-3), cues = [];
  for (const frame of selected) {
    const cast = score.cast.find(actor => actor.id === frame.scene.actors[0].id), color = fireRgb(cast.accent);
    for (let side = 0; side < 2; side++) {
      const at = frame.start / 1000 + frame.scene.duration * (side ? .67 : .61);
      const life = Math.min(4.3, end - at - .25);
      cues.push(Object.freeze({ at, origin: Object.freeze([side ? 119 : -119, 153 + side * 6, -104]), style: frame.scene.effect,
        color: Object.freeze(color), count: 320, life, radius: 18, launch: 1.6 }));
    }
  }
  return Object.freeze({ end, cues: Object.freeze(cues) });
}
function rawCamera(frame, progress, aspect, reduced = false) {
  const fov = 46, tangent = Math.tan(fov * Math.PI / 360), p = clamp(progress);
  const bounds = { min: [...frame.bounds.min], max: [...frame.bounds.max] };
  if (!reduced && frame.scene.effect !== 'none') {
    // The actors own the close shot first. Pull back only as the rockets are
    // about to launch, rather than spending an entire scene on empty margins.
    const reveal = smooth((p - .25) / .22), expanded = { min: [...bounds.min], max: [...bounds.max] };
    include(expanded, [-140, 94, -135]); include(expanded, [140, 202, -75]);
    for (let axis = 0; axis < 3; axis++) { bounds.min[axis] = mix(bounds.min[axis], expanded.min[axis], reveal); bounds.max[axis] = mix(bounds.max[axis], expanded.max[axis], reveal); }
  }
  const spanX = bounds.max[0] - bounds.min[0], spanY = bounds.max[1] - bounds.min[1];
  // Actors live in the upper-middle safe frame. The lower 36% is deliberately
  // free for the real controls/audio/export panel, not merely inside the canvas.
  const halfHeight = Math.max(54, spanY / 1.06, spanX / (1.80 * aspect));
  const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
  const target = [center[0], center[1] - halfHeight * .37, center[2]];
  let distance = halfHeight / tangent + Math.max(0, bounds.max[2] - center[2]) * .55;
  const beat = Math.sin(p * Math.PI) ** 2;
  if (!reduced && frame.scene.camera === 'push') distance *= 1.08 - .10 * beat;
  else if (frame.scene.camera === 'wide') distance *= 1.04;
  const yaw = !reduced && frame.scene.camera === 'orbit' ? Math.sin(p * TAU) * .10 * beat : 0;
  const rise = !reduced && frame.scene.camera === 'rise' ? Math.sin(p * Math.PI) * 11 : 0;
  return { position: [target[0] + Math.sin(yaw) * distance, target[1] + distance * .075 + rise, target[2] + Math.cos(yaw) * distance], target, fov, near: .1, far: Math.max(900, distance + 400) };
}
const interpolateCamera = (a, b, p) => ({ ...b, position: a.position.map((value, i) => mix(value, b.position[i], p)), target: a.target.map((value, i) => mix(value, b.target[i], p)), far: Math.max(a.far, b.far) });

/** Pure deterministic V2 runtime: the model supplies data, never executable code. */
export function createAiDroneStageRuntime(input) {
  const score = validateAiDroneScore(input); if (score.version !== 2) throw new TypeError('V2 stage requires a V2 score');
  if (runtimes.has(score)) return runtimes.get(score);
  let cursor = LAUNCH;
  const frames = score.scenes.map((scene, index) => { const frame = compileScene(scene, score, index, cursor); cursor = frame.end; return frame; });
  const program = makeProgram(score, frames), fireworks = fireworkProgram(frames, score, program.returnStart / 1000);
  const heroFrame = frames.find(frame => program.heroTime >= frame.start && program.heroTime < frame.end) || frames[0];
  const scratchA = new Float64Array(3), scratchB = new Float64Array(3);
  const sample = timeMs => {
    const elapsed = Number.isFinite(timeMs) ? Math.max(0, Math.min(program.duration, timeMs)) : 0;
    const chapter = program.chapters.find(item => elapsed < item.end) || program.chapters.at(-1), progress = clamp((elapsed - chapter.start) / (chapter.end - chapter.start));
    const energy = elapsed < 2000 ? smooth(elapsed / 2000) : elapsed >= program.duration - BLACKOUT ? 1 - smooth(progress) : 1;
    return { elapsed, seconds: elapsed / 1000, phase: chapter.id, label: chapter.label, description: chapter.description, progress,
      active: elapsed < program.duration, energy, chapter, cue: chapter.id, cueLabel: chapter.label, cueDescription: chapter.description,
      cueProgress: progress, nextIn: 0, sceneIndex: chapter.sceneIndex ?? (elapsed < LAUNCH ? 0 : frames.length - 1) };
  };
  const update = (fleet, timeMs, { reducedMotion = false } = {}) => {
    if (!Number.isInteger(fleet?.count) || fleet.count < 1 || fleet.count > COUNT || !['positions', 'colors', 'bases'].every(key => fleet[key]?.length === fleet.count * 3) || fleet.sizes?.length !== fleet.count || fleet.identities?.length !== fleet.count) throw new TypeError('V2 stage requires valid fleet buffers');
    // Validate every identity/base before touching any output buffer, matching
    // the legacy runtime's all-or-nothing boundary for malformed imported data.
    for (let i = 0; i < fleet.count; i++) {
      const id = fleet.identities[i], k = i * 3;
      if (!Number.isInteger(id) || id < 0 || id >= COUNT || !Number.isFinite(fleet.bases[k]) || !Number.isFinite(fleet.bases[k + 1]) || !Number.isFinite(fleet.bases[k + 2]) || fleet.bases[k + 1] < 0) throw new TypeError('Invalid physical drone identity or launch base');
    }
    const state = sample(timeMs), time = state.elapsed, index = state.sceneIndex;
    const frame = reducedMotion ? heroFrame : frames[index], local = clamp((time - frame.start) / (frame.end - frame.start));
    const poses = actorPoses(frame, reducedMotion ? .5 : local, reducedMotion);
    const prior = frames[Math.max(0, index - 1)], priorPoses = actorPoses(prior, 1, reducedMotion);
    const first = reducedMotion ? heroFrame : frames[0], firstPoses = actorPoses(first, reducedMotion ? .5 : 0, reducedMotion);
    const last = reducedMotion ? heroFrame : frames.at(-1), lastPoses = actorPoses(last, reducedMotion ? .5 : 1, reducedMotion);
    const transitionMs = Math.min(3400, (frame.end - frame.start) * .28), transitioning = !reducedMotion && index > 0 && time >= frame.start && time < frame.start + transitionMs;
    for (let i = 0; i < fleet.count; i++) {
      const id = fleet.identities[i], k = i * 3, source = id * 3;
      let groundMix = 0, blend = 1, fromColors = frame.colors, toColors = frame.colors;
      if (time < LAUNCH) {
        pointFor(first, firstPoses, id, scratchA); const stagger = hash(id, score.seed) * 1100;
        groundMix = 1 - smooth((time - 2000 - stagger) / (LAUNCH - 2000 - stagger)); fromColors = toColors = first.colors;
      } else if (time >= program.returnStart) {
        pointFor(last, lastPoses, id, scratchA); const stagger = hash(id, score.seed + 1) * 1100;
        groundMix = smooth((time - program.returnStart - stagger) / (RETURN - stagger)); fromColors = toColors = last.colors;
      } else {
        pointFor(frame, poses, id, scratchA);
        if (transitioning) {
          pointFor(prior, priorPoses, id, scratchB);
          const stagger = frame.scene.transition === 'sweep' ? clamp(scratchB[0] / 260 + .5) * .28 : 0;
          blend = smooth(((time - frame.start) / transitionMs - stagger) / (1 - stagger));
          const arc = frame.scene.transition === 'burst' ? Math.sin(blend * Math.PI) ** 2 : 0, angle = hash(id, score.seed + 23) * TAU;
          scratchA[0] = mix(scratchB[0], scratchA[0], blend) + Math.cos(angle) * 8 * arc;
          scratchA[1] = mix(scratchB[1], scratchA[1], blend) + 9 * arc;
          scratchA[2] = mix(scratchB[2], scratchA[2], blend) + Math.sin(angle) * 8 * arc;
          fromColors = prior.colors;
        }
      }
      fleet.positions[k] = groundMix === 1 ? fleet.bases[k] : mix(scratchA[0], fleet.bases[k], groundMix);
      fleet.positions[k + 1] = groundMix === 1 ? fleet.bases[k + 1] : Math.max(fleet.bases[k + 1], mix(scratchA[1], fleet.bases[k + 1], groundMix));
      fleet.positions[k + 2] = groundMix === 1 ? fleet.bases[k + 2] : mix(scratchA[2], fleet.bases[k + 2], groundMix);
      fleet.sizes[i] = mix(.22, .08, groundMix) * state.energy;
      for (let axis = 0; axis < 3; axis++) fleet.colors[k + axis] = mix(fromColors[source + axis], toColors[source + axis], blend) * state.energy;
    }
    fleet.state = state; return state;
  };
  const camera = (timeMs, aspect = 16 / 9, reducedMotion = false) => {
    const state = sample(timeMs), time = state.elapsed, ratio = Number.isFinite(aspect) ? Math.max(.25, Math.min(4, aspect)) : 16 / 9;
    if (reducedMotion) return rawCamera(heroFrame, .5, ratio, true);
    const ground = { position: [12, 30, 116], target: [0, 7, -4], fov: 46, near: .1, far: 900 };
    if (time < LAUNCH) return interpolateCamera(ground, rawCamera(frames[0], 0, ratio), smooth((time - 2000) / (LAUNCH - 2000)));
    if (time >= program.returnStart) return interpolateCamera(rawCamera(frames.at(-1), 1, ratio), ground, smooth((time - program.returnStart) / RETURN));
    const frame = frames[state.sceneIndex], p = clamp((time - frame.start) / (frame.end - frame.start)), pose = rawCamera(frame, p, ratio);
    const transitionMs = Math.min(3400, (frame.end - frame.start) * .28);
    if (state.sceneIndex > 0 && time - frame.start < transitionMs) return interpolateCamera(rawCamera(frames[state.sceneIndex - 1], 1, ratio), pose, smooth((time - frame.start) / transitionMs));
    return pose;
  };
  const runtime = Object.freeze({ score, program, sample, update, camera, fireworkProgram: fireworks,
    diagnostics: Object.freeze({ version: 2, canonicalCount: COUNT, sceneActorCounts: Object.freeze(frames.map(frame => frame.actors.length)),
      coreLitCounts: Object.freeze(frames.map(() => COUNT)), actorKinds: Object.freeze(score.cast.map(actor => actor.kind)) }) });
  runtimes.set(score, runtime); return runtime;
}
