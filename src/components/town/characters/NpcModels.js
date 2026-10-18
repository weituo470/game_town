import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// These are lightweight, articulated interpretations of the supplied JPGs, not
// imported/rigged assets. The two detailed gallery sculptors remain untouched.
// Each factory call owns its buffers/material. No global GPU cache can be
// invalidated by another resident unmounting or by a second Canvas.
const C = {
  cream: '#f3e5c9', skin: '#f3c6a1', hair: '#70452f', dark: '#472d29',
  brown: '#896047', orange: '#e99746', yellow: '#efbe55', blue: '#5685a0',
  green: '#7f9c77', pink: '#eaa09a', white: '#fff4df', leaf: '#83b24f',
};

const HUMANS = {
  'npc-ali': { name: '阿栗', hat: 'cap', hatColor: C.brown, top: C.cream, trim: C.brown, pants: C.brown, shoes: C.cream, hood: true, prop: 'parcel' },
  'npc-huaya': { name: '花芽', hair: 'buns', top: C.cream, trim: C.brown, pants: C.brown, shoes: C.brown, hood: true, prop: 'flower' },
  'npc-nuannuan': { name: '暖暖', hat: 'beanie', hatColor: C.cream, hair: 'bob', top: C.yellow, trim: C.yellow, pants: C.brown, shoes: C.brown, scarf: C.cream, prop: 'yarn' },
  'npc-beidong': { name: '北冬', hat: 'trapper', hatColor: C.brown, top: '#caa17b', trim: C.cream, pants: C.brown, shoes: C.brown, fur: true, prop: 'tool' },
  'npc-lanyue': { name: '蓝跃', hat: 'cap', hatColor: C.blue, top: C.blue, trim: C.blue, pants: C.blue, shoes: C.blue, hood: true, stripes: true },
  'npc-lanjian': { name: '蓝笺', hair: 'ponytail', top: C.cream, trim: C.cream, pants: C.brown, shoes: C.brown, scarf: C.blue, prop: 'letter' },
  'npc-chengsu': { name: '橙酥', hat: 'beanie', hatColor: C.orange, hair: 'bob', top: C.cream, trim: C.cream, pants: C.skin, shoes: C.brown, dress: '#bd8952', plaid: true, prop: 'bread' },
  'npc-yubai': { name: '予白', hat: 'beret', hatColor: C.blue, hair: 'bob', top: C.yellow, trim: C.yellow, pants: C.skin, shoes: C.blue, dress: C.blue, prop: 'brush' },
  'npc-miaomu': { name: '苗木', hat: 'bucket', hatColor: C.orange, top: C.cream, trim: C.cream, pants: C.green, shoes: C.cream, overall: C.green, prop: 'watering' },
  'npc-dengcheng': { name: '灯橙', hat: 'beanie', hatColor: C.orange, top: C.cream, trim: C.orange, pants: C.brown, shoes: C.cream, prop: 'lantern' },
  'npc-xiaotai': { name: '小苔', hat: 'beanie', hatColor: C.cream, hair: 'bob', top: '#97a58a', trim: '#83967a', pants: C.cream, shoes: C.cream, hood: true, prop: 'book' },
  'npc-alan': { name: '阿蓝', hat: 'cap', hatColor: C.blue, capPanel: C.cream, top: C.cream, trim: C.blue, pants: C.brown, shoes: C.brown, prop: 'tool' },
};

const ANIMALS = {
  'npc-juya': { name: '橘芽', species: 'cat', color: '#f0b262' },
  'npc-lituan': { name: '栗团', species: 'red-panda', color: '#bf855f' },
  'npc-maipao': { name: '麦跑', species: 'corgi', color: '#eeb16a' },
  'npc-rongrong': { name: '绒绒', species: 'rabbit', color: '#f7eddb' },
};

export const NPC_MODEL_IDS = Object.freeze([...Object.keys(HUMANS), ...Object.keys(ANIMALS)]);

// Bake shape transforms and vertex colors into one draw per articulated part.
// A whole resident costs 6-8 draws rather than one draw per button or whisker.
function batch(parent, name, pivot, material) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...pivot);
  parent.add(group);
  const pieces = [];
  const add = (geometry, color, position, scale = [1, 1, 1], rotation = [0, 0, 0]) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    const transform = new THREE.Object3D();
    transform.position.set(...position);
    transform.scale.set(...scale);
    transform.rotation.set(...rotation);
    transform.updateMatrix();
    source.applyMatrix4(transform.matrix);
    const tint = new THREE.Color(color);
    const colors = new Float32Array(source.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = tint.r; colors[i + 1] = tint.g; colors[i + 2] = tint.b; }
    source.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pieces.push(source);
  };
  return {
    group,
    ball(color, position, scale, rotation) { add(new THREE.SphereGeometry(1, 12, 8), color, position, scale, rotation); },
    box(color, position, size, radius = 0.04, rotation) {
      add(new RoundedBoxGeometry(...size, 2, Math.min(radius, Math.min(...size) * 0.4)), color, position, [1, 1, 1], rotation);
    },
    cylinder(color, position, top, bottom, height, rotation = [0, 0, 0], scale = [1, 1, 1]) {
      add(new THREE.CylinderGeometry(top, bottom, height, 12), color, position, scale, rotation);
    },
    line(color, points, radius = 0.012) {
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), Math.max(4, points.length * 2), radius, 5, false), color, [0, 0, 0]);
    },
    finish() {
      if (!pieces.length) return;
      const geometry = mergeGeometries(pieces, false);
      pieces.forEach(piece => piece.dispose());
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${name}-batch`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    },
  };
}

function smile(b, y, z, width = 0.055) {
  b.line(C.brown, [[-width, y + 0.02, z], [0, y, z + 0.005], [width, y + 0.02, z]], 0.008);
}

function humanHat(head, spec) {
  const color = spec.hatColor;
  if (spec.hat === 'cap') {
    head.ball(color, [0, 0.35, -0.025], [0.575, 0.34, 0.48]);
    head.ball(color, [0, 0.29, 0.41], [0.56, 0.055, 0.33]);
    head.ball(color, [0, 0.69, -0.025], [0.055, 0.035, 0.055]);
    if (spec.capPanel) head.ball(spec.capPanel, [0, 0.42, 0.36], [0.29, 0.22, 0.12]);
  } else if (spec.hat === 'beanie') {
    head.ball(color, [0, 0.43, -0.02], [0.56, 0.38, 0.47]);
    head.cylinder(color, [0, 0.33, -0.02], 0.56, 0.57, 0.16, [0, 0, 0], [1, 1, 0.84]);
    head.ball(color, [-0.06, 0.8, -0.02], [0.13, 0.13, 0.13]);
    // Few broad ribs catch grazing light; microscopic yarn stays in the gallery.
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI * 2 / 12;
      head.line(color, [[Math.sin(a) * 0.565, 0.26, Math.cos(a) * 0.477 - 0.02], [Math.sin(a) * 0.565, 0.39, Math.cos(a) * 0.477 - 0.02]], 0.009);
    }
  } else if (spec.hat === 'trapper') {
    head.ball(color, [0, 0.38, -0.03], [0.58, 0.35, 0.49]);
    head.box(C.cream, [0, 0.3, 0.415], [1.04, 0.23, 0.16], 0.08);
    for (const side of [-1, 1]) {
      head.ball(C.cream, [side * 0.54, -0.015, -0.01], [0.15, 0.33, 0.35]);
      head.ball(color, [side * 0.56, 0.02, -0.04], [0.145, 0.28, 0.3]);
    }
  } else if (spec.hat === 'beret') {
    head.ball(color, [-0.06, 0.42, -0.03], [0.62, 0.25, 0.51], [0, 0, -0.1]);
    head.ball(color, [-0.13, 0.675, -0.02], [0.05, 0.045, 0.05]);
  } else if (spec.hat === 'bucket') {
    head.cylinder(color, [0, 0.43, -0.03], 0.45, 0.53, 0.35, [0, 0, 0], [1, 1, 0.9]);
    head.cylinder(color, [0, 0.25, -0.03], 0.52, 0.67, 0.12, [0, 0, 0], [1, 1, 0.9]);
  }
}

function jobProp(arm, kind) {
  // Props are intentional game-design additions; they are not attributed to
  // details absent from the supplied portrait.
  if (kind === 'flower') {
    arm.line(C.leaf, [[0, -0.65, 0.13], [0.01, -0.1, 0.25]], 0.014);
    arm.ball(C.leaf, [-0.06, -0.39, 0.21], [0.09, 0.035, 0.035], [0, 0, -0.5]);
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; arm.ball(C.yellow, [Math.sin(a) * 0.11, -0.12 + Math.cos(a) * 0.11, 0.25], [0.075, 0.075, 0.035]); }
    arm.ball(C.orange, [0, -0.12, 0.28], [0.055, 0.055, 0.035]);
  } else if (kind === 'lantern') {
    arm.line(C.brown, [[0, -0.58, 0.12], [0.12, -0.5, 0.12], [0.24, -0.58, 0.12]], 0.016);
    arm.box(C.yellow, [0.12, -0.75, 0.12], [0.2, 0.25, 0.2]);
    for (const y of [-0.6, -0.9]) arm.box(C.brown, [0.12, y, 0.12], [0.27, 0.05, 0.27]);
  } else if (kind === 'brush' || kind === 'tool') {
    arm.cylinder(C.brown, [0.01, -0.48, 0.16], 0.022, 0.022, 0.44, [0.18, 0, -0.15]);
    arm.box(kind === 'brush' ? C.blue : '#a3afb3', [0.04, -0.25, 0.19], [kind === 'brush' ? 0.09 : 0.19, 0.11, 0.07]);
  } else if (kind === 'book' || kind === 'letter') {
    arm.box(kind === 'book' ? C.green : C.cream, [0, -0.58, 0.18], [0.25, 0.3, 0.055]);
    arm.box(C.cream, [0.012, -0.58, 0.214], [0.19, 0.23, 0.012], 0.003);
    if (kind === 'letter') arm.ball(C.orange, [0, -0.58, 0.23], [0.035, 0.035, 0.012]);
  } else if (kind === 'watering') {
    arm.cylinder(C.blue, [0.09, -0.67, 0.17], 0.12, 0.14, 0.22);
    arm.line(C.blue, [[0.16, -0.63, 0.17], [0.3, -0.5, 0.17]], 0.035);
    arm.line(C.blue, [[0.01, -0.62, 0.17], [-0.09, -0.48, 0.17], [0.1, -0.49, 0.17]], 0.02);
  } else if (kind === 'bread') {
    arm.box(C.brown, [0, -0.61, 0.18], [0.34, 0.07, 0.3]);
    arm.ball(C.yellow, [0, -0.53, 0.18], [0.14, 0.09, 0.11]);
  } else if (kind === 'yarn') {
    arm.ball(C.cream, [0, -0.58, 0.19], [0.11, 0.11, 0.11]);
    arm.cylinder(C.brown, [0, -0.48, 0.19], 0.009, 0.009, 0.33, [0, 0, 0.25]);
  } else if (kind === 'parcel') {
    arm.box('#b99566', [0.03, -0.63, 0.13], [0.28, 0.25, 0.23]);
    arm.box(C.cream, [0.03, -0.63, 0.253], [0.1, 0.14, 0.01], 0.002);
  }
}

function createHuman(root, spec, material) {
  const torso = batch(root, 'npc-body', [0, 0, 0], material);
  torso.ball(spec.top, [0, 1.13, 0], [0.42, 0.48, 0.3]);
  torso.cylinder(spec.trim, [0, 0.77, 0], 0.395, 0.39, 0.1, [0, 0, 0], [1, 1, 0.75]);
  torso.ball(C.skin, [0, 1.56, 0], [0.17, 0.16, 0.16]);
  if (spec.hood || spec.fur || spec.scarf) {
    const color = spec.scarf || (spec.fur ? C.cream : spec.trim);
    torso.ball(color, [0, 1.53, -0.07], [0.38, 0.13, 0.31]);
    if (spec.scarf) torso.box(color, [-0.09, 1.18, 0.305], [0.21, 0.57, 0.09]);
    if (spec.hood) {
      for (const side of [-1, 1]) torso.line(C.cream, [[side * 0.12, 1.43, 0.26], [side * 0.14, 1.17, 0.32]], 0.012);
      torso.box(spec.top, [0, 0.98, 0.286], [0.4, 0.21, 0.07]);
    }
  } else torso.cylinder(spec.trim, [0, 1.54, 0], 0.21, 0.24, 0.07, [0, 0, 0], [1, 1, 0.85]);
  if (spec.overall || spec.dress) {
    const color = spec.overall || spec.dress;
    if (spec.dress) torso.cylinder(color, [0, 0.83, 0], 0.34, 0.45, 0.49, [0, 0, 0], [1, 1, 0.76]);
    torso.box(color, [0, 1.05, 0.27], [0.52, 0.53, 0.1]);
    for (const side of [-1, 1]) {
      torso.box(color, [side * 0.21, 1.35, 0.23], [0.08, 0.32, 0.07], 0.02, [0, 0, -side * 0.15]);
      torso.ball(C.yellow, [side * 0.21, 1.24, 0.33], [0.035, 0.035, 0.018]);
    }
    torso.box(color, [0, 1.05, 0.335], [0.2, 0.17, 0.02], 0.005);
    if (spec.plaid) {
      for (const x of [-0.23, 0, 0.23]) torso.box('#97663f', [x, 0.91, 0.345], [0.035, 0.47, 0.01], 0.002);
      for (const y of [0.73, 0.91, 1.09]) torso.box('#97663f', [0, y, 0.348], [0.52, 0.035, 0.01], 0.002);
    }
  }
  if (spec.fur) for (const y of [1.25, 0.95]) torso.ball(C.brown, [0, y, 0.3], [0.045, 0.045, 0.025]);
  if (spec.stripes) torso.box(C.cream, [0, 1.1, 0.303], [0.025, 0.6, 0.015], 0.004);
  torso.finish();

  const head = batch(root, 'npc-head', [0, 1.86, 0], material);
  head.ball(C.hair, [0, 0.07, -0.07], [0.56, 0.48, 0.43]);
  head.box(C.skin, [0, -0.015, 0.09], [0.99, 0.77, 0.77], 0.25);
  for (const side of [-1, 1]) {
    head.ball(C.skin, [side * 0.52, -0.03, 0], [0.12, 0.15, 0.12]);
    head.ball(C.dark, [side * 0.205, 0.015, 0.482], [0.041, 0.084, 0.018]);
    head.ball(C.pink, [side * 0.32, -0.12, 0.456], [0.072, 0.042, 0.015]);
    head.ball(C.hair, [side * 0.24, 0.3, 0.35], [0.28, 0.15, 0.14], [0, 0, side * 0.35]);
    if (spec.hair === 'bob') head.ball(C.hair, [side * 0.45, -0.11, -0.13], [0.16, 0.37, 0.3], [0, 0, side * 0.12]);
    if (spec.hair === 'buns') {
      head.ball(C.orange, [side * 0.48, 0.36, -0.07], [0.15, 0.16, 0.16]);
      head.ball(C.hair, [side * 0.61, 0.47, -0.07], [0.22, 0.22, 0.22]);
    }
  }
  head.ball(C.hair, [0, 0.28, 0.37], [0.12, 0.16, 0.11]);
  if (spec.hair === 'ponytail') head.ball(C.hair, [-0.43, -0.15, -0.41], [0.22, 0.34, 0.24], [0.2, 0, -0.35]);
  smile(head, -0.17, 0.482);
  humanHat(head, spec);
  head.finish();

  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'left' : 'right';
    const arm = batch(root, `npc-arm-${suffix}`, [side * 0.43, 1.47, 0], material);
    arm.ball(spec.top, [side * 0.05, -0.24, 0], [0.15, 0.3, 0.16], [0, 0, side * 0.17]);
    arm.ball(spec.trim, [side * 0.1, -0.47, 0], [0.135, 0.06, 0.145]);
    arm.ball(spec.fur ? C.brown : C.skin, [side * 0.11, -0.58, 0.02], [0.115, 0.14, 0.12]);
    if (spec.stripes) arm.line(C.cream, [[side * 0.18, -0.05, 0.02], [side * 0.21, -0.4, 0.02]], 0.018);
    if (side > 0) jobProp(arm, spec.prop);
    arm.finish();
    const leg = batch(root, `npc-leg-${suffix}`, [side * 0.205, 0.72, 0], material);
    leg.ball(spec.pants, [0, -0.21, 0], [0.185, 0.29, 0.19]);
    if (spec.stripes) leg.line(C.cream, [[side * 0.18, -0.04, 0], [side * 0.18, -0.4, 0]], 0.018);
    leg.ball(spec.shoes, [0, -0.61, 0.08], [0.195, 0.11, 0.26]);
    leg.box(spec.shoes, [0, -0.68, 0.08], [0.38, 0.08, 0.48], 0.025);
    if (spec.fur || spec.dress) leg.cylinder(C.cream, [0, -0.45, 0], 0.17, 0.17, 0.08);
    leg.finish();
  }
}

function createAnimal(root, spec, material) {
  const dog = spec.species === 'corgi', rabbit = spec.species === 'rabbit', panda = spec.species === 'red-panda';
  const body = batch(root, 'npc-body', [0, 0, 0], material);
  body.ball(spec.color, [0, dog ? 0.43 : 0.5, dog ? -0.18 : 0], dog ? [0.39, 0.3, 0.57] : [0.39, 0.4, 0.3]);
  body.ball(C.cream, [0, dog ? 0.43 : 0.46, dog ? 0.28 : 0.25], [0.27, 0.29, 0.07]);
  if (rabbit) {
    body.ball(C.cream, [0, 0.75, 0], [0.43, 0.1, 0.33]);
    body.box(C.cream, [-0.07, 0.45, 0.31], [0.16, 0.43, 0.065], 0.025);
  }
  if (dog) {
    body.box(C.brown, [0.3, 0.58, -0.25], [0.15, 0.21, 0.3]);
    body.box(C.cream, [0.38, 0.6, -0.25], [0.012, 0.1, 0.12], 0.002);
  }
  body.finish();

  const head = batch(root, 'npc-head', [0, dog ? 0.93 : 1.03, dog ? 0.31 : 0], material);
  head.box(spec.color, [0, 0, 0], [1, 0.7, 0.75], 0.25);
  head.ball(C.cream, [0, -0.14, 0.345], panda ? [0.23, 0.19, 0.09] : [0.37, 0.2, 0.085]);
  for (const side of [-1, 1]) {
    if (rabbit) {
      head.ball(spec.color, [side * 0.25, 0.54, 0], [0.13, 0.43, 0.12], [0, 0, -side * 0.14]);
      head.ball(C.pink, [side * 0.26, 0.56, 0.1], [0.073, 0.32, 0.035], [0, 0, -side * 0.14]);
    } else if (panda) {
      head.ball(C.cream, [side * 0.39, 0.32, -0.04], [0.17, 0.19, 0.12]);
      head.ball(C.brown, [side * 0.39, 0.32, 0.065], [0.1, 0.12, 0.025]);
      head.ball(C.cream, [side * 0.3, -0.08, 0.345], [0.17, 0.19, 0.055], [0, 0, -side * 0.3]);
      head.ball('#955a3e', [side * 0.29, -0.1, 0.39], [0.12, 0.145, 0.025]);
      head.ball(C.cream, [side * 0.13, 0.19, 0.365], [0.037, 0.037, 0.022]);
    } else {
      head.ball(spec.color, [side * 0.35, 0.34, -0.015], [0.16, dog ? 0.3 : 0.22, 0.11], [0, 0, -side * 0.25]);
      head.ball(dog ? C.cream : C.green, [side * 0.36, 0.36, 0.075], [0.092, dog ? 0.21 : 0.14, 0.025], [0, 0, -side * 0.25]);
    }
    head.ball(spec.species === 'cat' ? '#436b43' : C.dark, [side * 0.205, 0.02, 0.385], [0.047, 0.064, 0.027]);
    head.ball(C.white, [side * 0.205 - 0.012, 0.044, 0.41], [0.012, 0.012, 0.006]);
    if (!panda) head.ball(C.pink, [side * 0.32, -0.1, 0.37], [0.065, 0.054, 0.02]);
    if (spec.species === 'cat') for (const y of [-0.06, -0.14]) head.line(C.cream, [[side * 0.37, y, 0.34], [side * 0.61, y + 0.03, 0.3]], 0.008);
  }
  head.ball(panda || dog ? C.dark : C.pink, [0, -0.08, 0.44], [0.043, 0.03, 0.026]);
  smile(head, -0.2, 0.433, 0.07);
  if (dog) head.ball(C.cream, [0, 0.13, 0.376], [0.065, 0.2, 0.025]);
  if (spec.species === 'cat') {
    head.line(C.leaf, [[0, 0.34, 0], [0, 0.6, 0]], 0.022);
    for (const side of [-1, 1]) head.ball(C.leaf, [side * 0.09, 0.62, 0], [0.14, 0.055, 0.06], [0, 0, side * 0.5]);
  }
  head.finish();

  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'left' : 'right';
    const leg = batch(root, `npc-leg-${suffix}`, [side * 0.24, 0.29, dog ? 0.21 : 0.015], material);
    leg.ball(spec.color, [0, -0.08, 0], [0.15, 0.2, 0.16]);
    leg.ball(panda ? spec.color : C.cream, [0, -0.21, 0.055], [0.15, 0.08, 0.18]);
    leg.finish();
    const arm = batch(root, `npc-arm-${suffix}`, [side * (dog ? 0.25 : 0.36), dog ? 0.29 : 0.68, dog ? -0.5 : 0], material);
    if (dog) {
      arm.ball(spec.color, [0, -0.08, 0], [0.15, 0.2, 0.16]);
      arm.ball(C.cream, [0, -0.21, 0.035], [0.15, 0.08, 0.16]);
    } else arm.ball(spec.color, [side * 0.035, -0.15, 0], [0.13, 0.22, 0.14], [0, 0, side * 0.17]);
    arm.finish();
  }
  const tail = batch(root, 'npc-tail', [0, dog ? 0.53 : 0.38, dog ? -0.65 : -0.26], material);
  if (rabbit) tail.ball(spec.color, [0, 0, -0.09], [0.15, 0.15, 0.15]);
  else {
    tail.line(spec.color, [[0, 0, 0], [0.12, 0.12, -0.15], [0.16, 0.39, -0.18]], panda ? 0.13 : 0.09);
    if (panda || dog) tail.ball(C.cream, [0.16, 0.39, -0.18], [panda ? 0.13 : 0.09, 0.13, panda ? 0.13 : 0.09]);
  }
  tail.finish();
  // Keep a long-eared rabbit a companion, not a human-sized tower.
  if (rabbit) root.scale.setScalar(0.75);
  else root.scale.setScalar(0.85);
}

export function createNpcModel(id) {
  const spec = HUMANS[id] || ANIMALS[id];
  if (!spec) throw new RangeError(`Unknown NPC model: ${id}`);
  const model = new THREE.Group();
  model.name = `resident-${id}`;
  const rig = new THREE.Group();
  rig.name = 'npc-rig';
  model.add(rig);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  if (HUMANS[id]) createHuman(rig, spec, material);
  else createAnimal(rig, spec, material);
  const meshes = [];
  model.traverse(object => { if (object.isMesh) meshes.push(object); });
  // Normalize tiny floating-point/rounded-box differences so every sole really
  // starts at ground zero, without distorting body proportions.
  const bounds = new THREE.Box3().setFromObject(model);
  rig.position.y = -bounds.min.y;
  rig.userData.groundY = rig.position.y;
  model.userData.npcId = id;
  model.userData.displayName = spec.name;
  model.userData.species = spec.species || 'human';
  model.userData.drawCalls = meshes.length;
  model.userData.triangles = meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count / 3, 0);
  model.userData.visualSource = 'procedural-reference-approximation';
  return model;
}

const rigCache = new WeakMap();

/** Poses only the local articulated rig; never changes the navigation root.
 * `time` is seconds. `activity` accepts semantic states such as work/rest/talk
 * or Chinese action labels. Reduced motion keeps a steady grounded pose.
 */
export function animateNpcModel(model, { moving = false, activity = 'idle', time = 0, reducedMotion = false } = {}) {
  if (!model) return;
  let parts = rigCache.get(model);
  if (!parts) {
    parts = Object.fromEntries(['rig', 'head', 'arm-left', 'arm-right', 'leg-left', 'leg-right', 'tail'].map(name => [name, model.getObjectByName(`npc-${name}`)]));
    rigCache.set(model, parts);
  }
  if (!parts.rig) return;
  const seconds = Number.isFinite(time) ? time : 0;
  const t = reducedMotion ? 0 : seconds;
  const walking = moving && !reducedMotion;
  const rest = /rest|sleep|休息|歇|睡/.test(String(activity));
  const action = String(activity);
  const talk = /talk|greet|welcome|交谈|聊天|招呼/.test(action);
  const warmingUp = !moving && /warmup|热身/.test(action);
  const handwork = !moving && /knit|read|archive|编织|阅读|归档/.test(action);
  const working = !moving && /work|stock|garden|knit|inspect|guide|sort|deliveryWait|archive|bake|read|paint|water|observe|repair|巡|浇|绘|整理|修|看书|阅读|观察|记录|编织|烘/.test(action);
  const swing = walking ? Math.sin(t * 7) * 0.38 : 0;
  const groundY = parts.rig.userData.groundY || 0;
  // Give forward-projecting shoes clearance during their swing. A tiny toy
  // bounce is preferable to toes clipping through the path every other step.
  parts.rig.position.y = groundY + (walking ? Math.abs(Math.sin(t * 7)) * 0.105 : 0);
  parts.rig.rotation.z = walking ? Math.sin(t * 7) * 0.022 : 0;
  if (parts.head) {
    parts.head.rotation.x = rest ? 0.12 : handwork ? 0.15 : working ? 0.07 : 0;
    parts.head.rotation.y = !reducedMotion && !moving ? Math.sin(t * 0.7) * (talk ? 0.1 : 0.04) : 0;
  }
  if (parts['leg-left']) parts['leg-left'].rotation.x = swing;
  if (parts['leg-right']) parts['leg-right'].rotation.x = -swing;
  if (parts['arm-left']) {
    parts['arm-left'].rotation.x = handwork ? -0.35 : -swing * 0.7;
    parts['arm-left'].rotation.z = warmingUp ? 0.55 + (reducedMotion ? 0 : Math.sin(t * 1.6) * 0.15) : 0;
  }
  if (parts['arm-right']) {
    parts['arm-right'].rotation.x = swing * 0.7 - (working ? 0.22 + (reducedMotion ? 0 : Math.sin(t * 2.1) * 0.1) : 0);
    parts['arm-right'].rotation.z = talk ? -0.65 + (reducedMotion ? 0 : Math.sin(t * 4) * 0.1) : warmingUp ? -0.55 - (reducedMotion ? 0 : Math.sin(t * 1.6) * 0.15) : 0;
  }
  if (parts.tail) parts.tail.rotation.y = reducedMotion || rest ? 0 : Math.sin(t * (walking ? 7 : 2)) * 0.24;
}
