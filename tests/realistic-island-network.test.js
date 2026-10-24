import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { createTownServer } from '../server/index.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { REALISTIC_ISLAND as I } from '../shared/realistic-island.js';
import { groundHeight, isWalkable } from '../shared/world.js';

test('two real SDK clients share elevated island travel, walking, jump, flight, landing and the old town', { timeout: 20000 }, async () => {
  const server = await createTownServer({ port: 0, secret: 'natural-island-network-test-only-32-bytes',
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
    await until(() => room.state?.players?.has(room.sessionId), 'SDK initial state'); return room;
  }
  try {
    const pilot = await join('雾岬登岛测试'), observer = await join('雾岬同行观察');
    const peer = () => observer.state.players.get(pilot.sessionId);
    pilot.send('travel', { id: I.id });
    await until(() => peer()?.x === I.arrival.x && peer()?.y > 1, 'peer sees server-approved elevated landing');
    let seq = 0, intent = { x: 1, z: 0, thrust: false, hover: false };
    const send = () => pilot.send('input', { ...intent, seq: seq++ });
    timer = setInterval(send, 45); send();
    await until(() => peer()?.x > I.arrival.x + 2, 'peer sees island walking');
    intent = { x: 0, z: 0, thrust: false, hover: false }; send();
    await sleep(130);
    assert.ok(isWalkable(peer().x, peer().z)); assert.ok(Math.abs(peer().y - groundHeight(peer().x, peer().z)) < .001);
    const floor = peer().y;
    pilot.send('input', { ...intent, jump: true, seq: seq++ });
    await until(() => peer()?.y > floor + .6, 'jump is above mountain support, not global zero');
    await until(() => Math.abs(peer()?.y - floor) < .001 && peer()?.vy === 0, 'jump returns to elevated support');
    intent = { x: 0, z: 0, thrust: true, hover: false }; send();
    await until(() => peer()?.y > floor + 3 && peer()?.thrusting, 'jetpack ascent reaches peer');
    intent = { x: 0, z: 0, thrust: false, hover: true }; send();
    await until(() => peer()?.hovering && peer()?.vy === 0, 'hover remains authoritative');
    const altitude = peer().y; await sleep(130); assert.equal(peer().y, altitude);
    intent = { x: 0, z: 0, thrust: false, hover: false }; send();
    await until(() => Math.abs(peer()?.y - floor) < .001 && peer()?.jetpack === false, 'flight returns to on-foot support');
    clearInterval(timer); timer = undefined;
    pilot.send('travel', { id: 'center' });
    await until(() => peer()?.x === 0 && peer()?.y === 0, 'same room returns to established town without scene switching');
  } finally {
    clearInterval(timer); await Promise.allSettled(peers.map(peer => peer.leave())); await server.close();
  }
});
