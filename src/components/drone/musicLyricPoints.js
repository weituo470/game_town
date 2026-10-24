// Local lyric input becomes real fleet positions, never an HTML subtitle overlay.
// Text and sampled glyphs remain private, in memory; neither enters the public score.
export function validateLyricCues(input, durationMs) {
  if (!Array.isArray(input) || input.length > 200) throw new Error('歌词最多为 200 句。');
  let end = -1;
  return input.map(row => {
    if (!Number.isFinite(row.startMs) || !Number.isFinite(row.endMs) || row.startMs < end || row.startMs < 0 || row.endMs <= row.startMs || row.endMs > durationMs || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 80) throw new Error('歌词时间点重叠、超出音轨或文字过长。');
    end = row.endMs;
    return { startMs: row.startMs, endMs: row.endMs, text: row.text.trim() };
  });
}

export function findLyricCue(cues, timeMs) {
  let low = 0, high = cues.length - 1, index = -1;
  while (low <= high) { const mid = (low + high) >>> 1; if (cues[mid].startMs <= timeMs) { index = mid; low = mid + 1; } else high = mid - 1; }
  return index >= 0 && timeMs < cues[index].endMs ? index : -1;
}

export function splitLyricLines(text, width = 14) {
  const chars = [...text.replace(/\s+/g, ' ').trim()], lines = [];
  while (chars.length) lines.push(chars.splice(0, width).join(''));
  return lines;
}

export const LYRIC_GLYPH_PROFILE = Object.freeze({ fontPixels: 48, sampleStep: 2, lineWidth: 12, maxWorldWidth: 248, maxWorldHeight: 52 });
export function createLyricPointForms(cues, { canvasFactory = () => document.createElement('canvas'), lineWidth = LYRIC_GLYPH_PROFILE.lineWidth, sampleStep = LYRIC_GLYPH_PROFILE.sampleStep } = {}) {
  if (![2, 3].includes(sampleStep)) throw new RangeError('Unsupported lyric sampling grid');
  const cache = new Map();
  return cues.map(cue => {
    if (cache.has(cue.text)) return cache.get(cue.text);
    let lines = splitLyricLines(cue.text, lineWidth);
    // Avoid a lone final character on a second line, especially on phones.
    if (lines.length > 1 && [...lines.at(-1)].length <= 2) lines = splitLyricLines(cue.text, Math.ceil([...cue.text].length / lines.length));
    const canvas = canvasFactory();
    canvas.width = 640; canvas.height = Math.max(60, lines.length * 54 + 6);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('浏览器无法生成无人机文字点阵。');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = `700 ${LYRIC_GLYPH_PROFILE.fontPixels}px "Microsoft YaHei", "Noto Sans SC", sans-serif`;
    context.textAlign = 'center'; context.textBaseline = 'top'; context.fillStyle = '#ffffff';
    const measuredWidth = Math.max(...lines.map(line => context.measureText(line).width));
    const scale = Math.min(.65, LYRIC_GLYPH_PROFILE.maxWorldWidth / Math.max(1, measuredWidth), LYRIC_GLYPH_PROFILE.maxWorldHeight / canvas.height);
    // Single-line phrases sit entirely in the dark sky, not across noisy water.
    const centerY = lines.length === 1 ? 119 : 116;
    lines.forEach((line, i) => context.fillText(line, 320, i * 54 + 3));
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data, points = [];
    // 48px source glyphs preserve small counters and several beads across each
    // heavy stroke. Never decimate a 22px raster then enlarge its missing bits.
    for (let y = 0; y < canvas.height; y += sampleStep) for (let x = 0; x < canvas.width; x += sampleStep) {
      if (rgba[(y * canvas.width + x) * 4 + 3] > 145) points.push([(x - 320) * scale, centerY + (canvas.height / 2 - y) * scale, 14]);
    }
    const form = { points, lines: lines.length, width: measuredWidth * scale, height: canvas.height * scale, fontPixels: LYRIC_GLYPH_PROFILE.fontPixels, sampleStep };
    cache.set(cue.text, form); return form;
  });
}

export function sampleLyricLamp(cues, forms, timeMs, index, budget) {
  const active = findLyricCue(cues, timeMs);
  if (active < 0 || !forms[active]?.points.length) return null;
  const form = forms[active];
  const point = index < Math.min(form.points.length, budget) ? form.points[Math.floor(index * Math.max(1, form.points.length / budget))] : null;
  if (!point) return null;
  // Color progression is an explicitly decorative line sweep, not claimed word alignment.
  const elapsed = (timeMs - cues[active].startMs) / (cues[active].endMs - cues[active].startMs);
  const warm = point[0] / Math.max(1, form.width) + .5 <= elapsed;
  return { point, color: warm ? [1.5, 1.13, .48] : [.83, 1.18, 1.5], cueIndex: active };
}

const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
/** Alternating aircraft banks: one can continue displaying a sung phrase while
 * the other physically forms the next. Seek-safe, no accumulating simulations. */
export function createLyricFlightFrame(cues, forms, timeMs, budget) {
  const active = findLyricCue(cues, timeMs), half = Math.floor(budget / 2);
  const states = [0, 1].map(bank => {
    let index = active >= 0 && active % 2 === bank ? active : -1;
    if (index < 0) index = cues.findIndex((c, i) => i % 2 === bank && timeMs >= c.startMs - 800 && timeMs < c.startMs);
    if (index < 0) index = cues.findLastIndex((c, i) => i % 2 === bank && timeMs >= c.endMs && timeMs < c.endMs + 250);
    if (index < 0) return null;
    const cue = cues[index], incoming = timeMs < cue.startMs, outgoing = timeMs >= cue.endMs;
    // Incoming aircraft travel with near-dark lamps. Two full-bright sentences
    // must never overlap in the same subtitle band, even at a shared boundary.
    return { index, cue, form: forms[index], incoming, outgoing, formation: smooth((timeMs - cue.startMs + 800) / 800), fade: outgoing ? 0 : incoming ? .025 * smooth((timeMs - cue.startMs + 800) / 800) : 1 };
  });
  return index => {
    const state = states[index % 2];
    if (!state?.form?.points.length || !half) return null;
    const local = Math.floor(index / 2), pointIndex = Math.floor(local * Math.max(1, state.form.points.length / half));
    const target = local < Math.min(half, state.form.points.length) ? state.form.points[pointIndex] : null;
    if (!target) return null;
    let point = target;
    if (state.incoming) {
      const prior = forms[state.index - 2]?.points, start = prior?.[Math.floor(local * Math.max(1, prior.length / half))] || [target[0], 20 - local % 9, 32];
      point = target.map((v, axis) => start[axis] + (v - start[axis]) * state.formation);
    } else if (state.outgoing) point = [target[0], target[1] - smooth((timeMs - state.cue.endMs) / 250) * 3, target[2]];
    const progress = (timeMs - state.cue.startMs) / (state.cue.endMs - state.cue.startMs);
    const warm = target[0] / Math.max(1, state.form.width) + .5 <= progress;
    return { point, color: (warm ? [1.6, 1.32, .74] : [1.25, 1.42, 1.6]).map(v => v * state.fade), size: .22 * state.fade, cueIndex: state.index };
  };
}
