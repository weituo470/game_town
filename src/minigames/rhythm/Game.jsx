import { useCallback, useEffect, useRef, useState } from 'react';
import { Music2, Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { COUNT_IN_MS, ROUND_MS, TRAVEL_MS, NOTES, advanceRound, createRound, createTransport, pressLane, roundResult } from './logic.js';
import { TownAudio } from './audio.js';
import './rhythm.css';

const KEYS = ['D', 'F', 'J', 'K'];

export default function Game({ onComplete, onExit }) {
  const [phase, setPhase] = useState('intro'), [time, setTime] = useState(0), [muted, setMuted] = useState(false);
  const [feedback, setFeedback] = useState('看音符中心，落到亮线时按键。');
  const [result, setResult] = useState(null), [silent, setSilent] = useState(false), [, setRevision] = useState(0);
  const state = useRef({ round: createRound(), phase: 'intro', token: 0, device: 'keyboard-mouse', sent: false, flashes: [-1000, -1000, -1000, -1000] });
  const mounted = useRef(true), callbacks = useRef({ onComplete, onExit }), muteRef = useRef(muted);
  callbacks.current = { onComplete, onExit }; muteRef.current = muted;
  const changePhase = useCallback(value => { state.current.phase = value; setPhase(value); }, []);

  const dispose = useCallback(() => {
    const s = state.current; s.token++; s.transport?.pause(); s.audio?.close(); s.audio = null;
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; dispose(); }; }, [dispose]);

  const finish = useCallback(() => {
    const s = state.current;
    if (s.phase !== 'running') return;
    advanceRound(s.round, ROUND_MS); s.transport.pause();
    setResult(roundResult(s.round, ROUND_MS, s.device, s.audioAvailable));
    s.audio?.close(); s.audio = null; setTime(ROUND_MS); changePhase('finished');
  }, [changePhase]);

  const pause = useCallback((reason = '已暂停，音符和计时一起停下。') => {
    const s = state.current;
    if (s.phase !== 'running') return;
    if (s.transport.now() >= ROUND_MS) { finish(); return; }
    s.transport.pause(); const now = s.transport.now(); s.audio?.pause(now);
    setTime(now); setFeedback(reason); changePhase('paused');
  }, [changePhase, finish]);

  const begin = async () => {
    dispose(); const s = state.current, token = s.token;
    s.round = createRound(); s.device = 'keyboard-mouse'; s.sent = false; s.flashes = [-1000, -1000, -1000, -1000];
    setResult(null); setTime(0); changePhase('loading');
    const Context = window.AudioContext || window.webkitAudioContext;
    let audio = null;
    try {
      if (Context) { audio = new TownAudio(Context); s.audio = audio; await audio.resume(); if (audio.context.state !== 'running') throw new Error('audio unavailable'); }
    } catch { audio?.close(); audio = null; }
    if (!mounted.current || token !== s.token) { audio?.close(); return; }
    s.audio = audio; s.audioAvailable = !!audio; audio?.mute(muteRef.current); setSilent(!audio);
    s.transport = createTransport(audio ? () => audio.context.currentTime * 1000 : () => performance.now());
    setFeedback('倒数结束后，等第一颗音符落到亮线。');
    s.transport.start(); changePhase('running');
    if (document.hidden || !document.hasFocus()) pause('页面失焦，已自动暂停。');
  };

  const resume = async () => {
    const s = state.current, token = s.token;
    if (s.phase !== 'paused') return;
    try { if (s.audio) await s.audio.resume(); }
    catch { setFeedback('声音暂时无法恢复。可重新开始，或退出小镇。'); return; }
    if (!mounted.current || token !== s.token || s.phase !== 'paused') return;
    if (document.hidden || !document.hasFocus()) return;
    if (s.audio && s.audio.context.state !== 'running') { setFeedback('请再次点继续，允许浏览器恢复声音。'); return; }
    s.transport.start(); changePhase('running'); setFeedback('继续这一拍。');
  };

  useEffect(() => {
    if (phase !== 'running') return;
    let frame;
    const tick = () => {
      const s = state.current;
      if (s.phase !== 'running') return;
      if (document.hidden || (s.audio && s.audio.context.state !== 'running')) { pause('页面或声音已暂停，点继续后再出发。'); return; }
      const now = s.transport.now();
      if (now >= ROUND_MS) { finish(); return; }
      const misses = s.round.misses; advanceRound(s.round, now);
      if (s.round.misses > misses) setFeedback('漏了一拍 · 下一拍重新来');
      s.audio?.schedule(now); setTime(now); frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, pause, finish]);

  useEffect(() => {
    const hidden = () => { if (document.hidden) pause('离开页面，已自动暂停。'); };
    const blur = () => pause('页面失焦，已自动暂停。');
    document.addEventListener('visibilitychange', hidden); window.addEventListener('blur', blur);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', blur); };
  }, [pause]);

  const hit = useCallback((lane, pointerType) => {
    const s = state.current;
    if (s.phase !== 'running' || document.hidden) return;
    const now = s.transport.now();
    if (pointerType === 'touch') s.device = 'touch';
    if (now >= ROUND_MS) { finish(); return; }
    const outcome = pressLane(s.round, lane, now);
    if (!outcome) return;
    s.flashes[lane] = now;
    setFeedback(outcome.kind === 'hit' ? `${outcome.label} · ${Math.abs(Math.round(outcome.error))} ms${outcome.error < -5 ? ' 偏早' : outcome.error > 5 ? ' 偏晚' : ''}` : outcome.label);
    setTime(now); setRevision(n => n + 1);
  }, [finish]);

  useEffect(() => {
    const keydown = event => {
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const lane = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'].indexOf(event.code);
      if (lane >= 0 && ['running', 'paused'].includes(state.current.phase)) {
        event.preventDefault(); event.stopPropagation(); if (!event.repeat) hit(lane);
      }
      if (event.code === 'Escape' && state.current.phase === 'running') { event.preventDefault(); event.stopPropagation(); pause(); }
    };
    window.addEventListener('keydown', keydown, true); return () => window.removeEventListener('keydown', keydown, true);
  }, [hit, pause]);

  const exit = () => { if (state.current.phase === 'exited') return; dispose(); changePhase('exited'); callbacks.current.onExit?.(); };
  const toggleMute = () => { const next = !muteRef.current; muteRef.current = next; setMuted(next); state.current.audio?.mute(next); };
  const submit = () => {
    if (!result || state.current.sent) return;
    state.current.sent = true; callbacks.current.onComplete?.(result);
  };
  const s = state.current, round = s.round;
  const playing = phase === 'running' || phase === 'paused';
  const count = Math.ceil(Math.max(0, COUNT_IN_MS - time) / 1000);

  return <section className="rt-game" aria-label="钟楼节拍节奏游戏">
    <header className="rt-header"><div><span className="rt-eyebrow">小镇乐队 / 标准曲</span><h3>钟楼节拍</h3></div><button type="button" className="rt-quiet" onClick={exit}><X size={18} aria-hidden="true" />退出</button></header>
    {phase === 'intro' || phase === 'loading' ? <div className="rt-intro">
      <div className="rt-cover" aria-hidden="true"><Music2 size={54} strokeWidth={1.5} /><div className="rt-cover-lines">{KEYS.map((key, lane) => <i key={key}><b style={{ top: `${20 + lane * 15}%` }} /></i>)}</div><span>120 BPM</span></div>
      <h4>一小段旋律，慢慢接住。</h4>
      <p>音符中心落到亮线时，按对应的 <strong>D F J K</strong>。手机直接点下方四个大键；每次只有一个音符。</p>
      <div className="rt-intro-detail">36 秒旋律 · 3 秒倒数 · {NOTES.length} 个音符</div>
      <button type="button" className="rt-primary" disabled={phase === 'loading'} onClick={begin}><Play size={20} aria-hidden="true" />{phase === 'loading' ? '准备乐器…' : '开始这一小段'}</button>
      <p className="rt-caveat">可静音、暂停或随时退出。设备与音画延迟会影响判定；这里不测音乐天赋或纯反应速度。</p>
    </div> : null}
    {playing && <>
      <div className="rt-toolbar"><div className="rt-stats"><span><strong>{Math.ceil(Math.max(0, ROUND_MS - Math.max(COUNT_IN_MS, time)) / 1000)}</strong> 秒</span><span>连击 <strong>{round.combo}</strong></span><span>命中 <strong>{round.hits}/{NOTES.length}</strong></span></div>
        <div className="rt-actions"><button type="button" onClick={toggleMute} aria-pressed={muted}>{muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}{muted ? '已静音' : '声音'}</button><button type="button" disabled={phase === 'paused'} onClick={() => pause()}><Pause size={18} aria-hidden="true" />暂停</button></div></div>
      <div className="rt-stage" aria-label="四轨音符，音符中心到亮线时按对应键">
        <div className="rt-lanes" aria-hidden="true">{KEYS.map((key, lane) => <div key={key} className={`rt-lane ${time - s.flashes[lane] < 120 ? 'rt-lane-flash' : ''}`}>
          <span className="rt-lane-label">{key}</span>
          {NOTES.filter(note => note.lane === lane && round.judged[note.id] === undefined && note.at - time <= TRAVEL_MS && note.at - time >= -200).map(note => <i key={note.id} className="rt-note" style={{ top: `${84 - (note.at - time) / TRAVEL_MS * 84}%` }} />)}
        </div>)}</div>
        <div className="rt-hitline" aria-hidden="true" />
        {count > 0 && phase === 'running' && <div className="rt-countdown" role="status"><strong key={count}>{count}</strong><span>准备 · 手指放在 D F J K</span></div>}
        {phase === 'paused' && <div className="rt-overlay"><Pause size={32} aria-hidden="true" /><h4>休息一下</h4><p>计时、音符和音乐已一起暂停。</p><button type="button" className="rt-primary" onClick={resume}><Play size={18} aria-hidden="true" />继续这一拍</button><button type="button" onClick={begin}><RotateCcw size={18} aria-hidden="true" />重新开始</button></div>}
      </div>
      <div className="rt-pads" aria-label="四个节奏按键">{KEYS.map((key, lane) => <button type="button" key={key} aria-label={`第 ${lane + 1} 轨 ${key} 键`} disabled={phase !== 'running' || count > 0} className={time - s.flashes[lane] < 120 ? 'rt-pad-active' : ''} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); hit(lane, event.pointerType); }} onClick={event => { if (event.detail === 0) hit(lane); }}>{key}</button>)}</div>
      <div className="rt-feedback" role="status" aria-live="polite">{feedback}</div>
      <div className="rt-progress" role="progressbar" aria-label="本曲进度" aria-valuemin={0} aria-valuemax={36} aria-valuenow={Math.floor(Math.max(0, time - COUNT_IN_MS) / 1000)}><i style={{ width: `${Math.max(0, time - COUNT_IN_MS) / (ROUND_MS - COUNT_IN_MS) * 100}%` }} /></div>
      <p className="rt-guide">音符中心对齐亮线时点按。精准 ±70ms · 合拍 ±140ms · 接住 ±200ms。</p>
      <p className="rt-caveat">{silent ? '声音不可用：当前为纯视觉模式。' : '原创合成音，可静音游玩。'}未做延迟校准，判定误差包含设备及音画延迟。失焦自动暂停；Esc 也可暂停。</p>
    </>}
    {phase === 'finished' && result && <div className="rt-result"><Music2 size={42} aria-hidden="true" /><span className="rt-eyebrow">这一小段，演奏完成</span><h4>{round.hits === NOTES.length ? '每一拍，都接住了！' : round.hits ? '谢谢你的这场小演出。' : '听完一段，也是一种参与。'}</h4><strong className="rt-score">{result.score}<span> / 100</span></strong><p>{result.metrics.summary}</p>
      <dl className="rt-results"><div><dt>精准 / 命中</dt><dd>{round.perfect} / {round.hits}</dd></div><div><dt>最高连击</dt><dd>{round.maxCombo}</dd></div><div><dt>漏拍 / 空按</dt><dd>{round.misses} / {round.stray}</dd></div><div><dt>命中平均误差</dt><dd>{round.hits ? `${result.metrics.meanTimingErrorMs} ms` : '暂无样本'}</dd></div></dl>
      <div className="rt-result-actions"><button type="button" className="rt-primary" onClick={submit}>领取本局印章</button><button type="button" onClick={begin}><RotateCcw size={18} aria-hidden="true" />再演奏一次</button></div><p className="rt-caveat">重玩会丢弃未领取的本局记录。喜欢程度与体验感受，领取后由小镇统一询问。</p>
    </div>}
  </section>;
}
