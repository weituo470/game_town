import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Flag, Lightbulb, Pause, Play, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { balloonScore, clampScore, rhythmJudgement, PIPE_TYPES, PIPE_START, pipeConnections, pipeFlow, nextPipeHint, HAUNTED_MAP, HAUNTED_CLUES, HAUNTED_EXIT, RHYTHM_NOTES } from '../lib/minigameLogic';
import './minigames.css';

// Each game is developed in its own directory. Publish index.jsx only when
// ready; missing modules keep the existing playable implementation below.
const enhancedGames = import.meta.glob('../minigames/*/index.jsx', { eager: true, import: 'default' });

function useGameClock(active, refreshMs = 32) {
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const time = useRef(0), origin = useRef(0), base = useRef(0), running = useRef(false);
  useEffect(() => {
    const hide = () => { if (document.hidden && active) setPaused(true); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [active]);
  useEffect(() => {
    if (!active || paused) return;
    let frame, lastPaint = 0;
    origin.current = performance.now(); base.current = time.current; running.current = true;
    const tick = (now) => {
      time.current = base.current + now - origin.current;
      if (now - lastPaint >= refreshMs) { setElapsed(time.current); lastPaint = now; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      time.current = base.current + performance.now() - origin.current;
      running.current = false;
      cancelAnimationFrame(frame);
    };
  }, [active, paused, refreshMs]);
  const now = useCallback(() => running.current ? base.current + performance.now() - origin.current : time.current, []);
  return { elapsed, paused, setPaused, now };
}

function useRound(gameId, onComplete) {
  const [started, setStarted] = useState(false);
  const clock = useGameClock(started, gameId === 'haunted' || gameId === 'puzzle' ? 200 : 32);
  const completed = useRef(false), device = useRef('keyboard-mouse'), callback = useRef(onComplete);
  callback.current = onComplete;
  const finish = useCallback((score, metrics) => {
    if (completed.current) return;
    completed.current = true;
    setStarted(false);
    callback.current({ gameId, score: clampScore(score), completed: true, metrics, durationSeconds: Math.round(clock.now() / 100) / 10, inputDevice: device.current, difficulty: 'standard' });
  }, [clock.now, gameId]);
  return { started, setStarted, clock, finish, captureInput: (event) => { if (event.pointerType === 'touch') device.current = 'touch'; } };
}

const descriptions = {
  balloons: { eyebrow: '瞄准 / 反应', title: '把烦恼，砰地打掉。', text: '30 秒内点击气球。背景上的点击算空枪；橙色气球会移动。慢一点、瞄准一点，也很好。', detail: '鼠标点击 / 手指点按 · 30 秒', button: '开始打气球' },
  haunted: { eyebrow: '探索 / 舒适区', title: '黑暗里，也藏着星光。', text: '带着手电找到 3 颗星光，再走到右下角出口。这是一间温和的迷宫：没有突发惊吓，不用赶时间。', detail: 'WASD / 方向键 / 屏幕方向键 · 随时退出不扣分', button: '点亮手电，出发' },
  rhythm: { eyebrow: '节奏 / 协调', title: '找到属于你的拍子。', text: '音符落到白色判定线时，按对应的 D、F、J、K；手机可点下方四个键。一次只来一个音符。', detail: 'D F J K / 点按琴键 · 22 秒 · 可静音', button: '开始这一小段' },
  puzzle: { eyebrow: '逻辑 / 解谜', title: '让灵感，重新流动。', text: '点击管道，让它顺时针旋转。把左上方进水口与右侧出水口接通；蓝色代表水已经流到了这里。', detail: '点击旋转 / Tab + Enter · 不限时 · 可用提示', button: '开始连接管道' },
};

function GameArt({ gameId }) {
  return <svg className={`mg-intro-art mg-intro-art--${gameId}`} viewBox="0 0 300 160" aria-hidden="true">
    {gameId === 'balloons' && <><path d="M25 130H275" stroke="#bba98c" strokeWidth="3" /><path d="M97 95q-12 24 0 39M155 78q12 25 0 56M210 100q-12 20 0 34" fill="none" stroke="#877c67" strokeWidth="2" />{[[97, 62, '#df764d'], [155, 44, '#d5ad54'], [210, 67, '#7f9d85']].map(([x, y, color]) => <g key={x}><ellipse cx={x} cy={y} rx="26" ry="34" fill={color} /><path d={`M${x - 8} ${y - 19}q-9 5-9 15`} fill="none" stroke="#fff7dc" strokeWidth="5" strokeLinecap="round" /><path d={`M${x} ${y + 30}l-5 7h10z`} fill={color} /></g>)}</>}
    {gameId === 'haunted' && <><circle cx="235" cy="34" r="20" fill="#d3b76e" /><path d="M80 130V65l70-48 70 48v65" fill="#474e55" stroke="#262e33" strokeWidth="4" /><path d="M126 130V87q24-34 48 0v43" fill="#eac677" /><path d="M97 60h18v25H97M185 60h18v25h-18" fill="#bfae76" /><path d="M60 130h180" stroke="#71796c" strokeWidth="5" /><path d="m149 49 3 7 8 1-6 5 2 7-7-4-7 4 2-7-6-5 8-1Z" fill="#ead089" /></>}
    {gameId === 'rhythm' && <>{[0, 1, 2, 3].map((lane) => <g key={lane}><rect x={54 + lane * 48} y="22" width="40" height="110" rx="8" fill={lane % 2 ? '#dde1ce' : '#ece4d3'} /><rect x={60 + lane * 48} y={40 + (lane * 29) % 69} width="28" height="12" rx="6" fill={lane % 2 ? '#6f8e77' : '#df764d'} /></g>)}<path d="M49 116h202" stroke="#9b8058" strokeWidth="4" /></>}
    {gameId === 'puzzle' && <><path d="M50 45h70v65h65V75h65" fill="none" stroke="#d8c9ab" strokeWidth="26" strokeLinejoin="round" /><path d="M50 45h70v65h65V75h65" fill="none" stroke="#6d9fa8" strokeWidth="12" strokeLinejoin="round" />{[[120, 45], [120, 110], [185, 110], [185, 75]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="11" fill="#eef0df" stroke="#75939a" strokeWidth="3" />)}<circle cx="50" cy="45" r="16" fill="#6d9fa8" /><circle cx="250" cy="75" r="16" fill="#d5ad54" /></>}
  </svg>;
}

function Intro({ gameId, onStart }) {
  const copy = descriptions[gameId];
  return <div className="mg-intro">
    <GameArt gameId={gameId} />
    <span className="mg-eyebrow">{copy.eyebrow}</span>
    <h3>{copy.title}</h3>
    <p>{copy.text}</p>
    <div className="mg-detail">{copy.detail}</div>
    <button type="button" className="mg-primary" onClick={onStart}><Play size={18} aria-hidden="true" />{copy.button}</button>
  </div>;
}

function Tools({ clock, children, onExit }) {
  return <div className="mg-tools"><div className="mg-stats">{children}</div><div className="mg-tool-actions"><button type="button" className="mg-secondary" onClick={() => clock.setPaused(!clock.paused)}><Pause size={17} aria-hidden="true" />{clock.paused ? '继续' : '暂停'}</button><button type="button" className="mg-text-button" onClick={onExit}>退出</button></div></div>;
}
function PauseScreen({ clock }) {
  return clock.paused ? <div className="mg-pause"><Pause size={32} aria-hidden="true" /><strong>休息一下</strong><p>计时已暂停，不影响这次记录。</p><button type="button" className="mg-primary" onClick={() => clock.setPaused(false)}><Play size={18} aria-hidden="true" />继续游玩</button></div> : null;
}

function Balloons({ onComplete, onExit }) {
  const round = useRound('balloons', onComplete), { clock } = round;
  const [stats, setStats] = useState({ hits: 0, shots: 0, movingHits: 0, acquisitionTotal: 0 });
  const [targets, setTargets] = useState(() => Array.from({ length: 6 }, (_, id) => ({ id, born: 0, phase: id * 1.8 })));
  const [feedback, setFeedback] = useState('看准，再出手。');
  const popping = useRef(new Set());
  useEffect(() => {
    if (round.started && clock.elapsed >= 30000) round.finish(balloonScore(stats.hits, stats.shots), {
      hits: stats.hits, shots: stats.shots, misses: stats.shots - stats.hits, accuracy: stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0,
      movingHits: stats.movingHits, targetAcquisitionMs: stats.hits ? Math.round(stats.acquisitionTotal / stats.hits) : 0,
      summary: `击中 ${stats.hits} 个气球，命中率 ${stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0}%。`,
    });
  }, [clock.elapsed, round.started, round.finish, stats]);
  const shoot = (event, target) => {
    event.stopPropagation();
    if (clock.paused || !round.started || clock.now() >= 30000) return;
    const now = clock.now();
    // Pointer events and keyboard-generated clicks share this scoring path.
    if (target) {
      if (now < target.born) return;
      const key = `${target.id}-${target.born}`;
      if (popping.current.has(key)) return;
      popping.current.add(key);
      setStats((s) => ({ hits: s.hits + 1, shots: s.shots + 1, movingHits: s.movingHits + (target.id % 2), acquisitionTotal: s.acquisitionTotal + now - target.born }));
      setTargets((all) => all.map((item) => item.id === target.id ? { ...item, born: now + 500, phase: item.phase + 1.3 } : item));
      setFeedback(target.id % 2 ? '移动目标，命中！' : '漂亮，命中！');
    } else {
      setStats((s) => ({ ...s, shots: s.shots + 1 })); setFeedback('空枪。深呼吸，瞄准再试。');
    }
  };
  if (!round.started) return <Intro gameId="balloons" onStart={() => round.setStarted(true)} />;
  return <div className="mg-game" onPointerDownCapture={round.captureInput}>
    <Tools clock={clock} onExit={onExit}><strong>{Math.max(0, 30 - Math.floor(clock.elapsed / 1000))} 秒</strong><span>命中 <b>{stats.hits}</b></span><span>空枪 <b>{stats.shots - stats.hits}</b></span></Tools>
    <div className="mg-play mg-balloon-field" onPointerDown={(e) => shoot(e, null)} aria-label="气球靶场，点击气球得分，背景点击算空枪">
      <div className="mg-bunting" aria-hidden="true">{Array.from({ length: 12 }, (_, n) => <i key={n} />)}</div>
      <div className="mg-target-rings" aria-hidden="true" />
      {targets.map((target) => {
        if (clock.elapsed < target.born) return null;
        const moving = target.id % 2 === 1;
        const seconds = clock.elapsed / 1000;
        const x = 20 + (target.id % 3) * 30 + Math.sin(target.phase) * 5 + (moving ? Math.sin(seconds * 1.5 + target.phase) * 5 : 0);
        const y = 30 + Math.floor(target.id / 3) * 40 + Math.cos(target.phase) * 4 + (moving ? Math.cos(seconds * 1.8 + target.phase) * 4 : 0);
        return <button type="button" key={target.id} className={`mg-balloon ${moving ? 'mg-balloon--moving' : ''}`} style={{ left: `${x}%`, top: `${y}%` }} aria-label={`${moving ? '移动' : '静止'}气球 ${target.id + 1}`} disabled={clock.paused} onPointerDown={(event) => shoot(event, target)} onClick={(event) => { if (event.detail === 0) shoot(event, target); }}>
          <svg viewBox="0 0 60 91" aria-hidden="true"><path d="M30 60q-9 12 0 30" fill="none" stroke="#87785f" strokeWidth="2" /><ellipse cx="30" cy="31" rx="25" ry="30" fill="currentColor" /><path d="M30 58l-5 8h10z" fill="currentColor" /><path d="M19 12q-8 5-7 15" fill="none" stroke="#fff8e6" strokeOpacity=".8" strokeWidth="5" strokeLinecap="round" /></svg>
        </button>;
      })}
      <PauseScreen clock={clock} />
    </div>
    <div className="mg-feedback" role="status">{feedback}</div><p className="mg-note">橙色会移动，绿色是静止目标。可随时暂停；触屏与鼠标会分别记录。</p>
  </div>;
}

function Haunted({ onComplete, onExit }) {
  const round = useRound('haunted', onComplete), { clock } = round;
  const [position, setPosition] = useState({ x: 1, y: 1 }), [collected, setCollected] = useState([]);
  const [steps, setSteps] = useState(0), [bumps, setBumps] = useState(0), [message, setMessage] = useState('手电已点亮。去找三颗星光吧。');
  const visited = useRef(new Set(['1,1']));
  const move = useCallback((dx, dy) => {
    if (!round.started || clock.paused) return;
    const next = { x: position.x + dx, y: position.y + dy };
    if (HAUNTED_MAP[next.y]?.[next.x] !== '.') { setBumps((n) => n + 1); setMessage('前面是墙，换个方向看看。'); return; }
    setPosition(next); setSteps((n) => n + 1); visited.current.add(`${next.x},${next.y}`);
    const clue = HAUNTED_CLUES.findIndex((item) => item.x === next.x && item.y === next.y);
    const nextCollected = clue >= 0 && !collected.includes(clue) ? [...collected, clue] : collected;
    if (nextCollected.length !== collected.length) { setCollected(nextCollected); setMessage(`找到第 ${nextCollected.length} 颗星光！${nextCollected.length === 3 ? '现在去右下角出口。' : '还有新的房间等你。'}`); }
    if (next.x === HAUNTED_EXIT.x && next.y === HAUNTED_EXIT.y) {
      if (nextCollected.length === 3) round.finish(100, { cluesFound: 3, cluesTotal: 3, steps: steps + 1, wallBumps: bumps, roomsVisited: visited.current.size, explorationCompletion: 100, summary: `找到全部 3 颗星光，用 ${steps + 1} 步走出小屋。此项记录探索，不评判胆量。` });
      else setMessage(`出口在这里。再找 ${3 - nextCollected.length} 颗星光就能打开。`);
    }
  }, [round.started, clock.paused, position, collected, steps, bumps, round.finish]);
  useEffect(() => {
    const onKey = (event) => {
      if (event.target.closest?.('input, textarea, select')) return;
      const direction = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] }[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (direction && round.started) { event.preventDefault(); event.stopPropagation(); move(...direction); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [move, round.started]);
  if (!round.started) return <Intro gameId="haunted" onStart={() => round.setStarted(true)} />;
  return <div className="mg-game" onPointerDownCapture={round.captureInput}>
    <Tools clock={clock} onExit={onExit}><strong>星光 {collected.length} / 3</strong><span>{steps} 步</span><span>不限时</span></Tools>
    <div className="mg-play mg-haunted-field">
      <svg className="mg-maze" viewBox="0 0 450 350" role="img" aria-label={`迷宫，当前位置第 ${position.y} 行第 ${position.x} 列，已找到 ${collected.length} 颗星光`}>
        <defs><radialGradient id="mg-light"><stop stopColor="#edcf81" stopOpacity=".3" /><stop offset="1" stopColor="#edcf81" stopOpacity="0" /></radialGradient><pattern id="mg-wall" width="50" height="25" patternUnits="userSpaceOnUse"><rect width="50" height="25" fill="#303c42" /><path d="M0 24H50M25 0V24" stroke="#3c4b50" strokeWidth="1.5" /></pattern></defs>
        <rect width="450" height="350" fill="#1d2d32" />
        {HAUNTED_MAP.flatMap((row, y) => [...row].map((cell, x) => cell === '#' ? <rect key={`${x}-${y}`} x={x * 50 + 2} y={y * 50 + 2} width="46" height="46" rx="4" fill="url(#mg-wall)" stroke="#54605a" strokeWidth="1" /> : <circle key={`${x}-${y}`} cx={x * 50 + 25} cy={y * 50 + 25} r="2" fill="#657065" />))}
        <circle cx={position.x * 50 + 25} cy={position.y * 50 + 25} r="115" fill="url(#mg-light)" />
        {HAUNTED_CLUES.map((point, index) => !collected.includes(index) && <g key={index} transform={`translate(${point.x * 50 + 25} ${point.y * 50 + 25})`}><circle r="20" fill="#ba9c4f" opacity=".15" /><path d="m0-15 4 10 11 1-8 7 2 11-9-6-9 6 2-11-8-7 11-1Z" fill="#eed485" /></g>)}
        <g transform="translate(360 258)"><path d="M0 34V4q15-11 30 0v30" fill={collected.length === 3 ? '#a0bd90' : '#786d54'} stroke="#dbce99" strokeWidth="2" /><circle cx="24" cy="20" r="2" fill="#fff0bb" /></g>
        <g transform={`translate(${position.x * 50 + 25} ${position.y * 50 + 25})`}><ellipse cy="15" rx="15" ry="5" fill="#091e23" /><path d="M-12 12V2q12-11 24 0v10" fill="#df7c55" /><circle cy="-8" r="10" fill="#f4d6a3" /><path d="M-10-11q10-17 20 0" fill="#7e9b86" /><path d="M12 4h13l-3 7H12Z" fill="#eac777" /></g>
      </svg>
      <PauseScreen clock={clock} />
    </div>
    <div className="mg-maze-bottom"><div className="mg-dpad" aria-label="人物方向控制">{[[ArrowUp, 0, -1, '向上'], [ArrowLeft, -1, 0, '向左'], [ArrowDown, 0, 1, '向下'], [ArrowRight, 1, 0, '向右']].map(([Icon, dx, dy, label], index) => <button type="button" key={label} className={`mg-direction mg-direction--${index}`} aria-label={label} disabled={clock.paused} onClick={() => move(dx, dy)}><Icon size={22} aria-hidden="true" /></button>)}</div><p className="mg-note">WASD 或方向键移动。<br />右下角的门是出口。</p></div>
    <div className="mg-feedback" role="status">{message}</div><p className="mg-note">不舒服就退出，不扣分，也不会被标记为“胆小”。</p>
  </div>;
}

function Rhythm({ onComplete, onExit }) {
  const round = useRound('rhythm', onComplete), { clock } = round;
  const [judged, setJudged] = useState({}), [feedback, setFeedback] = useState('看准白线，跟上这一拍。'), [muted, setMuted] = useState(false);
  const [combo, setCombo] = useState(0), [activeLane, setActiveLane] = useState(-1);
  const judgedRef = useRef({}), comboRef = useRef(0), maxCombo = useRef(0), errors = useRef([]), stray = useRef(0), audioRef = useRef(null), lastSound = useRef(-1), releaseTimer = useRef(null);
  useEffect(() => () => { clearTimeout(releaseTimer.current); audioRef.current?.close().catch(() => {}); }, []);
  const sound = useCallback((lane) => {
    const context = audioRef.current;
    if (!context || muted || context.state !== 'running') return;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = [261.63, 329.63, 392, 523.25][lane];
    gain.gain.setValueAtTime(0.055, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + .1);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .11);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }, [muted]);
  const begin = () => {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (Audio) { try { audioRef.current = new Audio(); audioRef.current.resume().catch(() => {}); } catch { /* Sound is optional; visual rhythm remains playable. */ } }
    round.setStarted(true);
  };
  const hit = useCallback((lane) => {
    if (!round.started || clock.paused || clock.now() >= 22000) return;
    const now = clock.now();
    setActiveLane(lane); clearTimeout(releaseTimer.current); releaseTimer.current = setTimeout(() => setActiveLane(-1), 110);
    const note = RHYTHM_NOTES.filter((n) => n.lane === lane && judgedRef.current[n.id] === undefined).sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now))[0];
    const judgement = note && rhythmJudgement(now - note.at);
    if (!judgement) { stray.current++; comboRef.current = 0; setCombo(0); setFeedback('还没到白线，再等一拍。'); return; }
    judgedRef.current = { ...judgedRef.current, [note.id]: judgement.points };
    setJudged(judgedRef.current); errors.current.push(Math.abs(now - note.at));
    comboRef.current++; maxCombo.current = Math.max(maxCombo.current, comboRef.current); setCombo(comboRef.current); setFeedback(`${judgement.label} · ${Math.round(Math.abs(now - note.at))} ms`);
  }, [round.started, clock.paused, clock.now]);
  useEffect(() => {
    if (!round.started || clock.paused) return;
    let changed = false;
    for (const note of RHYTHM_NOTES) {
      if (clock.elapsed >= note.at && note.id > lastSound.current) { sound(note.lane); lastSound.current = note.id; }
      if (clock.elapsed > note.at + 180 && judgedRef.current[note.id] === undefined) {
        judgedRef.current[note.id] = 0; changed = true; comboRef.current = 0; setCombo(0); setFeedback('漏了一拍，下一拍重新来。');
      }
    }
    if (changed) setJudged({ ...judgedRef.current });
    if (clock.elapsed >= 22000) {
      const points = Object.values(judgedRef.current), hits = points.filter((p) => p > 0).length;
      const accuracy = hits ? hits / (hits + stray.current) : 0;
      round.finish(points.reduce((sum, n) => sum + n, 0) / RHYTHM_NOTES.length * (.7 + .3 * accuracy), {
        notesTotal: RHYTHM_NOTES.length, hits, missedNotes: RHYTHM_NOTES.length - hits, perfectHits: points.filter((p) => p === 100).length,
        maxCombo: maxCombo.current, strayPresses: stray.current, accuracy: Math.round(accuracy * 100), meanTimingErrorMs: errors.current.length ? Math.round(errors.current.reduce((a, b) => a + b, 0) / errors.current.length) : 0,
        summary: `命中 ${hits} / ${RHYTHM_NOTES.length} 个节拍，最高连击 ${maxCombo.current}。`,
      });
    }
  }, [clock.elapsed, clock.paused, round.started, round.finish, sound]);
  useEffect(() => {
    const onKey = (event) => {
      if (event.repeat || event.target.closest?.('input, textarea, select')) return;
      const lane = ['d', 'f', 'j', 'k'].indexOf(event.key.toLowerCase());
      if (lane >= 0 && round.started) { event.preventDefault(); event.stopPropagation(); hit(lane); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [hit, round.started]);
  if (!round.started) return <Intro gameId="rhythm" onStart={begin} />;
  return <div className="mg-game" onPointerDownCapture={round.captureInput}>
    <Tools clock={clock} onExit={onExit}><strong>{Math.max(0, 22 - Math.floor(clock.elapsed / 1000))} 秒</strong><span>连击 <b>{combo}</b></span><button type="button" className="mg-sound" onClick={() => setMuted((v) => !v)} aria-label={muted ? '开启节拍声音' : '静音'} aria-pressed={muted}>{muted ? <VolumeX size={20} aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />}<span>{muted ? '静音' : '声音'}</span></button></Tools>
    <div className="mg-play mg-rhythm-field"><div className="mg-rhythm-lanes">
      {[0, 1, 2, 3].map((lane) => <div className={`mg-rhythm-lane ${activeLane === lane ? 'mg-rhythm-lane--active' : ''}`} key={lane}>
        {RHYTHM_NOTES.filter((note) => note.lane === lane && judged[note.id] === undefined && note.at - clock.elapsed < 1800 && note.at - clock.elapsed > -190).map((note) => <div className="mg-rhythm-note" key={note.id} style={{ top: `${85 - (note.at - clock.elapsed) / 1800 * 85}%` }} />)}
      </div>)}
      <div className="mg-hit-line" aria-hidden="true" />
      {clock.elapsed < 1500 && <div className="mg-rhythm-ready">准备好，第一拍要来了。</div>}
    </div><PauseScreen clock={clock} /></div>
    <div className="mg-rhythm-pads">{['D', 'F', 'J', 'K'].map((key, lane) => <button type="button" key={key} disabled={clock.paused} className={activeLane === lane ? 'mg-pad--active' : ''} aria-label={`第 ${lane + 1} 轨 ${key} 键`} onPointerDown={(e) => { e.preventDefault(); hit(lane); }} onClick={(e) => { if (e.detail === 0) hit(lane); }}>{key}</button>)}</div>
    <div className="mg-feedback" role="status">{feedback}</div><p className="mg-note">音符中心到白线时按键。声音只是辅助，按画面也可以完整游玩。</p>
  </div>;
}

function Puzzle({ onComplete, onExit }) {
  const round = useRound('puzzle', onComplete), { clock } = round;
  const [rotations, setRotations] = useState([...PIPE_START]), [turns, setTurns] = useState(0), [hints, setHints] = useState(0), [highlight, setHighlight] = useState(-1), [message, setMessage] = useState('从左上角开始，给水找一条路。');
  const flow = pipeFlow(rotations);
  const rotate = (index) => {
    if (clock.paused || !round.started) return;
    const next = rotations.map((rotation, i) => i === index ? (rotation + 1) % 4 : rotation);
    setRotations(next); setTurns((n) => n + 1); setHighlight(-1); setMessage('蓝色管道已经通水，继续连接下一段。');
    if (pipeFlow(next).complete) round.finish(Math.max(40, 100 - hints * 7 - Math.max(0, turns + 1 - 24)), {
      rotations: turns + 1, hintsUsed: hints, connectedTiles: pipeFlow(next).lit.length, puzzleSolved: 1,
      summary: `${turns + 1} 次旋转接通水路，使用 ${hints} 次提示。`,
    });
  };
  const hint = () => {
    if (clock.paused) return;
    const next = nextPipeHint(rotations);
    if (!next) return;
    setHints((n) => n + 1); setHighlight(next.index);
    setMessage(`提示：第 ${Math.floor(next.index / 3) + 1} 行、第 ${next.index % 3 + 1} 列，再旋转 ${next.turns} 次。`);
  };
  if (!round.started) return <Intro gameId="puzzle" onStart={() => round.setStarted(true)} />;
  return <div className="mg-game" onPointerDownCapture={round.captureInput}>
    <Tools clock={clock} onExit={onExit}><strong>{turns} 次旋转</strong><span>提示 {hints} 次</span><span>不限时</span></Tools>
    <div className="mg-play mg-puzzle-field"><div className="mg-pipe-assembly">
      <div className="mg-pipe-source"><span>进水</span><ArrowRight size={26} aria-hidden="true" /></div>
      <div className="mg-pipe-grid">{rotations.map((rotation, index) => {
        const connections = pipeConnections(PIPE_TYPES[index], rotation), lit = flow.lit.includes(index);
        const ends = [[50, 0], [100, 50], [50, 100], [0, 50]];
        return <button type="button" key={index} className={`mg-pipe ${lit ? 'mg-pipe--lit' : ''} ${highlight === index ? 'mg-pipe--hint' : ''}`} disabled={clock.paused} aria-label={`第 ${Math.floor(index / 3) + 1} 行第 ${index % 3 + 1} 列${lit ? '，已通水' : ''}，点击顺时针旋转`} onClick={() => rotate(index)}>
          <svg viewBox="0 0 100 100" aria-hidden="true"><path d={`M${ends[connections[0]].join(' ')} L50 50 L${ends[connections[1]].join(' ')}`} fill="none" stroke="#b8aa89" strokeWidth="28" strokeLinejoin="round" /><path d={`M${ends[connections[0]].join(' ')} L50 50 L${ends[connections[1]].join(' ')}`} fill="none" stroke={lit ? '#4a98a2' : '#f5ecd9'} strokeWidth="16" strokeLinejoin="round" /><circle cx="50" cy="50" r="8" fill={lit ? '#99d8dc' : '#d6c7a7'} /></svg>
        </button>;
      })}</div>
      <div className="mg-pipe-sink"><Flag size={25} aria-hidden="true" /><span>出水</span></div>
    </div><PauseScreen clock={clock} /></div>
    <div className="mg-puzzle-actions"><span><RotateCw size={18} aria-hidden="true" /> 点击管道，顺时针转 90°</span><button type="button" className="mg-secondary" disabled={clock.paused} onClick={hint}><Lightbulb size={18} aria-hidden="true" />给我提示</button></div>
    <div className="mg-feedback" role="status">{message}</div><p className="mg-note">不需要把每块管道都用上。提示会记入游玩记录，但不会阻止通关。</p>
  </div>;
}

export default function MiniGame({ gameId, onComplete, onExit }) {
  const Game = enhancedGames[`../minigames/${gameId}/index.jsx`]
    || { balloons: Balloons, haunted: Haunted, rhythm: Rhythm, puzzle: Puzzle }[gameId];
  if (!Game) return <p className="mg-note">这个游艺项目还没开放。</p>;
  return <Game key={gameId} onComplete={onComplete} onExit={onExit} />;
}
