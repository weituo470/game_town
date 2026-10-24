import * as THREE from 'three';
import { REALISTIC_ISLAND as ISLAND, ISLAND_TRAIL, islandHeight, islandSlope } from '../../../shared/realistic-island.js';

// Original, local-only geometry and textures. The town owns the only sky,
// ocean, renderer and lights; this module contributes land and small details.
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const smooth = (a, b, n) => { const t = clamp((n - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = n => { const x = Math.sin(n * 127.13 + 311.7) * 43758.5453123; return x - Math.floor(x); };
const SEA = ISLAND.seaLevel ?? -1.28;
const NEVER_RAYCAST = () => null;

export const ISLAND_VISUAL_QUALITY = Object.freeze({
  high: Object.freeze({ xSegments: 160, zSegments: 128, trees: 100, rocks: 52, pebbles: 150, grass: 420, shrubs: 110, shoreSegments: 320 }),
  low: Object.freeze({ xSegments: 96, zSegments: 76, trees: 54, rocks: 32, pebbles: 80, grass: 180, shrubs: 54, shoreSegments: 192 }),
});

function trailDistance(x, z) {
  let distance = Infinity;
  for (let i = 1; i < ISLAND_TRAIL.length; i++) {
    const a = ISLAND_TRAIL[i - 1], b = ISLAND_TRAIL[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz));
    distance = Math.min(distance, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return distance;
}

/** Deterministic planting, with open sand, readable footpaths and bare cliffs. */
export function createIslandPlanting(quality = 'high') {
  const q = ISLAND_VISUAL_QUALITY[quality] ?? ISLAND_VISUAL_QUALITY.high;
  const trees = [], shrubs = [], grass = [], rocks = [], pebbles = [];
  for (let i = 0; i < 7500 && (trees.length < q.trees || shrubs.length < q.shrubs || grass.length < q.grass); i++) {
    const x = ISLAND.x + (hash(i * 3 + 71) - .5) * ISLAND.width * .92;
    const z = ISLAND.z + (hash(i * 3 + 72) - .5) * ISLAND.depth * .91;
    const y = islandHeight(x, z), slope = islandSlope(x, z), d = trailDistance(x, z);
    const p = { x, y, z, seed: i + 1 };
    if (y > 4.4 && y < 28.5 && slope < .64 && d > 4.1 && trees.length < q.trees
      && trees.every(t => Math.hypot(t.x - x, t.z - z) > 4.1)) trees.push(p);
    else if (y > 2.2 && y < 24 && slope < .7 && d > 2.8 && shrubs.length < q.shrubs) shrubs.push(p);
    else if (y > .7 && y < 28 && slope < .72 && d > 1.9 && grass.length < q.grass) grass.push(p);
  }
  for (let i = 0; i < 5000 && (rocks.length < q.rocks || pebbles.length < q.pebbles); i++) {
    const angle = hash(i * 5 + 503) * TAU;
    const radial = .57 + hash(i * 5 + 504) * .38;
    const x = ISLAND.x + Math.cos(angle) * ISLAND.width * .5 * radial;
    const z = ISLAND.z + Math.sin(angle) * ISLAND.depth * .5 * radial;
    const y = islandHeight(x, z), slope = islandSlope(x, z);
    if (trailDistance(x, z) < 3.2 || y < SEA - .3) continue;
    const p = { x, y, z, seed: i + 401 };
    if (rocks.length < q.rocks && (slope > .37 || (y > .2 && y < 2.5))) rocks.push(p);
    else if (pebbles.length < q.pebbles && y < 5 && y > SEA + .05) pebbles.push(p);
  }
  return { trees, shrubs, grass, rocks, pebbles };
}

function terrainGeometry(q) {
  const geometry = new THREE.PlaneGeometry(ISLAND.width, ISLAND.depth, q.xSegments, q.zSegments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3), surfaces = new Float32Array(position.count * 3);
  const dry = new THREE.Color('#c8b792'), wet = new THREE.Color('#766e58');
  const soil = new THREE.Color('#62694b'), grass = new THREE.Color('#3d542f');
  const stone = new THREE.Color('#929388'), pale = new THREE.Color('#b6b1a0'), color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) + ISLAND.x, z = position.getZ(i) + ISLAND.z;
    const y = islandHeight(x, z), slope = islandSlope(x, z);
    position.setY(i, y);
    const greenery = smooth(1.3, 5.2, y) * (1 - smooth(.48, 1.02, slope));
    const rock = Math.max(smooth(.44, 1.05, slope), smooth(26, 33, y) * .48);
    color.copy(wet).lerp(dry, smooth(SEA + .25, 1.9, y));
    color.lerp(soil, greenery).lerp(grass, greenery * .47);
    color.lerp(stone, rock).lerp(pale, rock * (.18 + .14 * Math.sin(y * 1.7)));
    const mottling = .96 + .06 * Math.sin(x * .8 + Math.cos(z * .42)) * Math.sin(z * .92);
    color.multiplyScalar(mottling);
    color.toArray(colors, i * 3);
    surfaces.set([1 - greenery, rock, greenery], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('islandSurface', new THREE.BufferAttribute(surfaces, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

const NOISE_GLSL = `
  float islandHash(vec3 p){p=fract(p*.3183099+vec3(.11,.23,.37));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
  float islandNoise(vec3 p){vec3 a=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(islandHash(a),islandHash(a+vec3(1,0,0)),f.x),mix(islandHash(a+vec3(0,1,0)),islandHash(a+vec3(1,1,0)),f.x),f.y),
      mix(mix(islandHash(a+vec3(0,0,1)),islandHash(a+vec3(1,0,1)),f.x),mix(islandHash(a+vec3(0,1,1)),islandHash(a+vec3(1,1,1)),f.x),f.y),f.z);}
`;

function stoneMaterial(terrain = false) {
  const material = new THREE.MeshStandardMaterial({ color: terrain ? '#ffffff' : '#a5a398', vertexColors: terrain, roughness: .93, metalness: 0 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vIslandPoint;varying vec3 vIslandSurface;${terrain ? 'attribute vec3 islandSurface;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 islandP=vec4(transformed,1.);
      #ifdef USE_INSTANCING
        islandP=instanceMatrix*islandP;
      #endif
      vIslandPoint=(modelMatrix*islandP).xyz;vIslandSurface=${terrain ? 'islandSurface' : 'vec3(0.,1.,0.)'};`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vIslandPoint;varying vec3 vIslandSurface;${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float islandCoarse=islandNoise(vIslandPoint*.52),islandGrain=islandNoise(vIslandPoint*10.7);
      float islandLayer=sin(vIslandPoint.y*3.9+sin(vIslandPoint.x*.11+vIslandPoint.z*.13)*1.4);
      diffuseColor.rgb*=.86+islandCoarse*.23+islandGrain*.075;
      diffuseColor.rgb*=1.-vIslandSurface.y*(.035+smoothstep(.58,.98,islandLayer)*.13);
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.74,.82,.78),vIslandSurface.y*islandNoise(vIslandPoint*.26)*.13);
      float islandBrushPatch=islandNoise(vIslandPoint*.105);
      diffuseColor.rgb*=mix(vec3(.72,.83,.68),vec3(1.18,1.04,.79),smoothstep(.28,.72,islandBrushPatch))*vIslandSurface.z+vec3(1.-vIslandSurface.z);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor=mix(roughnessFactor,.5,(1.-smoothstep(${(SEA + .2).toFixed(2)},.75,vIslandPoint.y))*vIslandSurface.x);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float islandRelief=islandNoise(vIslandPoint*4.4)*mix(.006,.022,vIslandSurface.y)+islandNoise(vIslandPoint*16.3)*.005;
      islandRelief+=sin(vIslandPoint.x*7.+sin(vIslandPoint.z*.8)*2.)*.003*vIslandSurface.x;
      vec3 islandDx=dFdx(-vViewPosition),islandDy=dFdy(-vViewPosition);
      vec3 islandR1=cross(islandDy,normal),islandR2=cross(normal,islandDx);
      float islandDet=dot(islandDx,islandR1);
      vec3 islandGrad=sign(islandDet)*(dFdx(islandRelief)*islandR1+dFdy(islandRelief)*islandR2);
      normal=normalize(abs(islandDet)*normal-islandGrad+normal*1e-8);`);
  };
  material.customProgramCacheKey = () => `mist-headland-strata-v2-${terrain}`;
  return material;
}

function roundedRock(detail = 2) {
  const geometry = new THREE.IcosahedronGeometry(1, detail), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const radius = 1 + Math.sin(x * 4 + z * 2) * .09 + Math.sin(y * 5 - x * 2) * .045;
    p.setXYZ(i, x * radius, y * radius * .81, z * radius);
  }
  // IcosahedronGeometry is non-indexed: welding normals by direction retains
  // rounded weathered boulders instead of conspicuous low-poly triangular faces.
  const normals = new Float32Array(p.count * 3), buckets = new Map();
  geometry.computeVertexNormals();
  for (let i = 0; i < p.count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e5)).join(',');
    const bucket = buckets.get(key) ?? { normal: new THREE.Vector3(), indices: [] };
    bucket.normal.add(new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, i)); bucket.indices.push(i); buckets.set(key, bucket);
  }
  for (const { normal, indices } of buckets.values()) { normal.normalize(); for (const i of indices) normal.toArray(normals, i * 3); }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}

/** Fine-leaf branchlets, not metre-wide individual leaves or tree billboards. */
export function createIslandLeafTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / (size - 1) - .5) * 2, v = y / (size - 1);
    let alpha = (1 - smooth(.008, .023, Math.abs(u - Math.sin(v * 3) * .018))) * (1 - smooth(.85, .95, v)), vein = 0;
    const leaf = (ax, ay, bx, by, width) => {
      const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
      const along = ((u - ax) * dx + (v - ay) * dy) / length;
      if (along <= 0 || along >= 1) return;
      const cross = Math.abs((u - ax) * dy - (v - ay) * dx) / Math.sqrt(length);
      const edge = Math.pow(Math.sin(along * Math.PI), .8) * width;
      alpha = Math.max(alpha, 1 - smooth(edge * .77, edge, cross));
      vein = Math.max(vein, Math.exp(-cross * 150) * .16 * Math.sin(along * Math.PI));
    };
    for (let pair = 0; pair < 6; pair++) for (const side of [-1, 1]) {
      const start = .09 + pair * .115 + (side < 0 ? .033 : 0), reach = .7 - pair * .057;
      leaf(.01 * side, start, reach * side, start + .17 - pair * .009, .056 + (5 - pair) * .004);
    }
    leaf(0, .73, .025, .995, .105);
    const light = .72 + v * .22 + vein + hash(y * size + x) * .045;
    const index = (y * size + x) * 4;
    data[index] = Math.round(light * 235); data[index + 1] = Math.round(light * 255); data[index + 2] = Math.round(light * 210); data[index + 3] = Math.round(alpha * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  texture.name = 'original-procedural-coastal-leaf-branchlet'; return texture;
}

function leafSprayGeometry() {
  const positions = [], normals = [], uvs = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < 18; i++) {
    const arm = Math.floor(i / 6), k = i % 6, angle = arm * TAU / 3 + (k % 2 ? .46 : -.46);
    const length = .63 + hash(i + 71) * .42, width = length * .72;
    const center = new THREE.Vector3(Math.cos(arm * TAU / 3) * k * .14, k * .07, Math.sin(arm * TAU / 3) * k * .14);
    const direction = new THREE.Vector3(Math.cos(angle), .35 + hash(i + 86) * .7, Math.sin(angle)).normalize().multiplyScalar(length);
    const sideways = new THREE.Vector3(-Math.sin(angle), .18 * Math.sin(i * 2), Math.cos(angle)).normalize().multiplyScalar(width / 2);
    a.copy(center).sub(sideways); b.copy(center).add(sideways); c.copy(b).add(direction); d.copy(a).add(direction);
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    for (const [p, uv] of [[a, [0, 0]], [b, [1, 0]], [d, [0, 1]], [b, [1, 0]], [c, [1, 1]], [d, [0, 1]]]) {
      positions.push(p.x, p.y, p.z); normals.push(normal.x, normal.y, normal.z); uvs.push(...uv);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere(); return geometry;
}

function grassGeometry() {
  const positions = [], normals = [], uvs = [];
  for (let i = 0; i < 6; i++) {
    const angle = hash(i + 19) * TAU, height = .38 + hash(i + 29) * .5;
    const x = Math.cos(angle) * .14, z = Math.sin(angle) * .14, w = .022 + hash(i + 1) * .019;
    const points = [[x - w, 0, z], [x + w, 0, z], [x + .12 * Math.cos(angle) + w * .6, height * .66, z + .12 * Math.sin(angle)],
      [x - w, 0, z], [x + .12 * Math.cos(angle) + w * .6, height * .66, z + .12 * Math.sin(angle)], [x + .24 * Math.cos(angle), height, z + .24 * Math.sin(angle)]];
    for (let j = 0; j < points.length; j++) { positions.push(...points[j]); normals.push(Math.sin(angle) * .4, .8, Math.cos(angle) * .4); uvs.push(j % 2, j >= 4 ? 1 : .3); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); return geometry;
}

function foliageMaterial(texture, clock, grass = false) {
  // A high .46 threshold erased branchlets after mipmapping at aerial distance.
  // A dark base tint survives shared daylight/exposure; per-instance variation
  // is a multiplier, not the only source of green/brown in the material.
  const material = new THREE.MeshStandardMaterial({ color: grass ? '#6f7d38' : '#718e49', map: texture, alphaTest: texture ? .18 : 0, alphaToCoverage: !!texture, side: THREE.DoubleSide, roughness: .91, metalness: 0 });
  material.forceSinglePass = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.islandClock = clock;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float islandClock;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      float islandSeed=0.;
      #ifdef USE_INSTANCING
        islandSeed=instanceMatrix[3].x*.17+instanceMatrix[3].z*.13;
      #endif
      transformed.x+=sin(islandClock*1.3+islandSeed+position.z*2.)*${grass ? '.075' : '.035'}*clamp(position.y,0.,1.);
      transformed.z+=cos(islandClock*.9+islandSeed+position.x)*${grass ? '.045' : '.018'}*clamp(position.y,0.,1.);`);
  };
  material.customProgramCacheKey = () => `mist-headland-foliage-v1-${grass}`; return material;
}

function instanceMesh(geometry, material, matrices, colors, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  mesh.name = name; mesh.raycast = NEVER_RAYCAST;
  matrices.forEach((matrix, i) => { mesh.setMatrixAt(i, matrix); if (colors) mesh.setColorAt(i, colors[i]); });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox(); mesh.computeBoundingSphere(); return mesh;
}

function transform(x, y, z, sx, sy, sz, yaw = 0, tilt = 0) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x - ISLAND.x, y, z - ISLAND.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0)), new THREE.Vector3(sx, sy, sz));
}

function groundPlank(x, z, sx, sz, yaw = 0) {
  const delta = .2, dx = (islandHeight(x + delta, z) - islandHeight(x - delta, z)) / (2 * delta);
  const dz = (islandHeight(x, z + delta) - islandHeight(x, z - delta)) / (2 * delta);
  const normal = new THREE.Vector3(-dx, 1, -dz).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(UP, normal)
    .multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
  return new THREE.Matrix4().compose(new THREE.Vector3(x - ISLAND.x, islandHeight(x, z) + .055, z - ISLAND.z), rotation, new THREE.Vector3(sx, .11, sz));
}

function beamMatrix(a, b, radius, width = radius) {
  const direction = new THREE.Vector3().subVectors(b, a), position = a.clone().add(b).multiplyScalar(.5);
  position.x -= ISLAND.x; position.z -= ISLAND.z;
  return new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromUnitVectors(UP, direction.clone().normalize()), new THREE.Vector3(radius, direction.length(), width));
}

function treeMatrices(planting) {
  const bark = [], leaves = [], leafColors = [], barkColors = [];
  for (const p of planting.trees) {
    const seed = p.seed, height = 4.1 + hash(seed + 11) * 4.8, lean = (hash(seed + 12) - .5) * 1.5;
    const base = new THREE.Vector3(p.x, p.y - .12, p.z), mid = base.clone().add(new THREE.Vector3(lean * .4, height * .48, .15));
    const top = base.clone().add(new THREE.Vector3(lean, height * .89, -.18));
    const radius = .16 + height * .018;
    bark.push(beamMatrix(base, mid, radius), beamMatrix(mid, top, radius * .71));
    for (let j = 0; j < 5; j++) {
      const angle = j * TAU / 5 + hash(seed + 40) * TAU, spread = 1.1 + hash(seed + j * 7) * 1.6;
      const branchBase = base.clone().add(new THREE.Vector3(lean * .5, height * (.48 + j * .062), .05));
      const branchMid = branchBase.clone().add(new THREE.Vector3(Math.cos(angle) * spread * .45, .55, Math.sin(angle) * spread * .45));
      const branchEnd = branchBase.clone().add(new THREE.Vector3(Math.cos(angle) * spread, .72 + hash(seed + j) * .6, Math.sin(angle) * spread));
      bark.push(beamMatrix(branchBase, branchMid, radius * .44), beamMatrix(branchMid, branchEnd, radius * .24));
      for (let k = 0; k < 4; k++) {
        const a = angle + k * TAU / 4, size = 1.35 + hash(seed + j * 17 + k) * .7;
        const x = branchEnd.x + Math.cos(a) * .5, z = branchEnd.z + Math.sin(a) * .5;
        leaves.push(transform(x, branchEnd.y + k * .16, z, size, size, size, a, (hash(seed + j + k) - .5) * 1.2));
        leafColors.push(new THREE.Color().setHSL(.23 + hash(seed + j) * .055, .22 + hash(seed + k) * .15, .23 + hash(seed + j * 3) * .12));
      }
    }
    leaves.push(transform(top.x, top.y + .25, top.z, 1.8, 1.8, 1.8, hash(seed) * TAU, -.3));
    leafColors.push(new THREE.Color('#5c7244'));
  }
  for (const p of planting.shrubs) {
    const size = 1.05 + hash(p.seed + 61) * 1.1;
    leaves.push(transform(p.x, p.y + .08, p.z, size, size * .7, size, hash(p.seed + 7) * TAU));
    leafColors.push(new THREE.Color().setHSL(.21 + hash(p.seed + 8) * .09, .2 + hash(p.seed + 18) * .2, .27 + hash(p.seed + 28) * .08));
  }
  for (let i = 0; i < bark.length; i++) barkColors.push(new THREE.Color().setHSL(.09, .14 + hash(i + 14) * .11, .22 + hash(i + 11) * .09));
  return { bark, leaves, leafColors, barkColors };
}

function pathGeometry() {
  const positions = [], indices = [], colors = [], sand = new THREE.Color('#b3a788');
  let cursor = 0;
  for (let i = 1; i < ISLAND_TRAIL.length; i++) {
    const a = ISLAND_TRAIL[i - 1], b = ISLAND_TRAIL[i], length = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.ceil(length / .65);
    const rightX = -(b.z - a.z) / length, rightZ = (b.x - a.x) / length;
    for (let j = 0; j <= steps; j++) {
      const t = j / steps, x = THREE.MathUtils.lerp(a.x, b.x, t), z = THREE.MathUtils.lerp(a.z, b.z, t), width = .83 + .08 * Math.sin(i * 3 + t * 4);
      for (const side of [-1, 1]) {
        const px = x + rightX * width * side, pz = z + rightZ * width * side;
        positions.push(px - ISLAND.x, islandHeight(px, pz) + .045, pz - ISLAND.z);
        const light = .92 + hash(cursor + j * 3) * .14; colors.push(sand.r * light, sand.g * light, sand.b * light);
      }
      if (j < steps) indices.push(cursor, cursor + 2, cursor + 1, cursor + 1, cursor + 2, cursor + 3);
      cursor += 2;
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function boardwalkMatrices() {
  const matrices = [], colors = [], color = new THREE.Color();
  const add = (matrix, seed) => { matrices.push(matrix); color.setHSL(.09, .18, .29 + hash(seed + 21) * .11); colors.push(color.clone()); };
  // A short landing promenade follows the heightfield; there is no floating
  // collision-less platform. The mountain continues as an unpaved hiking trail.
  for (let i = 0; i < 44; i++) {
    const x = 211.8 + i * .39, z = 148.2 - i * .042;
    add(groundPlank(x, z, .35, 2.7, .107), i);
    // The planks individually sample the same surface, with 4cm shadow gaps.
    if (i % 5 === 0) for (const side of [-1, 1]) {
      const pz = z + side * 1.34, py = islandHeight(x, pz);
      add(transform(x, py + .5, pz, .1, 1.05, .1), i + side);
    }
  }
  // Low handrails, each section sloping with the sampled ground.
  for (let i = 0; i < 8; i++) for (const side of [-1, 1]) {
    const x = 211.8 + i * 1.95, z = 148.2 - i * .21 + side * 1.34;
    const a = new THREE.Vector3(x, islandHeight(x, z) + .96, z), b = new THREE.Vector3(x + 1.95, islandHeight(x + 1.95, z - .21) + .96, z - .21);
    add(beamMatrix(a, b, .055, .065), i + 50);
  }
  // A narrow open overlook, 5m from the end of the path; its boards conform to
  // the ground rather than claiming a different standable elevation.
  for (let row = 0; row < 17; row++) {
    const x = ISLAND.summit.x - 3.3 + row * .38, z = ISLAND.summit.z;
    add(groundPlank(x, z, .34, 3.2), row + 101);
  }
  return { matrices, colors };
}

function boardwalkMaterial() {
  // As with bark, an explicit timber base prevents strong shared daylight from
  // washing a white material plus instance tint into pale concrete.
  const material = new THREE.MeshStandardMaterial({ color: '#977448', roughness: .92, metalness: 0 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vIslandWoodPoint;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 islandWoodP=vec4(transformed,1.);
      #ifdef USE_INSTANCING
        islandWoodP=instanceMatrix*islandWoodP;
      #endif
      vIslandWoodPoint=islandWoodP.xyz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vIslandWoodPoint;${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float islandWoodWarp=islandNoise(vIslandWoodPoint*vec3(.8,.3,2.4));
      float islandWoodGrain=sin(vIslandWoodPoint.x*62.+sin(vIslandWoodPoint.z*2.8)*1.8+islandWoodWarp*2.4);
      float islandWoodPore=pow(abs(islandWoodGrain),12.);
      diffuseColor.rgb*=.83+islandWoodWarp*.17-islandWoodPore*.12;
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.06,1.,.88),islandNoise(vIslandWoodPoint*.37)*.25);`);
  };
  material.customProgramCacheKey = () => 'mist-headland-weathered-timber-v1';
  return material;
}

function shorelineGeometry(q) {
  const positions = [], alpha = [], indices = [];
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i <= q.shoreSegments; i++) {
    const angle = i / q.shoreSegments * TAU;
    let inner = .25, outer = 1;
    for (let j = 0; j < 16; j++) {
      const r = (inner + outer) * .5, x = ISLAND.x + Math.cos(angle) * ISLAND.width * .5 * r, z = ISLAND.z + Math.sin(angle) * ISLAND.depth * .5 * r;
      if (islandHeight(x, z) > SEA + .04) inner = r; else outer = r;
    }
    for (const side of [0, 1]) {
      const r = (inner + outer) * .5 + (.002 + layer * .008 + side * .0035), x = Math.cos(angle) * ISLAND.width * .5 * r, z = Math.sin(angle) * ISLAND.depth * .5 * r;
      positions.push(x, SEA + .045 + layer * .002, z);
      alpha.push((.25 + .25 * Math.sin(angle * 9 + Math.sin(angle * 19))) * (1 - layer * .23) * (side ? .1 : 1));
    }
    if (i < q.shoreSegments) { const k = (layer * (q.shoreSegments + 1) + i) * 2; indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('shoreAlpha', new THREE.Float32BufferAttribute(alpha, 1)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function shoreMaterial(clock) {
  const material = new THREE.MeshStandardMaterial({ color: '#bcd6cc', roughness: .9, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide });
  material.forceSinglePass = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.islandClock = clock;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float shoreAlpha;varying float vShoreAlpha;varying vec3 vShorePoint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShoreAlpha=shoreAlpha;vShorePoint=position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nuniform float islandClock;varying float vShoreAlpha;varying vec3 vShorePoint;${NOISE_GLSL}`)
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\nfloat foamNoise=islandNoise(vShorePoint*2.2+vec3(islandClock*.12,0.,islandClock*.09));diffuseColor.a*=vShoreAlpha*smoothstep(.22,.64,foamNoise);');
  };
  material.customProgramCacheKey = () => 'mist-headland-broken-foam-v1'; return material;
}

export function measureIslandVisual(group) {
  let triangles = 0, drawCalls = 0, instances = 0;
  group.traverse(node => {
    if (!node.isMesh) return;
    const count = node.isInstancedMesh ? node.count : 1;
    triangles += ((node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3) * count;
    drawCalls += Array.isArray(node.material) ? node.material.length : 1; instances += count;
  });
  return { triangles, drawCalls, instances };
}

/** All coordinates below are local once; heightfield queries are world-space. */
export function createRealisticIslandVisual({ quality = 'high' } = {}) {
  const q = ISLAND_VISUAL_QUALITY[quality] ?? ISLAND_VISUAL_QUALITY.high, planting = createIslandPlanting(quality);
  const group = new THREE.Group(); group.name = 'mist-headland-realistic-island'; group.position.set(ISLAND.x, 0, ISLAND.z);
  const geometries = new Set(), materials = new Set(), textures = new Set(), clock = { value: 0 };
  const add = mesh => { group.add(mesh); geometries.add(mesh.geometry); for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material); return mesh; };
  const ground = add(new THREE.Mesh(terrainGeometry(q), stoneMaterial(true))); ground.name = 'realistic-island-shared-heightfield'; ground.receiveShadow = true;
  const stone = stoneMaterial(false), rocks = roundedRock(2), pebble = roundedRock(0);
  const rockMatrices = [], rockColors = [];
  for (const p of planting.rocks) {
    const exposedLedge = p.y > 3.5 && islandSlope(p.x, p.z) > .48;
    const size = exposedLedge ? 1.7 + hash(p.seed + 91) * 2.2 : .55 + hash(p.seed + 91) * 1.4;
    rockMatrices.push(transform(p.x, p.y + size * (exposedLedge ? .02 : .18), p.z, size * (1.1 + hash(p.seed)), size * (exposedLedge ? .24 : .54), size * (.8 + hash(p.seed + 2) * .5), hash(p.seed + 8) * TAU, hash(p.seed + 9) * .15));
    rockColors.push(new THREE.Color().setHSL(.095, .05 + hash(p.seed + 51) * .09, .52 + hash(p.seed + 61) * .14));
  }
  add(instanceMesh(rocks, stone, rockMatrices, rockColors, 'weathered-layered-coast-boulders'));
  add(instanceMesh(pebble, stone, planting.pebbles.map(p => { const s = .1 + hash(p.seed + 14) * .4; return transform(p.x, p.y + s * .17, p.z, s, s * .5, s * .8, hash(p.seed) * TAU); }), planting.pebbles.map(p => new THREE.Color().setHSL(.09, .1, .38 + hash(p.seed + 39) * .25)), 'tideline-pebbles'));
  const tree = treeMatrices(planting), barkMaterial = new THREE.MeshStandardMaterial({ color: '#655039', roughness: 1 });
  add(instanceMesh(new THREE.CylinderGeometry(.68, 1, 1, 6, 1, true), barkMaterial, tree.bark, tree.barkColors, 'coastal-tree-trunks-and-tapered-branches'));
  const leafTexture = createIslandLeafTexture(); textures.add(leafTexture);
  add(instanceMesh(leafSprayGeometry(), foliageMaterial(leafTexture, clock), tree.leaves, tree.leafColors, 'fine-cutout-coastal-leaf-sprays'));
  add(instanceMesh(grassGeometry(), foliageMaterial(null, clock, true), planting.grass.map(p => { const s = .75 + hash(p.seed + 117) * .8; return transform(p.x, p.y + .015, p.z, s, s, s, hash(p.seed) * TAU); }), planting.grass.map(p => new THREE.Color().setHSL(.17 + hash(p.seed) * .08, .2, .38 + hash(p.seed + 71) * .13)), 'wind-shaped-dune-grass'));
  const trail = add(new THREE.Mesh(pathGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
  trail.name = 'heightfield-following-gravel-trail'; trail.raycast = NEVER_RAYCAST;
  const wood = boardwalkMatrices();
  add(instanceMesh(new THREE.BoxGeometry(1, 1, 1), boardwalkMaterial(), wood.matrices, wood.colors, 'terrain-following-wood-landing-and-overlook'));
  const surf = add(new THREE.Mesh(shorelineGeometry(q), shoreMaterial(clock))); surf.name = 'fragmented-natural-tideline-foam'; surf.raycast = NEVER_RAYCAST;
  const budget = measureIslandVisual(group);
  group.userData.visualBudget = budget; group.userData.heightSource = 'shared/realistic-island.js:islandHeight';
  let disposed = false;
  return {
    group, planting, budget,
    update(timeMs = 0, { reducedMotion = false } = {}) { if (!disposed) clock.value = reducedMotion ? 0 : (Number.isFinite(timeMs) ? timeMs / 1000 : 0); },
    dispose() {
      if (disposed) return; disposed = true;
      for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); for (const texture of textures) texture.dispose();
      group.clear();
    },
  };
}
