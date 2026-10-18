import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  GPT_PARK, GPT_BRIDGE, GPT_ARRIVAL, GPT_PAVILIONS, GPT_PEDESTAL,
  inGptGround, gptSolid, gptDestination,
} from '../shared/gpt-park.js';
import { DEEPSEEK_PARK } from '../shared/deepseek-park.js';
import { WONDERS, WONDER_MAP } from '../shared/wonders.js';
import { WORLD_BOUNDS, WORLD_LOCATIONS, SPAWN, getDestination, isWalkable, movePlayer } from '../shared/world.js';
import { addExpandedGround } from '../src/components/town/ExpandedGround.js';
import { followTarget } from '../src/components/town/camera.js';

const rectanglesOverlap = (a, b) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2;

test('GPT park is an additive northeast island without invading town or existing landmarks', () => {
  assert.equal(GPT_PARK.id, 'gpt');
  assert.deepEqual(GPT_PAVILIONS.map(item => item.id), ['create', 'code', 'voice', 'explore']);
  assert.ok(GPT_PARK.z + GPT_PARK.depth / 2 < WORLD_BOUNDS.minZ);
  for (const landmark of [...WONDERS, DEEPSEEK_PARK]) assert.equal(rectanglesOverlap(GPT_PARK, landmark), false, landmark.id);
  for (const place of WORLD_LOCATIONS) assert.equal(rectanglesOverlap(GPT_PARK, { ...place, width: 6.44, depth: 5.6 }), false, place.id);
  assert.ok(GPT_PARK.x - GPT_PARK.width / 2 > WONDER_MAP.centerX - WONDER_MAP.width / 2);
  assert.ok(GPT_PARK.x + GPT_PARK.width / 2 < WONDER_MAP.centerX + WONDER_MAP.width / 2);
  assert.ok(GPT_PARK.z - GPT_PARK.depth / 2 > WONDER_MAP.centerZ - WONDER_MAP.depth / 2);
});

test('GPT destination is server approved, walkable and returned as an independent copy', () => {
  assert.deepEqual(gptDestination('gpt'), GPT_ARRIVAL);
  assert.deepEqual(getDestination('gpt'), GPT_ARRIVAL);
  assert.ok(inGptGround(GPT_ARRIVAL.x, GPT_ARRIVAL.z));
  assert.ok(isWalkable(GPT_ARRIVAL.x, GPT_ARRIVAL.z));
  assert.equal(gptSolid(GPT_ARRIVAL.x, GPT_ARRIVAL.z), false);
  assert.equal(gptDestination('unknown'), null);
  const first = getDestination('gpt');
  first.x = 0;
  assert.equal(getDestination('gpt').x, GPT_ARRIVAL.x);
});

test('GPT footbridge is continuous from town to island and arrival is reachable from spawn', () => {
  const south = GPT_BRIDGE.z + GPT_BRIDGE.depth / 2;
  const north = GPT_PARK.z + GPT_PARK.depth / 2;
  assert.ok(south > WORLD_BOUNDS.minZ);
  assert.ok(GPT_BRIDGE.z - GPT_BRIDGE.depth / 2 <= north);
  for (let z = south; z >= north - 3; z -= 0.1) assert.ok(isWalkable(GPT_BRIDGE.x, z), `bridge center ${z}`);

  const queue = [[Math.round(SPAWN.x), Math.round(SPAWN.z)]];
  const seen = new Set([queue[0].join(',')]);
  const target = `${Math.round(GPT_ARRIVAL.x)},${Math.round(GPT_ARRIVAL.z)}`;
  for (let index = 0; index < queue.length && !seen.has(target); index += 1) {
    const [x, z] = queue[index];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${x + dx},${z + dz}`;
      if (!seen.has(key) && isWalkable(x + dx, z + dz) && isWalkable(x + dx * 0.5, z + dz * 0.5)) {
        seen.add(key); queue.push([x + dx, z + dz]);
      }
    }
  }
  assert.ok(seen.has(target));
  let player = { x: GPT_BRIDGE.x, z: WORLD_BOUNDS.minZ + 2, yaw: Math.PI };
  for (let i = 0; i < 32; i += 1) {
    player = movePlayer(player, { x: 0, z: -1 }, 0.1);
    assert.ok(isWalkable(player.x, player.z));
  }
  assert.ok(player.z < GPT_ARRIVAL.z, 'walking crosses the town boundary and arrival without teleport');
});

test('GPT buildings stop players while island edges reject water and malformed coordinates', () => {
  for (const solid of [GPT_PEDESTAL, ...GPT_PAVILIONS]) {
    assert.ok(gptSolid(solid.x, solid.z));
    assert.equal(isWalkable(solid.x, solid.z), false);
  }
  for (const [x, z] of [[55, -58], [21, -58], [38, -73], [32, -42], [44, -42]]) {
    assert.equal(inGptGround(x, z), false, `${x},${z}`);
    assert.equal(isWalkable(x, z), false, `${x},${z}`);
  }
  for (const value of [NaN, Infinity, '38', null, undefined]) {
    assert.equal(inGptGround(value, -58), false);
    assert.equal(inGptGround(38, value), false);
  }
  let player = { ...GPT_ARRIVAL };
  for (let i = 0; i < 160; i += 1) {
    player = movePlayer(player, { x: 0, z: -1 }, 0.1);
    assert.ok(isWalkable(player.x, player.z));
  }
  assert.ok(player.z >= GPT_PEDESTAL.z + GPT_PEDESTAL.radius, 'central plinth is not a walk-through visual');
});

test('northern rendered parapet has a real opening across the GPT bridge', () => {
  const parts = [];
  addExpandedGround({ add: (kind, position, size, color) => parts.push({ kind, position, size, color }) });
  const northWall = parts.filter(part => Math.abs(part.position[2] - (WORLD_BOUNDS.minZ - 0.3)) < 0.001 && [0.18, 0.38].includes(part.position[1]) && ['#9c9985', '#b2ab91'].includes(part.color));
  assert.ok(northWall.length > 0, 'other northern parapets remain intact');
  for (const part of northWall) assert.ok(Math.abs(part.position[0] - GPT_BRIDGE.x) >= (part.size[0] + GPT_BRIDGE.width) / 2, 'parapet must not intersect bridge');
});

test('GPT walking camera follows outside town bounds on desktop and mobile', () => {
  for (const width of [390, 1280]) for (const pose of [GPT_ARRIVAL, { x: 50, z: -61 }]) {
    const target = followTarget(pose, width);
    assert.equal(target.x, pose.x);
    assert.ok(Math.abs(target.z - pose.z) <= 2.5);
    assert.ok(target.z < WORLD_BOUNDS.minZ);
  }
});

test('town mounts the shared GPT scene and forwards its optional selection callback only during active exploration', () => {
  const town = fs.readFileSync(new URL('../src/components/Town.jsx', import.meta.url), 'utf8');
  assert.match(town, /import GptPark from '\.\/town\/GptPark\.jsx'/);
  assert.match(town, /<GptPark[^>]*timeRef=\{props\.npcTimeRef\}[^>]*onSelect=\{props\.active\s*\?\s*props\.onGptSelect\s*:\s*undefined\}/);
  assert.match(town, /onGptSelect=\{onGptSelect\}/);
});

test('two real multiplayer clients can travel to GPT park and see peer movement there', { timeout: 15000 }, async () => {
  const [{ Client }, { createTownServer }, { PROTOCOL_VERSION }] = await Promise.all([
    import('@colyseus/sdk'), import('../server/index.js'), import('../shared/protocol.js'),
  ]);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async check => {
    for (let i = 0; i < 100; i += 1) { if (check()) return; await pause(30); }
    assert.ok(check(), 'GPT multiplayer replication deadline');
  };
  const server = await createTownServer({ port: 0, secret: 'gpt-park-test-only-secret-at-least-32-bytes' });
  const peers = [];
  const notices = [];
  const post = async (path, data) => {
    const response = await fetch(`${server.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    let code;
    for (let index = 0; index < 2; index += 1) {
      const identity = await post('/api/guest', { name: `GPT visitor ${index + 1}` });
      const data = await post(code ? '/api/towns/join' : '/api/towns', {
        token: identity.token, name: identity.name, protocolVersion: PROTOCOL_VERSION, ...(code ? { code } : {}),
      });
      code = data.code;
      const room = await new Client(server.url).consumeSeatReservation(data.reservation);
      room.onMessage('notice', notice => notices.push(notice));
      peers.push(room);
      await until(() => room.state?.players?.has(room.sessionId));
    }
    await until(() => peers.every(room => room.state.players.size === 2));
    for (const room of peers) room.send('travel', { id: 'gpt' });
    await until(() => peers.every(room => [...room.state.players.values()].every(player => player.x === GPT_ARRIVAL.x && player.z === GPT_ARRIVAL.z)));
    peers[0].send('input', { seq: 1, x: 0, z: -1 });
    await until(() => peers[1].state.players.get(peers[0].sessionId)?.z < GPT_ARRIVAL.z - 0.1);
    peers[0].send('input', { seq: 2, x: 0, z: 0 });
    for (const room of peers) for (const player of room.state.players.values()) assert.ok(isWalkable(player.x, player.z));
    assert.equal(notices.some(notice => notice.code === 'INVALID_TRAVEL'), false);
  } finally {
    await Promise.all(peers.map(room => room.leave().catch(() => {})));
    await server.close();
  }
});
