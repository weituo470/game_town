import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Download, ImagePlus, RefreshCw, Trash2, UserRound } from 'lucide-react';
import { createGameImageJobRequest, GAME_IMAGE_STYLES, gameImageAssetUrl, gameImageClient, readImageBase64, startGameImagePolling, validateImageFile } from '../lib/gameImageClient.js';
import { createGameCharacterJobRequest, gameCharacterClient } from '../lib/gameCharacterClient.js';
import CharacterModelPreview from './CharacterModelPreview.jsx';
import './character-studio.css';

// Only a creation key + server asset ID are retained while this page stays open.
// No photo, base64, token or private image is written into browser storage.
let uncertainJobRequest = null;
let uncertainCharacterRequest = null;
const labels = { queued: '排队中', running: '参考图生成中', succeeded: '参考图完成', failed: '参考图生成失败', outcome_unknown: '结果待确认', deleted: '已删除' };
const activeStatus = status => ['queued', 'running'].includes(status);

function statusText(job) {
  if (job.status === 'queued') return job.queuePosition ? `排队中 · 前方约 ${Math.max(0, job.queuePosition - 1)} 个任务` : '已进入队列，请耐心等待。';
  if (job.status === 'running') return '图像服务正在制作角色参考图，关闭工坊不会取消任务。';
  if (job.status === 'outcome_unknown') return '服务结果尚未确认，可能已产生费用。请刷新查看，不要反复提交生成。';
  if (job.status === 'failed') return '本次生成未完成。不会自动重试或再次付费。';
  return labels[job.status];
}

export default function CharacterStudio({ onAvatarChanged, onCharacterChanged, onEnterTown }) {
  const [config, setConfig] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [inputAssetId, setInputAssetId] = useState(null);
  const [styleId, setStyleId] = useState('storybook');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pollError, setPollError] = useState('');
  const [uncertain, setUncertain] = useState(uncertainJobRequest);
  const [previewAssetId, setPreviewAssetId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [characterConfig, setCharacterConfig] = useState(null);
  const [characterJobs, setCharacterJobs] = useState([]);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [referenceAssetId, setReferenceAssetId] = useState(null);
  const [meshyConsent, setMeshyConsent] = useState(false);
  const [uncertainCharacter, setUncertainCharacter] = useState(uncertainCharacterRequest);
  const [characterError, setCharacterError] = useState('');
  const [previewCharacterId, setPreviewCharacterId] = useState(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [modelPreviewReady, setModelPreviewReady] = useState(false);
  const [deleteCharacterId, setDeleteCharacterId] = useState(null);
  const action = useRef(null);
  const mounted = useRef(true);
  const consentId = useId(), fileId = useId();
  const meshyConsentId = useId();
  const styles = config?.styles.length ? config.styles : GAME_IMAGE_STYLES;
  const unknownJobs = jobs.some(job => job.status === 'outcome_unknown');
  const outputAssetId = previewAssetId || jobs.find(job => job.status === 'succeeded' && job.outputAssetId)?.outputAssetId || null;
  const pendingJobs = jobs.filter(job => activeStatus(job.status));
  const visibleJobs = jobs.filter(job => job.status !== 'deleted');
  const visibleCharacters = characterJobs.filter(item => item.status !== 'deleted');
  const unknownCharacter = characterJobs.some(item => item.status === 'outcome_unknown');
  const previewCharacterJob = characterJobs.find(item => item.id === previewCharacterId && item.status === 'succeeded');
  const previewCharacterAsset = useMemo(() => previewCharacterJob ? { id: previewCharacterJob.id, modelUrl: previewCharacterJob.modelUrl, walkingUrl: previewCharacterJob.walkingUrl, facing: 'positive-z' } : null, [previewCharacterJob?.id, previewCharacterJob?.modelUrl, previewCharacterJob?.walkingUrl]);
  const onModelReady = useCallback(ready => setModelPreviewReady(ready), []);

  function applyCharacters(data) {
    if (!mounted.current) return;
    setCharacterJobs(data.jobs); setSelectedCharacter(data.selectedCharacter); setCharacterError('');
    onCharacterChanged?.(data.selectedCharacter);
  }

  function applyMine(data) {
    if (!mounted.current) return;
    setJobs(data.jobs);
    setSelectedAssetId(data.selectedAssetId);
    setPollError('');
    onAvatarChanged?.({ assetId: data.selectedAssetId, url: data.selectedAssetId ? gameImageAssetUrl(data.selectedAssetId) : null });
  }

  async function run(name, operation) {
    if (action.current) return;
    const controller = new AbortController(); action.current = controller;
    setBusy(name); setError(''); setNotice('');
    try { await operation(controller.signal); }
    catch (failure) { if (mounted.current && failure.name !== 'AbortError') setError(failure.message); }
    finally { if (action.current === controller) { action.current = null; if (mounted.current) setBusy(''); } }
  }

  function loadConfig() {
    return run('bootstrap', async signal => {
      const data = await gameImageClient.bootstrap({ signal });
      if (!mounted.current) return;
      setConfig(data); applyMine(data);
      if (!data.styles.some(style => style.id === styleId)) setStyleId(data.styles[0]?.id || 'storybook');
      try { const meshConfig = await gameCharacterClient.status({ signal }); if (mounted.current) { setCharacterConfig(meshConfig); applyCharacters(meshConfig); } }
      catch (failure) { if (mounted.current && failure.name !== 'AbortError') setCharacterError(failure.message); }
    });
  }

  useEffect(() => {
    mounted.current = true;
    void loadConfig();
    return () => { mounted.current = false; action.current?.abort(); action.current = null; };
  }, []);

  useEffect(() => {
    if (!file) { setPreviewUrl(''); return undefined; }
    const url = URL.createObjectURL(file); setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!config) return undefined;
    return startGameImagePolling({
      refresh: async options => { const data = await gameImageClient.mine(options); if (!options.signal.aborted) applyMine(data); },
      onError: () => { if (mounted.current) setPollError('暂时无法更新任务状态，任务不会因此重新提交。'); },
    });
  }, [Boolean(config)]);

  useEffect(() => {
    if (!characterConfig) return undefined;
    return startGameImagePolling({ refresh: async options => { const data = await gameCharacterClient.mine(options); if (!options.signal.aborted) applyCharacters(data); }, onError: () => { if (mounted.current) setCharacterError('暂时无法更新 3D 任务；不会自动重试付费生成。'); } });
  }, [Boolean(characterConfig)]);

  function chooseFile(event) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    try {
      validateImageFile(chosen, config?.maxUploadBytes);
      setFile(chosen); setInputAssetId(null); setConsent(false); setError(''); setNotice('');
    } catch (failure) { setError(failure.message); }
    event.target.value = '';
  }

  function upload() {
    if (!config?.enabled || !file || !consent || uncertain) return;
    return run('upload', async signal => {
      const data = await readImageBase64(file, { signal });
      const result = await gameImageClient.upload({ mime: file.type, data, consent: true }, { signal });
      if (!mounted.current) return;
      setInputAssetId(result.inputAssetId); setNotice('照片已上传；还没有提交生成任务。请选择风格后单独点击生成。');
    });
  }

  function createJob(recover = false) {
    if (!config?.enabled || (!recover && (!inputAssetId || !consent || unknownJobs || uncertain))) return;
    const prepared = recover ? uncertain : createGameImageJobRequest({ inputAssetId, styleId, consent });
    if (!prepared || action.current) return;
    uncertainJobRequest = prepared; setUncertain(prepared);
    return run(recover ? 'recover' : 'create', async signal => {
      try {
        const { job } = await gameImageClient.createJob(prepared, { signal });
        uncertainJobRequest = null;
        if (!mounted.current) return;
        setUncertain(null); setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
        setNotice(recover ? '已找回同一任务，没有另建一份生成任务。' : '任务已提交。可以关闭工坊，稍后回到“我的作品”查看。');
      } catch (failure) {
        if (failure.name !== 'AbortError' && !failure.ambiguous) { uncertainJobRequest = null; if (mounted.current) setUncertain(null); }
        throw failure;
      }
    });
  }

  function refresh() { return run('refresh', async signal => { applyMine(await gameImageClient.mine({ signal })); }); }

  function removeJob(job) {
    return run(`delete:${job.id}`, async signal => {
      await gameImageClient.deleteJob(job.id, { signal });
      if (!mounted.current) return;
      setJobs(current => current.filter(item => item.id !== job.id)); setConfirmDelete(null);
      if (previewAssetId === job.outputAssetId) setPreviewAssetId(null);
      if (selectedAssetId === job.outputAssetId) { setSelectedAssetId(null); onAvatarChanged?.({ assetId: null, url: null }); }
      if (referenceAssetId === job.outputAssetId) { setReferenceAssetId(null); setMeshyConsent(false); }
      setNotice('已删除这份作品。');
    });
  }

  function generateCharacter(recover = false) {
    if (!characterConfig?.enabled || (!recover && (!referenceAssetId || !meshyConsent || unknownCharacter || uncertainCharacter))) return;
    const prepared = recover ? uncertainCharacter : createGameCharacterJobRequest({ referenceAssetId, consent: meshyConsent });
    if (!prepared || action.current) return;
    uncertainCharacterRequest = prepared; setUncertainCharacter(prepared);
    return run(recover ? 'mesh-recover' : 'mesh-create', async signal => {
      try {
        const { job } = await gameCharacterClient.createJob(prepared, { signal });
        uncertainCharacterRequest = null;
        if (!mounted.current) return;
        setUncertainCharacter(null); setCharacterJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
        setNotice(recover ? '已找回原 3D 任务，没有重试 Meshy 生成。' : '3D 任务已提交；请等待建模、绑定和动作资源完成。');
      } catch (failure) {
        if (failure.name !== 'AbortError' && !failure.ambiguous) { uncertainCharacterRequest = null; if (mounted.current) setUncertainCharacter(null); }
        throw failure;
      }
    });
  }

  function enterWithCharacter() {
    if (!previewCharacterJob || !modelPreviewReady) return;
    return run('mesh-select', async signal => {
      const data = await gameCharacterClient.select(previewCharacterJob.id, { signal });
      if (!mounted.current) return;
      setSelectedCharacter(data.selectedCharacter); onCharacterChanged?.(data.selectedCharacter); onEnterTown?.();
    });
  }

  function removeCharacter(job) {
    return run(`mesh-delete:${job.id}`, async signal => {
      await gameCharacterClient.deleteJob(job.id, { signal });
      if (!mounted.current) return;
      setCharacterJobs(current => current.filter(item => item.id !== job.id)); setDeleteCharacterId(null);
      if (previewCharacterId === job.id) { setPreviewCharacterId(null); setModelPreviewReady(false); }
      if (selectedCharacter?.id === job.id) { setSelectedCharacter(null); onCharacterChanged?.(null); }
      setNotice('已删除这项 3D 角色；删除不会退回已产生的服务费用。');
    });
  }

  return <section className="character-studio" aria-label="我的 3D 角色">
    <header className="character-studio-intro"><span className="character-studio-kicker">照片 → 角色参考图 → 3D 与动作</span><h3>我的 3D 角色</h3><p>先制作参考图，再通过 Meshy 建模、绑定骨骼与行走动作，最后选择真实角色进入小镇。图片完成不等于 3D 完成。</p></header>
    <ol className="character-studio-phases" aria-label="3D 角色制作进度"><li><strong>1. 生成角色参考图</strong><span>{outputAssetId ? '已有参考图，在作品中选择用于 3D' : '先上传照片，选择人物风格'}</span></li><li><strong>2. 生成 3D 模型与动作</strong><span>{characterConfig?.enabled ? 'Meshy 已启用；单独授权后提交' : '等待 Meshy 专用配置及费用额度'}</span></li><li><strong>3. 进入小镇</strong><span>{selectedCharacter ? '已选择个人 3D 角色' : '真实模型和动作预览成功后才能使用'}</span></li></ol>
    {!config && <div className="character-studio-service" role="status"><p>{busy === 'bootstrap' ? '正在检查工坊服务…' : '暂未连接专用图像服务。可先在本地预览照片，不会上传。'}</p>{!busy && <button onClick={loadConfig}>重新检查服务</button>}</div>}
    {config && !config.enabled && <div className="character-studio-service" role="status"><p>专用图像生成服务尚未配置或未启用。现在只提供本地预览，不会上传照片或产生生成费用。</p><button disabled={Boolean(busy)} onClick={loadConfig}>重新检查服务</button></div>}
    <div className="character-studio-workspace">
      <div className="character-studio-preview">
        <figure><div className="character-studio-image-frame">{previewUrl ? <img src={previewUrl} alt="仅在本地预览的待用照片" /> : <div className="character-studio-placeholder"><ImagePlus size={34} aria-hidden="true" /><span>你的照片</span></div>}</div><figcaption>原始照片 · {inputAssetId ? '已上传' : '本地预览'}</figcaption></figure>
        <figure><div className="character-studio-image-frame">{outputAssetId ? <img src={gameImageAssetUrl(outputAssetId)} alt="生成的角色参考图，不是 3D 模型" /> : <div className="character-studio-placeholder"><UserRound size={34} aria-hidden="true" /><span>角色参考图</span><span className="character-studio-placeholder-note">图片完成 ≠ 3D 完成</span></div>}</div><figcaption>参考图 · 不是 3D 模型</figcaption></figure>
      </div>
      <div className="character-studio-form">
        <div className="character-studio-step"><strong>1. 选择照片</strong><label className="character-studio-file-label" htmlFor={fileId}><ImagePlus size={18} aria-hidden="true" />{file ? '更换照片' : '选择本地照片'}</label><input id={fileId} className="character-studio-file-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(busy) || Boolean(uncertain)} onChange={chooseFile} /><p>PNG、JPEG 或 WebP，不超过 5 MiB。清晰的单人照片效果更稳定。</p>{file && <span className="character-studio-file-meta">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MiB</span>}</div>
        <fieldset className="character-studio-styles" disabled={Boolean(busy) || Boolean(uncertain)}><legend>2. 选择人物风格</legend>{styles.map(style => <label key={style.id} className={`character-studio-style ${styleId === style.id ? 'is-selected' : ''}`}><input type="radio" name={`${fileId}-style`} value={style.id} checked={styleId === style.id} onChange={() => setStyleId(style.id)} /><span><strong>{style.label}</strong><span>{style.description}</span></span></label>)}</fieldset>
        <label className="character-studio-consent" htmlFor={consentId}><input id={consentId} type="checkbox" checked={consent} disabled={Boolean(busy) || Boolean(uncertain)} onChange={event => setConsent(event.target.checked)} /><span>我有权使用此照片，并同意发送给图像生成服务</span></label>
        <p className="character-studio-cost">只有点击生成才会提交付费生成任务。请勿上传证件、隐私照片或无权使用的人像。</p>
        <div className="character-studio-actions"><button disabled={!config?.enabled || !file || !consent || Boolean(busy) || Boolean(uncertain) || Boolean(inputAssetId)} onClick={upload}>{busy === 'upload' ? '正在上传照片…' : inputAssetId ? '照片已上传' : '上传照片'}</button><button className="character-studio-primary" disabled={!config?.enabled || !inputAssetId || !consent || Boolean(busy) || Boolean(uncertain) || unknownJobs} onClick={() => createJob()}>{busy === 'create' ? '正在提交任务…' : '生成角色参考图'}</button></div>
      </div>
    </div>
    {uncertain && !['create', 'recover'].includes(busy) && <div className="character-studio-warning" role="status"><p>任务创建结果待确认。不要重新生成；“找回此任务”只使用原任务标识查找或补建同一任务，不会重试图像服务。</p><button disabled={Boolean(busy) || !config?.enabled} onClick={() => createJob(true)}>找回此任务</button><p>如果已经在下方看到任务，请以该任务状态为准。刷新页面后可先查看“我的作品”，不要急着重复提交。</p></div>}
    {busy === 'recover' && <p className="character-studio-notice" role="status">正在使用原标识找回任务，不会另建付费任务…</p>}
    {error && <p className="character-studio-error" role="alert">{error}</p>}
    {notice && <p className="character-studio-notice" role="status">{notice}</p>}
    <section className="character-studio-gallery" aria-label="我的作品"><div className="character-studio-gallery-heading"><div><h4>我的作品</h4><span>{pendingJobs.length ? `${pendingJobs.length} 个任务进行中` : `${visibleJobs.length} 份作品与任务`}</span></div><button disabled={Boolean(busy) || !config} onClick={refresh}><RefreshCw size={17} aria-hidden="true" />刷新状态</button></div>
      {pollError && <p className="character-studio-error" role="status">{pollError}</p>}
      {visibleJobs.length === 0 ? <p className="character-studio-empty">还没有参考图。选照片、确认授权并上传后，即可创建第一张角色参考图。</p> : <div className="character-studio-gallery-grid">{visibleJobs.map(job => <article className="character-studio-job" key={job.id}>
        {job.status === 'succeeded' && job.outputAssetId ? <button className="character-studio-result-preview" onClick={() => setPreviewAssetId(job.outputAssetId)} aria-label={`预览${styles.find(style => style.id === job.styleId)?.label || job.styleId}作品`}><img src={gameImageAssetUrl(job.outputAssetId)} alt="我的 2D 人物作品" loading="lazy" /></button> : <div className="character-studio-job-placeholder"><UserRound size={30} aria-hidden="true" /><strong>{labels[job.status]}</strong></div>}
        <div className="character-studio-job-copy"><h5>{styles.find(style => style.id === job.styleId)?.label || job.styleId}</h5><span className={`character-studio-job-status state-${job.status}`}>{labels[job.status]}</span><p>{statusText(job)}</p>
          {job.status === 'succeeded' && job.outputAssetId && <div className="character-studio-job-actions"><button disabled={Boolean(busy) || Boolean(uncertainCharacter)} aria-pressed={referenceAssetId === job.outputAssetId} onClick={() => { setReferenceAssetId(job.outputAssetId); setPreviewAssetId(job.outputAssetId); setMeshyConsent(false); }}>{referenceAssetId === job.outputAssetId ? '已选为 3D 参考' : '用于 3D 角色'}</button><a href={gameImageAssetUrl(job.outputAssetId)} download={`playtown-reference-${job.styleId}.png`}><Download size={17} aria-hidden="true" />下载参考图</a></div>}
          {!activeStatus(job.status) && (confirmDelete === job.id ? <div className="character-studio-delete-confirm"><p>删除后不能在工坊恢复。{job.status === 'outcome_unknown' ? '结果尚未确认，删除不会撤回可能已产生的费用。' : ''}</p><button disabled={Boolean(busy)} onClick={() => removeJob(job)}>确认删除</button><button disabled={Boolean(busy)} onClick={() => setConfirmDelete(null)}>保留作品</button></div> : <button className="character-studio-delete" disabled={Boolean(busy)} onClick={() => setConfirmDelete(job.id)}><Trash2 size={16} aria-hidden="true" />删除</button>)}
        </div></article>)}</div>}
    </section>
    <section className="character-studio-meshy" aria-label="生成 3D 模型与动作"><h4>2. 生成 3D 模型与动作</h4><p>这一步将选中的参考图发送给 Meshy。图片服务的 50 张额度不等于 Meshy 的 3D 积分。</p>
      {!characterConfig?.enabled && <div className="character-studio-service" role="status"><p>Meshy 专用配置或费用额度尚未启用。现在不会提交 3D 生成，也不会把参考图当成可行走模型。</p><button disabled={Boolean(busy)} onClick={loadConfig}>重新检查 3D 服务</button></div>}
      <div className="character-studio-meshy-input">{referenceAssetId ? <img src={gameImageAssetUrl(referenceAssetId)} alt="准备发送给 Meshy 的角色参考图" /> : <div className="character-studio-placeholder"><UserRound size={28} aria-hidden="true" /><span>请先在上方作品中选择“用于 3D 角色”</span></div>}<div><p>预计每个角色约 {characterConfig?.estimatedCredits ?? 20} Meshy 积分，仅为当前 API 计价参考；实际费用以服务账单为准。未确认额度时不能启用。</p><label className="character-studio-consent" htmlFor={meshyConsentId}><input id={meshyConsentId} type="checkbox" checked={meshyConsent} disabled={Boolean(busy) || Boolean(uncertainCharacter) || !referenceAssetId} onChange={event => setMeshyConsent(event.target.checked)} /><span>我同意将这张参考图发送给 Meshy，生成 3D 模型与动作，并知晓会产生独立费用</span></label><button className="character-studio-primary" disabled={!characterConfig?.enabled || !referenceAssetId || !meshyConsent || Boolean(busy) || Boolean(uncertainCharacter) || unknownCharacter} onClick={() => generateCharacter()}>{busy === 'mesh-create' ? '正在提交 3D 任务…' : '生成 3D 角色'}</button></div></div>
      {uncertainCharacter && !['mesh-create', 'mesh-recover'].includes(busy) && <div className="character-studio-warning" role="status"><p>3D 任务创建结果未知，可能已产生费用。请找回原任务，不要重新生成。</p><button disabled={Boolean(busy) || !characterConfig?.enabled} onClick={() => generateCharacter(true)}>找回原 3D 任务</button></div>}
      {busy === 'mesh-recover' && <p role="status">正在找回原 3D 任务，不会重新调用 Meshy 生成…</p>}
      {characterError && <p className="character-studio-error" role="status">{characterError}</p>}
      <div className="character-studio-gallery-heading"><h4>我的 3D 任务</h4><button disabled={Boolean(busy) || !characterConfig} onClick={() => run('mesh-refresh', async signal => applyCharacters(await gameCharacterClient.mine({ signal })))}><RefreshCw size={17} aria-hidden="true" />刷新 3D 状态</button></div>
      {visibleCharacters.length === 0 ? <p className="character-studio-empty">还没有真实 3D 任务。参考图生成完成后，仍需单独进行这一阶段。</p> : <div className="character-studio-meshy-jobs">{visibleCharacters.map(item => <article key={item.id} className="character-studio-meshy-job"><div><strong>{item.status === 'succeeded' ? '已建模并绑定行走动作' : item.status === 'outcome_unknown' ? '3D 结果待确认' : item.status === 'failed' ? '3D 生成失败' : item.status === 'queued' ? '3D 任务排队中' : { model: '正在生成 3D 模型', rig: '正在绑定骨骼与动作', download: '正在保存模型与动作', ready: '正在确认资源' }[item.stage]}</strong>{activeStatus(item.status) && item.progress !== undefined && <span>服务端进度：{item.progress}%</span>}{item.status === 'outcome_unknown' && <p>结果尚未确认，可能已扣费。不会自动重试，请等待确认，不要重复生成。</p>}{item.status === 'failed' && <p>本次未完成，不会自动再次调用付费服务。</p>}{selectedCharacter?.id === item.id && <span>当前小镇角色 · 仅个人可见</span>}</div><div className="character-studio-job-actions">{item.status === 'succeeded' && <button disabled={Boolean(busy)} onClick={() => { setModelPreviewReady(false); setPreviewCharacterId(item.id); setPreviewRevision(value => value + 1); }}>预览真实 3D 角色</button>}{!activeStatus(item.status) && (deleteCharacterId === item.id ? <><p>删除后不能恢复；若正在使用，会恢复默认人物。费用不会退回。</p><button disabled={Boolean(busy)} onClick={() => removeCharacter(item)}>确认删除 3D 角色</button><button disabled={Boolean(busy)} onClick={() => setDeleteCharacterId(null)}>保留角色</button></> : <button disabled={Boolean(busy)} onClick={() => setDeleteCharacterId(item.id)}><Trash2 size={16} aria-hidden="true" />删除 3D 任务</button>)}</div></article>)}</div>}
    </section>
    <section className="character-studio-enter" aria-label="使用真实角色进入小镇"><h4>3. 进入小镇</h4>{previewCharacterAsset ? <CharacterModelPreview key={`${previewCharacterAsset.id}:${previewRevision}`} asset={previewCharacterAsset} onReadyChanged={onModelReady} /> : <p>选择已完成任务的“预览真实 3D 角色”，检查模型与行走动作；这里不会用平面图片冒充 3D。</p>}<button className="character-studio-primary" disabled={!modelPreviewReady || !previewCharacterJob || Boolean(busy)} onClick={enterWithCharacter}>{busy === 'mesh-select' ? '正在设置角色…' : '用此角色进入小镇'}</button><p>当前只替换你在本浏览器看到的人物，尚未同步多人外观。</p>{selectedCharacter && <button disabled={Boolean(busy)} onClick={() => run('mesh-reset', async signal => { const data = await gameCharacterClient.select(null, { signal }); if (mounted.current) { setSelectedCharacter(null); onCharacterChanged?.(data.selectedCharacter); setNotice('已恢复默认小镇人物。'); } })}>恢复默认人物</button>}</section>
    <p className="character-studio-privacy">默认私有，仅当前浏览器身份可访问。照片、作品和任务保存在服务端；清除本站 Cookie 或更换浏览器后无法凭原身份找回。关闭窗口不会取消已提交的生成任务。请及时下载想保留的作品。</p>
  </section>;
}
