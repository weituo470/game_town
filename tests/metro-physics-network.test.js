import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { createTownServer } from '../server/index.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { METRO_ISLAND as I, inMetroIsland } from '../shared/metro-island.js';
import { isWalkable } from '../shared/world.js';

test('metro: two real SDK clients share named travel, city walking, jump, flight, hover and return in one room', { timeout: 20000 }, async () => {
  const server = await createTownServer({ port: 0, secret: 'metro-network-test-only-secret-32-bytes',
    npcConfig: { enabled: false }, npcSpeechConfig: { enabled: false }, aiDroneConfig: { enabled: false },
    gameImageConfig: { enabled: false }, gameCharacterConfig: { enabled: false }, architectConfig: { enabled: false }, architectSchedule: false });
  const peers = []; let code, timer;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check, label) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { if (check()) return; await sleep(20); }
    assert.ok(check(), label);
  }
  async function post(path, body) {
    const response = await fetch(server.url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, path); return response.json();
  }
  async function join(name) {
    const guest = await post('/api/guest', { name });
    const seat = await post(code ? '/api/towns/join' : '/api/towns', { ...guest, name, protocolVersion: PROTOCOL_VERSION, ...(code ? { code } : {}) });
    code = seat.code;
    const room = await new Client(server.url).consumeSeatReservation(seat.reservation);
    room.onMessage('notice', () => {}); peers.push(room);
    await until(() => room.state?.players?.has(room.sessionId), 'SDK initial city state'); return room;
  }
  try {
    const pilot = await join('临湾领航'), observer = await join('临湾同行');
    const peer = () => observer.state.players.get(pilot.sessionId);
    pilot.send('travel', { id: I.id });
    await until(() => peer()?.x === I.arrival.x && peer()?.z === I.arrival.z && peer()?.y === 0, 'peer sees authoritative city arrival');
    assert.ok(inMetroIsland(peer().x, peer().z)); assert.ok(isWalkable(peer().x, peer().z));
    let seq = 0, intent = { x: 0, z: -1, thrust: false, hover: false };
    const send = () => pilot.send('input', { ...intent, seq: seq++ });
    timer = setInterval(send, 45); send();
    await until(() => peer()?.z < I.arrival.z - 2, 'observer sees city walking on the new island');
    intent = { x: 0, z: 0, thrust: false, hover: false }; send(); await sleep(130);
    pilot.send('input', { ...intent, jump: true, seq: seq++ });
    await until(() => peer()?.y > .6, 'observer sees city jump');
    await until(() => peer()?.y === 0 && peer()?.vy === 0, 'city jump returns to flat deck');
    intent = { x: 0, z: 0, thrust: true, hover: false }; send();
    await until(() => peer()?.y > 3 && peer()?.thrusting, 'observer sees jetpack launch');
    intent = { x: 0, z: 0, thrust: false, hover: true }; send();
    await until(() => peer()?.hovering && peer()?.vy === 0, 'city hover remains server-owned');
    const altitude = peer().y; await sleep(130); assert.equal(peer().y, altitude);
    intent = { x: 0, z: 0, thrust: false, hover: false }; send();
    await until(() => peer()?.y === 0 && peer()?.jetpack === false, 'city flight safely lands on deck');
    clearInterval(timer); timer = undefined;
    pilot.send('travel', { id: 'center' });
    await until(() => peer()?.x === 0 && peer()?.y === 0, 'same authoritative room returns to original town');
  } finally {
    clearInterval(timer); await Promise.allSettled(peers.map(peer => peer.leave())); await server.close();
  }
});
