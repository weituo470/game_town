import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Small, deterministic surface relief, generated locally. The references guide
// the actual geometry; neither portrait is used as a billboard or face texture.
const textileTextures = new Map();
function textile(knit) {
  if (textileTextures.has(knit)) return textileTextures.get(knit);
  const size = 256, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / size * 12) % 1 - 0.5;
    const v = (y / size * 18) % 1;
    const line = 0.06 + 0.32 * (1 - v);
    const stitch = Math.exp(-((Math.abs(u) - line) ** 2) / 0.0045);
    const twist = 0.5 + 0.5 * Math.sin((x + y * 1.7) * 2.5);
    const noise = ((Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1 + 1) % 1;
    const relief = knit ? 0.24 + stitch * 0.52 + twist * 0.09 + noise * 0.1 : 0.4 + noise * 0.25 + twist * 0.09;
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round(relief * 255);
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  textileTextures.set(knit, texture);
  return texture;
}

export function clothMaterial(color, { knit = false, scale = 1 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.93, metalness: 0, sheen: 0.48,
    sheenColor: new THREE.Color(color).lerp(new THREE.Color('#fff4db'), 0.45),
    sheenRoughness: 0.88, bumpMap: textile(knit), bumpScale: (knit ? 0.022 : 0.012) * scale,
  });
}

export function basicMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.76, metalness: 0, ...options });
}

export class CharacterBuilder {
  constructor() { this.batches = new Map(); this.parts = 0; }
  add(geometry, material, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) {
    const shape = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const transform = new THREE.Object3D();
    transform.position.set(...position);
    transform.scale.set(...scale);
    transform.rotation.set(...rotation);
    transform.updateMatrix();
    shape.applyMatrix4(transform.matrix);
    if (!shape.attributes.normal) shape.computeVertexNormals();
    if (!shape.attributes.uv) shape.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(shape.attributes.position.count * 2), 2));
    for (const name of Object.keys(shape.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) shape.deleteAttribute(name);
    if (!this.batches.has(material)) this.batches.set(material, []);
    this.batches.get(material).push(shape);
    this.parts++;
    return this;
  }
  ellipsoid(position, scale, material) {
    return this.add(new THREE.SphereGeometry(1, 32, 24), material, position, scale);
  }
  roundBox(position, size, radius, material, rotation = [0, 0, 0]) {
    const safe = Math.max(0.001, Math.min(radius, Math.min(...size) / 2 - 0.001));
    return this.add(new RoundedBoxGeometry(...size, 4, safe), material, position, [1, 1, 1], rotation);
  }
  tube(points, radius, material, radialSegments = 8) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return this.add(new THREE.TubeGeometry(curve, Math.max(12, points.length * 8), radius, radialSegments, false), material);
  }
  lathe(profile, material, position = [0, 0, 0]) {
    return this.add(new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(...p)), 48), material, position);
  }
  build(name) {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, pieces] of this.batches) {
      const geometry = mergeGeometries(pieces, false);
      if (!geometry) throw new Error(`Cannot merge character material: ${name}`);
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = !material.transparent;
      mesh.receiveShadow = true;
      mesh.name = `${name}-${group.children.length + 1}`;
      group.add(mesh);
      pieces.forEach(piece => piece.dispose());
    }
    group.userData.partCount = this.parts;
    group.userData.triangles = group.children.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count / 3, 0);
    return group;
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  textileTextures.forEach(texture => texture.dispose());
  textileTextures.clear();
});
