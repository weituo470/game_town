import { ArrowUpRight, Sparkles } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { DRONE_PROGRAM_MENU } from '../../../shared/dronePrograms.js';
import './drone-integration.css';

function ProgrammeArt({ id }) {
  return <div className="drone-invitation-art" aria-hidden="true">
    <svg viewBox="0 0 200 170" fill="none">
      {id === 'avatar' ? <>
        <circle cx="100" cy="70" r="58" stroke="currentColor" strokeDasharray="1 5"/>
        <path d="M83 55 80 32 92 40 100 18 108 40 120 32 117 55M84 56Q100 46 116 56L115 76 100 91 85 76ZM88 65 95 67M105 67 112 65M100 69 98 75 102 75M94 81 106 81M88 89 75 101 54 96 27 76 21 82 45 111 72 120 78 136 62 164 100 153 138 164 122 136 128 120 155 111 179 82 173 76 146 96 125 101 112 89M78 102 100 114 122 102M82 120 100 132 118 120" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="1 4"/>
      </> : id === 'carrier-battle' ? <>
        <path d="M23 101 58 70 171 70 183 85 150 109 51 109Z M38 100 56 120 148 120 166 99 M123 69V45H143V69 M126 43V30M136 45V25" stroke="currentColor" strokeWidth="2.5"/>
        <path d="M51 128V145M76 128V153M143 128V145M157 75 176 50M41 78 20 45 M10 39l12 5 13-3-12 10Z M166 27l12 5 13-3-12 10Z" stroke="currentColor" strokeWidth="2"/>
        <path d="M59 90H145M67 83H150" stroke="currentColor" strokeDasharray="4 5"/>
      </> : id === 'blackhole' ? <>
        <ellipse cx="100" cy="88" rx="85" ry="22" stroke="currentColor" strokeWidth="3"/>
        <path d="M49 87C49 19 151 19 151 87M61 87C61 36 139 36 139 87M47 94C62 139 138 139 153 94" stroke="currentColor" strokeWidth="2"/>
        <circle cx="100" cy="81" r="30" fill="#060812"/>
        <path d="M17 87Q100 120 183 87" stroke="currentColor" strokeWidth="4"/>
        <circle cx="30" cy="35" r="1.5" fill="currentColor"/><circle cx="171" cy="131" r="1.5" fill="currentColor"/>
      </> : <>
        <path d="M30 63C30 18 93 18 171 63 93 108 30 108 30 63Z" stroke="currentColor" strokeWidth="2" strokeDasharray="1 4"/>
        <path d="M31 63C54 44 103 46 171 63M31 63C54 82 103 80 171 63" stroke="currentColor" strokeOpacity=".65" strokeDasharray="1 4"/>
        {[42, 100, 158].map(x => <path key={x} d={`M${x - 18} 132l24 -9 12 9 -12 9Z M${x - 16} 128v8`} stroke="currentColor" strokeWidth="2" strokeDasharray="1 3"/>)}
      </>}
    </svg>
  </div>;
}

/** Only public performance scores are selectable; ambient sky events are not. */
export default function DroneInvitation({ onStart, onAiDrone }) {
  const [fireworkLoading, setFireworkLoading] = useState(false);
  const [fireworkError, setFireworkError] = useState('');
  const fireworkFlight = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function playFootprints() {
    if (fireworkFlight.current) return;
    fireworkFlight.current = true;
    setFireworkLoading(true); setFireworkError('');
    try { const { createDroneSampleRuntime } = await import('../../../shared/droneSamplePrograms.js'); if (alive.current) onStart('ai', createDroneSampleRuntime('footsteps-of-light')); }
    catch { if (alive.current) setFireworkError('烟花节目暂未载入，请重试；没有调用模型。'); }
    finally { fireworkFlight.current = false; if (alive.current) setFireworkLoading(false); }
  }
  return <section className="drone-programme" aria-labelledby="drone-invitation-title">
    <header className="drone-programme-heading"><span className="drone-invitation-kicker">小镇天幕 · 光影剧场</span><h3 id="drone-invitation-title">选择你想看的演出</h3><p>全新烟花秀、法天象地、水滴之战与空天母舰。选择一场演出，也可随时回到小镇。</p></header>
    <article className="drone-invitation" aria-labelledby="footprint-invitation-title">
      <div className="drone-invitation-art" aria-hidden="true"><svg viewBox="0 0 200 170" fill="none" stroke="currentColor" strokeWidth="1.5">
        {[0,1,2].map(i => <g key={i} transform={`translate(${35+i*60},${115-i*26}) rotate(65) scale(.85)`} opacity={.5+i*.25}>
          <path d="M-1 23C-11 23-12 10-8 0L-10-13Q-11-23-6-25Q-2-27-1-20Q1-28 5-24L6-18Q9-25 12-20L12-15Q17-20 18-15L16-9Q22-14 22-8Q21-2 14 2Q7 5 7 13Q7 23-1 23Z"/>
        </g>)}
      </svg></div>
      <div className="drone-invitation-copy"><span className="drone-invitation-kicker">全新 · 原创虚拟烟花秀</span>
        <h4 id="footprint-invitation-title">足迹 · 向光而行</h4>
        <p>参照2008北京奥运的水平空心脚印。轮廓上的烟花同步升空、顶点爆开，同一批火星自然散落，二十九步从远海走向小镇。</p>
        <button type="button" className="drone-invitation-start" disabled={fireworkLoading} onClick={() => void playFootprints()}><Sparkles size={19} aria-hidden="true"/>{fireworkLoading ? '正在准备烟花…' : '观看足迹 · 向光而行'}<ArrowUpRight size={19} aria-hidden="true"/></button>
        <span className="drone-invitation-meta">1 分 44 秒 · 水平空心足迹 · 实录爆炸音效 · 可静音与回放 · 非官方演绎</span>
        {fireworkError && <p role="alert">{fireworkError}</p>}
      </div>
    </article>
    {onAiDrone && <article className="drone-invitation drone-invitation-ai">
      <div className="drone-invitation-copy">
        <span className="drone-invitation-kicker">AI 演出导演 · 让灵感升空</span>
        <h4>写一句话，点亮一片天空</h4>
        <p>输入主题，或让 AI 即兴创作。预览分幕后，在小镇观看完整的起飞、变阵与归航；喜欢的节目可以保存重播。</p>
        <button type="button" className="drone-invitation-start" onClick={onAiDrone}><Sparkles size={19} aria-hidden="true"/>AI 即兴 / 命题演出<ArrowUpRight size={19} aria-hidden="true"/></button>
      </div>
    </article>}
    {DRONE_PROGRAM_MENU.map(program => <article className={`drone-invitation drone-invitation-${program.id}`} key={program.id} aria-labelledby={`drone-programme-${program.id}`}>
      <ProgrammeArt id={program.id}/>
      <div className="drone-invitation-copy">
        <span className="drone-invitation-kicker">{program.subtitle}</span>
        <h4 id={`drone-programme-${program.id}`}>{program.title}</h4>
        <p>{program.description}</p>
        <button type="button" className="drone-invitation-start" onClick={() => onStart(program.id)}><Sparkles size={19} aria-hidden="true"/>观看{program.title}<ArrowUpRight size={19} aria-hidden="true"/></button>
        <span className="drone-invitation-meta">约 2 分 30 秒{program.id === 'carrier-battle' ? ' · 同港升空与归航 · 科幻演出' : ` · 完整起飞与归航${program.id === 'droplet' ? ' · 非官方演绎' : ' · 支持编队机位'}`}</span>
      </div>
    </article>)}
  </section>;
}
