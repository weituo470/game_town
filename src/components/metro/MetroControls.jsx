import { useEffect } from 'react';
import { Compass, ArrowUpRight, X, Sun, Moon, RefreshCw } from 'lucide-react';
import { METRO_SHOTS } from './metroCamera.js';
import './metro.css';

export default function MetroControls({ shot, onShot, onExplore, onClose, day, onDay, status = 'loading', onRetry }) {
  useEffect(() => {
    const close = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return <section className="metro-controls" aria-label="临湾都会观景控制">
    <header className="metro-heading"><span>PLAYTOWN / CITY HARBOR</span><h1>临湾都会</h1><p>从海岸线，走进城市。</p></header>
    <button type="button" className="metro-close" onClick={onClose}><X size={18} aria-hidden="true"/>返回小镇</button>
    {status !== 'ready' && <div className={`metro-load-status ${status === 'error' ? 'is-error' : ''}`} role="status"><strong>{status === 'error' ? '建筑加载失败' : '正在加载都市建筑…'}</strong><p>{status === 'error' ? '小镇仍可使用，请重试加载或返回小镇。' : '首次进入需要载入楼群、街道与车流，请稍候。'}</p>{status === 'error' && <button type="button" onClick={onRetry}><RefreshCw size={18} aria-hidden="true"/>重新加载</button>}</div>}
    <div className="metro-dock">
      <div className="metro-shots" role="group" aria-label="都市观景机位">{METRO_SHOTS.map(item => <button type="button" key={item.id} aria-pressed={shot === item.id} onClick={() => onShot(item.id)}>{item.name}</button>)}</div>
      <div className="metro-actions"><button type="button" className="metro-enter" onClick={onExplore} disabled={status !== 'ready'}><Compass size={19} aria-hidden="true"/>进入街区<ArrowUpRight size={18} aria-hidden="true"/></button><button type="button" onClick={onDay}>{day ? <Moon size={18} aria-hidden="true"/> : <Sun size={18} aria-hidden="true"/>}{day ? '都市夜景' : '日景预览'}</button></div>
      <p>右键拖动环视，滚轮调整远近。进入街区后可步行、跳跃、喷气飞行；H 键悬停。</p>
    </div>
  </section>;
}
