import test from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClip, Bone, Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Texture, Uint16BufferAttribute, Vector3 } from 'three';
import { createStaticSculpture, staticSculptureNormalization } from '../src/lib/staticSculpture.js';

// Synthetic Three.js primitives below verify transforms and ownership only.
// They are NOT the downloaded Goku asset, a replacement appearance, or visual QA.
const close = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} != ${expected}`);
function fittedBounds(scene, height) {
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene, true);
  close(bounds.min.y, 0, 'ground');
  close(bounds.max.y, height, 'height');
  close(bounds.getCenter(new Vector3()).x, 0, 'horizontal x');
  close(bounds.getCenter(new Vector3()).z, 0, 'horizontal z');
  return bounds;
}
function syntheticAsset() {
  const source = new Group();
  source.name = 'synthetic-source';
  source.position.set(4, -3, 7);
  const material = new MeshStandardMaterial({ color: '#ffd247', roughness: 0.6, map: new Texture() });
  const mesh = new Mesh(new BoxGeometry(2, 4, 6), material);
  mesh.name = 'synthetic-body';
  mesh.position.set(3, 5, -2);
  source.add(mesh);
  return { source, mesh, material };
}
function syntheticRig() {
  const source = new Group();
  const bone = new Bone(); bone.name = 'synthetic-bone';
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, 0, -1, 1, 0, 1, 0, 2, 0], 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  mesh.name = 'synthetic-skinned-mesh';
  mesh.add(bone); source.add(mesh); mesh.bind(new Skeleton([bone]));
  // A deliberately posed asset: preparation must preserve, not reset, this pose.
  bone.position.y = 3;
  source.animations = [new AnimationClip('synthetic-idle', 1, [new QuaternionKeyframeTrack('synthetic-bone.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.5, 0, Math.sqrt(0.75)])])];
  return { source, bone, mesh };
}

test('pure normalization keeps aspect ratio, grounds and centers without changing input bounds', () => {
  const box = new Box3(new Vector3(-2, -1, 3), new Vector3(4, 9, 7));
  const before = box.clone();
  const result = staticSculptureNormalization(box, 5);
  assert.deepEqual(result, { scale: 0.5, position: [-0.5, 0.5, -2.5], targetHeight: 5, sourceSize: [6, 10, 4] });
  assert.ok(box.equals(before));
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.position));
});

test('invalid, empty, flat, non-finite or overflowing bounds and target heights fail explicitly', () => {
  const valid = new Box3(new Vector3(0, 0, 0), new Vector3(1, 2, 3));
  for (const height of [0, -1, NaN, Infinity, '6', null]) assert.throws(() => staticSculptureNormalization(valid, height), RangeError);
  for (const bounds of [null, {}, new Box3(), new Box3(new Vector3(0, 2, 0), new Vector3(2, 2, 2)), new Box3(new Vector3(NaN, 0, 0), new Vector3(2, 3, 4)), new Box3(new Vector3(0, 0, 0), new Vector3(Infinity, 2, 2)), new Box3(new Vector3(0, -Number.MAX_VALUE, 0), new Vector3(1, Number.MAX_VALUE, 1))]) {
    assert.throws(() => staticSculptureNormalization(bounds), RangeError);
  }
  assert.throws(() => staticSculptureNormalization(new Box3(new Vector3(0, 0, 0), new Vector3(1, Number.MIN_VALUE, 1)), 6), RangeError);
});

test('nested original transforms are preserved and one uniform wrapper fits actual vertices', () => {
  const { source, mesh } = syntheticAsset();
  source.rotation.z = 0.3; source.scale.set(1.2, 0.8, 1.6); mesh.rotation.x = 0.2;
  const sourcePosition = source.position.clone(), sourceScale = source.scale.clone(), localRotation = mesh.rotation.clone();
  const result = createStaticSculpture(source, { targetHeight: 8 });
  const bounds = fittedBounds(result.scene, 8);
  assert.ok(bounds.equals(result.bounds));
  assert.deepEqual(result.scene.position.toArray(), [0, 0, 0]);
  assert.deepEqual(result.scene.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(result.model.position, sourcePosition);
  assert.deepEqual(result.model.scale, sourceScale);
  const clonedRotation = result.model.getObjectByName(mesh.name).rotation;
  for (const axis of ['x', 'y', 'z']) close(clonedRotation[axis], localRotation[axis]);
  assert.equal(clonedRotation.order, localRotation.order);
  const size = bounds.getSize(new Vector3());
  result.normalization.sourceSize.forEach((value, index) => close(size.getComponent(index), value * result.normalization.scale));
  assert.equal(source.parent, null);
  assert.deepEqual(source.position, sourcePosition);
});

test('yaw is applied before measurement so the rotated asset remains centered and grounded', () => {
  const { source } = syntheticAsset();
  const plain = createStaticSculpture(source, { targetHeight: 4 });
  const rotated = createStaticSculpture(source, { targetHeight: 4, yaw: Math.PI / 2 });
  const a = fittedBounds(plain.scene, 4).getSize(new Vector3());
  const b = fittedBounds(rotated.scene, 4).getSize(new Vector3());
  close(a.x, b.z); close(a.z, b.x);
  close(rotated.scene.getObjectByName('static-sculpture-orientation').rotation.y, Math.PI / 2);
  assert.throws(() => createStaticSculpture(source, { yaw: NaN }), RangeError);
});

test('model hierarchy is cloned while original geometry, material arrays and textures are retained', () => {
  const { source, mesh, material } = syntheticAsset();
  mesh.material = [material, new MeshStandardMaterial({ color: '#ee7722' })];
  const originalMaterials = mesh.material.slice();
  const result = createStaticSculpture(source);
  const clonedMesh = result.model.getObjectByName(mesh.name);
  assert.notEqual(result.model, source); assert.notEqual(clonedMesh, mesh);
  assert.equal(clonedMesh.geometry, mesh.geometry);
  originalMaterials.forEach((entry, index) => assert.equal(clonedMesh.material[index], entry));
  assert.equal(clonedMesh.material[0].map, material.map);
  assert.deepEqual(mesh.material, originalMaterials);
  assert.equal(material.roughness, 0.6);
  assert.equal(material.color.getHexString(), 'ffd247');
  fittedBounds(result.scene, 6);
});

test('skinned clone owns its bones, preserves the supplied static pose and never starts clips', () => {
  const { source, bone, mesh } = syntheticRig();
  const left = createStaticSculpture(source, { targetHeight: 5 });
  const right = createStaticSculpture(source, { targetHeight: 5 });
  const clonedMesh = left.model.getObjectByName(mesh.name);
  const clonedBone = left.model.getObjectByName(bone.name);
  assert.notEqual(clonedMesh.skeleton, mesh.skeleton);
  assert.notEqual(clonedBone, bone);
  assert.equal(clonedMesh.skeleton.bones[0], clonedBone);
  assert.equal(clonedMesh.geometry, mesh.geometry); assert.equal(clonedMesh.material, mesh.material);
  assert.equal(clonedBone.position.y, 3); assert.equal(bone.position.y, 3);
  assert.deepEqual(clonedBone.quaternion.toArray(), [0, 0, 0, 1]);
  assert.equal(left.model.animations[0], source.animations[0]);
  assert.equal(left.mixer, undefined); assert.equal(left.scene.animations.length, 0);
  fittedBounds(left.scene, 5); fittedBounds(right.scene, 5);
  clonedBone.position.x = 10;
  assert.equal(bone.position.x, 0);
  assert.equal(right.model.getObjectByName(bone.name).position.x, 0);
});

test('precise normalization uses morph vertices, not stale geometry bounding boxes', () => {
  const source = new Group();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 2, 1], 3));
  geometry.morphAttributes.position = [new Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 6, 1], 3)];
  geometry.computeBoundingBox();
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  mesh.morphTargetInfluences[0] = 0.5; source.add(mesh);
  const result = createStaticSculpture(source, { targetHeight: 8 });
  close(result.normalization.sourceSize[1], 4);
  close(result.normalization.scale, 2);
  fittedBounds(result.scene, 8);
  assert.equal(mesh.morphTargetInfluences[0], 0.5);
});

test('instance cleanup releases only its cloned skeleton bone texture, not shared asset resources', () => {
  const { source, mesh } = syntheticRig();
  mesh.skeleton.computeBoneTexture();
  const sourceTexture = mesh.skeleton.boneTexture;
  const result = createStaticSculpture(source);
  const clonedMesh = result.model.getObjectByName(mesh.name);
  assert.equal(clonedMesh.skeleton.boneTexture, null, 'source bone texture is not shared');
  clonedMesh.skeleton.computeBoneTexture();
  let disposedCloneTextures = 0, disposedSourceTextures = 0, disposedGeometry = 0, disposedMaterial = 0;
  clonedMesh.skeleton.boneTexture.addEventListener('dispose', () => disposedCloneTextures++);
  sourceTexture.addEventListener('dispose', () => disposedSourceTextures++);
  mesh.geometry.addEventListener('dispose', () => disposedGeometry++);
  mesh.material.addEventListener('dispose', () => disposedMaterial++);
  result.dispose(); result.dispose();
  assert.equal(disposedCloneTextures, 1);
  assert.equal(clonedMesh.skeleton.boneTexture, null);
  assert.equal(mesh.skeleton.boneTexture, sourceTexture);
  assert.equal(disposedSourceTextures, 0);
  assert.equal(disposedGeometry, 0); assert.equal(disposedMaterial, 0);
  // The test is the loader owner and separately releases its own source data.
  mesh.skeleton.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});

test('an incomplete skeleton, missing source, empty scene or non-finite geometry is rejected', () => {
  for (const value of [undefined, null, {}]) assert.throws(() => createStaticSculpture(value), TypeError);
  assert.throws(() => createStaticSculpture(new Group()), RangeError);
  const { source, bone, mesh } = syntheticRig();
  mesh.remove(bone);
  assert.throws(() => createStaticSculpture(source), /every referenced skeleton bone/);
  const invalid = syntheticAsset();
  invalid.mesh.geometry.attributes.position.setX(0, NaN);
  assert.throws(() => createStaticSculpture(invalid.source), RangeError);
});

test('external source parent placement is not copied into the independent sculpture', () => {
  const { source } = syntheticAsset();
  const parent = new Group(); parent.position.set(100, 200, 300); parent.scale.setScalar(20); parent.add(source);
  const parentBefore = parent.position.clone();
  const result = createStaticSculpture(source, { targetHeight: 4 });
  fittedBounds(result.scene, 4);
  assert.equal(source.parent, parent); assert.deepEqual(parent.position, parentBefore);
  close(result.normalization.sourceSize[1], 4);
});
