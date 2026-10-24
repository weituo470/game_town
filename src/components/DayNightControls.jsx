import { Moon, Sun } from 'lucide-react';
import { NIGHT_SHOWS } from '../../shared/nightShowSchedule.js';

const stamp = value => {
  const seconds = Math.ceil(Math.max(0, value) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function NightShowSchedule({ schedule, onWatch, loadError, watchReady, mode }) {
  if (!schedule) return null;
  return <section className="night-programme" aria-label="自动夜场排期" data-night-phase={schedule.phase} data-night-program={schedule.show?.id || 'none'}>
    <span className="eyebrow">PLAYTOWN / NIGHT FESTIVAL</span>
    <h3>日落之后，四场好戏</h3>
    <p>白天 5 分钟，夜晚 10 分钟。按小镇统一时间自动轮播；不抢视角，你可以步行或飞近观看。漫游时静音，进入观演后可开启音效。</p>
    <ol>{NIGHT_SHOWS.map(show => <li key={show.id} aria-current={schedule.show?.id === show.id ? 'true' : undefined}>
      <strong>{show.title}</strong><span>入夜后 {stamp(show.start)} — {stamp(show.end)}</span>
    </li>)}</ol>
    <p role="status">{schedule.active ? `正在演出：${schedule.show.title} · 本场还剩 ${stamp(schedule.remainingMs)}`
      : `${schedule.phase === 'curtain' ? '今夜谢幕' : schedule.phase === 'interval' ? '夜场转场中' : '白天休演'} · ${stamp(schedule.nextIn)} 后开始${schedule.next.title}`}</p>
    {mode !== 'auto' && <p>当前为个人时段预览；排期仍按公共时钟运行。切回“自动昼夜”可看到当前夜场。</p>}
    {loadError && <p role="alert">烟花资源未能加载，请刷新重试。其他三场照常播放。</p>}
    {schedule.active && <button className="button-primary" disabled={!watchReady} onClick={onWatch}>{watchReady ? '进入观演 · 从当前进度' : '正在准备烟花资源…'}</button>}
  </section>;
}

export default function DayNightControls({ mode, label, onChange }) {
  const Icon = label === '夜晚' ? Moon : Sun;
  return <div className="day-night-controls" role="group" aria-label="昼夜效果">
    <span className="day-night-status"><Icon size={18} aria-hidden="true"/>{label || '白天'}</span>
    <select aria-label="昼夜模式" value={mode} onChange={event => onChange(event.target.value)}>
      <option value="auto">自动 · 昼 5 分／夜 10 分</option>
      <option value="day">白天预览 · 仅自己</option>
      <option value="night">夜晚预览 · 仅自己</option>
    </select>
  </div>;
}
