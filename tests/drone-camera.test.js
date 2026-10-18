import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { DRONE_DRAGON, DRONE_STUNT, createDroneFleet, updateDroneFleet } from '../shared/droneShow.js';
import { sampleDroneCamera } from '../src/components/drone/droneCamera.js';

for (const [viewport, aspect] of [['desktop', 1280 / 720], ['phone', 390 / 844]]) {
  for (const reducedMotion of [false, true]) {
    test(`drone director keeps the complete flight in frame: ${viewport}, reduced motion ${reducedMotion}`, () => {
      const fleet = createDroneFleet();
      const camera = new PerspectiveCamera();
      const point = new Vector3();
      const moments = new Set(Array.from({ length: 301 }, (_, index) => index * 500));
      for (const time of [DRONE_STUNT.fallStart, DRONE_STUNT.brakeStart, DRONE_STUNT.recoverStart, DRONE_STUNT.wingEnd, DRONE_STUNT.reformEnd]) {
        moments.add(time - 10); moments.add(time); moments.add(time + 10);
      }
      for (const time of [...moments].sort((a, b) => a - b)) {
        updateDroneFleet(fleet, time, { reducedMotion });
        const pose = sampleDroneCamera(time, aspect, reducedMotion);
        camera.aspect = aspect;
        camera.fov = pose.fov;
        camera.near = pose.near;
        camera.far = pose.far;
        camera.position.set(...pose.position);
        camera.lookAt(...pose.target);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (let index = 0; index < fleet.count; index++) {
          point.fromArray(fleet.positions, index * 3).project(camera);
          minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
          minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
        }
        const context = `${viewport}, t=${time}, reduced=${reducedMotion}: [${minX}, ${maxX}, ${minY}, ${maxY}]`;
        assert.ok([minX, maxX, minY, maxY, minZ, maxZ].every(Number.isFinite), context);
        assert.ok(minX >= -0.98 && maxX <= 0.98, `horizontal crop: ${context}`);
        assert.ok(minY >= -0.98 && maxY <= 0.98, `vertical crop: ${context}`);
        assert.ok(minZ > -1 && maxZ < 1, `near/far clipping: ${context}`);
        if (!reducedMotion && time >= 68000 && time <= 108000) {
          assert.ok(minY >= -0.6 && maxY <= 0.85, `hero must leave space for the show controls: ${context}`);
          if (viewport === 'phone') assert.ok(minY >= -0.45 && maxY <= 0.6, `phone hero must leave top and bottom HUD space: ${context}`);
        }
      }
    });
  }
}

test('reduced-motion director is stationary throughout all eight chapters', () => {
  const baseline = sampleDroneCamera(0, 390 / 844, true);
  for (const time of [8000, 28000, 48000, 68000, 88000, 91200, 93200, 98000, 104000, 108000, 128000, 148000, 150000]) {
    assert.deepEqual(sampleDroneCamera(time, 390 / 844, true), baseline);
  }
});

test('director sanitizes a missing or invalid aspect ratio', () => {
  for (const aspect of [NaN, Infinity, 0, -1, undefined]) {
    const pose = sampleDroneCamera(85000, aspect);
    assert.ok([...pose.position, ...pose.target, pose.fov, pose.near, pose.far].every(Number.isFinite));
  }
});

test('landscape hero retains the fountain and a street block as a visible scale reference', () => {
  const camera = new PerspectiveCamera();
  const point = new Vector3();
  for (const time of [68000, 76000, 80000, 104000, 108000]) {
    const pose = sampleDroneCamera(time, 1280 / 720);
    camera.aspect = 1280 / 720;
    camera.fov = pose.fov;
    camera.near = pose.near;
    camera.far = pose.far;
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // The fountain's upper bowl and both sides of the north plaza should be
    // above the transport bar; a head-only sky portrait has no town scale cue.
    for (const worldPoint of [[0, 5, 2], [-13, 2, -12], [13, 2, -12]]) {
      point.set(...worldPoint).project(camera);
      assert.ok(point.y >= -0.65 && point.y <= -0.35, `town landmark is hidden at ${time}: y=${point.y}`);
      assert.ok(Math.abs(point.x) < 0.5, `town landmark is off-center at ${time}: x=${point.x}`);
    }
  }
});

test('hero silhouette clears the real desktop menu and portrait top bar without hiding the town', () => {
  const fleet = createDroneFleet(), camera = new PerspectiveCamera(), point = new Vector3();
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    const landscape = width > height;
    for (const time of [68000, 70000, 74000, 76000, 80000, 104000, 106000, 108000]) {
      updateDroneFleet(fleet, time);
      const pose = sampleDroneCamera(time, width / height);
      camera.aspect = width / height; camera.fov = pose.fov;
      camera.position.set(...pose.position); camera.lookAt(...pose.target);
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity, eyeLeft = Infinity;
      for (let index = 0; index < fleet.count; index++) {
        point.fromArray(fleet.positions, index * 3).project(camera);
        const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        if (fleet.parts[index] === 2) eyeLeft = Math.min(eyeLeft, x);
      }
      if (landscape) {
        assert.ok(left > 700 && eyeLeft > 790, `clear of menu ending at x690: ${time}, ${left}, ${eyeLeft}`);
        assert.ok(right < 1010 && top > 56 && bottom < 460, `full child and pole remain in shot at ${time}`);
      } else {
        assert.ok(top >= 274, `highest hair spike clears the y267 top bar with a gap: ${time}, ${top}`);
        assert.ok(bottom < 584 && left > 80 && right < 314, `portrait stays centered and clear of transport: ${time}`);
        for (const worldPoint of [[0, 5, 2], [-13, 2, -12], [13, 2, -12]]) {
          point.set(...worldPoint).project(camera);
          const y = (1 - point.y) * height / 2;
          assert.ok(y > bottom + 50 && y < 680, `town separates from boots and remains above lower HUD at ${time}: ${y}`);
        }
      }
    }
  }
});

test('hero HUD offsets ease continuously and never migrate into the static dragon or fall poses', () => {
  for (const aspect of [1280 / 720, 1, 390 / 844]) {
    for (const time of [56000, 68000, 80000, 84000, 98000, 104000, 108000, 128000]) {
      const before = sampleDroneCamera(time - 1, aspect), current = sampleDroneCamera(time, aspect), after = sampleDroneCamera(time + 1, aspect);
      for (const axis of [0, 1, 2]) for (const key of ['position', 'target']) {
        assert.ok(Math.abs(before[key][axis] - current[key][axis]) < .0001, `left-continuous ${key} at ${time}`);
        assert.ok(Math.abs(after[key][axis] - current[key][axis]) < .0001, `right-continuous ${key} at ${time}`);
      }
    }
    for (const time of [DRONE_DRAGON.formed, DRONE_DRAGON.holdEnd]) {
      const pose = sampleDroneCamera(time, aspect);
      assert.equal(pose.target[0], 0); assert.equal(pose.target[1], 64);
    }
    const fall = sampleDroneCamera(DRONE_STUNT.fallStart, aspect);
    assert.equal(fall.target[0], 0); assert.equal(fall.target[1], 36);
    assert.deepEqual(sampleDroneCamera(DRONE_STUNT.recoverStart, aspect), fall);
  }
});

test('near-sea rescue keeps the distant town visible without chasing the falling fleet or cutting', () => {
  const camera = new PerspectiveCamera();
  const point = new Vector3();
  const aspect = 1280 / 720;
  for (const time of [88000, 90000, 91200, 93200, 96000, 98000]) {
    const pose = sampleDroneCamera(time, aspect);
    camera.aspect = aspect;
    camera.fov = pose.fov;
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    for (const worldPoint of [[0, 5, 2], [-13, 2, -12], [13, 2, -12]]) {
      point.set(...worldPoint).project(camera);
      assert.ok(point.y >= -0.65 && point.y <= 0.4, `town should remain behind the rescue at ${time}: ${point.y}`);
      assert.ok(Math.abs(point.x) < 0.5);
    }
  }
  const falling = sampleDroneCamera(DRONE_STUNT.fallStart, aspect);
  const saving = sampleDroneCamera(DRONE_STUNT.recoverStart, aspect);
  assert.deepEqual(saving, falling, 'fixed water and shore references must not rise on screen with a chasing camera');
  assert.ok(saving.target[2] > 40, 'rescue is framed on the sea rather than the original statue');
  let previous = sampleDroneCamera(79000, aspect);
  for (let time = 79050; time <= 108000; time += 50) {
    const next = sampleDroneCamera(time, aspect);
    assert.ok(Math.hypot(...next.position.map((value, axis) => value - previous.position[axis])) < 2, `camera position cut at ${time}`);
    assert.ok(Math.hypot(...next.target.map((value, axis) => value - previous.target[axis])) < 2, `camera target cut at ${time}`);
    previous = next;
  }
});

test('the sky eye is revealed from above before the camera settles into its fixed fall reference', () => {
  for (const aspect of [1280 / 720, 390 / 844]) {
    const pose = sampleDroneCamera(84000, aspect);
    const horizontalDistance = Math.hypot(pose.position[0], pose.position[2] - DRONE_STUNT.centerZ);
    const overheadAngle = Math.atan2(pose.position[1] - DRONE_STUNT.height, horizontalDistance) * 180 / Math.PI;
    assert.ok(overheadAngle >= 25 && overheadAngle <= 40, `readable mandala angle: ${overheadAngle}`);
    assert.deepEqual(sampleDroneCamera(84400, aspect), pose);
    const falling = sampleDroneCamera(DRONE_STUNT.fallStart, aspect);
    for (let time = DRONE_STUNT.fallStart; time <= DRONE_STUNT.recoverStart; time += 50) assert.deepEqual(sampleDroneCamera(time, aspect), falling);
  }
});

test('all four batches visibly travel downward against a stationary sea reference', () => {
  const fleet = createDroneFleet();
  for (const aspect of [1280 / 720, 390 / 844]) {
    const camera = new PerspectiveCamera(), point = new Vector3();
    const pose = sampleDroneCamera(DRONE_STUNT.fallStart, aspect);
    camera.aspect = aspect; camera.fov = pose.fov;
    camera.near = pose.near; camera.far = pose.far;
    camera.position.set(...pose.position); camera.lookAt(...pose.target);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const previous = new Float64Array(fleet.count);
    for (let time = DRONE_STUNT.fallStart; time <= DRONE_STUNT.recoverStart; time += 100) {
      updateDroneFleet(fleet, time);
      for (let index = 0; index < fleet.count; index++) {
        point.fromArray(fleet.positions, index * 3).project(camera);
        assert.ok(Math.abs(point.x) < .98 && point.y > -.6 && point.y < .85, `all sectors remain visible at ${time}`);
        if (time > DRONE_STUNT.fallStart) {
          assert.ok(point.y <= previous[index] + 1e-10, `batch ${fleet.fallBatches[index]} rises on screen at ${time}`);
          if (time > DRONE_STUNT.batchStarts[fleet.fallBatches[index]] && time <= DRONE_STUNT.brakeStart) {
            assert.ok(point.y < previous[index] - 1e-7, `fall is not visible for sector ${fleet.fallBatches[index]} at ${time}`);
          }
        }
        previous[index] = point.y;
      }
    }
  }
});

test('blue dragon holds a near-frontal readable silhouette for twelve seconds on desktop and phone', () => {
  const fleet = createDroneFleet();
  for (const aspect of [1280 / 720, 390 / 844]) {
    const baseline = sampleDroneCamera(DRONE_DRAGON.formed, aspect);
    const camera = new PerspectiveCamera(), point = new Vector3();
    camera.aspect = aspect; camera.fov = baseline.fov;
    camera.position.set(...baseline.position); camera.lookAt(...baseline.target);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    assert.ok(baseline.position[2] > 180, 'see dragon head on the left and curled tail on the right');
    assert.ok(Math.abs(baseline.position[0] / baseline.position[2]) < .15, 'do not foreshorten the wing silhouette');
    for (let time = DRONE_DRAGON.formed; time <= DRONE_DRAGON.holdEnd; time += 1000) {
      assert.deepEqual(sampleDroneCamera(time, aspect), baseline);
      updateDroneFleet(fleet, time);
      for (let index = 0; index < fleet.count; index++) {
        point.fromArray(fleet.positions, index * 3).project(camera);
        assert.ok(Math.abs(point.x) < .92 && point.y > -.65 && point.y < .7, `dragon clipped or under HUD: ${time}, ${point.toArray()}`);
      }
    }
  }
});
