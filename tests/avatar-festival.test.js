import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { createDroneFleet, updateDroneFleet } from '../shared/droneShow.js';
import { AVATAR_FESTIVAL, createAvatarFestival, avatarFestivalCamera } from '../src/components/drone/avatarFestival.js';
import { FESTIVAL_GLYPHS } from '../src/components/drone/avatarFestivalGlyphs.js';
import { sampleDroneCamera } from '../src/components/drone/droneCamera.js';

test('festival contains actual world-space glyphs, not HTML-only captions', () => {
  assert.deepEqual(FESTIVAL_GLYPHS.map(g => g.text), ['moonstone', '黑客松', '1024', '程序员节快乐']);
  for (const g of FESTIVAL_GLYPHS) assert(g.points.length > 200);
  assert.equal(AVATAR_FESTIVAL.duration, 150000);
});
for (const count of [2048, 4096]) test(`festival preserves ${count} identities, finite seeking, original stunt and exact landing`, () => {
  const fleet = createDroneFleet(count), festival = createAvatarFestival(fleet), reference = createDroneFleet(count);
  const identities = fleet.identities.slice();
  for (const ms of [0, 24000, 29000, 31000, 36000, 44000, 76000, 88000, 93000, 108000, 115000, 136000, 140000, 149999, 150000, 180000]) {
    updateDroneFleet(fleet, ms); updateDroneFleet(reference, ms);
    festival.update(ms);
    assert.deepEqual(fleet.identities, identities);
    assert(fleet.positions.every(Number.isFinite)); assert(fleet.colors.every(Number.isFinite));
    if (ms < 24000 || ms >= 44000 && ms <= 108000 || ms >= 150000) assert.deepEqual(fleet.positions, reference.positions);
    if (ms === 31000) assert.deepEqual(fleet.positions, festival.opening.positions);
    if (ms === 136000) assert.deepEqual(fleet.positions, festival.closing.positions);
    if (ms === 150000) assert.deepEqual(fleet.positions, fleet.bases);
  }
  for (const t of [24000, 29000, 36000, 44000, 108000, 115000, 140000, 150000]) {
    updateDroneFleet(fleet, t - .01); festival.update(t - .01); const a = fleet.positions.slice();
    updateDroneFleet(fleet, t + .01); festival.update(t + .01);
    assert(Math.max(...fleet.positions.map((v, i) => Math.abs(v - a[i]))) < .01, `continuous morph at ${t}`);
  }
});
test('both greetings fit desktop and phone framing with visible gaps between lamps', () => {
  const fleet = createDroneFleet(), festival = createAvatarFestival(fleet);
  for (const [ms, form] of [[31000, festival.opening], [136000, festival.closing]]) {
    const unique = new Set();
    for (let i = 0; i < form.letterCount; i++) unique.add([...form.positions.slice(i * 3, i * 3 + 3)].join(','));
    assert.equal(unique.size, form.letterCount);
    for (const aspect of [16 / 9, 390 / 844]) {
      const pose = avatarFestivalCamera(sampleDroneCamera(ms, aspect), ms, aspect), camera = new PerspectiveCamera(pose.fov, aspect, pose.near, pose.far);
      camera.position.set(...pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld();
      for (let i = 0; i < form.letterCount; i++) {
        const p = new Vector3().fromArray(form.positions, i * 3).project(camera);
        assert(Math.abs(p.x) < .93 && Math.abs(p.y) < .75, `framing ${ms}, ${aspect}`);
      }
    }
  }
  const base = sampleDroneCamera(31000, 1, true);
  assert.equal(avatarFestivalCamera(base, 31000, 1, true), base, 'reduced motion retains a stationary camera');
});
