import * as THREE from 'three';
import { CharacterBuilder, clothMaterial, basicMaterial } from './CharacterKit.js';

// All of the shapes are real, closed (or overlapping) geometry.  In particular the
// bill is a curved, thickened surface, not a disc stuck to the front of the hat.
function capPanel(start, end, rx = 0.91, ry = 0.72, rz = 0.77) {
  const rows = 22;
  const columns = Math.max(16, Math.ceil((end - start) * 22));
  const positions = [];
  const uv = [];
  const indices = [];
  for (let y = 0; y <= rows; y += 1) {
    const phi = (y / rows) * Math.PI / 2;
    for (let x = 0; x <= columns; x += 1) {
      const theta = start + (end - start) * x / columns;
      positions.push(rx * Math.sin(phi) * Math.sin(theta), ry * Math.cos(phi), rz * Math.sin(phi) * Math.cos(theta));
      uv.push(x / columns, y / rows);
    }
  }
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const a = y * (columns + 1) + x;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function billPoint(angle, reach, underside = false) {
  const fullness = Math.cos(angle / 1.16 * Math.PI / 2);
  const x = (0.91 + reach * 0.11 * fullness) * Math.sin(angle);
  const z = 0.77 * Math.cos(angle) + reach * 0.59 * fullness;
  const y = 3.325 - reach * 0.135 * fullness + 0.045 * Math.sin(angle) ** 2 - (underside ? 0.062 : 0);
  return [x, y, z];
}

function capBill() {
  const around = 48;
  const across = 9;
  const positions = [];
  const uv = [];
  const indices = [];
  const layerSize = (around + 1) * (across + 1);
  for (let layer = 0; layer < 2; layer += 1) {
    for (let j = 0; j <= across; j += 1) {
      for (let i = 0; i <= around; i += 1) {
        positions.push(...billPoint(-1.16 + 2.32 * i / around, j / across, layer === 1));
        uv.push(i / around, j / across);
      }
    }
  }
  for (let layer = 0; layer < 2; layer += 1) {
    for (let j = 0; j < across; j += 1) {
      for (let i = 0; i < around; i += 1) {
        const a = layer * layerSize + j * (around + 1) + i;
        const b = a + around + 1;
        if (layer === 0) indices.push(a, b, a + 1, a + 1, b, b + 1);
        else indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  // A separate boundary ring gives the cap bill its tactile rolled edge.
  const boundary = [];
  for (let i = 0; i <= around; i += 1) boundary.push(i);
  for (let j = 1; j <= across; j += 1) boundary.push(j * (around + 1) + around);
  for (let i = around - 1; i >= 0; i -= 1) boundary.push(across * (around + 1) + i);
  for (let j = across - 1; j > 0; j -= 1) boundary.push(j * (around + 1));
  for (let i = 0; i < boundary.length; i += 1) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    indices.push(a, b, a + layerSize, b, b + layerSize, a + layerSize);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function fringe(points, depth = 0.105) {
  const shape = new THREE.Shape();
  shape.moveTo(...points[0]);
  for (let i = 1; i < points.length; i += 3) {
    shape.bezierCurveTo(...points[i], ...points[i + 1], ...points[i + 2]);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.045,
    bevelSize: 0.035,
    bevelSegments: 4,
    curveSegments: 14,
  });
  // The rounded cap gets narrower above its band. Tuck the hair roots inside
  // that actual ellipsoid rather than letting flat extrusions pierce its panels.
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i) + 0.515;
    if (y < 3.325) continue;
    const available = Math.max(0.001, 1 - ((y - 3.325) / 0.72) ** 2);
    const radial = (x / 0.91) ** 2 + (z / 0.77) ** 2;
    const inside = available * 0.91;
    if (radial > inside) {
      const factor = Math.sqrt(inside / radial);
      positions.setXYZ(i, x * factor, y, z * factor - 0.515);
    }
  }
  // Keep the bevel roots below the crown/bill join as well. A long extruded
  // triangle can otherwise cross that join even when its upper vertices are tucked.
  for (let i = 0; i < positions.count; i += 1) {
    positions.setY(i, Math.min(positions.getY(i), 3.285));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function softLathe(profile, radialSegments = 48, profileSegments = 36) {
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const points = curve.getPoints(profileSegments);
  for (const point of points) point.x = Math.max(0, point.x);
  return new THREE.LatheGeometry(points, radialSegments);
}

function shoeSole() {
  const outline = new THREE.Shape();
  outline.absellipse(0, 0, 0.282, 0.427, 0, Math.PI * 2, false, 0);
  return new THREE.ExtrudeGeometry(outline, {
    depth: 0.08, bevelEnabled: true, bevelThickness: 0.02,
    bevelSize: 0.012, bevelSegments: 3, steps: 1, curveSegments: 32,
  });
}

function cheekPatch() {
  const segments = 40;
  const rings = 5;
  const positions = [0, 0, 0.013];
  const colors = [];
  const indices = [];
  const center = new THREE.Color('#ed9b83');
  const outside = new THREE.Color('#f3cba4');
  colors.push(center.r, center.g, center.b);
  for (let ring = 1; ring <= rings; ring += 1) {
    const t = ring / rings;
    const color = center.clone().lerp(outside, t ** 1.8);
    for (let i = 0; i < segments; i += 1) {
      const angle = i / segments * Math.PI * 2;
      positions.push(Math.cos(angle) * 0.145 * t, Math.sin(angle) * 0.12 * t, 0.013 * (1 - t * t));
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let i = 0; i < segments; i += 1) indices.push(0, 1 + i, 1 + (i + 1) % segments);
  for (let ring = 1; ring < rings; ring += 1) {
    const start = 1 + (ring - 1) * segments;
    const next = start + segments;
    for (let i = 0; i < segments; i += 1) {
      const ni = (i + 1) % segments;
      indices.push(start + i, next + i, start + ni, start + ni, next + i, next + ni);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createCapBoy() {
  const b = new CharacterBuilder();
  const skin = basicMaterial('#f3cba4', { roughness: 0.79 });
  const hair = basicMaterial('#623724', { roughness: 0.79 });
  const expression = basicMaterial('#66372e', { roughness: 0.76 });
  const cream = clothMaterial('#f4e5c7', { scale: 1.1 });
  const blue = clothMaterial('#416a83', { scale: 1.2 });
  const seam = clothMaterial('#7192a3', { scale: 1.1 });
  const pants = clothMaterial('#795039', { scale: 1.3 });
  const leather = basicMaterial('#8d593a', { roughness: 0.83 });
  const sole = basicMaterial('#573a2c', { roughness: 0.9 });
  const cheeks = basicMaterial('#ffffff', { vertexColors: true, roughness: 0.88 });

  // Wide boots and slightly gathered trousers anchor the top-heavy toy silhouette.
  for (const side of [-1, 1]) {
    const x = side * 0.305;
    b.add(shoeSole(), sole, [x, 0.10, 0.12], [1, 1, 1], [Math.PI / 2, 0, 0]);
    b.ellipsoid([x, 0.228, 0.12], [0.283, 0.207, 0.425], leather);
    b.ellipsoid([x, 0.335, -0.055], [0.222, 0.195, 0.249], leather);
    b.add(softLathe([
      [0, 0.40], [0.18, 0.40], [0.235, 0.42], [0.26, 0.48],
      [0.285, 0.60], [0.315, 0.82], [0.31, 1.04], [0.25, 1.19], [0, 1.21],
    ], 40, 32), pants, [x, 0, -0.015], [1, 1, 0.96], [0, 0, -side * 0.012]);
    b.add(new THREE.TorusGeometry(0.237, 0.022, 8, 40), pants, [x, 0.436, -0.015], [1, 0.96, 1], [Math.PI / 2, 0, 0]);
    // The welt and toe stitching continue around the heel instead of ending at the front.
    const welt = [];
    for (let j = 0; j <= 20; j += 1) {
      const a = j / 20 * Math.PI * 2;
      welt.push([x + Math.cos(a) * 0.274, 0.119, 0.12 + Math.sin(a) * 0.414]);
    }
    b.tube(welt, 0.009, leather, 5);
    const toe = [];
    for (let j = 0; j <= 10; j += 1) {
      const a = -Math.PI * 0.43 + j / 10 * Math.PI * 0.86;
      const localX = Math.sin(a) * 0.228;
      const z = 0.22 + Math.cos(a) * 0.273;
      const y = 0.232 + 0.207 * Math.sqrt(Math.max(0, 1 - (localX / 0.283) ** 2 - ((z - 0.12) / 0.425) ** 2));
      toe.push([x + localX, y, z]);
    }
    b.tube(toe, 0.006, sole, 5);
    b.ellipsoid([x, 0.49, 0.226], [0.205, 0.024, 0.024], pants);
  }
  b.roundBox([0, 1.12, -0.025], [1.05, 0.34, 0.57], 0.16, pants);

  const torso = [
    [0, 1.145], [0.44, 1.145], [0.59, 1.18], [0.65, 1.29],
    [0.65, 1.49], [0.59, 1.86], [0.49, 2.13], [0.35, 2.27], [0, 2.29],
  ];
  b.add(softLathe(torso, 56, 42), cream, [0, 0, 0], [1, 1, 0.78]);
  const hem = [
    [0, 1.12], [0.58, 1.12], [0.65, 1.145], [0.662, 1.205],
    [0.65, 1.265], [0.61, 1.28], [0, 1.28],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  b.add(new THREE.LatheGeometry(hem, 64), blue, [0, 0, 0], [1, 1, 0.78]);
  for (let j = 0; j < 56; j += 1) {
    const a = j / 56 * Math.PI * 2;
    b.tube([
      [Math.sin(a) * 0.651, 1.145, Math.cos(a) * 0.508],
      [Math.sin(a) * 0.664, 1.205, Math.cos(a) * 0.519],
      [Math.sin(a) * 0.652, 1.255, Math.cos(a) * 0.509],
    ], 0.004, seam, 4);
  }
  b.add(new THREE.TorusGeometry(0.325, 0.065, 12, 56), blue, [0, 2.25, 0.008], [1, 0.9, 1], [Math.PI / 2, 0, 0]);
  b.ellipsoid([0, 2.29, 0], [0.26, 0.18, 0.235], skin);
  for (const side of [-1, 1]) {
    // A swept, softly tapered sleeve has no box faces or hard shoulder planes.
    b.add(softLathe([
      [0, -0.49], [0.14, -0.49], [0.195, -0.46], [0.22, -0.38],
      [0.255, -0.19], [0.275, 0.04], [0.262, 0.23], [0.21, 0.39],
      [0.11, 0.46], [0, 0.48],
    ], 40, 32), cream, [side * 0.65, 1.83, 0], [1, 1, 0.95], [0, 0, side * 0.32]);
    b.add(softLathe([
      [0, -0.085], [0.16, -0.085], [0.205, -0.075], [0.223, -0.04],
      [0.228, 0.025], [0.217, 0.072], [0.18, 0.085], [0, 0.085],
    ], 40, 22), blue, [side * 0.786, 1.416, 0], [1, 1, 0.96], [0, 0, side * 0.32]);
    b.ellipsoid([side * 0.845, 1.235, 0.012], [0.18, 0.225, 0.19], skin);
    b.ellipsoid([side * 0.72, 1.24, 0.135], [0.082, 0.115, 0.09], skin);
  }

  // A softly squared face rather than a sphere keeps the reference's plush-toy proportions.
  b.roundBox([0, 2.875, 0.015], [1.59, 1.33, 1.23], 0.455, skin);
  b.ellipsoid([0, 3.19, -0.40], [0.77, 0.46, 0.285], hair);
  for (const side of [-1, 1]) {
    b.ellipsoid([side * 0.812, 2.83, 0.002], [0.212, 0.255, 0.165], skin);
    b.ellipsoid([side * 0.718, 3.205, 0.035], [0.16, 0.34, 0.43], hair);
  }

  const bangs = [
    [[-0.72, 3.39], [-0.58, 3.51], [-0.39, 3.52], [-0.35, 3.4], [-0.44, 3.23], [-0.58, 3.14], [-0.66, 3.16], [-0.73, 3.20], [-0.75, 3.33], [-0.72, 3.39]],
    [[-0.45, 3.49], [-0.29, 3.57], [-0.11, 3.53], [-0.08, 3.39], [-0.15, 3.22], [-0.31, 3.15], [-0.39, 3.19], [-0.48, 3.25], [-0.5, 3.42], [-0.45, 3.49]],
    [[-0.15, 3.49], [0.01, 3.56], [0.2, 3.55], [0.23, 3.43], [0.24, 3.31], [0.21, 3.23], [0.14, 3.24], [0.02, 3.27], [-0.1, 3.39], [-0.15, 3.49]],
    [[0.14, 3.51], [0.33, 3.53], [0.46, 3.49], [0.48, 3.37], [0.51, 3.24], [0.48, 3.15], [0.40, 3.18], [0.29, 3.22], [0.2, 3.39], [0.14, 3.51]],
    [[0.42, 3.43], [0.59, 3.47], [0.72, 3.4], [0.74, 3.27], [0.78, 3.13], [0.74, 3.04], [0.67, 3.10], [0.54, 3.18], [0.46, 3.32], [0.42, 3.43]],
  ];
  for (const points of bangs) b.add(fringe(points), hair, [0, 0, 0.515]);
  // Short sideburns remain visible below the cap from profile views.
  for (const side of [-1, 1]) {
    b.roundBox([side * 0.724, 3.035, 0.40], [0.15, 0.36, 0.18], 0.07, hair, [0, 0, side * 0.17]);
    b.ellipsoid([side * 0.302, 2.92, 0.637], [0.085, 0.177, 0.035], expression);
    b.add(cheekPatch(), cheeks, [side * 0.443, 2.68, 0.616], [1, 1, 1], [0, side * 0.14, 0]);
  }
  b.ellipsoid([0, 2.758, 0.649], [0.031, 0.037, 0.024], skin);
  b.tube([
    [-0.078, 2.675, 0.637], [-0.056, 2.635, 0.644],
    [0, 2.62, 0.647], [0.056, 2.635, 0.644], [0.078, 2.675, 0.637],
  ], 0.009, expression, 7);

  const creamEdge = Math.PI * 0.345;
  b.add(capPanel(-creamEdge, creamEdge), cream, [0, 3.325, 0]);
  b.add(capPanel(creamEdge, Math.PI * 2 - creamEdge), blue, [0, 3.325, 0]);
  b.add(capBill(), blue);
  const edge = [];
  const stitching = [];
  for (let j = 0; j <= 20; j += 1) {
    const a = -1.16 + 2.32 * j / 20;
    const p = billPoint(a, 1);
    edge.push([p[0], p[1] - 0.025, p[2]]);
    const s = billPoint(a, 0.87);
    stitching.push([s[0], s[1] + 0.007, s[2]]);
  }
  b.tube(edge, 0.023, blue, 8);
  b.tube(stitching, 0.006, seam, 5);
  for (const angle of [-creamEdge, 0, creamEdge, Math.PI, Math.PI * 0.70, -Math.PI * 0.70]) {
    const points = [];
    for (let j = 0; j <= 10; j += 1) {
      const a = 0.06 + (Math.PI / 2 - 0.06) * j / 10;
      points.push([
        0.915 * Math.sin(a) * Math.sin(angle),
        3.325 + 0.724 * Math.cos(a),
        0.775 * Math.sin(a) * Math.cos(angle),
      ]);
    }
    b.tube(points, angle === 0 ? 0.008 : 0.009, Math.abs(angle) <= creamEdge ? cream : seam, 6);
  }
  // Back-band stitching and a subtle adjustment tab make the reverse view finished.
  const band = [];
  for (let j = 0; j <= 20; j += 1) {
    const a = creamEdge + (Math.PI * 2 - 2 * creamEdge) * j / 20;
    band.push([0.905 * Math.sin(a), 3.347, 0.766 * Math.cos(a)]);
  }
  b.tube(band, 0.012, seam, 5);
  b.roundBox([0, 3.35, -0.776], [0.27, 0.075, 0.031], 0.015, blue);
  b.ellipsoid([0, 4.058, 0], [0.10, 0.046, 0.087], blue);

  const model = b.build('CapBoy');
  model.userData.character = 'cap-boy';
  model.userData.displayName = '阿蓝';
  model.userData.reference = 'Blue and cream baseball cap, plush ivory sweater, brown trousers';
  return model;
}
