import { useEffect, useRef, useState } from 'react';
import './drone-video-export.css';

const busyPhase = phase => ['preparing', 'recording', 'processing'].includes(phase);
const stamp = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const filename = title => `${title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 60) || 'game-town-show'}`;
const stoppedReason = reason => ({ 'page-hidden': '页面进入后台，已自动停止并保留片段。', 'context-lost': '图形上下文中断，已停止并保留片段。', 'size-limit': '到达本机内存保护阈值，已保留片段。', 'duration-limit': '到达安全录制时长，已保留片段。' })[reason] || '已保留录制片段。';

export default function DroneVideoExport({ controller, program, onBusyChange }) {
  const [open, setOpen] = useState(false);
  const [capability, setCapability] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState({ durationMs: 0, bytes: 0 });
  const [result, setResult] = useState(null);
  const [encodedDuration, setEncodedDuration] = useState(null);
  const [error, setError] = useState('');
  const [format, setFormat] = useState('mp4');
  const engine = useRef(null);
  const alive = useRef(true);
  const starting = useRef(false);
  const operation = useRef(0);
  const current = useRef({ controller, program });
  current.current = { controller, program };
  const busy = busyPhase(phase);
  async function finish(reason) {
    const token = operation.current, recorder = engine.current;
    try { await recorder?.stop(reason); }
    catch (failure) { if (alive.current && operation.current === token && engine.current === recorder) { setPhase('error'); setError(failure.message || '视频封装失败，请重试。'); } }
  }

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; operation.current++; engine.current?.dispose(); onBusyChange(false); };
  }, [onBusyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!open || capability) return undefined;
    let active = true;
    import('../../lib/droneVideoRecorder.js').then(module => module.detectDroneVideoCapabilities({ width: 1280, height: 720, frameRate: 30 }))
      .then(value => { if (active) setCapability(value); })
      .catch(() => { if (active) setError('无法检查本机视频编码能力，请刷新重试。'); });
    return () => { active = false; };
  }, [open, capability]);
  useEffect(() => {
    if (phase === 'recording' && controller.state.ended) void finish('complete');
  }, [phase, controller.state.ended]);

  async function start() {
    if (starting.current || busy || !capability?.[format]?.supported) return;
    const canvas = document.querySelector('.town-canvas canvas');
    if (!canvas) { setError('小镇画面尚未就绪，请稍后重试。'); return; }
    starting.current = true;
    const token = ++operation.current;
    const active = () => alive.current && operation.current === token;
    setError(''); setResult(null); setEncodedDuration(null); setProgress({ durationMs: 0, bytes: 0 }); setPhase('preparing');
    onBusyChange(true);
    try {
      engine.current?.dispose();
      const { createDroneVideoRecorder } = await import('../../lib/droneVideoRecorder.js');
      if (!active()) return;
      const recorder = createDroneVideoRecorder();
      engine.current = recorder;
      // Hold the first frame while the encoder initializes, then play at 1x.
      const source = current.current;
      source.controller.start({ program: 'ai', aiRuntime: source.controller.state.aiRuntime, elapsedMs: 0, speed: 1, view: 'cinematic' });
      source.controller.togglePause();
      await recorder.start({ canvas, width: 1280, height: 720, format,
        onProgress: value => { if (active() && engine.current === recorder) setProgress(value); },
        onState: value => {
          if (!active() || engine.current !== recorder) return;
          setPhase(value.phase);
          if (value.phase === 'ready') {
            setResult(value.result);
            const control = current.current.controller;
            if (!control.state.paused && !control.state.ended) control.togglePause();
          }
          if (value.phase === 'error') {
            setError(value.message || value.error?.message || '录制失败，请重试。');
            const control = current.current.controller;
            if (!control.state.paused && !control.state.ended) control.togglePause();
          }
        },
      });
      if (active() && engine.current === recorder && recorder.getState().phase === 'recording') current.current.controller.start({ program: 'ai', aiRuntime: source.controller.state.aiRuntime, elapsedMs: 0, speed: 1, view: 'cinematic' });
    } catch (failure) { if (active()) { setError(failure.message || '录制未能开始。'); setPhase('error'); } }
    finally { if (operation.current === token) starting.current = false; }
  }
  function cancel() {
    operation.current++;
    starting.current = false;
    engine.current?.cancel();
    setPhase('idle'); setResult(null); onBusyChange(false);
    const control = current.current.controller;
    if (!control.state.paused && !control.state.ended) control.togglePause();
  }

  return <div className="drone-video-export">
    <button type="button" className="drone-action drone-export-toggle" aria-expanded={open} aria-controls="drone-video-panel" onClick={() => setOpen(value => !value)}>{busy ? '查看录制进度' : '导出 MP4'}</button>
    {open && <section id="drone-video-panel" className="drone-video-panel" aria-label="影片导出">
      <div className="drone-video-heading"><h2>将这片天空带走</h2><span className="drone-video-meta">720p · 目标 30 fps · 纯画面无声</span></div>
      {!busy && !result && <>
        <p>从头录下当前演出与运镜，约需 {stamp(program.duration)}。请保持页面前台。只录小镇画布，不含操作面板、桌面或麦克风，文件不上传。</p>
        <div className="drone-video-actions"><label>文件格式 <select aria-label="导出文件格式" value={format} onChange={event => setFormat(event.target.value)}><option value="mp4">MP4</option><option value="webm">WebM（备选）</option></select></label><button className="drone-action drone-action-primary" type="button" onClick={() => void start()} disabled={!capability?.[format]?.supported}>{capability ? `从头录制 ${format.toUpperCase()}` : '正在检查编码能力…'}</button></div>
        {capability && !capability[format]?.supported && <p role="status">{format === 'mp4' ? '当前浏览器没有可用的 MP4 编码器。请用支持 H.264 的新版 Chrome / Edge，或手动选择 WebM；不会伪装文件格式。' : '当前浏览器不支持 WebM 录制，请改选 MP4 或使用其他浏览器。'}</p>}
      </>}
      {busy && <><p role="status">{phase === 'preparing' ? '正在准备本机编码器…' : phase === 'processing' ? '正在封装视频，请不要关闭页面…' : `正在录制 ${stamp(progress.durationMs || 0)} / ${stamp(program.duration)} · ${((progress.bytes || 0) / 1048576).toFixed(1)} MiB`}</p><progress aria-label="影片录制进度" max={program.duration} value={Math.min(program.duration, progress.durationMs || 0)}/><div className="drone-video-actions"><button type="button" className="drone-action" disabled={phase !== 'recording'} onClick={() => void finish('user')}>停止并保留片段</button><button type="button" className="drone-action" onClick={cancel}>取消录制</button></div><span className="drone-video-meta">录制期间锁定跳转和倍速；退出观演会取消未保存的录制。</span></>}
      {busy && <span className="drone-video-meta">已采样 {progress.frames || 0} 帧 · 实际帧率取决于设备和前台渲染，文件大小在封装后确认。</span>}
      {phase === 'recording' && progress.durationMs > 10000 && (progress.frames || 0) / (progress.durationMs / 1000) < 12 && <p className="drone-video-error" role="status">当前实际采样约 {((progress.frames || 0) / (progress.durationMs / 1000)).toFixed(1)} 帧/秒，视频可能不流畅。请把小镇浏览器窗口置于前台，关闭其他 3D 页面；也可停止后重录。</p>}
      {result && <div className="drone-video-result"><p role="status">{result.reason === 'complete' ? '全片已完成。' : stoppedReason(result.reason)} {encodedDuration == null ? '录制用时 ' + stamp(result.durationMs) : '视频时长 ' + stamp(encodedDuration)} · {(result.bytes / 1048576).toFixed(1)} MiB · {result.extension.toUpperCase()}。点击下载后保存到你的设备。</p><video controls playsInline preload="metadata" src={result.url} onLoadedMetadata={event => { const seconds = event.currentTarget.duration; if (Number.isFinite(seconds)) setEncodedDuration(seconds * 1000); }} aria-label="已导出的无人机影片预览"/><div className="drone-video-actions"><a className="drone-action drone-action-primary" href={result.url} download={`${filename(program.title)}.${result.extension}`}>下载 {result.extension.toUpperCase()}</a><button className="drone-action" type="button" onClick={() => { engine.current?.dispose(); engine.current = null; setResult(null); setPhase('idle'); }}>重新录制</button></div></div>}
      {error && <p className="drone-video-error" role="alert">{error}</p>}
    </section>}
  </div>;
}
