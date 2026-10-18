import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Per-instance, material-batched modelling kit. No global GPU resource cache. */
export function createStorybookKit({ name = 'StorybookBuildingAsset', palette = {} } = {}) {
  const group = new THREE.Group();
  group.name = name;
  const materials = {}, temporary = new Set(), geometries = new Set(), textures = new Set();
  for (const [key, value] of Object.entries(palette)) {
    const options = typeof value === 'string' || typeof value === 'number' ? { color: value } : value;
    materials[key] = new THREE.MeshStandardMaterial({ name: `${name}-${key}`, roughness: 0.78, metalness: 0, ...options });
    for (const property of Object.values(materials[key])) if (property?.isTexture) textures.add(property);
  }
  const custom = geometry => { temporary.add(geometry); return geometry; };
  const sources = {
    box: custom(new RoundedBoxGeometry(1, 1, 1, 2, 0.095)),
    sphere: custom(new THREE.SphereGeometry(1, 20, 14)),
    cylinder: custom(new THREE.CylinderGeometry(1, 1, 1, 16)),
  };
  const batches = new Map();
  const scopes = new Map([['static', { group, pivot: new THREE.Vector3() }]]);
  const transform = new THREE.Object3D();
  let currentScope = 'static', partCount = 0, disposed = false, finished = false;
  function add(geometry, materialName, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0]) {
    if (finished || disposed) throw new Error('Building kit is already finalized.');
    if (!materials[materialName]) throw new Error('Unknown storybook material: ' + materialName);
    transform.position.set(...p); transform.scale.set(...s); transform.rotation.set(...r); transform.updateMatrix();
    const baked = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    baked.applyMatrix4(transform.matrix);
    const pivot = scopes.get(currentScope).pivot;
    baked.translate(-pivot.x, -pivot.y, -pivot.z);
    if (!baked.attributes.normal) baked.computeVertexNormals();
    if (!baked.attributes.uv) baked.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(baked.attributes.position.count * 2), 2));
    for (const key of Object.keys(baked.attributes)) if (!['position', 'normal', 'uv'].includes(key)) baked.deleteAttribute(key);
    baked.clearGroups();
    const key = currentScope + ':' + materialName;
    if (!batches.has(key)) batches.set(key, { scope: currentScope, materialName, pieces: [] });
    batches.get(key).pieces.push(baked); partCount++;
  }
  return {
    group, materials, custom, add,
    box: (mat, p, s, r) => add(sources.box, mat, p, s, r),
    sphere: (mat, p, s, r) => add(sources.sphere, mat, p, s, r),
    cylinder: (mat, p, radius, height, r) => add(sources.cylinder, mat, p, [radius, height, radius], r),
    beam(mat, a, b, radius) {
      const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
      const direction = to.clone().sub(from);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
      const r = new THREE.Euler().setFromQuaternion(quaternion);
      add(sources.cylinder, mat, from.add(to).multiplyScalar(0.5).toArray(), [radius, direction.length(), radius], [r.x, r.y, r.z]);
    },
    tube(mat, points, radius, segments = 32, closed = false) {
      const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed);
      add(custom(new THREE.TubeGeometry(curve, segments, radius, 8, closed)), mat);
    },
    torus(mat, p, radius, tube, r = [0, 0, 0], arc = Math.PI * 2) {
      add(custom(new THREE.TorusGeometry(radius, tube, 8, 48, arc)), mat, p, [1, 1, 1], r);
    },
    scope(name, pivot = [0, 0, 0]) {
      if (finished || disposed) throw new Error('Building kit is already finalized.');
      if (!scopes.has(name)) {
        const child = new THREE.Group(); child.name = name; child.position.set(...pivot); group.add(child);
        scopes.set(name, { group: child, pivot: new THREE.Vector3(...pivot) });
      }
      currentScope = name;
      return scopes.get(name).group;
    },
    finish() {
      if (finished || disposed) throw new Error('Building kit is already finalized.');
      finished = true;
      for (const { scope, materialName, pieces } of batches.values()) {
        const geometry = mergeGeometries(pieces, false);
        if (!geometry) throw new Error('Building geometry merge failed: ' + materialName);
        pieces.forEach(piece => piece.dispose()); geometries.add(geometry);
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, materials[materialName]);
        mesh.name = `${scope}-${materialName}`;
        mesh.castShadow = !materials[materialName].transparent;
        mesh.receiveShadow = true;
        scopes.get(scope).group.add(mesh);
      }
      batches.clear(); temporary.forEach(geometry => geometry.dispose()); temporary.clear();
      const used = new Set();
      let drawCalls = 0, triangles = 0, pointLights = 0;
      group.traverse(object => {
        if (object.isPointLight) pointLights++;
        if (!object.isMesh) return;
        used.add(object.material); drawCalls++;
        triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      });
      for (const [key, material] of Object.entries(materials)) if (!used.has(material)) {
        material.dispose(); delete materials[key];
      }
      group.updateMatrixWorld(true);
      const stats = { drawCalls, triangles, geometries: geometries.size, materials: used.size, textures: textures.size, partCount, pointLights };
      group.userData.stats = stats;
      return stats;
    },
    dispose() {
      if (disposed) return;
      disposed = true; group.removeFromParent();
      for (const batch of batches.values()) batch.pieces.forEach(piece => piece.dispose());
      batches.clear(); temporary.forEach(geometry => geometry.dispose()); temporary.clear();
      geometries.forEach(geometry => geometry.dispose()); geometries.clear();
      Object.values(materials).forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose()); textures.clear();
    },
  };
}
