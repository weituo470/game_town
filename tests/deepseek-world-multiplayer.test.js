import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { createTownServer } from '../server/index.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { PARK_ARRIVAL } from '../shared/deepseek-park.js';
import { getDestination, isWalkable } from '../shared/world.js';

test('two real clients share DeepSeek travel, walking, flight/hover and return to existing destinations', { timeout: 20000 }, async () => {
  const server = await createTownServer({ port: 0, secret: 'deepseek-park-world-contract-test-only-secret' });
  const rooms = []; let timer;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check, label) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { if (check()) return; await pause(25); }
    assert.ok(check(), label);
  }
  async function post(path, body) {
    const response = await fetch(`${server.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, path); return response.json();
  }
  async function connect(name, code) {
    const guest = await post('/api/guest', { name });
    const result = await post(code ? '/api/towns/join' : '/api/towns', { token: guest.token, name, protocolVersion: PROTOCOL_VERSION, ...(code ? { code } : {}) });
    const room = await new Client(server.url).consumeSeatReservation(result.reservation);
    rooms.push(room); room.onMessage('notice', () => {});
    await until(() => room.state?.players?.has(room.sessionId), 'initial state');
    return { room, code: result.code };
  }
  try {
    const host = await connect('园区行走测试'), peer = await connect('园区飞行观察', host.code);
    await until(() => rooms.every(room => room.state.players.size === 2), 'both players arrive');
    for (const room of rooms) room.send('travel', { id: 'deepseek' });
    await until(() => rooms.every(room => [...room.state.players.values()].every(p => p.x === PARK_ARRIVAL.x && p.z === PARK_ARRIVAL.z)), 'server approves new destination for every client');
    const remote = () => peer.room.state.players.get(host.room.sessionId);
    let seq = 0, intent = { x: 0, z: -1, thrust: false, hover: false };
    const send = () => host.room.send('input', { ...intent, seq: seq++ });
    send(); await until(() => remote()?.z < PARK_ARRIVAL.z - .2, 'walking stays on shared park mesh');
    intent = { x: 0, z: 0, thrust: true, hover: false };
    timer = setInterval(send, 40); send();
    await until(() => remote()?.y > 3 && remote()?.thrusting, 'park supports authoritative takeoff');
    intent = { x: 0, z: 0, thrust: false, hover: true }; send();
    await until(() => remote()?.hovering && remote()?.vy === 0, 'hover reaches peer');
    const height = remote().y, startX = remote().x;
    intent = { x: 1, z: 0, thrust: false, hover: true }; send();
    await until(() => remote()?.x > startX + 1.5, 'hover allows park horizontal flight');
    assert.equal(remote().y, height); assert.ok(Number.isFinite(remote().y));
    clearInterval(timer); timer = undefined;
    intent = { x: 0, z: 0, thrust: false, hover: false, stop: true }; send();
    await until(() => remote()?.hovering === false && remote()?.y < height, 'stop cancels hover and descends');
    await until(() => remote()?.y === 0, 'pilot lands in park');
    assert.ok(isWalkable(remote().x, remote().z));
    host.room.send('travel', { id: 'gpt' }); peer.room.send('travel', { id: 'center' });
    const gpt = getDestination('gpt'), center = getDestination('center');
    await until(() => rooms.every(room => {
      const a = room.state.players.get(host.room.sessionId), b = room.state.players.get(peer.room.sessionId);
      return a?.x === gpt.x && a?.z === gpt.z && b?.x === center.x && b?.z === center.z;
    }), 'existing destinations still work after park exploration');
  } finally {
    clearInterval(timer);
    await Promise.allSettled(rooms.map(room => room.leave()));
    await server.close();
  }
});
