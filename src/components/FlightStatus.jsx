import { useEffect, useState } from 'react';
import { Rocket, Pause, ArrowDown } from 'lucide-react';
import './flight-status.css';

export function FlightStatusView({ pose, onToggleHover, viewMode = 'follow' }) {
  const height = Number.isFinite(pose.height) ? Math.max(0, pose.height) : 0;
  const hovering = pose.hovering === true;
  return <section className="jetpack-status" aria-label="全区域喷气背包">
    <div className="jetpack-status-heading"><Rocket size={22} aria-hidden="true"/><strong role="status">{hovering ? '悬停中 · 高度已锁定' : pose.thrusting ? '引擎点火 · 上升中' : pose.speed === 0 && height > 0 ? '已落在高处' : '引擎熄火 · 下落中'}</strong><output aria-label="飞行高度" aria-live="off">{height.toFixed(1)} 米</output></div>
    <p><span className="jetpack-help-desktop">长按空格上升，H 悬停／解除，WASD 移动。{viewMode === 'follow' ? '按住鼠标右键环视。' : '鼠标环视，Esc 释放。'}</span><span className="jetpack-help-touch">长按喷气上升，点悬停锁定高度；方向键移动，拖动画面环视。</span></p>
    <button type="button" className="jetpack-hover-button" aria-pressed={hovering} aria-keyshortcuts="H" onClick={onToggleHover}>{hovering ? <ArrowDown size={20} aria-hidden="true"/> : <Pause size={20} aria-hidden="true"/>}{hovering ? '解除悬停' : '悬停'}<kbd aria-hidden="true">H</kbd></button>
    <small>无燃料限制 · 不设飞行高度上限 · 未悬停时松开喷气下落</small>
  </section>;
}

export default function FlightStatus({ flightRef, flying, onToggleHover, viewMode }) {
  const [pose, setPose] = useState({ height: 0, thrusting: false, hovering: false });
  useEffect(() => {
    if (!flying) return;
    const tick = () => setPose({ ...flightRef.current });
    tick(); const timer = setInterval(tick, 100); return () => clearInterval(timer);
  }, [flightRef, flying]);
  if (!flying) return null;
  return <FlightStatusView pose={pose} onToggleHover={onToggleHover} viewMode={viewMode}/>;
}
