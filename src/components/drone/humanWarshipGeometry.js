import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// An original, texture-free deep-space cruiser. The +X prow follows the existing
// hit/choreography convention; both factories share that origin and need the
// same external 1.55 scale. Everything is baked into just two instanced draws.
const ARMOR = '#bccdd7';
const EDGE = '#e7eff2';
const STEEL = '#687f90';
const SIDE = '#405667';
const SEAM = '#172a38';
const THROAT = '#080f18';

function colored(geometry, color) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  if (result !== geometry) geometry.dispose();
  const c = new THREE.Color(color), colors = new Float32Array(result.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
  result.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return result;
}

function box(size, position, color, rotation = [0, 0, 0]) {
  const geometry = new THREE.BoxGeometry(...size);
  geometry.rotateX(rotation[0]); geometry.rotateY(rotation[1]); geometry.rotateZ(rotation[2]);
  geometry.translate(...position);
  return colored(geometry, color);
}

// Flat-shaded octagonal sections give real chamfers instead of stacked boxes.
// [x, halfWidth, halfHeight, centerY, centerZ]; each face retains hard normals.
function armorLoft(sections, palette = [ARMOR, EDGE, STEEL, SIDE, SIDE, STEEL, EDGE, ARMOR]) {
  const positions = [], colors = [], uvs = [];
  const rings = sections.map(([x, w, h, y = 0, z = 0]) => [
    [x, y + h, z - w * .58], [x, y + h, z + w * .58],
    [x, y + h * .43, z + w], [x, y - h * .43, z + w],
    [x, y - h, z + w * .58], [x, y - h, z - w * .58],
    [x, y - h * .43, z - w], [x, y + h * .43, z - w],
  ]);
  function triangle(a, b, c, color) {
    const value = new THREE.Color(color);
    for (const p of [a, b, c]) { positions.push(...p); colors.push(value.r, value.g, value.b); }
    uvs.push(0, 0, 0, 1, 1, 1);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < 8; j++) {
    const k = (j + 1) % 8;
    triangle(rings[i][j], rings[i][k], rings[i + 1][k], palette[j]);
    triangle(rings[i][j], rings[i + 1][k], rings[i + 1][j], palette[j]);
  }
  for (const side of [0, rings.length - 1]) {
    const ring = rings[side], [x, , , y = 0, z = 0] = sections[side], center = [x, y, z];
    for (let j = 0; j < 8; j++) {
      const k = (j + 1) % 8;
      if (side === 0) triangle(center, ring[k], ring[j], SIDE);
      else triangle(center, ring[j], ring[k], ARMOR);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function cylinder(radiusTop, radiusBottom, height, position, color, radialSegments = 10) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, 1);
  geometry.rotateZ(Math.PI / 2); geometry.translate(...position);
  return colored(geometry, color);
}

function nozzleRing(position, radius, color) {
  const geometry = new THREE.TorusGeometry(radius, .055, 4, 12);
  geometry.rotateY(Math.PI / 2); geometry.translate(...position);
  return colored(geometry, color);
}

function merge(parts, name) {
  const geometry = mergeGeometries(parts, false);
  parts.forEach(part => part.dispose());
  if (!geometry) throw new Error(`Cannot merge ${name} geometry`);
  geometry.name = name;
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.triangleCount = geometry.attributes.position.count / 3;
  return geometry;
}

export function createHumanWarshipGeometry() {
  const parts = [
    // A single continuous armoured spear, with a double-chamfered cross-section.
    armorLoft([[-4.7, 1.05, .5], [-3.8, 1.45, .71], [-.8, 1.45, .72], [2.1, 1.03, .55], [4.35, .5, .28], [6, .035, .025]],
      [STEEL, ARMOR, SIDE, SEAM, SIDE, SIDE, ARMOR, STEEL]),
    armorLoft([[-3.8, .62, .24, -.68], [.1, .68, .25, -.68], [3.7, .25, .12, -.42], [5.7, .035, .025, -.08]],
      [STEEL, STEEL, SIDE, SEAM, SEAM, SIDE, STEEL, STEEL]),
    // Swept transverse load-bearing spars, not a boat-like flat deck.
    armorLoft([[-3.3, 2.45, .19, -.12], [-2.65, 2.5, .21, -.12], [-1.7, 1.28, .15, -.12]],
      [STEEL, ARMOR, SIDE, SIDE, SEAM, SIDE, ARMOR, STEEL]),
    armorLoft([[-.8, 1.25, .14, -.12], [.25, 2.35, .16, -.12], [.75, 1.1, .12, -.12]],
      [STEEL, ARMOR, SIDE, SIDE, SEAM, SIDE, ARMOR, STEEL]),
  ];

  // Segmented pale armour sits above a dark spine; the gaps remain legible at
  // the fleet camera rather than relying on sub-pixel panel-line textures.
  const plates = [
    [-3.5, -2.25, 1.05, .76], [-2.08, -.58, 1.12, .78],
    [-.4, 1.15, .93, .72], [1.32, 2.68, .68, .57], [2.85, 4.25, .4, .4],
  ];
  for (const [rear, front, width, y] of plates) {
    parts.push(armorLoft([[rear, width, .13, y], [front, width * .67, .08, y - .11]],
      [ARMOR, EDGE, STEEL, SIDE, SIDE, STEEL, EDGE, ARMOR]));
  }

  for (const sign of [-1, 1]) {
    const z = sign * 2.08;
    // Long tapered nacelles, with rear cut-outs for a pair of engine mouths.
    parts.push(armorLoft([[-4.72, .52, .63, 0, z], [-3.7, .61, .69, 0, z], [-1.2, .52, .53, 0, z], [1.1, .34, .35, 0, z], [2.1, .06, .08, 0, z]],
      [ARMOR, EDGE, STEEL, SIDE, SEAM, SIDE, STEEL, ARMOR]));
    for (const x of [-3.5, -2.25, -1]) {
      parts.push(box([.9, .09, .62], [x, .57 + (-x - 1) * .025, z], EDGE, [0, sign * .08, 0]));
    }
    // Deep dark chambers are geometrical recesses, bounded by metal lips.
    for (const y of [-.33, .33]) {
      parts.push(cylinder(.32, .4, .58, [-4.97, y, z], STEEL, 12));
      parts.push(cylinder(.3, .3, .018, [-5.272, y, z], THROAT, 12));
      parts.push(nozzleRing([-5.29, y, z], .34, ARMOR));
    }
    // A longitudinal charcoal trench and silver rail, each several pixels long.
    parts.push(box([3.3, .16, .10], [-1.55, .18, sign * 1.43], SEAM));
    parts.push(box([2.9, .065, .12], [-1.6, .34, sign * 1.46], EDGE));
  }

  // Two-level wedge bridge follows the hull sweep, not a rectangular cabin.
  parts.push(armorLoft([[-2.8, .66, .27, 1.05], [-1.7, .73, .33, 1.09], [-.25, .45, .17, .99]],
    [ARMOR, EDGE, STEEL, SIDE, SIDE, STEEL, EDGE, ARMOR]));
  parts.push(armorLoft([[-2.5, .44, .21, 1.55], [-1.6, .47, .24, 1.56], [-.78, .27, .13, 1.4]],
    [EDGE, EDGE, STEEL, SIDE, SIDE, STEEL, EDGE, ARMOR]));

  // Two low-profile twin-barrel defence stations and one swept sensor mast.
  for (const [x, y] of [[.7, .93], [-3.55, .91]]) {
    parts.push(armorLoft([[x - .38, .31, .13, y], [x + .32, .28, .12, y], [x + .45, .15, .07, y]],
      [ARMOR, EDGE, STEEL, SIDE, SIDE, STEEL, EDGE, ARMOR]));
    for (const z of [-.14, .14]) parts.push(box([.7, .08, .08], [x + .55, y + .04, z], STEEL));
  }
  parts.push(armorLoft([[-2.49, .08, .33, 1.98], [-2.27, .09, .31, 1.91], [-2.1, .055, .12, 1.75]],
    [EDGE, EDGE, STEEL, SIDE, SIDE, STEEL, EDGE, ARMOR]));
  parts.push(box([.12, .09, .86], [-2.36, 2.18, 0], ARMOR));
  parts.push(box([.07, .27, .07], [-3.2, 1.22, -.62], EDGE));
  return merge(parts, 'FacetedHumanDeepSpaceCruiser');
}

export function createHumanWarshipEngineGeometry() {
  const parts = [];
  // Smaller cores leave the black mouths readable; no translucent flame mesh
  // or per-ship PointLight is needed for all 216 ships.
  for (const z of [-2.08, 2.08]) for (const y of [-.33, .33]) {
    parts.push(cylinder(.17, .17, .018, [-5.287, y, z], '#b4edff', 10));
    parts.push(cylinder(.075, .075, .02, [-5.3, y, z], '#ffffff', 8));
  }
  // Forward-facing bridge glazing plus long side windows and signal strips.
  parts.push(box([.055, .105, .48], [-.788, 1.43, 0], '#c4f4ff', [0, 0, -.28]));
  for (const sign of [-1, 1]) {
    parts.push(box([.93, .085, .036], [-1.82, 1.61, sign * .456], '#a0dfff', [0, sign * -.035, 0]));
    parts.push(box([1.65, .045, .055], [-1.4, .39, sign * 1.48], '#6caecb'));
    parts.push(box([.11, .08, .14], [1.1, .36, sign * 2.08], '#e7fbff'));
  }
  return merge(parts, 'CruiserEngineCoresAndObservationWindows');
}
