import { useCallback, useEffect, useRef, useState } from 'react';
import { Fish, Footprints, Rocket, Pause, Play, RotateCcw, X } from 'lucide-react';
import { OUTDOOR_GAMES, OUTDOOR_MAP, OUTDOOR_STORAGE_KEY, FISH, createOutdoorGame, beginOutdoorGame, pressOutdoorAction, releaseOutdoorAction, cancelOutdoorInput, setOutdoorPaused, stepOutdoorGame, hopChargeWindow, sanitizeOutdoorRecords } from '../minigames/outdoor.js';
import './outdoor-play.css';

const ICONS = { fishing: Fish, hop: Footprints, jetpack: Rocket };
const editable = target => target?.closest?.('input,textarea,select,button,a,[contenteditable="true"],[role="button"]');
let volatileRecords = sanitizeOutdoorRecords(null);
let persistentRecordsAvailable = true;
function readRecords() {
  if (!persistentRecordsAvailable) return sanitizeOutdoorRecords(volatileRecords);
  try { return sanitizeOutdoorRecords(JSON.parse(localStorage.getItem(OUTDOOR_STORAGE_KEY))); }
  catch { return sanitizeOutdoorRecords(volatileRecords); }
}
export function useOutdoorPlay() {
  const runtimeRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const start = useCallback(id => {
    if (!Object.hasOwn(OUTDOOR_MAP, id) || OUTDOOR_MAP[id].global) return;
    runtimeRef.current = createOutdoorGame(id); setSelected(id);
    document.exitPointerLock?.();
  }, []);
  const exit = useCallback(() => { runtimeRef.current?.flush?.(); cancelOutdoorInput(runtimeRef.current); runtimeRef.current = null; setSelected(null); }, []);
  useEffect(() => {
    if (!selected) return;
    // The practice clock must not depend on WebGL frame frequency. Expensive
    // scenery or a throttled render surface must not stretch a bite window.
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), dt = Math.min(0.25, (now - previous) / 1000); previous = now;
      if (!document.hidden) stepOutdoorGame(runtimeRef.current, dt);
    }, 16);
    const keydown = event => {
      const state = runtimeRef.current;
      if (!state || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Escape') { event.preventDefault(); exit(); return; }
      if (editable(event.target)) return;
      if (event.code === 'KeyP' && !event.repeat) { event.preventDefault(); setOutdoorPaused(state, !state.paused); }
      if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) {
          if (state.status === 'ready') beginOutdoorGame(state);
          else pressOutdoorAction(state);
        }
      }
      if (['KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'].includes(event.code)) {
        event.preventDefault(); state[['KeyA', 'ArrowLeft'].includes(event.code) ? 'left' : 'right'] = true;
      }
    };
    const keyup = event => {
      const state = runtimeRef.current; if (!state) return;
      if (event.code === 'Space') releaseOutdoorAction(state);
      if (['KeyA', 'ArrowLeft'].includes(event.code)) state.left = false;
      if (['KeyD', 'ArrowRight'].includes(event.code)) state.right = false;
    };
    const blur = () => setOutdoorPaused(runtimeRef.current, true);
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility);
      cancelOutdoorInput(runtimeRef.current);
    };
  }, [selected, exit]);
  return { runtimeRef, selected, start, exit };
}

export function OutdoorLauncher({ onStart, nearest }) {
  return <section className="outdoor-launcher" aria-label="户外游乐">
    <span className="outdoor-launcher-title">户外游乐 · 直接在小镇里玩</span>
    <div>{OUTDOOR_GAMES.map(game => { const Icon = ICONS[game.id]; return <button key={game.id} onClick={() => onStart(game.id)} aria-label={`游玩${game.name}`}><Icon size={18} aria-hidden="true"/>{game.name}</button>; })}</div>
    {nearest && <button className="outdoor-nearby" onClick={() => onStart(nearest)}>E · 在{OUTDOOR_MAP[nearest].place}开始游玩</button>}
  </section>;
}

function HoldButton({ state, direction, children, className = '' }) {
  const activePointer = useRef(null);
  const down = () => { if (direction) state[direction] = true; else pressOutdoorAction(state); };
  const up = () => { if (direction) state[direction] = false; else releaseOutdoorAction(state); };
  const cancel = () => { activePointer.current = null; if (direction) state[direction] = false; else cancelOutdoorInput(state); };
  return <button className={className} disabled={state.paused || state.status !== 'playing'}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); activePointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); down(); }}
    onPointerUp={event => { if (activePointer.current !== event.pointerId) return; activePointer.current = null; up(); }}
    onPointerCancel={cancel} onLostPointerCapture={() => { if (activePointer.current !== null) cancel(); }}
    onKeyDown={event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) down(); } }}
    onKeyUp={event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); up(); } }}
    onBlur={cancel} onContextMenu={event => event.preventDefault()}>{children}</button>;
}

export function OutdoorHud({ runtimeRef, selected, onExit, connected }) {
  const [, refresh] = useState(0);
  const [records, setRecords] = useState(readRecords);
  const [storageOk, setStorageOk] = useState(persistentRecordsAvailable);
  const saved = useRef({ state: null, fishCount: 0, event: -1 });
  const statusRef = useRef(null);
  useEffect(() => {
    const tick = () => {
      const state = runtimeRef.current;
      if (!state) return;
      state.flush = tick;
      if (saved.current.state !== state) saved.current = { state, fishCount: 0, event: -1 };
      if (saved.current.event !== state.event) {
        saved.current.event = state.event;
        // Merge the latest stored collection; never persist a held key or a run.
        const next = readRecords();
        next.best[state.id] = Math.max(next.best[state.id], state.score);
        for (const id of state.catches.slice(saved.current.fishCount)) next.fish[id] = (next.fish[id] || 0) + 1;
        saved.current.fishCount = state.catches.length;
        volatileRecords = next;
        try { localStorage.setItem(OUTDOOR_STORAGE_KEY, JSON.stringify(next)); } catch { persistentRecordsAvailable = false; setStorageOk(false); }
        setRecords(next);
      }
      refresh(value => value + 1);
    };
    tick(); const timer = setInterval(tick, 80);
    return () => clearInterval(timer);
  }, [runtimeRef, selected]);
  useEffect(() => { statusRef.current?.focus(); }, [selected]);
  const state = runtimeRef.current;
  if (!state) return null;
  const game = OUTDOOR_MAP[state.id], Icon = ICONS[state.id];
  const chargeWindow = state.id === 'hop' ? hopChargeWindow(state) : null;
  const start = () => { beginOutdoorGame(state); statusRef.current?.focus(); };
  const restart = () => { runtimeRef.current?.flush?.(); runtimeRef.current = createOutdoorGame(selected); statusRef.current?.focus(); refresh(value => value + 1); };
  const fishAction = () => { pressOutdoorAction(state); releaseOutdoorAction(state); };
  const transition = state.id === 'fishing' && ['casting', 'lifting'].includes(state.phase);
  const actionLabel = state.id === 'fishing' ? state.phase === 'casting' ? '抛竿中…' : state.phase === 'lifting' ? '收线中…' : ['waiting', 'bite'].includes(state.phase) ? '收竿' : '再抛一竿' : state.phase === 'charging' ? '松开起跳' : '按住蓄力';
  return <section className="outdoor-hud" aria-label={`${game.name}挑战`} data-phase={state.phase} data-elapsed={state.elapsed.toFixed(2)}>
    <header className="outdoor-heading"><div><Icon size={24} aria-hidden="true"/><h2>{game.name}</h2><span>{game.place}</span></div><button onClick={onExit} aria-label="退出户外游戏"><X size={20}/>退出</button></header>
    <div className="outdoor-score"><strong>{state.score} 分</strong><span>最佳 {Math.max(records.best[state.id], state.score)} 分</span><span>{state.id === 'hop' ? `${state.platform} / 8 块` : state.id === 'jetpack' ? `${state.hits.length} / 6 环` : `本次 ${state.catches.length} 条`}</span></div>
    <p className={`outdoor-message ${state.phase === 'bite' ? 'is-bite' : ''}`} ref={statusRef} tabIndex={-1} role="status" aria-live="polite">{state.paused ? '已暂停，点击“继续”恢复。' : state.message}</p>
    {state.status === 'ready' && <div className="outdoor-instructions"><p>{game.controls}</p><button className="outdoor-primary" onClick={start}><Play size={20}/>开始{game.name}</button></div>}
    {state.status === 'playing' && <div className="outdoor-play-controls">
      {state.id === 'hop' && <div className="outdoor-meter-block"><span>力度 · 绿色区间可落台</span><div className="outdoor-meter" role="meter" aria-label="蓄力" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.charge * 100)}><i className="outdoor-safe-zone" style={{ left: `${chargeWindow.min * 100}%`, width: `${(chargeWindow.max - chargeWindow.min) * 100}%` }}/><b style={{ left: `${state.charge * 100}%` }}/></div></div>}
      <div className="outdoor-action-row">{state.id === 'jetpack' && <HoldButton state={state} direction="left">向左</HoldButton>}
        {state.id === 'fishing' ? <button className="outdoor-primary" disabled={state.paused || transition} onClick={fishAction}>{actionLabel}</button> : <HoldButton state={state} className="outdoor-primary">{actionLabel}</HoldButton>}
        {state.id === 'jetpack' && <HoldButton state={state} direction="right">向右</HoldButton>}
        <button aria-label={state.paused ? '继续挑战' : '暂停挑战'} onClick={() => setOutdoorPaused(state, !state.paused)}>{state.paused ? <Play size={18}/> : <Pause size={18}/>}{state.paused ? '继续' : '暂停'}</button>
      </div>
      <p className="outdoor-control-note">{game.controls}</p>
    </div>}
    {state.status === 'finished' && <div className="outdoor-finish"><strong>{state.won ? '挑战完成！' : '下次一定更好'}</strong><button className="outdoor-primary" onClick={restart}><RotateCcw size={20}/>再玩一次</button><button onClick={onExit}>回到小镇</button></div>}
    {state.id === 'fishing' && state.fish && state.phase === 'caught' && <div className="river-catch" aria-label="本次鱼获"><strong>{state.fish.name} · {state.fish.rarity}</strong><p>{state.fish.lengthCm.toFixed(1)} 厘米 · {state.fish.weightKg.toFixed(2)} 千克</p><span>已收入鱼类收藏，可以继续下一竿。</span></div>}
    {state.id === 'fishing' && <div className="outdoor-collection" aria-label="鱼类收藏">{FISH.map(fish => <span key={fish.id}><Fish size={18} aria-hidden="true"/>{fish.name} × {records.fish[fish.id] || 0}</span>)}</div>}
    <small className="outdoor-local-note">{connected ? '本地练习 · 同游者暂看不到挑战动作。' : '本机练习成绩，不计金币或玩家护照。'}{storageOk ? '记录仅保存在此浏览器。' : '存储不可用，记录仅在当前页面有效。'}</small>
  </section>;
}
