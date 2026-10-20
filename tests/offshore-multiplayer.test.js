import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { createTownServer } from '../server/index.js';
import { PROTOCOL_VERSION, RECONNECT_SECONDS } from '../shared/protocol.js';
import { OFFSHORE_ARRIVAL, OFFSHORE_CRUISE_MS, offshorePlan, sampleOffshorePassenger } from '../shared/offshore-island.js';
import { isWalkable } from '../shared/world.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (check()) return; await sleep(25); }
  assert.ok(check(), message);
}

test('real SDK peers share voyage, walk on deck, reconnect at their local pose and safely leave', async () => {
  assert.equal(PROTOCOL_VERSION, 9); assert.equal(RECONNECT_SECONDS, 15);
  const server = await createTownServer({ port: 0, secret: 'offshore-tests-only-secret-minimum-32-bytes', npcConfig: { enabled: false }, npcSpeechConfig: { enabled: false }, aiDroneConfig: { enabled: false }, gameImageConfig: { enabled: false }, gameCharacterConfig: { enabled: false } });
  const peers = new Set(); let code;
  const post = async (path, body) => { const response = await fetch(`${server.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  const connect = async name => {
    const guest = await post('/api/guest', { name });
    const data = await post(code ? '/api/towns/join' : '/api/towns', { ...guest, protocolVersion: PROTOCOL_VERSION, ...(code ? { code } : {}) });
    code = data.code;
    const room = await new Client(server.url).consumeSeatReservation(data.reservation);
    const notices = []; room.onMessage('notice', message => notices.push(message)); peers.add(room);
    await until(() => room.state?.players?.has(room.sessionId), 'first replicated state');
    return { room, notices };
  };
  try {
    let a = await connect('浮动岛船员'), b = await connect('浮动岛观察员');
    await until(() => a.room.state.players.size === 2 && b.room.state.players.size === 2, 'two room members');
    for (const p of [a, b]) {
      // This is the same ordered command pair used by the browser's Board button.
      p.room.send('travel', { id: 'offshore' });
      p.room.send('offshore', { action: 'board', seq: 0 });
    }
    await until(() => [...b.room.state.players.values()].every(p => p.aboard), 'both passengers board');
    const aid = a.room.sessionId, bid = b.room.sessionId;
    const seat = b.room.state.players.get(aid).offshoreSeat;
    assert.notEqual(seat, b.room.state.players.get(bid).offshoreSeat);
    await sleep(350); a.room.send('offshore', { action: 'depart', seq: 1 });
    await until(() => a.room.state.offshoreStartAt > 0 && a.room.state.offshoreStartAt === b.room.state.offshoreStartAt, 'shared departure epoch');
    const authority = matchMaker.getLocalRoomById(a.room.roomId);
    // Test-only time jump: checks the actual schema/transport far from the pier
    // without making the suite wait for the whole 150 second sightseeing route.
    authority.state.offshoreStartAt -= 60000;
    await until(() => b.room.state.players.get(aid).z > 180, 'peer sees the moving vessel passenger at sea');
    for (const player of b.room.state.players.values()) {
      const expected = sampleOffshorePassenger(offshorePlan(b.room.state), b.room.state.serverTime, player.offshoreSeat);
      assert.ok(Math.hypot(player.x - expected.x, player.y - expected.y, player.z - expected.z) < .001);
    }
    const late = await connect('迟到的岸上访客');
    assert.equal(late.room.state.offshoreStartAt, b.room.state.offshoreStartAt, 'late join reads the existing vessel, never restarts it');
    assert.equal(late.room.state.players.get(late.room.sessionId).aboard, false);
    a.room.send('input', { x: 1, z: 0, thrust: true, seq: 2 });
    await until(() => b.room.state.players.get(aid).deckX > -7.8, 'peer receives ship-local walking rather than a fixed seat');
    await until(() => b.room.state.players.get(aid).moving === false, 'stale input stops walking');
    const walked = b.room.state.players.get(aid), localBeforeDrop = { deckX: walked.deckX, deckZ: walked.deckZ, deckYaw: walked.deckYaw };
    const transformed = sampleOffshorePassenger(offshorePlan(b.room.state), b.room.state.serverTime, seat, walked);
    assert.ok(Math.hypot(walked.x - transformed.x, walked.y - transformed.y, walked.z - transformed.z) < .001);
    a.room.send('travel', { id: 'center' });
    await sleep(550); a.room.send('offshore', { action: 'disembark', seq: 2 });
    await until(() => a.notices.some(n => n.code === 'OFFSHORE_AT_SEA'), 'early disembark is rejected');
    assert.equal(b.room.state.players.get(aid).aboard, true); assert.equal(b.room.state.players.get(aid).jetpack, false);
    const token = a.room.reconnectionToken;
    a.room.reconnection.enabled = false;
    authority.clients.get(aid).ref.terminate();
    await until(() => b.room.state.players.get(aid)?.connected === false, 'disconnected seat remains reserved');
    assert.equal(b.room.state.players.get(aid).aboard, true);
    assert.deepEqual({ deckX: b.room.state.players.get(aid).deckX, deckZ: b.room.state.players.get(aid).deckZ, deckYaw: b.room.state.players.get(aid).deckYaw }, localBeforeDrop);
    const replacement = await new Client(server.url).reconnect(token); replacement.onMessage('notice', () => {});
    peers.delete(a.room); peers.add(replacement); a = { room: replacement };
    await until(() => replacement.state?.players?.get(aid)?.connected === true, 'reconnected schema');
    assert.equal(replacement.state.players.get(aid).aboard, true); assert.equal(replacement.state.players.get(aid).offshoreSeat, seat);
    const restored = replacement.state.players.get(aid);
    assert.deepEqual({ deckX: restored.deckX, deckZ: restored.deckZ, deckYaw: restored.deckYaw }, localBeforeDrop);
    await sleep(350); replacement.send('offshore', { action: 'return', seq: 3 });
    await until(() => b.room.state.offshoreReturnAt > 0, 'return command is replicated');
    authority.state.offshoreStartAt = Date.now() - OFFSHORE_CRUISE_MS + 300;
    authority.state.offshoreReturnAt = 0;
    await until(() => Math.abs(b.room.state.players.get(aid).z - 89) < .001, 'fixed passenger station comes back to dock');
    await sleep(400); replacement.send('offshore', { action: 'disembark', seq: 4 });
    await until(() => b.room.state.players.get(aid)?.aboard === false, 'safe disembark visible to peer');
    const landed = b.room.state.players.get(aid);
    assert.deepEqual([landed.x, landed.y, landed.z], [OFFSHORE_ARRIVAL.x, 0, OFFSHORE_ARRIVAL.z]); assert.ok(isWalkable(landed.x, landed.z));
    await replacement.leave(); peers.delete(replacement);
    await until(() => !b.room.state.players.has(aid), 'consented leave releases passenger');
  } finally {
    await Promise.all([...peers].map(room => room.leave().catch(() => {})));
    await server.close();
  }
});
