import { useEffect, useRef, useState } from 'react';
import WaveSurfer from '../../vendor/wavesurfer-8.0.3/wavesurfer.esm.js';
import { MUSIC_THEMES, parseRehearsalLrc, createRehearsalPlan } from '../../../shared/musicRehearsal.js';
import { createMusicRehearsalRuntime } from './musicRehearsalRuntime.js';
import { validateLyricCues } from './musicLyricPoints.js';
import { LOCAL_MUSIC_PROGRAMMES, getLocalMusicProgramme } from '../../lib/localMusicCatalogue.js';
import './music-rehearsal.css';
const stamp = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export default function MusicRehearsal({ onPlay }) {
  const initialProgramme = getLocalMusicProgramme(new URLSearchParams(window.location.search).get('score')) || LOCAL_MUSIC_PROGRAMMES[0];
  const [title, setTitle] = useState(initialProgramme.title), [resource, setResource] = useState(null), [lyrics, setLyrics] = useState([]), [beats, setBeats] = useState([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [playing, setPlaying] = useState(false), [offsetMs, setOffsetMs] = useState(0);
  const localPrepared = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const waveform = useRef(null), wave = useRef(null), owned = useRef(null), generation = useRef(0), handedOff = useRef(false);
  const dispose = item => { if (!item) return; item.audio.pause(); item.audio.removeAttribute('src'); item.audio.load(); URL.revokeObjectURL(item.url); };
  useEffect(() => () => { generation.current++; wave.current?.destroy(); if (!handedOff.current) dispose(owned.current); }, []);
  useEffect(() => {
    if (!resource || !waveform.current) return undefined;
    const player = WaveSurfer.create({ container: waveform.current, media: resource.audio, peaks: [resource.peaks], duration: resource.durationMs / 1000, waveColor: '#809aaf', progressColor: '#ceac65', cursorColor: '#2f5f71', height: 100, barWidth: 2, barGap: 2, normalize: true });
    wave.current = player;
    const off = [player.on('play', () => setPlaying(true)), player.on('pause', () => setPlaying(false)), player.on('finish', () => setPlaying(false))];
    return () => { off.forEach(fn => fn()); player.destroy(); if (wave.current === player) wave.current = null; };
  }, [resource]);
  async function loadAudio(file) {
    if (!file) return;
    const token = ++generation.current;
    setError(''); setNotice(''); setBusy(true);
    let next;
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error('第一版音轨上限为 100 MB。');
      const bytes = await file.arrayBuffer(), Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
      const decoded = await new Offline(1, 1, 16000).decodeAudioData(bytes);
      const durationMs = Math.round(decoded.duration * 1000);
      createRehearsalPlan({ durationMs });
      const channel = decoded.getChannelData(0), bins = 1600, peaks = new Float32Array(bins);
      for (let b = 0; b < bins; b++) for (let i = Math.floor(b * channel.length / bins); i < Math.floor((b + 1) * channel.length / bins); i++) peaks[b] = Math.max(peaks[b], Math.abs(channel[i]));
      const url = URL.createObjectURL(file), audio = new Audio(url); audio.preload = 'auto';
      next = { audio, url, durationMs, peaks, name: file.name, sha256 };
      if (token !== generation.current) { dispose(next); return; }
      dispose(owned.current); owned.current = next; handedOff.current = false;
      setResource(next); setLyrics([]); setBeats([]); setOffsetMs(0); setNotice('音轨已在本机解码。尚未导入歌词，不会显示“已按歌词校准”。');
      return next;
    } catch (e) { if (token === generation.current) setError(e.message || '音轨不能解码，请换用 MP3/WAV。'); }
    finally { if (token === generation.current) setBusy(false); }
  }
  async function loadTiming(file, current = owned.current) {
    if (!file || !current) return;
    try {
      if (file.size > 300000) throw new Error('时间轴文件过大。');
      const raw = await file.text();
      if (owned.current !== current) return;
      if (/\.json$/i.test(file.name)) {
        const data = JSON.parse(raw);
        if (data.sourceSha256 && data.sourceSha256 !== current.sha256) throw new Error('时间轴的音轨指纹不一致，不能套用到另一个录音版本。');
        if (Number.isFinite(data.durationMs) ? Math.abs(data.durationMs - current.durationMs) > 500 : !Array.isArray(data.segments)) throw new Error('时间轴时长与当前音轨不一致，可能不是同一版本。');
        const rows = data.lyrics || data.segments?.map(s => ({ startMs: Math.round(s.start * 1000), endMs: Math.round(s.end * 1000), text: s.text })) || [];
        // JSON has real phrase endings: do NOT turn it into LRC and stretch the
        // previous phrase across the instrumental gaps.
        const checked = validateLyricCues(rows.map((row, i) => ({ ...row, text: String(row.text || '').replace(/[\r\n]/g, ' '), endMs: Number.isFinite(row.endMs) ? row.endMs : rows[i + 1]?.startMs ?? current.durationMs })), current.durationMs);
        setLyrics(checked.map((row, i) => Object.hasOwn(MUSIC_THEMES, rows[i].theme) ? { ...row, theme: rows[i].theme } : row)); setOffsetMs(0);
        setBeats(Array.isArray(data.beats) ? data.beats.filter(Number.isFinite).slice(0, 3000) : []);
        setNotice(rows.length ? `已载入 ${rows.length} 句歌词与节拍。歌词将由无人机点阵组成，间奏自动留白；可用整体偏移继续听校。` : '已载入音频节拍，但没有歌词时间点；仍为结构草案。');
      } else { setLyrics(parseRehearsalLrc(raw, current.durationMs)); setNotice('歌词时间点已导入，唱歌拖腔和画面含义仍需听校。'); }
      setError('');
    } catch (e) { setError(e.message || '时间轴文件无效。'); }
  }
  async function loadPrepared(id) {
    if (!localPrepared) return;
    const entry = getLocalMusicProgramme(id);
    if (!entry) { setError('未找到该本机节目。'); return; }
    setError(''); setBusy(true);
    try {
      const prefix = `${import.meta.env.BASE_URL}__rehearsal-local/${entry.id}/`;
      const response = await fetch(`${prefix}score.json`, { cache: 'no-store' });
      if (!response.ok) throw new Error('本机排练服务没有找到已编排文件；请启动本地排练预览服务。');
      const score = await response.json();
      const track = await fetch(`${prefix}audio.m4a`, { cache: 'no-store' });
      if (!track.ok) throw new Error('本机排练音轨读取失败。');
      const next = await loadAudio(new File([await track.blob()], `${entry.title}-同步排练.m4a`, { type: 'audio/mp4' }));
      if (!next) return;
      setTitle(score.title || entry.title);
      await loadTiming(new File([JSON.stringify(score)], `${entry.id}-score.json`, { type: 'application/json' }), next);
    } catch (e) { setError(e.message || '本机节目载入失败。'); }
    finally { setBusy(false); }
  }
  const shiftedLyrics = lyrics.map(row => ({ ...row, startMs: Math.max(0, row.startMs + offsetMs), endMs: Math.min(resource?.durationMs ?? Infinity, row.endMs + offsetMs) }));
  let plan = null, planError = '';
  try { if (resource) { validateLyricCues(shiftedLyrics, resource.durationMs); plan = createRehearsalPlan({ title, durationMs: resource.durationMs, lyrics: shiftedLyrics, beats }); } }
  catch (e) { planError = e.message || '时间偏移使歌词超出音轨，请减小偏移。'; }
  async function rehearse() {
    if (!resource || !plan) return;
    try {
      await document.fonts.ready;
      resource.audio.pause(); resource.audio.currentTime = 0;
      const runtime = createMusicRehearsalRuntime(plan, { audio: resource.audio, url: resource.url, lyrics: shiftedLyrics });
      handedOff.current = true; onPlay(runtime);
    } catch (e) { setError(e.message || '无人机歌词点阵生成失败。'); }
  }
  function downloadPlan() {
    if (!plan) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' })), a = document.createElement('a');
    a.href = url; a.download = 'music-rehearsal-plan.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="music-rehearsal" aria-labelledby="music-rehearsal-title">
    <h3 id="music-rehearsal-title">音乐节目排练 · 歌词光阵</h3>
    <p>上层演绎故事，下层由独立无人机光点组成歌词。音乐、歌词与镜头共用同一个播放头；文件只在本机使用，不上传、不加入公共节目库。</p>
    {localPrepared && <><div className="music-rehearsal-catalogue">{LOCAL_MUSIC_PROGRAMMES.map(entry => <div key={entry.id}><button type="button" className="ai-drone-primary" disabled={busy} onClick={() => void loadPrepared(entry.id)}>载入已编排的《{entry.title}》</button><p>{entry.description}</p></div>)}</div><p className="music-rehearsal-meta">仅本机预览可用 · 原曲前留 8 秒升空、结尾留 10 秒归航</p></>}
    <div className="music-rehearsal-fields"><label>节目名称<input value={title} maxLength={60} onChange={e => setTitle(e.target.value)}/></label><label>完整音轨（MP3 / WAV / M4A）<input aria-label="导入排练音轨" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac" disabled={busy} onChange={e => void loadAudio(e.target.files?.[0])}/></label><label>歌词或分析时间轴（LRC / JSON）<input aria-label="导入歌词时间轴" type="file" accept=".lrc,.json" disabled={busy || !resource} onChange={e => void loadTiming(e.target.files?.[0])}/></label></div>
    <div ref={waveform} className="music-rehearsal-wave" aria-label="音频波形，可点击定位"/>
    {resource && <p className="music-rehearsal-meta">{resource.name} · {stamp(resource.durationMs)} · {lyrics.length} 个歌词时间点 · {beats.length} 个节拍</p>}
    <p role="status" className="music-rehearsal-status">{busy ? '正在读取本机音轨并生成无人机排练数据…' : notice || '可载入本机已编排版本，也可导入自己的音轨和同版本歌词。'}</p>
    {error && <p role="alert" className="music-rehearsal-error">{error}</p>}
    {planError && <p role="alert" className="music-rehearsal-error">{planError}</p>}
    {plan && <><div className="music-rehearsal-actions"><button type="button" className="ai-drone-secondary" onClick={() => { if (resource.audio.paused) resource.audio.play().catch(() => setError('浏览器未能播放音轨，请再次点击。')); else resource.audio.pause(); }}>{playing ? '暂停音轨试听' : '试听本机音轨'}</button><button type="button" className="ai-drone-primary" onClick={rehearse}>进入小镇排练</button><button type="button" className="ai-drone-secondary" onClick={downloadPlan}>导出编排 JSON</button></div>
      {lyrics.length > 0 && <label className="music-rehearsal-offset">歌词整体偏移（毫秒，正值为晚显示）<input aria-label="歌词整体偏移毫秒" type="number" min={-5000} max={5000} step={100} value={offsetMs} onChange={e => setOffsetMs(Math.max(-5000, Math.min(5000, Number(e.target.value) || 0)))}/><span>暖色扫过为视觉节奏，不冒充逐字强制对齐。逐句识别时间点仍建议试听微调。</span></label>}
      {!lyrics.length && <p className="music-rehearsal-warning">结构草案：以下八幕按音轨长度暂排，尚未按歌词校准，不是歌曲成品。</p>}
      <ol className="music-rehearsal-cues">{plan.cues.map((cue, i) => <li key={cue.startMs}><span>{stamp(cue.startMs)}–{stamp(cue.endMs)}</span><div><strong>{cue.title}</strong>{lyrics[i] && <p>{lyrics[i].text}</p>}</div>{lyrics[i] && <label>对应画面<select aria-label={`第 ${i + 1} 段对应画面`} value={cue.theme} onChange={e => setLyrics(rows => rows.map((row, index) => index === i ? { ...row, theme: e.target.value } : row))}>{Object.entries(MUSIC_THEMES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}</li>)}</ol></>}
    <p className="music-rehearsal-meta">素材处理工具：yt-dlp → FFmpeg → librosa；可导入 WhisperX 中文时间点。下载工具不代表歌曲授权，也不会读取浏览器 Cookie 或自动破解音源。</p>
  </section>;
}
