import { useEffect } from 'react';
import { Compass, ArrowUpRight, X, Sun, Moon } from 'lucide-react';
import { ISLAND_SHOTS } from './islandCamera.js';
import './island.css';

export default function IslandControls({ shot, onShot, onExplore, onClose, day, onDay }) {
  useEffect(() => {
    const close = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return <section className="island-controls" aria-label="雾岬岛观景控制">
    <header className="island-heading"><span>PLAYTOWN / WILD COAST</span><h1>雾岬岛</h1><p>离开霓虹，走进海风。</p></header>
    <button type="button" className="island-close" onClick={onClose}><X size={18} aria-hidden="true"/>返回小镇</button>
    <div className="island-dock">
      <div className="island-shots" role="group" aria-label="岛屿观景机位">{ISLAND_SHOTS.map(item => <button type="button" key={item.id} aria-pressed={shot === item.id} onClick={() => onShot(item.id)}>{item.name}</button>)}</div>
      <div className="island-actions"><button type="button" className="island-enter" onClick={onExplore}><Compass size={19} aria-hidden="true"/>登岛探索<ArrowUpRight size={18} aria-hidden="true"/></button><button type="button" onClick={onDay}>{day ? <Moon size={18} aria-hidden="true"/> : <Sun size={18} aria-hidden="true"/>}{day ? '夜景预览' : '日景预览'}</button></div>
      <p>同一片海，同一个世界。右键拖动环视，滚轮远近；登岛后可步行、跳跃与喷气飞行。</p>
    </div>
  </section>;
}
