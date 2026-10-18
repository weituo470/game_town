import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { PAVILION_SPEC, createTreeGoPavilion } from '../src/components/town/buildings/createTreeGoPavilion.js';

const EPSILON = 1e-4;

function resourcesOf(group) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), instances = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.isInstancedMesh) instances.add(object);
    for (const material of [].concat(object.material || [])) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      for (const { value } of Object.values(material.uniforms || {})) if (value?.isTexture) textures.add(value);
    }
  });
  return { geometries, materials, textures, instances };
}

function renderBudget(group) {
  let drawCalls = 0, triangles = 0;
  group.traverseVisible(object => {
    if (!object.isMesh || object.count === 0) return;
    const materials = [].concat(object.material);
    const instances = object.isInstancedMesh ? object.count : 1;
    const geometry = object.geometry;
    const length = geometry.index?.count ?? geometry.attributes.position.count;
    const ranges = Array.isArray(object.material)
      ? geometry.groups.map(range => ({ ...range, material: materials[range.materialIndex] }))
      : [{ start: 0, count: length, material: materials[0] }];
    for (const range of ranges) {
      if (!range.material?.visible) continue;
      const start = Math.max(range.start, geometry.drawRange.start);
      const end = Math.min(range.start + range.count, length, geometry.drawRange.start + geometry.drawRange.count);
      if (end <= start) continue;
      drawCalls += range.material.transparent && range.material.side === THREE.DoubleSide && !range.material.forceSinglePass ? 2 : 1;
      // Count submitted triangles including instances, but not transparent front/back passes.
      triangles += (end - start) / 3 * instances;
    }
  });
  return { drawCalls, triangles };
}

function exactBounds(group) {
  group.updateMatrixWorld(true);
  const point = new THREE.Vector3(), instance = new THREE.Matrix4(), world = new THREE.Matrix4();
  const bounds = new THREE.Box3();
  let vertices = 0;
  group.traverse(object => {
    if (!object.isMesh) return;
    const position = object.geometry.attributes.position;
    for (let i = 0; i < (object.isInstancedMesh ? object.count : 1); i++) {
      if (object.isInstancedMesh) {
        object.getMatrixAt(i, instance);
        world.multiplyMatrices(object.matrixWorld, instance);
      } else world.copy(object.matrixWorld);
      for (let j = 0; j < position.count; j++) {
        point.fromBufferAttribute(position, j).applyMatrix4(world);
        assert.ok(point.toArray().every(Number.isFinite), `${object.name} nonfinite transformed vertex`);
        bounds.expandByPoint(point);
        vertices++;
      }
    }
  });
  return { bounds, size: bounds.getSize(new THREE.Vector3()), vertices };
}

function bufferHash(array) {
  return createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
}

function uniformValue(value) {
  if (value?.isTexture) return value.uuid;
  if (typeof value?.toArray === 'function') return value.toArray();
  if (ArrayBuffer.isView(value)) return Array.from(value);
  return value;
}

function poseOf(object) {
  return {
    name: object.name, position: object.position.toArray(), quaternion: object.quaternion.toArray(),
    scale: object.scale.toArray(), visible: object.visible, intensity: object.intensity,
    instanceMatrix: object.instanceMatrix && bufferHash(object.instanceMatrix.array),
    instanceColor: object.instanceColor && bufferHash(object.instanceColor.array),
  };
}

function animationSnapshot(group, includeClock = true) {
  const objects = [], resources = resourcesOf(group);
  group.traverse(object => objects.push(poseOf(object)));
  return JSON.stringify({
    elapsed: includeClock ? group.userData.elapsed : undefined,
    objects,
    geometries: [...resources.geometries].map(geometry => ({
      attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, bufferHash(attribute.array)])),
      index: geometry.index && bufferHash(geometry.index.array),
    })),
    materials: [...resources.materials].map(material => ({
      opacity: material.opacity, color: material.color?.toArray(), emissive: material.emissive?.toArray(),
      emissiveIntensity: material.emissiveIntensity,
      uniforms: Object.fromEntries(Object.entries(material.uniforms || {}).map(([key, uniform]) => [key, uniformValue(uniform.value)])),
    })),
    textures: [...resources.textures].map(texture => ({
      offset: texture.offset.toArray(), repeat: texture.repeat.toArray(), rotation: texture.rotation,
      data: texture.image?.data && bufferHash(texture.image.data),
    })),
  });
}

function staticPoses(group, canopy) {
  const poses = [];
  const visit = object => {
    if (object === canopy) return;
    poses.push(poseOf(object));
    object.children.forEach(visit);
  };
  visit(group);
  return poses;
}

function fixture(t) {
  const pavilion = createTreeGoPavilion();
  t.after(() => pavilion.dispose());
  return pavilion;
}

test('pavilion: independent factory exposes the integration interface and ground-centred root', t => {
  const pavilion = fixture(t);
  assert.ok(pavilion.group.isGroup);
  assert.equal(pavilion.group.name, 'TreeGoPavilionAsset');
  assert.equal(typeof pavilion.update, 'function');
  assert.equal(typeof pavilion.dispose, 'function');
  assert.deepEqual(pavilion.group.position.toArray(), [0, 0, 0]);
  assert.deepEqual(pavilion.group.rotation.toArray().slice(0, 3), [0, 0, 0]);
  assert.deepEqual(pavilion.group.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(pavilion.group.userData.spec, PAVILION_SPEC);
  assert.deepEqual(pavilion.group.userData.stats, pavilion.stats);
  assert.equal(pavilion.group.userData.elapsed, 0);
});

test('pavilion: all geometry, attributes, indices, transforms and material values are finite', t => {
  const { group } = fixture(t);
  group.updateMatrixWorld(true);
  group.traverse(object => {
    assert.ok([...object.matrix.elements, ...object.matrixWorld.elements].every(Number.isFinite), `${object.name} transforms`);
    if (!object.isMesh) return;
    const geometry = object.geometry;
    assert.ok(geometry.attributes.position.count > 0);
    assert.equal(geometry.attributes.position.itemSize, 3);
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      assert.ok(Array.from(attribute.array).every(Number.isFinite), `${object.name} ${name}`);
      assert.equal(attribute.count, geometry.attributes.position.count, `${object.name} ${name} vertex count`);
    }
    if (geometry.index) for (const index of geometry.index.array) assert.ok(index >= 0 && index < geometry.attributes.position.count);
    if (object.instanceMatrix) assert.ok(Array.from(object.instanceMatrix.array).every(Number.isFinite));
    if (object.instanceColor) assert.ok(Array.from(object.instanceColor.array).every(Number.isFinite));
    for (const material of [].concat(object.material)) for (const [name, value] of Object.entries(material)) {
      if (name === 'attenuationDistance' && value === Infinity && material.transmission === 0) continue;
      if (typeof value === 'number') assert.ok(Number.isFinite(value), `${object.name} material.${name}`);
      if (value?.isColor) assert.ok(value.toArray().every(Number.isFinite), `${object.name} material.${name}`);
    }
  });
});

test('pavilion: the main trunk first ring has outward-facing bark normals around its full circumference', t => {
  const { group } = fixture(t), bark = group.getObjectByName('static-bark');
  assert.ok(bark?.isMesh, 'the static bark batch must exist');
  const { position, normal, uv } = bark.geometry.attributes;
  const centre = new THREE.Vector3(-1.1, 0.87, -0.65);
  const radial = new THREE.Vector3(), surfaceNormal = new THREE.Vector3();
  // The trunk is the first bark piece. Material batching expands each of its
  // 16 radial quads to six vertices, with its first vertex on the first ring.
  // Sampling every sector catches inside-out tube winding without relying on
  // a screenshot or merely checking that the normals contain finite values.
  assert.equal(bark.geometry.index, null, 'bark batch uses expanded triangle geometry');
  for (let sector = 0; sector < 16; sector++) {
    const vertex = sector * 6;
    assert.ok(Math.abs(uv.getY(vertex)) < EPSILON, `sector ${sector} must sample the first trunk ring`);
    radial.fromBufferAttribute(position, vertex).sub(centre);
    surfaceNormal.fromBufferAttribute(normal, vertex);
    const outwardDot = radial.dot(surfaceNormal);
    assert.ok(outwardDot > 0.5, `trunk sector ${sector} has an inward/tangent normal (radial dot normal ${outwardDot})`);
  }
});

test('pavilion: full 3D geometry remains grounded and within the building envelope over wind phases', t => {
  const pavilion = fixture(t);
  for (let phase = 0; phase < 6; phase++) {
    const { bounds, size, vertices } = exactBounds(pavilion.group);
    assert.ok(vertices > 0);
    assert.ok(Math.abs(bounds.min.y) <= EPSILON, `ground Y ${bounds.min.y}`);
    assert.ok(size.x >= 9 && size.x <= 12 + EPSILON, `width ${size.x}`);
    assert.ok(size.y >= 8 && size.y <= 11 + EPSILON, `height ${size.y}`);
    assert.ok(size.z >= 8 && size.z <= 10 + EPSILON, `depth ${size.z}`);
    for (const [field, measured] of [['width', size.x], ['height', size.y], ['depth', size.z]]) {
      if (Number.isFinite(PAVILION_SPEC[field])) assert.ok(measured <= PAVILION_SPEC[field] + EPSILON, `declared ${field} ${PAVILION_SPEC[field]} understates ${measured}`);
    }
    for (let frame = 0; frame < 120; frame++) pavilion.update(1 / 60);
  }
});

test('pavilion: reported budgets match actual geometry and stay within 35 draws / 180k triangles / 28 materials', t => {
  const pavilion = fixture(t), measured = renderBudget(pavilion.group), resources = resourcesOf(pavilion.group);
  assert.ok(measured.drawCalls > 0 && measured.drawCalls <= 35, `main-pass draws ${measured.drawCalls}`);
  assert.ok(Number.isInteger(measured.triangles) && measured.triangles > 0 && measured.triangles <= 180000, `triangles ${measured.triangles}`);
  assert.ok(resources.materials.size <= 28, `materials ${resources.materials.size}`);
  assert.equal(pavilion.stats.drawCalls, measured.drawCalls);
  assert.equal(pavilion.stats.triangles, measured.triangles);
  for (const category of ['geometries', 'materials', 'textures']) assert.equal(pavilion.stats[category], resources[category].size, `${category} count`);
});

test('pavilion: canopy is an independent group with material-batched meshes', t => {
  const { group } = fixture(t), canopy = group.getObjectByName('PavilionCanopy');
  assert.ok(canopy?.isGroup, 'PavilionCanopy must be an independently animated group');
  const meshes = [], materials = new Set();
  canopy.traverse(object => { if (object.isMesh) meshes.push(object); });
  assert.ok(meshes.length > 0, 'canopy has real renderable geometry');
  for (const mesh of meshes) {
    assert.ok(!Array.isArray(mesh.material), 'one merged canopy mesh per material');
    assert.ok(!materials.has(mesh.material), 'canopy meshes with identical material should be merged');
    materials.add(mesh.material);
  }
});

test('pavilion: at most one non-shadow point light and no externally loaded image textures', t => {
  const { group } = fixture(t), lights = [];
  group.traverse(object => { if (object.isLight) lights.push(object); });
  assert.ok(lights.length <= 1, `extra lights ${lights.length}`);
  for (const light of lights) {
    assert.ok(light.isPointLight);
    assert.equal(light.castShadow, false);
    assert.ok(Number.isFinite(light.intensity) && light.intensity >= 0);
  }
  for (const texture of resourcesOf(group).textures) {
    assert.ok(texture.isDataTexture || texture.isCanvasTexture, 'texture must be generated locally');
    assert.ok(!texture.image?.src, 'texture must not depend on an image URL');
  }
});

test('pavilion: wind changes real canopy state while the structure remains still', t => {
  const pavilion = fixture(t), canopy = pavilion.group.getObjectByName('PavilionCanopy');
  assert.ok(canopy);
  const initialVisual = animationSnapshot(pavilion.group, false);
  const initialCanopy = poseOf(canopy), initialStatic = staticPoses(pavilion.group, canopy);
  for (let i = 0; i < 4; i++) pavilion.update(0.025);
  assert.ok(Math.abs(pavilion.group.userData.elapsed - 0.1) < 1e-10, `elapsed ${pavilion.group.userData.elapsed}`);
  assert.notEqual(animationSnapshot(pavilion.group, false), initialVisual, 'elapsed alone does not count as visible animation');
  assert.notDeepEqual(poseOf(canopy), initialCanopy, 'wind must affect the canopy transform');
  assert.deepEqual(staticPoses(pavilion.group, canopy), initialStatic, 'trunk, deck, furniture and lanterns must remain still');
});

test('pavilion: reducedMotion freezes render state and clock, then resumes without paused-time accumulation', t => {
  const pavilion = fixture(t);
  pavilion.update(0.025);
  const active = animationSnapshot(pavilion.group);
  for (let i = 0; i < 60; i++) pavilion.update(1 / 60, true);
  assert.equal(animationSnapshot(pavilion.group), active);
  pavilion.update(0.025, false);
  assert.ok(Math.abs(pavilion.group.userData.elapsed - 0.05) < 1e-10);
  assert.notEqual(animationSnapshot(pavilion.group), active);
});

test('pavilion: reducedMotion preserves the original still pose', t => {
  const pavilion = fixture(t), initial = animationSnapshot(pavilion.group);
  pavilion.update(1 / 60, true);
  pavilion.update(2, true);
  assert.equal(animationSnapshot(pavilion.group), initial);
});

test('pavilion: invalid deltas and updates after disposal cannot mutate the asset', t => {
  const pavilion = fixture(t), initial = animationSnapshot(pavilion.group);
  for (const delta of [0, -1, NaN, Infinity, -Infinity, undefined, null, '0.1']) pavilion.update(delta);
  assert.equal(animationSnapshot(pavilion.group), initial);
  pavilion.dispose();
  const disposed = animationSnapshot(pavilion.group);
  pavilion.update(1 / 60);
  assert.equal(animationSnapshot(pavilion.group), disposed);
});

test('pavilion: two instances have isolated animation and independently owned resources', t => {
  const a = fixture(t), b = fixture(t), bInitial = animationSnapshot(b.group);
  assert.notStrictEqual(a.group, b.group);
  const aResources = resourcesOf(a.group), bResources = resourcesOf(b.group);
  for (const category of ['geometries', 'materials', 'textures', 'instances']) {
    for (const resource of aResources[category]) assert.ok(!bResources[category].has(resource), `independent instance shares ${category}`);
  }
  a.update(1 / 30);
  assert.equal(animationSnapshot(b.group), bInitial);
  let bDisposals = 0;
  for (const set of Object.values(bResources)) for (const resource of set) resource.addEventListener('dispose', () => { bDisposals++; });
  a.dispose();
  assert.equal(bDisposals, 0, 'disposing A must not dispose B resources');
  b.update(1 / 30);
  assert.notEqual(animationSnapshot(b.group), bInitial);
});

test('pavilion: cleanup releases every unique GPU resource exactly once and is idempotent', () => {
  const pavilion = createTreeGoPavilion(), resources = resourcesOf(pavilion.group), events = new Map();
  for (const set of Object.values(resources)) for (const resource of set) {
    events.set(resource, 0);
    resource.addEventListener('dispose', () => events.set(resource, events.get(resource) + 1));
  }
  assert.ok(events.size > 0);
  pavilion.dispose();
  pavilion.dispose();
  for (const [resource, count] of events) assert.equal(count, 1, `${resource.type || resource.constructor.name} must be disposed exactly once`);
});

test('pavilion: StrictMode-style setup-cleanup-setup produces fresh, usable resources', t => {
  const first = createTreeGoPavilion(), oldResources = resourcesOf(first.group);
  first.dispose();
  const second = fixture(t), nextResources = resourcesOf(second.group);
  second.update(1 / 60);
  assert.ok(second.group.userData.elapsed > 0);
  const { size } = exactBounds(second.group);
  assert.ok(size.y >= 8 && size.y <= 11 + EPSILON);
  for (const category of ['geometries', 'materials', 'textures', 'instances']) {
    for (const resource of nextResources[category]) assert.ok(!oldResources[category].has(resource), `remount reused disposed ${category}`);
  }
});

test('pavilion: R3F wrapper allocates after commit and declares factory-owned cleanup', () => {
  // This is a source contract, not a substitute for the real-browser StrictMode mount check.
  const source = readFileSync(new URL('../src/components/town/buildings/TreeGoPavilion.jsx', import.meta.url), 'utf8');
  assert.match(source, /export default function TreeGoPavilion/);
  assert.match(source, /position\s*=\s*\[0,\s*0,\s*0\]/);
  assert.match(source, /reducedMotion\s*=\s*false/);
  assert.match(source, /useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]*?createTreeGoPavilion\(\)/);
  assert.match(source, /\.add\([^)]*\.group\)/);
  assert.match(source, /\.remove\([^)]*\.group\)/);
  assert.match(source, /\.dispose\(\)/);
  assert.match(source, /dispose=\{null\}/);
  assert.match(source, /\.update\(delta,\s*reducedMotion\)/);
});
