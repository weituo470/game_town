import test from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera, Vector3 } from 'three';
import { WORLD_SIZE, WORLD_BOUNDS, SPAWN } from '../shared/world.js';
import { CAMERA_OFFSETS, OVERVIEW_TARGET, projectedWorldSize, overviewZoom, cameraZoom, followTarget, cameraTarget } from '../src/components/town/camera.js';

import { WONDER_MAP } from '../shared/wonders.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);

test('camera views preserve the movement heading and overview includes all three wonder islands', () => {
  const [x, y, z] = CAMERA_OFFSETS.follow;
  assert.deepEqual(CAMERA_OFFSETS.overview, CAMERA_OFFSETS.follow.map(value => value * 3));
  const projected = projectedWorldSize();
  close(projected.width, WONDER_MAP.width * 34 / Math.hypot(24, 34) + WONDER_MAP.depth * 24 / Math.hypot(24, 34));
  close(projected.height, (WONDER_MAP.width * 24 + WONDER_MAP.depth * 34) * 30 / (Math.hypot(24, 34) * Math.hypot(24, 30, 34)) + 15 * Math.hypot(24, 34) / Math.hypot(24, 30, 34));
  assert.ok(x > 0 && y > 0 && z > 0);
});

for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 600], [768, 1024], [390, 844], [360, 640], [844, 390]]) {
  test(`overview fits every ground/building-height corner at ${width} by ${height}`, () => {
    const zoom = overviewZoom(width, height);
    const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 420);
    camera.zoom = zoom;
    const target = new Vector3(OVERVIEW_TARGET.x, OVERVIEW_TARGET.y, OVERVIEW_TARGET.z);
    camera.position.copy(target).add(new Vector3(...CAMERA_OFFSETS.overview));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    for (const x of [-1, 1]) for (const z of [-1, 1]) for (const y of [0, 15]) {
      const point = new Vector3(WONDER_MAP.centerX + x * WONDER_MAP.width / 2, y, WONDER_MAP.centerZ + z * WONDER_MAP.depth / 2).project(camera);
      assert.ok(Math.abs(point.x) * width / 2 <= (width - 36) / 2, 'horizontal ground silhouette stays inside the UI gutter');
      assert.ok(Math.abs(point.y) * height / 2 <= (height - 110) / 2, 'ground and ten-unit silhouette stay inside the vertical UI gutter');
      assert.ok(point.z >= -1 && point.z <= 1, 'complete world is within near/far clipping planes');
    }
    close(cameraZoom('overview', width, height), zoom);
  });
}

test('follow framing tracks player position one-for-one instead of damping map coordinates', () => {
  const first = followTarget({ x: -20, z: -15 }, 1280);
  const second = followTarget({ x: 20, z: 20 }, 1280);
  close(second.x - first.x, 40);
  close(second.z - first.z, 35);
  assert.deepEqual(second, { x: 20, y: 1.2, z: 17.5 });
  assert.deepEqual(followTarget({ x: 20, z: 20 }, 390), { x: 20, y: 1.2, z: 18.5 });
  close(cameraZoom('follow', 1280, 720), Math.min(1280 / 46, 720 / 32));
  close(cameraZoom('follow', 390, 844), 390 / 27);
});

test('follow target stays near all four new map edges and guards malformed poses', () => {
  for (const x of [WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX]) for (const z of [WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ]) {
    for (const width of [390, 1280]) {
      const target = followTarget({ x, z }, width);
      close(target.x, x);
      assert.ok(Math.abs(target.z - z) <= 2.5);
      assert.ok(target.z >= WORLD_BOUNDS.minZ && target.z <= WORLD_BOUNDS.maxZ);
    }
  }
  assert.deepEqual(followTarget({ x: Infinity, z: NaN }, 1280), { x: SPAWN.x, y: 1.2, z: SPAWN.z - 2.5 });
  assert.deepEqual(followTarget({ x: 1000, z: -1000 }, 1280), { x: WORLD_BOUNDS.maxX, y: 1.2, z: WORLD_BOUNDS.minZ });
});

test('overview is independent of any player position and invalid viewports cannot make a negative zoom', () => {
  assert.deepEqual(cameraTarget('overview', { x: -40, z: -35 }, 1280), OVERVIEW_TARGET);
  assert.deepEqual(cameraTarget('overview', { x: 40, z: 35 }, 390), OVERVIEW_TARGET);
  assert.deepEqual(cameraTarget('follow', { x: 10, z: 10 }, 1280), followTarget({ x: 10, z: 10 }, 1280));
  for (const width of [0, 1, NaN, Infinity, -20]) for (const height of [0, 1, NaN, Infinity, -20]) {
    assert.ok(Number.isFinite(overviewZoom(width, height)) && overviewZoom(width, height) > 0);
  }
});
