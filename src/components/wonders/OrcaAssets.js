import * as THREE from 'three';

// Metres, with the rostrum facing local -Z. The torso is one closed, continuous
// surface, rather than intersecting primitives. All authored assets are local.
const sections = [
  [-3.9, 0.012, 0.025, -0.12], [-3.78, 0.3, 0.29, -0.1],
  [-3.45, 0.55, 0.49, -0.02], [-2.95, 0.76, 0.7, 0.04],
  [-2.25, 0.94, 0.93, 0.06], [-1.2, 1.04, 1.06, 0.05],
  [0, 0.92, 1.04, 0], [1.1, 0.69, 0.78, -0.08],
  [2.15, 0.41, 0.47, -0.13], [3.1, 0.2, 0.24, -0.12],
  [3.75, 0.13, 0.14, -0.08], [3.98, 0.025, 0.045, -0.06],
];
const smooth = (a, b, n) => {
  const t = THREE.MathUtils.clamp((n - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = THREE.MathUtils.lerp;
export function bodySection(z) {
  let i = 0;
  while (i < sections.length - 2 && sections[i + 1][0] < z) i++;
  const a = sections[i], b = sections[i + 1];
  const f = (z - a[0]) / (b[0] - a[0]);
  // Cubic Hermite interpolation keeps the changing girth smooth at every ring.
  return [1, 2, 3].map(k => {
    const p = sections[Math.max(0, i - 1)], n = sections[Math.min(sections.length - 1, i + 2)];
    const m0 = (b[k] - p[k]) / (b[0] - p[0]) * (b[0] - a[0]);
    const m1 = (n[k] - a[k]) / (n[0] - a[0]) * (b[0] - a[0]);
    return (2*f**3 - 3*f*f + 1)*a[k] + (f**3 - 2*f*f + f)*m0 + (-2*f**3 + 3*f*f)*b[k] + (f**3 - f*f)*m1;
  });
}

export function createBodyGeometry() {
  const rings = 128, sides = 96, p = [], uv = [], index = [];
  for (let i = 0; i <= rings; i++) {
    const z = mix(-3.9, 3.98, i / rings), [rx, ry, cy] = bodySection(z);
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2;
      const belly = Math.cos(a) < 0 ? 0.86 : 1;
      p.push(rx * Math.sin(a), ry * Math.cos(a) * belly + cy, z);
      uv.push(i / rings, j / sides);
      if (i < rings && j < sides) {
        const q = i * (sides + 1) + j;
        index.push(q, q + sides + 1, q + 1, q + 1, q + sides + 1, q + sides + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index); g.computeVertexNormals();
  const normals = g.attributes.normal;
  for (let i = 0; i <= rings; i++) {
    const a = i * (sides + 1), b = a + sides;
    const n = new THREE.Vector3(normals.getX(a) + normals.getX(b), normals.getY(a) + normals.getY(b), normals.getZ(a) + normals.getZ(b)).normalize();
    normals.setXYZ(a, n.x, n.y, n.z); normals.setXYZ(b, n.x, n.y, n.z);
  }
  return g;
}

export function createSkinTexture() {
  const w = 1536, h = 768, pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const z = mix(-3.9, 3.98, x / (w - 1));
    const angle = y / (h - 1) * Math.PI * 2;
    const a = Math.min(angle, Math.PI * 2 - angle);
    const lower = Math.abs(angle - Math.PI);
    const bellyWidth = 0.68 + 0.17 * Math.exp(-(((z + 2.8) / 1.2) ** 2));
    let white = (1 - smooth(bellyWidth - 0.025, bellyWidth + 0.025, lower)) * (1 - smooth(2.3, 3.6, z));
    // The eye patch is behind, and independent from, the tiny actual eye.
    const patch = ((z + 2.05) / 0.61) ** 2 + ((a - 1.13 + (z + 2.05) * 0.12) / 0.22) ** 2;
    white = Math.max(white, 1 - smooth(0.93, 1.07, patch));
    const flank = ((z - 1.5) / 0.72) ** 2 + ((a - 2.13) / 0.53) ** 2;
    white = Math.max(white, (1 - smooth(0.88, 1.05, flank)) * 0.98);
    const saddle = (1 - smooth(0.8, 1.05, ((z - 0.95) / 0.82) ** 2 + (a / 0.86) ** 2)) * 0.3;
    const noise = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const grain = ((noise - Math.floor(noise)) - 0.5) * 3;
    const i = (y * w + x) * 4;
    const dark = [8, 16, 21], light = [227, 232, 222];
    // A few faded parallel rake marks are painted into the skin, not floating
    // decals. They stay subtle at normal viewing distances.
    const scarZone = (1 - smooth(0.4, 0.7, Math.abs(z - 0.55))) * (1 - smooth(0.1, 0.2, Math.abs(a - 1.42)));
    const scar = scarZone * Math.pow(Math.max(0, Math.cos((z + a * 0.4) * 62)), 26) * 14;
    for (let c = 0; c < 3; c++) pixels[i + c] = mix(dark[c] + saddle * 100, light[c], white) + grain + scar;
    pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, w, h, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8;
  return texture;
}

export function createSkinMicrotexture() {
  const size = 512, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    const fine = r - Math.floor(r);
    const pores = Math.sin(x * .51 + Math.sin(y * .09)) * Math.sin(y * .83);
    const wrinkle = Math.sin(y * .19 + Math.sin(x * .034) * 2.7);
    const value = Math.round(202 + fine * 17 + pores * 7 + wrinkle * 3);
    const index = (y * size + x) * 4;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = value; pixels[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

// A closed, tapered hydrofoil from a smooth Bezier silhouette. No extrusion edges.
export function createFoil(shape, thickness, plane = 'horizontal') {
  const outline = shape.getSpacedPoints(80), center = new THREE.Vector2();
  outline.pop(); outline.forEach(p => center.add(p)); center.multiplyScalar(1 / outline.length);
  const p = [], uv = [], ids = [], rings = 9, n = outline.length;
  for (let side = 0; side < 2; side++) for (let r = 0; r <= rings; r++) {
    const f = Math.max(0.0001, r / rings);
    outline.forEach(v => {
      const a = mix(center.x, v.x, f), b = mix(center.y, v.y, f);
      const t = Math.sqrt(Math.max(0, 1 - f * f)) * thickness * (side ? -1 : 1);
      if (plane === 'vertical') p.push(t, b, a); else p.push(a, t, b);
      uv.push((a + 3) / 6, (b + 4) / 8);
    });
  }
  const count = (rings + 1) * n;
  for (let side = 0; side < 2; side++) for (let r = 0; r < rings; r++) for (let j = 0; j < n; j++) {
    const a = side * count + r * n + j, b = side * count + r * n + (j + 1) % n, c = a + n, d = b + n;
    if (side) ids.push(a, c, b, b, c, d); else ids.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ids); g.computeVertexNormals();
  // Mirrored pectoral outlines have opposite winding. Keep the outward normal
  // consistent so physical highlights do not flip on one side of the animal.
  const axis = plane === 'vertical' ? 0 : 1;
  let outward = 0;
  for (let i = 0; i < count; i++) outward += g.attributes.normal.array[i * 3 + axis];
  if (outward < 0) {
    for (let i = 0; i < ids.length; i += 3) [ids[i + 1], ids[i + 2]] = [ids[i + 2], ids[i + 1]];
    g.setIndex(ids); g.computeVertexNormals();
  }
  return g;
}

export function createDorsal() {
  const s = new THREE.Shape();
  s.moveTo(-1.0, 0.84); s.bezierCurveTo(-0.53, 1.34, -0.34, 2.81, -0.1, 2.9);
  s.bezierCurveTo(0.13, 2.94, 0.07, 2.11, 0.17, 1.7);
  s.bezierCurveTo(0.23, 1.22, 0.54, 1.05, 0.8, 0.84); s.closePath();
  return createFoil(s, 0.14, 'vertical');
}
export function createPectoral(side) {
  const s = new THREE.Shape();
  s.moveTo(side * 0.76, -1.83);
  s.bezierCurveTo(side * 1.32, -1.69, side * 2.17, -0.95, side * 2.23, -0.49);
  s.bezierCurveTo(side * 2.31, -0.08, side * 1.83, 0.1, side * 1.42, -0.23);
  s.bezierCurveTo(side * 1.02, -0.55, side * 0.84, -0.88, side * 0.71, -1.14); s.closePath();
  return createFoil(s, 0.12);
}
export function createFluke() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.26); s.bezierCurveTo(-0.55, -0.44, -1.4, -0.7, -1.94, -0.48);
  s.bezierCurveTo(-1.68, -0.05, -0.78, 0.72, -0.2, 0.66);
  s.lineTo(0, 0.46); s.lineTo(0.2, 0.66);
  s.bezierCurveTo(0.78, 0.72, 1.68, -0.05, 1.94, -0.48);
  s.bezierCurveTo(1.4, -0.7, 0.55, -0.44, 0, -0.26); s.closePath();
  return createFoil(s, 0.11);
}

const clamp = THREE.MathUtils.clamp;
export function sampleCinematicOrca(time, companion = false) {
  const t = ((time % 60) + 60) % 60;
  const a = t / 60 * Math.PI * 2 + (companion ? -0.35 : 0);
  const x = 9 * Math.sin(a), z = 4 * Math.cos(a) + (companion ? -6 : 0);
  const yaw = Math.atan2(-9 * Math.cos(a), 4 * Math.sin(a));
  let lift = 0, pitch = 0, roll = 0;
  const windows = companion ? [[28.2, 35.2, 4.8]] : [[4, 12, 6.6], [27, 35, 6.1]];
  for (const [start, end, height] of windows) if (t >= start && t <= end) {
    const q = (t - start) / (end - start);
    lift = Math.sin(q * Math.PI) * height;
    pitch = Math.sin(q * Math.PI) * (1.05 - q * 2.0);
    roll = Math.sin(q * Math.PI) * (companion ? -0.1 : -0.23);
  }
  if (!companion && t > 44 && t < 51) {
    const q = clamp((t - 44) / 7, 0, 1);
    pitch = -Math.sin(q * Math.PI) * 0.78;
    lift = -Math.sin(q * Math.PI) * 0.25;
  }
  return { x, y: -0.23 + lift + 0.07 * Math.sin(t * 1.9), z, yaw, pitch, roll };
}
