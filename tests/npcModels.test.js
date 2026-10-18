import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNpcModel, animateNpcModel, NPC_MODEL_IDS } from '../src/components/town/characters/NpcModels.js';

const models = NPC_MODEL_IDS.map(createNpcModel);
const collect = (model, predicate) => {
  const values = [];
  model.traverse(object => { if (predicate(object)) values.push(object); });
  return values;
};
const meshesOf = model => collect(model, object => object.isMesh);
const dispose = model => {
  const materials = new Set();
  for (const mesh of meshesOf(model)) { mesh.geometry.dispose(); materials.add(mesh.material); }
  materials.forEach(material => material.dispose());
};
after(() => models.forEach(dispose));

test('NPC models cover all sixteen source identities with twelve humans and four distinct animals', () => {
  assert.equal(NPC_MODEL_IDS.length, 16);
  assert.equal(new Set(NPC_MODEL_IDS).size, 16);
  assert.equal(models.filter(model => model.userData.species === 'human').length, 12);
  assert.deepEqual(models.filter(model => model.userData.species !== 'human').map(model => model.userData.species).sort(), ['cat', 'corgi', 'rabbit', 'red-panda']);
  assert.equal(new Set(models.map(model => model.userData.displayName)).size, 16);
  assert.throws(() => createNpcModel('unknown'), /Unknown NPC/);
});

for (const model of models) {
  test(`NPC ${model.userData.npcId} is a finite, grounded, bounded 3D articulated model`, () => {
    assert.ok(model.isGroup);
    for (const part of ['rig', 'body', 'head', 'arm-left', 'arm-right', 'leg-left', 'leg-right']) assert.ok(model.getObjectByName(`npc-${part}`), `missing ${part}`);
    const meshes = meshesOf(model);
    assert.ok(meshes.length <= 7, `draw budget ${meshes.length}`);
    assert.equal(model.userData.drawCalls, meshes.length);
    assert.equal(new Set(meshes.map(mesh => mesh.material)).size, 1, 'one vertex-color material per character');
    let triangles = 0;
    for (const mesh of meshes) {
      assert.ok(mesh.geometry.attributes.color, 'baked clothing colors');
      assert.ok(mesh.geometry.attributes.normal);
      assert.equal(mesh.geometry.groups.length, 0, 'no hidden material-group draw calls');
      assert.equal(mesh.material.map, null, 'models are geometry, never portrait billboards');
      for (const attribute of Object.values(mesh.geometry.attributes)) {
        assert.equal(attribute.count, mesh.geometry.attributes.position.count);
        for (const value of attribute.array) assert.ok(Number.isFinite(value));
      }
      triangles += mesh.geometry.attributes.position.count / 3;
    }
    assert.equal(triangles, model.userData.triangles);
    assert.ok(triangles > 1000 && triangles <= 10000, `triangle budget ${triangles}`);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(Math.abs(bounds.min.y) < 1e-6, `ground ${bounds.min.y}`);
    if (model.userData.species === 'human') assert.ok(size.y >= 2.2 && size.y <= 2.8, `human height ${size.y}`);
    else assert.ok(size.y >= 1 && size.y <= 1.5, `animal height ${size.y}`);
    assert.ok(size.x > 0.5 && size.z > 0.5, 'full volume visible from every camera angle');
  });
}

test('NPC clone animations never affect originals, sibling clones, or navigation roots', () => {
  const source = models.find(model => model.userData.npcId === 'npc-maipao');
  const left = source.clone(true), right = source.clone(true);
  left.position.set(3, 0.16, -4);
  left.rotation.y = 1.7;
  animateNpcModel(left, { moving: true, activity: 'deliver', time: 1 });
  assert.deepEqual(left.position.toArray(), [3, 0.16, -4]);
  assert.equal(left.rotation.y, 1.7);
  assert.notEqual(left.getObjectByName('npc-leg-left').rotation.x, 0);
  assert.equal(Math.abs(right.getObjectByName('npc-leg-left').rotation.x), 0);
  assert.equal(Math.abs(source.getObjectByName('npc-leg-left').rotation.x), 0);
  assert.strictEqual(meshesOf(left)[0].geometry, meshesOf(source)[0].geometry);
  assert.strictEqual(meshesOf(left)[0].material, meshesOf(source)[0].material);
});

test('NPC animations use semantic work, greet and rest states and reset when inactive', () => {
  const model = models.find(model => model.userData.npcId === 'npc-dengcheng').clone(true);
  const arm = model.getObjectByName('npc-arm-right'), head = model.getObjectByName('npc-head');
  animateNpcModel(model, { activity: 'repair', time: 1 });
  assert.ok(arm.rotation.x < 0);
  animateNpcModel(model, { activity: 'greet', time: 1 });
  assert.ok(arm.rotation.z < -0.4);
  animateNpcModel(model, { activity: 'rest', time: 1 });
  assert.equal(head.rotation.x, 0.12);
  assert.equal(arm.rotation.z, 0);
  animateNpcModel(model, { activity: 'idle', time: 0 });
  assert.equal(head.rotation.x, 0);
  assert.equal(arm.rotation.x, 0);
});

test('every scheduled job has an intentional work, welcome, warmup, or rest pose', () => {
  const model = models[0].clone(true);
  const arm = model.getObjectByName('npc-arm-right');
  for (const activity of ['stock', 'garden', 'knit', 'inspect', 'guide', 'sort', 'deliveryWait', 'archive', 'bake', 'read', 'paint', 'water', 'inspectLamp', 'observe', 'repair']) {
    animateNpcModel(model, { activity, time: 1 });
    assert.ok(arm.rotation.x < 0, `${activity} should use a work pose`);
  }
  animateNpcModel(model, { activity: 'welcome', time: 1 });
  assert.ok(arm.rotation.z < -0.4);
  animateNpcModel(model, { activity: 'warmup', time: 1 });
  assert.ok(arm.rotation.z < -0.4);
  assert.ok(model.getObjectByName('npc-arm-left').rotation.z > 0.4);
  animateNpcModel(model, { activity: 'idle', time: 0 });
  assert.equal(arm.rotation.z, 0);
  assert.equal(model.getObjectByName('npc-arm-left').rotation.z, 0);
});

test('walking shoe clearance remains within one centimetre of the ground', () => {
  for (const source of models) {
    const model = source.clone(true);
    for (let step = 0; step < 36; step++) {
      animateNpcModel(model, { moving: true, time: step / 18 });
      const bounds = new THREE.Box3().setFromObject(model);
      assert.ok(bounds.min.y >= -0.01, `${model.userData.npcId} foot clearance ${bounds.min.y}`);
    }
  }
});

test('reduced-motion NPCs keep a steady grounded pose, and invalid clocks cannot poison transforms', () => {
  for (const source of models) {
    const model = source.clone(true);
    animateNpcModel(model, { moving: true, activity: 'greet', time: 123, reducedMotion: true });
    const pose = () => collect(model, () => true).map(object => [...object.position, object.rotation.x, object.rotation.y, object.rotation.z]);
    const first = pose();
    animateNpcModel(model, { moving: true, activity: 'greet', time: 999, reducedMotion: true });
    assert.deepEqual(pose(), first);
    assert.equal(model.getObjectByName('npc-leg-left').rotation.x, 0);
    animateNpcModel(model, { moving: true, time: NaN });
    assert.ok(pose().flat().every(Number.isFinite));
  }
});

test('separate NPC factory calls own resources independently and use no lights/textures', () => {
  const extra = createNpcModel('npc-ali');
  const original = models.find(model => model.userData.npcId === 'npc-ali');
  assert.notStrictEqual(meshesOf(extra)[0].geometry, meshesOf(original)[0].geometry);
  assert.notStrictEqual(meshesOf(extra)[0].material, meshesOf(original)[0].material);
  assert.equal(collect(extra, object => object.isLight).length, 0);
  for (const mesh of meshesOf(extra)) assert.equal(mesh.material.map, null);
  dispose(extra);
});
