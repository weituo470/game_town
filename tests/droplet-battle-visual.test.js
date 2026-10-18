import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DROPLET_SHIPS, DROPLET_SCORE } from '../shared/droneDroplet.js';
import { createDropletBattleVisual, createMirrorDropletGeometry, createDropletReflection } from '../src/components/drone/dropletBattleVisual.js';

test('probe is a continuous 3.5-unit solid surface with a rounded head and sharp tail', () => {
  const geometry = createMirrorDropletGeometry(); geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.max.x - geometry.boundingBox.min.x - 3.5) < .001);
  assert.ok(geometry.attributes.normal.count > 5000);
  const visual = createDropletBattleVisual();
  assert.ok(visual.mirror.isMesh); assert.ok(visual.mirror.material.isMeshPhysicalMaterial);
  assert.equal(visual.mirror.material.metalness, 1);
  assert.ok(visual.mirror.material.roughness < .03);
  assert.ok(visual.mirror.material.roughness <= .005, 'polished chrome keeps sharp reflection sources');
  assert.ok(visual.mirror.material.clearcoatRoughness <= .004);
  assert.ok(visual.mirror.material.envMap.isCubeTexture);
  assert.equal(visual.mirror.material.envMap.images[0].image.width, 256);
  assert.equal(visual.hull.count, 216);
  assert.equal(visual.group.children.filter(item => item.isInstancedMesh).length, 5);
  visual.update(52000); assert.equal(visual.mirror.visible, true);
  visual.dispose(); geometry.dispose();
});

test('mirror environment is a local immutable six-face atlas, with meaningful bright and dark reflections', () => {
  const map = createDropletReflection(32);
  assert.equal(map.images.length, 6);
  const values = map.images.flatMap(face => Array.from(face.image.data).filter((_, i) => i % 4 !== 3));
  assert.ok(Math.max(...values) - Math.min(...values) > 210);
  assert.ok(values.filter(value => value < 60).length > values.length * .25, 'dark space separates the sharp silver reflection bands');
  assert.ok(values.filter(value => value > 220).length > values.length * .015, 'bright reflection sources remain visible');
  for (const face of map.images) face.dispose(); map.dispose();
});

test('a spacecraft remains intact until impact, heats during delay and explodes only at the scheduled reactor event', () => {
  const visual = createDropletBattleVisual(), ship = DROPLET_SHIPS[0], matrix = new THREE.Matrix4();
  const size = new THREE.Vector3();
  visual.update(ship.hitTime * 1000 - 1); visual.blasts.getMatrixAt(0, matrix); size.setFromMatrixScale(matrix); assert.equal(size.x, 0);
  visual.update((ship.hitTime + .1) * 1000); visual.blasts.getMatrixAt(0, matrix); size.setFromMatrixScale(matrix); assert.equal(size.x, 0);
  visual.hull.getMatrixAt(0, matrix); size.setFromMatrixScale(matrix); assert.ok(size.x > .9);
  visual.update((ship.explodeTime + .05) * 1000); visual.blasts.getMatrixAt(0, matrix); size.setFromMatrixScale(matrix); assert.ok(size.x > 1);
  visual.update(52000); visual.blasts.getMatrixAt(0, matrix); size.setFromMatrixScale(matrix); assert.equal(size.x, 0, 'rewinding clears future explosion');
  visual.update(85000, true); assert.equal(visual.blasts.visible, false); assert.equal(visual.debris.visible, false);
  visual.update(114000); assert.equal(visual.mirror.visible, false); assert.equal(visual.hull.visible, false);
  assert.equal(visual.update(114000), false, 'paused state reuses all buffers');
  visual.dispose();
});

test('battle visual disposes geometries, mirror materials and reflection textures on program switch', () => {
  const visual = createDropletBattleVisual(), disposals = [];
  for (const [name, resource] of [['mirror', visual.mirror.geometry], ['material', visual.mirror.material], ['reflection', visual.mirror.material.envMap], ['hull', visual.hull.geometry]]) {
    resource.addEventListener('dispose', () => disposals.push(name));
  }
  visual.dispose(); assert.deepEqual(disposals.sort(), ['hull', 'material', 'mirror', 'reflection']); assert.equal(visual.group.children.length, 0);
});

test('all 216 rendered vessels stay intact through the final hit, and seeking clears future destruction', () => {
  const visual = createDropletBattleVisual(), reference = createDropletBattleVisual();
  const matrix = new THREE.Matrix4(), size = new THREE.Vector3();
  const safeTime = DROPLET_SCORE.collapseStart - 1;
  try {
    for (const reducedMotion of [false, true]) {
      // First seek forward into destruction, then backwards to the last hit.
      // Every reused instance matrix must be reset, not just mesh visibility.
      visual.update(DROPLET_SCORE.lastExplosion + 500, reducedMotion);
      for (const time of [DROPLET_SCORE.lastHit - 1, DROPLET_SCORE.lastHit + 1, safeTime]) {
        visual.update(time, reducedMotion);
        for (let i = 0; i < 216; i++) {
          visual.hull.getMatrixAt(i, matrix); size.setFromMatrixScale(matrix); assert.equal(size.x, 1);
          visual.blasts.getMatrixAt(i, matrix); size.setFromMatrixScale(matrix); assert.equal(size.x, 0);
          for (let j = 0; j < 6; j++) {
            visual.debris.getMatrixAt(i * 6 + j, matrix); size.setFromMatrixScale(matrix); assert.equal(size.x, 0);
          }
        }
      }
      reference.update(safeTime, reducedMotion);
      assert.deepEqual(visual.hull.instanceMatrix.array, reference.hull.instanceMatrix.array);
      assert.deepEqual(visual.blasts.instanceMatrix.array, reference.blasts.instanceMatrix.array);
      assert.deepEqual(visual.debris.instanceMatrix.array, reference.debris.instanceMatrix.array);
      visual.update(DROPLET_SCORE.collapseStart + 100, reducedMotion);
      visual.hull.getMatrixAt(0, matrix); size.setFromMatrixScale(matrix);
      assert.ok(size.x < 1, 'destruction begins only on the translated explosion clock');
    }
    visual.update(0); reference.update(0);
    assert.deepEqual(visual.hull.instanceMatrix.array, reference.hull.instanceMatrix.array);
    assert.deepEqual(visual.blasts.instanceMatrix.array, reference.blasts.instanceMatrix.array);
    assert.deepEqual(visual.debris.instanceMatrix.array, reference.debris.instanceMatrix.array);
    assert.equal(visual.mirror.visible, false);
  } finally { visual.dispose(); reference.dispose(); }
});
