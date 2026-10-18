import * as THREE from 'three';
import { createStorybookKit } from './StorybookBuildingKit.js';

export const BALLOON_SPEC = Object.freeze({
  name: '气球射击摊', width: 7.6, depth: 4.6, height: 9.1, groundY: 0,
  reference: '气球射击摊_多视图.jpg', drawCallBudget: 40, triangleBudget: 150000,
});

/** Reference-inspired, fully dimensional carnival booth. Local front is +Z. */
export function createBalloonGameStall() {
  const kit = createStorybookKit({
    name: 'BalloonGameStallAsset',
    palette: {
      coral: '#d75e68', cream: '#f6e9d3', wood: '#c78a54', woodLight: '#e0ac72',
      woodDark: '#8f503a', inside: '#784237', gold: { color: '#d1a457', metalness: 0.25 },
      bulb: { color: '#fff4cc', emissive: '#ffce75', emissiveIntensity: 0.72, roughness: 0.33 },
      wire: '#856248', metal: { color: '#496575', metalness: 0.25, roughness: 0.5 },
      ink: '#373348', white: '#fff8eb', beige: '#e4ba83', pink: '#e8a0ae',
      red: { color: '#df4d5d', roughness: 0.3 },
      aqua: { color: '#78c2bc', roughness: 0.3 },
      lime: { color: '#92b96a', roughness: 0.3 },
      yellow: { color: '#edc04e', roughness: 0.3 },
      blue: { color: '#699dd2', roughness: 0.3 },
      purple: { color: '#ac82cb', roughness: 0.3 },
      orange: { color: '#e89b5f', roughness: 0.3 },
    },
  });
  const { group } = kit;
  const knot = kit.custom(new THREE.ConeGeometry(1, 1, 10));
  const ribbonTail = kit.custom(new THREE.ConeGeometry(1, 1, 3));

  function balloon(mat, x, y, z, size = 1, lean = 0, stringEnd) {
    kit.sphere(mat, [x, y, z], [0.32 * size, 0.42 * size, 0.31 * size], [0, 0, lean]);
    kit.add(knot, mat, [x + Math.sin(lean) * 0.4 * size, y - 0.415 * size, z],
      [0.045 * size, 0.085 * size, 0.045 * size]);
    if (stringEnd) kit.tube('wire', [[x, y - 0.45 * size, z],
      [(x + stringEnd[0]) / 2 + 0.06, (y - 0.45 * size + stringEnd[1]) / 2, (z + stringEnd[2]) / 2], stringEnd], 0.012, 10);
  }

  function bear(mat, x, y, z, s = 1) {
    kit.sphere(mat, [x, y + 0.21 * s, z], [0.18 * s, 0.23 * s, 0.15 * s]);
    kit.sphere(mat, [x, y + 0.52 * s, z], [0.23 * s, 0.21 * s, 0.17 * s]);
    for (const side of [-1, 1]) {
      kit.sphere(mat, [x + side * 0.18 * s, y + 0.69 * s, z], [0.095 * s, 0.095 * s, 0.065 * s]);
      kit.sphere('pink', [x + side * 0.18 * s, y + 0.69 * s, z + 0.054 * s], [0.052 * s, 0.052 * s, 0.02 * s]);
      kit.sphere(mat, [x + side * 0.21 * s, y + 0.28 * s, z], [0.09 * s, 0.15 * s, 0.09 * s], [0, 0, side * 0.6]);
      kit.sphere(mat, [x + side * 0.12 * s, y + 0.065 * s, z + 0.075 * s], [0.1 * s, 0.09 * s, 0.15 * s]);
      kit.sphere('ink', [x + side * 0.075 * s, y + 0.55 * s, z + 0.164 * s], [0.022 * s, 0.028 * s, 0.014 * s]);
    }
    kit.sphere('cream', [x, y + 0.46 * s, z + 0.16 * s], [0.095 * s, 0.065 * s, 0.04 * s]);
    kit.sphere('ink', [x, y + 0.48 * s, z + 0.198 * s], [0.034 * s, 0.026 * s, 0.012 * s]);
    for (const side of [-1, 1]) kit.sphere('coral', [x + side * 0.055 * s, y + 0.34 * s, z + 0.15 * s], [0.065 * s, 0.035 * s, 0.025 * s], [0, 0, side * 0.35]);
    kit.sphere('gold', [x, y + 0.34 * s, z + 0.175 * s], [0.028 * s, 0.028 * s, 0.02 * s]);
  }

  function present(mat, x, y, z, s = 1) {
    kit.box(mat, [x, y + 0.18 * s, z], [0.38 * s, 0.36 * s, 0.34 * s]);
    kit.box('cream', [x, y + 0.185 * s, z + 0.175 * s], [0.055 * s, 0.35 * s, 0.022]);
    kit.box('cream', [x, y + 0.365 * s, z], [0.055 * s, 0.025, 0.34 * s]);
    kit.box('cream', [x, y + 0.365 * s, z], [0.38 * s, 0.025, 0.055 * s]);
    for (const side of [-1, 1]) kit.torus('gold', [x + side * 0.055 * s, y + 0.4 * s, z], 0.055 * s, 0.014 * s, [0.2, side * 0.5, 0]);
  }

  // Raised rounded plinth and plank floor: the bottom of the base is exactly Y=0.
  kit.box('woodLight', [0, 0.16, 0.1], [7.35, 0.32, 4.25]);
  kit.box('woodDark', [0, 0.36, 0.05], [6.8, 0.16, 3.65]);
  for (let i = 0; i < 13; i++) kit.box(i % 3 ? 'wood' : 'woodLight', [-3 + i * 0.5, 0.46, 0.05], [0.48, 0.13, 3.42]);

  // Back board, striped sides and a striped lower front, all solid surfaces.
  kit.box('inside', [0, 3.07, -1.48], [6.45, 5.12, 0.28]);
  for (let i = 0; i < 15; i++) kit.box(i % 2 ? 'cream' : 'coral', [-3.15 + i * 0.45, 3.08, -1.67], [0.435, 5.14, 0.11]);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) kit.box(i % 2 ? 'cream' : 'coral', [side * 3.18, 2.99, -1.37 + i * 0.45], [0.25, 5.02 - i * 0.06, 0.43]);
    kit.box('woodDark', [side * 3.02, 3.07, 1.49], [0.26, 5.1, 0.29]);
    kit.box('wood', [side * 3.02, 3.1, 1.66], [0.19, 4.98, 0.12]);
    kit.box('wood', [side * 3.27, 0.64, 0.03], [0.18, 0.25, 3.6]);
  }
  for (let i = 0; i < 15; i++) kit.box(i % 2 ? 'cream' : 'coral', [-3.15 + i * 0.45, 1.02, 1.67], [0.435, 1.15, 0.25]);
  kit.box('woodDark', [0, 1.57, 1.62], [6.65, 0.16, 0.4]);
  kit.box('woodLight', [0, 1.78, 1.72], [7.15, 0.28, 0.83]);
  kit.box('wood', [0, 1.62, 1.93], [6.88, 0.13, 0.16]);
  for (let i = 0; i < 6; i++) kit.box('wood', [-2.4 + i * 0.95, 1.926, 1.72], [0.016, 0.008, 0.66]);

  // A one-piece pitched canopy, assembled from alternating rounded stripes.
  const slope = 0.145;
  for (let i = 0; i < 15; i++) kit.box(i % 2 ? 'cream' : 'coral', [-3.36 + i * 0.48, 5.71, 0], [0.478, 0.3, 3.88], [slope, 0, 0]);
  kit.box('wood', [0, 5.41, 1.94], [7.34, 0.4, 0.3]);
  kit.box('woodLight', [0, 5.64, 1.95], [7.26, 0.07, 0.28]);
  kit.box('woodDark', [0, 5.98, -1.94], [7.23, 0.3, 0.21]);
  for (const side of [-1, 1]) kit.box('coral', [side * 3.57, 5.7, 0], [0.16, 0.31, 3.87], [slope, 0, 0]);

  // Warm marquee lights (emissive geometry rather than dozens of point lights).
  for (let i = 0; i < 15; i++) {
    const x = -3.24 + i * 0.463;
    kit.cylinder('gold', [x, 5.41, 2.105], 0.096, 0.045, [Math.PI / 2, 0, 0]);
    kit.sphere('bulb', [x, 5.41, 2.145], [0.07, 0.08, 0.055]);
  }
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const y = 2.1 + i * 0.65;
    kit.cylinder('gold', [side * 3.02, y, 1.75], 0.087, 0.035, [Math.PI / 2, 0, 0]);
    kit.sphere('bulb', [side * 3.02, y, 1.79], [0.064, 0.075, 0.052]);
  }
  for (let span = 0; span < 3; span++) {
    const start = -2.88 + span * 1.92;
    kit.tube('wire', [[start, 5.17, 1.43], [start + 0.96, 4.88, 1.45], [start + 1.92, 5.17, 1.43]], 0.017, 14);
    for (let i = 1; i <= 3; i++) {
      const t = i / 4, x = start + 1.92 * t, y = 5.17 - 0.29 * Math.sin(Math.PI * t);
      kit.beam('gold', [x, y, 1.45], [x, y - 0.085, 1.45], 0.032);
      kit.sphere('bulb', [x, y - 0.12, 1.45], [0.056, 0.081, 0.056]);
    }
  }

  // Colourful target balloons mounted away from the back wall, not image planes.
  const colors = ['red', 'yellow', 'aqua', 'purple', 'orange', 'blue', 'lime'];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 7; col++) {
    const x = -2.39 + col * 0.79 + (row === 1 ? 0.08 : 0);
    const y = 4.63 - row * 0.76 + 0.06 * Math.sin(col * 1.7 + row);
    balloon(colors[(col + row * 3) % colors.length], x, y, -0.91 + (col % 2) * 0.09, 0.94, Math.sin(col * 3 + row) * 0.12,
      [x + 0.025, y - 0.64, -1.12]);
  }

  // Prize shelf with teddy bears, ribbon-tied gifts and candy tins.
  kit.box('wood', [0.18, 2.15, -0.44], [5.51, 0.16, 0.91]);
  kit.box('woodLight', [0.18, 2.2, 0.025], [5.57, 0.12, 0.12]);
  for (const x of [-2.1, 1.9]) kit.box('woodDark', [x, 1.86, -0.89], [0.13, 0.57, 0.34], [-0.35, 0, 0]);
  bear('beige', 1.28, 2.25, -0.29, 1.15);
  bear('pink', 2.2, 2.25, -0.28, 0.97);
  bear('blue', 0.47, 2.25, -0.28, 0.8);
  present('purple', -0.26, 2.25, -0.32, 0.97);
  present('aqua', -0.85, 2.25, -0.3, 0.82);
  for (let stack = 0; stack < 3; stack++) for (let level = 0; level < 3 + stack % 2; level++) {
    const x = -2.15 + stack * 0.39, y = 2.35 + level * 0.17;
    kit.cylinder(colors[(stack + level * 2) % colors.length], [x, y, -0.27], 0.16, 0.16);
    kit.cylinder('cream', [x, y + 0.055, -0.27], 0.164, 0.025);
    if (level === 2 + stack % 2) kit.cylinder('gold', [x, y + 0.093, -0.27], 0.164, 0.024);
  }
  present('red', -2.45, 1.91, 1.33, 0.8);
  present('blue', 2.45, 1.91, 1.34, 0.74);

  // Small, clearly toy-like counter launchers on fixed stands.
  for (let index = 0; index < 3; index++) {
    const x = -1.66 + index * 1.66;
    kit.cylinder('gold', [x, 1.97, 1.24], 0.15, 0.09);
    kit.beam('metal', [x, 2.0, 1.24], [x, 2.17, 1.05], 0.054);
    kit.box('woodDark', [x, 2.03, 1.4], [0.16, 0.17, 0.65], [-0.28, 0, 0]);
    kit.box('wood', [x, 2.06, 1.38], [0.17, 0.105, 0.57], [-0.28, 0, 0]);
    kit.beam('metal', [x, 2.12, 1.08], [x, 2.36, 0.22], 0.047);
    kit.beam('orange', [x, 2.345, 0.275], [x, 2.375, 0.17], 0.066);
    kit.box('metal', [x, 2.27, 0.72], [0.073, 0.09, 0.09]);
  }

  // Oversized roof target: all rings have their own depth and a sturdy mount.
  for (const x of [-0.52, 0.52]) kit.box('woodDark', [x, 6.12, 0.14], [0.12, 1.12, 0.16]);
  kit.cylinder('woodDark', [0, 6.65, 0.12], 1.1, 0.24, [Math.PI / 2, 0, 0]);
  kit.cylinder('coral', [0, 6.65, 0.265], 1.065, 0.12, [Math.PI / 2, 0, 0]);
  for (const radius of [0.25, 0.58, 0.95]) kit.torus('cream', [0, 6.65, 0.335], radius, 0.043);
  kit.sphere('red', [0, 6.65, 0.35], [0.16, 0.16, 0.055]);
  for (const [x, y, angle] of [[0.67, 7.23, -0.5], [-0.8, 6.18, 0.7]]) {
    const end = [x + Math.cos(angle) * 0.45, y + Math.sin(angle) * 0.45, 0.49];
    kit.beam('woodLight', [x, y, 0.37], end, 0.035);
    kit.add(ribbonTail, 'orange', end, [0.16, 0.26, 0.07], [0, 0, angle - Math.PI / 2]);
    kit.sphere('cream', [x, y, 0.39], [0.075, 0.075, 0.045]);
  }

  // Anchored side balloons complete the silhouette without widening the footprint.
  for (const [side, mat, y, z] of [[-1, 'purple', 4.26, 1.25], [-1, 'lime', 3.25, 1.27], [1, 'pink', 4.18, 1.13], [1, 'aqua', 3.3, 1.29]]) {
    balloon(mat, side * 3.24, y, z, 0.96, -side * 0.15, [side * 3.17, 2.18, 1.47]);
  }

  // Only the roof bouquet moves; its pivot is the tied string knot on the roof.
  const bouquet = kit.scope('BalloonBouquet', [0.05, 5.99, -0.16]);
  const roofBalloons = [
    ['purple', -0.16, 8.25, -0.27, 1.45, 0.08],
    ['aqua', 0.92, 7.97, -0.28, 1.45, -0.13],
    ['pink', -0.63, 7.89, 0.08, 1.27, 0.18],
    ['orange', -1.03, 7.56, -0.43, 1.17, 0.28],
    ['blue', 0.36, 7.57, -0.5, 1.21, -0.13],
  ];
  for (const [mat, x, y, z, size, lean] of roofBalloons) balloon(mat, x, y, z, size, lean, [0.05, 6.02, -0.16]);
  kit.scope('static');
  const stats = kit.finish();
  let elapsed = 0, disposed = false;
  group.userData.spec = BALLOON_SPEC;
  group.userData.elapsed = elapsed;
  return {
    group, stats,
    update(delta, reducedMotion = false) {
      if (disposed || reducedMotion || !Number.isFinite(delta) || delta <= 0) return;
      elapsed += Math.min(delta, 0.05);
      bouquet.rotation.z = Math.sin(elapsed * 0.84) * 0.022;
      bouquet.rotation.x = Math.sin(elapsed * 0.59) * 0.012;
      kit.materials.bulb.emissiveIntensity = 0.72 + Math.sin(elapsed * 1.25) * 0.045;
      group.userData.elapsed = elapsed;
    },
    dispose() { if (disposed) return; disposed = true; kit.dispose(); },
  };
}
