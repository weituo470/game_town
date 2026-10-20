import { useEffect, useRef, useState } from 'react';
import './offshore.css';

const VIEWS = [['director', '导演全景'], ['deck', '甲板看海'], ['orbit', '环绕船景']];
function progressSnapshot(runtimeRef) {
  const sample = runtimeRef?.current?.sample;
  return { progress: Math.max(0, Math.min(1, Number.isFinite(sample?.progress) ? sample.progress : 0)),
    remaining: Math.max(0, Math.ceil((Number.isFinite(sample?.remainingMs) ? sample.remainingMs : 0) / 1000)),
    distance: Math.max(0, Number.isFinite(sample?.distanceFromPort) ? sample.distanceFromPort : 0), docked: sample?.docked !== false };
}

export function OffshoreProgress({ runtimeRef }) {
  const [snapshot, setSnapshot] = useState(() => progressSnapshot(runtimeRef));
  useEffect(() => {
    const tick = () => { if (!document.hidden) setSnapshot(progressSnapshot(runtimeRef)); };
    tick(); const timer = setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [runtimeRef]);
  const time = `${Math.floor(snapshot.remaining / 60)}:${String(snapshot.remaining % 60).padStart(2, '0')}`;
  const distance = snapshot.distance < 10 ? snapshot.distance.toFixed(1) : Math.round(snapshot.distance);
  return <div className="offshore-progress" aria-live="off"><progress max="1" value={snapshot.progress} aria-label="本次航程进度"/><div className="offshore-telemetry"><output aria-label="距港距离">{snapshot.docked ? '港内待命 · 距港 0 米' : `距港 ${distance} 米`}</output><output aria-label="预计剩余航程">{snapshot.docked ? '登船后可立即启航' : `约 ${time} 后靠港`}</output></div></div>;
}

export default function OffshoreControls({ controller, view = 'director', onView, onClose, onDock, reducedMotion, night, onNight }) {
  const state = controller?.state ?? {}, exit = useRef(), close = useRef(onClose);
  close.current = onClose;
  const docked = state.phase === 'docked', aboard = state.aboard === true, pending = Boolean(state.pending);
  useEffect(() => {
    const previous = document.activeElement;
    exit.current?.focus();
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); close.current?.(); } };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus?.(); };
  }, []);
  return <section className="offshore-controls" aria-label="远海浮动岛观景控制">
    <header className="offshore-heading"><span>PLAYTOWN / OCEAN VOYAGE</span><h1>远海浮动岛</h1><p>上海交通大学 · 海洋科普想象</p></header>
    <button ref={exit} type="button" className="offshore-close" onClick={onClose} aria-label="关闭观景，保留当前乘船状态">关闭观景 ×</button>
    <div className="offshore-console" aria-busy={pending}>
      <div className="offshore-status"><strong role="status">{state.label || '靠港待命'}</strong><span>{aboard ? `船上观景站 ${Number.isInteger(state.seat) ? state.seat + 1 : ''}` : '岸边观览'} · {state.online ? '同游航程' : '单人航程'}</span></div>
      <OffshoreProgress runtimeRef={controller?.runtimeRef}/>
      <div className="offshore-view-tabs" role="group" aria-label="观景镜头">{VIEWS.map(([id, name]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => onView(id)}>{name}</button>)}</div>
      <div className="offshore-actions">
        {docked && !aboard && <><button type="button" className="offshore-primary" disabled={pending} onClick={() => controller.boardAndDepart()}>登船并出海</button><button type="button" disabled={pending} onClick={() => controller.board()}>仅登船</button><button type="button" onClick={onDock} disabled={pending}>前往码头 ↗</button></>}
        {docked && aboard && <><button type="button" className="offshore-primary" disabled={pending} onClick={() => controller.depart()}>启航 · 约 2 分 30 秒</button><button type="button" disabled={pending} onClick={() => controller.disembark()}>下船回码头</button></>}
        {!docked && aboard && <button type="button" disabled={pending || state.phase === 'returning'} onClick={() => controller.returnToPort()}>{state.phase === 'returning' ? '正在返航靠泊' : '提前返航'}</button>}
        {!docked && !aboard && <button type="button" onClick={onDock}>前往码头候船 ↗</button>}
        <button type="button" className="offshore-light" onClick={onNight} aria-pressed={night === true}>{night ? '切换白天' : '切换夜晚'}</button>
      </div>
      {pending && <p className="offshore-message" role="status">{state.pendingLabel || '正在确认，请稍候…'}</p>}
      {state.error && <p className="offshore-error" role="alert">{typeof state.error === 'string' ? state.error : '操作未完成，请稍后重试。'}</p>}
      <p className="offshore-caption">出海巡航 · 约 2 分 30 秒航程 · 可提前返航<span>{aboard ? '固定观景站，不开放甲板自由行走；关闭镜头不会下船。' : docked ? '点击“登船并出海”即可自动离港；选择“仅登船”则停泊观景。' : '船只正在海上；可岸边观看，靠港后再登船。'}</span></p>
      <div className="offshore-footnote">非官方科普模拟 · 非真实船舶操控{reducedMotion && <span> · 已减少镜头动态</span>}</div>
    </div>
  </section>;
}
