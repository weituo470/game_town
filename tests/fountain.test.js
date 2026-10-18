import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FOUNTAIN_SPEC, createLandmarkFountain } from '../src/components/town/landmarks/createLandmarkFountain.js';

const EPSILON = 1e-5;

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
    const count = object.isInstancedMesh ? object.count : 1;
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
      const passes = range.material.transparent && range.material.side === THREE.DoubleSide && !range.material.forceSinglePass ? 2 : 1;
      drawCalls += passes;
      // The geometry budget counts actual submitted triangles, including instances,
      // without multiplying by the transparent material's front/back draw passes.
      triangles += (end - start) / 3 * count;
    }
  });
  return { drawCalls, triangles };
}

function exactBounds(group) {
  group.updateMatrixWorld(true);
  const point = new THREE.Vector3(), instance = new THREE.Matrix4(), world = new THREE.Matrix4();
  const bounds = new THREE.Box3();
  let radius = 0, vertices = 0;
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
        assert.ok(point.toArray().every(Number.isFinite), `${object.name} has a nonfinite transformed vertex`);
        bounds.expandByPoint(point);
        radius = Math.max(radius, Math.hypot(point.x, point.z));
        vertices++;
      }
    }
  });
  return { bounds, radius, vertices };
}

function animationSnapshot(group) {
  const objects = [], resources = resourcesOf(group);
  group.traverse(object => {
    objects.push({
      position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(),
      visible: object.visible, intensity: object.intensity,
      instanceMatrix: object.instanceMatrix ? Array.from(object.instanceMatrix.array) : undefined,
      instanceColor: object.instanceColor ? Array.from(object.instanceColor.array) : undefined,
    });
  });
  return JSON.stringify({
    elapsed: group.userData.elapsed,
    objects,
    geometries: [...resources.geometries].map(geometry => Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, attribute]) => [name, Array.from(attribute.array)]),
    )),
    materials: [...resources.materials].map(material => ({
      opacity: material.opacity, color: material.color?.toArray(), emissive: material.emissive?.toArray(),
      emissiveIntensity: material.emissiveIntensity,
      fountainTime: material.userData.fountainTime?.value,
      uniforms: Object.fromEntries(Object.entries(material.uniforms || {}).map(([key, uniform]) => [key, uniform.value?.isTexture ? uniform.value.uuid : uniform.value])),
    })),
    textures: [...resources.textures].map(texture => ({ offset: texture.offset.toArray(), repeat: texture.repeat.toArray(), rotation: texture.rotation })),
  });
}

function fixture(t) {
  const fountain = createLandmarkFountain();
  t.after(() => fountain.dispose());
  return fountain;
}

test('fountain: standalone factory exposes the fixed landmark interface and an unpositioned group', t => {
  const fountain = fixture(t);
  assert.ok(fountain.group.isGroup);
  assert.equal(typeof fountain.update, 'function');
  assert.equal(typeof fountain.dispose, 'function');
  assert.deepEqual(fountain.group.position.toArray(), [0, 0, 0]);
  assert.deepEqual(fountain.group.rotation.toArray().slice(0, 3), [0, 0, 0]);
  assert.deepEqual(fountain.group.scale.toArray(), [1, 1, 1]);
  assert.ok(FOUNTAIN_SPEC.radius > 0 && FOUNTAIN_SPEC.radius <= 5.6);
  assert.ok(FOUNTAIN_SPEC.height >= 7.5 && FOUNTAIN_SPEC.height <= 9);
  assert.equal(FOUNTAIN_SPEC.collisionRadius, 5.9);
  assert.equal(FOUNTAIN_SPEC.drawCallBudget, 35);
  assert.equal(fountain.group.userData.elapsed, 0);
});

test('fountain: all geometry, transforms, material colors and instance matrices remain finite', t => {
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

test('fountain: exact geometry stays grounded within radius 5.6 and height 7.5–9 across animation phases', t => {
  const fountain = fixture(t);
  for (let phase = 0; phase <= 5; phase++) {
    const { bounds, radius, vertices } = exactBounds(fountain.group);
    assert.ok(vertices > 0);
    assert.ok(Math.abs(bounds.min.y) <= EPSILON, `ground Y ${bounds.min.y}`);
    assert.ok(bounds.max.y >= 7.5 && bounds.max.y <= 9 + EPSILON, `highest point ${bounds.max.y}`);
    assert.ok(radius <= 5.6 + EPSILON, `radius ${radius}`);
    assert.ok(radius <= FOUNTAIN_SPEC.radius + EPSILON, `declared radius ${FOUNTAIN_SPEC.radius} understates ${radius}`);
    assert.ok(bounds.max.y <= FOUNTAIN_SPEC.height + EPSILON, `declared height ${FOUNTAIN_SPEC.height} understates ${bounds.max.y}`);
    assert.ok(bounds.max.x - bounds.min.x > 8 && bounds.max.z - bounds.min.z > 8, 'large full 3D basin, not a billboard');
    for (let frame = 0; frame < 120; frame++) fountain.update(1 / 60);
  }
});

test('fountain: reported main-pass budget matches geometry and stays within 35 draw calls', t => {
  const fountain = fixture(t), measured = renderBudget(fountain.group), resources = resourcesOf(fountain.group);
  assert.ok(measured.drawCalls > 0 && measured.drawCalls <= 35, `main-pass draws ${measured.drawCalls}`);
  assert.ok(Number.isInteger(measured.triangles) && measured.triangles > 0, `triangles ${measured.triangles}`);
  assert.equal(fountain.stats.drawCalls, measured.drawCalls);
  assert.equal(fountain.stats.triangles, measured.triangles);
  assert.equal(fountain.stats.geometries, resources.geometries.size);
  assert.equal(fountain.stats.materials, resources.materials.size);
});

test('fountain: at most one additional point light, with no shadow light or external image assets', t => {
  const fountain = fixture(t), lights = [];
  fountain.group.traverse(object => { if (object.isLight) lights.push(object); });
  assert.ok(lights.length <= 1, `extra lights ${lights.length}`);
  for (const light of lights) {
    assert.ok(light.isPointLight);
    assert.equal(light.castShadow, false);
    assert.ok(Number.isFinite(light.intensity) && light.intensity >= 0);
  }
  for (const texture of resourcesOf(fountain.group).textures) {
    assert.ok(texture.isDataTexture || texture.isCanvasTexture, 'textures must be generated locally, not loaded image assets');
    assert.ok(!texture.image?.src, 'no downloaded image URL');
  }
});

test('fountain: animation advances real scene state from delta and reducedMotion freezes everything', t => {
  const fountain = fixture(t), initial = animationSnapshot(fountain.group);
  for (let i = 0; i < 4; i++) fountain.update(0.025);
  assert.ok(Math.abs(fountain.group.userData.elapsed - 0.1) < 1e-10, `elapsed ${fountain.group.userData.elapsed}`);
  const active = animationSnapshot(fountain.group);
  assert.notEqual(active, initial);
  // elapsed alone is not animation: geometry/material/instance state must change.
  const withoutTime = snapshot => { const value = JSON.parse(snapshot); delete value.elapsed; return value; };
  assert.notDeepEqual(withoutTime(active), withoutTime(initial), 'moving water must alter renderable state');
  for (let i = 0; i < 60; i++) fountain.update(1 / 60, true);
  assert.equal(animationSnapshot(fountain.group), active, 'reducedMotion must freeze transforms, buffers, uniforms and clock');
  fountain.update(0.025, false);
  assert.ok(Math.abs(fountain.group.userData.elapsed - 0.125) < 1e-10, 'resume without accumulating paused time');
});

test('fountain: reducedMotion also preserves the initial still frame', t => {
  const fountain = fixture(t), initial = animationSnapshot(fountain.group);
  fountain.update(1 / 60, true);
  fountain.update(2, true);
  assert.equal(animationSnapshot(fountain.group), initial);
});

test('fountain: procedural water retains standard lighting and shares the animation clock with its shaders', t => {
  const fountain = fixture(t);
  const water = [...resourcesOf(fountain.group).materials].filter(material => material.userData.fountainTime);
  assert.ok(water.length >= 2, 'both surface and flowing water must animate');
  const programs = [];
  for (const material of water) {
    assert.ok(material.isMeshStandardMaterial, 'use the existing standard lit pipeline, not an extra postprocess');
    const shader = {
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    material.onBeforeCompile(shader);
    assert.strictEqual(shader.uniforms.uFountainTime, material.userData.fountainTime);
    assert.match(shader.vertexShader, /vFountainUv\s*=\s*uv/);
    assert.match(shader.fragmentShader, /uniform float uFountainTime/);
    assert.match(shader.fragmentShader, /#include <lights_fragment_begin>/);
    assert.match(shader.fragmentShader, /#include <fog_fragment>/);
    programs.push(shader);
  }
  fountain.update(0.025);
  for (const shader of programs) assert.equal(shader.uniforms.uFountainTime.value, fountain.group.userData.elapsed);
  fountain.update(0.025, true);
  for (const shader of programs) assert.equal(shader.uniforms.uFountainTime.value, 0.025);
});

test('fountain: invalid deltas and post-disposal updates do not corrupt animation state', t => {
  const fountain = fixture(t);
  const initial = animationSnapshot(fountain.group);
  for (const delta of [0, -1, NaN, Infinity, -Infinity]) fountain.update(delta);
  assert.equal(animationSnapshot(fountain.group), initial);
  fountain.dispose();
  const disposed = animationSnapshot(fountain.group);
  fountain.update(1 / 60);
  assert.equal(animationSnapshot(fountain.group), disposed);
});

test('fountain: independently mounted landmarks isolate their animation and resource ownership', t => {
  const a = fixture(t), b = fixture(t), bInitial = animationSnapshot(b.group);
  assert.notStrictEqual(a.group, b.group);
  const aResources = resourcesOf(a.group), bResources = resourcesOf(b.group);
  for (const category of ['geometries', 'materials', 'textures', 'instances']) {
    for (const resource of aResources[category]) assert.ok(!bResources[category].has(resource), `independent owner must not release shared ${category}`);
  }
  a.update(1 / 30);
  assert.equal(animationSnapshot(b.group), bInitial);
  let bDisposals = 0;
  for (const set of Object.values(bResources)) for (const resource of set) resource.addEventListener('dispose', () => { bDisposals++; });
  a.dispose();
  assert.equal(bDisposals, 0);
  b.update(1 / 30);
  assert.notEqual(animationSnapshot(b.group), bInitial, 'surviving instance continues animating');
});

test('fountain: disposal releases every unique GPU resource exactly once and tolerates repeated cleanup', () => {
  const fountain = createLandmarkFountain(), resources = resourcesOf(fountain.group), events = new Map();
  for (const set of Object.values(resources)) for (const resource of set) {
    events.set(resource, 0);
    resource.addEventListener('dispose', () => events.set(resource, events.get(resource) + 1));
  }
  assert.ok(events.size > 0);
  fountain.dispose();
  fountain.dispose();
  for (const [resource, count] of events) assert.equal(count, 1, `${resource.type || resource.constructor.name} must be disposed exactly once`);
});

test('fountain: setup-cleanup-setup creates fresh usable resources for a StrictMode-style remount', t => {
  const first = createLandmarkFountain();
  const oldResources = resourcesOf(first.group);
  first.dispose();
  const second = fixture(t);
  second.update(1 / 60);
  assert.ok(second.group.userData.elapsed > 0);
  const bounds = exactBounds(second.group);
  assert.ok(bounds.radius <= 5.6 + EPSILON && bounds.bounds.max.y >= 7.5);
  const nextResources = resourcesOf(second.group);
  for (const category of ['geometries', 'materials', 'textures', 'instances']) {
    for (const resource of nextResources[category]) assert.ok(!oldResources[category].has(resource), `remount reused disposed ${category}`);
  }
});
