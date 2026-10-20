import { useEffect, useRef } from 'react';
import { SPHERE_MODES } from '../../../shared/sphere-landmark.js';
import './sphere.css';

export default function SphereControls({ mode, onMode, orbit, onOrbit, onExit, onEnter, night, onNight, reducedMotion }) {
  const exit = useRef();
  useEffect(() => {
    exit.current?.focus();
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); onExit(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onExit]);
  return <section className="sphere-controls" aria-label="球幕剧场外墙控制">
    <header className="sphere-title"><span>PLAYTOWN / SPHERE</span><h1>球幕剧场</h1><p>一颗有表情的建筑。</p></header>
    <button ref={exit} className="sphere-exit" onClick={onExit} aria-label="退出球幕观景，回到小镇">关闭观景 ×</button>
    <div className="sphere-console">
      <div className="sphere-modes" role="group" aria-label="外墙效果">{SPHERE_MODES.map(item => <button key={item.id} aria-pressed={mode === item.id} onClick={() => onMode(item.id)}>{item.name}</button>)}</div>
      <div className="sphere-tools"><button aria-pressed={orbit} onClick={() => onOrbit(!orbit)}>{orbit ? '正面观看' : '环绕观看'}</button><button onClick={onNight}>{night ? '切换白天' : '切换夜晚'}</button><button className="sphere-enter" onClick={onEnter}>走到广场 ↗</button></div>
      <p className="sphere-meta">{reducedMotion ? '已减少动态 · 可手动切换外墙' : '自动轮播或自由选片 · 仅切换你的观景画面'}<span>原创程序化致敬 · 非官方建筑</span></p>
    </div>
  </section>;
}
