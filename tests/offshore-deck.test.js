import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Vector3 } from 'three';
import { OFFSHORE_DECK_SPEED, OFFSHORE_DECK_BOUNDS, OFFSHORE_DECK_OBSTACLES, isOffshoreDeckWalkable, offshoreDeckSolid, stepOffshoreDeck } from '../shared/offshore-deck.js';
import { OFFSHORE_ARRIVAL, offshorePlan, offshoreSeatLocal, sampleOffshoreVoyage, sampleOffshorePassenger, offshoreLocalToWorld, worldToOffshoreLocal } from '../shared/offshore-island.js';
import { makeTownRoom, validInput } from '../server/TownRoom.js';
import { snapshotFromState } from '../src/lib/useMultiplayer.js';
import { blendOffshoreDeck, offshoreWalkingCamera, remoteOffshorePose } from '../src/components/town/offshoreWalking.js';

const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const local = (x = -8, z = 4) => ({ deckX: x, deckZ: z, deckYaw: 0, moving: false });

test('the safe deck matches the working platform, moonpool, railings and every ground-level facility', () => {
  for (let seat = 0; seat < 8; seat++) {
    const p = offshoreSeatLocal(seat);
    assert.ok(isOffshoreDeckWalkable(p.x, p.z), `boarding station ${seat}`);
  }
  for (const p of [[0, 0], [0, -7], [0, 3], [-3.8, -2], [12.5, 0], [-12.5, 0], [0, 14.6], [0, -14.6], [0, 11.25], [7.4, -10.5], [-7.7, -11.6], [-5.6, -4.5], [9.4, 4.3], [-9.4, -4.6], [-10.4, 11.8], [10.4, -11.8], [NaN, 0], [Infinity, 0]]) {
    assert.equal(isOffshoreDeckWalkable(...p), false, JSON.stringify(p));
  }
  for (const p of [[-8, 0], [6, 5], [0, 5], [0, -8.5], [-11.8, 0], [11.8, 0]]) assert.ok(isOffshoreDeckWalkable(...p), JSON.stringify(p));
  for (const obstacle of OFFSHORE_DECK_OBSTACLES.filter(r => r.minY < 10)) {
    assert.equal(isOffshoreDeckWalkable((obstacle.minX + obstacle.maxX) / 2, (obstacle.minZ + obstacle.maxZ) / 2), false, obstacle.id);
  }
});

test('all eight stations reach the open bow, stern and both observation corridors without crossing any obstacle', () => {
  const step = .25, start = [-8, 4], key = (x, z) => `${x},${z}`, visited = new Set([key(...start)]), queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i];
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const nx = x + dx, nz = z + dz, id = key(nx, nz);
      if (!visited.has(id) && isOffshoreDeckWalkable(nx, nz)) { visited.add(id); queue.push([nx, nz]); }
    }
  }
  for (let i = 0; i < 8; i++) assert.ok(visited.has(key(-8, 4 + i)));
  for (const p of [[0, 5], [6, 5], [11.75, 0], [-11.75, 0], [0, -8.5]]) assert.ok(visited.has(key(...p)), JSON.stringify(p));
});

test('deck movement normalizes diagonals, clamps dt, preserves heading at rest and slides along bulkheads', () => {
  for (const input of [{ x: 1, z: 0 }, { x: 1, z: 1 }]) {
    const next = stepOffshoreDeck(local(), input, .1);
    close(Math.hypot(next.deckX + 8, next.deckZ - 4), OFFSHORE_DECK_SPEED * .1);
    assert.ok(next.moving);
    assert.deepEqual(stepOffshoreDeck(local(), input, 99), next);
  }
  assert.deepEqual(stepOffshoreDeck({ ...local(), deckYaw: 1 }, {}, .1), { ...local(), deckYaw: 1 });
  assert.deepEqual(stepOffshoreDeck(local(), { x: Infinity, z: NaN }, NaN), local());
  const pose = local(-7, 9), next = stepOffshoreDeck(pose, { x: 1, z: -1 }, .1);
  assert.ok(next.deckX < -6.9 && next.deckZ < 9, 'slide forward along the cabin wall without entering it');
  const invalid = stepOffshoreDeck({ deckX: NaN, deckZ: Infinity, offshoreSeat: 7 }, { x: 0, z: 0 }, .1);
  assert.deepEqual([invalid.deckX, invalid.deckZ], [-8, 11]);
});

test('long randomized walks never cross a rail, moonpool or equipment and never exceed speed', () => {
  let seed = 12345, pose = local();
  for (let i = 0; i < 30000; i++) {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    const angle = (seed >>> 0) / 0xffffffff * Math.PI * 2;
    const next = stepOffshoreDeck(pose, { x: Math.sin(angle), z: Math.cos(angle) }, i % 3 ? .1 : 5);
    assert.ok(isOffshoreDeckWalkable(next.deckX, next.deckZ));
    assert.ok(Math.hypot(next.deckX - pose.deckX, next.deckZ - pose.deckZ) <= .4200000001);
    pose = next;
  }
  for (const direction of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let pose = local();
    for (let i = 0; i < 1000; i++) pose = stepOffshoreDeck(pose, { x: direction[0], z: direction[1] }, .1);
    assert.ok(isOffshoreDeckWalkable(pose.deckX, pose.deckZ)); assert.equal(pose.moving, false);
    assert.ok(pose.deckX >= OFFSHORE_DECK_BOUNDS.minX && pose.deckX <= OFFSHORE_DECK_BOUNDS.maxX);
  }
});

test('walking passengers and camera use exact XYZ transforms with invertible world/local coordinates', () => {
  const plan = { startAt: 1000, returnAt: 0 };
  for (const now of [1000, 17000, 54000, 90000, 127000, 151000]) {
    const ship = sampleOffshoreVoyage(plan, now), p = { x: -8.3, y: 8, z: 6.7 }, world = offshoreLocalToWorld(ship, p);
    const expected = new Vector3(p.x, p.y, p.z).applyEuler(new Euler(ship.pitch, ship.yaw, ship.roll)).add(new Vector3(ship.x, ship.y, ship.z));
    for (const axis of ['x', 'y', 'z']) { close(world[axis], expected[axis]); close(worldToOffshoreLocal(ship, world)[axis], p[axis]); }
    const passenger = sampleOffshorePassenger(plan, now, 2, { deckX: p.x, deckZ: p.z, deckYaw: .8, moving: true });
    for (const axis of ['x', 'y', 'z']) close(passenger[axis], world[axis]);
    close(passenger.yaw, ship.yaw + .8); assert.equal(passenger.moving, true); assert.equal(passenger.jetpack, false);
  }
});

test('camera collision has real heights and never sends a follow or close lens through the occupied deck', () => {
  assert.equal(offshoreDeckSolid(0, 9, 11), true); assert.equal(offshoreDeckSolid(0, 16, 11), false);
  assert.equal(offshoreDeckSolid(-8, 9, 6), false); assert.equal(offshoreDeckSolid(0, NaN, 11), false);
  const ship = sampleOffshoreVoyage({ startAt: 1000 }, 50000);
  for (const p of [local(-7, 9), local(-8, 6), local(0, 5), local(6, 0), local(-8, -8.5)]) for (const aspect of [1280 / 720, 390 / 844]) for (const firstPerson of [false, true]) {
    for (let yaw = 0; yaw < Math.PI * 2; yaw += .2) for (const pitch of [-.3, .12, .8]) {
      const pose = sampleOffshorePassenger({}, 0, 0, p), shot = offshoreWalkingCamera(pose, ship, { yaw, pitch }, firstPerson, aspect);
      const camera = worldToOffshoreLocal(ship, shot.position);
      assert.ok(camera.y > 8.15);
      assert.equal(offshoreDeckSolid(camera.x, camera.y, camera.z), false, `solid camera ${JSON.stringify({ p, yaw, pitch, firstPerson })}`);
    }
  }
});

test('remote interpolation never flies across a moonpool, follows drift and stops stale walking', () => {
  const plan = { startAt: 1000 }, voyage = { plan, now: 54000 };
  const from = sampleOffshorePassenger(plan, voyage.now, 0, local(-8, 0)), next = { ...local(6, 0), offshoreSeat: 0, aboard: true, moving: true, connected: true };
  const blended = blendOffshoreDeck(from, next, .5);
  assert.ok(isOffshoreDeckWalkable(blended.deckX, blended.deckZ));
  assert.equal(blended.deckX, 6, 'skipping a missing turn must snap to a safe authority point, not interpolate over water');
  const restored = remoteOffshorePose(from, next, voyage, .1, false, false);
  assert.equal(restored.moving, false);
  assert.equal(restored.deckX, 6);
});

function harness() {
  let time = 100000;
  const Room = makeTownRoom({ identity: {}, roomCodes: new Map(), now: () => time });
  const room = Object.create(Room.prototype);
  Object.defineProperty(room, 'state', { value: { tick: 0, serverTime: time, offshoreStartAt: 0, offshoreReturnAt: 0, players: new Map() } });
  room.inputs = new Map(); room.controls = new Map(); room.trace = () => {};
  room.allowReconnection = () => Promise.resolve(); room.hasReservedSeat = () => true;
  const player = { ...OFFSHORE_ARRIVAL, id: 'a', y: 0, vy: 0, connected: true, seq: -1, aboard: false, offshoreSeat: -1, offshoreSeq: -1 };
  room.state.players.set('a', player);
  room.controls.set('a', { seq: -1, travelAt: -Infinity, noticesAt: -Infinity, invalid: 0, offshoreSeq: -1, offshoreAt: -Infinity });
  const notices = [], client = { sessionId: 'a', send: (_type, value) => notices.push(value), leave() {} };
  let seq = 0;
  room.receiveOffshore(client, { action: 'board', seq: 0 });
  return { room, player, client, notices, now: () => time,
    input: value => room.receiveInput(client, { x: 0, z: 0, seq: seq++, ...value }),
    tick: (ms = 50) => { time += ms; room.step(ms); }, wait: ms => { time += ms; } };
}

test('authority owns deck direction, normalized speed, pose transform and stale/stop cancellation', () => {
  const h = harness(); h.tick(400);
  h.room.receiveOffshore(h.client, { action: 'depart', seq: 1 });
  const before = { ...h.player };
  h.input({ x: 1, z: 1, thrust: true }); h.tick(100);
  close(Math.hypot(h.player.deckX - before.deckX, h.player.deckZ - before.deckZ), OFFSHORE_DECK_SPEED * .1);
  const sample = sampleOffshorePassenger(offshorePlan(h.room.state), h.now(), 0, h.player);
  for (const axis of ['x', 'y', 'z']) close(h.player[axis], sample[axis]);
  assert.equal(h.player.jetpack, false); assert.equal(h.player.vy, 0);
  h.input({ stop: true }); const stopped = [h.player.deckX, h.player.deckZ]; h.tick();
  assert.deepEqual([h.player.deckX, h.player.deckZ], stopped); assert.equal(h.player.moving, false);
  h.input({ x: 0, z: -1, jump: true }); h.tick(100); assert.equal(h.player.vy, 0);
  h.input({ hover: true }); h.tick(100); assert.equal(h.player.hovering, false);
  h.input({ x: 0, z: -1 }); h.tick(100);
  const last = [h.player.deckX, h.player.deckZ]; h.tick(301);
  assert.deepEqual([h.player.deckX, h.player.deckZ], last); assert.equal(h.player.moving, false);
  h.input({ x: 0, z: -1 }); h.room.step(100000);
  assert.ok(Math.hypot(h.player.deckX - last[0], h.player.deckZ - last[1]) <= .420000001, 'authority clamps huge simulation delta');
});

test('server rejects client-local position injection and reconnect preserves a walked location', () => {
  const h = harness();
  for (const extra of [{ deckX: 50 }, { deckZ: 50 }, { deckYaw: 2 }, { y: 100 }, { aboard: true }, { speed: 20 }]) {
    assert.equal(validInput({ x: 0, z: 0, seq: 5, ...extra }), false);
  }
  h.input({ x: 0, z: -1 }); h.tick(100);
  const saved = [h.player.deckX, h.player.deckZ, h.player.deckYaw];
  h.room.onDrop(h.client, 1006); h.tick(200);
  assert.deepEqual([h.player.deckX, h.player.deckZ, h.player.deckYaw], saved); assert.equal(h.player.moving, false);
  h.room.onReconnect(h.client); h.tick();
  assert.deepEqual([h.player.deckX, h.player.deckZ, h.player.deckYaw], saved);
  const replicated = snapshotFromState(h.room.state, 'a').players[0];
  assert.deepEqual([replicated.deckX, replicated.deckZ, replicated.deckYaw], saved);
});
