import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TREE_POSITIONS, WORLD_LOCATIONS, WORLD_SIZE } from '../../../shared/world.js';
import { addExpandedGround } from './ExpandedGround.js';

// A tiny generated texture provides real soft falloff without another render pass.
// It is shared by every light pool and contact patch and needs no downloaded asset.
function radialTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const distance = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
    const alpha = Math.pow(Math.max(0, 1 - distance * distance), 3);
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(alpha * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
const SOFT_FALLOFF = radialTexture();

// Geometry and material are shared by hundreds of details. Paving, roof tiles,
// foliage, lamps and bunting remain a handful of instanced draws, not one each.
export const GEOMETRY = {
  box: new THREE.BoxGeometry(1, 1, 1),
  soft: new RoundedBoxGeometry(1, 1, 1, 2, 0.10),
  plane: new THREE.PlaneGeometry(1, 1),
  sphere: new THREE.SphereGeometry(1, 14, 10),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 16),
  plaza: new THREE.CylinderGeometry(1, 1, 1, 64),
  cone: new THREE.ConeGeometry(1, 1, 8),
  ring: new THREE.TorusGeometry(1, 0.13, 8, 36),
  inlay: new THREE.TorusGeometry(1, 0.009, 4, 64),
  arch: new THREE.TorusGeometry(1, 0.12, 8, 24, Math.PI),
};
export const MATERIAL = {
  matte: new THREE.MeshStandardMaterial({ roughness: 0.86 }),
  foliage: new THREE.MeshStandardMaterial({ roughness: 0.93 }),
  gold: new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.25 }),
  lamp: new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: '#ffd697', emissiveIntensity: 3.0 }),
  violet: new THREE.MeshStandardMaterial({ roughness: 0.65, emissive: '#9b76dd', emissiveIntensity: 0.7 }),
  contact: new THREE.MeshBasicMaterial({ map: SOFT_FALLOFF, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: true }),
  glow: new THREE.MeshBasicMaterial({ map: SOFT_FALLOFF, transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
};

function builder() {
  const batches = {};
  const add = (kind, p, s, c, r = [0, 0, 0], material = 'matte') => {
    const key = `${kind}:${material}`;
    (batches[key] ||= { kind, material, entries: [] }).entries.push({ p, s, c, r });
  };
  const box = (p, s, c, r, material) => add('soft', p, s, c, r, material);
  const sphere = (p, s, c, material) => add('sphere', p, s, c, undefined, material);
  const cylinder = (p, radius, height, c, r, material) => add('cylinder', p, [radius, height, radius], c, r, material);
  const beam = (a, b, radius, c, material) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const direction = to.clone().sub(from);
    const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
    cylinder(from.add(to).multiplyScalar(0.5).toArray(), radius, direction.length(), c, [rotation.x, rotation.y, rotation.z], material);
  };
  const patch = (p, scale, color, material = 'contact') => add('plane', p, [scale[0], scale[1], 1], color, [-Math.PI / 2, 0, 0], material);
  return { batches, add, box, sphere, cylinder, beam, patch };
}

function roof(b, x, y, z, width, depth, height, color) {
  const slope = Math.atan2(height, width / 2);
  const length = Math.hypot(width / 2, height);
  [-1, 1].forEach(side => {
    b.box([x + side * width / 4, y + height / 2, z], [length + 0.25, 0.2, depth], color, [0, 0, -side * slope]);
    // Individual overlapping shingles keep a sculpted roof silhouette.
    for (let row = 0; row < 5; row++) {
      const t = (row + 0.35) / 5;
      for (let col = 0; col < 8; col++) {
        b.box([x + side * width / 2 * (1 - t), y + height * t + 0.13, z - depth / 2 + (col + 0.5) * depth / 8],
          [length / 4.8, 0.13, depth / 7.8], ['#655775', '#6c5b7b', color][(col + row * 3) % 3], [0, 0, -side * slope]);
      }
    }
  });
  b.cylinder([x, y + height + 0.07, z], 0.13, depth + 0.2, '#a28b9e', [Math.PI / 2, 0, 0]);
  [-1, 1].forEach(side => {
    b.box([x + side * width / 2, y + 0.01, z], [0.16, 0.25, depth + 0.12], '#a5909f');
    b.beam([x + side * width / 2, y, z + depth / 2 + 0.05], [x, y + height, z + depth / 2 + 0.05], 0.08, '#ba9eae');
  });
}

function lamp(b, x, z, height = 2.4) {
  b.cylinder([x, height / 2, z], 0.055, height, '#655d5c');
  b.cylinder([x, 0.16, z], 0.2, 0.28, '#827166');
  b.box([x, height + 0.1, z], [0.38, 0.48, 0.38], '#ffe3ad', undefined, 'lamp');
  b.add('cone', [x, height + 0.47, z], [0.38, 0.27, 0.38], '#6b6265');
  b.cylinder([x, height - 0.16, z], 0.29, 0.08, '#806a58');
  [-1, 1].forEach(dx => [-1, 1].forEach(dz => b.box([x + dx * 0.16, height + 0.1, z + dz * 0.16], [0.035, 0.5, 0.035], '#7e6857')));
  b.sphere([x, height + 0.64, z], [0.065, 0.065, 0.065], '#bca06a', 'gold');
  b.patch([x, 0.149, z], [1.25, 1.25], '#1e2635');
  b.patch([x, 0.154, z + 0.12], [4.1, 4.1], '#ffb765', 'glow');
}

function windowFrame(b, x, y, z, width = 0.9, height = 1.15) {
  b.box([x, y, z], [width + 0.23, height + 0.24, 0.18], '#d0ae91');
  b.box([x, y, z + 0.13], [width, height, 0.08], '#ffd493', undefined, 'lamp');
  b.box([x, y, z + 0.2], [0.08, height, 0.07], '#775e5f');
  b.box([x, y, z + 0.21], [width, 0.08, 0.07], '#775e5f');
  b.box([x, y - height / 2 - 0.12, z + 0.2], [width + 0.4, 0.16, 0.4], '#a48b7f');
  b.box([x, y + height / 2 + 0.17, z + 0.18], [width + 0.42, 0.12, 0.28], '#dbc4aa');
  [-1, 1].forEach(side => b.box([x + side * (width / 2 + 0.23), y, z + 0.08], [0.2, height + 0.16, 0.13], '#6c6073'));
}

function shootingBooth(b, x, z) {
  const red = '#9f4d54', cream = '#ead2ad', wood = '#80563f';
  b.box([x, 0.2, z], [6, 0.4, 5.25], '#9c8170');
  b.box([x, 1.7, z - 1.7], [5.6, 3.2, 0.4], wood);
  b.box([x, 2.15, z - 1.43], [5.05, 2.1, 0.16], '#405b65');
  // Tiny joinery and recessed panels read as a made object, not intersecting cubes.
  [-1, 1].forEach(side => {
    b.box([x + side * 2.72, 1.8, z - 1.4], [0.16, 3.05, 0.17], '#c39c6b');
    b.box([x + side * 2.8, 0.89, z + 0.1], [0.15, 1.26, 4.12], '#946848');
    b.box([x + side * 2.8, 1.55, z + 0.1], [0.23, 0.12, 4.12], '#d7b78a');
  });
  [1.45, 2.28].forEach(y => b.box([x, y, z - 0.94], [4.9, 0.1, 0.34], '#b68f68'));
  b.box([x, 0.44, z + 2.5], [5.82, 0.15, 0.12], '#d5b78a');
  b.box([x, 3.59, z + 2.38], [5.9, 0.12, 0.2], '#d2ae7c');
  [-2.55, 2.55].forEach(dx => {
    b.cylinder([x + dx, 2, z + 1.95], 0.13, 3.7, cream);
    b.sphere([x + dx, 4.01, z + 1.95], [0.19, 0.19, 0.19], '#dabd75', 'gold');
  });
  for (let stripe = 0; stripe < 10; stripe++) {
    const dx = -2.88 + (stripe + 0.5) * 0.576;
    b.box([x + dx, 3.7, z + 0.1], [0.59, 0.18, 4.65], stripe % 2 ? cream : red, [0.12, 0, 0]);
    b.box([x + dx, 3.33, z + 2.37], [0.57, 0.55, 0.16], stripe % 2 ? cream : red);
    b.sphere([x + dx, 3.08, z + 2.39], [0.29, 0.16, 0.1], stripe % 2 ? cream : red);
  }
  b.box([x, 0.95, z + 2.15], [5.65, 1.2, 0.65], red);
  for (let i = 0; i < 10; i++) b.box([x - 2.55 + i * 0.57, 0.91, z + 2.5], [0.28, 1.1, 0.06], cream);
  b.box([x, 1.58, z + 2.15], [5.9, 0.18, 0.9], '#bd9867');
  const colors = ['#dc7978', '#ebbe6d', '#7da0ba', '#89b49b', '#b092c1'];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 7; col++) {
    const bx = x - 2.05 + col * 0.68, by = 2.05 + row * 0.82;
    b.sphere([bx, by, z - 1.05], [0.25, 0.33, 0.23], colors[(col + row * 2) % colors.length]);
    b.beam([bx, by - 0.3, z - 1.04], [bx + 0.04, by - 0.65, z - 1.04], 0.013, '#ead7b8');
  }
  for (let i = 0; i < 11; i++) b.sphere([x - 2.6 + i * 0.52, 3.46, z + 2.53], [0.07, 0.07, 0.07], '#ffe3ad', 'lamp');
  b.cylinder([x, 4.47, z], 0.85, 0.17, cream, [Math.PI / 2, 0, 0]);
  b.add('ring', [x, 4.47, z + 0.13], [0.56, 0.56, 0.56], red);
  b.sphere([x, 4.47, z + 0.15], [0.2, 0.2, 0.08], '#edb277', 'lamp');
  [-0.4, 0.4].forEach(dx => b.beam([x + dx, 3.85, z], [x + dx, 4.1, z], 0.045, '#c49f70', 'gold'));
  b.patch([x, 0.152, z + 2.25], [7.8, 4.7], '#ffb874', 'glow');
}

function hauntedHouse(b, x, z) {
  b.box([x, 1.65, z], [5.6, 3.3, 4.8], '#89748e');
  b.box([x, 0.35, z], [5.8, 0.65, 4.95], '#71697c');
  roof(b, x, 3.3, z, 6.1, 5.2, 1.8, '#67517c');
  // Warm masonry and thin cornices articulate the large wall volumes.
  b.box([x, 3.14, z + 2.43], [5.7, 0.19, 0.24], '#b49bac');
  b.box([x + 2.83, 3.14, z], [0.2, 0.19, 4.95], '#b49bac');
  for (let course = 0; course < 6; course++) {
    [-1, 1].forEach(side => b.box([x + side * 2.65, 0.65 + course * 0.41, z + 2.43], [course % 2 ? 0.34 : 0.51, 0.25, 0.19], course % 2 ? '#a790a4' : '#b19aaa'));
  }
  for (let panel = 0; panel < 6; panel++) b.box([x + 2.81, 1.6, z - 1.85 + panel * 0.72], [0.08, 2.2, 0.06], '#76657e');
  [-2.2, 2.2].forEach((dx, i) => {
    const towerY = i ? 4.0 : 4.4;
    b.box([x + dx, towerY, z - 0.6], [1.55, 2.8, 1.6], '#9b839e', [0, 0, i ? -0.06 : 0.07]);
    b.add('cone', [x + dx + (i ? -0.1 : 0.1), towerY + 2.14, z - 0.6], [1.25, 2, 1.25], '#655082', [0, Math.PI / 4, i ? -0.1 : 0.09]);
    b.sphere([x + dx + (i ? -0.2 : 0.2), towerY + 3.15, z - 0.6], [0.12, 0.12, 0.12], '#b999b6', 'gold');
    windowFrame(b, x + dx, towerY + 0.2, z + 0.24, 0.52, 0.8);
  });
  b.box([x, 1.12, z + 2.46], [1.75, 2.15, 0.19], '#393449');
  b.sphere([x, 2.12, z + 2.46], [0.88, 0.9, 0.11], '#393449');
  b.add('arch', [x, 1.93, z + 2.62], [0.98, 0.98, 0.98], '#b397bd');
  [-1, 1].forEach(side => b.box([x + side * 0.98, 1.0, z + 2.62], [0.22, 1.85, 0.26], '#b397bd'));
  windowFrame(b, x - 1.95, 1.8, z + 2.43, 0.67, 1.0);
  windowFrame(b, x + 1.95, 1.8, z + 2.43, 0.67, 1.0);
  b.box([x, 0.15, z + 2.6], [2.4, 0.2, 0.5], '#ae98a0');
  b.box([x, 0.33, z + 2.48], [2.05, 0.17, 0.4], '#bba4ad');
  b.box([x, 1.17, z + 2.59], [1.45, 1.72, 0.08], '#504259');
  b.box([x, 1.18, z + 2.65], [0.045, 1.73, 0.03], '#ac8d80');
  [-0.2, 0.2].forEach(dx => b.sphere([x + dx, 1.1, z + 2.69], [0.07, 0.07, 0.045], '#e3b674', 'gold'));
  b.patch([x, 0.153, z + 2.45], [6.6, 4.7], '#a99ae6', 'glow');
  // A playful sculpted ghost rather than a flat billboard or horror asset.
  b.sphere([x, 5.35, z + 0.5], [0.77, 0.9, 0.6], '#e7d5ed', 'violet');
  b.cylinder([x, 4.95, z + 0.5], 0.7, 0.62, '#e7d5ed', undefined, 'violet');
  [-0.48, 0, 0.48].forEach(dx => b.sphere([x + dx, 4.63, z + 0.55], [0.25, 0.25, 0.3], '#e7d5ed', 'violet'));
  [-0.25, 0.25].forEach(dx => b.sphere([x + dx, 5.46, z + 1.04], [0.12, 0.18, 0.06], '#453653'));
  b.sphere([x, 5.1, z + 1.1], [0.13, 0.16, 0.04], '#453653');
  [-2.85, 2.85].forEach(dx => {
    b.box([x + dx, 1.85, z + 2.4], [0.32, 0.5, 0.32], '#ffd99d', undefined, 'lamp');
    b.add('cone', [x + dx, 2.17, z + 2.4], [0.3, 0.2, 0.3], '#675a6e');
  });
}

function musicTheatre(b, x, z) {
  const red = '#934a59', gold = '#bd965e';
  b.box([x, 0.27, z], [5.9, 0.54, 5], '#9d7e72');
  b.box([x, 2.05, z - 1.9], [5.6, 3.6, 0.4], '#6b677c');
  b.box([x, 2.0, z - 1.6], [4.5, 2.9, 0.22], '#313e55');
  b.box([x, 3.88, z - 0.18], [5.8, 0.2, 3.6], '#5c626f', [-0.07, 0, 0]);
  b.box([x, 4.03, z - 1.9], [5.9, 0.18, 0.2], '#c19c6b');
  for (let plank = 0; plank < 9; plank++) b.box([x - 2.05 + plank * 0.51, 0.675, z + 0.05], [0.48, 0.04, 3.05], ['#bd976d', '#b99067', '#c2a078'][plank % 3]);
  [-1, 1].forEach(side => {
    b.beam([x + side * 2.65, 3.5, z + 1.7], [x + side * 1.96, 3.83, z + 1.7], 0.07, '#d5b078', 'gold');
    b.box([x + side * 2.65, 0.62, z + 1.7], [0.66, 0.24, 0.73], '#c6a273');
  });
  [-2.65, 2.65].forEach(dx => {
    b.box([x + dx, 2.1, z + 1.7], [0.45, 3.75, 0.55], gold);
    b.sphere([x + dx, 4.13, z + 1.7], [0.35, 0.32, 0.35], '#c8a266', 'gold');
    for (let fold = 0; fold < 3; fold++) b.sphere([x + dx * 0.82 + (fold - 1) * 0.22, 2.05, z + 1.9], [0.23, 1.5, 0.2], fold % 2 ? '#a65561' : red);
    b.box([x + dx * 0.82, 1.45, z + 2.09], [0.75, 0.16, 0.14], '#d2ab70', [0, 0, dx < 0 ? 0.12 : -0.12], 'gold');
  });
  b.box([x, 3.83, z + 1.7], [5.9, 0.65, 0.65], red);
  b.box([x, 4.17, z + 1.75], [5.8, 0.13, 0.72], gold, undefined, 'gold');
  [-1.6, 0, 1.6].forEach(dx => b.sphere([x + dx, 3.5, z + 1.9], [0.9, 0.48, 0.25], red));
  for (let i = 0; i < 12; i++) b.sphere([x - 2.64 + i * 0.48, 3.91, z + 2.08], [0.07, 0.07, 0.07], '#ffe0ab', 'lamp');
  b.box([x, 0.57, z + 0.2], [4.7, 0.16, 3.4], '#b18b64');
  for (let i = 0; i < 11; i++) b.box([x - 2.25 + i * 0.45, 0.65, z + 2], [0.41, 0.1, 0.6], i % 3 === 1 ? '#454654' : '#e3cfae');
  [-1.9, 1.9].forEach(dx => {
    b.box([x + dx, 1.2, z - 0.55], [0.67, 1.15, 0.65], '#424651');
    [0.95, 1.43].forEach(y => b.cylinder([x + dx, y, z - 0.2], 0.21, 0.05, '#777585', [Math.PI / 2, 0, 0]));
  });
  // Large readable musical silhouette at the roofline.
  b.sphere([x - 0.45, 4.73, z + 1.72], [0.36, 0.23, 0.14], '#f5ce80', 'lamp');
  b.sphere([x + 0.55, 4.88, z + 1.72], [0.36, 0.23, 0.14], '#f5ce80', 'lamp');
  b.box([x - 0.18, 5.22, z + 1.72], [0.13, 1.08, 0.15], '#edc780', undefined, 'lamp');
  b.box([x + 0.82, 5.37, z + 1.72], [0.13, 1.08, 0.15], '#edc780', undefined, 'lamp');
  b.box([x + 0.32, 5.87, z + 1.72], [1.17, 0.22, 0.18], '#edc780', [0, 0, 0.14], 'lamp');
  b.patch([x, 0.153, z + 2.05], [8, 4.8], '#ffbe78', 'glow');
}

function workshop(b, x, z) {
  b.cylinder([x, 0.2, z], 3.05, 0.4, '#a18c79');
  b.cylinder([x, 0.44, z], 2.7, 0.14, '#c2a477');
  [-2.1, 2.1].forEach(dx => [-1.75, 1.75].forEach(dz => {
    b.cylinder([x + dx, 1.95, z + dz], 0.17, 3.05, '#947251');
    b.box([x + dx, 0.63, z + dz], [0.47, 0.3, 0.47], '#c6a875');
    b.sphere([x + dx, 3.14, z + dz], [0.16, 0.23, 0.16], '#ffe0a6', 'lamp');
  }));
  b.add('cone', [x, 4.09, z], [3.55, 1.55, 3.05], '#597f78', [0, Math.PI / 8, 0]);
  b.add('cone', [x, 4.34, z], [2.9, 1.6, 2.5], '#6d9282', [0, Math.PI / 8, 0]);
  b.cylinder([x, 4.97, z], 0.16, 0.6, '#c0a062', undefined, 'gold');
  for (let rib = 0; rib < 8; rib++) {
    const angle = rib * Math.PI / 4 + Math.PI / 8;
    b.beam([x + Math.sin(angle) * 2.9, 3.55, z + Math.cos(angle) * 2.5], [x, 5.09, z], 0.035, '#c2b48b', 'gold');
  }
  [-1, 1].forEach(side => {
    b.box([x + side * 2.1, 3.27, z], [0.18, 0.2, 3.7], '#c6aa79');
    b.beam([x + side * 2.1, 2.82, z + 1.75], [x + side * 1.47, 3.35, z + 1.75], 0.075, '#c6aa79');
  });
  b.box([x, 3.33, z + 1.75], [4.4, 0.22, 0.22], '#c6aa79');
  for (let bulb = 0; bulb < 9; bulb++) b.sphere([x - 1.8 + bulb * 0.45, 3.17, z + 1.78], [0.055, 0.08, 0.055], '#ffe0a6', 'lamp');
  b.box([x, 1.09, z - 0.3], [2.3, 0.23, 1.7], '#c3a376');
  b.cylinder([x, 0.75, z - 0.3], 0.35, 0.55, '#85664e');
  [-0.65, 0, 0.65].forEach((dx, i) => {
    b.box([x + dx, 1.36, z - 0.3], [0.42, 0.32 + i % 2 * 0.18, 0.42], ['#b28597', '#6f9a9b', '#c8a359'][i]);
  });
  b.add('ring', [x, 5.64, z + 0.2], [0.63, 0.63, 0.63], '#d2ae69', undefined, 'gold');
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    b.box([x + Math.sin(a) * 0.74, 5.64 + Math.cos(a) * 0.74, z + 0.2], [0.25, 0.32, 0.22], '#e9c580', [0, 0, -a], 'lamp');
  }
  b.box([x, 1.46, z - 1.95], [3.7, 2.0, 0.3], '#546d6b');
  [-1.2, 0, 1.2].forEach(dx => windowFrame(b, x + dx, 1.7, z - 1.73, 0.65, 1.1));
  b.patch([x, 0.152, z + 1.8], [7.2, 5.6], '#e8c281', 'glow');
}

function tree(b, x, z, scale, index) {
  const landmark = index === 2;
  const height = landmark ? 6.3 : 2.8 * scale;
  const radius = Math.min(0.43 * scale, landmark ? 0.48 : 0.3);
  b.cylinder([x, height / 2, z], radius, height, '#775c4c', [0, 0, 0.05]);
  b.patch([x, 0.148, z], [3.9 * scale, 3.5 * scale], '#1d2830');
  // Root flares and a moss cushion make each tree sit on the diorama.
  for (let root = 0; root < 3; root++) {
    const a = root * Math.PI * 2 / 3 + index;
    b.beam([x, 0.6, z], [x + Math.sin(a) * radius * 1.8, 0.12, z + Math.cos(a) * radius * 1.8], radius * 0.42, '#80644f');
    b.sphere([x + Math.sin(a) * 0.48, 0.1, z + Math.cos(a) * 0.48], [0.42, 0.13, 0.38], ['#697557', '#72805f', '#66795e'][root], 'foliage');
  }
  const crown = landmark ? 2.15 : 1.2 * scale;
  for (let i = 0; i < 7; i++) {
    const a = i * Math.PI * 2 / 7;
    const dx = Math.cos(a) * crown * 0.7, dz = Math.sin(a) * crown * 0.65;
    if (i % 2 === 0) b.beam([x, height * 0.5, z], [x + dx * 0.8, height + 0.1, z + dz * 0.8], radius * 0.46, '#80634d');
    b.sphere([x + dx, height + Math.sin(i * 1.9) * 0.25, z + dz], [crown * 0.85, crown * 0.69, crown * 0.81], ['#627b66', '#7f8b63', '#57776b'][(i + index) % 3], 'foliage');
  }
  b.sphere([x, height + crown * 0.48, z], [crown * 0.85, crown * 0.7, crown * 0.85], '#8c956b', 'foliage');
  if (landmark) [-1, 1].forEach(side => {
    b.beam([x + side * 1.5, height - 0.1, z + 0.8], [x + side * 1.5, height - 1.3, z + 0.8], 0.025, '#b39b75');
    b.sphere([x + side * 1.5, height - 1.4, z + 0.8], [0.24, 0.32, 0.24], '#ffdaa0', 'lamp');
  });
}


export function castsSceneryShadow(kind, material) {
  return !['box', 'plaza', 'plane', 'inlay'].includes(kind) && !['lamp', 'glow', 'contact'].includes(material);
}

export function isVenueLabelVisible({ x, y, width, height, labelWidth = 168, labelHeight = 48, clipZ = 0 }) {
  if (![x, y, width, height, labelWidth, labelHeight, clipZ].every(Number.isFinite)
    || width <= 760 || height <= 0 || labelWidth <= 0 || labelHeight <= 0 || clipZ < -1 || clipZ > 1) return false;
  const left = x - labelWidth / 2, right = x + labelWidth / 2;
  const top = y - labelHeight / 2, bottom = y + labelHeight / 2;
  if (left < 8 || right > width - 8 || top < 8 || bottom > height - 8) return false;
  const hud = [
    [0, 0, 320, 300],
      [width - 420, 0, width, 210],
      [0, height - 120, 500, height],
    [width - 380, height - 120, width, height],
  ];
  return !hud.some(([x0, y0, x1, y1]) => left < x1 && right > x0 && top < y1 && bottom > y0);
}

export function configureSceneryBatch(mesh, entries) {
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  entries.forEach((entry, i) => {
    transform.position.set(...entry.p);
    transform.scale.set(...entry.s);
    transform.rotation.set(...entry.r);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    mesh.setColorAt(i, color.set(entry.c));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    // dispose={null} keeps the shared geometry/material alive, but this mesh
    // still owns its instanceMatrix/instanceColor GPU buffers. Three recreates
    // those on the next draw after a StrictMode setup -> cleanup -> setup.
    mesh.dispose();
  };
}

export function createSceneryBatches() {
  const b = builder();
  const { lamps } = addExpandedGround(b);
  WORLD_LOCATIONS.forEach(place => b.patch([place.x + 0.12, 0.148, place.z + 0.18], [9.2, 7.9], '#1b2433'));
  TREE_POSITIONS.forEach(([x, z, scale], index) => tree(b, x, z, scale, index));
  lamps.forEach(({ x, z, height }) => lamp(b, x, z, height));
  const models = { balloons: shootingBooth, haunted: hauntedHouse, rhythm: musicTheatre, puzzle: workshop };
  WORLD_LOCATIONS.forEach(place => models[place.id]?.(b, place.x, place.z));
  return Object.values(b.batches);
}

export function createBalloonBatches() {
  const b = builder();
  [
    [-WORLD_SIZE.width * 0.32, 12.4, WORLD_SIZE.centerZ - WORLD_SIZE.depth * 0.47, 1.3],
    [WORLD_SIZE.width * 0.29, 11.3, WORLD_SIZE.centerZ - WORLD_SIZE.depth * 0.48, 1.05],
  ].forEach(([x, y, z, size]) => {
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      b.sphere([x + Math.cos(a) * 0.46 * size, y, z + Math.sin(a) * 0.46 * size], [0.6 * size, 1.2 * size, 0.6 * size], i % 2 ? '#bc986e' : '#956174');
    }
    b.box([x, y - 1.7 * size, z], [0.7 * size, 0.45 * size, 0.65 * size], '#887059');
    [-1, 1].forEach(side => b.beam([x + side * 0.27 * size, y - 1.1 * size, z], [x + side * 0.27 * size, y - 1.5 * size, z], 0.018, '#bda383'));
  });
  return Object.values(b.batches);
}

export function getSceneryStats(batches = createSceneryBatches()) {
  return {
    batches: batches.length,
    instances: batches.reduce((sum, batch) => sum + batch.entries.length, 0),
    triangles: batches.reduce((sum, batch) => sum + (GEOMETRY[batch.kind].index?.count ?? GEOMETRY[batch.kind].attributes.position.count) / 3 * batch.entries.length, 0),
    byBatch: Object.fromEntries(batches.map(batch => [`${batch.kind}:${batch.material}`, batch.entries.length])),
  };
}

// Shared resource ownership survives React Strict Mode mount/unmount pairs.
// R3F receives dispose={null}; Vite owns disposal only when replacing this module.
if (import.meta.hot) import.meta.hot.dispose(() => {
  Object.values(GEOMETRY).forEach(geometry => geometry.dispose());
  Object.values(MATERIAL).forEach(material => material.dispose());
  SOFT_FALLOFF.dispose();
});
