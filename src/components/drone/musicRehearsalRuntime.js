import { validateRehearsalPlan } from '../../../shared/musicRehearsal.js';
import { validateLyricCues, createLyricPointForms, createLyricFlightFrame, findLyricCue } from './musicLyricPoints.js';
import { sampleShanghaiBundPoint } from './shanghaiBundPoints.js';
import { createMusicFleet, musicFleetCount } from './musicFleet.js';
const smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const hash = (n, salt = 0) => { let k = Math.imul(n + salt * 7919 + 1, 0x45d9f3b); k = Math.imul(k ^ k >>> 16, 0x45d9f3b); return ((k ^ k >>> 16) >>> 0) / 4294967296; };
const WALKER_LINKS = [[[0, 15], [0, 19]], [[0, 4], [0, 14]], [[0, 11], [-5, 7]], [[0, 11], [5, 7]], [[0, 4], [-4, -5]], [[0, 4], [4, -5]]];
function walker(id, step, cx, cy, scale, out) {
  const part = id % 6, t = hash(id, 4), [a, b] = WALKER_LINKS[part], side = part % 2 ? 1 : -1;
  out[0] = cx + mix(a[0], b[0], t) * scale;
  out[1] = cy + mix(a[1], b[1], t) * scale;
  out[2] = -8 + (part >= 2 ? Math.sin(step + side * Math.PI) * t * 3 : Math.cos(t * Math.PI * 2) * 1.8) * scale;
  if (part === 0) { const angle = hash(id, 6) * Math.PI * 2; out[0] = cx + Math.cos(angle) * 3.6 * scale; out[1] = cy + (18 + Math.sin(angle) * 3.6) * scale; }
}
function point(theme, id, s, reduced, out) {
  if (sampleShanghaiBundPoint(theme, id, s, reduced, out)) return;
  const r = hash(id, 1), q = hash(id, 2), h = hash(id, 3), step = reduced ? 0 : s * 2.8;
  let warm = false;
  if (r < .26) { walker(id, step, -12 + Math.sin(s * .06) * 4, 62, 1.5, out); warm = true; }
  else if (theme === 'mountains') {
    if (r < .66) { const x = (q - .5) * 134, ridge = 24 + 21 * Math.abs(Math.sin(x * .047)) + 11 * Math.sin(x * .105); out[0] = x; out[1] = 40 + h * ridge; out[2] = -24 - r * 18; }
    else { out[0] = (q - .5) * 138; out[1] = 43 + Math.sin(q * 20 + (reduced ? 0 : s)) * 3; out[2] = -32 + h * 62; }
  } else if (theme === 'crowd') {
    const who = Math.floor(q * 28); walker(id, step + who, (who % 7 - 3) * 16, 42 + Math.floor(who / 7) * 15, .52 + h * .12, out);
  } else if (theme === 'storm') {
    out[0] = (q - .5) * 135; out[1] = 40 + ((h + (reduced ? 0 : s * .12)) % 1) * 68; out[2] = -30 + r * 42;
  } else if (theme === 'city' || theme === 'home') {
    const tower = Math.floor(q * 17), floor = Math.floor(h * 18), height = 3 + Math.floor(hash(tower, 9) * 16);
    out[0] = (tower - 8) * 8 + (id % 3 - 1) * 1.35; out[1] = 34 + Math.min(floor, height) * 3.4; out[2] = -18 + (id % 4) * 3; warm = id % 5 !== 0;
  } else {
    const t = q, depth = -48 + t * 95;
    out[0] = (h < .5 ? -1 : 1) * (2 + t * 18) + Math.sin(t * 5) * 12;
    out[1] = 36 + Math.sin(t * Math.PI) * 5; out[2] = depth;
    if (r > .86) { out[0] = (q - .5) * 145; out[1] = 55 + h * 54; out[2] = -45; }
    warm = theme === 'dawn';
  }
  if (theme === 'scatter') { const t = reduced ? .15 : .4 + .3 * Math.sin(s * .3); out[0] += (q - .5) * 60 * t; out[1] -= r * 24 * t; out[2] += (h - .5) * 40 * t; }
  if (theme === 'dawn') { out[1] += Math.sin(q * Math.PI) * 12; warm = true; }
  out[3] = warm ? 1.7 : .3; out[4] = warm ? 1.15 : 1.15; out[5] = warm ? .45 : 1.7;
}

/** No downloaded song, lyric text, or provider calls are bundled into this score. */
export function createMusicRehearsalRuntime(input, { audio, url, lyrics = [], lyricForms } = {}) {
  const plan = validateRehearsalPlan(input), duration = plan.durationMs, landing = duration - 8000;
  const lyricCues = validateLyricCues(lyrics, duration);
  const wideForms = lyricCues.length ? lyricForms || createLyricPointForms(lyricCues) : [];
  let forms = wideForms, portraitForms = null, layoutRevision = 0;
  let glyphBankCapacity = forms.reduce((max, form) => Math.max(max, form.points.length), 0);
  function selectLayout(aspect) {
    if (!lyricCues.length || lyricForms) return;
    if (aspect < .95 && !portraitForms) portraitForms = createLyricPointForms(lyricCues, { lineWidth: 8, sampleStep: 3 });
    const selected = aspect < .95 ? portraitForms : wideForms;
    if (forms !== selected) { forms = selected; glyphBankCapacity = forms.reduce((max, form) => Math.max(max, form.points.length), 0); layoutRevision++; }
  }
  const scenes = plan.cues.filter(c => c.startMs < landing).map((c, i, list) => ({ id: `music-${i}`, label: c.title, description: '音乐排练画面；歌词时间与视觉含义仍可在排练台校准。', start: Math.max(8000, c.startMs), end: Math.min(landing, list[i + 1]?.startMs ?? landing), index: i })).filter(c => c.end > c.start);
  if (!scenes.length || scenes[0].start > 8000) scenes.unshift({ id: 'music-intro', label: '光路初现', description: '第一段画面前的天空留白。', start: 8000, end: scenes[0]?.start ?? landing, index: 0 });
  const chapters = [{ id: 'lighting', label: '星灯初醒', start: 0, end: 2000 }, { id: 'ascent', label: '循声升空', start: 2000, end: 8000 }, ...scenes, { id: 'returning', label: '沿光归航', start: landing, end: duration - 1000 }, { id: 'blackout', label: '余光谢幕', start: duration - 1000, end: duration }];
  const program = Object.freeze({ id: 'ai', sampleId: 'music-rehearsal', title: `${plan.title} · 本地排练`, duration, chapters, returnStart: landing, heroTime: Math.min(landing - 1, duration * .38), highlightTime: Math.min(landing - 1, duration * .72), recoveryTime: landing, heroLabel: '故事展开', highlightLabel: '情绪高光', recoveryLabel: '完整归航', cinematic: true, supportsFpv: false, supportsAudio: Boolean(audio), supportsLyricDrones: Boolean(lyricCues.length), soundtrackUrl: url, soundtrackTitle: '本机导入音轨', mediaMaster: audio, note: plan.timing === 'draft-not-lyric-aligned' ? '结构草案：尚未导入歌词时间点，不是《平凡之路》原曲的已对齐成品。音轨仅存在本机内存。' : '歌词由独立无人机光点组成，与音乐共用播放头；逐句时间点可在排练台微调。音轨与歌词不上传、不写入公共节目库。' });
  const sample = ms => {
    const elapsed = Math.max(0, Math.min(duration, Number.isFinite(ms) ? ms : 0)), chapter = chapters.find(c => elapsed >= c.start && elapsed < c.end) || chapters.at(-1);
    return { elapsed, seconds: elapsed / 1000, phase: chapter.id, cue: chapter.id, label: chapter.label, cueLabel: chapter.label, description: chapter.description || '', progress: smooth((elapsed - chapter.start) / Math.max(1, chapter.end - chapter.start)), active: elapsed < duration, energy: 1 };
  };
  const a = new Float64Array(6), b = new Float64Array(6);
  const occupied = new Set();
  const update = (fleet, ms, { reducedMotion = false } = {}) => {
    const state = sample(ms), t = state.elapsed;
    const ci = Math.max(0, plan.cues.findLastIndex(c => c.startMs <= Math.min(t, landing))), cue = plan.cues[ci], previous = plan.cues[Math.max(0, ci - 1)];
    const blend = ci === 0 ? 1 : smooth((t - cue.startMs) / Math.min(2400, (cue.endMs - cue.startMs) * .4));
    let beat = 0; if (!reducedMotion && plan.beats.length) { const i = plan.beats.findLastIndex(v => v <= t); if (i >= 0) beat = Math.exp(-(t - plan.beats[i]) / 160) * .18; }
    occupied.clear();
    // Short Cantonese phrases need fewer aircraft than long verse couplets.
    // Return all unused lettering capacity to the scenery rather than leaving
    // a fixed 62% of the entire fleet dark while only two words are displayed.
    const textBudget = lyricCues.length ? Math.min(Math.floor(fleet.count * .72 / 2) * 2, glyphBankCapacity * 2) : 0;
    const lyricLamp = createLyricFlightFrame(lyricCues, forms, t, textBudget);
    const currentLyric = findLyricCue(lyricCues, t);
    let lyricLamps = 0, storyLamps = 0;
    const sameScene = previous.theme === cue.theme || blend >= 1;
    const seconds = reducedMotion ? 0 : t / 1000;
    for (let i = 0; i < fleet.count; i++) {
      const k = i * 3, id = fleet.identities[i];
      const lamp = i < textBudget ? lyricLamp(i) : null;
      if (i < textBudget) {
        for (let axis = 0; axis < 3; axis++) {
          a[axis] = b[axis] = lamp ? lamp.point[axis] : fleet.bases[k + axis];
          a[axis + 3] = b[axis + 3] = lamp ? lamp.color[axis] : 0;
        }
        if (lamp && lamp.size > .1) lyricLamps++;
      } else {
        // Sample scenery only for its own aircraft, once during held scenes.
        // Increasing glyph resolution must not quadruple all CPU scene work.
        point(cue.theme, id, seconds, reducedMotion, b);
        if (sameScene) a.set(b); else point(previous.theme, id, seconds, reducedMotion, a);
        // Monumental upper-sky stage, with a separate, lower lettering band.
        if (lyricCues.length) {
          a[0] *= 1.55; b[0] *= 1.55;
          a[1] = a[1] * .95 + 120; b[1] = b[1] * .95 + 120;
        }
      }
      const launch = smooth((t - 1500 - hash(id, 10) * 700) / 5800), returned = smooth((t - landing) / 7000);
      for (let axis = 0; axis < 3; axis++) {
        const target = mix(a[axis], b[axis], blend);
        fleet.positions[k + axis] = mix(mix(fleet.bases[k + axis], target, launch), fleet.bases[k + axis], returned);
        fleet.colors[k + axis] = mix(a[axis + 3], b[axis + 3], blend) * (1 + beat) * smooth(t / 1500) * (1 - smooth((t - duration + 1000) / 1000));
      }
      fleet.sizes[i] = .22;
      if (i < textBudget) { fleet.sizes[i] = lamp ? lamp.size : 0; if (!lamp) for (let axis = 0; axis < 3; axis++) fleet.colors[k + axis] = 0; }
      // Suppress coincident emitters on narrow limbs/windows. Never draw
      // connecting line geometry or let hundreds of lamps become a neon tube.
      if (i >= textBudget && t > 7000 && t < duration - 1000) {
        const key = `${Math.round(fleet.positions[k] / .9)},${Math.round(fleet.positions[k + 1] / .9)},${Math.round(fleet.positions[k + 2] / .9)}`;
        if (occupied.has(key)) fleet.sizes[i] = 0;
        else { occupied.add(key); storyLamps++; }
      }
    }
    fleet.musicStats = { lyricLamps, lyricRequired: currentLyric < 0 ? 0 : forms[currentLyric].points.length, storyLamps, textBudget, bankCapacity: Math.floor(textBudget / 2) };
    fleet.state = state; return state;
  };
  let disposed = false;
  return Object.freeze({ program, plan, mediaMaster: audio, createFleet: createMusicFleet, fleetCount: musicFleetCount, get layoutRevision() { return layoutRevision; }, sample, update, dispose() { if (disposed) return; disposed = true; audio?.pause(); audio?.removeAttribute?.('src'); audio?.load?.(); if (url) URL.revokeObjectURL(url); }, camera(ms, aspect = 16 / 9, reducedMotion = false) { selectLayout(aspect); const d = lyricCues.length ? Math.max(215, 300 / (2 * Math.tan(Math.PI * 25 / 180) * Math.max(.25, aspect || 1))) : Math.max(171, 174 / (2 * Math.tan(Math.PI * 25 / 180) * Math.max(.25, aspect || 1))); const drift = reducedMotion || lyricCues.length ? 0 : Math.sin(ms / 24000) * 7; return { position: [drift, lyricCues.length ? 126 : 74, d + 6], target: [0, lyricCues.length ? 120 : 65, -8], fov: 50, near: .1, far: 1800 }; } });
}
