import test from 'node:test';
import assert from 'node:assert/strict';
import { multiplayerEndpoint, invitationCode, snapshotFromState, rosterSignature, multiplayerError, restorableRoom, retireRoom, suspendRoomForNavigation, configureRoomReconnection, reconnectWithGrace, recoveryDiagnostic, urlForTown } from '../src/lib/useMultiplayer.js';

test('multiplayer uses same-origin APIs by default and accepts a configured HTTPS base', () => {
  assert.equal(multiplayerEndpoint('', 'http://localhost:5173'), 'http://localhost:5173');
  assert.equal(multiplayerEndpoint(' https://example.test/town/ ', 'https://game.test'), 'https://example.test/town');
});

test('multiplayer rejects credentials, mixed content and malformed service URLs', () => {
  for (const bad of ['javascript:alert(1)', 'http://user:secret@example.test', 'https://example.test?token=bad', 'not-a-url']) {
    assert.throws(() => multiplayerEndpoint(bad, 'http://localhost:5173'));
  }
  assert.throws(() => multiplayerEndpoint('http://example.test', 'https://game.test'));
});

test('invitation only prefills a valid normalized code, never takes endpoints or credentials', () => {
  assert.equal(invitationCode('?town=abc123'), 'ABC123');
  assert.equal(invitationCode('?town=ABC12'), '');
  assert.equal(invitationCode('?town=%3Cscript%3E'), '');
  assert.equal(invitationCode('?endpoint=https://elsewhere.test&token=hello'), '');
});

test('authoritative state is copied to plain snapshots without sharing mutable schema values', () => {
  const player = { name: '小镇玩家', x: 1, z: 2, yaw: 0.5, moving: true, connected: true, color: '#446644', seq: 5 };
  const state = { tick: 19, players: new Map([['session-a', player], ['bad', { ...player, x: NaN }]]) };
  const snapshot = snapshotFromState(state, 'session-a');
  assert.equal(snapshot.players.length, 1);
  assert.equal(snapshot.selfId, 'session-a');
  assert.equal(snapshot.tick, 19);
  assert.equal(snapshot.players[0].serverTick, 19);
  assert.equal(snapshot.players[0].id, 'session-a');
  player.x = 99;
  assert.equal(snapshot.players[0].x, 1);
});

test('roster only rerenders on visible membership metadata, not 20 Hz movement', () => {
  const player = { id: 'a', name: '玩家', color: '#334433', connected: true, x: 1, z: 2 };
  assert.equal(rosterSignature([player]), rosterSignature([{ ...player, x: 10, z: 20 }]));
  assert.notEqual(rosterSignature([player]), rosterSignature([{ ...player, connected: false }]));
  assert.notEqual(rosterSignature([player]), rosterSignature([{ ...player, name: '新名字' }]));
});

test('errors give actionable full-room, invalid-code, and missing-service information', () => {
  assert.match(multiplayerError({ code: 'ROOM_FULL' }), /8 人/);
  assert.match(multiplayerError({ code: 'INVALID_CODE' }), /邀请码/);
  assert.match(multiplayerError({ code: 'PROTOCOL_MISMATCH' }), /版本不同.*刷新页面/);
  assert.match(multiplayerError({ code: 'SERVICE_UNAVAILABLE' }), /尚未接通联机服务/);
  assert.match(multiplayerError({ name: 'AbortError' }), /超时/);
  assert.match(multiplayerError(new Error('https://private-host.test/sensitive')) , /暂时无法连接/);
});

test('refresh recovery is scoped to the same service and only the server-held window', () => {
  const record = { endpoint: 'http://localhost:2567', code: 'ABCD23', name: '旅人', token: 'room-id:secret_token', disconnectedAt: 10000 };
  assert.equal(restorableRoom(record, record.endpoint, 20000), record);
  assert.equal(restorableRoom(record, record.endpoint, 25001), null);
  assert.equal(restorableRoom(record, 'http://elsewhere.test', 20000), null);
  assert.equal(restorableRoom({ ...record, token: 'https://bad.test/token' }, record.endpoint, 20000), null);
  assert.equal(restorableRoom({ ...record, disconnectedAt: '10000' }, record.endpoint, 20000), null);
  const active = { ...record, disconnectedAt: null };
  assert.equal(restorableRoom(active, record.endpoint, 900000), active, 'an active session may be hours old; the server remains authoritative on recovery');
});

test('immediate post-join drop is eligible and offline input buffering is disabled', () => {
  const room = { reconnection: { minUptime: 5000, maxEnqueuedMessages: 10 } };
  configureRoomReconnection(room);
  assert.equal(room.reconnection.minUptime, 0);
  assert.equal(room.reconnection.maxEnqueuedMessages, 0);
  assert.equal(room.reconnection.maxRetries, 12);
});

test('retirement neutralizes a previously queued SDK retry and leaves an open seat', async () => {
  let retries = 0, leaves = 0, closes = 0;
  const room = {
    reconnection: { enabled: true, maxRetries: 12, enqueuedMessages: [{ data: 'old-input' }] },
    connection: { isOpen: true, reconnect() { retries += 1; }, close() { closes += 1; } },
    async leave() { leaves += 1; },
  };
  retireRoom(room);
  room.connection.reconnect();
  assert.equal(retries, 0);
  assert.equal(leaves, 1);
  assert.equal(closes, 0);
  assert.equal(room.reconnection.enabled, false);
  assert.equal(room.reconnection.maxRetries, 0);
  assert.deepEqual(room.reconnection.enqueuedMessages, []);
  room.connection.isOpen = false;
  retireRoom(room);
  assert.equal(closes, 1);
  assert.equal(leaves, 1, 'already-closed transports do not send a leave packet');
});

test('refresh grace retries only SDK 524 with a bounded 150/300/600 ms schedule', async () => {
  const waits = [];
  let attempts = 0;
  const value = await reconnectWithGrace(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('not registered yet'), { code: 524 });
    return 'resumed';
  }, { wait: async delay => waits.push(delay) });
  assert.equal(value, 'resumed');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [150, 300]);
  attempts = 0; waits.length = 0;
  await assert.rejects(reconnectWithGrace(async () => {
    attempts += 1; throw Object.assign(new Error('expired'), { code: 524 });
  }, { wait: async delay => waits.push(delay) }), { code: 524 });
  assert.equal(attempts, 4);
  assert.deepEqual(waits, [150, 300, 600]);
});

test('navigation suspend cannot consent-leave via the SDK synchronous onDrop callback', () => {
  let leaves = 0, closes = 0, retries = 0;
  const room = {
    reconnection: { enabled: true, maxRetries: 12, enqueuedMessages: [] },
    connection: {
      isOpen: true,
      reconnect() { retries += 1; },
      close(code) {
        closes += 1;
        assert.equal(code, 4010);
        assert.equal(this.isOpen, true, 'SDK fires onDrop while the old transport remains open');
        retireRoom(room); // The hook generation is already stale during pagehide.
        this.isOpen = false;
      },
    },
    async leave() { leaves += 1; },
  };
  suspendRoomForNavigation(room);
  suspendRoomForNavigation(room);
  retireRoom(room);
  room.connection.reconnect();
  assert.equal(closes, 1, 'suspension is idempotent');
  assert.equal(leaves, 0, 'navigation must preserve the server reservation');
  assert.equal(retries, 0, 'the outgoing page cannot reconnect in the background');
});

test('disposed/auth failures are terminal and canceled recovery never retries', async () => {
  for (const code of [522, 525, 401]) {
    let attempts = 0;
    await assert.rejects(reconnectWithGrace(async () => { attempts += 1; throw Object.assign(new Error('terminal'), { code }); }), { code });
    assert.equal(attempts, 1);
  }
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(reconnectWithGrace(async () => { attempts += 1; throw Object.assign(new Error('race'), { code: 524 }); }, {
    signal: controller.signal,
    wait: async () => controller.abort(),
  }), { name: 'AbortError' });
  assert.equal(attempts, 1);
  await assert.rejects(reconnectWithGrace(async () => assert.fail('stale generation must not start'), { isCurrent: () => false }), { name: 'AbortError' });
});

test('recovery logs expose category but never arbitrary messages or tokens; actual room replaces old invite', () => {
  const log = recoveryDiagnostic({ code: 524, message: 'token=secret123 https://private.test/?credential=secret' });
  assert.equal(log.code, 524);
  assert.doesNotMatch(JSON.stringify(log), /secret|private\.test/);
  assert.equal(urlForTown('http://localhost:2567/?town=OLD123&mode=demo#map', 'NEW234'), 'http://localhost:2567/?town=NEW234&mode=demo#map');
});
