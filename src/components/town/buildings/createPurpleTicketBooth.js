import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createStorybookKit } from './StorybookBuildingKit.js';

export const TICKET_SPEC = Object.freeze({
  name: '紫色售票亭', width: 5.6, depth: 4.3, height: 7,
  groundY: 0, reference: '紫色售票亭_三视图.jpg', drawCallBudget: 30, triangleBudget: 100000,
});

/** Rounded clay-style ticket booth, front +Z, with an actual open window cavity. */
export function createPurpleTicketBooth() {
  const kit = createStorybookKit({ name: 'PurpleTicketBoothAsset', palette: {
    purple: '#9374bc', lavender: '#ac8acb', deepPurple: '#765792', interior: '#504052',
    cream: '#f5e8d0', wood: '#b07a50', woodLight: '#d1a06d', woodDark: '#825436',
    gold: { color: '#d5ad62', metalness: 0.3, roughness: 0.48 },
    paper: '#fff4da', ink: '#8e658f', glow: { color: '#fff0c4', emissive: '#ffd28a', emissiveIntensity: 0.65 },
  } });
  const { group } = kit;
  const rounded = (mat, p, dimensions, radius) => kit.add(kit.custom(new RoundedBoxGeometry(...dimensions, 4, radius)), mat, p);
  const stroke = (mat, points, width = 0.05, segments = 18) => kit.tube(mat, points, width, segments);

  // Grounded foot, four corner pillars and separate side/back walls.
  rounded('lavender', [0, 0.2, 0], [5.22, 0.4, 3.84], 0.18);
  kit.box('woodDark', [0, 0.46, 0], [4.57, 0.12, 3.34]);
  kit.box('interior', [0, 2.64, -1.52], [4.4, 4.28, 0.24]);
  kit.box('purple', [0, 2.65, -1.7], [4.48, 4.3, 0.16]);
  for (const side of [-1, 1]) {
    rounded('purple', [side * 2.17, 2.65, -0.05], [0.35, 4.4, 3.28], 0.16);
    rounded('lavender', [side * 2.08, 2.64, 1.54], [0.43, 4.41, 0.42], 0.17);
    rounded('purple', [side * 2.1, 2.64, -1.54], [0.42, 4.41, 0.42], 0.17);
    kit.box('lavender', [side * 2.355, 2.67, -0.06], [0.065, 3.4, 2.32]);
    kit.box('purple', [side * 2.397, 2.67, -0.06], [0.028, 3.16, 2.06]);
    kit.box('deepPurple', [side * 2.39, 1.28, -0.06], [0.035, 0.07, 2.2]);
  }

  // Real cut-out in the front surround, with no solid wall behind the aperture.
  const facade = new THREE.Shape();
  facade.moveTo(-2.13, 1.6); facade.lineTo(2.13, 1.6); facade.lineTo(2.13, 4.78);
  facade.lineTo(-2.13, 4.78); facade.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-1.58, 1.66); hole.lineTo(-1.58, 3.62);
  hole.quadraticCurveTo(-1.58, 4.23, -0.98, 4.28); hole.quadraticCurveTo(0, 4.38, 0.98, 4.28);
  hole.quadraticCurveTo(1.58, 4.23, 1.58, 3.62); hole.lineTo(1.58, 1.66); hole.closePath();
  facade.holes.push(hole);
  kit.add(kit.custom(new THREE.ExtrudeGeometry(facade, { depth: 0.21, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 12 })), 'purple', [0, 0, 1.4]);
  const arch = [[-1.58, 1.72, 1.72], [-1.58, 3.55, 1.72], [-1.43, 4.06, 1.72], [-0.94, 4.24, 1.72],
    [0, 4.29, 1.72], [0.94, 4.24, 1.72], [1.43, 4.06, 1.72], [1.58, 3.55, 1.72], [1.58, 1.72, 1.72]];
  stroke('wood', arch, 0.135, 48);
  stroke('woodLight', arch.map(([x, y, z]) => [x * 1.035, y, z + 0.045]), 0.025, 48);
  for (const side of [-1, 1]) for (const y of [1.98, 4.04]) kit.sphere('gold', [side * (y > 3 ? 1.4 : 1.59), y, 1.844], [0.055, 0.055, 0.025]);

  // Front timber boards with individually raised wood-grain curves.
  for (let i = 0; i < 9; i++) {
    const x = -1.78 + i * 0.445;
    kit.box(i % 3 ? 'wood' : 'woodLight', [x, 1.05, 1.52], [0.434, 1.15, 0.25]);
    for (let line = 0; line < 2; line++) stroke('woodDark', [[x - 0.105 + line * 0.19, 0.54, 1.653],
      [x - 0.13 + line * 0.19, 0.86, 1.655], [x - 0.08 + line * 0.19, 1.13, 1.655], [x - 0.1 + line * 0.19, 1.57, 1.653]], 0.009, 10);
  }
  kit.box('deepPurple', [0, 1.64, 1.57], [4.14, 0.22, 0.31]);
  rounded('cream', [0, 1.82, 1.66], [4.24, 0.25, 0.88], 0.11);
  kit.box('wood', [0, 1.7, 0.78], [3.6, 0.13, 1.08]);

  // Quiet interior detail remains recessed a full metre behind the service window.
  kit.box('wood', [0, 1.57, -0.96], [3.43, 0.12, 0.62]);
  kit.box('woodDark', [0, 1.08, -0.71], [0.82, 0.14, 0.8]);
  stroke('wood', [[-0.43, 1.12, -0.95], [-0.43, 2.04, -0.95], [0, 2.32, -0.95], [0.43, 2.04, -0.95], [0.43, 1.12, -0.95]], 0.07, 28);
  for (const x of [-0.29, 0.29]) kit.beam('woodDark', [x, 0.52, -0.6], [x, 1.08, -0.6], 0.055);
  for (let i = 0; i < 4; i++) {
    kit.box('paper', [-1.08, 1.675 + i * 0.054, -0.89], [0.53, 0.048, 0.32]);
    kit.box('ink', [-1.08, 1.702 + i * 0.054, -0.89], [0.04, 0.008, 0.25]);
  }
  kit.cylinder('gold', [1.14, 1.98, 1.61], 0.19, 0.065);
  kit.sphere('gold', [1.14, 2.025, 1.61], [0.145, 0.1, 0.145]);
  kit.cylinder('woodDark', [1.14, 2.14, 1.61], 0.033, 0.07);
  kit.sphere('gold', [1.14, 2.18, 1.61], [0.055, 0.03, 0.055]);
  for (const x of [-1.05, 1.05]) {
    kit.cylinder('gold', [x, 4.49, 0.45], 0.17, 0.09);
    kit.sphere('glow', [x, 4.43, 0.45], [0.13, 0.06, 0.13]);
  }

  // Back access door and discreet hinges, so orbiting reveals a finished building.
  rounded('deepPurple', [0, 2.13, -1.82], [1.98, 3.38, 0.11], 0.16);
  rounded('lavender', [0, 2.15, -1.9], [1.72, 3.16, 0.09], 0.14);
  kit.box('purple', [0, 2.18, -1.957], [1.38, 2.76, 0.025]);
  for (const y of [0.96, 3.34]) kit.box('gold', [-0.79, y, -1.978], [0.17, 0.1, 0.045]);
  kit.cylinder('gold', [0.59, 2.09, -1.999], 0.085, 0.04, [Math.PI / 2, 0, 0]);
  kit.sphere('gold', [0.59, 2.09, -2.04], [0.06, 0.06, 0.05]);

  // Broad softened roof cap, and a hand-shaped cream enamel sign.
  rounded('lavender', [0, 4.91, 0], [5.44, 0.4, 4.03], 0.18);
  rounded('purple', [0, 5.36, -0.03], [4.94, 0.91, 3.59], 0.43);
  const sign = kit.scope('TicketSign', [0, 5.31, 1.59]);
  const outline = [[-1.53, 5.41], [-1.64, 5.58], [-1.6, 5.94], [-1.69, 6.36], [-1.51, 6.51],
    [-1.09, 6.52], [0, 6.85], [1.09, 6.52], [1.51, 6.51], [1.69, 6.36], [1.6, 5.94], [1.64, 5.58], [1.53, 5.41]];
  const plate = new THREE.Shape(); plate.moveTo(...outline[0]);
  for (let i = 1; i < outline.length; i++) plate.lineTo(...outline[i]); plate.closePath();
  kit.add(kit.custom(new THREE.ExtrudeGeometry(plate, { depth: 0.16, bevelEnabled: true, bevelSize: 0.055, bevelThickness: 0.055, bevelSegments: 3 })), 'cream', [0, 0, 1.65]);
  stroke('gold', outline.map(([x, y]) => [x, y, 1.835]), 0.075, 64);
  stroke('gold', [[-1.53, 5.41, 1.835], [0, 5.4, 1.835], [1.53, 5.41, 1.835]], 0.075, 24);
  for (const [x, y] of [[-1.5, 5.57], [1.5, 5.57], [-1.51, 6.37], [1.51, 6.37], [0, 6.72]]) kit.sphere('gold', [x, y, 1.9], [0.085, 0.085, 0.045]);
  const glyphs = {
    T: [[[0, 1], [1, 1]], [[0.5, 1], [0.5, 0]]],
    I: [[[0.15, 1], [0.85, 1]], [[0.5, 1], [0.5, 0]], [[0.15, 0], [0.85, 0]]],
    C: [[[0.95, 0.87], [0.65, 1], [0.18, 0.79], [0.1, 0.35], [0.36, 0.02], [0.94, 0.12]]],
    K: [[[0.06, 0], [0.06, 1]], [[0.96, 1], [0.08, 0.45]], [[0.44, 0.66], [1, 0]]],
    E: [[[0.08, 0], [0.08, 1]], [[0.08, 1], [1, 1]], [[0.08, 0.51], [0.85, 0.51]], [[0.08, 0], [1, 0]]],
    S: [[[0.94, 0.87], [0.55, 1], [0.1, 0.78], [0.36, 0.54], [0.84, 0.35], [0.86, 0.09], [0.38, 0], [0.05, 0.12]]],
  };
  [...'TICKETS'].forEach((letter, index) => glyphs[letter].forEach(points => {
    const path = points.map(([x, y]) => [-1.32 + index * 0.389 + x * 0.31, 5.79 + y * 0.55, 1.913]);
    if (path.length === 2) kit.beam('gold', path[0], path[1], 0.032);
    else stroke('gold', path, 0.032, 18);
  }));
  kit.scope('static');
  const stats = kit.finish();
  let elapsed = 0, disposed = false;
  group.userData.spec = TICKET_SPEC; group.userData.elapsed = elapsed;
  return { group, stats,
    update(delta, reducedMotion = false) {
      if (disposed || reducedMotion || !Number.isFinite(delta) || delta <= 0) return;
      elapsed += Math.min(delta, 0.05);
      sign.rotation.z = Math.sin(elapsed * 0.65) * 0.003;
      kit.materials.glow.emissiveIntensity = 0.65 + Math.sin(elapsed * 1.1) * 0.025;
      group.userData.elapsed = elapsed;
    },
    dispose() { if (disposed) return; disposed = true; kit.dispose(); },
  };
}
