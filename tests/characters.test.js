import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWinterGirl } from '../src/components/town/characters/WinterGirl.js';
import { createCapBoy } from '../src/components/town/characters/CapBoy.js';
import * as world from '../shared/world.js';

const { SPAWN, WORLD_LOCATIONS, getDestination, isWalkable } = world;
// Snapshot current configuration, including new map exports, rather than
// freezing a particular world version, movement speed or landmark count.
const snapshotWorld = () => JSON.stringify(Object.fromEntries(
  Object.entries(world).filter(([, value]) => typeof value !== 'function'),
));
const originalWorld = snapshotWorld();
const characters = [createWinterGirl(), createCapBoy()];
const [girl, boy] = characters;
const meshesOf = model => {
  const meshes = [];
  model.traverse(object => { if (object.isMesh) meshes.push(object); });
  return meshes;
};
const boundsOf = model => new THREE.Box3().setFromObject(model);
const triangleCount = model => meshesOf(model).reduce((sum, mesh) => {
  return sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
}, 0);

after(() => {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  for (const model of characters) for (const mesh of meshesOf(model)) {
    geometries.add(mesh.geometry);
    materials.add(mesh.material);
    if (mesh.material.bumpMap) textures.add(mesh.material.bumpMap);
  }
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
});

for (const model of characters) {
  test(`characters: ${model.userData.character} contains finite geometry, transforms and material values`, () => {
    assert.ok(model.isGroup);
    model.updateMatrixWorld(true);
    model.traverse(object => {
      for (const value of [...object.matrix.elements, ...object.matrixWorld.elements]) assert.ok(Number.isFinite(value), `${object.name} matrix`);
      if (!object.isMesh) return;
      const geometry = object.geometry;
      assert.ok(geometry.attributes.position.count > 0);
      assert.equal(geometry.attributes.position.itemSize, 3);
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        assert.equal(attribute.count, geometry.attributes.position.count, `${object.name} ${name} vertex count`);
        for (const value of attribute.array) assert.ok(Number.isFinite(value), `${object.name} ${name}`);
      }
      assert.ok(geometry.attributes.normal && geometry.attributes.uv);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      for (const value of [...geometry.boundingBox.min, ...geometry.boundingBox.max, ...geometry.boundingSphere.center, geometry.boundingSphere.radius]) {
        assert.ok(Number.isFinite(value), `${object.name} bounds`);
      }
      for (const [name, value] of Object.entries(object.material)) {
        // Three deliberately uses Infinity for no absorption; opaque textile
        // materials keep that valid MeshPhysicalMaterial default unchanged.
        if (name === 'attenuationDistance' && value === Infinity && object.material.transmission === 0) continue;
        if (typeof value === 'number') assert.ok(Number.isFinite(value), `${object.name} material.${name}`);
        if (value?.isColor) assert.ok([value.r, value.g, value.b].every(Number.isFinite), `${object.name} material.${name}`);
      }
    });
  });

  test(`characters: ${model.userData.character} stands on the floor at 4–4.5 world units tall`, () => {
    const bounds = boundsOf(model);
    assert.ok(Math.abs(bounds.min.y) < 1e-6, `sole Y must be 0, got ${bounds.min.y}`);
    const height = bounds.max.y - bounds.min.y;
    assert.ok(height >= 4 && height <= 4.5, `height ${height}`);
    assert.ok(bounds.min.x < 0 && bounds.max.x > 0);
    assert.ok(bounds.min.z < 0 && bounds.max.z > 0, 'must be a full 3D model, not a portrait plane');
    assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).x) < 0.15, 'body stays centered on its anchor');
  });

  test(`characters: ${model.userData.character} stays merged within 15 draws and 120000 triangles`, () => {
    const meshes = meshesOf(model);
    assert.ok(meshes.length > 1 && meshes.length <= 15, `main-pass mesh draws: ${meshes.length}`);
    assert.ok(model.userData.partCount > meshes.length * 5, 'many sculpted parts must remain merged rather than separate draws');
    assert.equal(new Set(meshes.map(mesh => mesh.material)).size, meshes.length, 'one merged batch per material');
    for (const mesh of meshes) {
      assert.ok(!Array.isArray(mesh.material), 'material arrays can hide extra draw calls');
      assert.equal(mesh.geometry.groups.length, 0, 'static batch must not preserve per-part draw groups');
      assert.equal(mesh.isSkinnedMesh, undefined, 'residents stay visual static models, not new simulation actors');
    }
    const triangles = triangleCount(model);
    assert.ok(Number.isInteger(triangles) && triangles > 0 && triangles < 120000, `triangles: ${triangles}`);
    assert.equal(model.userData.triangles, triangles, 'reported geometry budget matches actual attributes');
  });

  test(`characters: ${model.userData.character} uses physical textile relief, not portrait textures`, () => {
    const materials = meshesOf(model).map(mesh => mesh.material);
    const textile = materials.filter(material => material.bumpMap);
    assert.ok(textile.length >= 3, 'clothing must retain locally generated surface relief');
    for (const material of materials) assert.equal(material.map, null, 'no reference photo billboard or face texture');
    for (const material of textile) {
      assert.ok(material.isMeshPhysicalMaterial);
      assert.ok(material.roughness >= 0.8 && material.sheen > 0);
      assert.ok(material.bumpScale > 0 && material.bumpScale <= 0.05);
      const texture = material.bumpMap;
      assert.ok(texture.isDataTexture);
      assert.equal(texture.image.width, 256);
      assert.equal(texture.image.height, 256);
      assert.equal(texture.image.data.length, 256 * 256 * 4);
      assert.equal(texture.colorSpace, THREE.NoColorSpace, 'bump maps are data, not display color');
      assert.equal(texture.wrapS, THREE.RepeatWrapping);
      assert.equal(texture.wrapT, THREE.RepeatWrapping);
      assert.equal(texture.generateMipmaps, true);
      assert.ok(new Set(texture.image.data).size > 16, 'surface relief must not be a flat placeholder');
    }
  });
}

test('characters: two residents have distinct identities, silhouettes and clothing palettes', () => {
  assert.equal(girl.userData.character, 'winter-girl');
  assert.equal(boy.userData.character, 'cap-boy');
  assert.notEqual(girl.userData.displayName, boy.userData.displayName);
  const palette = model => [...new Set(meshesOf(model).map(mesh => mesh.material.color.getHexString()))].sort();
  assert.notDeepEqual(palette(girl), palette(boy));
  const girlBounds = boundsOf(girl), boyBounds = boundsOf(boy);
  assert.ok(girlBounds.max.y > boyBounds.max.y, 'knit pompom produces a taller silhouette');
  assert.ok(boyBounds.max.z > girlBounds.max.z + 0.3, 'baseball cap bill retains its distinct forward projection');
  assert.notEqual(triangleCount(girl), triangleCount(boy));
});

test('characters: alpha-blended cheek paint fades cleanly and never casts a decal shadow', () => {
  const alphaMeshes = characters.flatMap(meshesOf).filter(mesh => mesh.material.transparent);
  assert.ok(alphaMeshes.length > 0, 'soft painted cheeks are present');
  for (const mesh of alphaMeshes) {
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.material.vertexColors, true);
    assert.equal(mesh.material.polygonOffset, true);
    assert.ok(mesh.material.polygonOffsetFactor < 0);
    const colors = mesh.geometry.attributes.color;
    assert.equal(colors.itemSize, 4, 'paint uses actual vertex alpha');
    let clear = false, visible = false;
    for (let i = 0; i < colors.count; i++) {
      const alpha = colors.getW(i);
      assert.ok(alpha >= 0 && alpha <= 1);
      clear ||= alpha === 0;
      visible ||= alpha > 0;
    }
    assert.ok(clear && visible, 'cheek alpha must fade to zero rather than form a hard cutout');
  }
});

test('characters: shallow resource-sharing clones isolate pose while preserving bounded assets', () => {
  for (const model of characters) {
    const clone = model.clone(true);
    const originals = meshesOf(model), copies = meshesOf(clone);
    assert.notStrictEqual(clone, model);
    clone.position.set(7, 2, -4);
    assert.deepEqual(model.position.toArray(), [0, 0, 0]);
    for (let i = 0; i < originals.length; i++) {
      assert.notStrictEqual(copies[i], originals[i]);
      assert.strictEqual(copies[i].geometry, originals[i].geometry);
      assert.strictEqual(copies[i].material, originals[i].material);
    }
  }
  const textures = new Set(characters.flatMap(meshesOf).map(mesh => mesh.material.bumpMap).filter(Boolean));
  assert.equal(textures.size, 2, 'knit and woven materials reuse two bounded generated textures');
});

test('characters: building visual residents leaves shared world authority and destinations intact', () => {
  assert.equal(snapshotWorld(), originalWorld, 'character construction must not mutate current world configuration');
  assert.ok(isWalkable(SPAWN.x, SPAWN.z));
  for (const id of ['center', ...WORLD_LOCATIONS.map(place => place.id)]) {
    const destination = getDestination(id);
    assert.ok(isWalkable(destination.x, destination.z), `${id} remains accessible`);
  }
});
