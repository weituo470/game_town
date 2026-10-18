import { request as httpRequest } from 'node:http';
import { IMAGE_MODEL } from './prompts.js';
import { INPUT_BYTES, OUTPUT_BYTES } from './media.js';

export const GAME_IMAGE_BRIDGE_NAMESPACE = 'game-town-v1';
export const GAME_IMAGE_BRIDGE_PORT = '8794';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = Math.ceil(OUTPUT_BYTES / 3) * 4 + 4096;
const fail = () => Object.assign(new Error('Image outcome is not confirmed'), { code: 'OUTCOME_UNKNOWN' });

// An adapter only, NOT a deployed bridge. An isolated broker must explicitly
// implement this new namespace/port. It never calls the old wall broker.
export function createGameImageBridgeProvider({ url, token, timeoutMs = 1070_000, lookupTimeoutMs = 45_000 } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(target.hostname) || target.port !== GAME_IMAGE_BRIDGE_PORT
    || target.pathname !== '/v1/images/edits' || target.username || target.password || target.search || target.hash
    || typeof token !== 'string' || token.length < 32 || token.length > 2048 || /[\r\n]/.test(token)) throw new Error('Invalid isolated game image bridge configuration');
  function transfer(url, body, signal, deadlineMs) {
    return new Promise((resolve, reject) => {
      let request, response, settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        response?.destroy(); request?.destroy();
        if (error) reject(fail()); else resolve(result);
      };
      const abort = () => finish(true);
      const timer = setTimeout(abort, deadlineMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      try {
        request = httpRequest(url, { method: body ? 'POST' : 'GET', agent: false, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}) } }, incoming => {
          response = incoming;
          if (settled || incoming.statusCode !== 200 || !/^application\/json(?:;|$)/i.test(incoming.headers['content-type'] || '') || Number(incoming.headers['content-length']) > MAX_RESPONSE_BYTES) { finish(true); return; }
          const chunks = []; let size = 0;
          incoming.on('data', chunk => { size += chunk.length; if (size > MAX_RESPONSE_BYTES) finish(true); else if (!settled) chunks.push(chunk); });
          incoming.on('error', abort); incoming.on('aborted', abort);
          incoming.on('end', () => { if (settled) return; try { finish(false, JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)))); } catch { finish(true); } });
        });
        request.on('error', abort); request.end(body);
      } catch { finish(true); }
    });
  }
  const normalize = result => {
    if (!result || Object.keys(result).sort().join(',') !== 'data,mime,requestedModel,returnedModel' || typeof result.data !== 'string'
      || !['image/png', 'image/jpeg', 'image/webp'].includes(result.mime) || result.requestedModel !== IMAGE_MODEL
      || !['gpt-image-2.5-flare', 'gpt-image-2-codex', 'unreported'].includes(result.returnedModel)) throw fail();
    return result;
  };
  return {
    async generate({ requestId, input, prompt, signal }) {
      if (!UUID.test(requestId) || input?.mime !== 'image/png' || !Buffer.isBuffer(input.buffer) || input.buffer.length > INPUT_BYTES || typeof prompt !== 'string' || prompt.length > 3000) throw fail();
      // The broker schema remains exactly requestId/prompt/image; internal game
      // metadata is fixed/persisted by our app, never blindly sent upstream.
      const body = Buffer.from(JSON.stringify({ requestId, prompt, image: { mime: input.mime, data: input.buffer.toString('base64') } }));
      return normalize(await transfer(target, body, signal, Math.min(Math.max(timeoutMs, 1), 1070_000)));
    },
    async lookup({ requestId, signal }) {
      if (!UUID.test(requestId)) throw fail();
      const result = await transfer(new URL(`/v1/images/results/${requestId}`, target), undefined, signal, Math.min(Math.max(lookupTimeoutMs, 1), 45_000));
      if (result?.requestId !== requestId || !['succeeded', 'failed', 'unknown', 'not_found'].includes(result.state)) throw fail();
      return result.state === 'succeeded' ? { status: 'succeeded', result: normalize(result.result) } : { status: result.state };
    },
  };
}
