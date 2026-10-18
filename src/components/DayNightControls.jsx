import { Moon, Sun } from 'lucide-react';

export default function DayNightControls({ mode, label, onChange }) {
  const Icon = label === '夜晚' ? Moon : Sun;
  return <div className="day-night-controls" role="group" aria-label="昼夜效果">
    <span className="day-night-status"><Icon size={18} aria-hidden="true"/>{label || '白天'}</span>
    <select aria-label="昼夜模式" value={mode} onChange={event => onChange(event.target.value)}>
      <option value="auto">自动昼夜 · 3 分钟</option>
      <option value="day">白天预览 · 仅自己</option>
      <option value="night">夜晚预览 · 仅自己</option>
    </select>
  </div>;
}
