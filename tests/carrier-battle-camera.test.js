import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { sampleCarrierBattle } from '../shared/carrierBattle.js';
import { sampleCarrierBattleCamera } from '../src/components/drone/carrierBattleCamera.js';

function cameraAt(time, aspect, reducedMotion = false) {
  const pose = sampleCarrierBattleCamera(time, aspect, reducedMotion);
  const camera = new PerspectiveCamera(pose.fov, aspect, pose.near, pose.far);
  camera.position.set(...pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld();
  return { camera, pose };
}

for (const [label, aspect] of [['desktop', 1440 / 900], ['phone', 390 / 844]]) for (const reduced of [false, true]) {
  test(`battle director keeps the hero ship and deployed machinery large and uncropped: ${label}, reduced=${reduced}`, () => {
    const point = new Vector3();
    for (let time = 0; time <= 150000; time += 250) {
      const { camera, pose } = cameraAt(time, aspect, reduced), state = sampleCarrierBattle(time, { reducedMotion: reduced });
      assert.ok(pose.position[1] >= 4, 'low-angle portrait camera must never dolly underwater');
      const points = [];
      const halfWidth = 10.4 + state.carrier.deploy * 6.25;
      for (const x of [63 - halfWidth, 63 + halfWidth]) for (const y of [Math.max(-1.28, state.carrier.height - 8.6), state.carrier.height + 8]) for (const z of [4.5, 35.5]) points.push([x, y, z]);
      const projected = [];
      for (const p of points) {
        point.set(...p).project(camera);
        assert.ok(Math.abs(point.x) <= .94 && point.y >= -.72 && point.y <= .72 && point.z > -1 && point.z < 1, `${label} time=${time} point=${p} projected=${point.toArray()}`);
        projected.push(point.clone());
      }
      const pixels = (Math.max(...projected.map(p => p.x)) - Math.min(...projected.map(p => p.x))) * (label === 'phone' ? 390 : 1440) / 2;
      if (label === 'phone') assert.ok(pixels >= 220, `hero too small on phone: ${time}, ${pixels}px`);
      else if (!reduced && time >= 58000 && time <= 114000) assert.ok(pixels >= 450, `transformation should be a close shot, not a tactical map: ${time}, ${pixels}px`);
      // The launch aperture is above the viewer's central lower UI, and the
      // camera has a clear downward angle onto the actual deck.
      const hangar = new Vector3(63, state.carrier.height + .85, 13).project(camera);
      assert.ok(Math.abs(hangar.x) < .8 && Math.abs(hangar.y) < .4);
      assert.ok(pose.position[1] > state.carrier.height + 15);
    }
  });
}

test('battle camera is deterministic, continuous, stationary for reduced motion and does not cross the action axis', () => {
  for (const aspect of [1440 / 900, 390 / 844]) {
    const still = sampleCarrierBattleCamera(0, aspect, true);
    let previous = sampleCarrierBattleCamera(0, aspect), maximumStep = 0;
    for (let time = 50; time <= 150000; time += 50) {
      const pose = sampleCarrierBattleCamera(time, aspect);
      assert.ok(pose.position[0] > pose.target[0] && pose.position[2] > pose.target[2]);
      maximumStep = Math.max(maximumStep, Math.hypot(...pose.position.map((value, axis) => value - previous.position[axis])));
      assert.ok(Math.hypot(...pose.target.map((value, axis) => value - previous.target[axis])) < .3, `target cut at ${time}`);
      assert.deepEqual(sampleCarrierBattleCamera(time, aspect, true), still);
      previous = pose;
    }
    assert.ok(maximumStep < 2, `rail is too abrupt: ${maximumStep} m per 50 ms`);
    assert.deepEqual(sampleCarrierBattleCamera(124000, aspect), sampleCarrierBattleCamera(132000, aspect));
  }
  for (const value of [NaN, Infinity, -1, undefined]) {
    const pose = sampleCarrierBattleCamera(value, value);
    assert.ok([...pose.position, ...pose.target, pose.fov, pose.near, pose.far].every(Number.isFinite));
  }
});
