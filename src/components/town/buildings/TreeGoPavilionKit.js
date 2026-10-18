import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Small locally generated relief maps, never a photograph or billboard. Each
// model owns its maps, so disposing one instance cannot invalidate another.
function relief(kind) {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const noise = ((Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1 + 1) % 1;
    const grain = Math.sin(x * 0.37 + Math.sin(y * 0.09) * 1.7);
    const value = Math.round(kind === 'bark' ? 115 + grain * 42 + noise * 28 : 115 + noise * 75);
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.name = 'pavilion-generated-' + kind;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function createPavilionKit() {
  const group = new THREE.Group();
  group.name = 'TreeGoPavilionAsset';
  const temporary = new Set(), geometries = new Set(), textures = new Set();
  const felt = relief('felt'), bark = relief('bark');
  textures.add(felt); textures.add(bark);
  const palette = {
    stone: '#b6ad96', stoneLight: '#d2c6ae', stoneDark: '#847e6d',
    wood: '#956b49', woodLight: '#bc9367', woodDark: '#5f442f',
    roof: '#a78b67', roofLight: '#c1a47d', roofDark: '#81674c',
    moss: '#546838', grass: '#72804b', lantern: '#ffe0a3',
    metal: '#775836', black: '#25302b', ivory: '#eee5cf', grid: '#615036',
    bark: '#78563d', barkLight: '#97724e', barkDark: '#5c422e',
    foliage: '#4b6a38', foliageMid: '#5e7841', foliageLight: '#738b4c', foliageDark: '#395731',
  };
  const materials = {};
  for (const [name, color] of Object.entries(palette)) {
    const isLeaf = name.startsWith('foliage'), isWood = /^(bark|wood|roof)/.test(name);
    materials[name] = new THREE.MeshStandardMaterial({
      name: 'pavilion-' + name, color,
      roughness: name === 'black' || name === 'ivory' ? 0.38 : isLeaf ? 0.94 : 0.82,
      metalness: name === 'metal' ? 0.32 : 0,
      bumpMap: isLeaf ? felt : isWood ? bark : name.startsWith('stone') ? felt : null,
      bumpScale: isLeaf ? 0.033 : isWood ? 0.022 : 0.012,
      ...(name === 'lantern' ? { emissive: '#ffc278', emissiveIntensity: 0.72, roughness: 0.8 } : {}),
    });
  }
  const custom = geometry => { temporary.add(geometry); return geometry; };
  const sources = {
    box: custom(new RoundedBoxGeometry(1, 1, 1, 1, 0.10)),
    sphere: custom(new THREE.SphereGeometry(1, 14, 10)),
    cylinder: custom(new THREE.CylinderGeometry(1, 1, 1, 12)),
  };
  const batches = new Map(), scopes = new Map();
  scopes.set('static', { group, pivot: new THREE.Vector3() });
  let currentScope = 'static', partCount = 0, disposed = false;
  const transform = new THREE.Object3D();
  const add = (geometry, materialName, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0]) => {
    if (!materials[materialName]) throw new Error('Unknown pavilion material: ' + materialName);
    transform.position.set(...p);
    transform.scale.set(...s);
    transform.rotation.set(...r);
    transform.updateMatrix();
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
    batches.get(key).pieces.push(baked);
    partCount++;
  };
  const kit = {
    group, materials, custom, add,
    box: (mat, p, s, r) => add(sources.box, mat, p, s, r),
    sphere: (mat, p, s, r) => add(sources.sphere, mat, p, s, r),
    cylinder: (mat, p, radius, height, r) => add(sources.cylinder, mat, p, [radius, height, radius], r),
    beam(mat, a, b, radius) {
      const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
      const direction = to.clone().sub(from);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
      const r = new THREE.Euler().setFromQuaternion(q);
      add(sources.cylinder, mat, from.add(to).multiplyScalar(0.5).toArray(), [radius, direction.length(), radius], [r.x, r.y, r.z]);
    },
    tube(mat, points, radius, segments = 24) {
      const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
      const geometry = custom(new THREE.TubeGeometry(curve, segments, radius, 6, false));
      add(geometry, mat);
    },
    scope(name, pivot = [0, 0, 0]) {
      if (!scopes.has(name)) {
        const child = new THREE.Group();
        child.name = name;
        child.position.set(...pivot);
        group.add(child);
        scopes.set(name, { group: child, pivot: new THREE.Vector3(...pivot) });
      }
      currentScope = name;
      return scopes.get(name).group;
    },
    finish() {
      for (const { scope, materialName, pieces } of batches.values()) {
        const geometry = mergeGeometries(pieces, false);
        if (!geometry) throw new Error('Pavilion merge failed: ' + materialName);
        pieces.forEach(piece => piece.dispose());
        geometries.add(geometry);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, materials[materialName]);
        mesh.name = scope + '-' + materialName;
        mesh.castShadow = materialName !== 'lantern';
        mesh.receiveShadow = materialName !== 'lantern';
        scopes.get(scope).group.add(mesh);
      }
      batches.clear();
      temporary.forEach(geometry => geometry.dispose());
      temporary.clear();
      const used = new Set();
      let drawCalls = 0, triangles = 0;
      group.traverse(object => {
        if (!object.isMesh) return;
        used.add(object.material); drawCalls++;
        triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      });
      // Unused palette entries are not retained for a smaller subassembly.
      for (const [name, material] of Object.entries(materials)) if (!used.has(material)) {
        material.dispose(); delete materials[name];
      }
      group.updateMatrixWorld(true);
      return { drawCalls, triangles, geometries: geometries.size, materials: used.size, textures: textures.size, partCount, pointLights: 1 };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      for (const batch of batches.values()) batch.pieces.forEach(piece => piece.dispose());
      batches.clear();
      temporary.forEach(geometry => geometry.dispose()); temporary.clear();
      geometries.forEach(geometry => geometry.dispose()); geometries.clear();
      Object.values(materials).forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose()); textures.clear();
    },
  };
  return kit;
}
