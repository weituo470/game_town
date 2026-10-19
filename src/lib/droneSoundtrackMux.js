import { appUrl } from './appUrl.js';

const cancelled = () => Object.assign(new Error('配乐封装已取消。'), { code: 'CANCELLED' });
const check = signal => { if (signal?.aborted) throw cancelled(); };
const error = (code, message) => Object.assign(new Error(message), { code });

/** Crop/pad the original score to actual encoded video duration, not wall time. */
export function trimDroneSoundtrack(buffer, seconds, createBuffer = options => new AudioBuffer(options)) {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 620) throw error('INVALID_AUDIO_DURATION', '无法读取有效的视频时长。');
  const length = Math.max(1, Math.round(seconds * buffer.sampleRate));
  const output = createBuffer({ length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const target = output.getChannelData(channel), source = buffer.getChannelData(channel);
    target.set(source.subarray(0, Math.min(source.length, length)));
    // A manually stopped fragment should end gently, without a hard music cut.
    if (seconds < buffer.duration - .1) {
      const fade = Math.min(length, Math.round(buffer.sampleRate * .35));
      for (let i = 0; i < fade; i++) target[length - fade + i] *= 1 - i / fade;
    }
  }
  return output;
}

/** Pure local post-mux: retain encoded video, add only the authored score. */
export async function muxDroneSoundtrack(blob, { url, format = 'mp4', signal, loadMediabunny = () => import('mediabunny'),
  fetchAudio = (...args) => fetch(...args), decodeAudio, createBuffer } = {}) {
  check(signal);
  const bunny = await loadMediabunny(); check(signal);
  const codec = format === 'webm' ? 'opus' : 'aac';
  if (!await bunny.canEncodeAudio(codec, { numberOfChannels: 2, sampleRate: 48000, bitrate: 192000 })) {
    throw error('AUDIO_CODEC_UNSUPPORTED', `此浏览器不能编码 ${codec.toUpperCase()} 配乐音轨。请用最新版 Chrome / Edge 重试；当前可保留无声视频。`);
  }
  check(signal);
  const response = await fetchAudio(appUrl(url), { signal, credentials: 'same-origin' });
  if (!response.ok) throw error('AUDIO_FETCH_FAILED', '配乐文件未能载入，当前可保留无声视频。');
  const bytes = await response.arrayBuffer(); check(signal);
  const decode = decodeAudio || (data => {
    const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!Offline) throw error('AUDIO_DECODE_UNSUPPORTED', '浏览器不能离线解码配乐，当前可保留无声视频。');
    return new Offline(2, 1, 48000).decodeAudioData(data);
  });
  const decoded = await decode(bytes); check(signal);
  let input, output;
  const abort = () => { void output?.cancel().catch(() => {}); input?.dispose(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    input = new bunny.Input({ formats: bunny.ALL_FORMATS, source: new bunny.BlobSource(blob) });
    const track = await input.getPrimaryVideoTrack(); check(signal);
    if (!track) throw error('NO_VIDEO_TRACK', '视频没有可封装的画面轨道。');
    const duration = await track.computeDuration(); check(signal);
    const audio = trimDroneSoundtrack(decoded, duration, createBuffer);
    const videoCodec = await track.getCodec(), decoderConfig = await track.getDecoderConfig(); check(signal);
    if (!videoCodec || !decoderConfig) throw error('VIDEO_CONFIG_MISSING', '无法读取视频编码信息，当前可保留无声视频。');
    const target = new bunny.BufferTarget();
    output = new bunny.Output({ format: format === 'webm' ? new bunny.WebMOutputFormat() : new bunny.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const videoSource = new bunny.EncodedVideoPacketSource(videoCodec);
    const audioSource = new bunny.AudioBufferSource({ codec, quality: new bunny.Quality({ bitrate: 192000 }) });
    output.addVideoTrack(videoSource);
    output.addAudioTrack(audioSource);
    await output.start(); check(signal);
    await Promise.all([
      (async () => {
        let first = true;
        for await (const packet of new bunny.EncodedPacketSink(track).packets()) {
          check(signal); await videoSource.add(packet, first ? { decoderConfig } : undefined); first = false;
        }
        check(signal); videoSource.close();
      })(),
      (async () => { await audioSource.add(audio); check(signal); audioSource.close(); })(),
    ]);
    check(signal); await output.finalize(); check(signal);
    if (!target.buffer?.byteLength) throw error('EMPTY_AUDIO_MUX', '配乐视频封装结果为空。');
    return { blob: new Blob([target.buffer], { type: `video/${format}` }), videoOnly: false, audioCodec: codec, audioDurationMs: duration * 1000 };
  } catch (failure) {
    if (output?.state !== 'finalized') { try { await output?.cancel(); } catch { /* preserve original failure */ } }
    check(signal); throw failure;
  } finally { signal?.removeEventListener('abort', abort); input?.dispose(); }
}

/** Preserve a clearly labelled silent copy if the browser cannot encode audio. */
export async function addDroneSoundtrackOrSilent(blob, options) {
  try { return await muxDroneSoundtrack(blob, options); }
  catch (failure) {
    if (options.signal?.aborted || failure.code === 'CANCELLED') throw cancelled();
    return { blob, videoOnly: true, audioWarning: failure.message || '配乐封装失败，当前文件只有画面。' };
  }
}
