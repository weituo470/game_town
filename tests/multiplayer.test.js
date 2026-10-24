import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { createTownServer } from '../server/index.js';
import { createGuestIdentity, createRateLimiter } from '../server/identity.js';
import { validInput } from '../server/TownRoom.js';
import { createReconnectDiagnostics } from '../server/reconnectDiagnostics.js';
import { isWalkable, getDestination, PLAYER_SPEED, WORLD_LOCATIONS } from '../shared/world.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { jetpackVisualState } from '../src/components/town/jetpackVisual.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (check()) return; await sleep(25); }
  assert.ok(check(), message);
}
let server;
const joined = new Set();
before(async () => { server = await createTownServer({ port: 0, secret: 'test-only-secret-for-local-multiplayer-tests', reconnectSeconds: 1.5 }); });
after(async () => {
  await Promise.all([...joined].map(room => room.leave().catch(() => {})));
  await server?.close();
});

async function request(path, body, extraHeaders = {}) {
  const response = await fetch(`${server.url}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...extraHeaders }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function guest(name = '测试旅人') { return (await request('/api/guest', { name })).body; }
async function connect(identity, code) {
  const response = await request(code ? '/api/towns/join' : '/api/towns', { token: identity.token, name: identity.name, protocolVersion: PROTOCOL_VERSION, ...(code ? { code } : {}) });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const room = await new Client(server.url).consumeSeatReservation(response.body.reservation);
  room.onMessage('notice', () => {});
  joined.add(room);
  await until(() => room.state?.players?.has(room.sessionId), 'initial state arrives');
  assert.equal(room.state.protocolVersion, PROTOCOL_VERSION);
  return { room, code: response.body.code };
}
async function leave(room) { joined.delete(room); await room.leave(); }

test('global jetpack: server-authoritative thrust is visible to peers and release/timeout land safely', async () => {
  const host=await connect(await guest('飞行测试')), peer=await connect(await guest('飞行观察'),host.code);
  const id=host.room.sessionId;let seq=20;
  const send=thrust=>host.room.send('input',{x:0,z:0,thrust,seq:seq++});
  const timer=setInterval(()=>send(true),40);
  try {
    send(true);
    await until(()=>peer.room.state.players.get(id)?.y>2 && peer.room.state.players.get(id)?.thrusting===true,'peer sees powered flight',4000);
    clearInterval(timer);const top=peer.room.state.players.get(id).y;send(false);
    await until(()=>peer.room.state.players.get(id)?.thrusting===false && peer.room.state.players.get(id)?.y<top,'release descends',3000);
    await until(()=>peer.room.state.players.get(id)?.y===0,'release lands',4000);
    const again=setInterval(()=>send(true),40);
    try {await until(()=>peer.room.state.players.get(id)?.y>2,'relaunch anywhere',3000);} finally {clearInterval(again);}
    await until(()=>peer.room.state.players.get(id)?.y===0 && peer.room.state.players.get(id)?.thrusting===false,'stale thrust times out and lands',5000);
    const landed=peer.room.state.players.get(id);assert.ok(isWalkable(landed.x,landed.z));
  } finally {clearInterval(timer);await leave(peer.room);await leave(host.room);}
});

test('jetpack hover is shared with a real SDK peer, allows movement and expires when intent stops', async () => {
  const host = await connect(await guest('悬停测试')), peer = await connect(await guest('悬停观察'), host.code);
  const id = host.room.sessionId; let seq = 100, intent = { x: 0, z: 0, thrust: true, hover: false };
  const remote = () => peer.room.state.players.get(id);
  const send = () => host.room.send('input', { ...intent, seq: seq++ });
  let timer;
  try {
    await until(() => remote()?.y === 0, 'peer receives the grounded spawn');
    assert.deepEqual(jetpackVisualState(remote()), { equipped: true, firing: false, hovering: false });
    timer = setInterval(send, 40);
    send(); await until(() => remote()?.y > 3, 'peer sees jetpack launch', 4000);
    intent = { x: 0, z: 0, thrust: false, hover: true }; send();
    await until(() => remote()?.hovering === true && remote()?.vy === 0, 'peer receives hover schema', 3000);
    const height = remote().y, initialX = remote().x;
    assert.deepEqual(jetpackVisualState(remote()), { equipped: true, firing: true, hovering: true });
    intent = { ...intent, x: 1 }; send();
    await until(() => remote()?.x > initialX + 2, 'horizontal flight while hovering', 3000);
    assert.equal(remote().y, height); assert.equal(remote().thrusting, false);
    clearInterval(timer);
    await until(() => remote()?.hovering === false && remote()?.y < height, 'stale hover resumes gravity', 3000);
    assert.equal(jetpackVisualState(remote()).firing, false);
    await until(() => remote()?.y === 0, 'stale hover lands', 4000);
    assert.ok(isWalkable(remote().x, remote().z));
  } finally { clearInterval(timer); await leave(peer.room); await leave(host.room); }
});

test('guest identity is signed, renewable, expiring, and never based on display name', () => {
  let clock = 1000;
  const auth = createGuestIdentity({ secret: '01234567890123456789012345678901', now: () => clock });
  const first = auth.issue({ name: '<管理员>\u0000' });
  assert.equal(first.name, '管理员');
  assert.notEqual(auth.issue({ name: first.name }).guestId, first.guestId);
  assert.equal(auth.issue({ name: '新名字', token: first.token }).guestId, first.guestId);
  assert.equal(auth.verify(`${first.token.slice(0, -4)}AAAA`), null);
  assert.equal(auth.verify(`${first.token.split('.')[0]}.${'汉'.repeat(43)}`), null);
  clock = first.expiresAt + 1;
  assert.equal(auth.verify(first.token), null);
});

test('reconnection diagnostics are opt-in and redact all credentials and full identifiers', () => {
  const lines = [];
  createReconnectDiagnostics({ enabled: false, write: line => lines.push(line) })('onDrop', { closeCode: 1001 });
  assert.equal(lines.length, 0);
  createReconnectDiagnostics({ enabled: true, write: line => lines.push(line) })('onDrop', {
    roomId: 'room-prefix-123456', sessionId: 'session-prefix-ABCDEF', closeCode: 1001,
    hasReservedSeat: true, token: 'secret-value', url: '/somewhere?token=secret-value', name: 'private-name',
  });
  assert.equal(lines.length, 1);
  const details = JSON.parse(lines[0].slice('[town-reconnect] '.length));
  assert.equal(details.room, '123456'); assert.equal(details.session, 'ABCDEF');
  assert.equal(details.closeCode, 1001); assert.equal(details.hasReservedSeat, true);
  assert.ok(details.timestamp);
  assert.doesNotMatch(lines[0], /secret-value|prefix|private-name|somewhere/);
});

test('input and finite rate limiter reject malformed, stale, oversized values', () => {
  assert.equal(validInput({ x: 1, z: 1, seq: 2 }, 1), true);
  for (const input of [null, [], { x: NaN, z: 0, seq: 2 }, { x: Infinity, z: 0, seq: 2 }, { x: 2, z: 0, seq: 2 }, { x: 0, z: 0, seq: 1 }, { x: 0, z: 0, seq: 2, position: 99 }]) assert.equal(validInput(input, 1), false);
  let clock = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 100, now: () => clock });
  assert.equal(limiter.take('a'), true); assert.equal(limiter.take('a'), true); assert.equal(limiter.take('a'), false);
  clock = 101; assert.equal(limiter.take('a'), true);
});

test('HTTP health/auth/origin/version gates and static traversal', async () => {
  const health = await request('/api/health');
  assert.equal(health.body.maxPlayers, 8);
  assert.equal(health.body.protocolVersion, PROTOCOL_VERSION);
  assert.equal((await request('/api/guest', { name: 'x' }, { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await request('/api/guest', { name: 'x'.repeat(5000) })).status, 413);
  assert.equal((await request('/api/towns', { token: 'forged', protocolVersion: PROTOCOL_VERSION })).status, 401);
  const identity = await guest();
  assert.equal((await request('/api/towns', { ...identity, protocolVersion: 99 })).status, 400);
  assert.equal((await request('/api/towns/join', { ...identity, code: 'ZZZZZZ', protocolVersion: PROTOCOL_VERSION })).status, 404);
  assert.equal((await request('/matchmake/create/town', { ...identity, protocolVersion: PROTOCOL_VERSION })).status, 403);
  assert.equal((await request('/%2e%2e%2fpackage.json')).status, 403);
  const page = await fetch(`${server.url}/`);
  if (page.status === 200) {
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /<div id="root"><\/div>/);
  } else {
    assert.equal(page.status, 404);
    assert.equal((await page.json()).code, 'STATIC_NOT_FOUND', 'unbuilt checkout has an actionable error');
  }
});

test('old map and fixed-passenger protocols cannot create or join a protocol 11 town', async () => {
  assert.equal(PROTOCOL_VERSION, 12);
  const host = await connect(await guest('新版地图房主'));
  const identity = await guest('旧版地图客户端');
  const roomsBefore = (await request('/api/health')).body.rooms;
  for (const protocolVersion of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) for (const path of ['/api/towns', '/api/towns/join']) {
    const response = await request(path, { ...identity, code: host.code, protocolVersion });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'PROTOCOL_MISMATCH');
    assert.match(response.body.error, /协议版本不同.*刷新页面/);
  }
  assert.equal((await request('/api/health')).body.rooms, roomsBefore, 'old client cannot create a room');
  assert.equal(host.room.state.players.size, 1, 'old client cannot occupy a seat');
  await leave(host.room);
});

test('eight real SDK connections share a room; ninth rejected; leave frees a seat', async () => {
  const peers = [];
  const first = await connect(await guest('旅人1'));
  peers.push(first.room);
  for (let i = 2; i <= 8; i++) peers.push((await connect(await guest(`旅人${i}`), first.code)).room);
  await until(() => peers.every(room => room.state.players.size === 8), 'all eight clients see eight players');
  assert.equal(new Set([...peers[0].state.players.values()].map(p => p.id)).size, 8);
  const ninth = await guest('第九位');
  const full = await request('/api/towns/join', { ...ninth, code: first.code, protocolVersion: PROTOCOL_VERSION });
  assert.equal(full.status, 409); assert.equal(full.body.code, 'TOWN_FULL');
  await leave(peers.pop());
  await until(() => peers[0].state.players.size === 7, 'leave replicates');
  peers.push((await connect(ninth, first.code)).room);
  await until(() => peers.every(room => room.state.players.size === 8), 'freed slot joins');
  await Promise.all(peers.map(leave));
});

test('server simulates movement, clamps speed, rejects teleport facts, and stops stale input', async () => {
  const first = await connect(await guest('控制者'));
  const second = await connect(await guest('观察者'), first.code);
  const room = first.room;
  const remote = () => second.room.state.players.get(room.sessionId);
  const start = { x: remote().x, z: remote().z };
  room.send('input', { x: 1, z: 0, seq: 0 });
  await until(() => remote().x > start.x + 0.2, 'remote client sees real movement');
  await sleep(500);
  const stopped = { x: remote().x, z: remote().z };
  assert.ok(stopped.x - start.x <= PLAYER_SPEED * 0.4, 'stale packet cannot walk forever');
  room.send('input', { x: 500, z: 0, seq: 1 });
  room.send('input', { x: 1, z: 0, seq: 0 });
  room.send('input', { x: 0, z: 0, seq: 2, position: { x: 500, z: 500 } });
  await sleep(200);
  assert.ok(Math.abs(remote().x - stopped.x) < 0.001, 'invalid/stale packets cannot move');
  room.send('travel', { id: 'puzzle', seq: 3 });
  const destination = getDestination('puzzle');
  await until(() => Math.abs(remote().x - destination.x) < 0.001, 'authorized destination is replicated');
  room.send('travel', { id: '../../secret', seq: 4 });
  await sleep(120);
  assert.equal(remote().x, destination.x);
  assert.ok(isWalkable(remote().x, remote().z));
  room.send('input', { x: 0, z: -1, seq: 5 });
  await sleep(350);
  assert.ok(isWalkable(remote().x, remote().z), 'cannot penetrate shop collision');
  assert.ok(remote().z >= WORLD_LOCATIONS.find(place => place.id === 'puzzle').z + 2.8, 'stopped at building front');
  await Promise.all([leave(room), leave(second.room)]);
});

test('real clients share one authoritative jump, reject height facts, and land after idle input timeout', async () => {
  const first = await connect(await guest('跳跃旅人'));
  const observer = await connect(await guest('跳跃观察者'), first.code);
  const room = first.room;
  const remote = () => observer.room.state.players.get(room.sessionId);
  const authority = matchMaker.getLocalRoomById(room.roomId);
  const initialClock = room.state.serverTime;
  assert.ok(Math.abs(initialClock - Date.now()) < 2000);
  room.send('input', { x: 0, z: 0, jump: true, seq: 1 });
  await until(() => remote().y > 0.2 && remote().vy > 0, 'peer sees ascending jump');
  let peak = remote().y;
  room.send('input', { x: 0, z: 0, jump: true, seq: 2 });
  room.send('input', { x: 0, z: 0, y: 80, vy: 90, seq: 3 });
  for (let i = 0; i < 25; i++) { peak = Math.max(peak, remote().y); await sleep(40); }
  assert.ok(peak > 1.2 && peak <= 1.601, `one bounded jump peak ${peak}`);
  await until(() => remote().y === 0 && remote().vy === 0, 'idle input timeout still completes gravity');
  assert.equal(remote().seq, 2, 'client-supplied height and velocity were rejected');
  assert.ok(room.state.serverTime > initialClock, 'world time advances without movement');
  assert.ok(Math.abs(room.state.serverTime - observer.room.state.serverTime) <= 150, 'peers receive the same room clock');
  room.send('input', { x: 0, z: 0, jump: true, seq: 4 });
  await until(() => remote().y > 0.2, 'a new explicit action can jump again');
  room.send('input', { x: 0, z: 0, stop: true, seq: 5 });
  await until(() => remote().seq === 5 && remote().y === 0, 'modal/blur cancellation grounds both clients');
  room.send('input', { x: 0, z: 0, jump: true, seq: 6 });
  await until(() => remote().y > 0.2, 'jump before travel');
  room.send('travel', { id: 'east', seq: 7 });
  await until(() => remote().x === getDestination('east').x, 'travel replicated');
  assert.equal(remote().y, 0); assert.equal(remote().vy, 0);
  room.send('input', { x: 0, z: 0, jump: true, seq: 8 });
  await until(() => remote().y > 0.2, 'jump before drop');
  room.reconnection.minUptime = 0; room.reconnection.minDelay = 80; room.reconnection.maxDelay = 100;
  let reconnected = false;
  room.onReconnect(() => { reconnected = true; });
  authority.clients.get(room.sessionId).ref.terminate();
  await until(() => reconnected && remote().connected, 'same jump-capable session reconnects');
  await until(() => remote().y === 0 && remote().vy === 0, 'no airborne pose survives reconnection');
  await Promise.all([leave(room), leave(observer.room)]);
});

test('same guest cannot take duplicate seat; SDK automatic reconnect preserves session and state', async () => {
  const identity = await guest('重连旅人');
  const first = await connect(identity);
  const observer = await connect(await guest('见证者'), first.code);
  const room = first.room;
  const duplicate = await request('/api/towns/join', { ...identity, code: first.code, protocolVersion: PROTOCOL_VERSION });
  assert.equal(duplicate.body.code, 'ALREADY_JOINED');
  const id = room.sessionId;
  const oldToken = room.reconnectionToken;
  room.reconnection.minUptime = 0;
  room.reconnection.minDelay = 80;
  room.reconnection.delay = 80;
  room.reconnection.maxDelay = 100;
  let didDrop = false, didReconnect = false;
  room.onDrop(() => { didDrop = true; });
  room.onReconnect(() => { didReconnect = true; });
  const authoritative = matchMaker.getLocalRoomById(room.roomId);
  authoritative.clients.get(id).ref.terminate();
  await until(() => didDrop, 'SDK reports network drop');
  await until(() => didReconnect, 'SDK reconnects within held window');
  assert.equal(room.sessionId, id);
  assert.notEqual(room.reconnectionToken, oldToken, 'reconnect rotates token');
  await until(() => observer.room.state.players.get(id)?.connected === true, 'observer sees reconnected state');
  assert.equal(observer.room.state.players.size, 2);
  await Promise.all([leave(room), leave(observer.room)]);
});

test('expired reconnection removes player and consented leave never holds ghost seat', async () => {
  const first = await connect(await guest('掉线旅人'));
  const observer = await connect(await guest('观察者'), first.code);
  const room = first.room;
  room.reconnection.enabled = false;
  const id = room.sessionId;
  matchMaker.getLocalRoomById(room.roomId).clients.get(id).ref.terminate();
  await until(() => observer.room.state.players.get(id)?.connected === false, 'peer marks disconnected');
  await until(() => !observer.room.state.players.has(id), 'peer removed when grace expires', 3500);
  joined.delete(room);
  await leave(observer.room);
});

test('manual reconnect used by a refreshed client goes through the protected HTTP matchmaker', async () => {
  const first = await connect(await guest('刷新旅人'));
  const observer = await connect(await guest('观察者'), first.code);
  const original = first.room;
  original.reconnection.enabled = false;
  const token = original.reconnectionToken;
  const sessionId = original.sessionId;
  matchMaker.getLocalRoomById(original.roomId).clients.get(sessionId).ref.terminate();
  await until(() => observer.room.state.players.get(sessionId)?.connected === false, 'reconnect seat reserved');
  const replacement = await new Client(server.url).reconnect(token);
  replacement.onMessage('notice', () => {});
  joined.delete(original); joined.add(replacement);
  await until(() => replacement.state?.players?.get(sessionId)?.connected === true, 'new SDK receives resumed state');
  assert.equal(replacement.sessionId, sessionId);
  assert.equal(replacement.state.players.size, 2);
  await Promise.all([leave(replacement), leave(observer.room)]);
});

test('eight concurrent clients competing for last seat produce exactly one reservation', async () => {
  const first = await connect(await guest('房主'));
  const peers = [first.room];
  for (let i = 0; i < 6; i++) peers.push((await connect(await guest(`已入房${i}`), first.code)).room);
  const challengers = await Promise.all(Array.from({ length: 8 }, (_, i) => guest(`争抢${i}`)));
  const results = await Promise.all(challengers.map(identity => request('/api/towns/join', { ...identity, code: first.code, protocolVersion: PROTOCOL_VERSION })));
  const accepted = results.filter(result => result.status === 200);
  assert.equal(accepted.length, 1, 'room reservation is atomic, not only a preflight count');
  for (const rejected of results.filter(result => result.status !== 200)) {
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.code, 'TOWN_FULL');
  }
  const winner = await new Client(server.url).consumeSeatReservation(accepted[0].body.reservation);
  winner.onMessage('notice', () => {}); joined.add(winner); peers.push(winner);
  await until(() => peers.every(room => room.state?.players?.size === 8), 'all clients agree room has exactly eight players');
  await Promise.all(peers.map(leave));
});
