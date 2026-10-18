import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { createTownServer } from '../server/index.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import { reconnectWithGrace, retireRoom, suspendRoomForNavigation } from '../src/lib/useMultiplayer.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!check() && Date.now() < deadline) await sleep(10);
  assert.ok(check(), 'expected asynchronous room state');
}

test('real SDK refresh recovers when HTTP races the old socket onDrop reservation', async () => {
  const server = await createTownServer({ port: 0, secret: 'recovery-test-only-secret-with-at-least-32-bytes' });
  let original, replacement;
  let releaseDrop = () => {};
  let dropRegistered = Promise.resolve();
  let enteredDrop = false;
  try {
    const post = async (path, body) => (await fetch(`${server.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    const guest = await post('/api/guest', { name: '时序测试' });
    const created = await post('/api/towns', { token: guest.token, name: guest.name, protocolVersion: PROTOCOL_VERSION });
    original = await new Client(server.url).consumeSeatReservation(created.reservation);
    original.onMessage('notice', () => {});
    await until(() => original.state?.players?.has(original.sessionId));
    const sessionId = original.sessionId;
    const token = original.reconnectionToken;
    const room = matchMaker.getLocalRoomById(original.roomId);
    const normalDrop = room.onDrop;
    const dropGate = new Promise(resolve => { releaseDrop = resolve; });
    let registered;
    dropRegistered = new Promise(resolve => { registered = resolve; });
    // Instrument only this ephemeral test room to reproduce the real ordering:
    // old client removed, first real HTTP reconnect gets 524, then we explicitly
    // permit reservation registration. A fixed sleep is flaky under suite load.
    room.onDrop = async function (client, code) {
      enteredDrop = true;
      await dropGate;
      try { return await normalDrop.call(this, client, code); }
      finally { registered(); }
    };
    original.reconnection.enabled = false;
    original.connection.close(4010, 'refresh simulation');
    await until(() => enteredDrop);
    const failures = [];
    const client = new Client(server.url);
    replacement = await reconnectWithGrace(async () => {
      try { return await client.reconnect(token); }
      catch (error) {
        failures.push(error.code);
        if (failures.length === 1) {
          releaseDrop();
          await dropRegistered;
        }
        throw error;
      }
    });
    replacement.onMessage('notice', () => {});
    await until(() => replacement.state?.players?.get(sessionId)?.connected === true);
    assert.equal(failures[0], 524, 'installed MatchMaker exposes the expected transient error');
    assert.equal(replacement.sessionId, sessionId, 'same seat, not duplicate join');
    assert.equal(replacement.state.players.size, 1);
    assert.equal(replacement.state.code, created.code);
  } finally {
    // Release on assertions/network failures too, or shutdown could wait for
    // the intentionally blocked onDrop forever.
    releaseDrop();
    if (enteredDrop) await dropRegistered;
    retireRoom(original);
    retireRoom(replacement);
    await sleep(50);
    await server.close();
  }
});

for (const peerCount of [0, 1]) {
  test(`real SDK navigation preserves a ${peerCount + 1}-player room despite stale onDrop cleanup`, async () => {
    const server = await createTownServer({ port: 0, secret: 'navigation-test-only-secret-with-at-least-32-bytes' });
    let current, peer;
    try {
      const post = async (path, body) => (await fetch(`${server.url}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })).json();
      const guest = await post('/api/guest', { name: '刷新测试' });
      const created = await post('/api/towns', { token: guest.token, name: guest.name, protocolVersion: PROTOCOL_VERSION });
      current = await new Client(server.url).consumeSeatReservation(created.reservation);
      current.onMessage('notice', () => {});
      const sessionId = current.sessionId;
      if (peerCount) {
        const peerGuest = await post('/api/guest', { name: '留在镇中' });
        const joined = await post('/api/towns/join', { token: peerGuest.token, name: peerGuest.name, code: created.code, protocolVersion: PROTOCOL_VERSION });
        peer = await new Client(server.url).consumeSeatReservation(joined.reservation);
        peer.onMessage('notice', () => {});
      }
      const authority = matchMaker.getLocalRoomById(current.roomId);
      for (let refresh = 0; refresh < 3; refresh += 1) {
        await until(() => current.state?.players?.size === peerCount + 1 && current.state.players.get(sessionId)?.connected);
        const outgoing = current;
        const token = outgoing.reconnectionToken;
        let dropObserved = false, consentedLeaves = 0;
        const originalLeave = outgoing.leave.bind(outgoing);
        outgoing.leave = (...args) => { consentedLeaves += 1; return originalLeave(...args); };
        outgoing.onDrop(() => {
          dropObserved = true;
          assert.equal(outgoing.connection.isOpen, true, 'installed SDK invokes stale cleanup before ws.close');
          retireRoom(outgoing); // Exactly the hook's invalidated-generation callback.
        });
        suspendRoomForNavigation(outgoing);
        assert.equal(dropObserved, true);
        assert.equal(consentedLeaves, 0, 'pagehide must never send the consented leave packet');
        await until(() => authority.state.players.get(sessionId)?.connected === false);
        assert.equal(authority.state.players.size, peerCount + 1, 'the same seat remains reserved');
        current = await reconnectWithGrace(() => new Client(server.url).reconnect(token));
        current.onMessage('notice', () => {});
        await until(() => current.state?.players?.get(sessionId)?.connected === true);
        assert.equal(current.sessionId, sessionId);
        assert.equal(current.state.code, created.code);
        assert.equal(current.state.players.size, peerCount + 1);
      }
    } finally {
      retireRoom(current);
      retireRoom(peer);
      await sleep(50);
      await server.close();
    }
  });
}
