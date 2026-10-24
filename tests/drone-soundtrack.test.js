import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDroneSoundtrack } from '../src/lib/droneSoundtrack.js';
import { trimDroneSoundtrack, muxDroneSoundtrack, addDroneSoundtrackOrSilent } from '../src/lib/droneSoundtrackMux.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function surface(data = {}) { const listeners = new Map(); return { ...data, addEventListener(key, value) { listeners.set(key, value); }, removeEventListener(key) { listeners.delete(key); }, emit(key) { listeners.get(key)?.(); }, listeners }; }
function rig(play, settings = {}) {
  const doc = surface({ hidden: false }), frames = new Map(), status = [];
  const requests = [], blobs = [], revoked = [];
  const timeRef = { current: 0 }, state = { active: true, paused: false, ended: false, speed: 1 };
  let id = 0;
  const audio = surface({ paused: true, currentTime: 0, duration: 118, readyState: 4, plays: 0, pauses: 0, loads: 0, src: '',
    play() { this.plays++; this.paused = false; return play?.() || Promise.resolve(); }, pause() { this.pauses++; this.paused = true; }, load() { this.loads++; }, removeAttribute() { this.src = ''; } });
  const player = createDroneSoundtrack({ url: '/audio/whale-homecoming.mp3', timeRef, getState: () => state, onStatus: value => status.push(value), createAudio: () => audio, document: doc,
    fetchAudio: (url, options) => { requests.push({ url, options }); return settings.fetchAudio?.(url, options) || Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(['MP3'], { type: 'audio/mpeg' }) }); },
    URLApi: { createObjectURL: blob => { blobs.push(blob); return `blob:soundtrack-${blobs.length}`; }, revokeObjectURL: url => revoked.push(url) },
    requestFrame: callback => { const key = ++id; frames.set(key, callback); return key; }, cancelFrame: key => frames.delete(key) });
  return { player, audio, state, timeRef, doc, status, frames, requests, blobs, revoked };
}

test('HTTP 200 full-body audio becomes a single local seekable Blob instead of a range-dependent URL', async () => {
  const r = rig();
  assert.equal(r.status.at(-1).status, 'starting'); assert.equal(r.audio.plays, 0); assert.equal(r.audio.src, '');
  await flush(); assert.equal(r.audio.src, 'blob:soundtrack-1'); assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0].url, '/audio/whale-homecoming.mp3'); assert.equal(r.requests[0].options.credentials, 'same-origin');
  assert.equal(r.requests[0].options.headers, undefined, 'no Range required from the server');
  let position = 0;
  Object.defineProperty(r.audio, 'currentTime', { get: () => position, set: value => { position = r.audio.src.startsWith('blob:') ? value : 0; } });
  r.timeRef.current = 57000;
  for (let i = 0; i < 20; i++) r.player.sync();
  assert.equal(r.audio.currentTime, 57); assert.equal(r.requests.length, 1);
  r.player.setEnabled(false); r.player.setEnabled(true); await flush(); assert.equal(r.requests.length, 1);
  r.player.dispose(); assert.deepEqual(r.revoked, ['blob:soundtrack-1']); assert.equal(r.audio.listeners.size, 0);
});

test('disposal aborts an in-flight download and a late response cannot allocate a Blob or resume playback', async () => {
  const gate = deferred(), r = rig(undefined, { fetchAudio: () => gate.promise }); await flush();
  assert.equal(r.requests.length, 1); r.player.dispose(); assert.equal(r.requests[0].options.signal.aborted, true);
  gate.resolve({ ok: true, blob: async () => new Blob(['MP3']) }); await flush();
  assert.equal(r.blobs.length, 0); assert.equal(r.audio.plays, 0); assert.equal(r.audio.src, ''); assert.equal(r.frames.size, 0);
});

test('late body completion after disposal is discarded without leaking an object URL', async () => {
  const body = deferred(), r = rig(undefined, { fetchAudio: async () => ({ ok: true, blob: () => body.promise }) }); await flush();
  r.player.dispose(); body.resolve(new Blob(['MP3'])); await flush(); assert.equal(r.blobs.length, 0); assert.equal(r.audio.plays, 0);
});

test('download failure is visibly blocked, never loops, and explicit retry reuses one successful Blob', async () => {
  let count = 0;
  const r = rig(undefined, { fetchAudio: async () => ++count === 1 ? { ok: false, status: 503 } : { ok: true, status: 200, blob: async () => new Blob(['MP3']) } });
  await flush(); assert.equal(r.status.at(-1).status, 'blocked'); assert.match(r.status.at(-1).message, /下载失败/);
  for (let i = 0; i < 10; i++) r.player.sync(); await flush(); assert.equal(r.requests.length, 1);
  r.player.setEnabled(true); r.player.setEnabled(true); await flush(); assert.equal(r.requests.length, 2); assert.equal(r.blobs.length, 1); assert.equal(r.audio.plays, 1);
  r.player.dispose(); assert.equal(r.revoked.length, 1);
});

test('muting during download preserves silence on completion and unmute does not refetch', async () => {
  const gate = deferred(), r = rig(undefined, { fetchAudio: () => gate.promise }); await flush(); r.player.setEnabled(false);
  gate.resolve({ ok: true, blob: async () => new Blob(['MP3']) }); await flush();
  assert.equal(r.audio.plays, 0); assert.equal(r.status.at(-1).status, 'off');
  r.timeRef.current = 84000; r.player.setEnabled(true); await flush(); assert.equal(r.audio.currentTime, 84); assert.equal(r.audio.plays, 1); assert.equal(r.requests.length, 1); r.player.dispose();
});

test('metadata readiness triggers the latest seek rather than repeated writes before local audio is ready', async () => {
  const gate = deferred(), r = rig(undefined, { fetchAudio: () => gate.promise }); r.audio.readyState = 0; r.timeRef.current = 57000;
  await flush(); gate.resolve({ ok: true, blob: async () => new Blob(['MP3']) }); await flush(); assert.equal(r.audio.currentTime, 0);
  r.audio.readyState = 4; r.audio.emit('loadedmetadata'); assert.equal(r.audio.currentTime, 57); r.player.dispose();
});

test('soundtrack follows absolute seek, pause, speed and visibility without a second clock', async () => {
  const r = rig(); await flush(); assert.equal(r.audio.plays, 1); assert.equal(r.status.at(-1).status, 'on');
  r.timeRef.current = 52700; r.player.sync(); assert.equal(r.audio.currentTime, 52.7);
  r.state.speed = 2; r.player.sync(); assert.equal(r.audio.playbackRate, 2);
  r.state.paused = true; r.player.sync(); assert.equal(r.audio.paused, true);
  r.timeRef.current = 20000; r.player.sync(); assert.equal(r.audio.currentTime, 20);
  r.state.paused = false; r.player.sync(); await flush(); assert.equal(r.audio.paused, false);
  r.doc.hidden = true; r.doc.emit('visibilitychange'); assert.equal(r.audio.paused, true);
  r.timeRef.current = 85000; r.doc.hidden = false; r.doc.emit('visibilitychange'); await flush(); assert.equal(r.audio.currentTime, 85); assert.equal(r.audio.paused, false);
  r.state.ended = true; r.player.sync(); assert.equal(r.audio.paused, true);
  r.player.dispose(); assert.equal(r.frames.size, 0); assert.equal(r.doc.listeners.size, 0); assert.equal(r.audio.src, '');
});

test('autoplay rejection is visible and does not create an automatic retry loop', async () => {
  let attempts = 0; const r = rig(() => ++attempts === 1 ? Promise.reject(Object.assign(new Error('gesture'), { name: 'NotAllowedError' })) : Promise.resolve());
  await flush(); assert.equal(r.status.at(-1).status, 'blocked'); assert.match(r.status.at(-1).message, /点击/);
  for (let i = 0; i < 30; i++) r.player.sync(); await flush(); assert.equal(r.audio.plays, 1);
  r.player.setEnabled(true); await flush(); assert.equal(r.audio.plays, 2); assert.equal(r.status.at(-1).status, 'on');
  r.player.setEnabled(false); assert.equal(r.audio.paused, true); assert.equal(r.status.at(-1).status, 'off'); r.player.dispose();
});

test('natural audio end never restarts while the HUD completion snapshot is still stale', async () => {
  const r = rig(); await flush(); r.timeRef.current = 118000; r.audio.paused = true;
  r.player.sync(); await flush(); assert.equal(r.state.ended, false); assert.equal(r.audio.plays, 1);
  r.timeRef.current = 20000; r.player.sync(); await flush(); assert.equal(r.audio.plays, 2); r.player.dispose();
});

test('late play resolution cannot revive a disposed, muted or paused soundtrack', async () => {
  for (const stop of [r => r.player.dispose(), r => r.player.setEnabled(false), r => { r.state.paused = true; r.player.sync(); }]) {
    const gate = deferred(), r = rig(() => gate.promise); await flush(); stop(r); gate.resolve(); await flush();
    assert.equal(r.audio.paused, true); r.player.dispose();
  }
});

test('late rejected playback cannot overwrite a new muted state', async () => {
  const gate = deferred(), r = rig(() => gate.promise); await flush(); r.player.setEnabled(false); gate.reject(new Error('stale')); await flush();
  assert.equal(r.status.at(-1).status, 'off'); r.player.dispose();
});

function buffer({ length, numberOfChannels, sampleRate }) {
  const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  return { length, numberOfChannels, sampleRate, duration: length / sampleRate, getChannelData: channel => channels[channel] };
}
test('audio crop uses measured video duration, preserves stereo, fades partial cuts and pads only with silence', () => {
  const source = buffer({ length: 2000, numberOfChannels: 2, sampleRate: 1000 }); source.getChannelData(0).fill(.8); source.getChannelData(1).fill(.4);
  const cut = trimDroneSoundtrack(source, 1, buffer); assert.equal(cut.length, 1000); assert.equal(cut.numberOfChannels, 2); assert.ok(cut.getChannelData(0)[0] > .79); assert.ok(cut.getChannelData(1)[999] < .002);
  const padded = trimDroneSoundtrack(source, 2.5, buffer); assert.equal(padded.length, 2500); assert.equal(padded.getChannelData(0)[2100], 0);
  assert.throws(() => trimDroneSoundtrack(source, Infinity, buffer));
});

function muxRig(settings = {}) {
  const calls = [], target = { buffer: Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]).buffer };
  const track = { computeDuration: async () => 1.25, getCodec: async () => 'avc', getDecoderConfig: async () => ({ codec: 'avc1.42001e', codedWidth: 1280, codedHeight: 720 }) };
  const bunny = {
    ALL_FORMATS: [], canEncodeAudio: async (codec, options) => { calls.push(['support', codec, options]); return settings.supported !== false; },
    BlobSource: class {}, BufferTarget: class { constructor() { return target; } }, Mp4OutputFormat: class {}, WebMOutputFormat: class {}, Quality: class {},
    Input: class { async getPrimaryVideoTrack() { return track; } dispose() { calls.push(['dispose']); } },
    EncodedPacketSink: class { async *packets() { yield { timestamp: 0, duration: .5 }; yield { timestamp: .5, duration: .75 }; } },
    EncodedVideoPacketSource: class { async add(packet, meta) { calls.push(['video', packet, meta]); } close() { calls.push(['close-video']); } },
    AudioBufferSource: class { constructor(config) { calls.push(['audio-config', config]); } async add(value) { calls.push(['audio', value]); if (settings.audioGate) await settings.audioGate.promise; } close() { calls.push(['close-audio']); } },
    Output: class { constructor() { this.state = 'pending'; } addVideoTrack() {} addAudioTrack() { calls.push(['audio-track']); } async start() { this.state = 'started'; } async finalize() { this.state = 'finalized'; calls.push(['finalize']); } async cancel() { this.state = 'cancelled'; calls.push(['cancel']); } },
  };
  const options = { url: '/audio/whale-homecoming.mp3', loadMediabunny: async () => bunny, fetchAudio: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }), decodeAudio: async () => buffer({ length: 118000, numberOfChannels: 2, sampleRate: 1000 }), createBuffer: buffer };
  return { calls, options };
}

test('MP4 postmux adds AAC from zero, uses actual video duration and copies video without reencoding', async () => {
  const r = muxRig(); const result = await muxDroneSoundtrack(new Blob(['video']), r.options);
  assert.equal(result.videoOnly, false); assert.equal(result.audioCodec, 'aac'); assert.equal(result.audioDurationMs, 1250); assert.equal(result.blob.type, 'video/mp4');
  assert.equal(r.calls.find(item => item[0] === 'audio')[1].length, 1250);
  const video = r.calls.filter(item => item[0] === 'video'); assert.equal(video.length, 2); assert.ok(video[0][2].decoderConfig); assert.equal(video[1][2], undefined);
  assert.equal(r.calls.filter(item => item[0] === 'audio-track').length, 1); assert.ok(r.calls.some(item => item[0] === 'finalize'));
});

test('WebM explicitly chooses Opus, never AAC in a renamed container', async () => {
  const r = muxRig(); const result = await muxDroneSoundtrack(new Blob(['video']), { ...r.options, format: 'webm' });
  assert.equal(result.audioCodec, 'opus'); assert.equal(result.blob.type, 'video/webm');
});

test('unsupported audio is explicitly labelled silent and retains the original video', async () => {
  const r = muxRig({ supported: false }), blob = new Blob(['video']);
  const result = await addDroneSoundtrackOrSilent(blob, r.options);
  assert.equal(result.videoOnly, true); assert.equal(result.blob, blob); assert.match(result.audioWarning, /AAC/); assert.match(result.audioWarning, /无声/);
});

test('cancel during audio encoding aborts mux without a misleading silent-success fallback', async () => {
  const gate = deferred(), r = muxRig({ audioGate: gate }), abort = new AbortController();
  const promise = addDroneSoundtrackOrSilent(new Blob(['video']), { ...r.options, signal: abort.signal });
  await flush(); abort.abort(); gate.resolve(); await assert.rejects(promise, failure => failure.code === 'CANCELLED');
  assert.ok(r.calls.some(item => item[0] === 'cancel')); assert.ok(!r.calls.some(item => item[0] === 'finalize'));
});

test('soundtrack is lazy, same-origin only and never captures microphone, desktop or uploads', () => {
  const controls = fs.readFileSync(new URL('../src/components/drone/DroneShowControls.jsx', import.meta.url), 'utf8');
  assert.match(controls, /lazy\(\(\) => import\('\.\/DroneSoundtrackControl.jsx'\)\)/);
  assert.match(controls, /!program.soundtrackUrl && <button/);
  const source = fs.readFileSync(new URL('../src/lib/droneSoundtrackMux.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /getUserMedia|getDisplayMedia|method:\s*['"]POST/);
  assert.match(source, /fetchAudio\(droneAudioUrl\(url\)/); assert.match(source, /OfflineAudioContext/);
});
