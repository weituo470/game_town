import test from 'node:test';
import assert from 'node:assert/strict';
import { createDroneFleet, updateDroneFleet, sampleDroneShow, sampleDroneFall, droneFallBatch, DRONE_STUNT, DRONE_DRAGON } from '../shared/droneShow.js';

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

test('four adjacent spatial sectors fall sequentially, rather than alternating aircraft identities', () => {
  const fleet = createDroneFleet();
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < fleet.count; i++) {
    const k = i * 3, batch = fleet.fallBatches[i];
    counts[batch]++;
    assert.equal(batch, droneFallBatch(fleet.skyEye[k], fleet.skyEye[k + 2]));
    assert.ok(batch === 0 || batch === 3 ? fleet.skyEye[k] >= -0.0001 : fleet.skyEye[k] <= 0.0001);
    assert.ok(batch === 0 || batch === 1 ? fleet.skyEye[k + 2] >= DRONE_STUNT.centerZ - 0.0001 : fleet.skyEye[k + 2] <= DRONE_STUNT.centerZ + 0.0001);
  }
  assert.ok(counts.every(count => count >= 990 && count <= 1060), `balanced neighbouring quadrants ${counts}`);
  assert.deepEqual(DRONE_STUNT.batchStarts, [88000, 88400, 88800, 89200]);
  for (let batch = 0; batch < 4; batch++) {
    const ownTime = DRONE_STUNT.batchStarts[batch] + 200;
    assert.equal(sampleDroneFall(ownTime, batch).phase, 'falling');
    if (batch < 3) assert.equal(sampleDroneFall(ownTime, batch + 1).phase, 'holding');
  }
});

test('every batch has genuine 9.81 m/s² ballistic motion until the shared thrust-restoration instant', () => {
  for (let batch = 0; batch < 4; batch++) {
    const start = DRONE_STUNT.batchStarts[batch];
    for (let time = start; time < DRONE_STUNT.brakeStart; time += 25) {
      const state = sampleDroneFall(time, batch), t = (time - start) / 1000;
      close(state.y, DRONE_STUNT.height - 0.5 * DRONE_STUNT.gravity * t * t);
      close(state.velocity, -DRONE_STUNT.gravity * t);
      close(state.acceleration, -DRONE_STUNT.gravity);
      assert.equal(state.phase, 'falling');
    }
    assert.equal(sampleDroneFall(DRONE_STUNT.brakeStart - 0.01, batch).phase, 'falling');
    assert.equal(sampleDroneFall(DRONE_STUNT.brakeStart, batch).phase, 'braking');
  }
});

test('the recovery cue is simultaneous while different descent speeds and arrest altitudes remain physical', () => {
  const endYs = [];
  for (let batch = 0; batch < 4; batch++) {
    const atBrake = sampleDroneFall(DRONE_STUNT.brakeStart, batch);
    const duration = (DRONE_STUNT.recoverStart - DRONE_STUNT.brakeStart) / 1000;
    close(atBrake.acceleration, -atBrake.velocity / duration);
    let lastY = atBrake.y;
    for (let time = DRONE_STUNT.brakeStart; time <= DRONE_STUNT.recoverStart; time += 10) {
      const state = sampleDroneFall(time, batch);
      assert.ok(state.y <= lastY + 1e-10, 'upward thrust arrests descent rather than instantly reversing it');
      assert.ok(state.y >= 3.5 && state.velocity <= 1e-10, 'no sea clipping or early upward teleport');
      lastY = state.y;
      // Identical light recovery begins with the common thrust cue, never per-batch.
      close(state.energy, sampleDroneFall(time, 0).energy);
    }
    const stopped = sampleDroneFall(DRONE_STUNT.recoverStart, batch);
    close(stopped.velocity, 0);
    close(stopped.y, atBrake.y + atBrake.velocity * duration * 0.5);
    endYs.push(stopped.y);
  }
  [3.9732, 19.2768, 33.0108, 45.1752].forEach((height, i) => close(endYs[i], height));
  assert.ok(endYs.at(-1) - endYs[0] > 40, 'staggered heights are NOT flattened into a fake common plane');
});

test('ballistic and braking joins are C1 continuous for all four batches', () => {
  const dt = 0.001;
  for (let batch = 0; batch < 4; batch++) {
    for (const time of [DRONE_STUNT.batchStarts[batch], DRONE_STUNT.brakeStart, DRONE_STUNT.recoverStart]) {
      const left = sampleDroneFall(time - dt, batch), exact = sampleDroneFall(time, batch), right = sampleDroneFall(time + dt, batch);
      close(left.y, exact.y, 0.00004); close(right.y, exact.y, 0.00004);
      close(left.velocity, exact.velocity, 0.00004); close(right.velocity, exact.velocity, 0.00004);
    }
  }
});

test('rendered real fleet preserves quadrant heights and its own x/z through each fall and rescue', () => {
  const fleet = createDroneFleet(2048);
  for (let time = DRONE_STUNT.fallStart; time <= DRONE_STUNT.recoverStart; time += 50) {
    updateDroneFleet(fleet, time);
    for (let i = 0; i < fleet.count; i++) {
      const k = i * 3;
      close(fleet.positions[k + 1], sampleDroneFall(time, fleet.fallBatches[i]).y, 0.00001);
      assert.equal(fleet.positions[k], fleet.skyEye[k]);
      assert.equal(fleet.positions[k + 2], fleet.skyEye[k + 2]);
    }
  }
  updateDroneFleet(fleet, DRONE_STUNT.recoverStart);
  const stopped = fleet.positions.slice();
  updateDroneFleet(fleet, DRONE_STUNT.recoverStart + 1);
  for (let i = 0; i < stopped.length; i++) close(fleet.positions[i], stopped[i], 0.00003);
  updateDroneFleet(fleet, DRONE_STUNT.wingFormEnd);
  assert.deepEqual(fleet.positions, fleet.phoenix, 'all four levels join the normal wing formation on the same beat');
});

test('readable navigation lights go out by batch and all return together without a strobe', () => {
  assert.ok(DRONE_STUNT.navigationEnergy >= 0.12 && DRONE_STUNT.navigationEnergy <= 0.2);
  close(sampleDroneFall(88200, 0).energy, DRONE_STUNT.navigationEnergy);
  assert.ok(sampleDroneFall(88200, 1).energy > 1);
  for (let batch = 0; batch < 4; batch++) {
    close(sampleDroneFall(90000, batch).energy, DRONE_STUNT.navigationEnergy);
    assert.ok(sampleDroneFall(DRONE_STUNT.brakeStart + 180, batch).energy > 1.1);
    for (const boundary of [DRONE_STUNT.batchStarts[batch], DRONE_STUNT.brakeStart, DRONE_STUNT.recoverStart]) {
      close(sampleDroneFall(boundary - 0.01, batch).energy, sampleDroneFall(boundary, batch).energy, 0.00001);
    }
  }
  close(sampleDroneShow(90000).energy, DRONE_STUNT.navigationEnergy);
});

test('both quality tiers preserve new dragon and falling identities; reduced motion omits the fall', () => {
  const full = createDroneFleet(), mobile = createDroneFleet(2048);
  assert.deepEqual(DRONE_DRAGON, { start: 36000, formed: 44000, holdEnd: 56000, end: 68000 });
  for (let i = 0; i < mobile.count; i++) {
    assert.equal(mobile.fallBatches[i], full.fallBatches[i * 2]);
    assert.deepEqual(mobile.dragon.subarray(i * 3, i * 3 + 3), full.dragon.subarray(i * 6, i * 6 + 3));
  }
  for (const time of [36000, 40000, 44000, 50000, 56000, 62000, 68000, 89100, 91600, 92600, 94000]) {
    updateDroneFleet(full, time); updateDroneFleet(mobile, time);
    for (let i = 0; i < mobile.count; i++) assert.deepEqual(mobile.positions.subarray(i * 3, i * 3 + 3), full.positions.subarray(i * 6, i * 6 + 3));
  }
  for (const time of [44000, 50000, 55999]) {
    updateDroneFleet(mobile, time, { reducedMotion: true });
    assert.deepEqual(mobile.positions, mobile.dragon, 'quiet viewing retains a completely still dragon silhouette');
  }
  for (const time of [88000, 90000, 91600, 92600, 96000]) {
    updateDroneFleet(mobile, time, { reducedMotion: true });
    assert.deepEqual(mobile.positions, mobile.hero, 'quiet viewing skips every batch of the alarming dive');
  }
});

test('dragon wings breathe by less than one metre, hold their shoulder attachment, and settle at both joins', () => {
  const fleet = createDroneFleet(2048);
  let visiblyMoving = 0;
  for (const time of [44500, 47000, 49000, 51500, 55000]) {
    updateDroneFleet(fleet, time);
    for (let i = 0; i < fleet.count; i++) {
      const k = i * 3, isWing = fleet.dragonParts[i] === 1 || fleet.dragonParts[i] === 2;
      assert.equal(fleet.positions[k], fleet.dragon[k]);
      const dy = fleet.positions[k + 1] - fleet.dragon[k + 1], dz = fleet.positions[k + 2] - fleet.dragon[k + 2];
      if (isWing) {
        assert.ok(dy <= 0.00001 && dy >= -0.80001 && Math.abs(dz) <= 0.70001);
        if (Math.abs(dy) > 0.15) visiblyMoving++;
      } else { assert.equal(dy, 0); assert.equal(dz, 0); }
      assert.ok(fleet.colors[k + 2] > fleet.colors[k] * 2.9, 'electric blue survives HDR rather than washing white');
    }
  }
  assert.ok(visiblyMoving > 200, 'whole wing structures softly flap rather than individual noisy dots');
  for (const time of [DRONE_DRAGON.formed, DRONE_DRAGON.holdEnd]) {
    updateDroneFleet(fleet, time);
    assert.deepEqual(fleet.positions, fleet.dragon);
  }
});
