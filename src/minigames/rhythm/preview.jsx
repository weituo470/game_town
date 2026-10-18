// Isolated QA entry. Deliberately imports no host App or shared global CSS.
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Game from './Game.jsx';
import './preview.css';
function Preview() {
  const [events, setEvents] = useState([]), [active, setActive] = useState(true);
  return <main className="rt-preview"><div className="rt-preview-shell">{active ? <Game onComplete={result => setEvents(all => [...all, result])} onExit={() => { setEvents(all => [...all, { exit: true }]); setActive(false); }} /> : <><p>已退出，未提交未完成记录。</p><button onClick={() => setActive(true)}>重新打开游戏</button></>}
    <details className="rt-preview-events"><summary>验收回调记录（{events.length}）</summary><pre>{JSON.stringify(events, null, 2)}</pre></details></div></main>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Preview /></StrictMode>);
