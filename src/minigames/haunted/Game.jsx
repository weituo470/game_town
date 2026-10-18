import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, BookOpen, DoorOpen, Flashlight, Moon, Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { MAP, START, EXIT, CLUES, OPTIONAL, DIRECTIONS, initialState, movePlayer, inspectItem, nearbyItem, atExit, canFinish, nextGoal, shortestPath, pointKey, resultFor, createActiveClock } from './logic.js';
import { createHouseAudio } from './audio.js';
import './haunted.css';

function Symbol({ kind, ...props }) {
  return <g {...props} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'letter' && <><rect x="-12" y="-8" width="24" height="17" rx="2"/><path d="m-11-7 11 9 11-9"/></>}
    {kind === 'photo' && <><rect x="-11" y="-12" width="22" height="25" rx="2"/><path d="m-8 5 5-6 4 4 3-3 4 6M-7 9h14"/><circle cx="4" cy="-6" r="2"/></>}
    {kind === 'key' && <><circle cx="-6" cy="-3" r="6"/><path d="m-2 1 13 12m-3-3 4-4m-8 0 4-4"/></>}
    {kind === 'cat' && <><path d="M-9 6V-8l7 5h4l7-5V6q-9 9-18 0M9 6q12 0 8-9"/><path d="M-4 1h0m8 0h0"/></>}
    {kind === 'clock' && <><circle r="12"/><path d="M0-7v8l5 3"/></>}
  </g>;
}

function HouseMap({ state, small, hint, intro = false, paused = false }) {
  const uid = useId().replace(/:/g, ''), cell = 48;
  const px = state.position.x * cell + 24, py = state.position.y * cell + 24;
  const cx = small && !intro ? Math.max(0, Math.min(624 - 336, px - 168)) : 0;
  const cy = small && !intro ? Math.max(0, Math.min(528 - 336, py - 168)) : 0;
  const viewBox = small && !intro ? `${cx} ${cy} 336 336` : '0 0 624 528';
  const rotation = Math.atan2(state.facing[1], state.facing[0]) * 180 / Math.PI;
  return <svg className={`hh-map ${intro ? 'hh-map--intro' : ''} ${paused ? 'hh-map--paused' : ''}`} viewBox={viewBox} role="img" aria-label="月灯旧宅地图：金色信物是线索，绿色拱门是花园出口，暖色人物是你。实墙不能穿过。">
    <defs>
      <pattern id={`${uid}-boards`} width="48" height="48" patternUnits="userSpaceOnUse"><rect width="48" height="48" fill="#44504e"/><path d="M0 12h48M0 35h48M17 0v12m18 0v23M12 35v13" stroke="#8c9a8730"/></pattern>
      <radialGradient id={`${uid}-light`}><stop offset="0" stopColor="#ffe1a3" stopOpacity=".36"/><stop offset=".55" stopColor="#ffe4ac" stopOpacity=".18"/><stop offset="1" stopColor="#ffe4ac" stopOpacity="0"/></radialGradient>
      <radialGradient id={`${uid}-vignette`}><stop offset=".25" stopColor="#081820" stopOpacity="0"/><stop offset="1" stopColor="#081820" stopOpacity=".38"/></radialGradient>
    </defs>
    <rect width="624" height="528" fill="#16262e"/>
    {MAP.map((row, y) => [...row].map((tile, x) => tile === '#' ? <g key={`${x}-${y}`}><rect x={x*cell+2} y={y*cell+5} width="44" height="44" rx="4" fill="#0c1c25"/><rect x={x*cell+2} y={y*cell-2} width="44" height="42" rx="4" fill="#2c424a"/><path d={`M${x*cell+6} ${y*cell+4}h36`} stroke="#718780" strokeOpacity=".32"/></g> : <g key={`${x}-${y}`}><rect x={x*cell} y={y*cell} width={cell} height={cell} fill={`url(#${uid}-boards)`}/>{state.visited.includes(`${x},${y}`) && <circle cx={x*cell+24} cy={y*cell+24} r="3" fill="#d7b46b" opacity=".55"/>}</g>))}
    {/* Rugs, shelves, windows and plants are original vector scenery. */}
    {[[1,1],[5,5],[7,7],[9,1]].map(([x,y]) => <rect key={`${x}-${y}`} x={x*cell+5} y={y*cell+7} width="38" height="34" rx="7" fill="#b979573d" stroke="#d1a17755" strokeDasharray="3 3"/>)}
    {[[1,3],[5,1],[11,3],[3,9]].map(([x,y]) => <g key={`${x}-${y}`} transform={`translate(${x*cell+24} ${y*cell+5})`}><path d="M-13-5v-15q13-17 26 0v15Z" fill="#93c4c63b" stroke="#acc6b4" strokeWidth="2"/><path d="M0-30v24m-12-11h24" stroke="#acc6b4"/></g>)}
    {[[3,3],[7,5],[5,9]].map(([x,y]) => <g key={`${x}-${y}`} transform={`translate(${x*cell+24} ${y*cell+24})`}><ellipse cy="9" rx="9" ry="5" fill="#172b29"/><path d="M-6 3h12L4 13h-8Z" fill="#bd855f"/><path d="M0 3q-18-10-4-18Q3-17 0 3q17-20 14-8Q12 5 0 3" fill="#90a687"/></g>)}
    {[...CLUES, ...OPTIONAL].map(item => {
      const collected = [...state.collected, ...state.explored].includes(item.id);
      return <g key={item.id} transform={`translate(${item.x*cell+24} ${item.y*cell+24})`} opacity={collected ? .3 : 1} style={{color: CLUES.includes(item) ? '#ffe0a0' : '#cfdbce'}}><circle r="21" fill={collected ? '#293c3b' : '#a78b473d'}/><Symbol kind={item.symbol || item.id}/></g>;
    })}
    <g transform={`translate(${EXIT.x*cell+24} ${EXIT.y*cell+24})`}><path d="M-16 20v-27q16-24 32 0v27Z" fill={state.collected.length===3 ? '#78a78b' : '#465e59'} stroke="#d6e6bb" strokeWidth="2"/><path d="M0-14v33m-8-15h2m11 0h2" stroke="#e3edbd" strokeWidth="2"/></g>
    <rect x={cx} y={cy} width={small&&!intro?336:624} height={small&&!intro?336:528} fill={`url(#${uid}-vignette)`}/>
    <circle cx={px} cy={py} r="160" fill={`url(#${uid}-light)`}/>
    <path d="M0 0 124-63Q155 0 124 63Z" transform={`translate(${px} ${py}) rotate(${rotation})`} fill="#ffe3a4" opacity=".1"/>
    {hint && <g transform={`translate(${hint.x*cell+24} ${hint.y*cell+24})`}><circle r="17" fill="#f5cf7370" stroke="#ffe9a8" strokeWidth="2"/><path d="m-6 0 5 5 8-10" fill="none" stroke="#fff5ce" strokeWidth="3"/></g>}
    <g className="hh-player" transform={`translate(${px} ${py})`}><ellipse cy="15" rx="15" ry="6" fill="#061920"/><path d="M-12 12V3q12-13 24 0v9Z" fill="#e49a66" stroke="#f8ce99"/><circle cy="-8" r="10" fill="#f6d9ad"/><path d="M-11-9q10-19 22 0" fill="#93ad94" stroke="#d3dfb0"/><g transform={`rotate(${rotation})`}><path d="M11-2h15v7H11Z" fill="#f7d68f"/><circle cx="27" cy="1" r="4" fill="#fff2bb"/></g></g>
  </svg>;
}

export default function Game({ onComplete, onExit }) {
  const [state, setState] = useState(initialState), stateRef = useRef(state);
  const [mode, setMode] = useState('intro'), modeRef = useRef('intro');
  const [story, setStory] = useState(null), [message, setMessage] = useState('手电已点亮。金色信物旁，按 E 或点“查看”。');
  const [seconds, setSeconds] = useState(0), [sound, setSound] = useState(false), [small, setSmall] = useState(() => window.matchMedia('(max-width: 560px)').matches);
  const [hint, setHint] = useState(null), clock = useRef(createActiveClock()), audio = useRef(null), settled = useRef(false), device = useRef('keyboard-mouse'), panel = useRef(null), action = useRef(null), soundRequest = useRef(0);
  const callbacks = useRef({ onComplete, onExit }); callbacks.current = { onComplete, onExit };
  const writeState = useCallback(next => { stateRef.current = next; setState(next); }, []);
  const transition = useCallback(next => {
    modeRef.current = next; setMode(next);
    if (next === 'playing' && !document.hidden) clock.current.start(); else clock.current.stop();
    setSeconds(clock.current.seconds());
    if (next === 'playing') { if (audio.current && soundRef.current) audio.current.play(); } else audio.current?.pause();
  }, []);
  const soundRef = useRef(false);
  const begin = () => {
    clock.current.reset(); settled.current = false; writeState(initialState()); setStory(null); setHint(null);
    setMessage('手电已点亮。金色信物旁，按 E 或点“查看”。'); transition('playing'); panel.current?.focus();
  };
  const exit = useCallback(() => { settled.current = true; transition('exited'); soundRequest.current++; audio.current?.close(); callbacks.current.onExit?.(); }, [transition]);
  const inspect = useCallback(() => {
    if (modeRef.current !== 'playing') return;
    const current = stateRef.current;
    if (canFinish(current)) {
      if (settled.current) return;
      settled.current = true; const result = resultFor(current, clock.current.seconds(), device.current);
      writeState({ ...current, completed: true }); transition('finished'); callbacks.current.onComplete?.(result); return;
    }
    const found = inspectItem(current);
    if (found.item) { writeState(found.state); setStory(found.item); transition('story'); }
    else if (atExit(current)) setMessage(`花园门还在等你：还需找到 ${3-current.collected.length} 件线索。`);
    else setMessage('跟着金色信物探索；也可以点“路线提示”看下一步。');
  }, [transition, writeState]);
  const move = useCallback((dx, dy) => {
    if (modeRef.current !== 'playing' || document.hidden) return;
    const previous = stateRef.current, next = movePlayer(previous, dx, dy); writeState(next); setHint(null);
    if (pointKey(next.position) === pointKey(previous.position)) { setMessage('这里是实墙。沿着木地板的走廊前进。'); return; }
    audio.current?.step();
    const item = nearbyItem(next);
    setMessage(item ? `发现${item.name}！按 E 或点“查看”读一读。` : atExit(next) ? (canFinish(next) ? '三件线索齐了。打开花园出口吧。' : `这里是出口；还差 ${3-next.collected.length} 件线索。`) : '脚下的金色小点，记录了你走过的路。');
  }, [writeState]);
  const continuePlay = useCallback(() => { setStory(null); transition('playing'); panel.current?.focus(); }, [transition]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 560px)'), resize = () => setSmall(media.matches);
    media.addEventListener('change', resize);
    const blur = () => { if (modeRef.current === 'playing') { transition('paused'); setMessage('窗口已失焦，探索与计时已暂停。'); } else audio.current?.pause(); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
    return () => { clock.current.stop(); media.removeEventListener('change', resize); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); soundRequest.current++; audio.current?.close(); audio.current = null; };
  }, [transition]);
  useEffect(() => {
    if (mode !== 'playing') return;
    const interval = setInterval(() => { if (modeRef.current === 'playing') setSeconds(clock.current.seconds()); }, 250);
    return () => clearInterval(interval);
  }, [mode]);
  useEffect(() => {
    if (mode === 'story' || mode === 'paused') {
      action.current?.focus({ preventScroll: true });
      action.current?.closest('.hh-paper')?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [mode]);
  useEffect(() => {
    const keydown = event => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.target.closest?.('input, textarea, select')) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const direction = DIRECTIONS[key];
      if (modeRef.current === 'intro' || modeRef.current === 'exited' || modeRef.current === 'finished') return;
      if (direction || key === 'Escape' || key === 'e') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.repeat) return;
        if (key === 'Escape') { if (modeRef.current === 'playing') transition('paused'); else if (modeRef.current === 'paused') continuePlay(); return; }
        if (modeRef.current !== 'playing') return;
        if (direction) move(...direction); else inspect();
      }
    };
    window.addEventListener('keydown', keydown, true); return () => window.removeEventListener('keydown', keydown, true);
  }, [continuePlay, inspect, move, transition]);
  const toggleSound = async () => {
    if (soundRef.current) { soundRequest.current++; soundRef.current = false; setSound(false); audio.current?.pause(); return; }
    if (!audio.current) audio.current = createHouseAudio();
    const request = ++soundRequest.current, enabled = await audio.current.enable();
    if (request !== soundRequest.current) return;
    soundRef.current = enabled; setSound(enabled);
    if (!enabled) setMessage('当前浏览器未启用声音；不影响完整探索。');
    if (enabled && modeRef.current === 'playing') audio.current.play(); else audio.current.pause();
  };
  const item = nearbyItem(state), exitHere = atExit(state), goal = nextGoal(state);
  const room = state.position.y >= 7 ? '晚香温室' : state.position.y >= 4 ? '藤蔓玄关' : state.position.x >= 5 ? '月光书房' : '旧宅入口';
  return <section className="hh-game" ref={panel} tabIndex={-1} aria-label="月灯旧宅，鬼屋探索" onPointerDownCapture={event => { if (event.pointerType === 'touch') device.current = 'touch'; }}>
    <header className="hh-heading"><div><span className="hh-eyebrow">温和探索 · 无突发惊吓</span><h3>月灯旧宅</h3></div><button className="hh-icon-button" type="button" aria-label="退出鬼屋" onClick={exit}><X size={21}/></button></header>
    {mode === 'intro' ? <>
      <div className="hh-intro-art"><HouseMap state={initialState()} small={false} intro/><div className="hh-intro-mark"><Moon size={40}/><span>有些灯，是为归来的人留的。</span></div></div>
      <h4 className="hh-intro-title">带一盏灯，赴一个旧约。</h4>
      <p>找到来信、合照与铜钥匙，再从花园出口离开。没有追逐、频闪或突然的大音量，你可以慢慢走。</p>
      <p className="hh-instructions">方向键 / WASD 或屏幕方向键移动；到信物旁按 E 或点“查看”。约 1–2 分钟，不限时。</p>
      <div className="hh-actions"><button type="button" className="hh-primary" onClick={begin}><Flashlight size={20}/>点亮手电，进入旧宅</button><button type="button" onClick={exit}>先回小镇</button></div>
    </> : mode === 'finished' ? <div className="hh-ending"><DoorOpen size={46}/><h4>花园的灯，亮了。</h4><p>三件旧物，把朋友们的约定带回了月光下。</p><div className="hh-actions"><button type="button" className="hh-primary" onClick={begin}><RotateCcw size={20}/>再探索一次</button><button type="button" onClick={exit}>返回小镇</button></div></div> : mode === 'exited' ? <p>已退出，未提交成绩。</p> : <>
      <div className="hh-toolbar"><strong>{room}</strong><span>线索 {state.collected.length} / 3</span><span className="hh-meta">{Math.floor(seconds)} 秒 · 不限时</span><button type="button" onClick={() => modeRef.current === 'playing' ? transition('paused') : modeRef.current === 'paused' ? continuePlay() : null} disabled={mode === 'story'}>{mode === 'paused' ? <Play size={18}/> : <Pause size={18}/>} {mode === 'paused' ? '继续' : '暂停'}</button><button type="button" onClick={toggleSound} aria-pressed={sound}>{sound ? <Volume2 size={18}/> : <VolumeX size={18}/>}环境声{sound ? '开' : '关'}</button></div>
      <div className="hh-stage"><HouseMap state={state} small={small} hint={hint} paused={mode !== 'playing'}/>
        <div className="hh-map-caption"><Flashlight size={16}/>{small ? '手电视野 · 地图随你移动' : '旧宅全图 · 金色小点是足迹'}</div>
      </div>
      <div className="hh-status" role="status">{message}</div>
      <div className="hh-controls"><div className="hh-dpad" role="group" aria-label="移动方向">{[[ArrowUp,0,-1,'向上'],[ArrowLeft,-1,0,'向左'],[ArrowDown,0,1,'向下'],[ArrowRight,1,0,'向右']].map(([Icon, dx, dy, label], index) => <button type="button" key={label} className={`hh-direction hh-direction-${index}`} disabled={mode !== 'playing'} aria-label={label} onClick={() => move(dx,dy)}><Icon size={24}/></button>)}</div><div className="hh-context"><button type="button" className="hh-primary" disabled={mode !== 'playing' || (!item && !exitHere)} onClick={inspect}>{exitHere ? <DoorOpen size={19}/> : <BookOpen size={19}/>} {exitHere ? '打开花园出口' : item ? `查看${item.name}` : '到信物旁查看'}<span className="hh-key">E</span></button><button type="button" disabled={mode !== 'playing'} onClick={() => { const path = shortestPath(stateRef.current.position, goal); const step = path?.[0]; setHint(step ? { x: state.position.x+step[0], y: state.position.y+step[1] } : state.position); setMessage(step ? `下一站：${goal.name}。沿地图上的亮圈走一步，再点可继续指路。` : `已到${goal.name}，按 E 查看。`); }}>路线提示：{goal.name}</button></div></div>
      <ul className="hh-checklist" aria-label="线索清单">{CLUES.map(clue => <li key={clue.id}><span aria-hidden="true">{state.collected.includes(clue.id) ? '✓' : '○'}</span>{clue.name}</li>)}</ul>
      <p className="hh-instructions">方向键 / WASD 移动 · E 查看 · Esc 暂停。窗边的猫与旧钟是可选小故事。退出不扣分。</p>
      {(mode === 'paused' || mode === 'story') && <div className="hh-cover"><div className="hh-paper" role="group" aria-label={mode === 'story' ? story?.name : '探索已暂停'}>
        {mode === 'story' ? <><BookOpen size={30}/><span className="hh-eyebrow">{CLUES.some(clue => clue.id === story?.id) ? `线索 ${state.collected.length} / 3 · 已收好` : '一段可选的小故事'}</span><h4>{story?.name}</h4><p>{story?.text}</p>{state.collected.length === 3 && <p>三件线索齐了，沿路线提示前往花园出口。</p>}</> : <><Pause size={30}/><h4>灯还在，歇一会儿。</h4><p>探索、声音和计时已暂停。失焦不会自动继续。</p></>}
        <button type="button" className="hh-primary" ref={action} onClick={() => { continuePlay(); if (mode === 'story' && soundRef.current) audio.current?.discover(); }}><Play size={18}/>{mode === 'story' ? '收好故事，继续探索' : '继续探索'}</button>
        {mode === 'paused' && <button type="button" onClick={begin}><RotateCcw size={18}/>重新开始本局</button>}<button type="button" onClick={exit}>退出，不提交成绩</button>
      </div></div>}
    </>}
  </section>;
}
