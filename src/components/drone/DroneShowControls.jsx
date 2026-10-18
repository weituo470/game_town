import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, Pause, Play, RotateCcw, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { DRONE_PROGRAM_MENU, getDroneProgram, sampleDroneProgram } from '../../../shared/dronePrograms.js';
import { DROPLET_SCORE } from '../../../shared/droneDroplet.js';
import { createDroneShowClock } from '../../lib/droneShowClock.js';
import { createDroneShowAudio } from '../../lib/droneShowAudio.js';
import { createDroneAudioScheduler } from '../../lib/droneAudioScheduler.js';
import './drone-show.css';

const ACTIONS = ['start', 'close', 'togglePause', 'seek', 'setSpeed', 'setView', 'setReducedMotion', 'setProgram'];
const LOOK_DIRECTIONS = ['left', 'right', 'up', 'down'];

function clearLookInput(inputRef) {
  if (!inputRef?.current) return;
  for (const direction of LOOK_DIRECTIONS) inputRef.current[direction] = false;
}

/** A held-button alternative to dragging; every interruption releases the input. */
function LookButton({ direction, label, inputRef, children }) {
  const sources = useRef(new Set());
  const release = () => {
    sources.current.clear();
    if (inputRef?.current) inputRef.current[direction] = false;
  };
  const start = source => {
    sources.current.add(source);
    if (inputRef?.current) inputRef.current[direction] = true;
  };
  const stop = source => {
    sources.current.delete(source);
    if (inputRef?.current) inputRef.current[direction] = sources.current.size > 0;
  };
  useEffect(() => {
    const stopHidden = () => { if (document.hidden) release(); };
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', stopHidden);
    return () => {
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', stopHidden);
      release();
    };
  }, [inputRef, direction]);
  return <button type="button" className={`drone-action drone-look-${direction}`} aria-label={label}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      start(`pointer-${event.pointerId}`);
    }}
    onPointerUp={event => {
      stop(`pointer-${event.pointerId}`);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={release} onLostPointerCapture={release} onBlur={release}
    onKeyDown={event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      start(`key-${event.key}`);
    }}
    onKeyUp={event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      stop(`key-${event.key}`);
    }}
    onClick={event => event.preventDefault()}>{children}</button>;
}

export function useDroneShowController(_worldTimeRef) {
  const clockRef = useRef(null);
  if (!clockRef.current) clockRef.current = createDroneShowClock();
  const clock = clockRef.current;
  const [state, setState] = useState(() => clock.snapshot());
  const actions = useMemo(() => Object.fromEntries(ACTIONS.map(name => [name, (...args) => {
    const next = clock[name](...args);
    setState(next);
    return next;
  }])), [clock]);
  useEffect(() => {
    if (!state.active) return undefined;
    // Advance the programme and its React scene together, never inside a
    // render-loop timeRef read. Scrubbing to the end remains a deliberate stop.
    const refresh = () => setState(clock.update());
    const timer = setInterval(refresh, 250);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [clock, state.active]);
  return { timeRef: clock.timeRef, state, ...actions };
}

const stamp = milliseconds => {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export default function DroneShowControls({
  controller, onClose, reducedMotion = false, onReducedMotion,
  seats = [], seatId = '', onSeatChange, onRecenter, lookStatus = 'ready', telemetryRef, lookInputRef,
}) {
  const { state } = controller;
  const program = getDroneProgram(state.program);
  const isDroplet = program.id === 'droplet';
  const isBattle = program.id === 'carrier-battle';
  const isBlackHole = program.id === 'blackhole';
  const performanceChapters = program.chapters.filter(item => item.start < program.duration);
  const [details, setDetails] = useState(false);
  const [lookControls, setLookControls] = useState(false);
  const [telemetry, setTelemetry] = useState(() => ({ ...telemetryRef?.current }));
  const [audioStatus, setAudioStatus] = useState('off');
  const [audioError, setAudioError] = useState('');
  const audioRef = useRef(null);
  const audioSchedulerRef = useRef(null);
  const audioStateRef = useRef(state);
  audioStateRef.current = { ...state, reducedMotion: reducedMotion || state.reducedMotion };
  const exitRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const lookStatusRef = useRef(lookStatus);
  lookStatusRef.current = lookStatus;
  const motionEnabled = reducedMotion || state.reducedMotion;
  const fpv = state.view === 'fpv' && !motionEnabled && program.supportsFpv;
  const selectedSeat = seats.find(seat => seat.id === seatId) ?? seats[0];
  const selectedId = selectedSeat?.id ?? '';
  const altitude = telemetry.seatId === selectedId ? telemetry.altitude : undefined;
  const identity = telemetry.seatId === selectedId ? telemetry.identity : selectedSeat?.identity;
  const sample = sampleDroneProgram(state.elapsedMs, program.id);
  const currentIndex = state.ended ? performanceChapters.length - 1 : Math.max(0, performanceChapters.findIndex(item => state.elapsedMs >= item.start && state.elapsedMs < item.end));
  const chapter = performanceChapters[currentIndex];
  const chapterLabel = motionEnabled && sample.phase === 'avatar' ? '法相 · 舒缓观演' : sample.cueLabel || chapter?.label;
  const fpvUnavailable = motionEnabled || !program.supportsFpv;

  useEffect(() => {
    exitRef.current?.focus({ preventScroll: true });
    const onKey = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (document.pointerLockElement || lookStatusRef.current === 'locked') {
        document.exitPointerLock?.();
        return;
      }
      onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); audioRef.current?.dispose(); audioRef.current = null; };
  }, []);
  useEffect(() => {
    controller.setReducedMotion(reducedMotion);
  }, [controller.setReducedMotion, reducedMotion]);
  useEffect(() => {
    if (fpvUnavailable && state.view === 'fpv') controller.setView('cinematic');
  }, [fpvUnavailable, state.view, controller.setView]);
  useEffect(() => {
    // A programme change always returns to opt-in silence. Do not leave a
    // phoenix chord or its pending async AudioContext in the new story.
    audioRef.current?.dispose(); audioRef.current = null;
    setAudioStatus('off'); setAudioError('');
    clearLookInput(lookInputRef);
  }, [program.id, lookInputRef]);
  useEffect(() => {
    if (!fpv) {
      clearLookInput(lookInputRef);
      setLookControls(false);
      return undefined;
    }
    const refresh = () => setTelemetry({ ...telemetryRef?.current });
    refresh();
    const timer = setInterval(refresh, 250);
    return () => { clearInterval(timer); clearLookInput(lookInputRef); };
  }, [fpv, telemetryRef, lookInputRef]);
  useEffect(() => {
    if (audioStatus !== 'on' || !audioRef.current) return undefined;
    const player = audioRef.current;
    const scheduler = createDroneAudioScheduler({
      timeRef: controller.timeRef,
      getState: () => audioStateRef.current,
      update: frame => { if (audioRef.current === player) player.update(frame); },
    });
    audioSchedulerRef.current = scheduler;
    scheduler.start();
    return () => {
      scheduler.dispose();
      if (audioSchedulerRef.current === scheduler) audioSchedulerRef.current = null;
    };
  }, [audioStatus, program.id, controller.timeRef]);
  useEffect(() => {
    // Controls silence or seek immediately; normal playback is sampled by RAF.
    audioSchedulerRef.current?.sync();
  }, [state, reducedMotion]);

  async function toggleAudio() {
    if (program.supportsAudio === false) return;
    if (audioRef.current) {
      audioRef.current.dispose(); audioRef.current = null;
      setAudioStatus('off'); return;
    }
    setAudioError('');
    let player;
    try {
      player = createDroneShowAudio();
      audioRef.current = player;
      setAudioStatus('starting');
      const started = await player.start();
      if (audioRef.current !== player) return;
      if (!started) throw new Error('声音未能开启，请再次点击重试。');
      setAudioStatus('on');
    } catch (error) {
      // A rejected resume from the previous programme must not dispose an
      // AudioContext the listener has since explicitly opened for this one.
      if (player && audioRef.current !== player) return;
      audioRef.current?.dispose(); audioRef.current = null;
      setAudioStatus('off');
      setAudioError(error?.message || '演出音效暂不可用，画面不受影响。');
    }
  }

  const restart = () => controller.start({ speed: state.speed, view: state.view, program: program.id });
  const restartLabel = '从头观看';
  const playLabel = state.ended ? '重新演出' : state.paused ? '继续演出' : '暂停';
  return <section className={`drone-show-controls${fpv ? ' drone-show-fpv' : ''}${isDroplet ? ' drone-show-droplet' : ''}${isBattle ? ' drone-show-battle' : ''}${isBlackHole ? ' drone-show-blackhole' : ''}${motionEnabled ? ' drone-reduced-motion' : ''}`} data-drone-program={program.id} data-drone-cue={sample.cue || sample.phase} aria-label="无人机演出观演控制">
    <header className="drone-masthead">
      <div className="drone-title-block">
        <span className="drone-kicker"><span aria-hidden="true"/>{isBattle ? '小镇东港 · 科幻空战' : isBlackHole ? '小镇天穹 · 深空奇观' : isDroplet ? '小镇天穹 · 镜面水滴与立方舰阵' : '小镇天穹 · 无人机史诗'}</span>
        <h1>{fpv ? '编队第一视角' : isDroplet ? <><span>水滴</span><span className="drone-title-divider" aria-hidden="true"> · </span><span className="drone-title-subject">末日之战</span></> : program.title}</h1>
        <div className="drone-current-chapter" aria-live="polite" aria-atomic="true"><span>{String(currentIndex + 1).padStart(2, '0')}</span>{state.ended ? (isBattle ? '空战落幕 · 母舰归港' : isBlackHole ? '奇观落幕 · 星光归寂' : isDroplet ? '演绎落幕 · 无人机已归航' : '礼成 · 万灯归航') : chapterLabel}</div>
      </div>
      <button ref={exitRef} type="button" className="drone-exit" onClick={onClose} aria-label="退出观演，回到小镇"><X size={19}/><span>退出观演</span><kbd>Esc</kbd></button>
      <div className="drone-view-bar">
        <div className="drone-program" role="group" aria-label="选择无人机演出节目"><span>切换演出</span><div className="drone-program-buttons">{DRONE_PROGRAM_MENU.map(item => <button key={item.id} type="button" className="drone-action" aria-label={item.title} aria-pressed={program.id === item.id} onClick={() => controller.setProgram(item.id)}>{item.shortTitle || item.title}</button>)}</div></div>
        {program.supportsFpv && <div className="drone-view-switch" role="group" aria-label="无人机观演视角">
          <button type="button" className="drone-action" aria-pressed={!fpv} onClick={() => controller.setView('cinematic')}>全景观演</button>
          <button type="button" className="drone-action" aria-pressed={fpv} disabled={fpvUnavailable} aria-describedby={fpvUnavailable ? 'drone-motion-view-note' : undefined} onClick={() => controller.setView('fpv')}>编队第一视角</button>
        </div>}
        {fpvUnavailable && <p id="drone-motion-view-note" className="drone-motion-view-note">{motionEnabled ? '减少动态 · 固定全景' : isBattle ? '红方来袭 · 青方护航 · 同地图实景' : isBlackHole ? '静默观演 · 深空全景' : '导演全景 · 暂不提供编队机位'}</p>}
        {fpv && <div className="drone-onboard">
          <div className="drone-onboard-actions">
            <label className="drone-seat"><span>机位</span><select aria-label="选择编队无人机" value={selectedId} disabled={!seats.length} onChange={event => { clearLookInput(lookInputRef); onSeatChange?.(event.target.value); }}>{seats.map(seat => <option key={seat.id} value={seat.id}>{seat.label}</option>)}</select></label>
            <button type="button" className="drone-action" onClick={() => { clearLookInput(lookInputRef); onRecenter?.(); }}><RotateCcw size={17}/><span>回正镜头</span></button>
          </div>
          <div className="drone-flight-readout" aria-label="编队无人机实时信息">
            <span>无人机 <strong>{identity ?? '—'}</strong> 号</span>
            <span>高度 <output>{Number.isFinite(altitude) ? altitude.toFixed(1) : '—'}</output> m</span>
          </div>
          <p className="drone-fpv-instruction"><span className="drone-instruction-copy">随编队自动飞行 · 拖动环视<span className="drone-keyboard-look"> · 方向键环视</span></span></p>
          <div className="drone-look-row">
            <button type="button" className="drone-action drone-look-toggle" aria-expanded={lookControls} aria-controls="drone-look-buttons" onClick={() => { clearLookInput(lookInputRef); setLookControls(value => !value); }}><span>环视控制</span><ChevronDown size={18}/></button>
            <span className="drone-look-status">{lookStatus === 'locked' ? '鼠标环视中 · Esc 释放' : lookStatus === 'drag' ? '拖动环视中' : '镜头可自由环视'}</span>
          </div>
          {lookControls && <div id="drone-look-buttons" className="drone-look-buttons" role="group" aria-label="按住按钮环视">
            <LookButton direction="left" label="向左环视" inputRef={lookInputRef}><ArrowLeft size={21}/></LookButton>
            <LookButton direction="up" label="向上环视" inputRef={lookInputRef}><ArrowUp size={21}/></LookButton>
            <LookButton direction="down" label="向下环视" inputRef={lookInputRef}><ArrowDown size={21}/></LookButton>
            <LookButton direction="right" label="向右环视" inputRef={lookInputRef}><ArrowRight size={21}/></LookButton>
          </div>}
        </div>}
      </div>
    </header>

    <div className={`drone-console${details ? ' drone-details-open' : ''}`}>
      <div className="drone-timeline-heading">
        <span className="drone-status"><span aria-hidden="true" className={state.paused ? 'drone-status-paused' : ''}/>{state.ended ? (isBlackHole ? '演出结束 · 星光归寂' : '演出结束 · 已全部归航') : state.paused ? '演出已暂停' : '天穹正在上演'}</span>
        <output className="drone-time" aria-label={`演出进度 ${stamp(state.elapsedMs)}，总时长 ${stamp(program.duration)}`}>{stamp(state.elapsedMs)}<span> / {stamp(program.duration)}</span></output>
      </div>
      <input className="drone-timeline" type="range" min="0" max={program.duration} step="100" value={Math.round(state.elapsedMs / 100) * 100} aria-label="调整无人机演出进度" aria-valuetext={`${chapterLabel}，${stamp(state.elapsedMs)}`} onChange={event => controller.seek(Number(event.target.value))}/>
      <div className="drone-main-actions">
        <button type="button" className="drone-action drone-action-primary" onClick={state.ended ? restart : controller.togglePause}>{state.paused ? <Play size={18}/> : <Pause size={18}/>}<span>{playLabel}</span></button>
        <button type="button" className="drone-action drone-restart" onClick={restart}><RotateCcw size={18}/><span>{restartLabel}</span></button>
        <button type="button" className="drone-action drone-highlight drone-hero-shortcut" onClick={() => controller.seek(program.heroTime)}><Sparkles size={18}/><span>{program.heroLabel}</span></button>
        {Number.isFinite(program.dragonTime) && <button type="button" className="drone-action drone-highlight drone-dragon-shortcut" onClick={() => controller.seek(program.dragonTime)}><Sparkles size={18}/><span>{program.dragonLabel}</span></button>}
        <button type="button" className="drone-action drone-highlight drone-stunt-shortcut" onClick={() => controller.seek(program.highlightTime)}>{isBlackHole ? <Sparkles size={18}/> : isDroplet ? <ArrowRight size={18}/> : <ArrowDown size={18}/>}<span>{program.highlightLabel}</span></button>
        <button type="button" className="drone-action drone-details-toggle" aria-expanded={details} aria-controls="drone-show-details" onClick={() => setDetails(value => !value)}><span>{details ? '收起' : '分幕与设置'}</span><ChevronDown size={18}/></button>
      </div>
      <div id="drone-show-details" className="drone-details" hidden={!details}>
        <nav className="drone-chapters" aria-label="无人机演出章节">
          {performanceChapters.map((item, index) => <button type="button" key={item.id} className={`drone-chapter${item.id === chapter?.id ? ' drone-chapter-active' : ''}`} aria-current={item.id === chapter?.id ? 'step' : undefined} onClick={() => controller.seek(item.start)}><span>{String(index + 1).padStart(2, '0')}</span>{item.label}</button>)}
        </nav>
        <div className="drone-options">
          <button type="button" className="drone-action drone-mobile-restart" onClick={restart}><RotateCcw size={18}/><span>{restartLabel}</span></button>
          <button type="button" className="drone-action drone-highlight drone-mobile-highlight" onClick={() => controller.seek(program.heroTime)}><Sparkles size={18}/><span>{program.heroLabel}</span></button>
          {Number.isFinite(program.dragonTime) && <button type="button" className="drone-action drone-highlight drone-mobile-highlight" onClick={() => controller.seek(program.dragonTime)}><Sparkles size={18}/><span>{program.dragonLabel}</span></button>}
          {isDroplet && <><button type="button" className="drone-action drone-highlight" onClick={() => controller.seek(32000)}>立方集结</button><button type="button" className="drone-action drone-highlight" onClick={() => controller.seek(43000)}>舰队幻化</button><button type="button" className="drone-action drone-highlight" onClick={() => controller.seek(DROPLET_SCORE.collapseStart)}>延迟连爆</button></>}
          <button type="button" className="drone-action drone-highlight" onClick={() => controller.seek(program.recoveryTime)}>{program.recoveryLabel}</button>
          <div className="drone-speed" role="group" aria-label="演出速度">{[1, 2].map(speed => <button type="button" key={speed} className="drone-action" aria-pressed={state.speed === speed} onClick={() => controller.setSpeed(speed)}>{speed}×</button>)}</div>
          {program.supportsAudio !== false && <button type="button" className="drone-action drone-audio" aria-pressed={audioStatus === 'on'} disabled={audioStatus === 'starting'} onClick={toggleAudio}>{audioStatus === 'on' ? <Volume2 size={18}/> : <VolumeX size={18}/>}<span>{audioStatus === 'on' ? '关闭演出音效' : audioStatus === 'starting' ? '正在开启音效' : '开启演出音效'}</span></button>}
          <label className="drone-motion"><input type="checkbox" checked={motionEnabled} onChange={event => { controller.setReducedMotion(event.target.checked); onReducedMotion?.(event.target.checked); }}/><span>减少动态</span></label>
        </div>
        {chapter?.description && <p className="drone-description">{chapter.description}</p>}
        {audioError && <p className="drone-audio-error" role="status">{audioError}</p>}
        <p className="drone-story-note">{program.note}</p>
      </div>
    </div>
  </section>;
}
