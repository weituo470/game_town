import { EMPTY_PLOTS, FOUNTAIN, STREETS, TREE_POSITIONS, WORLD_BOUNDS, WORLD_LOCATIONS, WORLD_SIZE } from '../../../shared/world.js';
import { GPT_BRIDGE } from '../../../shared/gpt-park.js';
import { PARK_BRIDGE } from '../../../shared/deepseek-park.js';

// The same rectangles drive the atlas, collision routing and rendered streets.
// No second hand-drawn map lives in the renderer. Ground and curbs use simple
// boxes; only nearby buildings keep their fine sculpted details.
const PRIORITY = { main: 0, ring: 1, side: 2 };
const ROAD_COLORS = {
  main: ['#b3a18a', '#b8a58e', '#b5a28c'],
  ring: ['#928a7a', '#978d7e', '#948b7b'],
  side: ['#a09a87', '#a39c89', '#a39a87'],
};
const PLOT_COLORS = { north: '#748469', south: '#78896c', east: '#6f836c', west: '#7b886a' };
const EPSILON = 0.0001;
const boundsOf = rect => ({ minX: rect.x - rect.width / 2, maxX: rect.x + rect.width / 2, minZ: rect.z - rect.depth / 2, maxZ: rect.z + rect.depth / 2 });
const contains = (rect, x, z, margin = 0) => Math.abs(x - rect.x) <= rect.width / 2 + margin && Math.abs(z - rect.z) <= rect.depth / 2 + margin;
const withinPlaza = (x, z, margin = 0) => Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) <= FOUNTAIN.plazaRadius + margin;

// Subtract overlapping rectangles before emitting paving. At intersections the
// main road wins, rather than two coplanar materials flickering over each other.
function subtractRect(rect, cutter) {
  const a = boundsOf(rect), b = boundsOf(cutter);
  const minX = Math.max(a.minX, b.minX), maxX = Math.min(a.maxX, b.maxX);
  const minZ = Math.max(a.minZ, b.minZ), maxZ = Math.min(a.maxZ, b.maxZ);
  if (maxX - minX < EPSILON || maxZ - minZ < EPSILON) return [rect];
  const parts = [
    [a.minX, minX, a.minZ, a.maxZ], [maxX, a.maxX, a.minZ, a.maxZ],
    [minX, maxX, a.minZ, minZ], [minX, maxX, maxZ, a.maxZ],
  ];
  return parts.filter(([x0, x1, z0, z1]) => x1 - x0 > EPSILON && z1 - z0 > EPSILON)
    .map(([x0, x1, z0, z1]) => ({ ...rect, x: (x0 + x1) / 2, z: (z0 + z1) / 2, width: x1 - x0, depth: z1 - z0 }));
}

function subtractIntervals(start, end, cuts) {
  let pieces = [[start, end]];
  for (const [lo, hi] of cuts) pieces = pieces.flatMap(([a, b]) => {
    if (hi <= a || lo >= b) return [[a, b]];
    return [[a, Math.min(b, lo)], [Math.max(a, hi), b]].filter(([x, y]) => y - x > 0.1);
  });
  return pieces;
}

// A street edge stops at every crossing and at the circular piazza. Therefore
// neither the old miniature wall nor a new curb cuts across a walkable junction.
function streetCurbs(street) {
  const b = boundsOf(street);
  const edges = [
    { axis: 'x', fixed: b.minZ, start: b.minX, end: b.maxX },
    { axis: 'x', fixed: b.maxZ, start: b.minX, end: b.maxX },
    { axis: 'z', fixed: b.minX, start: b.minZ, end: b.maxZ },
    { axis: 'z', fixed: b.maxX, start: b.minZ, end: b.maxZ },
  ];
  return edges.flatMap(edge => {
    const cuts = STREETS.filter(other => other.id !== street.id).flatMap(other => {
      const o = boundsOf(other);
      const inCrossing = edge.axis === 'x' ? edge.fixed > o.minZ - 0.03 && edge.fixed < o.maxZ + 0.03 : edge.fixed > o.minX - 0.03 && edge.fixed < o.maxX + 0.03;
      return inCrossing ? [[(edge.axis === 'x' ? o.minX : o.minZ) - 0.12, (edge.axis === 'x' ? o.maxX : o.maxZ) + 0.12]] : [];
    });
    const offset = edge.fixed - (edge.axis === 'x' ? FOUNTAIN.z : FOUNTAIN.x);
    if (Math.abs(offset) < FOUNTAIN.plazaRadius + 0.18) {
      const length = Math.sqrt((FOUNTAIN.plazaRadius + 0.18) ** 2 - offset ** 2);
      const center = edge.axis === 'x' ? FOUNTAIN.x : FOUNTAIN.z;
      cuts.push([center - length, center + length]);
    }
    return subtractIntervals(edge.start, edge.end, cuts).map(([a, c]) => ({
      x: edge.axis === 'x' ? (a + c) / 2 : edge.fixed,
      z: edge.axis === 'z' ? (a + c) / 2 : edge.fixed,
      width: edge.axis === 'x' ? c - a : 0.12,
      depth: edge.axis === 'z' ? c - a : 0.12,
      kind: street.kind,
    }));
  });
}

function streetLamps() {
  const lamps = [];
  const add = (x, z, height = 2.9) => {
    if (x < WORLD_BOUNDS.minX + 1.1 || x > WORLD_BOUNDS.maxX - 1.1 || z < WORLD_BOUNDS.minZ + 1.1 || z > WORLD_BOUNDS.maxZ - 1.1) return;
    if (STREETS.some(street => contains(street, x, z, 0.4)) || withinPlaza(x, z, 0.35)) return;
    if (WORLD_LOCATIONS.some(place => Math.abs(place.x - x) < 3.9 && Math.abs(place.z - z) < 3.5)) return;
    if (TREE_POSITIONS.some(([tx, tz, scale]) => Math.hypot(x - tx, z - tz) < 1.5 * scale)) return;
    if (lamps.some(lamp => Math.hypot(x - lamp.x, z - lamp.z) < 5.5)) return;
    lamps.push({ x, z, height });
  };
  // Four piazza lights orient visitors without occupying the four main exits.
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + i * Math.PI / 2;
    add(FOUNTAIN.x + Math.cos(angle) * (FOUNTAIN.plazaRadius + 0.8), FOUNTAIN.z + Math.sin(angle) * (FOUNTAIN.plazaRadius + 0.8), 3.25);
  }
  for (const street of STREETS.filter(street => street.kind !== 'side')) {
    const alongX = street.width > street.depth;
    const length = alongX ? street.width : street.depth;
    const breadth = alongX ? street.depth : street.width;
    const count = Math.max(2, Math.round(length / (street.kind === 'main' ? 16 : 18)));
    for (let i = 0; i < count; i++) for (const side of [-1, 1]) {
      const offset = -length / 2 + (i + 0.5) * length / count;
      add(street.x + (alongX ? offset : side * (breadth / 2 + 0.8)), street.z + (alongX ? side * (breadth / 2 + 0.8) : offset));
    }
  }
  return lamps;
}

export function createStreetPlan() {
  const streets = [...STREETS].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  const surfaces = [];
  streets.forEach((street, index) => {
    let pieces = [street];
    for (const previous of streets.slice(0, index)) pieces = pieces.flatMap(piece => subtractRect(piece, previous));
    surfaces.push(...pieces);
  });
  return { surfaces, curbs: STREETS.flatMap(streetCurbs), lamps: streetLamps() };
}

export function addExpandedGround(b, plan = createStreetPlan()) {
  const { centerX: x, centerZ: z, width, depth } = WORLD_SIZE;
  // Exact 3 x width and 3 x depth; the land mass is not a scaled-up avatar scene.
  b.add('box', [x, -0.71, z], [width, 1.3, depth], '#645965');
  b.add('box', [x, -1.22, z], [width - 0.15, 0.21, depth - 0.15], '#4c4655');
  b.add('box', [x, -0.18, z], [width - 0.04, 0.13, depth - 0.04], '#a18c78');
  b.add('box', [x, -0.02, z], [width - 0.2, 0.12, depth - 0.2], '#62765e');

  EMPTY_PLOTS.forEach(plot => {
    const color = PLOT_COLORS[plot.district] || '#778669';
    b.add('box', [plot.x, 0.047, plot.z], [plot.width, 0.014, plot.depth], color);
    // Flush survey edging, not fence walls: empty plots remain fully walkable.
    [-1, 1].forEach(side => {
      b.add('box', [plot.x + side * plot.width / 2, 0.065, plot.z], [0.09, 0.025, plot.depth], '#94a080');
      b.add('box', [plot.x, 0.065, plot.z + side * plot.depth / 2], [plot.width, 0.025, 0.09], '#94a080');
    });
  });

  plan.surfaces.forEach((surface, sectionIndex) => {
    const alongX = surface.width > surface.depth;
    const length = alongX ? surface.width : surface.depth;
    const sections = Math.max(1, Math.ceil(length / (surface.kind === 'main' ? 4.6 : 7)));
    const lanes = surface.kind === 'main' && Math.min(surface.width, surface.depth) > 4.1 ? 2 : 1;
    const palette = ROAD_COLORS[surface.kind];
    // Large, sparse slabs preserve clear road bands in the whole-town camera.
    // The total is hundreds of twelve-triangle boxes, not ten thousand stones.
    for (let i = 0; i < sections; i++) for (let lane = 0; lane < lanes; lane++) {
      const tileWidth = alongX ? surface.width / sections : surface.width / lanes;
      const tileDepth = alongX ? surface.depth / lanes : surface.depth / sections;
      const tx = surface.x - surface.width / 2 + tileWidth * ((alongX ? i : lane) + 0.5);
      const tz = surface.z - surface.depth / 2 + tileDepth * ((alongX ? lane : i) + 0.5);
      b.add('box', [tx, 0.068, tz], [tileWidth - 0.028, 0.055, tileDepth - 0.028], palette[(sectionIndex + i + lane) % palette.length]);
    }
  });
  plan.curbs.forEach(curb => b.add('box', [curb.x, 0.115, curb.z], [curb.width, 0.07, curb.depth], curb.kind === 'main' ? '#c1ad92' : '#aca58f'));

  // This is a flat gathering piazza. The separate landmark fountain owns every
  // basin, water jet and fountain light; it can be replaced without moving roads.
  b.add('plaza', [FOUNTAIN.x, 0.077, FOUNTAIN.z], [FOUNTAIN.plazaRadius + 0.16, 0.075, FOUNTAIN.plazaRadius + 0.16], '#c2ad94');
  b.add('plaza', [FOUNTAIN.x, 0.109, FOUNTAIN.z], [FOUNTAIN.plazaRadius - 0.14, 0.022, FOUNTAIN.plazaRadius - 0.14], '#b3a08b');
  [FOUNTAIN.plazaRadius - 0.6, FOUNTAIN.radius + 1.7].forEach(radius => b.add('inlay', [FOUNTAIN.x, 0.132, FOUNTAIN.z], [radius, radius, 0.12], '#cdbb96', [Math.PI / 2, 0, 0], 'gold'));
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    const inner = FOUNTAIN.radius + 1.8, outer = FOUNTAIN.plazaRadius - 0.63;
    const distance = (inner + outer) / 2;
    b.add('box', [FOUNTAIN.x + Math.sin(a) * distance, 0.126, FOUNTAIN.z + Math.cos(a) * distance], [0.035, 0.009, outer - inner], '#a6927d', [0, a, 0]);
  }

  // Four low continuous parapets sit outside the authoritative walk boundary.
  // There are no leftover miniature-town walls or steps across the new streets.
  const { minX, maxX, minZ, maxZ } = WORLD_BOUNDS;
  const edgeWidth = maxX - minX, edgeDepth = maxZ - minZ;
  for (const edgeX of [minX - 0.3, maxX + 0.3]) {
    // Openings align with the two island gangways at z=22.
    const pieces = edgeX < 0 ? [[minZ - 0.6, -5.6], [-2.4, 19.8], [24.2, maxZ + 0.6]] : [[minZ - 0.6, 19.8], [24.2, maxZ + 0.6]];
    for (const [start, end] of pieces) {
      b.add('box', [edgeX, 0.18, (start + end) / 2], [0.6, 0.34, end - start], '#9c9985');
      b.add('box', [edgeX, 0.38, (start + end) / 2], [0.66, 0.09, end - start], '#b2ab91');
    }
  }
  for (const edgeZ of [minZ - 0.3, maxZ + 0.3]) {
    // The northeast bridge must be an opening, not a cosmetic bridge behind a wall.
    const pieces = edgeZ < 0 ? subtractIntervals(minX, maxX, [
      [-2.2, 2.2],
      [GPT_BRIDGE.x - GPT_BRIDGE.width / 2 - 0.2, GPT_BRIDGE.x + GPT_BRIDGE.width / 2 + 0.2],
      [PARK_BRIDGE.x - PARK_BRIDGE.width / 2 - 0.2, PARK_BRIDGE.x + PARK_BRIDGE.width / 2 + 0.2],
    ]) : [[minX, maxX]];
    for (const [start, end] of pieces) {
      b.add('box', [(start + end) / 2, 0.18, edgeZ], [end - start, 0.34, 0.6], '#9c9985');
      b.add('box', [(start + end) / 2, 0.38, edgeZ], [end - start, 0.09, 0.66], '#b2ab91');
    }
  }
  return plan;
}
