// Development-only harness. The host imports index.jsx, never this file.
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Game from './Game.jsx';
import './preview.css';
function Preview() {
  const [results, setResults] = useState([]), [exited, setExited] = useState(false), [key, setKey] = useState(0);
  return <main className="pq-preview-shell"><h1>花园水路 · 独立试玩</h1><p>本地验证页，不保存画像；React StrictMode 已开启。</p>
    {exited ? <p>已返回小镇，未提交失败记录。</p> : <Game key={key} onComplete={r => setResults(old => [...old, r])} onExit={() => setExited(true)} />}
    <aside className="pq-preview-results"><h2>验证记录（{results.length}）</h2><pre data-testid="results">{JSON.stringify(results, null, 2)}</pre><button onClick={() => { setKey(n => n + 1); setExited(false); setResults([]); }}>重新挂载游戏</button></aside>
  </main>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Preview /></StrictMode>);
