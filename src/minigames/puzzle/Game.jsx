import { useEffect, useReducer, useRef, useState } from 'react';
import { ArrowRight, Check, Droplets, Flag, Lightbulb, Pause, Play, RotateCcw, RotateCw, Undo2, X } from 'lucide-react';
import { LEVELS, HINT_LIMIT, activeClock, buildResult, completionGate, connections, initialRound, roundReducer, waterFlow } from './logic.js';
import './puzzle.css';

const ends = [[50, 0], [100, 50], [50, 100], [0, 50]];
const directionNames = ['上', '右', '下', '左'];

function WaterArt() {
  return <svg className="pq-art" viewBox="0 0 420 180" aria-hidden="true">
    <path d="M30 150H390" stroke="#d4c29f" strokeWidth="2" />
    <path d="M44 54H142V125H267V75H343" fill="none" stroke="#c6ae85" strokeWidth="32" strokeLinejoin="round" />
    <path className="pq-art-water" d="M44 54H142V125H267V75H343" fill="none" stroke="#36818a" strokeWidth="16" strokeLinejoin="round" />
    {[ [142,54], [142,125], [267,125], [267,75] ].map(([x,y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="10" fill="#f8f0db" stroke="#917a55" strokeWidth="3" />)}
    <path d="M360 142V83m0 32q-27-28-30-6 7 19 30 20m0-29q22-30 28-7-1 18-28 23" fill="#7b9973" stroke="#4e765b" strokeWidth="3" />
    <circle cx="360" cy="67" r="19" fill="#d99556" /><circle cx="360" cy="67" r="7" fill="#f8e4ae" />
    <path d="M44 38q-19 22 0 30 19-8 0-30" fill="#36818a" />
  </svg>;
}

export default function Game({ onComplete, onExit }) {
  const [state, dispatch] = useReducer(roundReducer, undefined, initialRound);
  const [paused, setPaused] = useState(false), [elapsed, setElapsed] = useState(0);
  const clock = useRef(null), gate = useRef(null), device = useRef('keyboard-mouse');
  const boardRef = useRef(null), continueRef = useRef(null), phaseRef = useRef(state.phase);
  const pauseRef = useRef(false), callback = useRef(onComplete);
  if (!clock.current) clock.current = activeClock();
  if (!gate.current) gate.current = completionGate();
  phaseRef.current = state.phase; callback.current = onComplete;
  const level = LEVELS[state.level], flow = waterFlow(level, state.board);
  const lastLevel = state.level === LEVELS.length - 1;

  const pause = () => {
    if (phaseRef.current !== 'playing') return;
    clock.current.pause(); pauseRef.current = true; setPaused(true);
    setElapsed(clock.current.seconds());
  };
  const resume = () => {
    if (document.hidden || !document.hasFocus()) return;
    pauseRef.current = false; setPaused(false);
  };
  const replay = () => {
    clock.current.reset(); gate.current = completionGate();
    if (!document.hidden && document.hasFocus()) clock.current.resume();
    pauseRef.current = false; setPaused(false); setElapsed(0); dispatch({ type: 'replay' });
  };
  const act = (action) => { if (!pauseRef.current) dispatch(action); };

  useEffect(() => {
    const blur = () => {
      if (phaseRef.current === 'playing') {
        clock.current.pause(); pauseRef.current = true; setPaused(true); setElapsed(clock.current.seconds());
      }
    };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
    return () => { clock.current.pause(); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  useEffect(() => {
    if (state.phase !== 'playing' || paused) { clock.current.pause(); setElapsed(clock.current.seconds()); return; }
    if (document.hidden || !document.hasFocus()) { clock.current.pause(); pauseRef.current = true; setPaused(true); return; }
    clock.current.resume();
    const timer = window.setInterval(() => setElapsed(clock.current.seconds()), 250);
    return () => { clock.current.pause(); window.clearInterval(timer); };
  }, [state.phase, state.level, paused]);

  useEffect(() => {
    if (paused) continueRef.current?.focus();
    else if (state.phase === 'playing') boardRef.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [paused, state.phase, state.level]);

  const finish = () => {
    const result = buildResult(state, clock.current.seconds(), device.current);
    gate.current(result, callback.current);
  };
  const captureInput = (e) => { if (e.pointerType === 'touch') device.current = 'touch'; };
  const moveFocus = (e, index) => {
    const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
    if (e.key in deltas) {
      e.preventDefault(); e.stopPropagation();
      const next = (index + deltas[e.key] + 9) % 9;
      boardRef.current?.querySelectorAll('button')[next]?.focus();
    }
  };

  return <section className="pq-game" aria-label="花园水路管道解谜" onPointerDownCapture={captureInput}>
    {state.phase === 'intro' ? <div className="pq-intro">
      <div className="pq-kicker">花园水路 · 两站短途</div>
      <WaterArt />
      <h3>给小镇的花，送一条水路。</h3>
      <p>点一下管道，顺时针转 90°。从左上进水口出发，接到右下方的花园。</p>
      <ol className="pq-guide"><li>蓝色管道表示水已经流到这里。</li><li>不用接满全盘；每关有 3 次提示。</li><li>完成两关就是一局。没有倒计时。</li></ol>
      <div className="pq-actions"><button className="pq-primary" onClick={() => dispatch({ type: 'start' })}><Play size={19} aria-hidden="true" />开始连接</button><button className="pq-quiet" onClick={onExit}>返回小镇</button></div>
      <div className="pq-meta">鼠标 / 手指点按 · 键盘 Tab 或方向键选管道，Enter / 空格旋转</div>
    </div> : <>
      <header className="pq-toolbar">
        <div className="pq-progress" aria-label={`已接通 ${state.levelsSolved} 关，共 ${LEVELS.length} 关`}>{LEVELS.map((l, i) => <span key={l.id} className={state.levelsSolved > i ? 'pq-step pq-step-done' : 'pq-step'}>{state.levelsSolved > i ? <Check size={16} aria-hidden="true" /> : i + 1}</span>)}<span>{state.level + 1} / {LEVELS.length} 关</span></div>
        <div className="pq-toolbar-actions"><button className="pq-quiet" disabled={state.phase !== 'playing' || paused} onClick={pause}><Pause size={18} aria-hidden="true" />暂停</button><button className="pq-quiet" onClick={onExit}><X size={18} aria-hidden="true" />退出</button></div>
      </header>
      <h3 className="pq-level-title">{level.title}</h3>
      <p className="pq-instruction">{level.guide}</p>
      <div className="pq-workspace">
        <div className="pq-board-wrap">
          <div className="pq-port-labels"><span><Droplets size={19} aria-hidden="true" />左上进水</span><span>右下花园<Flag size={18} aria-hidden="true" /></span></div>
          <div className="pq-board" ref={boardRef} role="group" aria-label="三行三列管道，点击顺时针旋转">
            {state.board.map((rotation, index) => {
              const ds = connections(level.types[index], rotation), wet = flow.lit.includes(index);
              const hint = state.highlight?.index === index;
              const path = `M${ends[ds[0]].join(' ')}L50 50L${ends[ds[1]].join(' ')}`;
              return <button type="button" key={`${state.level}-${index}`} className={`pq-tile${wet ? ' pq-tile-wet' : ''}${hint ? ' pq-tile-hint' : ''}`} data-tile={index}
                disabled={paused || state.phase !== 'playing'} aria-label={`第 ${Math.floor(index / 3) + 1} 行第 ${index % 3 + 1} 列，开口向${ds.map(d => directionNames[d]).join('和')}${wet ? '，已通水' : ''}${hint ? '，提示管道' : ''}，顺时针旋转`}
                onKeyDown={e => moveFocus(e, index)} onClick={() => act({ type: 'rotate', index })}>
                <svg viewBox="0 0 100 100" aria-hidden="true"><path d={path} fill="none" stroke="#b6a17e" strokeWidth="32" strokeLinejoin="round" /><path className="pq-channel" d={path} fill="none" stroke={wet ? '#26717d' : '#fffaf0'} strokeWidth="18" strokeLinejoin="round" /><circle cx="50" cy="50" r="7" fill={wet ? '#b7e6e2' : '#cab798'} />{wet && <circle className="pq-drop" cx="50" cy="50" r="3" fill="#fff" />}</svg>
              </button>;
            })}
          </div>
          <div className="pq-water-key"><span><i aria-hidden="true" />蓝色 = 已通水</span><span><RotateCw size={16} aria-hidden="true" />点按转 90°</span></div>
        </div>
        {paused && <div className="pq-pause" role="region" aria-label="游戏已暂停"><Pause size={30} aria-hidden="true" /><h4>水路先歇一会儿</h4><p>计时已停。切回页面后，点继续再开始。</p><button ref={continueRef} className="pq-primary" onClick={resume}><Play size={18} aria-hidden="true" />继续连接</button><button className="pq-quiet" onClick={onExit}>退出，不提交记录</button></div>}
      </div>
      <div className="pq-feedback" role="status" aria-live="polite">{state.phase === 'solved' ? <Check size={22} aria-hidden="true" /> : <Droplets size={22} aria-hidden="true" />}<span>{state.message}</span></div>
      {state.phase === 'solved' ? <div className="pq-solved">
        <p>{lastLevel ? '两条水路都通了，花园谢谢你！' : '第一站完成。接下来试试有一点绕弯的水路。'}</p>
        <div className="pq-actions"><button className="pq-primary" onClick={lastLevel ? finish : () => dispatch({ type: 'next' })}>{lastLevel ? '完成本局' : '去第二站'}<ArrowRight size={19} aria-hidden="true" /></button><button className="pq-quiet" onClick={replay}><RotateCcw size={18} aria-hidden="true" />重玩本局</button></div>
      </div> : <div className="pq-controls">
        <button className="pq-secondary" disabled={paused || !state.history.length} onClick={() => act({ type: 'undo' })}><Undo2 size={18} aria-hidden="true" />撤销</button>
        <button className="pq-secondary" disabled={paused} onClick={() => act({ type: 'reset' })}><RotateCcw size={18} aria-hidden="true" />重置本关</button>
        <button className="pq-secondary pq-hint-button" disabled={paused || state.levelHints >= HINT_LIMIT || !!state.highlight} onClick={() => act({ type: 'hint' })}><Lightbulb size={18} aria-hidden="true" />提示 {HINT_LIMIT - state.levelHints}/{HINT_LIMIT}</button>
      </div>}
      <footer className="pq-footer"><div className="pq-record"><span>旋转 {state.rotations} 次</span><span>有效用时 {Math.floor(elapsed)} 秒</span><span>不按用时扣分</span></div><p>只记录这次水路题的完成情况，不代表智力或其他普遍能力。退出不记失败。</p>{state.phase === 'playing' && <button className="pq-quiet" disabled={paused} onClick={replay}>重新开始本局</button>}</footer>
    </>}
  </section>;
}
