import { subscribeDroneVideoFrame } from './droneVideoFrame.js';

export const DRONE_VIDEO_DEFAULTS = Object.freeze({ width: 1280, height: 720, frameRate: 30, maxDurationMs: 620000, maxBytes: 512 * 1024 * 1024 });
const HARD_MAX_BYTES = 600 * 1024 * 1024;
const MP4_TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4'];
const WEBM_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const lazyMediabunny = () => import('mediabunny');
const videoError = (code, message) => Object.assign(new Error(message), { code });
const boundedNumber = (value, fallback, minimum, maximum) => Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;

export function droneVideoDimensions(width = 1280, height = 720) {
  const w = boundedNumber(width, 1280, 320, 1920), h = boundedNumber(height, 720, 180, 1080);
  return { width: Math.floor(w / 2) * 2, height: Math.floor(h / 2) * 2, frameRate: 30 };
}

function nativeType(MediaRecorderClass, types) {
  try { return types.find(type => MediaRecorderClass?.isTypeSupported?.(type)) || null; } catch { return null; }
}

/** Capability checks never ask for camera, microphone, display or file permissions. */
export async function detectDroneVideoCapabilities(options = {}) {
  const { width, height, frameRate } = droneVideoDimensions(options.width, options.height);
  const MediaRecorderClass = options.MediaRecorderClass === undefined ? globalThis.MediaRecorder : options.MediaRecorderClass;
  const canvasCapture = options.canvasCaptureSupported ?? (typeof globalThis.HTMLCanvasElement?.prototype?.captureStream === 'function');
  const hasWebCodecs = options.webCodecsSupported ?? (typeof globalThis.VideoEncoder === 'function' && typeof globalThis.VideoFrame === 'function');
  const mp4Type = canvasCapture && nativeType(MediaRecorderClass, MP4_TYPES);
  const webmType = canvasCapture && nativeType(MediaRecorderClass, WEBM_TYPES);
  let bunnySupported = false;
  if (!mp4Type && hasWebCodecs) {
    try { const bunny = await (options.loadMediabunny || lazyMediabunny)(); bunnySupported = await bunny.canEncodeVideo('avc', { width, height, frameRate, bitrate: width > 1280 ? 6000000 : 4000000 }); } catch { /* Capability failures are rendered as unavailable, never a disguised WebM. */ }
  }
  return {
    width, height, frameRate,
    mp4: { supported: Boolean(mp4Type || bunnySupported), backend: mp4Type ? 'mediarecorder' : bunnySupported ? 'webcodecs' : null,
      mimeType: mp4Type || (bunnySupported ? 'video/mp4' : null), reason: mp4Type || bunnySupported ? '' : '当前浏览器不能编码 MP4，请使用最新版 Chrome / Edge，或选择 WebM 备选。' },
    webm: { supported: Boolean(webmType), backend: webmType ? 'mediarecorder' : null, mimeType: webmType || null },
    preferred: mp4Type || bunnySupported ? 'mp4' : webmType ? 'webm' : null,
  };
}

/** Validate actual bytes, not the filename or a caller-supplied Blob MIME. */
export async function inspectDroneVideoContainer(blob) {
  if (!blob || blob.size < 12) return null;
  const bytes = new Uint8Array(await blob.slice(0, 256).arrayBuffer());
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 12 <= bytes.length;) {
    const size = view.getUint32(offset), type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === 'ftyp' && size >= 16) {
      const brand = String.fromCharCode(...bytes.slice(offset + 8, offset + 12));
      return brand === 'qt  ' ? null : 'mp4';
    }
    if ((type !== 'free' && type !== 'wide') || size < 8) return null;
    offset += size;
  }
  return null;
}

/**
 * Real-time, video-only local canvas recording. UI starts the score AFTER start()
 * resolves. The host must call notifyDroneVideoFrame(canvas) after its final
 * compositor render. stop() is idempotent; cancel()/dispose() keep no partial file.
 */
export function createDroneVideoRecorder(options = {}) {
  const doc = options.document === undefined ? globalThis.document : options.document;
  const MediaRecorderClass = options.MediaRecorderClass === undefined ? globalThis.MediaRecorder : options.MediaRecorderClass;
  const URLApi = options.URLApi || globalThis.URL;
  const now = options.now || (() => performance.now());
  const setTimer = options.setTimeout || globalThis.setTimeout.bind(globalThis);
  const clearTimer = options.clearTimeout || globalThis.clearTimeout.bind(globalThis);
  const setTicker = options.setInterval || globalThis.setInterval.bind(globalThis);
  const clearTicker = options.clearInterval || globalThis.clearInterval.bind(globalThis);
  const loadMediabunny = options.loadMediabunny || lazyMediabunny;
  const maxBytes = Math.floor(boundedNumber(options.maxBytes, DRONE_VIDEO_DEFAULTS.maxBytes, 32, HARD_MAX_BYTES));
  const maxDurationMs = boundedNumber(options.maxDurationMs, DRONE_VIDEO_DEFAULTS.maxDurationMs, 100, DRONE_VIDEO_DEFAULTS.maxDurationMs);
  let current = null, state = { phase: 'idle', result: null }, disposed = false, generation = 0;

  const announce = (run, phase, extra = {}) => {
    if (current !== run) return;
    state = { phase, backend: run?.backend || null, width: run?.width, height: run?.height, frameRate: 30,
      durationMs: run?.startedAt == null ? 0 : Math.max(0, now() - run.startedAt), bytes: run?.bytes || 0, frames: run?.frames || 0, ...extra };
    try { run?.onState?.({ ...state }); } catch { /* UI callbacks cannot break cleanup. */ }
  };
  const revokeResult = () => { if (state.result?.url) URLApi?.revokeObjectURL?.(state.result.url); };
  const alive = run => current === run && run.generation === generation && !run.cancelled && !disposed;
  const progress = run => {
    if (!alive(run) || state.phase !== 'recording') return;
    const value = { durationMs: Math.max(0, now() - run.startedAt), bytes: run.bytes, frames: run.frames, backend: run.backend, width: run.width, height: run.height, maxBytes, maxDurationMs };
    try { run.onProgress?.(value); } catch { /* Nonessential UI notification. */ }
  };
  const stopFrames = run => {
    run.unsubscribe?.(); run.unsubscribe = null;
    for (const remove of run.listeners.splice(0)) remove();
    if (run.timer != null) clearTimer(run.timer);
    if (run.ticker != null) clearTicker(run.ticker);
    run.timer = run.ticker = null;
  };
  const release = run => {
    stopFrames(run);
    for (const track of run.stream?.getTracks?.() || []) { try { track.stop(); } catch { /* Already ended. */ } }
    run.stream = null;
    if (run.recorder) { run.recorder.ondataavailable = null; run.recorder.onstop = null; run.recorder.onerror = null; }
    if (run.target) { run.target.width = 1; run.target.height = 1; }
    run.target = run.context = run.canvas = null;
  };
  const deadline = (promise, milliseconds, code = 'ENCODER_TIMEOUT') => new Promise((resolve, reject) => {
    const timer = setTimer(() => reject(videoError(code, '视频编码器响应超时，已停止录制。')), milliseconds);
    Promise.resolve(promise).then(value => { clearTimer(timer); resolve(value); }, error => { clearTimer(timer); reject(error); });
  });
  const abortBackend = run => {
    try { if (run.recorder?.state !== 'inactive') run.recorder?.stop(); } catch { /* Best effort after an error. */ }
    try { const pending = run.output?.cancel(); pending?.catch?.(() => {}); } catch { /* Already finalized. */ }
  };
  const fail = (run, error) => {
    if (!alive(run) || run.error) return;
    run.error = error instanceof Error ? error : videoError('ENCODER_ERROR', '视频编码失败，请降低分辨率后重试。');
    abortBackend(run); release(run); run.parts = [];
    announce(run, 'error', { error: run.error, message: run.error.message, result: null });
    run.settleNative?.();
  };
  const collect = (run, part) => {
    if (run.cancelled || run.error || !part?.size) return;
    if (run.bytes + part.size > maxBytes) {
      const error = videoError('SIZE_LIMIT', '录制已达到本机内存保护上限。请降低分辨率或分段导出。');
      fail(run, error); throw error;
    }
    run.parts.push(part); run.bytes += part.size;
    if (state.phase === 'recording' && run.bytes > maxBytes * .95) { void stop('size-limit').catch(() => {}); }
  };
  const draw = run => {
    if (!alive(run) || state.phase !== 'recording' || run.encoding) return;
    const elapsed = Math.max(0, now() - run.startedAt);
    if (elapsed >= maxDurationMs) { void stop('duration-limit').catch(() => {}); return; }
    if (elapsed - run.lastFrameAt < 1000 / 30 - .5) return;
    if (!run.canvas?.width || !run.canvas?.height) return;
    try {
      const scale = Math.min(run.width / run.canvas.width, run.height / run.canvas.height);
      const width = run.canvas.width * scale, height = run.canvas.height * scale;
      run.context.fillStyle = '#000'; run.context.fillRect(0, 0, run.width, run.height);
      run.context.drawImage(run.canvas, (run.width - width) / 2, (run.height - height) / 2, width, height);
      run.lastFrameAt = elapsed; run.frames++;
      if (run.backend === 'mediarecorder') run.stream?.getVideoTracks?.()[0]?.requestFrame?.();
      else {
        // Capture synchronously, before Three clears its drawing buffer; await
        // encoder backpressure before accepting another frame. Never queue frames.
        const timestamp = run.frames === 1 ? 0 : Math.max(1 / 30, Math.floor(elapsed * 30 / 1000) / 30);
        run.encoding = Promise.resolve(run.source.add(timestamp, 1 / 30));
        run.encoding.then(() => { run.encoding = null; }, error => { run.encoding = null; fail(run, videoError('ENCODER_ERROR', `MP4 编码失败：${error?.message || '浏览器编码器不可用'}`)); });
      }
    } catch (error) { fail(run, videoError('CAPTURE_ERROR', error?.name === 'SecurityError' ? '画布包含不可跨域读取的素材，浏览器禁止导出。' : `视频画面采集失败：${error?.message || '请重试'}`)); }
  };
  const prepareNative = (run, mimeType) => {
    // captureStream(0) plus requestFrame avoids redundant frames. Legacy engines
    // without requestFrame use an explicit 30 fps capture instead.
    let stream = run.target.captureStream(0);
    if (typeof stream.getVideoTracks?.()[0]?.requestFrame !== 'function') {
      stream.getTracks?.().forEach(track => track.stop()); stream = run.target.captureStream(30);
    }
    run.stream = stream;
    // Chromium's MP4 muxer can flush only at IDR frames. Match the key-frame
    // interval to start(1000), so progress/memory checks do not wait for stop().
    const recorder = new MediaRecorderClass(stream, { mimeType, videoBitsPerSecond: run.bitrate, videoKeyFrameIntervalDuration: 1000 });
    if (!recorder.mimeType?.toLowerCase().startsWith(`video/${run.format}`)) throw videoError('FORMAT_MISMATCH', '浏览器未接受请求的视频格式，已停止导出。');
    run.recorder = recorder; run.backend = 'mediarecorder'; run.mimeType = recorder.mimeType;
    run.nativeStopped = new Promise(resolve => { run.settleNative = resolve; });
    recorder.ondataavailable = event => { try { collect(run, event.data); } catch { /* fail() already notified the UI. */ } };
    recorder.onerror = event => fail(run, videoError('ENCODER_ERROR', `浏览器视频编码失败：${event.error?.message || '请降低分辨率重试'}`));
    recorder.onstop = () => { run.settleNative(); if (alive(run) && state.phase === 'recording') void stop('capture-ended').catch(() => {}); };
    recorder.start(1000);
  };
  const prepareWebCodecs = async run => {
    const bunny = await loadMediabunny();
    if (!alive(run)) return;
    const supported = await bunny.canEncodeVideo('avc', { width: run.width, height: run.height, frameRate: 30, bitrate: run.bitrate });
    if (!alive(run)) return;
    if (!supported) throw videoError('MP4_UNSUPPORTED', '当前浏览器无法编码 MP4。请使用最新版 Chrome / Edge，或明确选择 WebM 备选。');
    const writable = new WritableStream({ write(data) { collect(run, new Blob([data])); } });
    run.output = new bunny.Output({ format: new bunny.Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }), target: new bunny.AppendOnlyStreamTarget(writable) });
    run.source = new bunny.CanvasSource(run.target, { codec: 'avc', quality: new bunny.Quality({ bitrate: run.bitrate }), keyFrameInterval: 2, latencyMode: 'realtime', sizeChangeBehavior: 'deny' });
    run.output.addVideoTrack(run.source, { frameRate: 30 });
    run.backend = 'webcodecs'; run.mimeType = 'video/mp4';
    await deadline(run.output.start(), 15000);
  };

  function start(input = {}) {
    if (disposed) return Promise.reject(videoError('DISPOSED', '导出器已经关闭。'));
    if (current && ['preparing', 'recording', 'processing'].includes(state.phase)) return current.startPromise || Promise.resolve({ ...state });
    revokeResult();
    const { width, height } = droneVideoDimensions(input.width, input.height);
    const run = { ...input, width, height, generation: ++generation, format: input.format || 'mp4', bitrate: width > 1280 ? 6000000 : 4000000,
      frames: 0, bytes: 0, parts: [], listeners: [], lastFrameAt: -Infinity, encoding: null, startedAt: null, cancelled: false, error: null, result: null };
    current = run; announce(run, 'preparing', { result: null });
    run.startPromise = (async () => {
      try {
        if (!alive(run)) throw videoError('CANCELLED', '录制已取消。');
        if (!input.canvas?.width || !input.canvas?.height) throw videoError('NO_CANVAS', '小镇画面尚未准备好，请稍后重试。');
        if (!['mp4', 'webm'].includes(run.format)) throw videoError('INVALID_FORMAT', '仅支持 MP4 或明确选择的 WebM。');
        if (doc?.hidden) throw videoError('PAGE_HIDDEN', '请在小镇页面保持可见时开始导出。');
        run.canvas = input.canvas;
        run.target = (options.createCanvas || (() => doc.createElement('canvas')))();
        run.target.width = width; run.target.height = height;
        run.context = run.target.getContext('2d', { alpha: false });
        if (!run.context) throw videoError('NO_CANVAS_CONTEXT', '浏览器无法创建视频画布。');
        const nativeMime = typeof run.target.captureStream === 'function' && nativeType(MediaRecorderClass, run.format === 'mp4' ? MP4_TYPES : WEBM_TYPES);
        if (nativeMime) {
          try { prepareNative(run, nativeMime); }
          catch (nativeError) {
            abortBackend(run); run.stream?.getTracks?.().forEach(track => track.stop()); run.stream = null; run.recorder = null;
            if (run.format !== 'mp4') throw nativeError;
            await prepareWebCodecs(run);
          }
        } else if (run.format === 'mp4') await prepareWebCodecs(run);
        else throw videoError('WEBM_UNSUPPORTED', '当前浏览器不支持 WebM 录制。');
        if (!alive(run)) { abortBackend(run); release(run); throw videoError('CANCELLED', '录制已取消。'); }
        if (run.error) throw run.error;
        run.startedAt = now(); announce(run, 'recording', { result: null });
        run.unsubscribe = (options.subscribeFrame || subscribeDroneVideoFrame)(run.canvas, () => draw(run));
        const hidden = () => { if (doc.hidden) void stop('page-hidden').catch(() => {}); };
        const lost = () => { void stop('context-lost').catch(() => {}); };
        doc?.addEventListener?.('visibilitychange', hidden); run.listeners.push(() => doc?.removeEventListener?.('visibilitychange', hidden));
        run.canvas.addEventListener?.('webglcontextlost', lost); run.listeners.push(() => run.canvas?.removeEventListener?.('webglcontextlost', lost));
        run.timer = setTimer(() => { void stop('duration-limit').catch(() => {}); }, maxDurationMs);
        run.ticker = setTicker(() => progress(run), 250);
        return { ...state };
      } catch (error) {
        if (alive(run)) fail(run, error);
        else { abortBackend(run); release(run); }
        throw error;
      }
    })();
    return run.startPromise;
  }

  function stop(reason = 'user') {
    const run = current;
    if (!run || state.phase === 'idle' || state.phase === 'disposed') return Promise.resolve(null);
    if (run.finishPromise) return run.finishPromise;
    if (state.phase === 'ready') return Promise.resolve(run.result);
    if (state.phase === 'error') return Promise.reject(run.error);
    if (state.phase === 'preparing') return cancel();
    stopFrames(run); run.durationMs = Math.max(0, now() - run.startedAt);
    announce(run, 'processing', { reason, result: null });
    run.finishPromise = (async () => {
      try {
        if (run.backend === 'mediarecorder') {
          if (run.recorder.state !== 'inactive') run.recorder.stop();
          await deadline(run.nativeStopped, 15000);
        } else {
          if (run.encoding) await deadline(run.encoding, 15000);
          if (!alive(run)) return null;
          run.source.close(); await deadline(run.output.finalize(), 15000);
        }
        if (run.error) throw run.error;
        if (!alive(run)) return null;
        if (!run.frames || !run.bytes) throw videoError('EMPTY_RECORDING', '尚未录到演出画面，请播放节目后再停止。');
        const blob = new Blob(run.parts, { type: run.mimeType });
        run.parts = [];
        const container = await inspectDroneVideoContainer(blob);
        if (!alive(run)) return null;
        if (container !== run.format) throw videoError('FORMAT_MISMATCH', '浏览器输出格式不符合所选类型；没有伪装成 MP4 下载。');
        const result = { blob, url: URLApi.createObjectURL(blob), mimeType: run.mimeType, extension: container, durationMs: run.durationMs,
          bytes: blob.size, width: run.width, height: run.height, frameRate: 30, frames: run.frames, backend: run.backend, reason, videoOnly: true };
        run.result = result; release(run); announce(run, 'ready', { result, reason, durationMs: run.durationMs });
        return result;
      } catch (error) { fail(run, error); throw error; }
      finally { release(run); }
    })();
    return run.finishPromise;
  }

  async function cancel() {
    const run = current;
    revokeResult();
    if (!run) { state = { phase: disposed ? 'disposed' : 'idle', result: null }; return null; }
    run.cancelled = true; generation++;
    abortBackend(run); release(run); run.parts = []; run.result = null; run.settleNative?.();
    announce(run, disposed ? 'disposed' : 'idle', { result: null, reason: 'cancelled' });
    // Do not retain a resolved finishPromise (and its potentially large Blob)
    // after the user cancels/disposes the result.
    current = null;
    return null;
  }
  function dispose() { disposed = true; return cancel(); }

  return { start, stop, cancel, dispose, getState: () => ({ ...state }) };
}
