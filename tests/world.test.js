import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../src/lib/catalog.js';
import { WORLD_VERSION, WORLD_SIZE, WORLD_BOUNDS, FOUNTAIN, STREETS, EMPTY_PLOTS, DISTRICTS, PLAYER_SPEED, SPAWN, WORLD_LOCATIONS, TREE_POSITIONS, isWalkable, getDestination, movePlayer } from '../shared/world.js';
import { PROTOCOL_VERSION, MAX_PLAYERS, SERVER_TICK_MS, STATE_PATCH_MS, RECONNECT_SECONDS, INPUT_TIMEOUT_MS, PLAYER_COLORS } from '../shared/protocol.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`);
const inRectangle = (x, z, rect, margin = 0) => Math.abs(x - rect.x) <= rect.width / 2 + margin && Math.abs(z - rect.z) <= rect.depth / 2 + margin;
const onRoad = (x, z) => STREETS.some(street => inRectangle(x, z, street)) || Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) <= FOUNTAIN.plazaRadius;
const rectanglesOverlap = (a, b) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2;

function reachableGrid(allowed = isWalkable) {
  const step = 0.5;
  const start = [Math.round(SPAWN.x / step), Math.round(SPAWN.z / step)];
  const seen = new Set([start.join(',')]);
  const queue = [start];
  assert.ok(allowed(start[0] * step, start[1] * step), 'grid starts on an accessible spawn neighbor');
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const point = [x + dx, z + dz];
      const key = point.join(',');
      if (!seen.has(key) && allowed(point[0] * step, point[1] * step) && allowed((x + dx / 2) * step, (z + dz / 2) * step)) {
        seen.add(key); queue.push(point);
      }
    }
  }
  return point => {
    const x = Math.round(point.x / step), z = Math.round(point.z / step);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!seen.has([x + dx, z + dz].join(','))) continue;
      const nx = (x + dx) * step, nz = (z + dz) * step;
      if (Math.hypot(nx - point.x, nz - point.z) > 0.4) continue;
      if (Array.from({ length: 9 }, (_, i) => i / 8).every(t => allowed(nx + (point.x - nx) * t, nz + (point.z - nz) * t))) return true;
    }
    return false;
  };
}

test('expanded ground and walkable bounds are exactly three times each side and nine times the area', () => {
  assert.equal(WORLD_VERSION, 3);
  assert.deepEqual(WORLD_SIZE, { baseWidth: 32, baseDepth: 29, scale: 3, width: 96, depth: 87, centerX: 0, centerZ: 0.4 });
  close(WORLD_SIZE.width / WORLD_SIZE.baseWidth, 3);
  close(WORLD_SIZE.depth / WORLD_SIZE.baseDepth, 3);
  close(WORLD_SIZE.width * WORLD_SIZE.depth / (WORLD_SIZE.baseWidth * WORLD_SIZE.baseDepth), 9);
  close((WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX) / 28.6, 3);
  close((WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) / 26.4, 3);
  assert.equal(PLAYER_SPEED, 5.2, 'world growth never scales player speed');
  assert.deepEqual(FOUNTAIN, { x: 0, z: 2, radius: 5.9, visualRadius: 5.6, plazaRadius: 11 });
  assert.ok(FOUNTAIN.visualRadius < FOUNTAIN.radius && FOUNTAIN.radius < FOUNTAIN.plazaRadius);
});

test('shared map locations exactly match rendered catalog and every arrival is walkable', () => {
  assert.equal(WORLD_VERSION, 3);
  assert.equal(new Set(WORLD_LOCATIONS.map(place => place.id)).size, GAMES.length);
  assert.deepEqual(WORLD_LOCATIONS.map(place => place.id).sort(), GAMES.map(game => game.id).sort());
  assert.ok(isWalkable(SPAWN.x, SPAWN.z));
  for (let i = 0; i < MAX_PLAYERS; i++) assert.ok(isWalkable(i * 0.75 - 2.625, SPAWN.z), `server spawn ${i}`);
  for (const place of WORLD_LOCATIONS) {
    const game = GAMES.find(item => item.id === place.id);
    assert.deepEqual([place.x, place.z], [game.position[0], game.position[2]]);
    assert.deepEqual([place.doorX, place.doorZ], [game.door[0], game.door[2]]);
    assert.ok(isWalkable(place.doorX, place.doorZ), `${place.id} door`);
    const arrival = getDestination(place.id);
    assert.ok(isWalkable(arrival.x, arrival.z), `${place.id} travel arrival`);
    assert.equal(arrival.yaw, Math.PI);
  }
  assert.ok(isWalkable(getDestination('center').x, getDestination('center').z));
  assert.deepEqual(getDestination('center'), { x: 0, z: 9.5, yaw: Math.PI });
  assert.deepEqual(DISTRICTS.map(district => district.id).sort(), ['east', 'north', 'south', 'west']);
  for (const district of DISTRICTS) {
    const arrival = getDestination(district.id);
    assert.deepEqual(arrival, { x: district.x, z: district.z, yaw: Math.PI });
    assert.ok(isWalkable(arrival.x, arrival.z) && onRoad(arrival.x, arrival.z), `${district.id} street arrival`);
  }
  for (const invalid of ['', 'not-a-game', '__proto__', null, undefined, {}, 12]) assert.equal(getDestination(invalid), null);
});

test('bounds, fountain, every building and every tree are solid', () => {
  for (const [x, z] of [[42.91, 0], [-42.91, 0], [3, -38.91], [0, 40.31], [0, 2], [0, 7.89], [NaN, 0], [Infinity, 0], [0, -Infinity], ['0', 0]]) assert.equal(isWalkable(x, z), false);
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
    assert.equal(isWalkable(FOUNTAIN.x + Math.cos(angle) * 5.89, FOUNTAIN.z + Math.sin(angle) * 5.89), false);
    assert.equal(isWalkable(FOUNTAIN.x + Math.cos(angle) * 5.91, FOUNTAIN.z + Math.sin(angle) * 5.91), true);
  }
  for (const place of WORLD_LOCATIONS) {
    assert.equal(isWalkable(place.x, place.z), false);
    assert.equal(isWalkable(place.x + 3, place.z + 2.5), false);
  }
  for (const [x, z] of TREE_POSITIONS) assert.equal(isWalkable(x, z), false);
});

test('diagonal and huge directions never exceed speed; large delta is bounded', () => {
  const start = { ...SPAWN };
  const diagonal = movePlayer(start, { x: 1, z: 1 }, 0.05);
  close(distance(start, diagonal), PLAYER_SPEED * 0.05);
  const huge = movePlayer(start, { x: 1e8, z: 1e8 }, 0.05);
  close(distance(start, huge), PLAYER_SPEED * 0.05);
  const delta = movePlayer(start, { x: 1, z: 0 }, 999);
  close(distance(start, delta), PLAYER_SPEED * 0.1);
  for (const dt of [NaN, Infinity, -1, undefined]) {
    const result = movePlayer(start, { x: 1, z: 0 }, dt);
    close(distance(start, result), 0);
    assert.equal(result.moving, false);
  }
  const result = movePlayer({ x: NaN, z: Infinity, yaw: NaN }, { x: NaN, z: Infinity }, 0.1);
  assert.deepEqual(result, { ...SPAWN, moving: false });
  assert.deepEqual(start, SPAWN, 'simulation does not mutate its input');
});

test('small simulation substeps prevent tunnelling into shop and fountain and allow wall sliding', () => {
  let actor = getDestination('puzzle');
  for (let i = 0; i < 60; i++) {
    actor = movePlayer(actor, { x: 0, z: -1 }, 5);
    assert.ok(isWalkable(actor.x, actor.z));
  }
  const facadeZ = WORLD_LOCATIONS.find(place => place.id === 'puzzle').z + 2.8;
  assert.ok(actor.z >= facadeZ && actor.z < facadeZ + 0.12, 'shop front stops traversal without scaling the building');
  const slid = movePlayer(actor, { x: 1, z: -1 }, 0.1);
  assert.ok(slid.x > actor.x && isWalkable(slid.x, slid.z), 'player slides along blocked facade');
  actor = getDestination('center');
  for (let i = 0; i < 60; i++) {
    actor = movePlayer(actor, { x: 0, z: -1 }, 0.1);
    assert.ok(isWalkable(actor.x, actor.z));
  }
  assert.ok(actor.z >= FOUNTAIN.z + FOUNTAIN.radius && actor.z < FOUNTAIN.z + FOUNTAIN.radius + 0.12, 'enlarged fountain remains solid');
});

test('all nine destinations and new map edges are reachable from spawn through a half-unit grid', () => {
  const reachable = reachableGrid();
  for (const id of ['center', ...WORLD_LOCATIONS.map(place => place.id), ...DISTRICTS.map(district => district.id)]) {
    const end = getDestination(id);
    assert.ok(reachable(end), `${id} remains connected to spawn`);
  }
  for (const point of [{ x: WORLD_BOUNDS.minX, z: 2 }, { x: WORLD_BOUNDS.maxX, z: 2 }, { x: 0, z: WORLD_BOUNDS.minZ }, { x: 0, z: WORLD_BOUNDS.maxZ }]) {
    assert.ok(isWalkable(point.x, point.z), 'new map boundary is walkable');
    assert.ok(reachable(point), 'new map boundary is connected');
    assert.ok(Math.abs(point.x) > 14.3 || point.z < -12.5 || point.z > 13.9, 'tested boundary lies outside old map');
  }
});

test('street rectangles form a connected road network around the landmark plaza', () => {
  assert.equal(STREETS.length, 10);
  assert.equal(new Set(STREETS.map(street => street.id)).size, STREETS.length);
  const reachable = reachableGrid((x, z) => isWalkable(x, z) && onRoad(x, z));
  for (const street of STREETS) {
    assert.ok(['main', 'ring', 'side'].includes(street.kind));
    assert.ok(street.name && street.width > 0 && street.depth > 0);
    const vertical = street.depth > street.width;
    const length = vertical ? street.depth : street.width;
    for (let d = -length / 2 + 0.5; d <= length / 2 - 0.5; d += 0.5) {
      const point = { x: street.x + (vertical ? 0 : d), z: street.z + (vertical ? d : 0) };
      if (Math.hypot(point.x - FOUNTAIN.x, point.z - FOUNTAIN.z) < FOUNTAIN.radius) continue;
      assert.ok(isWalkable(point.x, point.z), `${street.id} centerline is not obstructed`);
      assert.ok(reachable(point), `${street.id} road is connected without crossing unpaved plots`);
    }
  }
  for (const [x, z, scale] of TREE_POSITIONS) {
    assert.ok(STREETS.every(street => !inRectangle(x, z, street, 0.5 * scale)), 'trees stay clear of road edges');
  }
});

test('empty plots are readable expansion placeholders, not buildings or road obstacles', () => {
  assert.ok(EMPTY_PLOTS.length >= 16);
  assert.equal(new Set(EMPTY_PLOTS.map(plot => plot.id)).size, EMPTY_PLOTS.length);
  for (const plot of EMPTY_PLOTS) {
    assert.ok(plot.width > 0 && plot.depth > 0 && DISTRICTS.some(district => district.id === plot.district));
    assert.ok(isWalkable(plot.x, plot.z), `${plot.id} stays traversable`);
    assert.ok(STREETS.every(street => !rectanglesOverlap(plot, street)), `${plot.id} avoids streets`);
    assert.ok(WORLD_LOCATIONS.every(place => !rectanglesOverlap(plot, { ...place, width: 6.44, depth: 5.6 })), `${plot.id} avoids existing venues`);
    const nearestX = Math.max(Math.abs(plot.x - FOUNTAIN.x) - plot.width / 2, 0);
    const nearestZ = Math.max(Math.abs(plot.z - FOUNTAIN.z) - plot.depth / 2, 0);
    assert.ok(Math.hypot(nearestX, nearestZ) > FOUNTAIN.plazaRadius, `${plot.id} avoids landmark plaza`);
  }
});

test('protocol has enough unique player colors and coherent timing bounds', () => {
  assert.equal(PROTOCOL_VERSION, 9);
  assert.equal(MAX_PLAYERS, 8);
  assert.equal(new Set(PLAYER_COLORS).size, MAX_PLAYERS);
  assert.ok(PLAYER_COLORS.every(color => /^#[0-9a-f]{6}$/i.test(color)));
  assert.ok(STATE_PATCH_MS >= SERVER_TICK_MS);
  assert.ok(INPUT_TIMEOUT_MS >= SERVER_TICK_MS * 2 && INPUT_TIMEOUT_MS < 1000);
  assert.ok(RECONNECT_SECONDS >= 5 && RECONNECT_SECONDS <= 30);
});
