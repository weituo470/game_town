// Local, user-supplied media only. Not a public AI schema or a song catalogue.
export const MUSIC_THEMES = Object.freeze({ road: '独行与光路', mountains: '山海远行', crowd: '人海穿行', storm: '风雨迷途', scatter: '消散与失落', dawn: '重生与向前', city: '平凡灯火', home: '归途与相逢', 'bund-tide': '江潮奔涌', 'bund-skyline': '外滩钟声', 'bund-duet': '霓影相逢', 'bund-storm': '沪上风云', 'bund-finale': '万灯起伏', 'bund-harbor': '江月归航' });
export function parseRehearsalLrc(source, durationMs) {
  if (typeof source !== 'string' || source.length > 100000) throw new Error('歌词文件过大或无效。');
  const offset = Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0), rows = [];
  for (const line of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    const text = line.replace(/\[[^\]]*\]/g, '').trim().slice(0, 240);
    if (!text) continue;
    for (const m of tags) {
      const startMs = Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number((m[3] || '').padEnd(3, '0')) + offset;
      if (startMs >= 0 && startMs < durationMs) rows.push({ startMs, text });
    }
  }
  rows.sort((a, b) => a.startMs - b.startMs);
  const seen = new Set();
  const unique = rows.filter(row => { if (seen.has(row.startMs)) return false; seen.add(row.startMs); return true; });
  if (!unique.length) throw new Error('没有找到音轨范围内的 LRC 时间戳；不会凭空生成歌词时间点。');
  if (unique.length > 200) throw new Error('第一版每首歌最多导入 200 个歌词时间点。');
  return unique.map((row, i) => ({ ...row, endMs: unique[i + 1]?.startMs ?? durationMs }));
}
export function suggestMusicTheme(text = '', index = 0, count = 1) {
  // These are editable visual hints, not a claim of semantic/lyric alignment.
  if (/山|海|远方/.test(text)) return 'mountains';
  if (/人群|人海|拥挤/.test(text)) return 'crowd';
  if (/失|散|烟|绝望/.test(text)) return 'scatter';
  if (/风|雨|黑暗|迷/.test(text)) return 'storm';
  if (/平凡|灯|城市/.test(text)) return 'city';
  if (/家|归|相逢/.test(text)) return 'home';
  if (/向前|希望|明天|光/.test(text)) return 'dawn';
  return ['road', 'mountains', 'crowd', 'storm', 'scatter', 'dawn', 'city', 'home'][Math.min(7, Math.floor(index / Math.max(1, count) * 8))];
}
export function createRehearsalPlan({ title = '平凡之路', durationMs, lyrics = [], beats = [] }) {
  if (!Number.isFinite(durationMs) || durationMs < 15000 || durationMs > 600000) throw new Error('排练音轨需为 15 秒至 10 分钟。');
  const keys = Object.keys(MUSIC_THEMES).slice(0, 8);
  const cues = lyrics.length ? lyrics.map((row, i) => ({ startMs: row.startMs, endMs: row.endMs, theme: row.theme || suggestMusicTheme(row.text, i, lyrics.length), title: MUSIC_THEMES[row.theme || suggestMusicTheme(row.text, i, lyrics.length)] }))
    : keys.map((theme, i) => ({ theme, title: MUSIC_THEMES[theme], startMs: Math.round(durationMs * i / 8), endMs: Math.round(durationMs * (i + 1) / 8) }));
  return validateRehearsalPlan({ version: 1, title: title.trim().slice(0, 60) || '音乐排练', durationMs, timing: lyrics.length ? 'imported-lrc-needs-review' : 'draft-not-lyric-aligned', cues, beats });
}
export function validateRehearsalPlan(plan) {
  if (!plan || plan.version !== 1 || !Number.isFinite(plan.durationMs) || plan.durationMs < 15000 || plan.durationMs > 600000 || typeof plan.title !== 'string' || plan.title.length > 60) throw new Error('排练文件格式或时长无效。');
  if (!Array.isArray(plan.cues) || !plan.cues.length || plan.cues.length > 200) throw new Error('排练画面数量无效。');
  let last = -1;
  const cues = plan.cues.map(c => {
    if (!Number.isFinite(c.startMs) || c.startMs <= last || c.startMs < 0 || c.startMs >= plan.durationMs || !Number.isFinite(c.endMs) || c.endMs <= c.startMs || c.endMs > plan.durationMs || !Object.hasOwn(MUSIC_THEMES, c.theme)) throw new Error('排练时间点必须递增且位于音轨内。');
    last = c.startMs;
    return { startMs: c.startMs, endMs: c.endMs, theme: c.theme, title: MUSIC_THEMES[c.theme] };
  });
  const beats = Array.isArray(plan.beats) ? plan.beats.filter(b => Number.isFinite(b) && b >= 0 && b < plan.durationMs).slice(0, 3000).sort((a, b) => a - b) : [];
  return { version: 1, title: plan.title, durationMs: plan.durationMs, timing: plan.timing === 'imported-lrc-needs-review' ? plan.timing : 'draft-not-lyric-aligned', cues, beats };
}
