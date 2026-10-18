// Local-only QA harness; never imported by the host. Keeps a visible callback
// receipt so desktop/touch completion and duplicate settlement can be inspected.
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Game from './Game.jsx';
function Preview() {
  const [events, setEvents] = useState([]), [mounted, setMounted] = useState(true), [audit, setAudit] = useState(null);
  const auditStyles = () => {
    const root = document.querySelector('.hh-game');
    const violations = [];
    for (const element of root?.querySelectorAll('*') || []) {
      if (!element.getClientRects().length || !element.textContent.trim() || element instanceof SVGElement) continue;
      if (element.children.length && !element.matches('button,p,li')) continue;
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      const minimum = element.matches('p,li,.hh-status') ? 18 : element.matches('button') ? 16 : 14;
      if (parseFloat(style.fontSize) < minimum || (element.matches('button') && (rect.width < 44 || rect.height < 44))) violations.push({text:element.textContent,size:style.fontSize,width:rect.width,height:rect.height});
    }
    setAudit({viewportWidth:innerWidth,rootFont:getComputedStyle(document.documentElement).fontSize,overflow:document.documentElement.scrollWidth>innerWidth,violations,bodySizes:[...root?.querySelectorAll('p')||[]].map(e=>getComputedStyle(e).fontSize),buttonSizes:[...root?.querySelectorAll('button')||[]].map(e=>({text:e.textContent,font:getComputedStyle(e).fontSize,height:e.getBoundingClientRect().height})),camera:root?.querySelector('.hh-map')?.getAttribute('viewBox')});
  };
  return <><div id="status" role="status">回调收据：{events.filter(event => event.type === 'complete').length} 次完成；{events.filter(event => event.type === 'exit').length} 次退出</div>{mounted && <Game onComplete={result => setEvents(events => [...events, {type:'complete', ...result}])} onExit={() => { setEvents(events => [...events, {type:'exit'}]); setMounted(false); }}/>}<pre id="qa-results">{JSON.stringify(events, null, 2)}</pre><button type="button" onClick={() => setMounted(value => !value)}>{mounted ? '卸载组件（验收）' : '重新挂载（验收）'}</button><button type="button" onClick={auditStyles}>读取计算样式（验收）</button>{audit && <pre id="qa-audit">{JSON.stringify(audit,null,2)}</pre>}</>;
}
if (new URLSearchParams(location.search).has('mobile')) {
  document.querySelector('#qa-shell').innerHTML = '<h1>390px 手机视口验收</h1><iframe title="390px 手机验收" src="/src/minigames/haunted/preview.html"></iframe>';
} else createRoot(document.getElementById('root')).render(<StrictMode><Preview/></StrictMode>);

