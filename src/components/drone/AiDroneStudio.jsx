import { useEffect, useRef, useState } from 'react';
import { AI_DRONE_MAX_PROMPT, AI_DRONE_MAX_ACCESS_PASSWORD, createAiDroneClient, createAiDroneRequest, validateAiDroneAccessPassword } from '../../lib/aiDroneClient.js';
import { AI_DRONE_LIBRARY_LIMIT, createAiDroneLibrary } from '../../lib/aiDroneLibrary.js';
import { AI_DRONE_FEEDBACK_STEPS, aiDroneElapsedSeconds, aiDroneQuotaExhausted, aiDroneQuotaFeedback, aiDroneStageFeedback, aiDroneUnlimited, runAiDronePreparation } from '../../lib/aiDroneFeedback.js';
import { validateAiDroneScore } from '../../../shared/aiDroneScore.js';
import './ai-drone-studio.css';

const EXAMPLES = [
  { label: '鲸落星海', prompt: '一只蓝色鲸鱼穿过星海，化为盛放的花，再汇成温暖的心。先安静，后惊喜，最后留一点余韵。' },
  { label: '未来小镇', prompt: '以未来小镇为题，从城市轮廓到飞鸟，再旋入星系，最后让所有灯光汇聚成一颗金色星星。' },
  { label: '山海相逢', prompt: '山峦被日光唤醒，飞鸟越过海面，鲸鱼跃入夜空，最后以一圈暖金色光环收束。' },
];
const SHAPES = { ring: '光环', sphere: '球体', heart: '心形', star: '星芒', galaxy: '星系', helix: '螺旋', flower: '花朵', bird: '飞鸟', whale: '鲸鱼', mountain: '山峦', city: '城市', outline: '原创轮廓' };
const MOTIONS = { still: '静置', turn: '旋转', breathe: '呼吸', wave: '波动' };
const TRANSITIONS = { morph: '渐变成形', sweep: '扫光转场', burst: '散开重聚' };
const durationLabel = milliseconds => `${Math.floor(milliseconds / 60000)} 分 ${Math.round(milliseconds / 1000) % 60} 秒`;

async function prepareShow(show, options) {
  return runAiDronePreparation(async signal => {
    const score = validateAiDroneScore(show.score);
    // The compiler and geometry stay outside the town's eager entry bundle.
    const { createAiDroneRuntime } = await import('../../../shared/aiDroneShow.js');
    if (signal.aborted) throw Object.assign(new Error('已取消节目预览准备。'), { name: 'AbortError' });
    return { show: { ...show, score }, runtime: createAiDroneRuntime(score) };
  }, options);
}

export default function AiDroneStudio({ onPlay, onClose }) {
  const [client] = useState(() => createAiDroneClient());
  const [library] = useState(() => createAiDroneLibrary());
  const [saved, setSaved] = useState(() => library.read());
  const [service, setService] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState('prompt');
  const [prompt, setPrompt] = useState('');
  const [accessPassword, setAccessPassword] = useState('');
  const [usage, setUsage] = useState(null);
  const [usageChecking, setUsageChecking] = useState(false);
  const [stage, setStage] = useState('');
  const [current, setCurrent] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [feedbackKind, setFeedbackKind] = useState('');
  const [feedbackFocus, setFeedbackFocus] = useState(0);
  const flight = useRef(null);
  const statusFlight = useRef(null);
  const usageFlight = useRef(null);
  const mounted = useRef(false);
  const startedAt = useRef(0);
  const feedbackRef = useRef(null);
  const busy = Boolean(stage);
  const unlimited = aiDroneUnlimited(usage, service);
  const accessRequired = service?.accessRequired === true;
  const development = service?.development === true || accessRequired;
  const stageFeedback = aiDroneStageFeedback(stage, elapsed, { accessRequired });
  const showFeedback = busy || Boolean(error || notice || current);
  const feedbackTitle = stageFeedback?.title || (error ? '本次未生成成功' : feedbackKind === 'canceled' ? '已取消等待' : current ? '节目已就绪' : '操作提示');

  // This measures elapsed wall time only; it never invents a completion percentage.
  useEffect(() => {
    if (!busy) return undefined;
    const update = () => setElapsed(aiDroneElapsedSeconds(startedAt.current, performance.now()));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!feedbackFocus || !feedbackRef.current) return;
    const heading = feedbackRef.current.closest('.dialog')?.querySelector('.dialog-heading');
    const headerHeight = heading?.getBoundingClientRect().height || 0;
    // The dialog scrolls underneath its sticky header. Keep the complete status
    // heading and elapsed counter below it at every font size and breakpoint.
    feedbackRef.current.style.setProperty('--ai-feedback-scroll-offset', `${Math.max(130, Math.ceil(headerHeight) + 20)}px`);
    feedbackRef.current.focus({ preventScroll: true });
    feedbackRef.current.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [feedbackFocus]);

  async function checkStatus() {
    statusFlight.current?.abort();
    const controller = new AbortController();
    statusFlight.current = controller;
    setChecking(true);
    setStatusError('');
    try {
      const next = await client.status({ signal: controller.signal });
      if (controller.signal.aborted || !mounted.current) return;
      setService(next);
      const latest = await client.usage({ signal: controller.signal });
      if (!controller.signal.aborted && mounted.current && latest) setUsage(latest);
    } catch (failure) {
      if (failure.name !== 'AbortError' && mounted.current) setStatusError('暂时无法确认服务状态，请手动重新检查。');
    } finally { if (!controller.signal.aborted && mounted.current) setChecking(false); }
  }

  useEffect(() => {
    mounted.current = true;
    void checkStatus();
    const refreshVisible = () => { if (document.visibilityState === 'visible') void refreshUsage(); };
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', refreshVisible); statusFlight.current?.abort(); usageFlight.current?.abort(); flight.current?.abort(); };
  }, []);

  // Schedule by the server's next Beijing midnight, not this device's timezone.
  // The dependency is the reset timestamp, so a stale server reply cannot create
  // a fast polling loop. Tab visibility and a manual action also refresh it.
  useEffect(() => {
    if (unlimited || !usage?.resetAt) return undefined;
    const timer = setTimeout(() => { void refreshUsage(); }, Math.min(2147483647, Math.max(100, usage.resetAt - Date.now() + 100)));
    return () => clearTimeout(timer);
  }, [usage?.resetAt, unlimited]);

  async function refreshUsage(announce = false) {
    usageFlight.current?.abort();
    const controller = new AbortController();
    usageFlight.current = controller;
    if (mounted.current) setUsageChecking(true);
    try {
      const next = await client.status({ signal: controller.signal });
      if (mounted.current && !controller.signal.aborted) setService(next);
      const latest = await client.usage({ signal: controller.signal });
      if (mounted.current && !controller.signal.aborted) {
        if (latest) setUsage(latest);
        if (announce) setNotice(aiDroneUnlimited(latest, next) ? '服务状态已更新：不限制生成次数。此操作没有调用 AI。' : latest ? `服务状态已更新。${aiDroneQuotaFeedback(latest, '', next)}` : '服务状态已更新。首次生成时建立游客身份；此操作没有调用 AI。');
      }
    } catch {
      if (announce && mounted.current && !controller.signal.aborted) setNotice('暂时无法更新服务状态。你可以稍后再检查，不会自动重试生成。');
    } finally { if (mounted.current && usageFlight.current === controller) setUsageChecking(false); }
  }

  async function generate(event) {
    event.preventDefault();
    if (flight.current || !service?.enabled || checking) return;
    try { validateAiDroneAccessPassword(accessPassword, accessRequired); }
    catch (failure) { setError(failure.message); setNotice(''); setFeedbackFocus(value => value + 1); return; }
    const controller = new AbortController();
    flight.current = controller;
    setError('');
    setNotice('');
    startedAt.current = performance.now();
    setElapsed(0);
    setFeedbackKind('');
    setStage('identity');
    setFeedbackFocus(value => value + 1);
    try {
      const request = createAiDroneRequest({ mode, prompt });
      const response = await client.generate(request, { accessPassword, signal: controller.signal, onStage: value => { if (mounted.current) setStage(value); } });
      if (controller.signal.aborted || !mounted.current) return;
      setUsage(response.usage);
      const remainingMs = Math.max(1, 60000 - (performance.now() - startedAt.current));
      const prepared = await prepareShow(response.show, { signal: controller.signal, timeoutMs: Math.min(10000, remainingMs) });
      if (controller.signal.aborted || !mounted.current) return;
      setCurrent(prepared);
      setFeedbackKind('ready');
      setNotice(response.replayed ? '已取回这次请求的节目，没有重复调用 AI。点击「立即观看」开始演出。' : '编排已完成。点击「立即观看」进入天空，也可以先查看下方章节。');
    } catch (failure) {
      if (!mounted.current) return;
      if (failure.name === 'AbortError' || controller.signal.aborted) {
        setFeedbackKind('canceled');
        setNotice('已取消等待，上一份节目仍然保留；不会自动重试。');
      }
      else {
        if (failure.usage) setUsage(failure.usage);
        setError(['AiDroneClientError', 'AiDronePreparationError'].includes(failure.name) ? failure.message : '节目校验未通过，已保留上一份作品；不会自动重试。');
      }
    } finally {
      if (flight.current === controller) flight.current = null;
      if (mounted.current) {
        setElapsed(aiDroneElapsedSeconds(startedAt.current, performance.now()));
        setStage(''); setFeedbackFocus(value => value + 1); void refreshUsage();
      }
    }
  }

  async function load(entry) {
    if (busy) return;
    const controller = new AbortController();
    flight.current = controller;
    startedAt.current = performance.now(); setElapsed(0); setFeedbackKind('');
    setStage('loading'); setError(''); setNotice('');
    try {
      const prepared = await prepareShow(entry, { signal: controller.signal, timeoutMs: 10000 });
      if (mounted.current && !controller.signal.aborted) { setCurrent(prepared); setFeedbackKind('ready'); setNotice('已载入本机节目，回放不会调用 AI。'); }
    } catch (failure) { if (mounted.current) setError(failure.name === 'AiDronePreparationError' ? failure.message : '这份本机节目无法读取，已保留当前节目。'); }
    finally { if (flight.current === controller) flight.current = null; if (mounted.current) { setStage(''); setFeedbackFocus(value => value + 1); } }
  }

  function save() {
    if (!current) return;
    const result = library.save(current.show);
    setSaved(result);
    setNotice(result.ok ? `已保存到本机。最多保留 ${AI_DRONE_LIBRARY_LIMIT} 份，超出时替换最早保存的节目。` : '本机保存失败，请检查浏览器存储空间；当前节目仍可播放。');
  }

  function remove(entry) {
    const result = library.remove(entry.id);
    setSaved(result);
    setNotice(result.ok ? '已从本机删除；不会影响当前预览。' : '删除失败，请检查浏览器存储权限。');
  }

  return <div className="ai-drone-studio">
    {development && <aside className="ai-drone-development" aria-label="AI 演出测试状态"><strong>开发中 · 仅供测试</strong><p>AI 即兴与命题编排仍在完善，效果与稳定性尚未定型。{accessRequired ? '输入测试密码后才能生成；本机已保存的节目仍可直接回放。' : '请将生成结果作为测试预览。'}</p></aside>}
    <p className="ai-drone-intro">写下主题，让 AI 为小镇编排一场灯光演出。</p>
    <div className="ai-drone-scope">仅个人观演 · 不同步全房间 · 非真实无人机飞控</div>
    {showFeedback && <section ref={feedbackRef} className={`ai-drone-feedback${error ? ' ai-drone-feedback-error' : ''}`} tabIndex={-1} aria-labelledby="ai-drone-feedback-title">
      <div className="ai-drone-feedback-heading">
        <div role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} aria-atomic="true">
          <h3 id="ai-drone-feedback-title">{busy && <span className="ai-drone-wait" aria-hidden="true"/>}{feedbackTitle}</h3>
          <p>{stageFeedback ? stageFeedback.description : error || notice}</p>
        </div>
        {busy && <span className="ai-drone-elapsed" aria-live="off">已等待 <strong>{elapsed}</strong> 秒</span>}
      </div>
      {stageFeedback?.stepIndex >= 0 && <ol className="ai-drone-steps" aria-label="真实请求阶段">{AI_DRONE_FEEDBACK_STEPS.map((label, index) => <li key={label} data-state={index < stageFeedback.stepIndex ? 'complete' : index === stageFeedback.stepIndex ? 'current' : 'waiting'} aria-current={index === stageFeedback.stepIndex ? 'step' : undefined}><span aria-hidden="true">{index < stageFeedback.stepIndex ? '✓' : index + 1}</span>{accessRequired && index === 1 ? '验证与编排' : label}<span className="ai-drone-meta">{index < stageFeedback.stepIndex ? '已完成' : index === stageFeedback.stepIndex ? '进行中' : '待开始'}</span></li>)}</ol>}
      {stageFeedback?.waiting && <p className="ai-drone-waiting-note" role="status">{stageFeedback.waiting}</p>}
      {busy && stage !== 'loading' && <button className="ai-drone-secondary" type="button" onClick={() => flight.current?.abort()}>取消等待</button>}
      {!busy && current && <div className="ai-drone-ready">
        <div><strong>{current.show.score.title}</strong><span className="ai-drone-meta">{current.show.score.scenes.length} 个章节 · 全程 {durationLabel(current.runtime.program.duration)}</span></div>
        <div className="ai-drone-play-bar"><button type="button" className="ai-drone-primary" onClick={() => onPlay(current.runtime)}>{error || feedbackKind === 'canceled' ? '观看上一份节目' : '立即观看'}</button><button type="button" className="ai-drone-secondary" disabled={!saved.available} onClick={save}>保存到本机</button><span className="ai-drone-meta">回放不调用 AI</span></div>
      </div>}
    </section>}
    <form className="ai-drone-workspace" onSubmit={generate} aria-busy={busy}>
      {accessRequired && <div className="ai-drone-access-field"><label htmlFor="ai-drone-access-password">测试密码</label><input id="ai-drone-access-password" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={AI_DRONE_MAX_ACCESS_PASSWORD} value={accessPassword} onChange={event => setAccessPassword(event.target.value)} disabled={busy} aria-required="true" aria-describedby="ai-drone-access-help" placeholder="请输入测试负责人提供的密码"/><p id="ai-drone-access-help">密码仅在本面板内临时使用，关闭后清除；不会保存到本机节目，也不会发送给模型。</p></div>}
      <fieldset className="ai-drone-mode" disabled={busy}>
        <legend>创作方式</legend>
        <label><input type="radio" name="ai-drone-mode" value="prompt" checked={mode === 'prompt'} onChange={() => setMode('prompt')}/><span>命题创作</span></label>
        <label><input type="radio" name="ai-drone-mode" value="improv" checked={mode === 'improv'} onChange={() => setMode('improv')}/><span>即兴创作</span></label>
      </fieldset>
      <div className="ai-drone-field-heading"><label htmlFor="ai-drone-prompt">{mode === 'prompt' ? '演出主题' : '灵感方向（可留空）'}</label><span className="ai-drone-meta">{prompt.length} / {AI_DRONE_MAX_PROMPT}</span></div>
      <textarea id="ai-drone-prompt" rows={4} maxLength={AI_DRONE_MAX_PROMPT} value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy} required={mode === 'prompt'} aria-describedby="ai-drone-privacy" placeholder={mode === 'prompt' ? '例如：一只鲸鱼穿过星海，最后化成一朵花…' : '留空交给 AI 即兴，也可以写下颜色、情绪或故事方向。'}/>
      <div className="ai-drone-examples" aria-label="填写示例主题"><span className="ai-drone-meta">试一个主题</span>{EXAMPLES.map(example => <button type="button" key={example.label} disabled={busy} onClick={() => { setMode('prompt'); setPrompt(example.prompt); }}>{example.label}</button>)}</div>
      <p id="ai-drone-privacy" className="ai-drone-policy">主题会发送至 DeepSeek，请勿填写隐私。{unlimited ? '不限制生成次数；仍有短时间请求频率与同时生成数量限制，请勿连续快速点击。' : service?.limit ? `当前服务每日生成上限为 ${service.limit} 次，另有短时间请求频率与同时生成数量限制。` : '生成规则以服务当前状态为准，请勿连续快速点击。'}</p>
      <div className="ai-drone-request-bar">
        <button className="ai-drone-primary" type="submit" disabled={busy || checking || !service?.enabled || (mode === 'prompt' && !prompt.trim()) || aiDroneQuotaExhausted(usage, service)}>{stageFeedback?.button || (accessRequired ? '验证密码并生成' : mode === 'improv' ? '即兴生成一场' : '生成演出')}</button>
        <span className="ai-drone-meta">{aiDroneQuotaFeedback(usage, stage, service)}</span>
        <button className="ai-drone-text-button" type="button" disabled={usageChecking || busy} onClick={() => void refreshUsage(true)}>{usageChecking ? '正在检查状态…' : '更新服务状态'}</button>
      </div>
      <div className="ai-drone-live" role="status" aria-live="polite">
        {!busy && checking ? <p>正在检查 AI 编导服务…</p> : !busy && service?.enabled === false ? <p>AI 编导暂未开放。你仍可载入本机保存的节目回放。</p> : null}
      </div>
      {(statusError || (!busy && !checking && !service?.enabled)) && <div className="ai-drone-status-retry">{statusError && <p>{statusError}</p>}<button type="button" className="ai-drone-secondary" onClick={() => void checkStatus()} disabled={checking || busy}>重新检查服务</button></div>}
    </form>

    {current && <section className="ai-drone-preview" aria-labelledby="ai-drone-show-title">
      <div className="ai-drone-section-heading"><h3 id="ai-drone-show-title">{current.show.score.title}</h3><span className="ai-drone-meta">全程 {durationLabel(current.runtime.program.duration)}</span></div>
      <p>{current.show.score.synopsis}</p>
      <div className="ai-drone-meta ai-drone-flight-note">包含自动起飞、章节转场、归航与熄灯</div>
      <ol className="ai-drone-chapters">{current.show.score.scenes.map((scene, index) => <li key={`${index}-${scene.name}`}>
        <span className="ai-drone-chapter-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <div className="ai-drone-chapter-copy"><div className="ai-drone-chapter-heading"><h4>{scene.name}</h4><span className="ai-drone-meta">{scene.duration} 秒</span></div><p>{scene.description}</p>
          <div className="ai-drone-scene-meta"><span>{SHAPES[scene.shape]} · {MOTIONS[scene.motion]} · {TRANSITIONS[scene.transition]}</span><span className="ai-drone-colors"><i style={{ backgroundColor: scene.color }} aria-hidden="true"/><i style={{ backgroundColor: scene.accent }} aria-hidden="true"/><span>{scene.color} / {scene.accent}</span></span></div>
        </div>
      </li>)}</ol>
    </section>}

    <section className="ai-drone-library" aria-labelledby="ai-drone-library-title">
      <div className="ai-drone-section-heading"><h3 id="ai-drone-library-title">本机节目库</h3><span className="ai-drone-meta">{saved.entries.length} / {AI_DRONE_LIBRARY_LIMIT} 份</span></div>
      {!saved.available ? <p>当前浏览器无法使用本机存储，生成的节目仍可直接播放。</p> : saved.entries.length === 0 ? <p>还没有保存的节目。生成后可留在这台设备，随时回放。</p> : <ul className="ai-drone-saved-list">{saved.entries.map(entry => <li key={entry.id}><div><strong>{entry.score.title}</strong><span className="ai-drone-meta">{entry.mode === 'improv' ? '即兴' : '命题'} · {entry.score.scenes.length} 个章节</span></div><div className="ai-drone-saved-actions"><button type="button" className="ai-drone-secondary" disabled={busy} onClick={() => void load(entry)} aria-label={`载入回放：${entry.score.title}`}>载入回放</button><button type="button" className="ai-drone-text-button" disabled={busy} onClick={() => remove(entry)} aria-label={`删除本机节目：${entry.score.title}`}>删除</button></div></li>)}</ul>}
      {saved.corrupt && <p className="ai-drone-error">部分本机记录损坏，已跳过；不会自动发送它们到 AI 服务。</p>}
      <div className="ai-drone-meta ai-drone-storage-note">仅限制本机保存 {AI_DRONE_LIBRARY_LIMIT} 份，不代表生成次数限制。不保存模型密钥；清除浏览器数据会删除节目。</div>
    </section>
    <button type="button" className="ai-drone-back ai-drone-text-button" onClick={onClose}>返回小镇</button>
  </div>;
}
