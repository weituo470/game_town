import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { METRO_LAYOUT, METRO_ISLAND as I, METRO_BUILDINGS as BUILDINGS, METRO_ROADS as ROADS,
  METRO_PARKS, inMetroIsland, metroSolid, metroFlightFloor, metroDestination } from '../shared/metro-island.js';
import { WORLD_BOUNDS, SPAWN, getDestination, isWalkable, movePlayer, groundHeight } from '../shared/world.js';
import { EXPLORATION_BOUNDS, WONDERS } from '../shared/wonders.js';
import { REALISTIC_ISLAND } from '../shared/realistic-island.js';
import { railPoint } from '../shared/space-rail.js';
import { sampleOffshoreVoyage } from '../shared/offshore-island.js';
import { stepAvatar, startAvatarJump, flightFloor, safeLanding, stoppedVertical } from '../shared/jetpack.js';
import { followTarget } from '../src/components/town/camera.js';
import { closeThirdPersonCamera } from '../src/components/town/firstPerson.js';
import { makeTownRoom, validInput } from '../server/TownRoom.js';

const close = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) <= e, `${a} differs from ${b}`);
const actor = (x = I.arrival.x, z = I.arrival.z) => ({ x, z, y: 0, yaw: 0, vy: 0, jetpack: false, thrusting: false, hovering: false });
function run(state, input, seconds, fps = 60) {
  for (let t = 0; t < seconds - 1e-9; t += 1 / fps) Object.assign(state, stepAvatar(state, input, Math.min(1 / fps, seconds - t)));
  return state;
}
const overlap = (a, b, gap = 0) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap
  && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 + gap;

test('metro: Blender and physics consume one immutable JSON layout with 24 detailed urban envelopes', () => {
  assert.deepEqual(METRO_LAYOUT, JSON.parse(fs.readFileSync(new URL('../shared/metro-layout.json', import.meta.url), 'utf8')));
  assert.equal(METRO_LAYOUT.coordinateSpace, 'world-metres-xz'); assert.equal(METRO_LAYOUT.schemaVersion, 1);
  assert.equal(BUILDINGS.length, 24); assert.equal(ROADS.length, 6);
  assert.equal(ROADS.filter(r => r.axis === 'x').length, 3); assert.equal(ROADS.filter(r => r.axis === 'z').length, 3);
  assert.ok(BUILDINGS.filter(b => b.height >= 90).length >= 3);
  assert.ok(Object.isFrozen(METRO_LAYOUT) && Object.isFrozen(BUILDINGS[0]) && Object.isFrozen(I.arrival));
  assert.equal(new Set(BUILDINGS.map(b => b.id)).size, 24);
  for (const b of BUILDINGS) {
    assert.ok(b.height >= 18 && b.height <= 140 && b.width > 0 && b.depth > 0);
    assert.ok(typeof b.type === 'string' && typeof b.style === 'string');
    for (const dx of [-b.width / 2, b.width / 2]) for (const dz of [-b.depth / 2, b.depth / 2]) assert.ok(inMetroIsland(b.x + dx, b.z + dz));
    for (const road of ROADS) assert.equal(overlap(b, road, .34), false, `${b.id} blocks ${road.id}`);
    for (const park of METRO_PARKS) assert.equal(overlap(b, park, .34), false, `${b.id} blocks ${park.id}`);
    for (const other of BUILDINGS) if (other.id !== b.id) assert.equal(overlap(b, other, .68), false);
  }
});

test('metro: additive northwestern island fits existing bounds and leaves all transport routes clear', () => {
  assert.deepEqual([I.x, I.z, I.width, I.depth, I.groundY], [20, -285, 280, 220, 0]);
  assert.ok(I.x - I.width / 2 > EXPLORATION_BOUNDS.minX && I.x + I.width / 2 < EXPLORATION_BOUNDS.maxX);
  assert.ok(I.z - I.depth / 2 > EXPLORATION_BOUNDS.minZ && I.z + I.depth / 2 < EXPLORATION_BOUNDS.maxZ);
  assert.equal(overlap(I, REALISTIC_ISLAND), false);
  for (const place of [SPAWN, ...WONDERS, { x: -79, z: -80 }, { x: -108, z: 10 }]) assert.equal(inMetroIsland(place.x, place.z), false);
  for (let t = 0; t <= 1; t += .002) {
    const rail = railPoint(t); assert.equal(inMetroIsland(rail[0], rail[2]), false);
    const ship = sampleOffshoreVoyage({ startAt: 1 }, 1 + t * 150000); assert.equal(inMetroIsland(ship.x, ship.z), false);
  }
  assert.deepEqual(WORLD_BOUNDS, { minX: -42.9, maxX: 42.9, minZ: -38.9, maxZ: 40.3 });
  assert.deepEqual(EXPLORATION_BOUNDS, { minX: -138, maxX: 455, minZ: -415, maxZ: 270 });
});

test('metro: rounded island supports only visible land; unknown names and non-finite points are rejected', () => {
  assert.equal(inMetroIsland(I.x, I.z), true);
  for (const [x, z] of [[-120, -395], [160, -395], [-120, -175], [160, -175], [-121, -285], [20, -174], [NaN, -285], [20, Infinity], ['20', -285]]) {
    assert.equal(inMetroIsland(x, z), false); assert.equal(metroSolid(x, z), false); assert.equal(metroFlightFloor(x, z), 0);
  }
  const destination = getDestination(I.id); assert.deepEqual(destination, metroDestination(I.id));
  assert.ok(isWalkable(destination.x, destination.z)); assert.equal(destination.y, 0);
  destination.x = 9999; assert.equal(getDestination(I.id).x, 20);
  assert.equal(metroDestination('metro-island:140,500,-300'), null); assert.equal(metroDestination({ id: I.id }), null);
});

test('metro: all six roads, the main arrival route, central park and promenade stay continuously walkable', () => {
  for (const road of ROADS) {
    const n = road.axis === 'x' ? road.width : road.depth;
    for (let d = -n / 2; d <= n / 2; d += .25) {
      const x = road.x + (road.axis === 'x' ? d : 0), z = road.z + (road.axis === 'z' ? d : 0);
      assert.ok(isWalkable(x, z), `${road.id}: ${x},${z}`); assert.equal(flightFloor(x, z), 0); assert.equal(groundHeight(x, z), 0);
    }
  }
  for (const park of METRO_PARKS) for (let x = park.x - park.width / 2; x <= park.x + park.width / 2; x += 1) {
    for (let z = park.z - park.depth / 2; z <= park.z + park.depth / 2; z += 1) assert.ok(isWalkable(x, z));
  }
  for (const x of [-114, 154]) for (let z = -389; z <= -181; z += .5) assert.ok(isWalkable(x, z));
  for (const z of [-389, -181]) for (let x = -114; x <= 154; x += .5) assert.ok(isWalkable(x, z));
  const state = actor(); run(state, { z: -1 }, 35); assert.ok(state.z < -370 && state.z > -391); assert.equal(state.y, 0);
});

test('metro: building footprints block walking and low flight while every roof matches its authored envelope', () => {
  for (const b of BUILDINGS) {
    assert.equal(isWalkable(b.x, b.z), false); assert.equal(metroSolid(b.x, b.z), true);
    close(flightFloor(b.x, b.z), b.height + .12); close(metroFlightFloor(b.x, b.z), b.height + .12);
    const state = actor(b.x - b.width / 2 - 2, b.z); run(state, { x: 1 }, 2);
    assert.ok(state.x <= b.x - b.width / 2 - .33, b.id);
    const low = { ...actor(b.x - b.width / 2 - 2, b.z), y: 2, jetpack: true };
    run(low, { x: 1, thrust: true }, .8);
    assert.ok(low.x <= b.x - b.width / 2 - .33 && low.y < b.height, b.id);
  }
});

test('metro: high flight clears facades, lands on a roof and can remain there without ground-mode teleporting', () => {
  for (const fps of [15, 60, 120]) {
    const b = BUILDINGS.find(b => b.height === 112), roof = b.height + .12;
    const state = { ...actor(b.x - b.width / 2 - 2, b.z), y: roof + 2, jetpack: true };
    run(state, { x: 1, hover: true }, 1.6, fps); assert.ok(metroSolid(state.x, state.z)); close(state.y, roof + 2);
    run(state, {}, 2, fps); close(state.y, roof); assert.equal(state.jetpack, true); assert.equal(state.hovering, false);
    run(state, {}, 3, fps); close(state.y, roof);
    Object.assign(state, stoppedVertical(state)); run(state, {}, .3, fps); close(state.y, roof);
    run(state, { thrust: true }, 1, fps); assert.ok(state.y > roof + 2);
    const altitude = state.y; run(state, { hover: true }, .5, fps); close(state.y, altitude);
  }
});

test('metro: ordinary jump, flight landing and safe rescue preserve the flat deck contract', () => {
  const state = actor(), jump = startAvatarJump(state); assert.ok(jump); Object.assign(state, jump);
  run(state, {}, 1.5); close(state.y, 0); assert.equal(state.jetpack, false);
  run(state, { thrust: true }, 1); assert.ok(state.y > 2); run(state, {}, 3); close(state.y, 0); assert.equal(state.jetpack, false);
  for (const b of BUILDINGS) {
    const landing = safeLanding(b.x, b.z); assert.ok(inMetroIsland(landing.x, landing.z)); assert.ok(isWalkable(landing.x, landing.z)); assert.equal(groundHeight(landing.x, landing.z), 0);
  }
  assert.equal(validInput({ x: 0, z: 0, seq: 1, y: 140 }), false);
  assert.equal(validInput({ x: 0, z: 0, seq: 1, thrust: true }), true);
});

test('metro: external follow target and third-person camera never clamp a city player back to the old town', () => {
  const pose = actor(-60, -315), target = followTarget(pose, 1280);
  assert.equal(target.x, pose.x); assert.ok(Math.abs(target.z - pose.z) < 3);
  const shot = closeThirdPersonCamera(pose, 0, 0);
  assert.ok(shot.position.x < 0 && shot.position.z < -300);
  assert.ok(shot.position.y >= flightFloor(shot.position.x, shot.position.z) + .2);
});

function roomHarness() {
  let now = 1000;
  const Room = makeTownRoom({ identity: {}, roomCodes: new Map(), now: () => now });
  const room = Object.create(Room.prototype), id = 'metro-pilot', player = { ...actor(SPAWN.x, SPAWN.z), connected: true, seq: -1 };
  Object.defineProperty(room, 'state', { value: { tick: 0, serverTime: now, players: new Map([[id, player]]) } });
  room.inputs = new Map(); room.controls = new Map([[id, { seq: -1, travelAt: -Infinity, noticesAt: -Infinity, invalid: 0 }]]);
  room.trace = () => {}; room.allowReconnection = () => Promise.resolve(); room.hasReservedSeat = () => true;
  const notices = [], client = { sessionId: id, send: (type, value) => notices.push({ type, ...value }), leave() {} }; let seq = 0;
  return { room, player, client, notices, tick: () => { now += 50; room.step(50); }, wait: ms => { now += ms; },
    input: intent => room.receiveInput(client, { x: 0, z: 0, seq: seq++, ...intent }) };
}

test('metro: room authority resolves only the named city destination and shares collision/travel/drop rules', () => {
  const h = roomHarness(); h.room.receiveTravel(h.client, { id: I.id, x: 999 }); assert.equal(h.player.x, SPAWN.x);
  h.room.receiveTravel(h.client, { id: I.id }); assert.equal(h.player.x, I.arrival.x); assert.equal(h.player.z, I.arrival.z); assert.equal(h.player.y, 0);
  for (let i = 0; i < 10; i++) { h.input({ z: -1 }); h.tick(); } assert.ok(h.player.z < I.arrival.z - 2); assert.equal(h.player.y, 0);
  h.room.onDrop(h.client, 1001); assert.equal(h.player.connected, false); assert.ok(isWalkable(h.player.x, h.player.z));
  h.room.onReconnect(h.client); assert.equal(h.player.connected, true);
  h.wait(600); h.room.receiveTravel(h.client, { id: 'center' }); assert.equal(h.player.x, 0); assert.equal(h.player.y, 0);
});
