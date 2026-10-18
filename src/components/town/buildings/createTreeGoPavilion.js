import * as THREE from 'three';
import { createPavilionKit } from './TreeGoPavilionKit.js';
import { addGoPavilionArchitecture } from './GoPavilionArchitecture.js';

export const PAVILION_SPEC = Object.freeze({
  name: '古树棋亭', width: 10.5, depth: 8.8, height: 9.2,
  drawCallBudget: 35, triangleBudget: 180000,
  groundY: 0, terraceY: 0.8,
  reference: '古树围棋亭_场景参考.jpg',
});
const TAU = Math.PI * 2;
const seed = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

// A tapered, fluted tube follows a curved branch rather than hiding a straight
// cylinder inside foliage. Normals and UVs remain compatible with PBR batches.
function bough(kit, points, radii, material = 'bark', segments = 26) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const radial = 16;
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = [], uv = [], indices = [];
  const vector = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, centre = curve.getPointAt(t);
    const f = t * (radii.length - 1), a = Math.min(radii.length - 2, Math.floor(f));
    const radius = THREE.MathUtils.lerp(radii[a], radii[a + 1], f - a);
    for (let j = 0; j <= radial; j++) {
      const theta = j / radial * TAU;
      const flute = 1 + 0.075 * Math.sin(theta * 5 + t * 3) + 0.028 * Math.cos(theta * 9 - t * 4);
      vector.copy(frames.normals[i]).multiplyScalar(Math.cos(theta))
        .addScaledVector(frames.binormals[i], Math.sin(theta)).multiplyScalar(radius * flute).add(centre);
      positions.push(vector.x, vector.y, vector.z);
      uv.push(j / radial, t * 3);
      if (i < segments && j < radial) {
        const k = i * (radial + 1) + j;
        // Our radial basis uses +cos, the opposite winding of TubeGeometry's
        // -cos basis. Keep exterior normals facing out, never hide the shell.
        indices.push(k, k + 1, k + radial + 1, k + 1, k + radial + 2, k + radial + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  kit.add(kit.custom(geometry), material);
  return { curve, frames, radii };
}

function addAncientTree(kit) {
  const trunk = [[-1.10, 0.87, -0.65], [-1.26, 1.85, -0.73], [-1.02, 3.15, -0.62], [-0.93, 4.43, -0.67], [-0.39, 5.73, -0.81], [-0.04, 6.63, -0.84]];
  const trunkSurface = bough(kit, trunk, [0.88, 0.76, 0.67, 0.53, 0.33, 0.09], 'bark', 38);
  // Broad buttress roots anchor the tree in the paved terrace.
  const roots = [
    [[-1.10,1.43,-0.65],[-1.70,1.00,-0.16],[-2.63,0.85,0.61],[-3.25,0.83,1.17]],
    [[-1.10,1.30,-0.72],[-2.04,0.92,-1.04],[-3.05,0.84,-1.85],[-3.57,0.84,-2.25]],
    [[-0.86,1.28,-0.55],[-0.05,0.92,-0.18],[0.57,0.84,0.35],[0.98,0.83,0.78]],
    [[-0.90,1.21,-0.98],[-0.40,0.91,-1.91],[0.43,0.84,-2.42],[1.07,0.83,-2.49]],
    [[-1.25,1.35,-0.85],[-1.53,0.99,-1.75],[-1.94,0.86,-2.54],[-2.36,0.83,-2.85]],
    [[-1.40,1.28,-0.48],[-1.49,0.97,0.59],[-1.82,0.85,1.34],[-2.21,0.83,1.74]],
  ];
  roots.forEach((points, i) => bough(kit, points, [0.35, 0.27, 0.13, 0.018], i % 3 ? 'bark' : 'barkLight', 22));
  const limbs = [
    [[-1.03,3.35,-0.57],[-2.00,3.99,-0.43],[-3.03,4.68,-0.20],[-3.63,5.55,-0.46],[-3.75,6.03,-0.61]],
    [[-1.04,3.85,-0.77],[-1.99,4.70,-1.19],[-2.59,5.46,-1.83],[-2.62,6.48,-2.01]],
    [[-0.88,4.35,-0.64],[-0.08,4.97,-0.50],[1.08,5.31,-0.46],[1.79,6.13,-0.65],[1.94,6.68,-0.99]],
    [[-0.49,4.98,-0.80],[0.33,5.48,-1.34],[1.88,5.59,-1.67],[2.87,6.15,-1.40],[3.31,6.35,-1.27]],
    [[-0.89,4.41,-0.81],[-1.33,5.09,-1.62],[-1.05,6.19,-2.26],[-0.71,6.89,-2.14]],
    [[-0.98,4.12,-0.43],[-1.47,4.98,0.06],[-2.06,5.58,0.49],[-2.28,6.25,0.47]],
  ];
  limbs.forEach((points, i) => bough(kit, points, [0.43 - i * 0.022,0.30,0.19,0.085,0.025].slice(0,points.length), 'bark', 28));
  // Twig for the reference's single low-hanging left lantern.
  bough(kit, [[-2.31,4.24,-0.29],[-2.82,4.45,-0.12],[-3.28,4.575,0.10],[-3.58,4.74,0.22]], [0.13,0.09,0.055,0.015], 'bark', 18);
  // Sculpted grain follows the winding trunk and roots, not a flat bark image.
  for (let stripe = 0; stripe < 16; stripe++) {
    const angle = stripe / 16 * TAU;
    const points = [];
    for (let j = 1; j <= 33; j++) {
      const t = j / 38, centre = trunkSurface.curve.getPointAt(t);
      const f = t * (trunkSurface.radii.length - 1), a = Math.floor(f);
      const radius = THREE.MathUtils.lerp(trunkSurface.radii[a], trunkSurface.radii[a + 1], f - a);
      const theta = angle + 0.045 * Math.sin(t * 7 + stripe * 0.37);
      const flute = 1 + 0.075 * Math.sin(theta * 5 + t * 3) + 0.028 * Math.cos(theta * 9 - t * 4);
      const point = trunkSurface.frames.normals[j].clone().multiplyScalar(Math.cos(theta))
        .addScaledVector(trunkSurface.frames.binormals[j], Math.sin(theta))
        .multiplyScalar(radius * flute * 1.002).add(centre);
      points.push(point.toArray());
    }
    kit.tube(stripe % 4 === 0 ? 'barkLight' : 'barkDark', points, stripe % 4 === 0 ? 0.022 : 0.014, 28);
  }
  // Knots and raised lip enrich the front face at human viewing height.
  const knot = kit.custom(new THREE.TorusGeometry(0.18, 0.045, 6, 16));
  kit.add(knot,'barkLight',[-0.91,2.64,0.018],[1,1.4,0.7],[0,0,0.2]);
  kit.sphere('barkDark',[-0.91,2.64,0.025],[0.145,0.20,0.032]);
  for (let i = 0; i < 26; i++) {
    const a = seed(i + 20) * TAU, r = 1.05 + seed(i + 50) * 1.18;
    const x = -1.08 + Math.cos(a) * r, z = -0.65 + Math.sin(a) * r;
    kit.sphere(i % 3 ? 'moss' : 'grass',[x,0.88,z],[0.12 + seed(i + 80) * 0.24,0.06,0.13 + seed(i + 90) * 0.25]);
  }
}

function addCanopy(kit) {
  const canopy = kit.scope('PavilionCanopy',[-1,4.7,-0.65]);
  const mound = kit.custom(new THREE.SphereGeometry(1,18,12));
  const leaf = kit.custom(new THREE.SphereGeometry(1,10,6));
  const clusters = [
    [-3.9,5.8,-0.65,1.02,0.61,0.90],[-3.05,6.35,-1.05,1.19,0.75,1.10],
    [-3.65,6.5,-1.75,0.80,0.64,0.85],[-2.15,6.85,-0.60,1.23,0.80,1.05],
    [-2.40,6.3,0.45,1.10,0.71,0.89],[-0.85,7.05,-1.0,1.28,0.85,1.24],
    [-1.0,7.75,-0.65,1.09,0.72,0.98],[0.35,7.75,-1.0,1.10,0.79,1.04],
    [0.55,7.0,-2.0,1.15,0.78,1.06],[1.55,6.95,-1.0,1.19,0.75,1.02],
    [2.75,6.45,-0.8,1.09,0.70,0.95],[3.1,6.2,-1.8,0.86,0.61,0.85],
    [3.65,5.85,-1.0,0.70,0.54,0.80],[0.65,6.55,0.3,1.06,0.69,0.85],
    [-0.55,6.6,0.55,1.02,0.72,0.82],[-2.1,7.45,-2.0,0.96,0.65,0.91],
    [1.1,7.45,-2.4,0.88,0.64,0.86],[-3.4,5.7,0.4,0.70,0.59,0.80],
  ];
  const greens = ['foliage','foliageMid','foliageLight','foliageDark'];
  clusters.forEach(([x,y,z,sx,sy,sz], cluster) => {
    kit.add(mound,greens[cluster % 2],[x,y,z],[sx,sy,sz]);
    // Broad overlapping leaf cushions follow the volume's surface. Their
    // varied tilt reads as hand-sculpted foliage, not rows of identical balls.
    for (let i = 0; i < 23; i++) {
      const angle = i * 2.39996 + cluster * 0.49;
      const vertical = -0.48 + i / 22 * 1.40;
      const horizontal = Math.sqrt(1 - vertical * vertical);
      const nx = Math.cos(angle) * horizontal, nz = Math.sin(angle) * horizontal;
      const p = [x + nx * sx * 0.91, y + vertical * sy * 0.94, z + nz * sz * 0.91];
      const size = 0.24 + seed(cluster * 100 + i) * 0.14;
      const material = greens[(i + cluster * 3) % 7 === 0 ? 2 : vertical < -0.25 ? 3 : (i + cluster) % 2];
      kit.add(leaf,material,p,[size * 1.18,size * 0.61,size * 1.34],[vertical * 0.5,angle + 0.4,nx * 0.38]);
    }
  });
  kit.scope('static');
  return canopy;
}

export function createTreeGoPavilion() {
  const kit = createPavilionKit();
  const group = kit.group;
  addGoPavilionArchitecture(kit);
  addAncientTree(kit);
  const canopy = addCanopy(kit);
  const light = new THREE.PointLight('#ffca85',2.5,7,2);
  light.name = 'pavilion-warm-lantern-light';
  light.position.set(1.7,2.9,1.35);
  light.castShadow = false;
  group.add(light);
  const stats = Object.freeze(kit.finish());
  group.userData.stats = stats;
  group.userData.spec = PAVILION_SPEC;
  group.userData.elapsed = 0;
  let disposed = false, elapsed = 0;
  return {
    group, stats,
    update(delta,reducedMotion = false) {
      if (disposed || reducedMotion || !Number.isFinite(delta) || delta <= 0) return;
      elapsed += Math.min(delta,0.05);
      group.userData.elapsed = elapsed;
      canopy.rotation.z = Math.sin(elapsed * 0.68) * 0.006;
      canopy.rotation.x = Math.sin(elapsed * 0.47) * 0.003;
      kit.materials.lantern.emissiveIntensity = 0.72 + Math.sin(elapsed * 0.83) * 0.035;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      kit.dispose();
    },
  };
}
