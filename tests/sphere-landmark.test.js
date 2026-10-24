import {inRailStation} from '../shared/space-layout.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPHERE_LANDMARK as S, SPHERE_BRIDGE as B, SPHERE_ARRIVAL, SPHERE_MODES, inSphereGround, sphereSolid, sphereFlightFloor, sphereDestination } from '../shared/sphere-landmark.js';
import { WORLD_BOUNDS, WORLD_SIZE, WORLD_VERSION, WORLD_LOCATIONS, TREE_POSITIONS, FOUNTAIN, STREETS, SPAWN, isWalkable, getDestination, movePlayer } from '../shared/world.js';
import { EXPLORATION_BOUNDS, inWonderGround, wonderSolid } from '../shared/wonders.js';
import { inGptGround, gptSolid } from '../shared/gpt-park.js';
import { inParkGround, parkSolid } from '../shared/deepseek-park.js';
import { onRiverPier } from '../shared/river.js';
import { flightFloor, stepAvatar, safeLanding } from '../shared/jetpack.js';
import { followTarget, followOrbitCamera } from '../src/components/town/camera.js';

const run = (state, input, seconds, fps = 60) => { for (let t = 0; t < seconds - 1e-9; t += 1 / fps) state = { ...state, ...stepAvatar(state, input, Math.min(1 / fps, seconds - t)) }; return state; };
const start = (x, z, y = 0) => ({ x, z, y, yaw: 0, vy: 0, jetpack: y > 0, thrusting: false, hovering: false });

test('sphere contract freezes one location, cut base, bridge and five named display modes inside existing bounds', () => {
  for (const value of [S, B, SPHERE_ARRIVAL, SPHERE_MODES, ...SPHERE_MODES]) assert.ok(Object.isFrozen(value));
  assert.deepEqual([S.id, S.name, S.x, S.z, S.radius, S.centerY, S.baseY, S.groundRadius, S.faceYaw], ['sphere', '球幕剧场', -108, 10, 18, 11.8, 2, 27, 1.2]);
  assert.deepEqual(SPHERE_MODES.map(item => item.id), ['auto', 'smile', 'eye', 'earth', 'basketball']);
  assert.ok(SPHERE_MODES.every(item => typeof item.name === 'string' && item.name.length));
  assert.ok(S.x - S.groundRadius >= EXPLORATION_BOUNDS.minX && S.x + S.groundRadius <= EXPLORATION_BOUNDS.maxX);
  assert.ok(S.z - S.groundRadius >= EXPLORATION_BOUNDS.minZ && S.z + S.groundRadius <= EXPLORATION_BOUNDS.maxZ);
  assert.deepEqual(getDestination('sphere'), SPHERE_ARRIVAL); assert.equal(sphereDestination('orca'), null);
  const destination = sphereDestination('sphere'); destination.x = 0; assert.equal(SPHERE_ARRIVAL.x, -87.8);
});

test('only visible round island and bridge decks become walkable, not an invisible square of sea', () => {
  assert.equal(inSphereGround(S.x, S.z), true); assert.equal(isWalkable(S.x, S.z), false);
  for (let i = 0; i < 360; i++) {
    const angle = i * Math.PI / 180;
    assert.ok(isWalkable(S.x + Math.cos(angle) * 24, S.z + Math.sin(angle) * 24));
    const x = S.x + Math.cos(angle) * 27.1, z = S.z + Math.sin(angle) * 27.1;
    if (!(Math.abs(x - B.x) <= B.width / 2 && Math.abs(z - B.z) <= B.depth / 2)) assert.equal(inSphereGround(x, z), false);
  }
  for (const [x, z] of [[-134, -16], [-134, 36], [-90, 35], [-94, -14], [-80, 16], [-80, 28]]) assert.equal(isWalkable(x, z), false, `sea ${x},${z}`);
  for (const value of [NaN, Infinity, -Infinity, null, '0']) {
    assert.equal(inSphereGround(value, 10), false); assert.equal(sphereSolid(-108, value), false); assert.equal(sphereFlightFloor(value, 10), 0);
  }
});

test('the entire new bridge misses the orca pool, and a real walking route connects old bay to arrival', () => {
  for (let x = B.x - B.width / 2; x <= B.x + B.width / 2; x += .2) for (let z = B.z - B.depth / 2; z <= B.z + B.depth / 2; z += .2) assert.equal(wonderSolid(x, z), false);
  const route = [[-53, 22], [-53, 27], [-74, 27], [-74, 22], [SPHERE_ARRIVAL.x, SPHERE_ARRIVAL.z]];
  let state = { x: route[0][0], z: route[0][1], yaw: 0 };
  for (const [x, z] of route.slice(1)) {
    let steps = 0;
    while (Math.hypot(x - state.x, z - state.z) > .09 && steps++ < 1000) {
      const distance = Math.hypot(x - state.x, z - state.z);
      state = movePlayer(state, { x: (x - state.x) / distance, z: (z - state.z) / distance }, Math.min(1 / 60, distance / 5.2));
      assert.ok(isWalkable(state.x, state.z));
    }
    assert.ok(steps < 1000, `route blocked before ${x},${z}`);
  }
  assert.ok(Math.hypot(state.x - SPHERE_ARRIVAL.x, state.z - SPHERE_ARRIVAL.z) < .09);
});

test('ground collision excludes the complete overhanging sphere and the flight floor follows its curved roof', () => {
  const values = [];
  for (const d of [0, 5, 10, 14, 17.9, 18.3]) {
    const expected = S.centerY + Math.sqrt(S.radius ** 2 - Math.max(0, d - .35) ** 2) + .2;
    for (const angle of [0, 1, 2, 3, 4, 5]) {
      const x = S.x + Math.cos(angle) * d, z = S.z + Math.sin(angle) * d;
      assert.equal(sphereSolid(x, z), true); assert.equal(isWalkable(x, z), false);
      assert.ok(Math.abs(sphereFlightFloor(x, z) - expected) < 1e-10);
      assert.equal(flightFloor(x, z), sphereFlightFloor(x, z));
      if (d <= S.radius) assert.ok(sphereFlightFloor(x, z) > S.centerY + Math.sqrt(S.radius ** 2 - d ** 2));
    }
    values.push(expected);
  }
  assert.equal(values[0], 30); assert.ok(values.every((value, i) => i === 0 || value < values[i - 1]));
  assert.equal(sphereFlightFloor(S.x + 18.36, S.z), 0); assert.ok(isWalkable(S.x + 18.36, S.z));
  const walked = movePlayer({ x: S.x + 19, z: S.z, yaw: 0 }, { x: -1, z: 0 }, .1);
  assert.ok(walked.x >= S.x + 18.35);
});

test('low flight is blocked, high flight clears the sphere, and descent lands exactly on the curved roof', () => {
  for (const fps of [15, 60, 120]) {
    const low = run(start(S.x + 20, S.z, 6), { x: -1, z: 0, hover: true }, 1, fps);
    assert.ok(low.x >= S.x + 18.35); assert.equal(low.y, 6);
    const high = run(start(S.x + 20, S.z, 35), { x: -1, z: 0, hover: true }, 2.5, fps);
    assert.ok(Math.abs(high.x - S.x) < .00001); assert.equal(high.y, 35);
    const landed = run(high, { x: 0, z: 0 }, 4, fps);
    assert.equal(landed.y, flightFloor(landed.x, landed.z)); assert.equal(landed.vy, 0); assert.equal(landed.rescued, false);
    const side = run(start(S.x + 10, S.z, 35), { x: 0, z: 0 }, 4, fps);
    assert.equal(side.y, sphereFlightFloor(side.x, side.z)); assert.ok(side.y < 30);
  }
  const rescued = safeLanding(S.x, S.z); assert.ok(isWalkable(rescued.x, rescued.z)); assert.ok(inSphereGround(rescued.x, rescued.z));
});

test('external following recognizes the new island without clamping people back to the old town', () => {
  for (const width of [390, 1280]) {
    const target = followTarget({ ...SPHERE_ARRIVAL, y: 0, jetpack: false }, width);
    assert.equal(target.x, SPHERE_ARRIVAL.x); assert.equal(target.z, SPHERE_ARRIVAL.z - (width < 700 ? 1.5 : 2.5));
    const pose = { x: S.x + 19, z: S.z, y: 0 };
    const camera = followOrbitCamera(pose, Math.PI / 2, .35, { aspect: width / 720 });
    assert.ok(camera.clipped); assert.ok(camera.position.x > S.x + 18.35);
  }
});

test('the pre-existing map, streets and walkability outside new real ground are unchanged', () => {
  assert.equal(WORLD_VERSION, 3); assert.equal(WORLD_SIZE.width, 96); assert.equal(WORLD_SIZE.depth, 87);
  assert.deepEqual(WORLD_BOUNDS, { minX: -42.9, maxX: 42.9, minZ: -38.9, maxZ: 40.3 });
  assert.equal(STREETS.length, 10); assert.deepEqual(getDestination('center'), { x: 0, z: 9.5, yaw: Math.PI }); assert.ok(isWalkable(SPAWN.x, SPAWN.z));
  const legacy = (x, z) => {
    const town = x >= WORLD_BOUNDS.minX && x <= WORLD_BOUNDS.maxX && z >= WORLD_BOUNDS.minZ && z <= WORLD_BOUNDS.maxZ;
    if (!town && !inWonderGround(x, z) && !inGptGround(x, z) && !inParkGround(x, z) && !onRiverPier(x, z)) return false;
    if (wonderSolid(x, z) || gptSolid(x, z) || parkSolid(x, z) || Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < FOUNTAIN.radius) return false;
    if (WORLD_LOCATIONS.some(place => Math.abs(x - place.x) < 3.22 && Math.abs(z - place.z) < 2.8)) return false;
    return !TREE_POSITIONS.some(([tx, tz, scale]) => Math.hypot(x - tx, z - tz) < .5 * scale);
  };
  for (let x = -138; x <= 77; x += 1.1) for (let z = -133; z <= 40.3; z += 1.1) if (!inSphereGround(x, z) && !inRailStation(x,z)) assert.equal(isWalkable(x, z), legacy(x, z), `old geometry changed at ${x},${z}`);
});
