import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WONDER_CYCLE_MS, WONDERS, WONDER_BRIDGES, inWonderGround, wonderSolid, sampleWonder, sampleOrca, sampleJet, sampleRocket } from '../shared/wonders.js';
import { getDestination, isWalkable, movePlayer, SPAWN } from '../shared/world.js';
import { sampleWorldTime } from '../src/lib/useWorldClock.js';
import { followTarget, cameraTarget, cameraZoom } from '../src/components/town/camera.js';
import { DAY_NIGHT_CYCLE_MS } from '../shared/dayNight.js';
import { auditSources } from '../scripts/check-readability.mjs';

test('three islands have unique approved arrivals and deterministic schedules', () => {
  assert.equal(WONDER_CYCLE_MS, 180000);
  assert.equal(WONDER_CYCLE_MS, DAY_NIGHT_CYCLE_MS, 'wrapped shared clock and show cycle remain compatible');
  assert.deepEqual(WONDERS.map(w => w.id), ['orca', 'carrier', 'rocket']);
  for (const w of WONDERS) {
    const dest = getDestination(w.id);
    assert.deepEqual(dest, w.arrival);
    assert.ok(isWalkable(dest.x, dest.z));
    assert.ok(sampleWonder(w.id, w.start).active);
    assert.equal(sampleWonder(w.id, w.start + w.duration).active, false);
    assert.equal(sampleWonder(w.id, w.start + w.duration).nextIn, WONDER_CYCLE_MS - w.duration);
    assert.deepEqual(sampleWonder(w.id, w.start + 1000), sampleWonder(w.id, w.start + WONDER_CYCLE_MS + 1000));
    for (let t = 0; t < WONDER_CYCLE_MS; t += 1000) assert.ok(WONDERS.filter(item => sampleWonder(item.id, t).active).length <= 1, 'shows are staggered');
  }
  assert.equal(sampleWonder('invalid', 0), null);
});

test('all wonder arrivals and walking bridges are reachable from the original town spawn', () => {
  const queue = [[Math.round(SPAWN.x), Math.round(SPAWN.z)]], seen = new Set([queue[0].join(',')]);
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, key = `${nx},${nz}`;
      if (!seen.has(key) && isWalkable(nx, nz) && isWalkable(x + dx * 0.5, z + dz * 0.5)) { seen.add(key); queue.push([nx, nz]); }
    }
  }
  for (const w of WONDERS) assert.ok(seen.has(`${w.arrival.x},${w.arrival.z}`), w.id);
  for (const bridge of WONDER_BRIDGES) assert.ok(seen.has(`${Math.round(bridge.x)},${bridge.z}`), `bridge ${bridge.id}`);
});

test('sea, pool, gantry and parked aircraft are solid; player cannot tunnel into water', () => {
  for (const [x, z] of [[-64, 19], [0, -61], [5.6, -63], [69.5, 21], [69, 10], [69, 31], [48, 15], [76, 22], [-79, 17], [0, -76], [50, -20]]) assert.equal(isWalkable(x, z), false, `${x},${z}`);
  assert.equal(isWalkable(-79, 20), true, 'the new visible sphere bridge crosses this former sea point');
  for (const x of [NaN, Infinity, '63', null]) assert.equal(inWonderGround(x, 20), false);
  let player = getDestination('orca');
  for (let i = 0; i < 100; i++) { player = movePlayer(player, { x: -1, z: 0 }, 0.1); assert.ok(isWalkable(player.x, player.z)); }
  assert.ok(player.x > -56, 'pool edge stops the player');
  player = getDestination('carrier');
  for (let i = 0; i < 100; i++) { player = movePlayer(player, { x: 1, z: 0 }, 0.1); assert.ok(isWalkable(player.x, player.z)); }
  assert.ok(player.x <= 72, 'carrier deck edge stops player');
  assert.ok(wonderSolid(0, -61));
});

test('camera follows players outside the old town, not the old map edge', () => {
  for (const w of WONDERS) for (const width of [390, 1280]) {
    const camera = followTarget(w.arrival, width);
    assert.equal(camera.x, w.arrival.x);
    assert.ok(Math.abs(camera.z - w.arrival.z) <= 2.5);
  }
});

test('orca jumps, jet takeoff and rocket ignition/ascent have measurable trajectories', () => {
  assert.ok(sampleOrca(9700).y > 4);
  assert.equal(sampleOrca(9700, 0, true).y, -0.48);
  assert.ok(sampleJet(74000).y > 5);
  assert.equal(sampleJet(74000, true).y, 0.8);
  assert.equal(sampleRocket(129999).flame, false);
  assert.equal(sampleRocket(130000).flame, true);
  assert.ok(sampleRocket(145000).height > 20);
  assert.equal(sampleRocket(145000, true).height, 0);
  assert.equal(sampleRocket(145000, true).flame, false);
  assert.equal(sampleRocket(152000).visible, false);
  assert.equal(sampleRocket(160000).visible, true);
});

test('opt-in observation frames the right island and follows the launched rocket', () => {
  assert.equal(cameraTarget('wonder', getDestination('orca'), 390, 0).x, -64);
  assert.equal(cameraTarget('wonder', getDestination('carrier'), 1280, 0).x, 63);
  const pad = cameraTarget('wonder', getDestination('rocket'), 1280, 120000);
  const flying = cameraTarget('wonder', getDestination('rocket'), 1280, 145000);
  assert.ok(flying.y - pad.y > 20);
  for (const width of [390, 1280]) assert.ok(cameraZoom('wonder', width, 844) < cameraZoom('follow', width, 844));
});

test('ten second launch countdown, all phases, wrap and malformed times are safe', () => {
  assert.equal(sampleWonder('rocket', 120000).countdown, 10);
  assert.equal(sampleWonder('rocket', 129900).countdown, 1);
  assert.equal(sampleWonder('rocket', 130000).countdown, null);
  assert.equal(sampleWonder('rocket', 130000).phase, 'ignition');
  assert.equal(sampleWonder('rocket', 133000).phase, 'ascent');
  for (const fn of [sampleOrca, sampleJet, sampleRocket]) for (let time = 0; time < 180000; time += 137) {
    const a = fn(time), b = fn(time + 180000);
    assert.deepEqual(a, b);
    for (const value of Object.values(a)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
  for (const t of [NaN, Infinity, undefined, -1]) for (const w of WONDERS) assert.ok(Number.isFinite(sampleWonder(w.id, t).elapsed));
});

test('same server timestamp yields the same show despite client OS clocks or receipt delay', () => {
  const a = sampleWorldTime({ snapshot: { serverTime: 145000, receivedAtPerf: 100 }, nowPerf: 600, fallbackEpoch: 1, fallbackPerf: 0 });
  const b = sampleWorldTime({ snapshot: { serverTime: 145400, receivedAtPerf: 9000 }, nowPerf: 9100, fallbackEpoch: 99999999, fallbackPerf: 0 });
  assert.equal(a, b);
  for (const fn of [sampleOrca, sampleJet, sampleRocket]) assert.deepEqual(fn(a), fn(b));
});

test('wonder typography is covered by the repeatable project readability guard', () => {
  const paths = ['src/styles.css', 'src/components/wonders.css', 'src/components/WonderSchedule.jsx', 'src/components/town/WonderIslands.jsx'];
  const sources = paths.map(path => ({ path, content: fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8') }));
  assert.deepEqual(auditSources(sources).issues, []);
  const scene = sources[3].content;
  assert.doesNotMatch(scene, /setInterval|Date\.now|Math\.random|distanceFactor/);
});
