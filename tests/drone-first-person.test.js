import test from 'node:test';
import assert from 'node:assert/strict';
import { createDroneFleet, updateDroneFleet, DRONE_CHAPTERS, DRONE_CYCLE, DRONE_STUNT, DRONE_DRAGON } from '../shared/droneShow.js';
import { selectDroneSeats, sampleDroneFirstPerson } from '../src/components/drone/droneFirstPerson.js';

const close = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} differs from ${expected}`);
const direction = sample => {
  const delta = sample.target.map((value, axis) => value - sample.position[axis]);
  const length = Math.hypot(...delta);
  return delta.map(value => value / length);
};

test('four permanent FPV seats match child Goku hair, power pole, left silhouette and a real first-drop aircraft', () => {
  const fleet = createDroneFleet();
  const seats = selectDroneSeats(fleet);
  assert.deepEqual(seats.map(seat => seat.id), ['hair-tip', 'power-pole', 'left-outline', 'first-drop']);
  assert.deepEqual(seats.map(seat => seat.identity), [1972, 3882, 592, 3278]);
  assert.deepEqual(seats.map(seat => seat.label), ['刺猬发尖', '如意棒侧', '左侧发梢', '首批领航']);
  assert.equal(new Set(seats.map(seat => seat.index)).size, 4);
  for (const seat of seats) assert.equal(fleet.identities[seat.index], seat.identity);
  assert.deepEqual(seats.map(seat => fleet.parts[seat.index]), [0, 7, 0, 7]);
  assert.ok(fleet.hero[seats[0].index * 3] < -8 && fleet.hero[seats[0].index * 3 + 1] > 99);
  assert.ok(fleet.hero[seats[1].index * 3] > 24 && fleet.hero[seats[1].index * 3 + 1] > 85);
  assert.ok(fleet.hero[seats[2].index * 3] < -23 && fleet.hero[seats[2].index * 3 + 1] > 77);
  assert.equal(seats[2].identity % 16, 0, 'the left silhouette keeps a sampled trail in both quality tiers');
  assert.ok(fleet.hero[seats[3].index * 3] > 24 && fleet.hero[seats[3].index * 3 + 1] > 85);
  assert.equal(fleet.fallBatches[seats[3].index], 0);
  updateDroneFleet(fleet, DRONE_STUNT.recoverStart);
  close(sampleDroneFirstPerson(fleet, seats[3].index).altitude, DRONE_STUNT.minimumY, 1e-5);
});

test('low-quality rendering follows the very same permanent identities, not similar new lights', () => {
  const full = createDroneFleet(), mobile = createDroneFleet(2048);
  const fullSeats = selectDroneSeats(full), mobileSeats = selectDroneSeats(mobile);
  assert.deepEqual(mobileSeats.map(seat => seat.identity), fullSeats.map(seat => seat.identity));
  for (const time of [0, 9000, 18000, 30000, 59000, 85000, 119000, 137000, 179999]) {
    updateDroneFleet(full, time); updateDroneFleet(mobile, time);
    for (let seat = 0; seat < fullSeats.length; seat++) {
      assert.deepEqual(sampleDroneFirstPerson(full, fullSeats[seat].index), sampleDroneFirstPerson(mobile, mobileSeats[seat].index));
    }
  }
});

test('FPV is mounted to the real sampled aircraft in every chapter, including ascent and landing', () => {
  const fleet = createDroneFleet();
  const seats = selectDroneSeats(fleet);
  for (const reducedMotion of [false, true]) {
    for (const chapter of DRONE_CHAPTERS) {
      for (const time of [chapter.start, (chapter.start + chapter.end) / 2, chapter.end - 1]) {
        updateDroneFleet(fleet, time, { reducedMotion });
        for (const seat of seats) {
          const sample = sampleDroneFirstPerson(fleet, seat.index);
          const offset = seat.index * 3;
          assert.equal(sample.position[0], fleet.positions[offset]);
          close(sample.position[1], fleet.positions[offset + 1] + 0.12);
          assert.equal(sample.position[2], fleet.positions[offset + 2]);
          assert.equal(sample.altitude, fleet.positions[offset + 1]);
          assert.equal(sample.identity, seat.identity);
          assert.ok([...sample.position, ...sample.target, sample.fov, sample.near, sample.far].every(Number.isFinite));
          close(Math.hypot(...sample.target.map((value, axis) => value - sample.position[axis])), 30);
          assert.ok(sample.near > 0.12, 'the owned light cannot bloom into its own lens');
        }
      }
    }
  }
});

test('camera reads and seat selection never reset the show clock or mutate fleet buffers', () => {
  const fleet = createDroneFleet();
  updateDroneFleet(fleet, 85673);
  const buffers = Object.fromEntries(['positions', 'colors', 'sizes', 'hero', 'bases', 'identities'].map(key => [key, fleet[key].slice()]));
  const state = fleet.state;
  const stateCopy = { ...state };
  const seats = selectDroneSeats(fleet);
  for (let i = 0; i < 100; i++) for (const seat of seats) sampleDroneFirstPerson(fleet, seat.index, { yaw: i, pitch: -i, aspect: 390 / 844 });
  assert.equal(fleet.state, state);
  assert.deepEqual(fleet.state, stateCopy);
  for (const [key, buffer] of Object.entries(buffers)) assert.deepEqual(fleet[key], buffer, key);
  assert.deepEqual(selectDroneSeats(fleet), seats);
});

test('the same show sample is deterministic, independent of earlier calls and other fleets', () => {
  const a = createDroneFleet(), b = createDroneFleet();
  const seat = selectDroneSeats(a)[0];
  updateDroneFleet(a, 81645);
  const expected = sampleDroneFirstPerson(a, seat.index, { yaw: 0.4, pitch: 0.12 });
  updateDroneFleet(b, 125700);
  sampleDroneFirstPerson(b, seat.index, { yaw: -2, pitch: -0.7 });
  assert.deepEqual(sampleDroneFirstPerson(a, seat.index, { yaw: 0.4, pitch: 0.12 }), expected);
  updateDroneFleet(b, 81645 + DRONE_CYCLE);
  assert.deepEqual(sampleDroneFirstPerson(b, seat.index, { yaw: 0.4, pitch: 0.12 }), expected);
});

test('the default heading faces inward with a gentle downward tilt and user yaw turns clockwise', () => {
  const fleet = createDroneFleet();
  updateDroneFleet(fleet, 75000);
  for (const seat of selectDroneSeats(fleet)) {
    const neutral = sampleDroneFirstPerson(fleet, seat.index);
    const a = direction(neutral);
    assert.ok(a[1] < 0 && a[1] > -0.4);
    const dx = -neutral.position[0], dz = -8 - neutral.position[2];
    assert.ok(a[0] * dx + a[2] * dz > 0);
    const right = direction(sampleDroneFirstPerson(fleet, seat.index, { yaw: Math.PI / 2 }));
    close(right[0], -a[2]); close(right[2], a[0]); close(right[1], a[1]);
    const up = direction(sampleDroneFirstPerson(fleet, seat.index, { pitch: 0.3 }));
    assert.ok(up[1] > a[1]);
  }
});

test('actual aircraft and selected headings remain continuous at 50ms resolution throughout a full cycle', () => {
  const fleet = createDroneFleet();
  const seats = selectDroneSeats(fleet);
  const previous = new Map();
  for (let time = 0; time <= DRONE_CYCLE; time += 50) {
    updateDroneFleet(fleet, time);
    for (const seat of seats) {
      const sample = sampleDroneFirstPerson(fleet, seat.index);
      const current = direction(sample);
      const offset = seat.index * 3;
      assert.deepEqual(sample.position, [fleet.positions[offset], fleet.positions[offset + 1] + .12, fleet.positions[offset + 2]], 'no artificial camera displacement can hide a heading defect');
      assert.equal(sample.identity, seat.identity);
      const prior = previous.get(seat.id);
      if (prior) {
        const angle = Math.acos(Math.max(-1, Math.min(1, current.reduce((sum, value, axis) => sum + value * prior[axis], 0))));
        assert.ok(angle < 0.02, `${seat.id} snaps by ${angle} radians at ${time}`);
      }
      previous.set(seat.id, current);
    }
  }
  assert.deepEqual(selectDroneSeats(fleet), seats);
});

test('stunt gimbals seek to a stable shore reference for the drop and return to the finished silhouettes', () => {
  const fleet = createDroneFleet(), seats = selectDroneSeats(fleet);
  const moments = [
    [DRONE_STUNT.fallStart, -30],
    [DRONE_STUNT.brakeStart, -30],
    [DRONE_STUNT.recoverStart, -30],
    [DRONE_STUNT.wingEnd, DRONE_STUNT.centerZ],
    [DRONE_STUNT.reformEnd, -8],
  ];
  const samples = new Map();
  for (const [time, centerZ] of moments) {
    updateDroneFleet(fleet, time);
    for (const seat of seats) {
      const sample = sampleDroneFirstPerson(fleet, seat.index), view = direction(sample);
      const inward = [-sample.position[0], centerZ - sample.position[2]];
      close((view[0] * inward[0] + view[2] * inward[1]) / (Math.hypot(view[0], view[2]) * Math.hypot(...inward)), 1, 1e-10);
      samples.set(`${time}:${seat.id}`, sample);
    }
  }
  for (const [time] of [...moments].reverse()) {
    updateDroneFleet(fleet, time);
    for (const seat of seats) assert.deepEqual(sampleDroneFirstPerson(fleet, seat.index), samples.get(`${time}:${seat.id}`));
  }
});

test('four-batch fall and simultaneous braking freeze gimbal yaw and pitch while real altitude changes', () => {
  const fleet = createDroneFleet(), seats = selectDroneSeats(fleet);
  const held = new Map();
  updateDroneFleet(fleet, DRONE_STUNT.fallStart);
  for (const seat of seats) held.set(seat.id, direction(sampleDroneFirstPerson(fleet, seat.index)));
  for (let time = DRONE_STUNT.fallStart; time <= DRONE_STUNT.recoverStart; time += 50) {
    updateDroneFleet(fleet, time);
    for (const seat of seats) {
      const sample = sampleDroneFirstPerson(fleet, seat.index), view = direction(sample), expected = held.get(seat.id);
      view.forEach((value, axis) => close(value, expected[axis]));
      close(Math.asin(view[1]), -.72);
      close(sample.position[1], fleet.positions[seat.index * 3 + 1] + .12);
      const looked = direction(sampleDroneFirstPerson(fleet, seat.index, { yaw: .3, pitch: .2 }));
      close(Math.asin(looked[1]), -.52, 1e-10);
      assert.ok(Math.abs(looked[0] - view[0]) > .05, 'user look must remain available in the held director beat');
    }
  }
});

test('dragon endpoint gimbal does not flip when the true aircraft crosses the original town centre', () => {
  const fleet = createDroneFleet(), seats = selectDroneSeats(fleet);
  const samples = [];
  for (const time of [DRONE_DRAGON.start, DRONE_DRAGON.formed, 51000, DRONE_DRAGON.holdEnd, 62000, DRONE_DRAGON.end]) {
    updateDroneFleet(fleet, time);
    samples.push(seats.map(seat => sampleDroneFirstPerson(fleet, seat.index)));
  }
  for (let index = 5; index >= 0; index--) {
    const time = [DRONE_DRAGON.start, DRONE_DRAGON.formed, 51000, DRONE_DRAGON.holdEnd, 62000, DRONE_DRAGON.end][index];
    updateDroneFleet(fleet, time);
    seats.forEach((seat, seatIndex) => assert.deepEqual(sampleDroneFirstPerson(fleet, seat.index), samples[index][seatIndex]));
  }
});

test('reduced-motion samples use the actual static avatar direction rather than the sea-stage gimbal score', () => {
  const fleet = createDroneFleet();
  updateDroneFleet(fleet, 94000, { reducedMotion: true });
  for (const seat of selectDroneSeats(fleet)) {
    const sample = sampleDroneFirstPerson(fleet, seat.index, { reducedMotion: true });
    const view = direction(sample), dx = -sample.position[0], dz = -8 - sample.position[2];
    close((view[0] * dx + view[2] * dz) / (Math.hypot(view[0], view[2]) * Math.hypot(dx, dz)), 1, 1e-10);
  }
});

test('near-centre fallback heading is stable instead of flipping for microscopic coordinate noise', () => {
  const fleet = createDroneFleet();
  const seat = selectDroneSeats(fleet)[0];
  const offset = seat.index * 3;
  let previous;
  for (const noise of [-1e-5, -1e-10, 0, 1e-10, 1e-5]) {
    fleet.positions[offset] = noise;
    fleet.positions[offset + 1] = 60;
    fleet.positions[offset + 2] = -8 + noise;
    const current = direction(sampleDroneFirstPerson(fleet, seat.index));
    if (previous) current.forEach((value, axis) => close(value, previous[axis]));
    previous = current;
  }
});

test('bad look values and aspect ratios remain finite; missing real aircraft data is not invented', () => {
  const fleet = createDroneFleet();
  const seat = selectDroneSeats(fleet)[0];
  for (const invalid of [undefined, null, NaN, Infinity, -Infinity, '1', {}, []]) {
    const sample = sampleDroneFirstPerson(fleet, seat.index, { yaw: invalid, pitch: invalid, aspect: invalid });
    assert.ok([...sample.position, ...sample.target, sample.fov, sample.near, sample.far].every(Number.isFinite));
  }
  assert.ok(sampleDroneFirstPerson(fleet, seat.index, null));
  for (const index of [-1, 4096, 0.1, Infinity, NaN, undefined, null]) assert.equal(sampleDroneFirstPerson(fleet, index), null);
  for (const missing of [null, undefined, {}, { count: 1, positions: [] }]) {
    assert.deepEqual(selectDroneSeats(missing), []);
    assert.equal(sampleDroneFirstPerson(missing, 0), null);
  }
  fleet.positions[seat.index * 3] = NaN;
  assert.equal(sampleDroneFirstPerson(fleet, seat.index), null);
});

test('portrait framing changes the lens only, never moves off the aircraft to fake a wide shot', () => {
  const fleet = createDroneFleet();
  updateDroneFleet(fleet, 85000);
  const seat = selectDroneSeats(fleet)[0];
  const landscape = sampleDroneFirstPerson(fleet, seat.index, { aspect: 1440 / 900 });
  const portrait = sampleDroneFirstPerson(fleet, seat.index, { aspect: 390 / 844 });
  assert.deepEqual(portrait.position, landscape.position);
  assert.deepEqual(portrait.target, landscape.target);
  assert.ok(portrait.fov > landscape.fov);
});
