import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { createTownServer } from '../server/index.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { WONDERS, sampleWonder } from '../shared/wonders.js';
import { getDestination, isWalkable } from '../shared/world.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await sleep(30); } assert.ok(fn(), 'replicated state deadline'); }
test('two real SDK clients travel through all three islands and share server show phases', async () => {
  const server = await createTownServer({ port: 0, secret: 'wonder-tests-only-secret-minimum-32-bytes' });
  const peers = [];
  const post = async (path, data) => { const response = await fetch(`${server.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); assert.equal(response.status, 200); return response.json(); };
  try {
    let code;
    for (let i = 0; i < 2; i++) {
      const guest = await post('/api/guest', { name: `奇观验收${i + 1}` });
      const data = await post(code ? '/api/towns/join' : '/api/towns', { token: guest.token, name: guest.name, protocolVersion: PROTOCOL_VERSION, ...(code ? { code } : {}) });
      code = data.code;
      const room = await new Client(server.url).consumeSeatReservation(data.reservation);
      room.onMessage('notice', () => {}); peers.push(room);
      await until(() => room.state?.players?.has(room.sessionId));
    }
    await until(() => peers.every(room => room.state.players.size === 2));
    for (const w of WONDERS) {
      await sleep(520);
      const dest = getDestination(w.id);
      for (const room of peers) room.send('travel', { id: w.id });
      await until(() => peers.every(room => [...room.state.players.values()].every(p => p.x === dest.x && p.z === dest.z)));
      for (const room of peers) for (const p of room.state.players.values()) assert.ok(isWalkable(p.x, p.z));
      await until(() => Math.abs(peers[0].state.serverTime - peers[1].state.serverTime) < 150);
      const commonTime = Math.min(...peers.map(room => room.state.serverTime));
      const expected = sampleWonder(w.id, commonTime);
      assert.ok(expected && Number.isFinite(expected.elapsed));
      for (const room of peers) assert.ok(Math.abs(sampleWonder(w.id, room.state.serverTime).elapsed - expected.elapsed) < 150);
    }
    for (const room of peers) room.send('input', { seq: 1, x: 0, z: -1 });
    await sleep(120);
    await until(() => peers.every(room => [...room.state.players.values()].every(p => isWalkable(p.x, p.z))));
  } finally {
    await Promise.all(peers.map(room => room.leave().catch(() => {})));
    await server.close();
  }
});
