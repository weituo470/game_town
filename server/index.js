import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { staticCacheControl } from './staticCache.js';
import { networkInterfaces } from 'node:os';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { createGuestIdentity, createRateLimiter, cleanName } from './identity.js';
import { createNpcDailyLimiter } from './npcUsageLimits.js';
import { getRequestClientIp } from './requestClientIp.js';
import { makeTownRoom } from './TownRoom.js';
import { createReconnectDiagnostics } from './reconnectDiagnostics.js';
import { loadNpcLlmConfig } from './npcLlmConfig.js';
import { createNpcChatService } from './npcChat.js';
import { createAiDroneDirector, loadAiDroneConfig, AiDroneDirectorError } from './aiDroneDirector.js';
import { createArchitectService } from './architect/service.js';
import { loadArchitectConfig } from './architect/config.js';
import { ArchitectError } from './architect/errors.js';
import { loadNpcTtsConfig } from './npcTtsConfig.js';
import { createNpcSpeechService } from './npcSpeech.js';
import { loadGameImageConfig, createGameImageModule } from './gameImages/index.js';
import { loadGameCharacterConfig } from './gameCharacters/config.js';
import { createGameCharacterModule } from './gameCharacters/index.js';
import { PROTOCOL_VERSION, MAX_PLAYERS, TOWN_ROOM_TYPE } from '../shared/protocol.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const json = (res, status, value) => {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.json': 'application/json; charset=utf-8' };

async function serveStatic(path, req, res) {
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { throw fail(400, 'INVALID_PATH', '无效路径。'); }
  if (decoded.includes('\\') || decoded.includes('\0')) throw fail(400, 'INVALID_PATH', '无效路径。');
  let filename = resolve(DIST, `.${decoded}`);
  if (!filename.startsWith(resolve(DIST) + sep) && filename !== resolve(DIST)) throw fail(403, 'INVALID_PATH', '禁止访问此路径。');
  let info = await stat(filename).catch(() => null);
  if (!info?.isFile() && !extname(decoded)) {
    filename = resolve(DIST, 'index.html');
    info = await stat(filename).catch(() => null);
  }
  if (!info?.isFile()) throw fail(404, 'STATIC_NOT_FOUND', '未找到页面。首次运行请先执行 npm run build。');
  const [realRoot, realFile] = await Promise.all([realpath(DIST), realpath(filename)]);
  if (!realFile.startsWith(realRoot + sep)) throw fail(403, 'INVALID_PATH', '禁止访问此路径。');
  filename = realFile;
  res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(filename)] || 'application/octet-stream', 'content-length': info.size, 'cache-control': staticCacheControl(filename) });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(filename).on('error', () => res.destroy()).pipe(res);
}

async function readJson(req, maxBytes = 4096) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415, 'JSON_REQUIRED', '请使用 JSON 请求。');
  if (Number(req.headers['content-length']) > maxBytes) { req.resume(); throw fail(413, 'BODY_TOO_LARGE', '请求内容过大。'); }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw fail(413, 'BODY_TOO_LARGE', '请求内容过大。');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw fail(400, 'INVALID_JSON', '请求格式不正确。'); }
}

export async function createTownServer({
  port = Number(process.env.PORT || 2567), host = process.env.HOST || '127.0.0.1',
  secret = process.env.GUEST_SECRET || undefined,
  trustProxyLoopback = process.env.TRUST_PROXY_LOOPBACK === 'true',
  allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173').split(',').map(value => value.trim()).filter(Boolean),
  reconnectSeconds, maxRooms = 32,
  npcConfig = loadNpcLlmConfig(), npcFetch = globalThis.fetch,
  aiDroneConfig = loadAiDroneConfig(), aiDroneFetch = globalThis.fetch, aiDroneStore, aiDroneNow,
  architectConfig = loadArchitectConfig({ npcConfig }), architectFetch = globalThis.fetch, architectStore, architectNow, architectSchedule = true,
  npcSpeechConfig = loadNpcTtsConfig(), npcSpeechFetch = globalThis.fetch,
  gameImageConfig = loadGameImageConfig(), gameImageProvider,
  gameCharacterConfig = loadGameCharacterConfig(), gameCharacterProvider,
} = {}) {
  const roomCodes = new Map();
  const diagnostic = createReconnectDiagnostics();
  const identity = createGuestIdentity({ secret });
  const requests = createRateLimiter({ limit: 120, windowMs: 60_000 });
  const creates = createRateLimiter({ limit: 12, windowMs: 60_000 });
  const npcChats = createNpcChatService({ config: npcConfig, fetchImpl: npcFetch });
  const aiDroneDirector = createAiDroneDirector({ config: aiDroneConfig, fetchImpl: aiDroneFetch, store: aiDroneStore, ...(aiDroneNow ? { now: aiDroneNow } : {}) });
  const architect = createArchitectService({ config: architectConfig, fetchImpl: architectFetch, store: architectStore, schedule: false, ...(architectNow ? { now: architectNow } : {}) });
  const npcSpeech = createNpcSpeechService({ config: npcSpeechConfig, fetchImpl: npcSpeechFetch, resolveReply: input => npcChats.getReplyForSpeech(input) });
  // Open private stores only when the character workshop is used. Both stages
  // share one authenticated cookie identity, never a browser-supplied owner ID.
  let imagesPromise, charactersPromise;
  const getImages = () => imagesPromise ??= createGameImageModule({ config: gameImageConfig, provider: gameImageProvider });
  const getCharacters = () => charactersPromise ??= (async () => createGameCharacterModule({
    config: gameCharacterConfig, provider: gameCharacterProvider, images: await getImages(),
  }))();
  const npcIpLimit = createRateLimiter({ limit: 30, windowMs: 60_000 });
  const npcGuestLimit = createRateLimiter({ limit: 12, windowMs: 60_000 });
  const npcBudget = createNpcDailyLimiter({ configuredLimit: process.env.NPC_LLM_DAILY_LIMIT });
  const speechIpLimit = createRateLimiter({ limit: 30, windowMs: 60_000 });
  const speechGuestLimit = createRateLimiter({ limit: 12, windowMs: 60_000 });
  const speechBudget = createNpcDailyLimiter({ configuredLimit: process.env.NPC_TTS_DAILY_LIMIT });
  // LAN binding must not make an arbitrary DNS name a trusted Origin. Additional
  // domains (for a later HTTPS reverse proxy) must be explicitly configured.
  const sameOriginHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (host === '0.0.0.0' || host === '::') {
    for (const item of Object.values(networkInterfaces()).flat()) {
      if (item) sameOriginHosts.add(item.family === 'IPv6' ? `[${item.address}]` : item.address);
    }
  } else sameOriginHosts.add(host);
  const originAllowed = (origin, authority) => {
    if (!origin || allowedOrigins.includes(origin)) return true;
    if (!authority || origin !== `http://${authority}`) return false;
    try { return sameOriginHosts.has(new URL(origin).hostname); } catch { return false; }
  };
  const httpServer = createServer();
  httpServer.requestTimeout = 10_000;
  httpServer.headersTimeout = 10_000;
  const transport = new WebSocketTransport({
    server: httpServer, maxPayload: 4096, pingInterval: 3000, pingMaxRetries: 2,
    verifyClient: (info, done) => done(originAllowed(info.origin, info.req.headers.host), 403, 'Origin not allowed'),
  });
  const gameServer = new Server({ transport, greet: false, gracefullyShutdown: false });
  gameServer.define(TOWN_ROOM_TYPE, makeTownRoom({ identity, roomCodes, reconnectSeconds }));
  await gameServer.listen(port, host);
  if (architectSchedule) architect.start();

  // Colyseus owns its routes. Dispatch to them only after our origin/rate gate;
  // disallow public create/join APIs so clients cannot bypass invite validation.
  const frameworkHandlers = httpServer.listeners('request');
  httpServer.removeAllListeners('request');
  httpServer.on('request', async (req, res) => {
    try {
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      const origin = req.headers.origin;
      if (!originAllowed(origin, req.headers.host)) throw fail(403, 'ORIGIN_DENIED', '此页面来源尚未获准连接。');
      res.setHeader('x-content-type-options', 'nosniff');
      if (origin) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin'); }
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
      res.setHeader('access-control-allow-headers', 'Content-Type,Authorization,Idempotency-Key');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (path === '/api/health' && req.method === 'GET') {
        json(res, 200, { ok: true, service: 'game-town', protocolVersion: PROTOCOL_VERSION, maxPlayers: MAX_PLAYERS, rooms: roomCodes.size, credentialPersistence: secret ? 'configured-secret' : 'process-lifetime' }); return;
      }
      if (['GET', 'HEAD'].includes(req.method) && !path.startsWith('/api/') && !path.startsWith('/matchmake/')) { await serveStatic(path, req, res); return; }
      const ip = getRequestClientIp(req, { trustProxyLoopback });
      if (!requests.take(ip)) throw fail(429, 'RATE_LIMITED', '请求太频繁，请稍后重试。');
      if (path === '/api/architect/status' && req.method === 'GET') {
        try { json(res, 200, architect.status()); }
        catch { json(res, 503, { error: '工程账本暂时不可用。', code: 'ARCHITECT_STORAGE' }); }
        return;
      }
      if (path === '/api/architect/generate' && req.method === 'POST') {
        try {
          const body = await readJson(req, 8192);
          const guest = identity.verify(body.token);
          if (!guest) throw fail(401, 'GUEST_EXPIRED', '建筑审批身份已过期，请重新连接。');
          // A disconnected browser does not undo a claimed engineering request.
          // The same immutable key retrieves its result without another paid call.
          const result = await architect.generate({ guestId: guest.guestId, idempotencyKey: body.idempotencyKey,
            brief: body.brief, password: body.password, ip });
          json(res, 200, result);
        } catch (error) {
          if (error instanceof ArchitectError || (typeof error.code === 'string' && [400, 401, 413, 415].includes(error.status)))
            json(res, error.status, { error: error.message, message: error.message, code: error.code });
          else json(res, 503, { error: '建筑师暂时不可用，未进行建设。', code: 'ARCHITECT_UNAVAILABLE' });
        }
        return;
      }
      if (path === '/api/drone-director/status' && req.method === 'GET') { json(res, 200, aiDroneDirector.status()); return; }
      if (['/api/drone-director/generate', '/api/drone-director/usage'].includes(path) && req.method === 'POST') {
        try {
          const body = await readJson(req, 8192);
          const guest = identity.verify(body.token);
          if (!guest) throw fail(401, 'GUEST_EXPIRED', '编导身份已过期，请重新连接。');
          if (path.endsWith('/usage')) { json(res, 200, aiDroneDirector.usage(guest.guestId)); return; }
          const controller = new AbortController();
          const disconnected = () => { if (!res.writableEnded) controller.abort(); };
          res.once('close', disconnected);
          try {
            const result = await aiDroneDirector.generate({ guestId: guest.guestId, requestId: body.requestId, mode: body.mode, prompt: body.prompt, accessPassword: body.accessPassword, ip, signal: controller.signal });
            json(res, 200, result);
          } finally { res.removeListener('close', disconnected); }
        } catch (error) {
          if (error instanceof AiDroneDirectorError) {
            json(res, error.status, { error: error.message, code: error.code, charged: error.charged, replayed: error.replayed, ...(error.usage ? { usage: error.usage } : {}) });
          } else if (typeof error.code === 'string' && [400, 401, 413, 415].includes(error.status)) {
            json(res, error.status, { error: error.message, code: error.code, charged: false, replayed: false });
          } else json(res, 503, { error: 'AI 编导暂时不可用，请稍后再试。', code: 'AI_DRONE_UNAVAILABLE', charged: false, replayed: false });
        }
        return;
      }
      if (/^\/api\/game-(?:images|characters)(?:\/|$)/.test(path)) {
        try {
          const module = path.startsWith('/api/game-images') ? await getImages() : await getCharacters();
          await module.handle(req, res, { originAllowed: typeof origin === 'string' && originAllowed(origin, req.headers.host) });
        } catch {
          // Storage/provider initialization errors can contain private paths.
          json(res, 503, { error: '人物工坊暂时不可用，请稍后重试。', code: 'CHARACTER_WORKSHOP_UNAVAILABLE' });
        }
        return;
      }
      if (path === '/api/npc/speech/status' && req.method === 'GET') {
        const npcId = new URL(req.url, 'http://localhost').searchParams.get('npcId');
        json(res, 200, npcSpeech.status(npcId === null ? undefined : npcId)); return;
      }
      if (['/api/npc/speech', '/api/npc/speech/greeting'].includes(path) && req.method === 'POST') {
        const body = await readJson(req, 4096);
        const guest = identity.verify(body.token);
        if (!guest) throw fail(401, 'GUEST_EXPIRED', '聊天身份已过期，请重新连接对话。');
        if (!speechIpLimit.take(ip) || !speechGuestLimit.take(guest.guestId) || !speechBudget.take('npc-speech')) throw fail(429, 'NPC_SPEECH_RATE_LIMITED', '播报请求较多，请稍后再试。');
        const controller = new AbortController();
        const disconnected = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', disconnected);
        try {
          // Resolve only this guest's completed NPC reply; browser text/voice/URLs
          // never control the provider request or turn this into an open TTS proxy.
          const spoken = path === '/api/npc/speech/greeting'
            ? await npcSpeech.greeting({ guestId: guest.guestId, npcId: body.npcId, signal: controller.signal })
            : await npcSpeech.synthesize({ guestId: guest.guestId, npcId: body.npcId, conversationId: body.conversationId, requestId: body.requestId, signal: controller.signal });
          if (!res.destroyed && !res.writableEnded) {
            res.writeHead(200, { 'content-type': spoken.contentType, 'content-length': spoken.audio.length, 'cache-control': 'no-store' });
            res.end(spoken.audio);
          }
        } finally { res.removeListener('close', disconnected); }
        return;
      }
      if (path === '/api/npc/chat/status' && req.method === 'GET') { json(res, 200, npcChats.status()); return; }
      if (path === '/api/npc/chat' && req.method === 'POST') {
        const body = await readJson(req, 8192);
        const guest = identity.verify(body.token);
        if (!guest) throw fail(401, 'GUEST_EXPIRED', '对话凭据已过期，请重新打开居民册。');
        if (!npcIpLimit.take(ip) || !npcGuestLimit.take(guest.guestId) || !npcBudget.take('npc-chat')) throw fail(429, 'NPC_RATE_LIMITED', '聊得有点快，请稍后再来找居民。');
        const controller = new AbortController();
        const disconnected = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', disconnected);
        try {
          const reply = await npcChats.chat({ guestId: guest.guestId, npcId: body.npcId, message: body.message, conversationId: body.conversationId, requestId: body.requestId, signal: controller.signal });
          if (!res.destroyed) json(res, 200, reply);
        } finally { res.removeListener('close', disconnected); }
        return;
      }
      if (path.startsWith('/matchmake/reconnect/') && req.method === 'POST') {
        const roomId = path.split('/')[3];
        const startedAt = Date.now();
        const room = roomId && matchMaker.getLocalRoomById(roomId);
        diagnostic('http.reconnect.request', { roomId, roomExists: !!room, connectedClients: room?.clients.length, players: room?.state.players.size });
        res.once('finish', () => {
          const currentRoom = roomId && matchMaker.getLocalRoomById(roomId);
          diagnostic('http.reconnect.response', { roomId, roomExists: !!currentRoom, status: res.statusCode, durationMs: Date.now() - startedAt, connectedClients: currentRoom?.clients.length, players: currentRoom?.state.players.size });
        });
        for (const handler of frameworkHandlers) handler.call(httpServer, req, res);
        return;
      }
      if (path.startsWith('/matchmake/')) throw fail(403, 'USE_TOWN_API', '请通过小镇邀请码入口加入。');
      if (req.method !== 'POST' || !['/api/guest', '/api/towns', '/api/towns/join'].includes(path)) throw fail(404, 'NOT_FOUND', '没有此接口。');
      const body = await readJson(req);
      if (path === '/api/guest') { json(res, 200, identity.issue(body)); return; }
      if (body.protocolVersion !== PROTOCOL_VERSION) throw fail(400, 'PROTOCOL_MISMATCH', '协议版本不同，请刷新页面。');
      const guest = identity.verify(body.token);
      if (!guest) throw fail(401, 'GUEST_EXPIRED', '游客凭据已失效，请重新连接。');
      const options = { token: body.token, name: cleanName(body.name), protocolVersion: PROTOCOL_VERSION };
      let code, reservation;
      if (path === '/api/towns') {
        if (!creates.take(ip)) throw fail(429, 'CREATE_RATE_LIMITED', '创建太频繁，请稍后重试。');
        if (roomCodes.size >= maxRooms) throw fail(503, 'SERVER_BUSY', '当前小镇数量已满，请稍后重试。');
        do { code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(''); } while (roomCodes.has(code));
        reservation = await matchMaker.create(TOWN_ROOM_TYPE, { ...options, code });
      } else {
        code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw fail(400, 'INVALID_CODE', '请输入 6 位小镇邀请码。');
        const roomId = roomCodes.get(code);
        const room = roomId && matchMaker.getLocalRoomById(roomId);
        if (!room) throw fail(404, 'TOWN_NOT_FOUND', '邀请码不存在或小镇已关闭。');
        if ([...room.state.players.values()].some(player => player.guestId === guest.guestId)) throw fail(409, 'ALREADY_JOINED', '该游客已在房间内，请返回原标签页或等待重连结束。');
        if (room.hasReachedMaxClients()) throw fail(409, 'TOWN_FULL', '小镇已满员（最多 8 人，掉线席位短暂保留）。');
        reservation = await matchMaker.joinById(roomId, options);
      }
      json(res, 200, { reservation, code });
    } catch (error) {
      const status = error.status || (error.code >= 400 && error.code <= 599 ? error.code : 400);
      json(res, status, { error: error.message || '连接失败，请重试。', code: typeof error.code === 'string' ? error.code : 'JOIN_FAILED' });
    }
  });

  const address = httpServer.address();
  let stopped = false;
  return {
    port: address.port, host, url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`,
    httpServer, gameServer,
    async close() {
      if (stopped) return;
      stopped = true;
      npcSpeech.close();
      npcChats.close();
      await aiDroneDirector.close();
      await architect.close();
      if (charactersPromise) await charactersPromise.then(module => module.close()).catch(() => {});
      if (imagesPromise) await imagesPromise.then(module => module.close()).catch(() => {});
      await gameServer.gracefullyShutdown(false);
      httpServer.closeAllConnections();
      requests.clear(); creates.clear(); roomCodes.clear();
      npcIpLimit.clear(); npcGuestLimit.clear(); npcBudget.clear();
      speechIpLimit.clear(); speechGuestLimit.clear(); speechBudget.clear();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await createTownServer();
  console.log(`Game Town realtime server: ${server.url} (protocol ${PROTOCOL_VERSION}; max ${MAX_PLAYERS} players)`);
  if (!process.env.GUEST_SECRET) console.log('Guest credentials expire on server restart; set GUEST_SECRET (at least 32 bytes) for stable signatures.');
  const shutdown = async () => { await server.close(); process.exitCode = 0; };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
