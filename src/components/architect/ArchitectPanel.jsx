import { useEffect, useRef, useState } from 'react';
import { architectClient } from '../../lib/architectClient.js';
import { appendArchitectProjects, getArchitectProjects } from '../../../shared/architectWorld.js';
import './architect.css';

export function ArchitectSync({ onStatus }) {
  useEffect(() => {
    let stopped = false, busy = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (busy || document.hidden || stopped) return;
      busy = true;
      try { const value = await architectClient.status({ signal: controller.signal }); if (!stopped) { appendArchitectProjects(value.projects); onStatus({ ...value, projects: getArchitectProjects() }); } } catch { /* Optional feature never blocks town loading. */ }
      finally { busy = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => { stopped = true; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [onStatus]);
  return null;
}

export default function ArchitectPanel({ status, onStatus, onVisit }) {
  const [brief, setBrief] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const alive = useRef(true), request = useRef(null), submission = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); }; }, []);
  const refresh = async () => {
    try { const next = await architectClient.status(); if (alive.current) { appendArchitectProjects(next.projects); onStatus({ ...next, projects: getArchitectProjects() }); } } catch (e) { if (alive.current) setError(e.message); }
  };
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    const clean = brief.trim();
    // Retain this request identity after a timeout. Retrying an identical
    // instruction can only recover its original result, not build twice.
    if (!submission.current || submission.current.brief !== clean) submission.current = { brief: clean, idempotencyKey: crypto.randomUUID() };
    setBusy(true); setError(''); setMessage('建筑师正在观察街区、构思方案并检查施工位置…');
    const supplied = password; setPassword('');
    request.current = new AbortController();
    try {
      await architectClient.generate({ ...submission.current, password: supplied, signal: request.current.signal });
      await refresh();
      if (alive.current) { submission.current = null; setBrief(''); setMessage('本次工程已处理，请查看下方工程账本。已有建筑不会被覆盖。'); }
    } catch (e) { if (alive.current) { setError(e.message); setMessage(''); await refresh(); } }
    finally { if (alive.current) setBusy(false); }
  };
  const used = Boolean(status?.autonomousUsed), projects = status?.projects || [];
  const full = status?.phase === 'full';
  const working = busy || status?.phase === 'generating' || status?.latest?.state === 'pending';
  return <section className="architect-panel" aria-label="AI 建筑师工作室">
    <div className="architect-intro"><div className="architect-seal" aria-hidden="true">A<span>01</span></div><div><h3>筑一 · 小镇建筑师</h3><p>我观察小镇的空地，给这里添一处值得停留的地方。</p><span className="architect-model">{status?.model || 'DeepSeek'} · 只新增，不删改</span><p className="architect-actions"><button type="button" onClick={() => onVisit?.('architect')} disabled={!onVisit}>找到筑一 ↗</button></p></div></div>
    <div className="architect-rule"><strong>{used ? '今日自主工程额度已使用' : '每日 1 处自主工程'}</strong><span>北京时间 {status?.day || '每日 00:00'} · 全镇共享</span><p>建筑师每天自主规划一处。额外工程必须逐次通过密码审批；审批只对这一处生效，不会解除每日限制。</p></div>
    {status && !status.enabled && <p role="status" className="architect-notice">建筑师尚未开工，正在等待服务配置。现有工程仍可参观。</p>}
    {full && <p role="status" className="architect-notice">本期 12 处安全施工地块已用完。建筑师已停工，所有既有工程保持原样。</p>}
    {status?.latest && <p className="architect-notice" role="status">{status.latest.message || ({ pending: '正在规划新工程…', failed: '上一次规划未完成，今天不会自动反复调用。', done: '上一处工程已建成。' }[status.latest.state])}</p>}
    <form onSubmit={submit}>
      <label htmlFor="architect-brief">给建筑师一个建议 <span>可留空，让他自己想</span></label>
      <textarea id="architect-brief" maxLength={200} rows={3} value={brief} onChange={e => setBrief(e.target.value)} placeholder="例如：给南岸添一处可以看星星的地方" disabled={working}/>
      <label htmlFor="architect-approval">单工程审批密码 <span>{used ? '今日额度已用完，额外工程必须填写' : '使用今日自主额度时无需填写'}</span></label>
      <input id="architect-approval" type="password" autoComplete="off" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={working} required={used} aria-describedby="architect-password-note"/>
      <p id="architect-password-note" className="architect-meta">密码仅用于服务端审批，不会交给模型，也不会保存在浏览器。</p>
      <div className="architect-actions"><button className="button-primary" type="submit" disabled={!status?.enabled || working || full}>{full ? '安全地块已用完' : working ? '正在规划与施工…' : used ? '审批并建造这一处' : '请建筑师自主开工'}</button><button type="button" onClick={refresh} disabled={busy}>刷新工程账本</button></div>
    </form>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="architect-error">{error}</p>}
    <div className="architect-ledger"><h3>小镇生长记录 <span>{projects.length} 处</span></h3>{projects.length ? <ol>{projects.slice().reverse().map(project => <li key={project.id}><div><strong>{project.plan.name}</strong><span>{project.day} · {project.source === 'approved' ? '玩家审批' : '自主工程'}</span></div><p>{project.plan.description}</p><p className="architect-actions"><button type="button" onClick={() => onVisit?.(`architect-project:${project.id}`)} disabled={!onVisit} aria-label={`前往工程：${project.plan.name}`}>前往工程 ↗</button></p></li>)}</ol> : <p>第一张蓝图还没落地。建成后，所有玩家都能在同一座小镇看到它。</p>}</div>
    <p className="architect-meta">只在核准空地施工。道路、喷泉、已有建筑及其他居民的活动区域均受保护；空间用完时停工，不覆盖旧工程。</p>
    <p className="architect-meta">自主额度按一次规划尝试计；失败当天不自动重试，防止反复调用模型。再次规划仍需单独审批。</p>
  </section>;
}
