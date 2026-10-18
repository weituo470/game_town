import { CHARACTER_MODEL } from './config.js';

const API = 'https://api.meshy.ai/openapi/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED']);
const JSON_LIMIT = 256 * 1024;
const MODEL_LIMIT = 20 * 1024 * 1024;

export class MeshyProviderError extends Error {
  constructor(code = 'outcome_unknown') { super('3D 服务暂时未完成请求。'); this.name = 'MeshyProviderError'; this.code = code; }
}
const safeError = code => new MeshyProviderError(code);
export function validateMeshyAssetUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw safeError('invalid_response');
  let url;
  try { url = new URL(value); } catch { throw safeError('invalid_response'); }
  if (url.protocol !== 'https:' || url.hostname !== 'assets.meshy.ai' || url.port || url.username || url.password || url.hash || !url.pathname.toLowerCase().endsWith('.glb')) throw safeError('invalid_response');
  return url.href;
}

// No SDK retries: create responses may be lost after a charge. The durable
// service owns the at-most-once dispatch marker; only task GETs can be resumed.
export function createMeshyProvider({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 30_000, downloadTimeoutMs = 60_000 } = {}) {
  if (typeof apiKey !== 'string' || apiKey.length < 16 || apiKey.length > 2048 || /[\s\u0000-\u001f]/.test(apiKey)) throw safeError('invalid_config');
  async function transfer(url, { body, signal, media = false } = {}) {
    const controller = new AbortController();
    let timedOut = false, reader;
    let rejectStopped;
    const stopped = new Promise((_, reject) => { rejectStopped = reject; });
    const abort = () => { controller.abort(); rejectStopped(safeError('outcome_unknown')); };
    if (signal?.aborted) throw safeError('outcome_unknown');
    signal?.addEventListener('abort', abort, { once: true });
    const ms = media ? downloadTimeoutMs : timeoutMs;
    const timer = setTimeout(() => { timedOut = true; abort(); }, Math.max(1, Math.min(ms, media ? 90_000 : 45_000)));
    const guard = promise => Promise.race([promise, stopped]);
    try {
      const response = await guard(fetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: controller.signal,
        headers: media ? { Accept: 'model/gltf-binary, application/octet-stream' } : { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }));
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        // No provider body/message is retained or returned. A POST error is
        // deliberately not classified as safe to repeat.
        throw safeError(body !== undefined ? 'outcome_unknown' : 'provider_unavailable');
      }
      const limit = media ? MODEL_LIMIT : JSON_LIMIT;
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if ((!media && mime !== 'application/json') || (media && !['model/gltf-binary', 'application/octet-stream', 'binary/octet-stream'].includes(mime)) || Number(response.headers.get('content-length')) > limit || !response.body?.getReader) {
        void response.body?.cancel().catch(() => {}); throw safeError('invalid_response');
      }
      reader = response.body.getReader();
      const chunks = []; let size = 0;
      for (;;) {
        const part = await guard(reader.read());
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) throw safeError('invalid_response');
        chunks.push(Buffer.from(part.value));
      }
      if (!size) throw safeError('invalid_response');
      const bytes = Buffer.concat(chunks);
      if (media) return bytes;
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw safeError('invalid_response'); }
    } catch (error) {
      if (reader) void reader.cancel().catch(() => {});
      throw error instanceof MeshyProviderError ? error : safeError(timedOut ? 'outcome_unknown' : 'provider_unavailable');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      reader?.releaseLock();
    }
  }
  const id = value => { if (typeof value !== 'string' || !UUID.test(value)) throw safeError('invalid_response'); return value; };
  function task(value, taskId) {
    if (!value || value.id !== taskId || !STATUSES.has(value.status) || !Number.isFinite(value.progress) || value.progress < 0 || value.progress > 100) throw safeError('invalid_response');
    return { status: value.status, progress: value.progress, ...(Number.isSafeInteger(value.consumed_credits) && value.consumed_credits >= 0 ? { consumedCredits: value.consumed_credits } : {}) };
  }
  return Object.freeze({
    async createModel({ image, signal }) {
      if (!image || !Buffer.isBuffer(image.buffer) || !image.buffer.length || image.buffer.length > 8 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mime)) throw safeError('invalid_input');
      const value = await transfer(`${API}/image-to-3d`, { signal, body: {
        image_url: `data:${image.mime};base64,${image.buffer.toString('base64')}`,
        model_type: 'smart-topology', ai_model: CHARACTER_MODEL, target_polycount: 8000,
        topology: 'triangle', should_texture: true, texture_resolution: '2k', enable_pbr: false,
        pose_mode: 'a-pose', target_formats: ['glb'], moderation: true,
      } });
      return { taskId: id(value?.result) };
    },
    async getModel({ taskId, signal }) {
      const value = await transfer(`${API}/image-to-3d/${id(taskId)}`, { signal });
      return task(value, taskId);
    },
    async createRig({ taskId, signal }) {
      const value = await transfer(`${API}/rigging`, { signal, body: { input_task_id: id(taskId), height_meters: 2.1 } });
      return { taskId: id(value?.result) };
    },
    async getRig({ taskId, signal }) {
      const value = await transfer(`${API}/rigging/${id(taskId)}`, { signal });
      const result = task(value, taskId);
      if (value.status === 'SUCCEEDED') {
        result.modelUrl = validateMeshyAssetUrl(value.result?.rigged_character_glb_url);
        result.walkingUrl = validateMeshyAssetUrl(value.result?.basic_animations?.walking_glb_url);
      }
      return result;
    },
    async download({ url, signal }) { return transfer(validateMeshyAssetUrl(url), { signal, media: true }); },
  });
}
