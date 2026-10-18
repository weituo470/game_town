import test from 'node:test';
import assert from 'node:assert/strict';
import { createDroneFleet, updateDroneFleet, sampleDroneShow, sampleDroneFall, DRONE_CHAPTERS, DRONE_COUNT, DRONE_DURATION, DRONE_CYCLE, DRONE_LAUNCH_PADS, DRONE_STUNT, DRONE_HIGHLIGHTS } from '../shared/droneShow.js';
import { isKidGokuEye } from '../shared/droneKidGoku.js';

test('the entire launch, avatar and recovery programme has a deterministic shared-clock contract', () => {
  assert.equal(DRONE_COUNT, 4096);
  assert.equal(DRONE_DURATION, 150000);
  assert.equal(DRONE_CYCLE, 180000);
  assert.deepEqual(DRONE_CHAPTERS.map(c => c.id), ['lighting', 'ascent', 'galaxy', 'dragon', 'forming', 'avatar', 'returning', 'landing', 'blackout', 'waiting']);
  for (let i = 0; i < DRONE_CHAPTERS.length; i++) {
    const c = DRONE_CHAPTERS[i];
    assert.equal(sampleDroneShow(c.start).phase, c.id);
    if (i) assert.equal(c.start, DRONE_CHAPTERS[i - 1].end);
  }
  assert.equal(sampleDroneShow(150000).active, false);
  assert.deepEqual(sampleDroneShow(12345), sampleDroneShow(12345 + DRONE_CYCLE));
  assert.deepEqual(sampleDroneShow(-1000), sampleDroneShow(179000));
  for (const invalid of [NaN, Infinity, undefined]) assert.equal(sampleDroneShow(invalid).elapsed, 0);
});

test('4096 permanent identities occupy four distinct 32 by 32 launch arrays', () => {
  const fleet = createDroneFleet();
  assert.equal(fleet.count, 4096);
  const locations = new Set();
  for (let i = 0; i < fleet.count; i++) {
    const k = i * 3;
    const pad = DRONE_LAUNCH_PADS[fleet.pads[i]];
    assert.ok(Math.abs(fleet.bases[k] - pad.x) < 3.57);
    assert.ok(Math.abs(fleet.bases[k + 2] - pad.z) < 3.57);
    assert.ok(Math.abs(fleet.bases[k + 1] - 0.65) < 0.000001);
    locations.add(`${fleet.bases[k]},${fleet.bases[k + 2]}`);
  }
  assert.equal(locations.size, 4096);
});

test('drone buffers are stable, finite and deterministic at every second including reduced motion', () => {
  const fleet = createDroneFleet();
  const references = [fleet.positions, fleet.colors, fleet.sizes];
  for (const reducedMotion of [false, true]) for (let t = 0; t <= DRONE_CYCLE; t += 1000) {
    updateDroneFleet(fleet, t, { reducedMotion });
    assert.equal(fleet.positions, references[0]); assert.equal(fleet.colors, references[1]); assert.equal(fleet.sizes, references[2]);
    for (let i = 0; i < fleet.count; i++) {
      const k = i * 3;
      assert.ok(Number.isFinite(fleet.positions[k]));
      assert.ok(fleet.positions[k + 1] >= 0.64 && fleet.positions[k + 1] <= 116);
      assert.ok(Math.abs(fleet.positions[k]) < 61 && fleet.positions[k + 2] >= -48 && fleet.positions[k + 2] <= 124);
      assert.ok(fleet.colors[k] >= 0 && Number.isFinite(fleet.colors[k + 2]));
      assert.ok(fleet.sizes[i] > 0 && fleet.sizes[i] < 0.55);
    }
  }
  const first = new Float32Array(fleet.positions);
  updateDroneFleet(fleet, DRONE_CYCLE);
  assert.deepEqual(fleet.positions, first);
});

test('the highlight score preserves the original chapter contract and exposes exact director beats', () => {
  assert.deepEqual(DRONE_HIGHLIGHTS.map(cue => cue.id), ['awakening', 'convergence', 'freefall', 'braking', 'phoenix', 'rebirth', 'apotheosis']);
  for (let i = 0; i < DRONE_HIGHLIGHTS.length; i++) {
    const cue = DRONE_HIGHLIGHTS[i];
    const state = sampleDroneShow(cue.start);
    assert.equal(state.phase, 'avatar');
    assert.equal(state.cue, cue.id);
    assert.equal(state.cueLabel, cue.label);
    assert.equal(state.cueProgress, 0);
    if (i) assert.equal(cue.start, DRONE_HIGHLIGHTS[i - 1].end);
  }
  assert.equal(DRONE_HIGHLIGHTS.at(-1).end, 108000);
  assert.ok(Math.abs(DRONE_STUNT.minimumY - 3.9732) < 1e-9);
  assert.equal(DRONE_STUNT.gatherEnd, 86000);
  assert.equal(DRONE_STUNT.wingFormEnd, 96500);
});

test('the complete sky mandala and fire wings each hold before the next transformation', () => {
  const fleet = createDroneFleet();
  for (const time of [86000, 86500, 87000, 87500, 87999, 88000]) {
    updateDroneFleet(fleet, time);
    assert.deepEqual(fleet.positions, fleet.skyEye, 'the whole high mandala is readable before the dive');
  }
  for (const time of [96500, 97000, 97500, 97999, 98000]) {
    updateDroneFleet(fleet, time);
    assert.deepEqual(fleet.positions, fleet.phoenix, 'both fire wings hold a full silhouette');
  }
});

test('adjacent drone sectors depart a single high sea plane on staggered quadratic trajectories', () => {
  const fleet = createDroneFleet();
  for (const t of [88000, 88500, 89000, 90000, DRONE_STUNT.brakeStart]) {
    updateDroneFleet(fleet, t);
    for (let i = 0; i < fleet.count; i++) {
      const k = i * 3;
      const expectedY = sampleDroneFall(t, fleet.fallBatches[i]).y;
      assert.ok(Math.abs(fleet.positions[k + 1] - expectedY) < 0.00001);
      assert.equal(fleet.positions[k], fleet.skyEye[k]);
      assert.equal(fleet.positions[k + 2], fleet.skyEye[k + 2]);
      assert.ok(fleet.positions[k + 2] >= 56, 'the falling fleet never crosses the island or fountain');
    }
  }
  assert.equal(sampleDroneShow(90000).energy, DRONE_STUNT.navigationEnergy, 'readable navigation lights remain during the drop');
  assert.ok(sampleDroneShow(DRONE_STUNT.recoverStart).energy > 1, 'all recovered sectors glow warmly above the water');
});

test('near-sea braking reaches zero velocity without ground clipping, followed by real wing geometry', () => {
  const fleet = createDroneFleet();
  let previousY = Infinity;
  for (let t = DRONE_STUNT.brakeStart; t <= DRONE_STUNT.recoverStart; t += 20) {
    updateDroneFleet(fleet, t);
    assert.ok(fleet.positions[1] <= previousY + 0.00001);
    previousY = fleet.positions[1];
    for (let i = 0; i < fleet.count; i++) assert.ok(fleet.positions[i * 3 + 1] >= DRONE_STUNT.minimumY - 0.000001);
  }
  assert.ok(Math.abs(previousY - DRONE_STUNT.minimumY) < 0.000001);
  updateDroneFleet(fleet, DRONE_STUNT.recoverStart - 1);
  const justBefore = fleet.positions[1];
  updateDroneFleet(fleet, DRONE_STUNT.recoverStart);
  assert.ok(Math.abs(fleet.positions[1] - justBefore) / 0.001 < 0.02, 'descent speed is zero at the lowest beat');
  updateDroneFleet(fleet, 98000);
  assert.deepEqual(fleet.positions, fleet.phoenix);
  let left = 0, right = 0, high = 0;
  for (let i = 0; i < fleet.count; i++) {
    const k = i * 3;
    if (fleet.positions[k] < -30) left++;
    if (fleet.positions[k] > 30) right++;
    if (fleet.positions[k + 1] > 50) high++;
    assert.ok(fleet.positions[k + 2] > 85, 'fire wings remain over open water');
  }
  assert.ok(left > 200 && right > 200 && high > 250, 'two large feathered wings read as a new silhouette');
});

test('all stunt joins are position/light continuous and the whole programme has bounded speed', () => {
  const fleet = createDroneFleet(2048);
  const checkpoints = [...DRONE_CHAPTERS.map(c => c.start), ...DRONE_HIGHLIGHTS.map(c => c.start), DRONE_STUNT.gatherEnd, 87600, 92000, 94400, DRONE_STUNT.wingFormEnd, 104000];
  for (const t of checkpoints) {
    updateDroneFleet(fleet, t - 1);
    const before = new Float32Array(fleet.positions), light = new Float32Array(fleet.colors);
    updateDroneFleet(fleet, t);
    for (let i = 0; i < before.length; i++) {
      assert.ok(Math.abs(before[i] - fleet.positions[i]) < 0.04, `no teleport at ${t}ms`);
      assert.ok(Math.abs(light[i] - fleet.colors[i]) < 0.03, `no light flash at ${t}ms`);
    }
  }
  let maximumSpeed = 0;
  updateDroneFleet(fleet, 0);
  const previous = new Float32Array(fleet.positions);
  for (let t = 250; t <= 150000; t += 250) {
    updateDroneFleet(fleet, t);
    for (let i = 0; i < fleet.count; i++) {
      const k = i * 3;
      const speed = Math.hypot(fleet.positions[k] - previous[k], fleet.positions[k + 1] - previous[k + 1], fleet.positions[k + 2] - previous[k + 2]) / 0.25;
      maximumSpeed = Math.max(maximumSpeed, speed);
    }
    previous.set(fleet.positions);
  }
  assert.ok(maximumSpeed < 42, `virtual flight maximum ${maximumSpeed.toFixed(2)} metres per second`);
  assert.deepEqual(fleet.positions, fleet.bases, 'every permanent identity still ends at its original pad');
});

test('reduced motion omits the alarming dive while low-resolution samples preserve every new formation', () => {
  const full = createDroneFleet(), reduced = createDroneFleet(2048);
  for (const time of [80000, 85000, 88000, 90000, 91200, 93200, 96000, 98000, 101000, 104000]) {
    updateDroneFleet(full, time); updateDroneFleet(reduced, time);
    for (let i = 0; i < reduced.count; i++) {
      assert.deepEqual(reduced.positions.subarray(i * 3, i * 3 + 3), full.positions.subarray(i * 6, i * 6 + 3));
    }
    updateDroneFleet(reduced, time, { reducedMotion: true });
    assert.deepEqual(reduced.positions, reduced.hero, 'quiet mode keeps the town guardian in place');
    assert.ok(reduced.colors[0] > 0.2, 'quiet mode does not black out or fire a flash');
  }
});

test('phase boundaries preserve positions and luminance without teleporting or a loop flash', () => {
  const fleet = createDroneFleet();
  for (const c of DRONE_CHAPTERS) {
    updateDroneFleet(fleet, c.start - 1);
    const before = new Float32Array(fleet.positions), colorBefore = new Float32Array(fleet.colors);
    updateDroneFleet(fleet, c.start);
    let largest = 0, lightChange = 0;
    for (let i = 0; i < fleet.positions.length; i++) {
      largest = Math.max(largest, Math.abs(fleet.positions[i] - before[i]));
      lightChange = Math.max(lightChange, Math.abs(fleet.colors[i] - colorBefore[i]));
    }
    assert.ok(largest < 0.02, `${c.id} displacement ${largest}`);
    assert.ok(lightChange < 0.03, `${c.id} luminance ${lightChange}`);
  }
});

test('launch begins vertically, and every drone returns exactly to its own origin before blackout', () => {
  const fleet = createDroneFleet();
  updateDroneFleet(fleet, 9000);
  for (let i = 0; i < fleet.count; i++) {
    assert.equal(fleet.positions[i * 3], fleet.bases[i * 3]);
    assert.equal(fleet.positions[i * 3 + 2], fleet.bases[i * 3 + 2]);
  }
  assert.ok(fleet.positions[1] > fleet.bases[1]);
  for (const t of [148000, 149000, 150000, 175000, 180000]) {
    updateDroneFleet(fleet, t);
    assert.deepEqual(fleet.positions, fleet.bases);
  }
  updateDroneFleet(fleet, 150000);
  assert.ok(fleet.colors.every(value => value === 0));
});

test('mobile samples preserve every artistic part and the exact identities of the full fleet', () => {
  const full = createDroneFleet(), mobile = createDroneFleet(2048);
  assert.equal(new Set(mobile.parts).size, 9);
  updateDroneFleet(full, 85000); updateDroneFleet(mobile, 85000);
  for (let i = 0; i < mobile.count; i++) {
    assert.equal(mobile.identities[i], full.identities[i * 2]);
    assert.deepEqual(mobile.positions.subarray(i * 3, i * 3 + 3), full.positions.subarray(i * 6, i * 6 + 3));
  }
  for (let part = 0; part < 9; part++) assert.ok(mobile.parts.filter(value => value === part).length >= 70, `part ${part} retains detail`);
});

test('the young Goku avatar has a large spike-haired head, short blue gi, wide trousers, white bow and tall right-hand pole', () => {
  const fleet = createDroneFleet();
  updateDroneFleet(fleet, 68000);
  const bounds = Array.from({ length: 9 }, () => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }));
  for (let i = 0; i < fleet.count; i++) {
    const b = bounds[fleet.parts[i]], k = i * 3;
    b.minX = Math.min(b.minX, fleet.positions[k]); b.maxX = Math.max(b.maxX, fleet.positions[k]);
    b.minY = Math.min(b.minY, fleet.positions[k + 1]); b.maxY = Math.max(b.maxY, fleet.positions[k + 1]);
    b.minZ = Math.min(b.minZ, fleet.positions[k + 2]); b.maxZ = Math.max(b.maxZ, fleet.positions[k + 2]);
  }
  assert.ok(bounds[0].minX < -28 && bounds[0].maxX > 29 && bounds[0].maxY > 106, 'strong asymmetric spiky-hair silhouette');
  assert.ok(bounds[0].maxX - bounds[0].minX > 2.2 * (bounds[3].maxX - bounds[3].minX), 'the child head is much wider than the short vest');
  assert.ok(bounds[1].minX < -12 && bounds[1].maxX > 11 && bounds[1].minY > 58, 'wide ears and a small neck');
  assert.ok(bounds[2].minY > 69 && bounds[2].maxY < 81 && bounds[2].minZ >= 5, 'the smile and round eyes sit forward of the face');
  assert.ok(bounds[4].minX < -19 && bounds[4].maxX > 27, 'left hand rests on hip while right hand holds the pole');
  assert.ok(bounds[5].minY < 27 && bounds[5].maxY < 51 && bounds[5].minX < -22, 'two broad trouser legs instead of the old robe');
  assert.ok(bounds[6].minY < 37 && bounds[6].maxY < 53 && bounds[6].minZ > 4, 'white knot and hanging bow sit at the waist');
  assert.ok(bounds[7].minX > 18 && bounds[7].maxY > 100 && bounds[7].minY < 25, 'single high pole is entirely on the right');
  assert.ok(bounds[0].minZ > -1 && bounds[0].maxZ < bounds[2].minZ, 'hair uses shallow depth rather than a giant rear aureole');
  assert.throws(() => createDroneFleet(0), RangeError);
  assert.throws(() => createDroneFleet(4097), RangeError);
});

test('the avatar awakens its eyes before a single soft upward gold sweep, with continuous light cues', () => {
  const fleet = createDroneFleet();
  const eyes = [];
  for (let i = 0; i < fleet.count; i++) {
    const k = i * 3;
    if (isKidGokuEye(fleet.parts[i], fleet.hero[k], fleet.hero[k + 1])) eyes.push(i);
  }
  assert.ok(eyes.length >= 300, 'both large round eye whites and their small catchlights receive the reveal');
  const brightness = time => {
    updateDroneFleet(fleet, time, { reducedMotion: true });
    return eyes.reduce((sum, i) => sum + fleet.colors[i * 3], 0) / eyes.length;
  };
  const closed = brightness(68000), waking = brightness(71000), open = brightness(74000);
  assert.ok(waking > closed * 2 && open > waking * 1.4);
  assert.equal(brightness(82000), open, 'reduced motion retains the bright eye reveal');
  for (const boundary of [68000, 74000, 80000, 108000, 116000]) {
    updateDroneFleet(fleet, boundary - 1);
    const previous = new Float32Array(fleet.colors);
    updateDroneFleet(fleet, boundary);
    for (let i = 0; i < previous.length; i++) assert.ok(Math.abs(previous[i] - fleet.colors[i]) < 0.03, `continuous light cue at ${boundary}`);
  }
  updateDroneFleet(fleet, 77000, { reducedMotion: true });
  const quiet = new Float32Array(fleet.colors);
  updateDroneFleet(fleet, 77000);
  const chest = [];
  for (let i = 0; i < fleet.count; i++) if (fleet.parts[i] === 3 && Math.abs(fleet.hero[i * 3 + 1] - 63) < 3) chest.push(i);
  assert.ok(chest.length > 40);
  assert.ok(chest.every(i => fleet.colors[i * 3] > quiet[i * 3] + 0.3), 'normal motion carries a broad warm sweep over the chest');
  updateDroneFleet(fleet, 82000, { reducedMotion: true });
  for (const i of chest) assert.equal(fleet.colors[i * 3], fleet.baseColors[i * 3], 'sweep has ended and reduced motion never pulses');
});
