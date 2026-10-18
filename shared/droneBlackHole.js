// A standalone sky apparition, not an aircraft formation or a battle sequel.
// Absolute-time sampling makes pause, rewind and reduced-motion deterministic.
export const BLACK_HOLE_DURATION = 90000;
export const BLACK_HOLE_CENTER = Object.freeze([0, 130, -50]);
export const BLACK_HOLE_CHAPTERS = Object.freeze([
  { id: 'emergence', label: '长夜初现', start: 0, end: 12000, description: '小镇上方，一道微光从深空中缓缓浮现。' },
  { id: 'forming', label: '光环成形', start: 12000, end: 35000, description: '明亮的吸积盘环绕漆黑核心，引力透镜将远侧光线弯成光弧。' },
  { id: 'majesty', label: '黑洞降临', start: 35000, end: 65000, description: '恢宏的光盘悬在小镇天际，冷暖光带描绘深空的尺度。' },
  { id: 'stillness', label: '凝望深空', start: 65000, end: 80000, description: '保持完整全景，静静凝望光与暗的边界。' },
  { id: 'fading', label: '星光归寂', start: 80000, end: 90000, description: '光环平缓隐去，小镇与星空重新成为主角。' },
  { id: 'ended', label: '奇观落幕', start: 90000, end: Infinity, description: '黑洞奇观已结束，可重新观看或切换其它节目。' },
].map(chapter => Object.freeze(chapter)));

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

export function sampleBlackHoleShow(timeMs = 0, { reducedMotion = false } = {}) {
  const elapsed = Number.isFinite(timeMs) ? Math.max(0, Math.min(BLACK_HOLE_DURATION, timeMs)) : 0;
  const chapter = BLACK_HOLE_CHAPTERS.find(item => elapsed >= item.start && elapsed < item.end);
  const progress = chapter.id === 'ended' ? 1 : (elapsed - chapter.start) / (chapter.end - chapter.start);
  const opacity = smooth(elapsed / 12000) * (1 - smooth((elapsed - 80000) / 10000));
  return { program: 'blackhole', elapsed, seconds: elapsed / 1000, phase: chapter.id,
    label: chapter.label, description: chapter.description, progress, active: elapsed < BLACK_HOLE_DURATION,
    cue: chapter.id, cueLabel: chapter.label, cueDescription: chapter.description, cueProgress: progress,
    energy: opacity, opacity, formation: smooth((elapsed - 12000) / 23000),
    animationTime: reducedMotion ? 45 : elapsed / 1000, nextIn: 0 };
}

export function updateBlackHoleFleet(fleet, timeMs, options = {}) {
  // These buffers remain available to the common host, but cannot masquerade
  // as the black hole. Parking once also avoids rewriting 4096 hidden emitters.
  if (fleet.state?.program !== 'blackhole') {
    fleet.positions.set(fleet.bases); fleet.colors.fill(0); fleet.sizes.fill(0);
  }
  fleet.state = sampleBlackHoleShow(timeMs, options);
  return fleet.state;
}
