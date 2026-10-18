import { useCallback, useEffect, useRef, useState } from 'react';
import { Client } from '@colyseus/sdk';
import { PROTOCOL_VERSION, RECONNECT_SECONDS, MESSAGE } from '../../shared/protocol.js';

const GUEST_KEY = 'game-town.guest.v1';
const ROOM_KEY = 'game-town.room.v1';
const EMPTY_SNAPSHOT = { players: [], selfId: '', tick: 0, serverTime: 0, receivedAtPerf: 0 };
const navigationSuspendedRooms = new WeakSet();

export function multiplayerEndpoint(configured, origin) {
  const value = configured?.trim() || origin;
  let url;
  try { url = new URL(value); } catch { throw new Error('联机服务地址配置有误，请联系演示负责人。你仍可单人探索。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('联机服务必须配置为有效的 HTTP 或 HTTPS 地址。');
  }
  if (origin?.startsWith('https:') && url.protocol !== 'https:') throw new Error('安全网页不能连接未加密的联机服务，请使用 HTTPS 服务地址。');
  return url.href.replace(/\/+$/, '');
}

export function invitationCode(search = '') {
  const code = new URLSearchParams(search).get('town')?.trim().toUpperCase() || '';
  return /^[A-Z0-9]{6}$/.test(code) ? code : '';
}

export function urlForTown(href, code) {
  if (!/^[A-Z0-9]{6}$/.test(code || '')) return href;
  const url = new URL(href);
  url.searchParams.set('town', code);
  return url.href;
}

function canceledRecovery() { return Object.assign(new Error('Room recovery canceled'), { name: 'AbortError' }); }

function waitForRecovery(ms, signal) {
  if (signal?.aborted) return Promise.reject(canceledRecovery());
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(canceledRecovery()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// A refreshed HTTP request can arrive after the old socket was removed but
// before onDrop has registered allowReconnection. Installed core maps this to
// 524. Only that ambiguous error gets three bounded retries (1.05s total wait).
export async function reconnectWithGrace(attempt, { signal, isCurrent = () => true, wait = waitForRecovery } = {}) {
  const delays = [150, 300, 600];
  for (let retry = 0; ; retry += 1) {
    if (signal?.aborted || !isCurrent()) throw canceledRecovery();
    try { return await attempt(); }
    catch (failure) {
      if (signal?.aborted || !isCurrent()) throw canceledRecovery();
      if (Number(failure?.code) !== 524 || retry >= delays.length) throw failure;
      await wait(delays[retry], signal);
    }
  }
}

// Log the actual SDK error category, never Error objects, URLs, or credentials.
export function recoveryDiagnostic(failure) {
  const code = Number(failure?.code);
  const reasons = {
    522: 'room disposed or not found',
    523: 'matchmaking request rejected',
    524: 'reconnection token invalid, expired, or not registered yet',
    525: 'authentication failed',
  };
  return {
    code: Number.isFinite(code) ? code : 'unknown',
    reason: failure?.name === 'AbortError' ? 'recovery aborted or timed out' : reasons[code] || 'network or unexpected SDK recovery failure',
  };
}

export function snapshotFromState(state, selfId) {
  const players = [];
  state?.players?.forEach((player, id) => {
    if (!Number.isFinite(player.x) || !Number.isFinite(player.z)) return;
    players.push({
      id: String(id), guestId: player.guestId, name: player.name,
      x: player.x, z: player.z, yaw: Number.isFinite(player.yaw) ? player.yaw : 0,
      y: Number.isFinite(player.y) ? Math.max(0, player.y) : 0,
      vy: Number.isFinite(player.vy) ? player.vy : 0,
      jetpack: player.jetpack === true, thrusting: player.thrusting === true, hovering: player.hovering === true,
      moving: player.moving === true, color: player.color,
      connected: player.connected !== false, seq: Number.isFinite(player.seq) ? player.seq : 0,
      serverTick: Number.isFinite(state.tick) ? state.tick : 0,
    });
  });
  return { players, selfId, tick: Number.isFinite(state?.tick) ? state.tick : 0,
    serverTime: Number.isFinite(state?.serverTime) ? state.serverTime : 0,
    receivedAtPerf: performance.now() };
}

export function rosterSignature(players) {
  return JSON.stringify(players.map(({ id, name, color, connected }) => [id, name, color, connected]));
}

export function multiplayerError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (error?.name === 'AbortError') return '连接超时，请检查网络和联机服务后再试。你仍可单人探索。';
  if (/ROOM_FULL|FULL|4212/.test(code) || /full|maxClients|locked/i.test(message)) return '这座小镇已满 8 人，请换一个邀请码，或创建自己的小镇。';
  if (/NOT_FOUND|INVALID_CODE|4210/.test(code) || /not found|does not exist|已关闭|不存在/i.test(message)) return '没有找到这座小镇，可能已关闭。请核对邀请码，或请朋友重新创建。';
  if (/AUTH|TOKEN|401/.test(code)) return '游客凭据已失效，请重新创建或加入小镇。';
  if (/RATE|429/.test(code)) return '操作太快了，请稍等片刻再试。';
  if (/PROTOCOL|VERSION/.test(code)) return '客户端与联机服务版本不同，请刷新页面后再试。';
  if (/DUPLICATE|ALREADY/.test(code)) return '这个游客已经在小镇中，请先离开原连接，或稍后重试。';
  if (code === 'SERVICE_UNAVAILABLE') return '当前页面尚未接通联机服务。请使用已启动服务器的演示地址；单人探索仍可继续。';
  if (message && /[\u3400-\u9fff]/.test(message) && message.length < 250) return message;
  return '暂时无法连接联机服务，请检查网络或稍后重试。你仍可单人探索。';
}

function readGuest() {
  try {
    const value = JSON.parse(sessionStorage.getItem(GUEST_KEY) || 'null');
    return value && typeof value.token === 'string' && typeof value.name === 'string' ? value : null;
  } catch { return null; }
}

function storeGuest(value) {
  try { sessionStorage.setItem(GUEST_KEY, JSON.stringify(value)); } catch { /* In-memory guest still works if storage is blocked. */ }
}

export function restorableRoom(value, endpoint, now = Date.now()) {
  if (!value || value.endpoint !== endpoint || !/^[A-Z0-9]{6}$/.test(value.code || '')
    || typeof value.name !== 'string' || !value.name.trim() || [...value.name].length > 16
    || typeof value.token !== 'string' || !/^[\w-]+:[\w-]+$/.test(value.token)) return null;
  if (value.disconnectedAt !== undefined && value.disconnectedAt !== null
    && (!Number.isFinite(value.disconnectedAt) || now - value.disconnectedAt > RECONNECT_SECONDS * 1000)) return null;
  return value;
}

function readRoomRecord() {
  try { return JSON.parse(sessionStorage.getItem(ROOM_KEY) || 'null'); } catch { return null; }
}

function storeRoomRecord(value) {
  try {
    if (value) sessionStorage.setItem(ROOM_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(ROOM_KEY);
  } catch { /* Joining still works; reload recovery requires session storage. */ }
}

function stopRoomRetries(room) {
  room.reconnection.enabled = false;
  room.reconnection.maxRetries = 0;
  room.reconnection.enqueuedMessages.length = 0;
  // SDK 0.18.5 has no public cancellation handle for an already scheduled
  // reconnect timer. Neutralize this discarded room's connection entrypoint so
  // that timer cannot create a ghost socket after its listeners are destroyed.
  if (room.connection) room.connection.reconnect = () => {};
}

export function configureRoomReconnection(room) {
  room.reconnection.minUptime = 0;
  room.reconnection.maxRetries = 12;
  room.reconnection.minDelay = 200;
  room.reconnection.maxDelay = 2000;
  room.reconnection.maxEnqueuedMessages = 0;
}

// Stop only this room, including SDK retry timers scheduled before leaving.
export function retireRoom(room) {
  if (!room || navigationSuspendedRooms.has(room)) return;
  stopRoomRetries(room);
  try {
    if (room.connection?.isOpen) void room.leave(true).catch(() => {});
    else room.connection?.close(4000, 'left town');
  } catch { /* The transport may already be closed. */ }
}

export function suspendRoomForNavigation(room) {
  if (!room || navigationSuspendedRooms.has(room)) return;
  // SDK 0.18.5 close(4010) invokes onDrop synchronously BEFORE closing its
  // open WebSocket. Navigation has already invalidated the hook generation,
  // so that stale callback calls retireRoom. Mark first: retiring here would
  // send a consented LEAVE_ROOM packet and destroy the seat we want to resume.
  navigationSuspendedRooms.add(room);
  stopRoomRetries(room);
  try { room.connection?.close(4010, 'page navigation'); } catch { /* Browser teardown already closed it. */ }
}

export default function useMultiplayer() {
  const [status, setStatus] = useState('offline');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [players, setPlayers] = useState([]);
  const [selfId, setSelfId] = useState('');
  const [initialNickname, setInitialNickname] = useState(() => readGuest()?.name || '');
  const [inviteCode] = useState(() => invitationCode(window.location.search));
  const roomRef = useRef(null);
  const snapshotRef = useRef({ ...EMPTY_SNAPSHOT });
  const statusRef = useRef('offline');
  const generationRef = useRef(0);
  const rosterRef = useRef('');
  const guestRef = useRef(null);
  const abortRef = useRef(null);
  const timersRef = useRef(new Set());
  const mountedRef = useRef(true);
  const savedRoomRef = useRef(null);

  const updateStatus = useCallback(value => {
    statusRef.current = value;
    if (mountedRef.current) setStatus(value);
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
  }, []);

  const leaveRoom = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearTimers();
    savedRoomRef.current = null;
    storeRoomRecord(null);
    const room = roomRef.current;
    roomRef.current = null;
    retireRoom(room);
    snapshotRef.current = { ...EMPTY_SNAPSHOT };
    rosterRef.current = '';
    updateStatus('offline');
    if (mountedRef.current) { setError(''); setPlayers([]); setSelfId(''); setCode(''); }
  }, [clearTimers, updateStatus]);

  const connect = useCallback(async (mode, rawName, rawCode = '', restore = null) => {
    if (['connecting', 'connected', 'reconnecting'].includes(statusRef.current)) return false;
    leaveRoom();
    const generation = generationRef.current;
    const current = () => mountedRef.current && generationRef.current === generation;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    const normalizedCode = String(rawCode).trim().toUpperCase();
    if (!name || [...name].length > 16 || /[\u0000-\u001f\u007f]/.test(name)) {
      setError('昵称需要 1–16 个字，不能包含控制字符。'); updateStatus('error'); return false;
    }
    if (mode === 'join' && !/^[A-Z0-9]{6}$/.test(normalizedCode)) {
      setError('请输入完整的 6 位小镇邀请码。'); updateStatus('error'); return false;
    }
    updateStatus('connecting');
    setInitialNickname(name);
    const controller = new AbortController();
    abortRef.current = controller;
    const requestTimeout = setTimeout(() => controller.abort(), 15000);
    timersRef.current.add(requestTimeout);
    let room;
    try {
      const endpoint = multiplayerEndpoint(import.meta.env?.VITE_MULTIPLAYER_URL, window.location.origin);
      async function post(path, body) {
        const response = await fetch(`${endpoint}${path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: controller.signal, credentials: 'omit', cache: 'no-store',
        });
        if (!response.headers.get('content-type')?.includes('application/json')) throw Object.assign(new Error('Missing multiplayer API'), { code: 'SERVICE_UNAVAILABLE' });
        const data = await response.json();
        if (!response.ok) throw Object.assign(new Error(data.message || data.error || ''), { code: data.code || response.status });
        return data;
      }
      let result;
      if (mode === 'resume') {
        if (!restorableRoom(restore, endpoint)) throw new Error('上次小镇的重连窗口已结束，请使用邀请码重新加入。');
        savedRoomRef.current = restore;
        storeRoomRecord(restore);
        result = { code: restore.code };
        setCode(restore.code);
      } else {
        let oldGuest = guestRef.current || readGuest();
        if (oldGuest?.endpoint !== endpoint) oldGuest = null;
        let guest;
        try { guest = await post('/api/guest', { name, ...(oldGuest?.token ? { token: oldGuest.token } : {}) }); }
        catch (failure) {
          if (String(failure?.code) === '401' || /AUTH|TOKEN/.test(String(failure?.code))) {
            if (!current()) return false;
            guest = await post('/api/guest', { name });
          } else throw failure;
        }
        if (!current()) return false;
        if (typeof guest?.token !== 'string' || typeof guest?.guestId !== 'string') throw Object.assign(new Error('Invalid guest response'), { code: 'SERVICE_UNAVAILABLE' });
        guestRef.current = { ...guest, name, endpoint };
        storeGuest(guestRef.current);
        result = await post(mode === 'create' ? '/api/towns' : '/api/towns/join', {
          token: guest.token, name, protocolVersion: PROTOCOL_VERSION,
          ...(mode === 'join' ? { code: normalizedCode } : {}),
        });
        if (!current()) return false;
        if (!result?.reservation || !/^[A-Z0-9]{6}$/.test(result.code || '')) throw Object.assign(new Error('Invalid room response'), { code: 'SERVICE_UNAVAILABLE' });
      }
      clearTimeout(requestTimeout);
      timersRef.current.delete(requestTimeout);
      const client = new Client(endpoint);
      // Bound the WebSocket handshake too. SDK returns the room after handshake;
      // stale results are explicitly left instead of leaking a canceled seat.
      let joinTimedOut = false;
      const joinPromise = mode === 'resume'
        ? reconnectWithGrace(() => client.reconnect(restore.token), { signal: controller.signal, isCurrent: () => current() && !joinTimedOut })
        : client.consumeSeatReservation(result.reservation);
      let joinTimer;
      let abortJoin;
      const joinAborted = new Promise((_, reject) => {
        abortJoin = () => reject(Object.assign(new Error('Connection canceled'), { name: 'AbortError' }));
        controller.signal.addEventListener('abort', abortJoin, { once: true });
      });
      const joinTimeout = new Promise((_, reject) => {
        joinTimer = setTimeout(() => { joinTimedOut = true; reject(Object.assign(new Error('连接超时，请检查联机服务器后重试。'), { name: 'AbortError' })); }, 12000);
        timersRef.current.add(joinTimer);
      });
      joinPromise.then(lateRoom => { if (joinTimedOut || !current()) retireRoom(lateRoom); }, () => {});
      try { room = await Promise.race([joinPromise, joinTimeout, joinAborted]); }
      finally { clearTimeout(joinTimer); timersRef.current.delete(joinTimer); controller.signal.removeEventListener('abort', abortJoin); }
      if (!current()) { retireRoom(room); return false; }
      roomRef.current = room;
      configureRoomReconnection(room);
      setCode(result.code);
      setSelfId(room.sessionId);
      let stateTimer, reconnectTimer;
      function rememberRoom(disconnectedAt = null) {
        if (!current() || !room.reconnectionToken) return;
        const saved = { endpoint, name, code: result.code, token: room.reconnectionToken, disconnectedAt };
        savedRoomRef.current = saved;
        storeRoomRecord(saved);
      }
      function publish(state) {
        if (!current() || roomRef.current !== room) return;
        if (state?.protocolVersion !== PROTOCOL_VERSION) {
          setError('客户端与小镇协议版本不同，请刷新页面后再试。');
          updateStatus('error');
          roomRef.current = null;
          savedRoomRef.current = null;
          storeRoomRecord(null);
          retireRoom(room);
          return;
        }
        const snapshot = snapshotFromState(state, room.sessionId);
        snapshotRef.current = snapshot;
        const signature = rosterSignature(snapshot.players);
        if (signature !== rosterRef.current) { rosterRef.current = signature; setPlayers(snapshot.players); }
        if (snapshot.players.some(player => player.id === room.sessionId && player.connected)) {
          clearTimeout(stateTimer); clearTimeout(reconnectTimer);
          timersRef.current.delete(stateTimer); timersRef.current.delete(reconnectTimer);
          reconnectTimer = undefined;
          if (savedRoomRef.current?.token !== room.reconnectionToken || savedRoomRef.current?.disconnectedAt) rememberRoom();
          if (statusRef.current !== 'connected') {
            try { window.history.replaceState(window.history.state, '', urlForTown(window.location.href, result.code)); } catch { /* Sandboxed hosts may deny URL updates. */ }
            setError(''); updateStatus('connected');
          }
        }
      }
      room.onStateChange(publish);
      room.onMessage(MESSAGE.NOTICE, notice => { if (current() && roomRef.current === room && typeof notice?.message === 'string') setError(notice.message.slice(0, 250)); });
      room.onError((errorCode, message) => { if (current() && roomRef.current === room) setError(multiplayerError({ code: errorCode, message })); });
      room.onDrop(() => {
        if (!current() || roomRef.current !== room) { retireRoom(room); return; }
        updateStatus('reconnecting');
        setError('');
        if (!reconnectTimer) rememberRoom(Date.now());
        // The server keeps this seat for 15 seconds. Do not pretend an expired
        // session is connected or replay movement buffered during the outage.
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            if (!current() || statusRef.current === 'connected') return;
            roomRef.current = null;
            savedRoomRef.current = null;
            storeRoomRecord(null);
            retireRoom(room);
            snapshotRef.current = { ...EMPTY_SNAPSHOT };
            setPlayers([]); setSelfId('');
            setError('重连窗口已结束，请重新输入邀请码加入。你仍可单人探索。');
            updateStatus('disconnected');
          }, RECONNECT_SECONDS * 1000 + 500);
          timersRef.current.add(reconnectTimer);
        }
      });
      room.onReconnect(() => {
        if (!current() || roomRef.current !== room) retireRoom(room);
        // Authoritative state, not a socket-open event, marks us connected.
      });
      room.onLeave(() => {
        if (!current() || roomRef.current !== room) return;
        clearTimeout(stateTimer); clearTimeout(reconnectTimer);
        roomRef.current = null;
        savedRoomRef.current = null;
        storeRoomRecord(null);
        retireRoom(room);
        snapshotRef.current = { ...EMPTY_SNAPSHOT };
        setPlayers([]); setSelfId('');
        setError('与小镇的连接已结束，请重新加入。你仍可单人探索。');
        updateStatus('disconnected');
      });
      stateTimer = setTimeout(() => {
        if (!current() || statusRef.current !== 'connecting') return;
        roomRef.current = null;
        savedRoomRef.current = null;
        storeRoomRecord(null);
        retireRoom(room);
        setError('已连接服务器，但没有收到小镇状态，请重试。');
        updateStatus('error');
      }, 8000);
      timersRef.current.add(stateTimer);
      // consumeSeatReservation resolves before the first state in normal SDK
      // flow; cover transports where that state was already received.
      if (room.state?.players?.has?.(room.sessionId)) publish(room.state);
      return true;
    } catch (failure) {
      if (!current()) return false;
      retireRoom(room);
      roomRef.current = null;
      savedRoomRef.current = null;
      storeRoomRecord(null);
      if (mode === 'resume') console.warn('[game-town] room recovery failed', JSON.stringify(recoveryDiagnostic(failure)));
      setError(mode === 'resume' ? '未能恢复上次小镇，可能已超过 15 秒或房间已关闭。请用原邀请码重试，单人探索仍可继续。' : multiplayerError(failure));
      updateStatus('error');
      return false;
    } finally {
      clearTimeout(requestTimeout);
      timersRef.current.delete(requestTimeout);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [leaveRoom, updateStatus]);

  const sendInput = useCallback(input => {
    if (statusRef.current !== 'connected' || !roomRef.current?.connection?.isOpen) return false;
    if (!Number.isFinite(input?.x) || !Number.isFinite(input?.z) || !Number.isSafeInteger(input?.seq) || input.seq < 0) return false;
    if (['jump', 'stop', 'thrust', 'hover'].some(key => input[key] !== undefined && typeof input[key] !== 'boolean')) return false;
    if ((input.jump && input.thrust) || (input.hover && (input.jump || input.thrust))) return false;
    if (input.stop && (input.x !== 0 || input.z !== 0 || input.jump || input.thrust || input.hover)) return false;
      roomRef.current.send(MESSAGE.INPUT, { x: Math.max(-1, Math.min(1, input.x)), z: Math.max(-1, Math.min(1, input.z)), seq: input.seq,
        ...(typeof input.thrust === 'boolean' ? { thrust: input.thrust } : {}),
        ...(typeof input.hover === 'boolean' ? { hover: input.hover } : {}),
      ...(input.jump === true ? { jump: true } : {}), ...(input.stop === true ? { stop: true } : {}) });
    return true;
  }, []);

  const travel = useCallback(id => {
    if (statusRef.current !== 'connected' || !roomRef.current?.connection?.isOpen || typeof id !== 'string') return false;
    roomRef.current.send(MESSAGE.TRAVEL, { id });
    return true;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    function restorePreviousRoom() {
      const saved = readRoomRecord();
      if (!saved || statusRef.current !== 'offline') return;
      let endpoint;
      try { endpoint = multiplayerEndpoint(import.meta.env?.VITE_MULTIPLAYER_URL, window.location.origin); } catch { return; }
      const invitation = invitationCode(window.location.search);
      if (invitation && invitation !== saved.code) return;
      const restore = restorableRoom(saved, endpoint);
      if (restore) void connect('resume', restore.name, restore.code, restore);
      else {
        storeRoomRecord(null);
        if (saved.endpoint === endpoint && /^[A-Z0-9]{6}$/.test(saved.code || '')) {
          setCode(saved.code);
          setError('上次小镇的重连窗口已结束，请输入邀请码重新加入。');
          updateStatus('disconnected');
        }
      }
    }
    // StrictMode's first setup/cleanup must not consume or erase the saved seat.
    const restoreTimer = setTimeout(restorePreviousRoom, 0);
    function suspendForNavigation() {
      const room = roomRef.current;
      if (!room || !savedRoomRef.current) return;
      storeRoomRecord({ ...savedRoomRef.current, token: room.reconnectionToken, disconnectedAt: Date.now() });
      generationRef.current += 1;
      abortRef.current?.abort();
      clearTimers();
      roomRef.current = null;
      statusRef.current = 'offline';
      // Unconsented navigation preserves the server's 15-second reservation.
      suspendRoomForNavigation(room);
    }
    function restoreFromBackForwardCache(event) {
      if (event.persisted) { updateStatus('offline'); restorePreviousRoom(); }
    }
    window.addEventListener('pagehide', suspendForNavigation);
    window.addEventListener('pageshow', restoreFromBackForwardCache);
    return () => {
      clearTimeout(restoreTimer);
      window.removeEventListener('pagehide', suspendForNavigation);
      window.removeEventListener('pageshow', restoreFromBackForwardCache);
      mountedRef.current = false;
      if (roomRef.current || statusRef.current !== 'offline') leaveRoom();
    };
  }, [clearTimers, connect, leaveRoom, updateStatus]);

  return {
    status, error, code, players, selfId, snapshotRef, initialNickname, inviteCode,
    createRoom: useCallback(name => connect('create', name), [connect]),
    joinRoom: useCallback((roomCode, name) => connect('join', name, roomCode), [connect]),
    leaveRoom, sendInput, travel,
  };
}
