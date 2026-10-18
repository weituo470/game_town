import * as THREE from 'three';
import { CharacterBuilder, clothMaterial, basicMaterial } from './CharacterKit.js';

// A sculpted, entirely procedural toy. The forward axis is +Z and the soles sit
// on Y=0, so the same object works in the town and in the character portrait.
const TAU = Math.PI * 2;

function sweptLock(points, radii, flatten = 1, segments = 24, sides = 12) {
  const path = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  const frames = path.computeFrenetFrames(segments, false);
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const center = path.getPointAt(t);
    const f = t * (radii.length - 1);
    const k = Math.min(Math.floor(f), radii.length - 2);
    const radius = THREE.MathUtils.lerp(radii[k], radii[k + 1], f - k);
    for (let j = 0; j <= sides; j += 1) {
      const a = (j / sides) * TAU;
      const v = center.clone()
        .addScaledVector(frames.normals[i], Math.cos(a) * radius)
        .addScaledVector(frames.binormals[i], Math.sin(a) * radius * flatten);
      positions.push(v.x, v.y, v.z);
      uvs.push(j / sides, t);
      if (i < segments && j < sides) {
        const p = i * (sides + 1) + j;
        // With +cos(normal) + sin(binormal), the outward winding is the
        // opposite of THREE.TubeGeometry's -cos(normal) convention.
        indices.push(p, p + 1, p + sides + 1, p + 1, p + sides + 2, p + sides + 1);
      }
    }
  }
  for (const end of [0, segments]) {
    const center = path.getPointAt(end / segments);
    const c = positions.length / 3;
    positions.push(center.x, center.y, center.z);
    uvs.push(0.5, end / segments);
    for (let j = 0; j < sides; j += 1) {
      const p = end * (sides + 1) + j;
      if (end === 0) indices.push(c, p + 1, p);
      else indices.push(c, p, p + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function blushDisk(side) {
  // Conform the paint to the rounded-box cheek instead of floating a flat decal
  // in front of the face, which would become obvious from a three-quarter view.
  const surface = (x, y) => {
    const dx = Math.max(Math.abs(x) - 0.3975, 0);
    const dy = Math.max(Math.abs(y - 2.945) - 0.2225, 0);
    return 0.342 + Math.sqrt(Math.max(0, 0.38 ** 2 - dx ** 2 - dy ** 2));
  };
  const cx = side * 0.485;
  const cy = 2.755;
  const positions = [cx, cy, surface(cx, cy)];
  const colors = [1, 0.44, 0.34, 0.33];
  const uvs = [0.5, 0.5];
  const indices = [];
  for (let ring = 0; ring < 2; ring += 1) {
    const radius = ring === 0 ? 0.55 : 1;
    for (let i = 0; i <= 32; i += 1) {
      const a = (i / 32) * TAU;
      const x = cx + Math.cos(a) * 0.145 * radius;
      const y = cy + Math.sin(a) * 0.105 * radius;
      positions.push(x, y, surface(x, y));
      colors.push(1, 0.49, 0.39, ring === 0 ? 0.16 : 0);
      uvs.push(0.5 + Math.cos(a) * radius * 0.5, 0.5 + Math.sin(a) * radius * 0.5);
      if (i < 32) {
        if (ring === 0) indices.push(0, i + 1, i + 2);
        else indices.push(i + 1, i + 34, i + 2, i + 2, i + 34, i + 35);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ellipseTorus(builder, y, radius, thickness, depthScale, material, x = 0, z = 0) {
  const geometry = new THREE.TorusGeometry(radius, thickness, 12, 64);
  geometry.rotateX(Math.PI / 2);
  geometry.scale(1, 1, depthScale);
  builder.add(geometry, material, [x, y, z]);
}

function yarn(builder, points, radius, material, sides = 6) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  // Tiny fabric ribs need a smooth silhouette, not the much denser tessellation
  // of a principal sculpted part. All ribs still merge into their fabric batch.
  builder.add(new THREE.TubeGeometry(curve, Math.max(8, points.length * 3), radius, sides, false), material);
}

export function createWinterGirl() {
  const builder = new CharacterBuilder();
  const skin = basicMaterial('#f2c29a', { roughness: 0.79 });
  const hair = basicMaterial('#61351f', { roughness: 0.88 });
  const hairRidge = basicMaterial('#74442b', { roughness: 0.91 });
  const wool = clothMaterial('#e5a635', { knit: true, scale: 1.3 });
  const cream = clothMaterial('#f5e6c9', { knit: true, scale: 1.1 });
  const trousers = clothMaterial('#765039', { scale: 1.4 });
  const boot = clothMaterial('#97704b', { scale: 1.6 });
  const sole = basicMaterial('#705037', { roughness: 0.92 });
  const eyes = basicMaterial('#4b2821', { roughness: 0.57 });
  const smile = basicMaterial('#b57b57', { roughness: 0.91 });
  const blush = basicMaterial('#ffffff', {
    roughness: 1,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  // Soft suede boots, rounded soles, and a fine welt around each toe.
  for (const side of [-1, 1]) {
    const x = side * 0.3;
    builder.roundBox([x, 0.055, 0.115], [0.56, 0.11, 0.76], 0.052, sole);
    builder.ellipsoid([x, 0.225, 0.11], [0.2675, 0.185, 0.36], boot);
    builder.ellipsoid([x, 0.34, -0.015], [0.225, 0.21, 0.245], boot);
    yarn(builder, [
      [x - 0.235, 0.125, 0.12], [x - 0.21, 0.125, 0.34],
      [x, 0.125, 0.445], [x + 0.21, 0.125, 0.34], [x + 0.235, 0.125, 0.12],
    ], 0.011, sole, 6);
    const leg = new THREE.LatheGeometry([
      [0, 0.31], [0.22, 0.31], [0.275, 0.36], [0.31, 0.52],
      [0.325, 0.8], [0.29, 1.08], [0.245, 1.16], [0, 1.16],
    ].map(([r, y]) => new THREE.Vector2(r, y)), 32);
    leg.scale(1, 1, 1.04);
    builder.add(leg, trousers, [x, 0, -0.025]);
  }

  // The sweater is a continuous bell-shaped silhouette rather than stacked
  // spheres. Its weighted hem and ribbed cuffs make the knitted fabric legible.
  const body = new THREE.LatheGeometry([
    [0, 1.05], [0.49, 1.05], [0.605, 1.105], [0.655, 1.24],
    [0.65, 1.47], [0.6, 1.75], [0.49, 2.02], [0.32, 2.13], [0, 2.13],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 48);
  body.scale(1, 1, 0.7);
  builder.add(body, wool);
  ellipseTorus(builder, 1.135, 0.566, 0.071, 0.71, wool);
  for (let i = 0; i < 52; i += 1) {
    const a = (i / 52) * TAU;
    yarn(builder, [
      [Math.cos(a) * 0.583, 1.075, Math.sin(a) * 0.426],
      [Math.cos(a) * 0.63, 1.145, Math.sin(a) * 0.45],
      [Math.cos(a) * 0.643, 1.235, Math.sin(a) * 0.455],
    ], 0.012, wool, 6);
  }
  for (const side of [-1, 1]) {
    builder.add(sweptLock([
      [side * 0.43, 1.98, -0.01], [side * 0.63, 1.81, 0],
      [side * 0.77, 1.56, 0.025], [side * 0.835, 1.37, 0.055],
    ], [0.245, 0.275, 0.26, 0.195], 1, 32, 18), wool);
    builder.ellipsoid([side * 0.885, 1.19, 0.075], [0.175, 0.215, 0.17], skin);
    builder.ellipsoid([side * 0.765, 1.19, 0.185], [0.075, 0.1, 0.075], skin);
    const cuff = new THREE.CylinderGeometry(0.195, 0.19, 0.16, 32);
    const cuffAxis = new THREE.Vector3(side * 0.23, -0.95, 0.08).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), cuffAxis);
    cuff.applyQuaternion(q);
    const center = new THREE.Vector3(side * 0.848, 1.335, 0.064);
    builder.add(cuff, wool, center.toArray());
    for (let i = 0; i < 20; i += 1) {
      const a = (i / 20) * TAU;
      const points = [-0.072, 0, 0.072].map((y) => new THREE.Vector3(
        Math.cos(a) * 0.195, y, Math.sin(a) * 0.195,
      ).applyQuaternion(q).add(center).toArray());
      yarn(builder, points, 0.012, wool, 6);
    }
  }

  // A deep, smooth back of hair supports the dimensional cap and temple locks.
  builder.roundBox([0, 2.98, -0.205], [1.75, 1.38, 1.21], 0.44, hair);
  for (const side of [-1, 1]) {
    builder.add(sweptLock([
      [side * 0.65, 3.03, -0.32], [side * 0.77, 2.65, -0.38],
      [side * 0.91, 2.33, -0.28], [side * 0.87, 2.14, -0.13],
    ], [0.21, 0.255, 0.225, 0.08], 0.8, 28), hair);
    yarn(builder, [
      [side * 0.82, 2.68, -0.18], [side * 0.955, 2.4, -0.12],
      [side * 0.927, 2.21, -0.01],
    ], 0.012, hairRidge, 6);
  }

  // A softened-square face is the defining reference proportion.
  builder.roundBox([0, 2.945, 0.08], [1.555, 1.205, 1.28], 0.38, skin);
  for (const side of [-1, 1]) {
    builder.ellipsoid([side * 0.784, 2.965, 0.065], [0.155, 0.21, 0.17], skin);
    builder.ellipsoid([side * 0.315, 2.965, 0.727], [0.073, 0.155, 0.026], eyes);
    builder.add(blushDisk(side), blush);
  }
  yarn(builder, [
    [-0.047, 2.76, 0.726], [-0.037, 2.726, 0.73], [0, 2.713, 0.732],
    [0.034, 2.727, 0.73], [0.047, 2.758, 0.726],
  ], 0.009, smile, 8);

  // Broad tapered locks read like sculpted bangs, not a cluster of hair balls.
  builder.add(sweptLock([
    [-0.14, 3.57, 0.46], [-0.3, 3.45, 0.62], [-0.51, 3.3, 0.65], [-0.67, 3.24, 0.58],
  ], [0.19, 0.23, 0.19, 0.018], 0.7, 32), hair);
  builder.add(sweptLock([
    [0.02, 3.58, 0.5], [0.02, 3.42, 0.67], [-0.03, 3.27, 0.73], [-0.16, 3.22, 0.73],
  ], [0.16, 0.18, 0.14, 0.018], 0.72, 28), hair);
  builder.add(sweptLock([
    [0.14, 3.58, 0.46], [0.32, 3.47, 0.64], [0.49, 3.32, 0.67], [0.62, 3.25, 0.59],
  ], [0.18, 0.23, 0.17, 0.02], 0.7, 32), hair);
  for (const side of [-1, 1]) {
    builder.add(sweptLock([
      [side * 0.65, 3.43, 0.37], [side * 0.755, 3.14, 0.4],
      [side * 0.74, 2.76, 0.43], [side * 0.635, 2.55, 0.39],
    ], [0.14, 0.175, 0.15, 0.035], 0.78, 32), hair);
    yarn(builder, [
      [side * 0.705, 3.2, 0.532], [side * 0.737, 2.93, 0.563], [side * 0.685, 2.68, 0.53],
    ], 0.01, hairRidge, 6);
  }

  // Three softly overlapping wool folds, then one hanging rib-knit scarf end.
  ellipseTorus(builder, 2.17, 0.575, 0.125, 0.78, cream, 0, 0.035);
  ellipseTorus(builder, 2.285, 0.645, 0.13, 0.77, cream, 0, 0.025);
  ellipseTorus(builder, 2.405, 0.594, 0.112, 0.79, cream, 0, 0.015);
  builder.roundBox([-0.17, 1.785, 0.505], [0.365, 0.83, 0.145], 0.066, cream, [0.035, 0, -0.035]);
  for (let i = 0; i < 8; i += 1) {
    const x = -0.318 + i * 0.042;
    yarn(builder, [
      [x - 0.011, 2.14, 0.58], [x, 1.91, 0.589],
      [x + 0.008, 1.64, 0.593], [x + 0.012, 1.4, 0.574],
    ], 0.011, cream, 6);
    yarn(builder, [
      [x + 0.012, 1.42, 0.544], [x + 0.017, 1.365, 0.545],
      [x + 0.012, 1.345, 0.548],
    ], 0.012, cream, 6);
  }

  // The hat has a full knitted crown and a genuinely three-dimensional rolled
  // brim. Closely spaced raised ribs catch the existing town's grazing light.
  const crownProfile = [
    [0, 3.34], [0.825, 3.34], [0.875, 3.53], [0.872, 3.76],
    [0.807, 3.98], [0.66, 4.17], [0.41, 4.3], [0.17, 4.35], [0, 4.36],
  ];
  const hatY = (y) => y + 0.1 * (4.1 - y) / 0.8;
  const crown = new THREE.LatheGeometry(crownProfile.map(([r, y]) => new THREE.Vector2(r, hatY(y))), 64);
  crown.scale(1, 1, 0.83);
  builder.add(crown, cream, [-0.025, 0, -0.045]);
  const brim = new THREE.LatheGeometry([
    [0.78, 3.29], [0.865, 3.285], [0.938, 3.335], [0.956, 3.425],
    [0.936, 3.52], [0.878, 3.565], [0.805, 3.55], [0.78, 3.29],
  ].map(([r, y]) => new THREE.Vector2(r, hatY(y))), 64);
  brim.scale(1, 1, 0.82);
  builder.add(brim, cream, [-0.025, 0, -0.035]);
  for (let i = 0; i < 64; i += 1) {
    const a = (i / 64) * TAU;
    yarn(builder, [
      [Math.cos(a) * 0.874 - 0.025, 3.291, Math.sin(a) * 0.716 - 0.035],
      [Math.cos(a) * 0.945 - 0.025, 3.345, Math.sin(a) * 0.775 - 0.035],
      [Math.cos(a) * 0.963 - 0.025, 3.433, Math.sin(a) * 0.79 - 0.035],
      [Math.cos(a) * 0.936 - 0.025, 3.522, Math.sin(a) * 0.767 - 0.035],
      [Math.cos(a) * 0.878 - 0.025, 3.563, Math.sin(a) * 0.721 - 0.035],
    ].map(([x, y, z]) => [x, hatY(y), z]), 0.0125, cream, 6);
  }
  for (let i = 0; i < 46; i += 1) {
    const a = (i / 46) * TAU;
    const meridian = [
      [0.887, 3.53], [0.884, 3.76], [0.819, 3.98],
      [0.672, 4.17], [0.422, 4.3], [0.14, 4.355],
    ];
    yarn(builder, meridian.map(([r, y]) => [
      Math.cos(a) * r - 0.025, hatY(y), Math.sin(a) * r * 0.83 - 0.045,
    ]), 0.012, cream, 6);
  }

  // Yarn tufts use a deterministic Fibonacci distribution: rounded wisps rather
  // than random spikes, and identical geometry in every client/session.
  const pomCenter = new THREE.Vector3(-0.12, 4.425, -0.065);
  builder.ellipsoid(pomCenter.toArray(), [0.255, 0.245, 0.255], cream);
  for (let i = 0; i < 64; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / 64;
    const radius = Math.sqrt(1 - y * y);
    const a = i * 2.399963229728653;
    const direction = new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
    const center = pomCenter.clone().addScaledVector(direction, 0.225);
    const tuft = new THREE.SphereGeometry(1, 8, 6);
    tuft.scale(0.059, 0.105, 0.059);
    tuft.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction));
    builder.add(tuft, cream, center.toArray());
  }

  const model = builder.build('Winter Girl — knitwear edition');
  // A tall, rounded beanie is intrinsic to the reference silhouette. Bake a
  // uniform reduction into the static batches to retain a town-friendly 4.5u
  // maximum height without flattening the hat or changing the ground contact.
  for (const mesh of model.children) {
    mesh.geometry.scale(0.94, 0.94, 0.94);
    mesh.geometry.computeBoundingSphere();
  }
  model.userData.character = 'winter-girl';
  model.userData.displayName = '暖暖';
  return model;
}
