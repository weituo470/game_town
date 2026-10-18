import { createDroneFormations, FORMATION_COUNT } from './droneFormations.js';
import { createDragonFormation } from './droneDragon.js';
import { isKidGokuEye } from './droneKidGoku.js';
import { DRONE_FALL, droneFallBatch, sampleDroneFall } from './droneFall.js';
export { sampleDroneFall, droneFallBatch } from './droneFall.js';

export const DRONE_COUNT = FORMATION_COUNT;
export const DRONE_DURATION = 150000;
export const DRONE_CYCLE = 180000;
// One shared score drives geometry, camera, UI and sound. The falling fleet is
// a fictional light-show stunt over the empty sea, not a real-flight procedure.
export const DRONE_STUNT = Object.freeze({
  ...DRONE_FALL, gatherStart: 80000, gatherEnd: 86000,
  wingFormEnd: 96500, wingEnd: 98000, reformEnd: 104000, end: 108000,
});
export const DRONE_DRAGON = Object.freeze({ start: 36000, formed: 44000, holdEnd: 56000, end: 68000 });
export const DRONE_HIGHLIGHTS = Object.freeze([
  { id: 'awakening', label: '少年睁眼', start: 68000, end: 80000, description: '大圆眼亮起星光，幼年悟空握住如意棒，笑迎小镇。' },
  { id: 'convergence', label: '天穹之眼', start: 80000, end: 88000, description: '少年光像解构为海上光盘，万灯蓄势，天幕骤暗。' },
  { id: 'freefall', label: '分批失重', start: DRONE_STUNT.fallStart, end: DRONE_STUNT.brakeStart, description: '四个相邻扇区依次断光，以真实重力加速坠向海面，留下层层高度差。' },
  { id: 'braking', label: '同拍复燃', start: DRONE_STUNT.brakeStart, end: DRONE_STUNT.recoverStart, description: '四批机群同一拍亮灯、恢复推力，在各自高度同时止住下坠，最低一批距海面约四米。' },
  { id: 'phoenix', label: '贴海复燃', start: DRONE_STUNT.recoverStart, end: 98000, description: '四层光阵同时展开为火焰双翼，从海面重新织回完整编队。' },
  { id: 'rebirth', label: '浴火重生', start: 98000, end: 104000, description: '火翼织回幼年悟空，刺猬发、蓝道服、白腰结与红金如意棒重新点亮。' },
  { id: 'apotheosis', label: '少年英雄', start: 104000, end: 108000, description: '大头少年提棒而立，明亮笑脸为小镇留下一次高光定格。' },
].map(cue => Object.freeze(cue)));
export const DRONE_CHAPTERS = Object.freeze([
  { id: 'lighting', label: '万灯初醒', start: 0, end: 8000, description: '四座起降阵列依次点亮，四千零九十六颗星等待升空。' },
  { id: 'ascent', label: '群星离地', start: 8000, end: 28000, description: '机群逐列垂直抬升，在小镇上方汇成天穹。' },
  { id: 'galaxy', label: '星河开卷', start: 28000, end: DRONE_DRAGON.start, description: '金色星河缓缓旋转，青玉光带围绕中央舞台。' },
  { id: 'dragon', label: '苍龙凌空', start: DRONE_DRAGON.start, end: DRONE_DRAGON.holdEnd, description: '冰蓝星光织成展翼巨龙，长尾盘卷，吐息光流穿过夜空。' },
  { id: 'forming', label: '少年成相', start: DRONE_DRAGON.holdEnd, end: 68000, description: '蓝色龙翼化作光骨，刺猬发、大圆眼、蓝道服和如意棒逐层织成幼年悟空。' },
  { id: 'avatar', label: '法天象地', start: 68000, end: 108000, description: '少年睁眼、失重坠落、贴海复燃、浴火重生，四十秒连贯高潮。' },
  { id: 'returning', label: '众星归航', start: 108000, end: 128000, description: '巨像化作归航的流星，机群沿四条光河回到起降区。' },
  { id: 'landing', label: '落星成阵', start: 128000, end: 148000, description: '机群逐队下降，每一架无人机回到最初的位置。' },
  { id: 'blackout', label: '余光谢幕', start: 148000, end: 150000, description: '四座阵列熄灯，整场演出完整收束。' },
  { id: 'waiting', label: '静候星起', start: 150000, end: 180000, description: '无人机已全部回收，等待下一场演出。' },
].map(chapter => Object.freeze(chapter)));
export const DRONE_LAUNCH_PADS = Object.freeze([
  Object.freeze({ x: -26, z: 24, y: 0.65 }), Object.freeze({ x: 26, z: 24, y: 0.65 }),
  Object.freeze({ x: -26, z: -24, y: 0.65 }), Object.freeze({ x: 26, z: -24, y: 0.65 }),
]);
const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const p = clamp(value); return p * p * (3 - 2 * p); };
const mix = (a, b, t) => a + (b - a) * t;
const cycleTime = time => Number.isFinite(time) ? ((time % DRONE_CYCLE) + DRONE_CYCLE) % DRONE_CYCLE : 0;

export function sampleDroneShow(timeMs = 0) {
  const elapsed = cycleTime(timeMs);
  const chapter = DRONE_CHAPTERS.find(item => elapsed >= item.start && elapsed < item.end);
  const seconds = elapsed / 1000;
  const baseEnergy = seconds < 8 ? smooth(seconds / 8) * 0.42
    : seconds < 28 ? mix(0.42, 0.78, smooth((seconds - 8) / 20))
      : seconds < 48 ? 0.78 : seconds < 68 ? mix(0.78, 1, smooth((seconds - 48) / 20))
        : seconds < 108 ? 1 : seconds < 128 ? mix(1, 0.65, smooth((seconds - 108) / 20))
          : seconds < 148 ? 0.65 : seconds < 150 ? 0.65 * (1 - smooth((seconds - 148) / 2)) : 0;
  const cue = DRONE_HIGHLIGHTS.find(item => elapsed >= item.start && elapsed < item.end);
  // Global energy is only the score envelope. Rendering samples each sector's
  // own blackout, preserving the visual sequence instead of dimming all at once.
  const stuntEnergy = Array.from({ length: DRONE_STUNT.batchCount }, (_, batch) => sampleDroneFall(elapsed, batch).energy)
    .reduce((total, energy) => total + energy, 0) / DRONE_STUNT.batchCount;
  const energy = baseEnergy * stuntEnergy;
  return { elapsed, seconds, phase: chapter.id, label: chapter.label, description: chapter.description,
    progress: (elapsed - chapter.start) / (chapter.end - chapter.start), active: elapsed < DRONE_DURATION, energy,
    cue: cue?.id ?? chapter.id, cueLabel: cue?.label ?? chapter.label, cueDescription: cue?.description ?? chapter.description,
    cueProgress: cue ? (elapsed - cue.start) / (cue.end - cue.start) : (elapsed - chapter.start) / (chapter.end - chapter.start),
    nextIn: elapsed >= DRONE_DURATION ? DRONE_CYCLE - elapsed : 0 };
}

export function createDroneFleet(count = DRONE_COUNT) {
  const formation = createDroneFormations(count);
  const dragon = createDragonFormation(formation.identities);
  const fleet = {
    count, positions: new Float32Array(count * 3), colors: new Float32Array(count * 3), sizes: new Float32Array(count),
    bases: new Float32Array(count * 3), galaxy: new Float32Array(count * 3), hero: formation.hero,
    skyEye: formation.skyEye, phoenix: formation.phoenix,
    dragon: dragon.positions, dragonColors: dragon.colors, dragonParts: dragon.parts,
    baseColors: formation.colors, parts: formation.parts, identities: formation.identities,
    launchDelays: new Float32Array(count), returnDelays: new Float32Array(count),
    phases: new Float32Array(count), pads: new Uint8Array(count), fallBatches: new Uint8Array(count),
    meta: Object.freeze({ bounds: Object.freeze({ minX: -61, maxX: 61, minY: 0.65, maxY: 116, minZ: -48, maxZ: 124 }), groundY: 0.65 }),
  };
  for (let i = 0; i < count; i++) {
    const identity = formation.identities[i];
    const pad = Math.floor(identity / 1024);
    const local = identity % 1024;
    const row = Math.floor(local / 32), col = local % 32;
    fleet.pads[i] = pad;
    fleet.fallBatches[i] = droneFallBatch(fleet.skyEye[i * 3], fleet.skyEye[i * 3 + 2]);
    fleet.bases[i * 3] = DRONE_LAUNCH_PADS[pad].x + (col - 15.5) * 0.23;
    fleet.bases[i * 3 + 1] = 0.65;
    fleet.bases[i * 3 + 2] = DRONE_LAUNCH_PADS[pad].z + (row - 15.5) * 0.23;
    fleet.launchDelays[i] = row / 31 * 3.1 + pad * 0.3;
    fleet.returnDelays[i] = (31 - row) / 31 * 4.4 + pad * 0.4;
    fleet.phases[i] = identity * 2.399963229728653;
    const q = ((identity * 1597) % DRONE_COUNT + 0.5) / DRONE_COUNT;
    const radius = 5 + Math.sqrt(q) * 37;
    const arm = identity % 5;
    const angle = arm / 5 * TAU + radius * 0.12 + (identity % 17 - 8) * 0.021;
    fleet.galaxy[i * 3] = Math.cos(angle) * radius;
    fleet.galaxy[i * 3 + 1] = 55 + Math.sin(angle) * radius * 0.52 + Math.sin(identity * 1.618) * 3.4;
    fleet.galaxy[i * 3 + 2] = -8 + Math.sin(angle) * radius * 0.56 + Math.cos(identity * 1.618) * 2.2;
  }
  updateDroneFleet(fleet, 0);
  return fleet;
}

/** Every drone is sampled by fixed identity from absolute time. No accumulated delta. */
export function updateDroneFleet(fleet, timeMs, { reducedMotion = false } = {}) {
  const state = sampleDroneShow(timeMs);
  const s = state.seconds;
  const angle = 0.52 * smooth((s - 28) / 8);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const heroEnvelope = s >= 68 && s < 80 ? Math.sin((s - 68) / 12 * Math.PI)
    : s >= 104 && s < 108 ? Math.sin((s - 104) / 4 * Math.PI) * 0.25 : 0;
  const heroDrift = reducedMotion ? 0 : heroEnvelope * Math.sin((s - 68) * 0.19);
  // Close-packed parked/returning drones use small navigation lights, not the
  // large show emitters. Otherwise a 32x32 rack blooms into a solid white tile.
  const emitterScale = s < 28 ? mix(0.2, 1, smooth((s - 12) / 16))
    : s < 108 ? 1 : s < 128 ? mix(1, 0.2, smooth((s - 108) / 20)) : 0.2;
  // The reveal has a deliberate beat: form the body, awaken the eyes, then send
  // one soft wave up the blue gi. These are light cues, not discontinuous poses.
  const eyeReveal = smooth((s - 68) / 6);
  const eyeFocus = smooth((s - 56) / 12) * (1 - smooth((s - 108) / 8));
  const scanProgress = clamp((s - 74) / 6);
  const scanEnvelope = reducedMotion ? 0 : smooth(scanProgress / 0.2) * (1 - smooth((scanProgress - 0.8) / 0.2));
  const scanHeight = mix(18, 114, scanProgress);
  const stuntActive = !reducedMotion && s >= 80 && s < 104;
  // Hold the completed motifs long enough to read them: two seconds of the
  // high mandala before blackout, then 1.5 seconds of the recovered fire wings.
  const gather = smooth((state.elapsed - DRONE_STUNT.gatherStart) / (DRONE_STUNT.gatherEnd - DRONE_STUNT.gatherStart));
  const unfold = smooth((state.elapsed - DRONE_STUNT.recoverStart) / (DRONE_STUNT.wingFormEnd - DRONE_STUNT.recoverStart));
  const reform = smooth((s - 98) / 6);
  const batchFalls = Array.from({ length: DRONE_STUNT.batchCount }, (_, batch) => sampleDroneFall(state.elapsed, batch));
  const showEnergy = reducedMotion && s >= 80 && s < 108 ? 1 : state.energy;
  const stuntColor = stuntActive ? smooth((s - 80) / 6) * (1 - reform) : 0;
  const fireColor = smooth((state.elapsed - DRONE_STUNT.brakeStart) / 180);
  const dragonReveal = smooth((state.elapsed - DRONE_DRAGON.start) / (DRONE_DRAGON.formed - DRONE_DRAGON.start));
  const dragonColor = dragonReveal * (1 - smooth((state.elapsed - DRONE_DRAGON.holdEnd) / (DRONE_DRAGON.end - DRONE_DRAGON.holdEnd)));
  const wingEnvelope = reducedMotion ? 0 : Math.sin(Math.PI * clamp((state.elapsed - DRONE_DRAGON.formed) / (DRONE_DRAGON.holdEnd - DRONE_DRAGON.formed))) ** 2;
  for (let i = 0; i < fleet.count; i++) {
    const k = i * 3, part = fleet.parts[i], phase = fleet.phases[i];
    const fall = batchFalls[fleet.fallBatches[i]];
    const bx = fleet.bases[k], by = fleet.bases[k + 1], bz = fleet.bases[k + 2];
    const gx = fleet.galaxy[k] * ca - (fleet.galaxy[k + 2] + 8) * sa;
    const gy = fleet.galaxy[k + 1];
    const gz = fleet.galaxy[k] * sa + (fleet.galaxy[k + 2] + 8) * ca - 8;
    let hx = fleet.hero[k], hy = fleet.hero[k + 1], hz = fleet.hero[k + 2];
    // Hair, face, eyes and pole share one tiny breathing offset: no detached
    // rotating halo or per-point ribbon noise survives the old guardian rig.
    hy += heroDrift * .16;
    if (part === 6) { const flutter = clamp((52 - hy) / 15); hx += heroDrift * flutter * .28; hz += heroDrift * flutter * .1; }
    let x = bx, y = by, z = bz;
    if (s >= 8 && s < 28) {
      const u = clamp((s - 8 - fleet.launchDelays[i]) / 16);
      // A genuine vertical departure precedes any lateral travel.
      const lift = smooth(u / 0.28), travel = smooth((u - 0.22) / 0.78);
      x = mix(bx, gx, travel); z = mix(bz, gz, travel);
      y = mix(by, 15 + fleet.pads[i] * 1.5, lift);
      y = mix(y, gy, travel);
    } else if (state.elapsed >= 28000 && state.elapsed < DRONE_DRAGON.start) { x = gx; y = gy; z = gz;
    } else if (state.elapsed >= DRONE_DRAGON.start && state.elapsed < DRONE_DRAGON.formed) {
      x = mix(gx, fleet.dragon[k], dragonReveal); y = mix(gy, fleet.dragon[k + 1], dragonReveal); z = mix(gz, fleet.dragon[k + 2], dragonReveal);
    } else if (state.elapsed >= DRONE_DRAGON.formed && state.elapsed < DRONE_DRAGON.holdEnd) {
      x = fleet.dragon[k]; y = fleet.dragon[k + 1]; z = fleet.dragon[k + 2];
      if (fleet.dragonParts[i] === 1 || fleet.dragonParts[i] === 2) {
        const nearWing = fleet.dragonParts[i] === 2;
        const wingSpan = clamp(Math.hypot(x - (nearWing ? 5.2 : 1.6), (y - 73) * 0.8) / 55);
        const flap = (s - 44) * TAU / 6 + (nearWing ? 0 : 0.35);
        // Sub-metre motion grows from the shoulder without disconnecting the
        // authored wing spars and membrane. A sin² envelope is C1 at both ends.
        y -= wingEnvelope * wingSpan * 0.8 * (0.5 + 0.5 * Math.sin(flap));
        z += wingEnvelope * wingSpan * 0.7 * Math.sin(flap) * (nearWing ? 1 : -1);
      }
    } else if (state.elapsed >= DRONE_DRAGON.holdEnd && s < 68) {
      const delay = part === 0 ? 0 : part === 1 || part === 2 || part === 7 ? 1 : part === 3 || part === 4 ? 2 : part === 5 ? 3 : 4;
      const u = smooth((s - 56 - delay) / (12 - delay));
      const arch = Math.sin(Math.PI * u) * (reducedMotion ? 0 : 4);
      x = mix(fleet.dragon[k], hx, u); y = mix(fleet.dragon[k + 1], hy, u) + arch; z = mix(fleet.dragon[k + 2], hz, u);
    } else if (s >= 68 && s < 108) {
      x = hx; y = hy; z = hz;
      if (stuntActive) {
        const ex = fleet.skyEye[k], ey = fleet.skyEye[k + 1], ez = fleet.skyEye[k + 2];
        if (s < 88) {
          if (gather === 1) { x = ex; y = ey; z = ez; }
          else { x = mix(hx, ex, gather); y = mix(hy, ey, gather); z = mix(hz, ez, gather); }
        } else if (state.elapsed < DRONE_STUNT.recoverStart) { x = ex; y = fall.y; z = ez;
        } else if (s < 98) {
          if (unfold === 1) { x = fleet.phoenix[k]; y = fleet.phoenix[k + 1]; z = fleet.phoenix[k + 2]; }
          else { x = mix(ex, fleet.phoenix[k], unfold); y = mix(fall.stopY, fleet.phoenix[k + 1], unfold); z = mix(ez, fleet.phoenix[k + 2], unfold); }
        } else {
          x = mix(fleet.phoenix[k], hx, reform); y = mix(fleet.phoenix[k + 1], hy, reform); z = mix(fleet.phoenix[k + 2], hz, reform);
        }
      }
    } else if (s >= 108 && s < 128) {
      const delay = part / 8 * 3.5 + (fleet.identities[i] % 16) / 15 * 1.5;
      const u = smooth((s - 108 - delay) / 15);
      const lift = Math.sin(Math.PI * u) * (reducedMotion ? 0 : 9);
      x = mix(hx, bx, u); y = mix(hy, 18 + fleet.pads[i] * 2, u) + lift; z = mix(hz, bz, u);
      // Four luminous rivers separate gracefully before the vertical approach.
      if (!reducedMotion) { x += Math.sin(Math.PI * u) * (fleet.pads[i] % 2 ? 5 : -5); z += Math.sin(Math.PI * u) * (fleet.pads[i] < 2 ? 5 : -5); }
    } else if (s >= 128 && s < 148) {
      const u = smooth((s - 128 - fleet.returnDelays[i]) / 14.4);
      y = mix(18 + fleet.pads[i] * 2, by, u);
    }
    fleet.positions[k] = x; fleet.positions[k + 1] = y; fleet.positions[k + 2] = z;
    let visibility = 1;
    if (s < 8) visibility = smooth((s - fleet.launchDelays[i] * 0.8) / 3.5);
    if (s >= 150) visibility = 0;
    const shimmerEnvelope = smooth((s - 28) / 4) * (1 - smooth((s - 124) / 4));
    const shimmer = reducedMotion ? 1 : 1 + shimmerEnvelope * (-0.06 + 0.06 * Math.sin(phase * 0.07 + s * 0.7));
    const isEye = isKidGokuEye(part, fleet.hero[k], fleet.hero[k + 1]);
    const eyeBrightness = isEye ? 1 + eyeFocus * (-0.76 + eyeReveal * 1.26) : 1;
    const localEnergy = stuntActive ? fall.energy : showEnergy;
    const intensity = localEnergy * visibility * shimmer * mix(eyeBrightness, 1, stuntColor);
    // Resolve the character's authored skin, cool hair rim, blue gi and red pole.
    const colorReveal = smooth((s - 56) / 12);
    const gold = fleet.baseColors[k], green = fleet.baseColors[k + 1], blue = fleet.baseColors[k + 2];
    const initialWarm = fleet.identities[i] % 5 !== 0;
    const eyeRadiance = isEye ? eyeFocus * eyeReveal : 0;
    const sweepDistance = (fleet.hero[k + 1] - scanHeight) / 9;
    const sweep = isEye || scanEnvelope === 0 ? 0 : scanEnvelope * Math.exp(-sweepDistance * sweepDistance) * (part === 0 ? 0.025 : 0.7);
    const pale = (fleet.identities[i] % 7) === 0;
    const flareRed = mix(pale ? 1.5 : 0.55, 1.9, fireColor);
    const flareGreen = mix(pale ? 1.65 : 1.3, pale ? 1.48 : 0.84, fireColor);
    const flareBlue = mix(1.8, pale ? 0.8 : 0.18, fireColor);
    // Slow electric flow along the breath alone; the complete wing/body
    // silhouette holds still and remains readable rather than dissolving.
    const dragonBreath = !reducedMotion && fleet.dragonParts[i] === 6 ? 1 + 0.12 * Math.sin(s * 1.4 + fleet.dragon[k] * 0.14) : 1;
    fleet.colors[k] = mix(mix(mix(mix(initialWarm ? 1.65 : 0.27, gold, colorReveal), 1.85, eyeRadiance), flareRed, stuntColor), fleet.dragonColors[k] * dragonBreath * 0.65, dragonColor) * intensity + sweep * 1.05;
    fleet.colors[k + 1] = mix(mix(mix(mix(initialWarm ? 1.13 : 1.32, green, colorReveal), 1.95, eyeRadiance), flareGreen, stuntColor), fleet.dragonColors[k + 1] * dragonBreath * 0.75, dragonColor) * intensity + sweep * 0.72;
    fleet.colors[k + 2] = mix(mix(mix(mix(initialWarm ? 0.55 : 1.5, blue, colorReveal), 2, eyeRadiance), flareBlue, stuntColor), fleet.dragonColors[k + 2] * dragonBreath, dragonColor) * intensity + sweep * 0.22;
    fleet.sizes[i] = (part === 2 ? 0.24 : part === 6 ? 0.27 : part === 0 ? 0.3 : 0.35) * (0.75 + localEnergy * 0.25) * emitterScale;
  }
  fleet.state = state;
  return state;
}
