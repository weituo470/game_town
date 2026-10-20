import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DEFAULT = { wall: '#e9e0c7', roof: '#356965', trim: '#b57b3f', glass: '#a8d5d8' };
function builder(name, colors) {
  const group = new THREE.Group(); group.name = name;
  const materials = Object.entries(colors).map(([key, color]) => new THREE.MeshStandardMaterial({ name: key, color, roughness: key === 'glass' ? .3 : .78, metalness: key === 'glass' ? .25 : .05 }));
  const keys = Object.keys(colors), buckets = materials.map(() => []);
  function put(shape, key, position, scale = [1, 1, 1], rotation = [0, 0, 0]) {
    let geometry = shape;
    if (geometry.index) { geometry = geometry.toNonIndexed(); shape.dispose(); }
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale)));
    buckets[keys.indexOf(key)].push(geometry);
  }
  const box = (key, p, s, r) => put(new THREE.BoxGeometry(1, 1, 1), key, p, s, r);
  const cylinder = (key, p, top, bottom, height, segments = 12, r) => put(new THREE.CylinderGeometry(top, bottom, height, segments), key, p, [1, 1, 1], r);
  const sphere = (key, p, s, half = false) => put(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, half ? Math.PI / 2 : Math.PI), key, p, s);
  const finish = () => {
    buckets.forEach((parts, index) => {
      if (!parts.length) { materials[index].dispose(); return; }
      const geometry = mergeGeometries(parts, false); parts.forEach(p => p.dispose());
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, materials[index]); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    });
    let disposed = false;
    return { group, stats: { drawCalls: group.children.length, triangles: group.children.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count / 3, 0) },
      dispose() { if (disposed) return; disposed = true; group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); group.clear(); } };
  };
  return { box, cylinder, sphere, finish };
}

export function createArchitectBuilding(plan, palette = DEFAULT) {
  const c = { ...DEFAULT, ...palette, base: '#d8d1bd', leaf: '#638d62' };
  const b = builder(`architect-${plan.kind}`, c);
  b.box('base', [0, .12, 0], [3.8, .24, 3.8]);
  b.box('trim', [0, .28, 1.6], [1.7, .13, .5]);
  const windows = (height = 1.5) => {
    for (const x of [-.88, .88]) b.box('glass', [x, height, 1.26], [.58, .85, .06]);
    b.box('trim', [0, 1.03, 1.27], [.5, 1.5, .09]);
    for (const x of [-1.27, 1.27]) for (const z of [-.65, .65]) b.box('glass', [x, height, z], [.05, .75, .58]);
  };
  if (plan.kind === 'pavilion') {
    for (const x of [-1.25, 1.25]) for (const z of [-1.25, 1.25]) {
      b.cylinder('trim', [x, 1.55, z], .1, .14, 2.6, 8);
      b.box('wall', [x, 2.78, z], [.34, .18, .34]);
    }
    b.cylinder('roof', [0, 3.05, 0], .02, 1.85, .85, 4, [0, Math.PI / 4, 0]);
    b.box('trim', [0, 2.68, 0], [2.9, .18, 2.9]);
    for (const x of [-1.25, 1.25]) { b.box('wall', [x, .65, 0], [.35, .15, 2.3]); for (const z of [-.8, .8]) b.box('trim', [x, .46, z], [.18, .3, .18]); }
  } else if (plan.kind === 'greenhouse') {
    b.box('wall', [0, .54, 0], [2.9, .52, 2.6]);
    b.box('glass', [0, 1.7, 0], [2.74, 1.8, 2.44]);
    for (const x of [-1.44, 0, 1.44]) for (const z of [-1.3, 1.3]) b.box('trim', [x, 1.7, z], [.08, 2.5, .08]);
    for (const z of [-1.3, 1.3]) b.box('trim', [0, 2.6, z], [3, .09, .1]);
    for (const x of [-.72, .72]) b.box('roof', [x, 2.96, 0], [1.7, .11, 2.8], [0, 0, x > 0 ? -.4 : .4]);
    for (const x of [-1.4, 1.4]) for (const z of [-1.48, 1.48]) { b.cylinder('trim', [x, .45, z], .21, .16, .32, 8); b.sphere('leaf', [x, .8, z], [.27, .5, .27]); }
  } else if (plan.kind === 'observatory') {
    b.cylinder('wall', [0, 1.45, 0], 1.3, 1.4, 2.4, 16);
    b.cylinder('trim', [0, 2.72, 0], 1.48, 1.48, .18, 16);
    b.sphere('roof', [0, 2.8, 0], [1.45, 1.45, 1.45], true);
    b.box('glass', [0, 3.46, 1.03], [.36, 1.16, .19], [.4, 0, 0]);
    b.cylinder('trim', [.15, 3.3, 1.28], .14, .2, 1, 12, [.85, 0, 0]);
    b.box('trim', [0, 1.05, 1.4], [.7, 1.55, .08]);
    for (const x of [-1.12, 1.12]) b.box('glass', [x, 1.65, .72], [.32, .6, .1]);
  } else if (plan.kind === 'clocktower') {
    b.box('wall', [0, 2.6, 0], [1.55, 4.7, 1.55]);
    for (const y of [1.2, 2.6, 4.1]) b.box('trim', [0, y, 0], [1.73, .16, 1.73]);
    for (const z of [-.79, .79]) {
      b.cylinder('trim', [0, 4.15, z], .67, .67, .08, 20, [Math.PI / 2, 0, 0]);
      b.cylinder('wall', [0, 4.15, z * 1.07], .56, .56, .03, 20, [Math.PI / 2, 0, 0]);
      b.box('roof', [.11, 4.22, z * 1.11], [.3, .06, .035], [0, 0, .55]);
      b.box('roof', [0, 4.34, z * 1.11], [.05, .38, .035]);
    }
    b.cylinder('roof', [0, 5.32, 0], .02, 1.3, 1.2, 4, [0, Math.PI / 4, 0]);
    b.sphere('trim', [0, 5.99, 0], [.12, .16, .12]);
    b.box('trim', [0, .96, .79], [.55, 1.35, .08]);
  } else if (plan.kind === 'art_gallery') {
    b.box('wall', [-.42, 1.6, -.2], [2, 2.65, 2.5]);
    b.box('roof', [-.42, 3.02, -.2], [2.2, .2, 2.7]);
    b.box('glass', [-.42, 1.65, 1.08], [1.65, 2.1, .08]);
    b.box('trim', [-.42, 1.65, 1.14], [.09, 2.1, .09]);
    for (const y of [.57, 2.7]) b.box('trim', [-.42, y, 1.14], [1.8, .09, .09]);
    b.box('base', [1.15, .63, .4], [.8, .65, .8]);
    b.cylinder('roof', [1.15, 1.5, .4], .22, .42, 1.25, 5, [.2, 0, .25]);
    b.sphere('trim', [1.2, 2.2, .4], [.32, .32, .32]);
  } else {
    b.box('wall', [0, 1.45, 0], [2.5, 2.4, 2.5]); windows();
    for (const x of [-.72, .72]) b.box('roof', [x, 2.94, 0], [1.7, .16, 2.9], [0, 0, x > 0 ? -.4 : .4]);
    b.box('trim', [-1.45, 1.05, 0], [.22, 1.5, 2.2]);
    for (const y of [.5, 1, 1.5]) b.box('wall', [-1.57, y, 0], [.16, .08, 2]);
    for (let i = 0; i < 7; i++) b.box(i % 2 ? 'roof' : 'glass', [-1.64, .7 + (i % 3) * .5, -.78 + i * .24], [.1, .28, .13]);
  }
  // A warm marker and planted approach give every building a finished edge.
  for (const x of [-1.7, 1.7]) { b.cylinder('trim', [x, .68, 1.65], .035, .045, .85, 6); b.sphere('wall', [x, 1.16, 1.65], [.12, .16, .12]); }
  return b.finish();
}

export function createArchitectResident() {
  const b = builder('zhu-yi-original-architect', { wall: '#f0c7a3', roof: '#295c65', trim: '#edb945', glass: '#5b9fae', base: '#383d3f', leaf: '#ece8dc' });
  b.box('base', [-.17, .12, 0], [.23, .22, .44]); b.box('base', [.17, .12, 0], [.23, .22, .44]);
  for (const x of [-.17, .17]) b.box('roof', [x, .49, 0], [.22, .61, .23]);
  b.box('roof', [0, 1.01, 0], [.64, .66, .32]); b.box('trim', [0, 1.02, .18], [.62, .37, .035]);
  b.sphere('wall', [0, 1.62, 0], [.28, .3, .26]);
  b.sphere('trim', [0, 1.83, 0], [.33, .25, .31], true); b.cylinder('trim', [0, 1.82, 0], .37, .37, .07, 16);
  for (const x of [-.1, .1]) b.sphere('base', [x, 1.68, .24], [.035, .035, .025]);
  for (const x of [-.4, .4]) b.box('roof', [x, 1.04, .04], [.18, .55, .2], [0, 0, x > 0 ? .15 : -.15]);
  b.box('glass', [0, .94, .42], [.54, .48, .07], [-.4, 0, 0]);
  for (const y of [.83, .95, 1.07]) b.box('leaf', [0, y, .47], [.35, .018, .018]);
  b.sphere('wall', [-.29, .85, .34], [.1, .12, .1]); b.sphere('wall', [.29, .85, .34], [.1, .12, .1]);
  return b.finish();
}
