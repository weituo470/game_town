import test from 'node:test';
import assert from 'node:assert/strict';
import { PIXEL_ISLAND as I, pixelColumnHeight, pixelSurfaceBlock, inPixelIsland,
  pixelGroundHeight, pixelDestination, pixelCanStep } from '../shared/pixel-island.js';
import { WORLD_BOUNDS, WORLD_SIZE, SPAWN, STREETS, getDestination, groundHeight, isWalkable, movePlayer } from '../shared/world.js';
import { EXPLORATION_BOUNDS, WONDERS } from '../shared/wonders.js';
import { REALISTIC_ISLAND, islandHeight } from '../shared/realistic-island.js';
import { METRO_ISLAND } from '../shared/metro-island.js';
import { railPoint } from '../shared/space-rail.js';
import { sampleOffshoreVoyage } from '../shared/offshore-island.js';
import { flightFloor, startAvatarJump, stepAvatar, safeLanding, stoppedVertical } from '../shared/jetpack.js';
import { JUMP_MAX_HEIGHT } from '../shared/jump.js';
import { followTarget } from '../src/components/town/camera.js';
import { closeThirdPersonCamera } from '../src/components/town/firstPerson.js';
import { makeTownRoom, validInput } from '../server/TownRoom.js';

const close = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) <= e, `${a} differs from ${b}`);
const point = (gx, gz) => ({ x: I.origin.x + (gx + .5) * I.cell, z: I.origin.z + (gz + .5) * I.cell });
const actor = (p = I.arrival) => ({ ...p, y: groundHeight(p.x, p.z), yaw: 0, vy: 0,
  jetpack: false, thrusting: false, hovering: false });
function run(state, input, seconds, fps = 60) {
  for (let n = 0; n < Math.round(seconds * fps); n++) Object.assign(state, stepAvatar(state, input, 1 / fps));
  return state;
}

test('pixel island: original immutable base contract fits the existing continuous world', () => {
  assert.deepEqual([I.x, I.z, I.width, I.depth, I.columns, I.layers, I.cell, I.seed], [120, 210, 96, 96, 64, 40, 1.5, 424242]);
  assert.deepEqual(I.origin, { x: 72, y: -7.28, z: 162 });
  assert.ok(Object.isFrozen(I) && Object.isFrozen(I.origin) && Object.isFrozen(I.arrival));
  assert.ok(I.origin.x > EXPLORATION_BOUNDS.minX && I.origin.x + I.width < EXPLORATION_BOUNDS.maxX);
  assert.ok(I.origin.z > EXPLORATION_BOUNDS.minZ && I.origin.z + I.depth < EXPLORATION_BOUNDS.maxZ);
  assert.ok(I.origin.x > WORLD_BOUNDS.maxX && I.origin.z > WORLD_BOUNDS.maxZ);
  assert.ok(I.origin.x + I.width < REALISTIC_ISLAND.x - REALISTIC_ISLAND.width / 2);
  for (const old of [SPAWN, METRO_ISLAND, REALISTIC_ISLAND, ...WONDERS]) assert.equal(inPixelIsland(old.x, old.z), false);
  for (let n = 0; n <= 500; n++) {
    const t = n / 500, train = railPoint(t), ship = sampleOffshoreVoyage({ startAt: 1 }, 1 + t * 150000);
    assert.equal(inPixelIsland(train[0], train[2]), false);
    assert.equal(inPixelIsland(ship.x, ship.z), false);
  }
});

test('pixel island: deterministic layer counts create a shaped coastline, varied hills and original surface IDs', () => {
  const counts = new Map(), surfaces = new Set(); let high = 0, empty = 0;
  for (let gx = 0; gx < I.columns; gx++) for (let gz = 0; gz < I.columns; gz++) {
    const height = pixelColumnHeight(gx, gz);
    assert.ok(Number.isInteger(height) && height >= 0 && height <= 25 && height < I.layers);
    assert.equal(height, pixelColumnHeight(gx, gz));
    counts.set(height, (counts.get(height) || 0) + 1); high = Math.max(high, height);
    if (height === 0) empty++;
    else surfaces.add(pixelSurfaceBlock(gx, gz));
    const p = point(gx, gz);
    assert.equal(inPixelIsland(p.x, p.z), height >= 5);
    close(pixelGroundHeight(p.x, p.z), height >= 5 ? I.origin.y + height * I.cell : 0);
  }
  assert.ok(empty > 800 && empty < 1700, 'island is not a full rectangular block platform');
  assert.ok(high >= 20 && counts.size >= 15); assert.ok(counts.has(4) && counts.has(5));
  assert.deepEqual([...surfaces].sort((a, b) => a - b), [1, 4, 15]);
  close(I.origin.y + 4 * I.cell, -1.28);
});

test('pixel island: invalid columns and non-finite points never authorize invisible land', () => {
  for (const [gx, gz] of [[-1, 10], [64, 1], [1, 64], [2.5, 10], [NaN, 2], [Infinity, 1], ['32', 51]]) {
    assert.equal(pixelColumnHeight(gx, gz), 0);
  }
  for (const [x, z] of [[NaN, I.z], [I.x, Infinity], ['120', I.z], [0, 0], [72.01, 162.01], [167.99, 257.99]]) {
    assert.equal(inPixelIsland(x, z), false); assert.equal(pixelGroundHeight(x, z), 0);
  }
  assert.equal(pixelCanStep(NaN, I.z, I.x, I.z), false);
  assert.equal(pixelDestination({ id: I.id }), null); assert.equal(pixelDestination('pixel-island:0,99,0'), null);
});

test('pixel island: named arrival and its seven-by-seven meadow are flat, dry and safely walkable', () => {
  for (let gx = 29; gx <= 35; gx++) for (let gz = 48; gz <= 54; gz++) {
    assert.equal(pixelColumnHeight(gx, gz), 8); assert.equal(pixelSurfaceBlock(gx, gz), 1);
    const p = point(gx, gz); assert.ok(isWalkable(p.x, p.z)); close(groundHeight(p.x, p.z), 4.72);
    close(flightFloor(p.x, p.z), 4.72);
  }
  const arrival = getDestination(I.id); assert.deepEqual(arrival, pixelDestination(I.id));
  assert.deepEqual(arrival, { x: 120.75, z: 238.75, yaw: Math.PI, y: 4.72 });
  arrival.x = -100; assert.equal(getDestination(I.id).x, 120.75);
  assert.equal(getDestination('pixel-island:120,999,210'), null);
});

test('pixel island: normal exterior walking moves across the meadow without falling to the global zero floor', () => {
  const state = actor(); run(state, { x: 1 }, .5);
  assert.ok(state.x > I.arrival.x + 2.5); close(state.y, 4.72); assert.equal(state.jetpack, false);
  assert.deepEqual(safeLanding(state.x, state.z), { x: state.x, z: state.z });
  close(stoppedVertical(state).y, 4.72);
  assert.equal(pixelCanStep(I.arrival.x, I.arrival.z, state.x, state.z), true);
  assert.equal(pixelCanStep(I.arrival.x, I.arrival.z, 0, 0), false);
  assert.equal(pixelCanStep(0, 0, 1, 1), true);
});

test('pixel island: unedited voxel cliffs block exterior walking and low flight instead of becoming ramps', () => {
  let edge;
  for (let gx = 2; gx < 60 && !edge; gx++) for (let gz = 2; gz < 60; gz++) {
    const h = pixelColumnHeight(gx, gz), right = pixelColumnHeight(gx + 1, gz);
    if (h >= 6 && right >= h + 1) { edge = { gx, gz, h, right }; break; }
  }
  assert.ok(edge);
  const { gx, gz } = edge, center = point(gx, gz);
  const state = actor({ x: I.origin.x + (gx + .98) * I.cell, z: center.z });
  const moved = movePlayer(state, { x: 1 }, .1), boundary = I.origin.x + (gx + 1) * I.cell;
  assert.ok(moved.x < boundary); assert.equal(pixelCanStep(state.x, state.z, boundary + .02, state.z), false);
  const nextFloor = pixelGroundHeight(boundary + .02, state.z);
  assert.ok(nextFloor > state.y); close(flightFloor(boundary + .02, state.z), nextFloor);
  const airborne = { ...state, jetpack: true, y: state.y + .1 };
  Object.assign(airborne, stepAvatar(airborne, { x: 1, hover: true }, .1));
  assert.ok(airborne.x < boundary);
});

test('pixel island: jump trajectories use relative support at both the meadow and high northern snow', () => {
  const snowy = point(38, 18);
  assert.ok(pixelColumnHeight(38, 18) >= 19);
  for (const p of [I.arrival, snowy]) {
    const state = actor(p), floor = state.y;
    Object.assign(state, startAvatarJump(state)); let peak = floor;
    for (let n = 0; n < 156; n++) {
      Object.assign(state, stepAvatar(state, {}, 1 / 120));
      peak = Math.max(peak, state.y); assert.ok(state.y >= floor);
    }
    close(peak - floor, JUMP_MAX_HEIGHT, .002); close(state.y, floor);
    assert.equal(state.vy, 0); assert.equal(state.jetpack, false); assert.ok(startAvatarJump(state));
  }
});

test('pixel island: jetpack launch, hover and landing return to elevated walking at varied frame rates', () => {
  for (const fps of [15, 60, 120]) {
    const state = actor(), floor = state.y;
    run(state, { thrust: true }, 2, fps); assert.ok(state.y > floor + 10);
    const height = state.y; run(state, { hover: true }, 1, fps); close(state.y, height);
    run(state, {}, 5, fps); close(state.y, floor); assert.equal(state.jetpack, false); assert.equal(state.hovering, false);
    run(state, { z: -.5 }, .5, fps); close(state.y, 4.72);
  }
});

test('pixel island: existing follow camera keeps its target on the island and respects the elevated support', () => {
  const p = actor(), target = followTarget(p, 1280);
  close(target.x, p.x); close(target.z, p.z - 2.5); close(target.y, p.y + 1.2);
  const camera = closeThirdPersonCamera(p, 0, .12);
  assert.ok(camera.position.x > 72 && camera.position.z > 162);
  assert.ok(camera.position.y > pixelGroundHeight(camera.position.x, camera.position.z));
});

test('pixel island: town/other islands and public coordinate boundaries remain unchanged', () => {
  assert.deepEqual(WORLD_BOUNDS, { minX: -42.9, maxX: 42.9, minZ: -38.9, maxZ: 40.3 });
  assert.deepEqual(EXPLORATION_BOUNDS, { minX: -138, maxX: 455, minZ: -415, maxZ: 270 });
  assert.deepEqual([WORLD_SIZE.width, WORLD_SIZE.depth, STREETS.length], [96, 87, 10]);
  assert.deepEqual(getDestination('center'), { x: 0, z: 9.5, yaw: Math.PI });
  assert.deepEqual(getDestination(METRO_ISLAND.id), { ...METRO_ISLAND.arrival, y: 0 });
  const natural = getDestination(REALISTIC_ISLAND.id);
  close(natural.y, islandHeight(natural.x, natural.z));
  const town = actor(SPAWN); run(town, { z: .5 }, .5); close(town.y, 0); assert.equal(town.jetpack, false);
  assert.equal(isWalkable(0, 2), false); assert.equal(isWalkable(120, 160), false);
  assert.equal(validInput({ x: 0, z: 0, seq: 1, y: 42 }), false);
});

test('pixel island: room authority uses only the static named entrance and preserves support on drop/reconnect', () => {
  let now = 1000;
  const Room = makeTownRoom({ identity: {}, roomCodes: new Map(), now: () => now });
  const room = Object.create(Room.prototype), player = { ...actor(SPAWN), connected: true, seq: -1 };
  Object.defineProperty(room, 'state', { value: { tick: 0, serverTime: now, players: new Map([['pilot', player]]) } });
  room.inputs = new Map(); room.controls = new Map([['pilot', { seq: -1, travelAt: -Infinity, noticesAt: -Infinity, invalid: 0 }]]);
  room.trace = () => {}; room.allowReconnection = () => Promise.resolve(); room.hasReservedSeat = () => true;
  const messages = [], client = { sessionId: 'pilot', send(type, payload) { messages.push([type, payload]); }, leave() {} };
  room.receiveTravel(client, { id: I.id }); close(player.y, 4.72); close(player.x, I.arrival.x);
  room.onDrop(client, 1001); assert.equal(player.connected, false); close(player.y, 4.72);
  room.onReconnect(client); assert.equal(player.connected, true); close(player.y, 4.72);
  room.receiveTravel(client, { id: I.id, x: 0, y: 999, z: 0 }); close(player.y, 4.72); assert.ok(messages.length > 0);
  now += 600; room.receiveTravel(client, { id: 'center' }); close(player.y, 0); close(player.x, 0);
});
