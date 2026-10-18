import test from 'node:test';
import assert from 'node:assert/strict';
import { createDroneFleet } from '../shared/droneShow.js';
import { DROPLET_CHAPTERS, DROPLET_SCORE, DROPLET_SHIPS, DROPLET_DURATION, DROPLET_CYCLE,
  sampleDropletShow, sampleDropletHead, sampleDoomsdayShip, updateDropletFleet } from '../shared/droneDroplet.js';
const close = (a, b, eps = .00001) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('the human fleet story retains all 150-second show and 180-second cycle phases', () => {
  assert.equal(DROPLET_DURATION, 150000); assert.equal(DROPLET_CYCLE, 180000);
  assert.deepEqual(DROPLET_CHAPTERS.map(c => c.id), ['lighting', 'ascent', 'fleet', 'droplet', 'warning', 'strike', 'suspense', 'collapse', 'silence', 'returning', 'landing', 'blackout', 'waiting']);
  for (let i = 0; i < DROPLET_CHAPTERS.length; i++) {
    const chapter = DROPLET_CHAPTERS[i];
    assert.equal(sampleDropletShow(chapter.start).phase, chapter.id);
    if (i) assert.equal(chapter.start, DROPLET_CHAPTERS[i - 1].end);
  }
  assert.match(sampleDropletShow(90000).label, /人类舰队/);
  assert.match(sampleDropletShow(30000).description, /并非原著舰数/);
  assert.match(sampleDropletShow(110000).description, /不是全人类/);
  assert.equal(sampleDropletShow(150000).active, false);
  assert.equal(sampleDropletShow(150000).nextIn, 30000);
  for (const t of [0, 14000, 67555, 110000, 150000]) assert.deepEqual(sampleDropletShow(t), sampleDropletShow(t + DROPLET_CYCLE));
  assert.deepEqual(sampleDropletShow(-1000), sampleDropletShow(179000));
  for (const t of [NaN, Infinity, undefined]) assert.equal(sampleDropletShow(t).elapsed, 0);
});

test('all 4096 recoverable identities form an exact 16 cubed lattice with no drone probe role', () => {
  const fleet = createDroneFleet(); updateDropletFleet(fleet, 30000);
  const coordinates = [new Set(), new Set(), new Set()], points = new Set();
  for (let i = 0; i < fleet.count; i++) {
    const p = Array.from(fleet.positions.subarray(i * 3, i * 3 + 3));
    p.forEach((n, axis) => coordinates[axis].add(n)); points.add(p.join(','));
  }
  assert.equal(points.size, 4096);
  for (const set of coordinates) assert.equal(set.size, 16);
  assert.deepEqual([Math.min(...coordinates[0]), Math.max(...coordinates[0])], [-75, 75]);
  assert.deepEqual([Math.min(...coordinates[1]), Math.max(...coordinates[1])], [55, 205]);
  assert.deepEqual([Math.min(...coordinates[2]), Math.max(...coordinates[2])], [-125, 25]);
  assert.ok(fleet.dropletBuffers.roles.every(role => role === 0));
  assert.equal(new Set(fleet.dropletBuffers.shipIndices).size, 216);
  const hold = fleet.positions.slice(); updateDropletFleet(fleet, 35999); assert.deepEqual(fleet.positions, hold);
});

test('216 representative ships occupy a 6 cubed 150-unit volume with 17.05-unit hulls', () => {
  assert.equal(DROPLET_SHIPS.length, 216); assert.equal(DROPLET_SCORE.ships, 216);
  const axes = [new Set(), new Set(), new Set()];
  for (const ship of DROPLET_SHIPS) ship.position.forEach((n, i) => axes[i].add(n));
  for (const axis of axes) assert.equal(axis.size, 6);
  assert.deepEqual(axes.map(s => Math.max(...s) - Math.min(...s)), [150, 150, 150]);
  const fleet = createDroneFleet(); updateDropletFleet(fleet, 44000);
  for (let ship = 0; ship < 216; ship++) {
    const xs = [];
    for (let i = 0; i < fleet.count; i++) if (fleet.dropletBuffers.shipIndices[i] === ship) xs.push(fleet.positions[i * 3]);
    assert.ok(xs.length >= 18 && xs.length <= 19);
    close(Math.max(...xs) - Math.min(...xs), 17.05, .00002);
  }
  assert.ok(fleet.colors.every(n => n === 0), 'morph lights disappear behind solid ships, not a dotted probe');
});

test('cube morphs continuously into hulls while solid ship opacity rises, without reviving wrecks', () => {
  const fleet = createDroneFleet(); updateDropletFleet(fleet, 36000); const cube = fleet.positions.slice();
  updateDropletFleet(fleet, 40000); assert.notDeepEqual(fleet.positions, cube);
  assert.equal(sampleDoomsdayShip(0, 36000)[4], 0);
  assert.ok(sampleDoomsdayShip(0, 41000)[4] > 0 && sampleDoomsdayShip(0, 41000)[4] < 1);
  assert.equal(sampleDoomsdayShip(0, 44000)[4], 1);
  for (const t of [114000, 126000, 149000, 179000]) {
    const ship = sampleDoomsdayShip(0, t);
    assert.equal(ship[3], 0); assert.equal(ship[4], 0); assert.equal(ship[6], 0);
  }
});

test('mirror probe is separate from drone geometry, holds its closeup, and has a reusable normalized 3D pose', () => {
  const output = new Float64Array(8), returned = sampleDropletHead(55000, output);
  assert.equal(returned, output); assert.deepEqual(Array.from(output), [0, 135, 65, 0, 4, 1, 0, 0]);
  assert.deepEqual(sampleDropletHead(50000), sampleDropletHead(59999));
  assert.deepEqual(sampleDropletHead(108000), sampleDropletHead(113999));
  assert.equal(sampleDropletHead(30000)[4], 0);
  assert.equal(sampleDropletHead(116000)[4], 0);
  for (let t = 64000; t < 104000; t += 31) {
    sampleDropletHead(t, output); close(Math.hypot(output[5], output[6], output[7]), 1);
    close(output[4], 1.4);
  }
  const legacy = new Float64Array(5); sampleDropletHead(55000, legacy);
  assert.deepEqual(Array.from(legacy), [0, 135, 65, 0, 4]);
});

test('all 216 center hits exactly coincide with the fast straight-line probe and have genuine delayed explosions', () => {
  const order = [...DROPLET_SHIPS].sort((a, b) => a.hitTime - b.hitTime);
  assert.deepEqual(order.slice(0, 12).map(s => s.index), [0, 1, 2, 3, 4, 5, 11, 10, 9, 8, 7, 6]);
  for (const ship of DROPLET_SHIPS) {
    const head = sampleDropletHead(ship.hitTime * 1000);
    for (let axis = 0; axis < 3; axis++) close(head[axis], ship.position[axis]);
    const delay = ship.explodeTime - ship.hitTime;
    assert.equal(delay, DROPLET_SCORE.explosionDelay / 1000);
    const before = sampleDoomsdayShip(ship.index, ship.hitTime * 1000 - .01);
    assert.equal(before[4], 1); assert.equal(before[5], 0); assert.equal(before[6], 0); assert.equal(before[7], 0);
    const penetrated = sampleDoomsdayShip(ship.index, (ship.hitTime + .2) * 1000);
    assert.equal(penetrated[4], 1); assert.ok(penetrated[5] > 0); assert.equal(penetrated[6], 0); assert.equal(penetrated[7], 0);
    const delayed = sampleDoomsdayShip(ship.index, ship.explodeTime * 1000 - .01);
    assert.equal(delayed[6], 0); assert.equal(delayed[7], 0);
    const explosion = sampleDoomsdayShip(ship.index, ship.explodeTime * 1000 + 100);
    assert.ok(explosion[6] > .9); assert.ok(explosion[7] > 0); assert.ok(explosion[4] < 1);
  }
  assert.ok(order[0].hitTime > 64 && order.at(-1).hitTime < 76.53);
  assert.ok(DROPLET_SHIPS.every(s => s.explodeTime < 104));
});

test('all 36 passes are linear at constant speed; 35 sharp exterior corners change direction instantly without circular easing', () => {
  assert.equal(DROPLET_SCORE.passes.length, 36);
  for (let row = 0; row < 36; row++) {
    const [start, end] = DROPLET_SCORE.passes[row];
    close(end - start, .28);
    const a = sampleDropletHead((start + .05) * 1000), b = sampleDropletHead((start + .1) * 1000), c = sampleDropletHead((start + .15) * 1000);
    close(b[0] - a[0], c[0] - b[0]); close(a[1], b[1]); close(a[2], b[2]);
    assert.ok(Math.abs(b[0] - a[0]) > 20, 'probe crosses quickly, rather than gliding among ships');
    if (row === 35) continue;
    const nextStart = DROPLET_SCORE.passes[row + 1][0]; close(nextStart - end, DROPLET_SCORE.turnSeconds);
    const pivot = end + DROPLET_SCORE.turnSeconds / 2;
    const before = sampleDropletHead((pivot - .000001) * 1000), after = sampleDropletHead((pivot + .000001) * 1000);
    assert.ok(Math.hypot(...[0, 1, 2].map(axis => after[axis] - before[axis])) < .003, 'position is continuous despite the faster turn');
    const dot = before[5] * after[5] + before[6] * after[6] + before[7] * after[7];
    assert.ok(dot < -.6, 'velocity has a sharp discontinuity at an acute interior corner');
    close(Math.abs(sampleDropletHead(pivot * 1000)[0]), DROPLET_SCORE.turnApex);
  }
});

test('penetration is 2.5 times faster, with one exact 13.64-second delay for every vessel', () => {
  const previousSpeed = 300 / .7;
  for (const [start, end] of DROPLET_SCORE.passes) {
    const a = sampleDropletHead((start + .1) * 1000);
    const b = sampleDropletHead((start + .2) * 1000);
    const speed = Math.hypot(...[0, 1, 2].map(axis => b[axis] - a[axis])) / .1;
    close(speed, 300 / .28);
    close(speed / previousSpeed, 2.5);
    close(end - start, .28);
  }
  for (const ship of DROPLET_SHIPS) {
    const delayed = sampleDoomsdayShip(ship.index, (ship.hitTime + 13.639) * 1000);
    assert.equal(delayed[4], 1, 'every penetrated ship remains intact for the common delay');
    assert.equal(delayed[6], 0, 'no explosion may start before its translated hit time');
    assert.equal(delayed[7], 0, 'no fragments may move before the common delay');
  }
  assert.deepEqual([...new Set(DROPLET_SHIPS.map(ship => ship.explodeTime - ship.hitTime))], [13.64]);
  close(DROPLET_SCORE.attackEnd, 76530);
  close(Math.max(...DROPLET_SHIPS.map(ship => ship.explodeTime)), 90.1);
});

test('all explosions happen after all 216 hits, preserving EVERY pairwise hit interval exactly', () => {
  const lastHit = Math.max(...DROPLET_SHIPS.map(ship => ship.hitTime));
  const firstExplosion = Math.min(...DROPLET_SHIPS.map(ship => ship.explodeTime));
  assert.ok(firstExplosion > lastHit + 1.2);
  assert.equal(firstExplosion * 1000, DROPLET_SCORE.collapseStart);
  assert.equal(lastHit * 1000, DROPLET_SCORE.lastHit);
  for (const a of DROPLET_SHIPS) for (const b of DROPLET_SHIPS) {
    assert.equal(a.explodeTime - b.explodeTime, a.hitTime - b.hitTime, `rhythm mismatch: ships ${a.index}/${b.index}`);
  }
  assert.equal(sampleDropletShow(DROPLET_SCORE.attackEnd).phase, 'suspense');
  assert.equal(sampleDropletShow(DROPLET_SCORE.collapseStart - 1).phase, 'suspense');
  assert.equal(sampleDropletShow(DROPLET_SCORE.collapseStart).phase, 'collapse');
});

test('no normal or reduced-motion ship fades, explodes or scatters before the entire fleet is hit', () => {
  const fleet = createDroneFleet();
  updateDropletFleet(fleet, 50000); const intactPositions = fleet.positions.slice();
  for (const reducedMotion of [false, true]) {
    for (const time of [DROPLET_SCORE.firstHit + 500, DROPLET_SCORE.lastHit - 1, DROPLET_SCORE.lastHit + 1, DROPLET_SCORE.collapseStart - 1]) {
      for (const ship of DROPLET_SHIPS) {
        const state = sampleDoomsdayShip(ship.index, time, undefined, { reducedMotion });
        assert.equal(state[4], 1); assert.equal(state[6], 0); assert.equal(state[7], 0);
      }
      updateDropletFleet(fleet, time, { reducedMotion });
      assert.deepEqual(fleet.positions, intactPositions);
    }
    for (const ship of DROPLET_SHIPS) {
      assert.equal(sampleDoomsdayShip(ship.index, ship.explodeTime * 1000 - 1, undefined, { reducedMotion })[4], 1);
      assert.ok(sampleDoomsdayShip(ship.index, ship.explodeTime * 1000 + 500, undefined, { reducedMotion })[4] < 1);
    }
  }
});

test('the accelerated attack flows continuously into its visible aftermath, then holds without a long empty gap', () => {
  const end = DROPLET_SCORE.attackEnd;
  for (const time of [64000, end, end + 600, 104000, 108000, 114000, 116000]) {
    const before = sampleDropletHead(time - .01), after = sampleDropletHead(time + .01);
    assert.ok(Math.hypot(...[0, 1, 2].map(axis => after[axis] - before[axis])) < .02, `probe teleports at ${time}`);
    assert.ok(Math.abs(after[4] - before[4]) < .001);
  }
  for (let time = end; time < 108000; time += 1000) {
    const a = sampleDropletHead(time), b = sampleDropletHead(time + 500);
    assert.ok(a[4] > 0 && b[4] > 0, 'the mirror probe remains visible during delayed explosions and aftermath');
    assert.ok(Math.hypot(...[0, 1, 2].map(axis => b[axis] - a[axis])) > .01, 'no new long empty waiting interval');
  }
  const lastExplosion = Math.max(...DROPLET_SHIPS.map(ship => ship.explodeTime)) * 1000;
  assert.ok(lastExplosion > end + 2000 && lastExplosion < 99000, 'delayed detonations visibly trail the final passage');
  assert.deepEqual(sampleDropletHead(108000), sampleDropletHead(113999));
});

test('drone debris stays attached until delayed explosion, and no light-cloud impersonates the mirror probe', () => {
  const fleet = createDroneFleet(); updateDropletFleet(fleet, 44000); const b = fleet.dropletBuffers;
  for (const shipIndex of [0, 5, 72, 215]) {
    const index = b.shipIndices.findIndex(s => s === shipIndex), k = index * 3;
    updateDropletFleet(fleet, b.explodeTimes[index] * 1000 - .01);
    for (let axis = 0; axis < 3; axis++) close(fleet.positions[k + axis], b.anchors[k + axis] + b.offsets[k + axis]);
    updateDropletFleet(fleet, b.explodeTimes[index] * 1000 + 1500);
    assert.ok(Math.hypot(...[0, 1, 2].map(axis => fleet.positions[k + axis] - b.anchors[k + axis] - b.offsets[k + axis])) > .1);
  }
  updateDropletFleet(fleet, 110000);
  assert.ok(fleet.colors.every(value => value === 0));
  assert.ok(sampleDropletHead(110000)[4] > 0, 'only the separate mirror object remains visible');
});

test('all drone positions stay finite, continuous and bounded through cube, destruction and return', () => {
  const fleet = createDroneFleet();
  const boundaries = [...DROPLET_CHAPTERS.map(c => c.start), 36000, 38000, 40000, 42000, 50000, 108000];
  for (const reducedMotion of [false, true]) {
    for (let t = 0; t < DROPLET_CYCLE; t += 500) {
      updateDropletFleet(fleet, t, { reducedMotion });
      for (let i = 0; i < fleet.count; i++) {
        const k = i * 3;
        assert.ok(Number.isFinite(fleet.positions[k]) && Math.abs(fleet.positions[k]) < 93);
        assert.ok(fleet.positions[k + 1] >= .64 && fleet.positions[k + 1] < 210);
        assert.ok(fleet.positions[k + 2] > -135 && fleet.positions[k + 2] < 35);
        for (let axis = 0; axis < 3; axis++) assert.ok(Number.isFinite(fleet.colors[k + axis]) && fleet.colors[k + axis] >= 0);
        assert.ok(fleet.sizes[i] > 0 && fleet.sizes[i] < .3);
      }
    }
    for (const t of boundaries.filter(t => t > 0)) {
      updateDropletFleet(fleet, t - 1, { reducedMotion }); const before = fleet.positions.slice();
      updateDropletFleet(fleet, t + 1, { reducedMotion });
      for (let i = 0; i < fleet.count; i++) {
        const k = i * 3, step = Math.hypot(...[0, 1, 2].map(axis => fleet.positions[k + axis] - before[k + axis]));
        assert.ok(step < .4, `teleport at ${t}ms for identity ${fleet.identities[i]}: ${step}`);
      }
    }
  }
});

test('each permanent identity departs vertically, returns to its own launch position and switches off', () => {
  const fleet = createDroneFleet(); updateDropletFleet(fleet, 10000);
  for (let i = 0; i < fleet.count; i++) {
    assert.equal(fleet.positions[i * 3], fleet.bases[i * 3]); assert.equal(fleet.positions[i * 3 + 2], fleet.bases[i * 3 + 2]);
  }
  for (const t of [148000, 150000, 179999]) {
    updateDropletFleet(fleet, t); assert.deepEqual(fleet.positions, fleet.bases);
    if (t >= 150000) assert.ok(fleet.colors.every(value => value === 0));
  }
});

test('reduced motion holds the entire battlefield and probe still and disables heat/explosions/debris motion', () => {
  const fleet = createDroneFleet(); updateDropletFleet(fleet, 28000, { reducedMotion: true });
  const stationary = fleet.positions.slice();
  for (let t = 28000; t <= 114000; t += 500) {
    updateDropletFleet(fleet, t, { reducedMotion: true }); assert.deepEqual(fleet.positions, stationary);
    const head = sampleDropletHead(t, undefined, { reducedMotion: true });
    assert.deepEqual(Array.from(head.subarray(0, 3)), [0, 135, 65]);
    const ship = sampleDoomsdayShip(0, t, undefined, { reducedMotion: true });
    assert.equal(ship[5], 0); assert.equal(ship[6], 0); assert.equal(ship[7], 0);
  }
});

test('absolute seeking and 2048/4096 quality tiers preserve identity trajectories and reuse output storage', () => {
  const high = createDroneFleet(), low = createDroneFleet(2048);
  updateDropletFleet(high, 92000); const expected = [high.positions.slice(), high.colors.slice(), high.sizes.slice()];
  const refs = [high.positions, high.colors, high.sizes, high.dropletBuffers];
  for (const t of [149000, 50000, 7000, 108000, 80000, 0, 92000]) updateDropletFleet(high, t);
  assert.deepEqual(high.positions, expected[0]); assert.deepEqual(high.colors, expected[1]); assert.deepEqual(high.sizes, expected[2]);
  assert.deepEqual([high.positions, high.colors, high.sizes, high.dropletBuffers], refs);
  for (const t of [0, 16000, 30000, 40000, 55000, 64092, 72000, 89234, 104000, 112000, 126000, 140000, 150000]) {
    updateDropletFleet(high, t); updateDropletFleet(low, t);
    for (let i = 0; i < low.count; i++) {
      const identity = low.identities[i];
      assert.equal(high.identities[identity], identity);
      for (let axis = 0; axis < 3; axis++) {
        assert.equal(low.positions[i * 3 + axis], high.positions[identity * 3 + axis]);
        assert.equal(low.colors[i * 3 + axis], high.colors[identity * 3 + axis]);
      }
      assert.equal(low.sizes[i], high.sizes[identity]);
    }
  }
});
