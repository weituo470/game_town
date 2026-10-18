import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Static, texture-free architecture for the old-tree Go pavilion.
 *
 * All geometry is handed to the caller's material batching kit. There are no
 * materials, lights, textures, React objects, animation loops or shared mutable
 * resources in this module. Custom geometries are registered exactly once;
 * `kit.add` owns the transformed copy, while `kit.custom` owns the source.
 */
export function addGoPavilionArchitecture(kit) {
  const TAU = Math.PI * 2;
  const lanternPositions = [];
  const center = [1.7, 0, 1.25];
  // High-count objects do not borrow a potentially high-segment kit primitive.
  // A one-segment stone keeps the softened silhouette at just 108 triangles;
  // fine inlaid grid strips only need the twelve triangles of a simple box.
  const masonryGeometry = new RoundedBoxGeometry(1, 1, 1, 1, 0.09);
  const lineGeometry = new THREE.BoxGeometry(1, 1, 1);
  kit.custom(masonryGeometry);
  kit.custom(lineGeometry);
  const stoneBlock = (material, p, s, r) => kit.add(masonryGeometry, material, p, s, r);
  const gridLine = (p, s, r) => kit.add(lineGeometry, 'grid', p, s, r);
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const jitter = (n) => {
    const a = Math.sin(n * 127.1 + 51.74) * 43758.5453123;
    return a - Math.floor(a);
  };

  // Bevelled individual paving slabs, with actual seams instead of a texture.
  function paving(points, thickness, bevel = 0.025) {
    const shape = new THREE.Shape();
    points.forEach(([x, z], i) => {
      if (i === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: bevel > 0,
      bevelSegments: 1,
      steps: 1,
      bevelSize: bevel,
      bevelThickness: bevel,
      curveSegments: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    kit.custom(geometry);
    return geometry;
  }

  // Convex polygon clipping keeps the irregular patio slabs inside the ellipse.
  function clipPolygon(subject, clipper) {
    let output = subject;
    for (let i = 0; i < clipper.length; i += 1) {
      const a = clipper[i];
      const b = clipper[(i + 1) % clipper.length];
      const input = output;
      output = [];
      if (input.length === 0) break;
      const inside = (p) =>
        (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -0.00001;
      const intersect = (p, q) => {
        const ex = b[0] - a[0];
        const ez = b[1] - a[1];
        const dx = q[0] - p[0];
        const dz = q[1] - p[1];
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-8) return q;
        const t = ((a[0] - p[0]) * ez - (a[1] - p[1]) * ex) / den;
        return [p[0] + dx * t, p[1] + dz * t];
      };
      let previous = input[input.length - 1];
      for (const current of input) {
        if (inside(current)) {
          if (!inside(previous)) output.push(intersect(previous, current));
          output.push(current);
        } else if (inside(previous)) output.push(intersect(previous, current));
        previous = current;
      }
    }
    return output;
  }

  // A dark recessed core never shows through the masonry's intentional joints.
  const base = new THREE.CylinderGeometry(1, 1, 1, 64, 1);
  kit.custom(base);
  kit.add(base, 'stoneDark', [0, 0.36, 0], [4.92, 0.6, 3.78]);
  kit.add(base, 'stone', [0, 0.705, 0], [4.85, 0.095, 3.71]);

  // Tangential coursed stones make the raised platform read from every angle.
  for (let row = 0; row < 3; row += 1) {
    const count = row === 0 ? 37 : 40;
    const rx = row === 0 ? 4.93 : 4.82;
    const rz = row === 0 ? 3.8 : 3.7;
    for (let i = 0; i < count; i += 1) {
      const a = ((i + (row % 2) * 0.5) / count) * TAU;
      const x = Math.cos(a) * rx;
      const z = Math.sin(a) * rz;
      // The staircase replaces the front parapet stones, not a floating ramp.
      if (z > 3.15 && x > -0.02 && x < 2.55 && row > 0) continue;
      const tangent = Math.atan2(-rz * Math.cos(a), -rx * Math.sin(a));
      const arc = Math.hypot(rx * Math.sin(a), rz * Math.cos(a)) * TAU / count;
      const material = i % 7 === 0 ? 'stoneLight' : i % 9 === 0 ? 'stoneDark' : 'stone';
      stoneBlock(material, [x, 0.18 + row * 0.235, z],
        [arc * (0.96 + jitter(i + row * 100) * 0.025), 0.25, row === 0 ? 0.44 : 0.34],
        [0, tangent, (jitter(i * 4 + row) - 0.5) * 0.035]);
    }
  }

  const clipper = Array.from({ length: 40 }, (_, i) => {
    const a = i / 40 * TAU;
    return [Math.cos(a) * 4.8, Math.sin(a) * 3.68];
  });
  for (let row = -4; row <= 3; row += 1) {
    for (let column = -5; column <= 5; column += 1) {
      const x = column * 0.91 + (row % 2) * 0.42;
      const z = row * 0.91 + 0.1;
      const index = (row + 4) * 11 + column + 5;
      const corner = (n) => (jitter(index * 9 + n) - 0.5) * 0.1;
      const poly = clipPolygon([
        [x + 0.035 + corner(1), z + 0.035 + corner(2)],
        [x + 0.865 + corner(3), z + 0.035 + corner(4)],
        [x + 0.865 + corner(5), z + 0.865 + corner(6)],
        [x + 0.035 + corner(7), z + 0.865 + corner(8)],
      ], clipper);
      if (poly.length < 3) continue;
      const mat = index % 9 === 0 ? 'stoneDark' : index % 4 === 0 ? 'stoneLight' : 'stone';
      kit.add(paving(poly, 0.052, 0.02), mat, [0, 0.734 + jitter(index) * 0.012, 0]);
    }
  }

  // Four solid stairs and segmented cheek stones connect down to the ground.
  for (let step = 0; step < 4; step += 1) {
    const z = 4.35 - step * 0.34;
    const top = 0.2 + step * 0.19;
    kit.box(step % 2 ? 'stoneLight' : 'stone', [1.24, top / 2, z], [2.28, top, 0.48]);
    // A real shallow lip catches dusk light without an outline shader.
    kit.box('stoneLight', [1.24, top - 0.016, z + 0.19], [2.17, 0.055, 0.1]);
    for (const side of [-1, 1]) {
      kit.box('stone', [1.24 + side * 1.27, top * 0.67 + (step === 0 ? 0.015 : 0), z], [0.31, top * 1.22, 0.47],
        [-0.1, side * 0.025, 0]);
    }
  }

  // Low stone fence: open stair entry and low enough not to obscure the board.
  const fenceAngles = [-0.31, 0.10, 0.50, 2.03, 2.43, 2.83, 3.23, 3.63, 4.03, 4.43, 4.83, 5.23, 5.63];
  const fencePoints = fenceAngles.map((a) => [4.54 * Math.cos(a), 0.82, 3.41 * Math.sin(a)]);
  fencePoints.forEach((p, i) => {
    kit.cylinder('stone', [p[0], 1.12, p[2]], 0.12, 0.59);
    kit.box('stoneDark', [p[0], 0.87, p[2]], [0.31, 0.12, 0.31]);
    kit.sphere(i % 3 ? 'stone' : 'stoneLight', [p[0], 1.43, p[2]], [0.18, 0.13, 0.18]);
    if (i === fencePoints.length - 1) return;
    const next = fencePoints[i + 1];
    if (fenceAngles[i + 1] - fenceAngles[i] > 0.6) return;
    kit.beam('stone', [p[0], 1.16, p[2]], [next[0], 1.16, next[2]], 0.078);
  });

  // Four light, articulated timber posts; collars and short diagonal braces.
  const postXs = [-0.02, 3.42];
  const postZs = [-0.08, 2.58];
  for (const x of postXs) {
    for (const z of postZs) {
      kit.box('stoneDark', [x, 0.86, z], [0.41, 0.13, 0.41]);
      kit.box('woodLight', [x, 0.98, z], [0.35, 0.14, 0.35]);
      kit.cylinder('wood', [x, 2.21, z], 0.115, 2.48);
      kit.cylinder('woodLight', [x, 3.4, z], 0.16, 0.17);
      kit.box('woodDark', [x, 3.51, z], [0.37, 0.13, 0.38]);
      const sx = x < center[0] ? 1 : -1;
      const sz = z < center[2] ? 1 : -1;
      kit.beam('woodLight', [x, 2.95, z], [x + sx * 0.46, 3.53, z], 0.052);
      kit.beam('wood', [x, 2.95, z], [x, 3.53, z + sz * 0.46], 0.052);
      // Fine timber ridges, deliberately sparse rather than noisy full bark.
      kit.tube('woodLight', [[x + 0.08, 1.1, z + 0.072], [x + 0.085, 2.12, z + 0.074], [x + 0.068, 3.28, z + 0.083]], 0.009, 5);
    }
  }
  kit.box('wood', [1.7, 3.54, -0.08], [3.86, 0.2, 0.18]);
  kit.box('wood', [1.7, 3.54, 2.58], [3.86, 0.2, 0.18]);
  kit.box('woodDark', [-0.02, 3.54, 1.25], [0.18, 0.2, 3.04]);
  kit.box('woodDark', [3.42, 3.54, 1.25], [0.18, 0.2, 3.04]);
  // Back rail and its turned balusters leave the welcoming front fully open.
  kit.beam('wood', [-0.02, 1.02, -0.08], [3.42, 1.02, -0.08], 0.065);
  for (let x = 0.3; x < 3.3; x += 0.6) {
    kit.cylinder('woodLight', [x, 1.19, -0.08], 0.025, 0.3);
  }
  kit.beam('woodLight', [-0.02, 1.37, -0.08], [3.42, 1.37, -0.08], 0.052);

  /** Parametric hipped roof; the eaves bend upwards independently of the ridge. */
  function roofPoint(face, u, v, lift = 0) {
    const width = 1.03 + 1.18 * v;
    const depth = 0.105 + 1.63 * v;
    const y = 4.47 - 1.015 * v + 0.27 * v ** 3 + 0.115 * Math.abs(u) ** 4 * v ** 3 + lift;
    if (face === 0) return [center[0] + u * width, y, center[2] + depth];
    if (face === 1) return [center[0] - u * width, y, center[2] - depth];
    if (face === 2) return [center[0] + width, y, center[2] - u * depth];
    return [center[0] - width, y, center[2] + u * depth];
  }

  // Each roof patch is a closed shallow solid: not a single plane or box roof.
  function roofPatch(face, u0, u1, v0, v1, lift, thickness, columns = 1, rows = 3) {
    const positions = [];
    const tri = (a, b, c) => positions.push(...a, ...b, ...c);
    const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
    const point = (u, v, bottom = false) => {
      const p = roofPoint(face, u, v, lift);
      if (bottom) p[1] -= thickness;
      return p;
    };
    for (let i = 0; i < columns; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        const ua = u0 + (u1 - u0) * i / columns;
        const ub = u0 + (u1 - u0) * (i + 1) / columns;
        const va = v0 + (v1 - v0) * j / rows;
        const vb = v0 + (v1 - v0) * (j + 1) / rows;
        quad(point(ua, va), point(ua, vb), point(ub, vb), point(ub, va));
        quad(point(ub, va, true), point(ub, vb, true), point(ua, vb, true), point(ua, va, true));
        if (i === 0) quad(point(ua, va, true), point(ua, vb, true), point(ua, vb), point(ua, va));
        if (i === columns - 1) quad(point(ub, va), point(ub, vb), point(ub, vb, true), point(ub, va, true));
        if (j === 0) quad(point(ua, va), point(ub, va), point(ub, va, true), point(ua, va, true));
        if (j === rows - 1) quad(point(ua, vb, true), point(ub, vb, true), point(ub, vb), point(ua, vb));
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    // The batching kit can normalize attributes, but supplying UVs also makes
    // these geometry-only patches compatible with simple mergeGeometries kits.
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
    kit.custom(geometry);
    return geometry;
  }

  for (let face = 0; face < 4; face += 1) {
    kit.add(roofPatch(face, -1, 1, 0, 1, 0, 0.13, 6, 6), 'roofDark');
    for (let row = 0; row < 4; row += 1) {
      const v0 = row / 4 + (row ? 0.01 : 0);
      const v1 = clamp((row + 1) / 4 + 0.025, 0, 1.015);
      const count = face < 2 ? 16 : 12;
      for (let column = 0; column < count; column += 1) {
        const u0 = -1 + column / count * 2 + 0.004;
        const u1 = -1 + (column + 1) / count * 2 - 0.004;
        const seed = face * 1000 + row * 30 + column;
        const material = seed % 9 === 0 ? 'roofDark' : seed % 4 === 0 ? 'roofLight' : 'roof';
        const lift = 0.036 + (3 - row) * 0.007 + jitter(seed) * 0.008;
        kit.add(roofPatch(face, u0, u1, v0, v1, lift, 0.035), material);
        // One fine raised wood rib on alternate tiles reads as thatch/wood grain.
        if (column % 2 === 0) {
          const u = (u0 + u1) / 2;
          kit.tube('roofLight', [roofPoint(face, u, v0 + 0.025, lift + 0.008),
            roofPoint(face, u + 0.002, (v0 + v1) / 2, lift + 0.008),
            roofPoint(face, u, v1 - 0.015, lift + 0.008)], 0.006, 4);
        }
      }
    }
    const edge = Array.from({ length: 13 }, (_, i) => roofPoint(face, -1 + i / 6, 1.008, 0.005));
    kit.tube('woodLight', edge, 0.065, 18);
  }
  // The four hips and thick rolled ridge remain a clear silhouette at distance.
  for (const side of [-1, 1]) {
    for (const u of [-1, 1]) {
      const points = Array.from({ length: 9 }, (_, i) => roofPoint(side === 1 ? 0 : 1, u, i / 8, 0.075));
      kit.tube('woodLight', points, 0.073, 16);
    }
  }
  kit.beam('woodLight', [0.54, 4.555, 1.25], [2.86, 4.555, 1.25], 0.095);
  kit.box('wood', [1.7, 4.48, 1.25], [2.27, 0.1, 0.26]);
  // Visible underside rafters, rather than an opaque ceiling hiding the room.
  for (let x = 0.2; x <= 3.3; x += 0.42) {
    kit.beam('woodDark', [x, 3.59, -0.16], [x, 4.32, 1.25], 0.033);
    kit.beam('woodDark', [x, 4.32, 1.25], [x, 3.59, 2.66], 0.033);
  }

  // Full-size 19 x 19 Go board: 38 inlaid lines, nine star points and a live game.
  const tx = 1.7;
  const tz = 1.35;
  kit.box('wood', [tx, 1.71, tz], [1.65, 0.2, 1.65]);
  kit.box('woodLight', [tx, 1.805, tz], [1.52, 0.055, 1.52]);
  for (const x of [-0.57, 0.57]) {
    for (const z of [-0.57, 0.57]) {
      kit.box('woodDark', [tx + x, 1.22, tz + z], [0.16, 0.84, 0.16]);
      kit.box('wood', [tx + x, 0.86, tz + z], [0.22, 0.12, 0.22]);
    }
  }
  kit.box('woodLight', [tx, 1.5, tz + 0.61], [1.32, 0.15, 0.07]);
  kit.box('wood', [tx, 1.5, tz - 0.61], [1.32, 0.15, 0.07]);
  const spacing = 1.27 / 18;
  for (let i = 0; i < 19; i += 1) {
    const offset = (i - 9) * spacing;
    gridLine([tx + offset, 1.838, tz], [0.007, 0.004, 1.28]);
    gridLine([tx, 1.838, tz + offset], [1.28, 0.004, 0.007]);
  }
  const stoneGeo = new THREE.SphereGeometry(1, 10, 6);
  kit.custom(stoneGeo);
  for (const x of [-6, 0, 6]) {
    for (const z of [-6, 0, 6]) {
      kit.add(stoneGeo, 'grid', [tx + x * spacing, 1.842, tz + z * spacing], [0.014, 0.003, 0.014]);
    }
  }
  const black = [[3, 3], [3, 4], [4, 5], [5, 3], [5, 4], [6, 5], [7, 5], [8, 6], [9, 7], [10, 6],
    [12, 3], [13, 4], [14, 5], [14, 6], [15, 6], [13, 13], [13, 14], [12, 15], [11, 13], [7, 12], [8, 13]];
  const white = [[4, 3], [4, 4], [5, 5], [5, 6], [6, 4], [7, 4], [8, 5], [9, 6], [10, 7], [11, 7],
    [14, 3], [14, 4], [15, 4], [15, 5], [14, 13], [14, 14], [13, 15], [11, 14], [6, 12], [7, 13], [7, 14]];
  for (const [material, stones] of [['black', black], ['ivory', white]]) {
    stones.forEach(([x, z]) => {
      kit.add(stoneGeo, material, [tx + (x - 9) * spacing, 1.862, tz + (z - 9) * spacing], [0.0325, 0.019, 0.0325]);
    });
  }
  // Small wooden bowls contain visible spare stones on the left/right ledge.
  for (const side of [-1, 1]) {
    const bx = tx + side * 0.96;
    const bz = tz - 0.36;
    kit.cylinder('woodDark', [bx, 1.72, bz], 0.155, 0.21);
    kit.cylinder('woodLight', [bx, 1.83, bz], 0.17, 0.045);
    kit.cylinder('black', [bx, 1.853, bz], 0.132, 0.01);
    for (let i = 0; i < 7; i += 1) {
      const a = i * 2.39996;
      const r = 0.034 * Math.sqrt(i);
      kit.add(stoneGeo, side === -1 ? 'black' : 'ivory', [bx + Math.cos(a) * r, 1.868 + i % 2 * 0.012, bz + Math.sin(a) * r], [0.031, 0.018, 0.031]);
    }
    kit.beam('wood', [tx + side * 0.66, 1.68, bz], [bx, 1.68, bz], 0.06);
  }

  // Four squat stools with separate rounded seats, legs and under-seat rails.
  const stools = [[0.49, 1.34, 0.05], [2.91, 1.34, -0.08], [1.7, 0.18, 0.04], [1.73, 2.51, -0.045]];
  for (const [x, z, turn] of stools) {
    kit.box('woodLight', [x, 1.19, z], [0.49, 0.15, 0.49], [0, turn, 0]);
    kit.box('wood', [x, 1.11, z], [0.36, 0.09, 0.36], [0, turn, 0]);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px = x + sx * 0.145;
        const pz = z + sz * 0.145;
        kit.beam('woodDark', [px + sx * 0.02, 0.81, pz + sz * 0.02], [px, 1.13, pz], 0.042);
      }
    }
  }

  function lantern(position, size = 1, suspension = 0.18) {
    const [x, y, z] = position;
    lanternPositions.push([x, y, z]);
    const rx = 0.17 * size;
    const ry = 0.225 * size;
    kit.beam('metal', [x, y + ry, z], [x, y + ry + suspension, z], 0.014);
    kit.add(stoneGeo, 'lantern', [x, y, z], [rx, ry, rx]);
    kit.cylinder('woodLight', [x, y + ry * 0.94, z], rx * 0.47, 0.035 * size);
    kit.cylinder('woodLight', [x, y - ry * 0.94, z], rx * 0.46, 0.034 * size);
    for (let rib = 0; rib < 8; rib += 1) {
      const angle = rib / 8 * TAU;
      const points = Array.from({ length: 9 }, (_, j) => {
        const t = j / 8 * Math.PI;
        const radial = Math.max(0.045 * size, Math.sin(t) * rx) + 0.005;
        return [x + Math.cos(angle) * radial, y + Math.cos(t) * ry * 0.94, z + Math.sin(angle) * radial];
      });
      kit.tube('woodLight', points, 0.007 * size, 8);
    }
    // A tiny bottom knot provides a legible handmade silhouette.
    kit.sphere('woodDark', [x, y - ry - 0.025, z], [0.025, 0.036, 0.025]);
  }
  lantern([0.24, 3.15, 2.67], 0.9, 0.25);
  lantern([1.64, 3.12, 2.68], 1.02, 0.25);
  lantern([3.16, 3.15, 2.67], 0.9, 0.25);
  lantern([-0.12, 3.12, 0.28], 0.9, 0.27);
  lantern([3.49, 3.12, 0.28], 0.9, 0.27);
  // The sixth hangs beyond the pavilion, under the canopy rather than the roof.
  lantern([-3.28, 3.65, 0.1], 1.18, 0.66);

  // The sign is a physical Go-board icon, never a text plane or decal.
  const sign = [2.18, 5.12, 0.74];
  const angle = -0.2;
  const signPoint = (p) => [sign[0] + p[0] * Math.cos(angle) - p[1] * Math.sin(angle),
    sign[1] + p[0] * Math.sin(angle) + p[1] * Math.cos(angle), sign[2] + p[2]];
  kit.beam('woodDark', [2.11, 4.43, 0.75], [2.11, 5.12, 0.75], 0.06);
  kit.box('woodDark', sign, [1.47, 1.06, 0.16], [0, 0, angle]);
  kit.box('woodLight', signPoint([0, 0, 0.092]), [1.37, 0.96, 0.05], [0, 0, angle]);
  for (let i = 0; i < 7; i += 1) {
    gridLine(signPoint([(i - 3) * 0.155, -0.015, 0.123]), [0.012, 0.76, 0.006], [0, 0, angle]);
    gridLine(signPoint([0, (i - 3) * 0.116 - 0.015, 0.123]), [1.08, 0.012, 0.006], [0, 0, angle]);
  }
  const signStones = [
    ['black', -0.34, 0.19, 0.265],
    ['ivory', 0.17, 0.115, 0.168],
    ['black', 0.35, -0.22, 0.147],
  ];
  for (const [mat, x, y, radius] of signStones) {
    kit.add(stoneGeo, mat, signPoint([x, y, 0.19]), [radius, radius, 0.07], [0, 0, angle]);
    if (mat === 'black') {
      kit.add(stoneGeo, 'ivory', signPoint([x - radius * 0.28, y + radius * 0.29, 0.252]), [radius * 0.11, radius * 0.11, 0.008]);
    }
  }

  // Restrained moss and a few sharp leaves soften the stone without hiding it.
  for (let i = 0; i < 34; i += 1) {
    const a = i * 2.39996;
    const rx = 4.45 + jitter(i * 3) * 0.55;
    const rz = 3.38 + jitter(i * 5) * 0.34;
    const x = Math.cos(a) * rx;
    const z = Math.sin(a) * rz;
    if (z > 3 && x > -0.3 && x < 2.8) continue;
    kit.add(stoneGeo, i % 3 ? 'moss' : 'grass', [x, i % 3 ? 0.82 : 0.13, z],
      [0.14 + jitter(i + 6) * 0.14, 0.055 + jitter(i + 7) * 0.06, 0.11 + jitter(i + 8) * 0.13]);
  }
  const leafGeometry = new THREE.ConeGeometry(1, 1, 4);
  leafGeometry.translate(0, 0.5, 0);
  kit.custom(leafGeometry);
  for (const [x, z] of [[-4.28, -0.95], [-3.18, 2.55], [4.12, 1.79], [3.55, -2.27]]) {
    for (let i = 0; i < 5; i += 1) {
      const a = i / 5 * TAU;
      kit.add(leafGeometry, i % 2 ? 'grass' : 'moss', [x, 0.78, z],
        [0.045, 0.3 + jitter(i + x * 4) * 0.33, 0.035],
        [Math.cos(a) * 0.34, a, Math.sin(a) * 0.34]);
    }
  }

  return {
    lanternPositions,
    footprint: {
      radiusX: 5.18,
      radiusZ: 4.62,
      platformTop: 0.81,
      eaves: 3.73,
      ridge: 4.65,
      signTop: 5.79,
    },
    notes: [
      'Closed, curved four-slope roof with 224 separate wood shingles and real rolled hip/eave timbers.',
      '19 by 19 inlaid Go board, 42 played stones, nine star points and two bowls of spare stones.',
      'Six geometry lanterns; the parent can reuse lanternPositions without adding six lights.',
      'Static and deterministic: all source geometry is registered through kit.custom for disposal.',
    ],
  };
}

export default addGoPavilionArchitecture;
