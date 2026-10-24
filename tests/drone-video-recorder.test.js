import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDroneVideoRecorder, detectDroneVideoCapabilities, droneVideoDimensions, inspectDroneVideoContainer, DRONE_VIDEO_DEFAULTS } from '../src/lib/droneVideoRecorder.js';
import { notifyDroneVideoFrame, subscribeDroneVideoFrame } from '../src/lib/droneVideoFrame.js';

const mp4 = () => new Blob([Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109, 97, 118, 99, 49])], { type: 'video/mp4' });
const webm = () => new Blob([Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0, 0, 0, 0, 0, 0, 0])], { type: 'video/webm' });
const flush = () => new Promise(resolve => setImmediate(resolve));

function eventSurface(extra = {}) {
  const events = new Map();
  return { ...extra, addEventListener(name, callback) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(callback); },
    removeEventListener(name, callback) { events.get(name)?.delete(callback); }, emit(name) { for (const callback of [...(events.get(name) || [])]) callback({ type: name }); },
    listenerCount() { return [...events.values()].reduce((n, values) => n + values.size, 0); } };
}

function rig(settings = {}) {
  let time = 0, calls = 0, loadCalls = 0, urlId = 0;
  const recordings = [], streams = [], draws = [], states = [], progress = [], revoked = [], timers = new Map(), intervals = new Map(), bunnyCalls = [];
  const doc = eventSurface({ hidden: false }), canvas = eventSurface({ width: 1600, height: 900 });
  const target = { width: 0, height: 0, getContext() { return { fillRect: (...args) => draws.push(['clear', ...args]), drawImage: (...args) => draws.push(['draw', ...args]) }; }, captureStream(rate) {
    const track = { stopped: false, frames: 0, stop() { this.stopped = true; }, ...(settings.noRequestFrame ? {} : { requestFrame() { this.frames++; } }) };
    const stream = { rate, track, getVideoTracks: () => [track], getTracks: () => [track] }; streams.push(stream); return stream;
  } };
  class Recorder {
    static isTypeSupported(type) { return settings.support ? settings.support(type) : type.startsWith('video/mp4'); }
    constructor(stream, config) { if (settings.constructError) throw new Error('Native constructor unavailable'); this.stream = stream; this.mimeType = config.mimeType; this.config = config; this.state = 'inactive'; recordings.push(this); }
    start(slice) { this.state = 'recording'; this.slice = slice; }
    stop() { if (this.state === 'inactive') return; this.state = 'inactive'; this.ondataavailable?.({ data: settings.output ? settings.output() : this.mimeType.startsWith('video/mp4') ? mp4() : webm() }); this.onstop?.(); }
    data(blob) { this.ondataavailable?.({ data: blob }); }
    error() { this.onerror?.({ error: new Error('Hardware encoder lost') }); }
  }
  const bunny = {
    async canEncodeVideo(codec, opts) { bunnyCalls.push(['capability', codec, opts]); return settings.bunnySupported !== false; },
    Quality: class { constructor(value) { this.value = value; } },
    Mp4OutputFormat: class { constructor(value) { this.value = value; } },
    AppendOnlyStreamTarget: class { constructor(writable) { this.writable = writable; } },
    CanvasSource: class {
      constructor(value, config) { this.canvas = value; this.config = config; bunnyCalls.push(['source', config]); }
      add(timestamp, duration) { bunnyCalls.push(['add', timestamp, duration]); if (settings.addError) return Promise.reject(new Error('WebCodecs encoder failed')); return settings.pendingAdd?.() || Promise.resolve(); }
      close() { bunnyCalls.push(['close']); }
    },
    Output: class {
      constructor(config) { this.config = config; this.state = 'pending'; this.writer = config.target.writable.getWriter(); bunnyCalls.push(['output', config.format.value]); }
      addVideoTrack(source, metadata) { this.source = source; bunnyCalls.push(['track', metadata]); }
      async start() { this.state = 'started'; if (settings.pendingStart) await settings.pendingStart(); }
      async finalize() { bunnyCalls.push(['finalize']); await this.writer.write(new Uint8Array(await mp4().arrayBuffer())); await this.writer.close(); this.state = 'finalized'; }
      async cancel() { bunnyCalls.push(['cancel']); this.state = 'canceled'; try { await this.writer.abort(); } catch {} }
    },
  };
  const recorder = createDroneVideoRecorder({ document: doc, MediaRecorderClass: Recorder, now: () => time, createCanvas: () => target,
    URLApi: { createObjectURL: () => `blob:video-${++urlId}`, revokeObjectURL: url => revoked.push(url) },
    loadMediabunny: async () => { loadCalls++; return bunny; }, maxBytes: settings.maxBytes,
    setTimeout: (callback, delay) => { const id = ++calls; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => { const id = ++calls; intervals.set(id, { callback, delay }); return id; }, clearInterval: id => intervals.delete(id),
  });
  return { recorder, Recorder, canvas, target, doc, recordings, streams, draws, states, progress, revoked, timers, intervals, bunny, bunnyCalls,
    get loadCalls() { return loadCalls; },
    start: (input = {}) => recorder.start({ canvas, onState: value => states.push(value), onProgress: value => progress.push(value), ...input }),
    frame(delta = 34) { time += delta; notifyDroneVideoFrame(canvas); }, advance(delta) { time += delta; }, tick() { for (const { callback } of intervals.values()) callback(); },
  };
}

test('capabilities prefer real native MP4 without downloading fallback', async () => {
  let loaded = false;
  const result = await detectDroneVideoCapabilities({ width: 1920, height: 1080, canvasCaptureSupported: true, webCodecsSupported: true,
    MediaRecorderClass: { isTypeSupported: type => type.startsWith('video/mp4') }, loadMediabunny: () => { loaded = true; throw new Error('not needed'); } });
  assert.equal(result.mp4.backend, 'mediarecorder'); assert.equal(result.preferred, 'mp4'); assert.equal(loaded, false);
});

test('capabilities use WebCodecs only when native MP4 is unavailable', async () => {
  const result = await detectDroneVideoCapabilities({ canvasCaptureSupported: false, webCodecsSupported: true, MediaRecorderClass: null,
    loadMediabunny: async () => ({ canEncodeVideo: async (codec, opts) => codec === 'avc' && opts.width === 1280 }) });
  assert.equal(result.mp4.backend, 'webcodecs'); assert.equal(result.mp4.mimeType, 'video/mp4'); assert.equal(result.webm.supported, false);
});

test('unsupported MP4 is explicit, WebM remains an honestly named option', async () => {
  const result = await detectDroneVideoCapabilities({ canvasCaptureSupported: true, webCodecsSupported: false,
    MediaRecorderClass: { isTypeSupported: type => type.startsWith('video/webm') } });
  assert.equal(result.mp4.supported, false); assert.equal(result.mp4.backend, null); assert.equal(result.preferred, 'webm'); assert.ok(result.mp4.reason.includes('MP4'));
});

test('capability loader failures do not promise unsupported MP4', async () => {
  const result = await detectDroneVideoCapabilities({ canvasCaptureSupported: false, webCodecsSupported: true,
    loadMediabunny: async () => { throw new Error('offline'); } });
  assert.equal(result.mp4.supported, false); assert.equal(result.preferred, null);
});

test('dimensions and encoding defaults bound 10-minute memory and load', () => {
  assert.deepEqual(droneVideoDimensions(9000, 9000), { width: 1920, height: 1080, frameRate: 30 });
  assert.deepEqual(droneVideoDimensions(1279, 719), { width: 1278, height: 718, frameRate: 30 });
  assert.equal(DRONE_VIDEO_DEFAULTS.maxDurationMs, 620000); assert.ok(DRONE_VIDEO_DEFAULTS.maxBytes <= 600 * 1024 * 1024);
});

test('container magic distinguishes MP4, WebM, corrupt bytes and QuickTime', async () => {
  assert.equal(await inspectDroneVideoContainer(mp4()), 'mp4'); assert.equal(await inspectDroneVideoContainer(webm()), 'webm');
  assert.equal(await inspectDroneVideoContainer(new Blob(['not a movie file at all'], { type: 'video/mp4' })), null);
  const qt = new Uint8Array(await mp4().arrayBuffer()); qt.set([113, 116, 32, 32], 8);
  assert.equal(await inspectDroneVideoContainer(new Blob([qt])), null);
});

test('render subscribers are canvas-isolated and release cleanly', () => {
  const a = {}, b = {}; let count = 0;
  const remove = subscribeDroneVideoFrame(a, () => count++);
  notifyDroneVideoFrame(b); assert.equal(count, 0); notifyDroneVideoFrame(a); assert.equal(count, 1);
  remove(); remove(); notifyDroneVideoFrame(a); assert.equal(count, 1);
});

test('native recorder captures composited frames only, stops idempotently and creates verified MP4', async () => {
  const r = rig(); const first = r.start(); const second = r.start(); assert.equal(first, second); await first;
  assert.equal(r.recorder.getState().phase, 'recording'); assert.equal(r.loadCalls, 0); assert.equal(r.draws.length, 0);
  r.frame(); r.tick(); assert.equal(r.streams[0].track.frames, 1); assert.equal(r.progress[0].frames, 1);
  assert.equal(r.recordings[0].config.videoBitsPerSecond, 4000000); assert.equal(r.recordings[0].slice, 1000);
  assert.equal(r.recordings[0].config.videoKeyFrameIntervalDuration, 1000);
  const stopping = r.recorder.stop(); assert.equal(stopping, r.recorder.stop()); const result = await stopping;
  assert.equal(result.extension, 'mp4'); assert.equal(result.mimeType.startsWith('video/mp4'), true); assert.equal(result.videoOnly, true);
  assert.equal(result.width, 1280); assert.equal(result.height, 720); assert.ok(result.durationMs > 0);
  assert.equal(r.recorder.getState().phase, 'ready'); assert.ok(r.streams.every(stream => stream.track.stopped));
  assert.equal(r.doc.listenerCount(), 0); assert.equal(r.canvas.listenerCount(), 0); assert.equal(r.intervals.size, 0); assert.equal(r.timers.size, 0);
  assert.equal((await r.recorder.stop()).url, result.url); await r.recorder.dispose(); assert.deepEqual(r.revoked, [result.url]);
});

test('fixed output letterboxes without cropping and caps synchronous sampling to 30 fps', async () => {
  const r = rig(); r.canvas.width = 390; r.canvas.height = 844; await r.start();
  r.frame(1); r.frame(1); r.frame(34);
  const draws = r.draws.filter(item => item[0] === 'draw'); assert.equal(draws.length, 2);
  assert.ok(draws[0][2] > 0); assert.equal(draws[0][3], 0); assert.equal(draws[0][5], 720);
  await r.recorder.cancel();
});

test('native requestFrame absence falls back to fixed 30 fps stream', async () => {
  const r = rig({ noRequestFrame: true }); await r.start(); assert.equal(r.streams.length, 2); assert.equal(r.streams[0].track.stopped, true); assert.equal(r.streams[1].rate, 30);
  await r.recorder.cancel(); assert.ok(r.streams.every(stream => stream.track.stopped));
});

test('WebCodecs rejects duplicate quantized PTS slots without advancing the audio clock', async () => {
  const r = rig({ support: () => false }); await r.start();
  // These intervals are accepted by the sampling tolerance but the second and
  // third frames would both map to 1/30s without a presentation-slot guard.
  for (const delta of [0, 32.9, 32.9, 34.2, 0, 0, 33.4]) { r.frame(delta); await flush(); }
  const times = r.bunnyCalls.filter(item => item[0] === 'add').map(item => item[1]);
  assert(times.every((time, i) => !i || time > times[i - 1]));
  assert.deepEqual(times, [0, 1/30, .1, 4/30]);
  await r.recorder.cancel();
});

test('WebCodecs fallback uses fragmented real MP4, no unbounded frame queue', async () => {
  let resolveFrame; const r = rig({ support: () => false, pendingAdd: () => new Promise(resolve => { resolveFrame = resolve; }) });
  await r.start({ width: 1920, height: 1080 }); assert.equal(r.recorder.getState().backend, 'webcodecs');
  r.frame(); r.frame(); r.frame(); assert.equal(r.bunnyCalls.filter(item => item[0] === 'add').length, 1);
  resolveFrame(); await flush(); r.frame(); resolveFrame(); await flush();
  const result = await r.recorder.stop(); assert.equal(result.extension, 'mp4'); assert.equal(result.backend, 'webcodecs');
  assert.equal(r.bunnyCalls.find(item => item[0] === 'output')[1].fastStart, 'fragmented');
  assert.equal(r.bunnyCalls.find(item => item[0] === 'source')[1].quality.value.bitrate, 6000000);
  assert.deepEqual(r.bunnyCalls.filter(item => item[0] === 'add').map(item => item[1]), [0, .13333333333333333]);
  await r.recorder.dispose();
});

test('native startup rejection can use MP4 WebCodecs rather than mislabeled WebM', async () => {
  const r = rig({ constructError: true }); await r.start(); assert.equal(r.recorder.getState().backend, 'webcodecs');
  r.frame(); await flush(); const result = await r.recorder.stop(); assert.equal(result.extension, 'mp4'); assert.ok(r.streams[0].track.stopped); await r.recorder.dispose();
});

test('native false MP4 claims fail byte validation instead of renaming WebM', async () => {
  const r = rig({ output: webm }); await r.start(); r.frame();
  await assert.rejects(r.recorder.stop(), error => error.code === 'FORMAT_MISMATCH'); assert.equal(r.recorder.getState().phase, 'error');
  await r.recorder.dispose();
});

test('explicit WebM records with webm MIME and extension, never implicit fallback', async () => {
  const r = rig({ support: type => type.startsWith('video/webm') }); await r.start({ format: 'webm' }); r.frame();
  const result = await r.recorder.stop(); assert.equal(result.extension, 'webm'); assert.ok(result.mimeType.startsWith('video/webm')); assert.equal(r.loadCalls, 0); await r.recorder.dispose();
});

test('native encoder failure cleans tracks, listeners and queued chunks', async () => {
  const r = rig(); await r.start(); r.frame(); r.recordings[0].error();
  assert.equal(r.recorder.getState().phase, 'error'); assert.equal(r.recorder.getState().error.code, 'ENCODER_ERROR');
  await assert.rejects(r.recorder.stop(), /编码失败/); assert.ok(r.streams[0].track.stopped); assert.equal(r.doc.listenerCount(), 0); await r.recorder.dispose();
});

test('WebCodecs asynchronous encoder failure is surfaced and cleaned', async () => {
  const r = rig({ support: () => false, addError: true }); await r.start(); r.frame(); await flush();
  assert.equal(r.recorder.getState().phase, 'error'); assert.equal(r.recorder.getState().error.code, 'ENCODER_ERROR'); await r.recorder.dispose();
});

test('visibility loss saves partial recording and stops immediately', async () => {
  const r = rig(); await r.start(); r.frame(); r.doc.hidden = true; r.doc.emit('visibilitychange'); await flush();
  assert.equal(r.recorder.getState().phase, 'ready'); assert.equal(r.recorder.getState().result.reason, 'page-hidden'); assert.ok(r.streams[0].track.stopped); await r.recorder.dispose();
});

test('WebGL context loss stops the recording without preventing host recovery', async () => {
  const r = rig(); await r.start(); r.frame(); r.canvas.emit('webglcontextlost'); await flush();
  assert.equal(r.recorder.getState().result.reason, 'context-lost'); await r.recorder.dispose();
});

test('maximum duration stops once and yields a playable container', async () => {
  const r = rig(); await r.start(); r.frame();
  const timer = [...r.timers.values()].find(item => item.delay === 620000); assert.ok(timer); timer.callback(); await flush();
  assert.equal(r.recorder.getState().result.reason, 'duration-limit'); await r.recorder.dispose();
});

test('maxBytes refuses an oversized chunk before retaining it', async () => {
  const r = rig({ maxBytes: 40 }); await r.start(); r.frame(); r.recordings[0].data(new Blob([new Uint8Array(41)]));
  assert.equal(r.recorder.getState().phase, 'error'); assert.equal(r.recorder.getState().error.code, 'SIZE_LIMIT'); assert.equal(r.recorder.getState().bytes, 0); await r.recorder.dispose();
});

test('cancel, dispose and repeated stop release everything without partial downloads', async () => {
  const r = rig(); await r.start(); r.frame(); await r.recorder.cancel(); assert.equal(r.recorder.getState().phase, 'idle');
  assert.equal(await r.recorder.stop(), null); assert.equal(r.doc.listenerCount(), 0); assert.ok(r.streams[0].track.stopped);
  await r.start(); r.frame(); const saved = await r.recorder.stop(); await r.start(); assert.deepEqual(r.revoked, [saved.url]);
  await r.recorder.dispose(); await r.recorder.dispose(); await assert.rejects(r.start(), error => error.code === 'DISPOSED');
});

test('disposing while backend initialization awaits cannot revive the recorder', async () => {
  let resume; const r = rig({ support: () => false, pendingStart: () => new Promise(resolve => { resume = resolve; }) });
  const starting = r.start(); await flush(); await r.recorder.dispose(); resume();
  await assert.rejects(starting); assert.equal(r.recorder.getState().phase, 'disposed'); assert.equal(r.doc.listenerCount(), 0); assert.equal(r.canvas.listenerCount(), 0);
});

test('empty, hidden and unsupported format attempts fail clearly', async () => {
  const r = rig(); await r.start(); await assert.rejects(r.recorder.stop(), error => error.code === 'EMPTY_RECORDING');
  r.doc.hidden = true; await assert.rejects(r.start(), error => error.code === 'PAGE_HIDDEN'); r.doc.hidden = false;
  await assert.rejects(r.start({ format: 'mov' }), error => error.code === 'INVALID_FORMAT'); await r.recorder.dispose();
});

test('capture errors are surfaced without leaving a render-loop exception', async () => {
  const r = rig(); r.target.getContext = () => ({ fillRect() {}, drawImage() { throw Object.assign(new Error('tainted'), { name: 'SecurityError' }); } });
  await r.start(); assert.doesNotThrow(() => r.frame()); assert.equal(r.recorder.getState().error.code, 'CAPTURE_ERROR'); await r.recorder.dispose();
});

test('source remains local, no device/screen capture, uploads, filename disguises or eager encoder import', () => {
  const source = fs.readFileSync(new URL('../src/lib/droneVideoRecorder.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /getDisplayMedia|getUserMedia|fetch\s*\(|XMLHttpRequest/);
  assert.match(source, /\(\) => import\('mediabunny'\)/); assert.match(source, /container !== run\.format/);
  assert.doesNotMatch(source, /requestAnimationFrame|preserveDrawingBuffer/);
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')); assert.equal(pkg.dependencies.mediabunny, '1.61.6');
  assert.match(fs.readFileSync(new URL('../public/licenses/mediabunny-NOTICE.txt', import.meta.url), 'utf8'), /1\.61\.6/);
  assert.match(fs.readFileSync(new URL('../public/licenses/mediabunny-MPL-2.0.txt', import.meta.url), 'utf8'), /Mozilla Public License Version 2\.0/);
});

test('optional soundtrack processing runs after video validation and marks the result with an audio track', async () => {
  const r = rig(); let received;
  await r.start({ processVideo: async (blob, options) => { received = options; return { blob, videoOnly: false, audioCodec: 'aac', audioDurationMs: 34 }; } });
  r.frame(); const result = await r.recorder.stop();
  assert.equal(result.videoOnly, false); assert.equal(result.audioCodec, 'aac'); assert.equal(result.audioDurationMs, 34);
  assert.equal(received.format, 'mp4'); assert.equal(received.signal.aborted, false); await r.recorder.dispose();
});

test('cancel during soundtrack processing aborts mux and cannot create a downloadable stale result', async () => {
  const r = rig(); let resume, signal;
  await r.start({ processVideo: (blob, options) => { signal = options.signal; return new Promise(resolve => { resume = () => resolve({ blob, videoOnly: false, audioCodec: 'aac' }); }); } });
  r.frame(); const finish = r.recorder.stop(); await flush(); assert.equal(r.recorder.getState().phase, 'processing');
  await r.recorder.cancel(); assert.equal(signal.aborted, true); resume(); assert.equal(await finish, null); assert.equal(r.recorder.getState().phase, 'idle');
  assert.equal(r.recorder.getState().result, null); await r.recorder.dispose();
});

test('soundtrack failure can be retained only as an explicitly labelled silent result', async () => {
  const r = rig(); await r.start({ processVideo: async blob => ({ blob, videoOnly: true, audioWarning: 'AAC unavailable' }) });
  r.frame(); const result = await r.recorder.stop(); assert.equal(result.videoOnly, true); assert.equal(result.audioWarning, 'AAC unavailable'); await r.recorder.dispose();
});
