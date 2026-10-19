// Original point sculptures. Every actor is sampled at its actual point budget;
// no strided extraction from a larger spiral and no connected line geometry.
export const AI_DRONE_ACTOR_KINDS = Object.freeze(['whale', 'phoenix', 'dragon', 'lantern', 'lotus', 'butterfly', 'city', 'planet', 'portal', 'comet', 'tree']);
const TAU = Math.PI * 2, GOLDEN = Math.PI * (3 - Math.sqrt(5));
const clamp = x => Math.max(0, Math.min(1, x));
const fract = x => x - Math.floor(x);
const mix = (a, b, t) => a + (b - a) * t;
const surface = (weight, sample, part = 0) => ({ weight, sample, part });
const ellipse = (center, radii, accent = .1) => (t, i) => {
  const y = 1 - 2 * t, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * GOLDEN;
  return [center[0] + Math.cos(a) * r * radii[0], center[1] + y * radii[1], center[2] + Math.sin(a) * r * radii[2], accent, 0];
};
const tube = (curve, radius, accent = .5) => (t, i) => {
  const a = i * GOLDEN, c = curve(t), before = curve(Math.max(0, t - .002)), after = curve(Math.min(1, t + .002));
  const tangent = after.map((value, axis) => value - before[axis]), length = Math.hypot(...tangent) || 1;
  for (let axis = 0; axis < 3; axis++) tangent[axis] /= length;
  const reference = Math.abs(tangent[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
  const n = [tangent[1] * reference[2] - tangent[2] * reference[1], tangent[2] * reference[0] - tangent[0] * reference[2], tangent[0] * reference[1] - tangent[1] * reference[0]];
  const nl = Math.hypot(...n) || 1; for (let axis = 0; axis < 3; axis++) n[axis] /= nl;
  const b = [tangent[1] * n[2] - tangent[2] * n[1], tangent[2] * n[0] - tangent[0] * n[2], tangent[0] * n[1] - tangent[1] * n[0]];
  const r = typeof radius === 'function' ? radius(t) : radius;
  return [...c.map((value, axis) => value + r * (n[axis] * Math.cos(a) + b[axis] * Math.sin(a))), typeof accent === 'function' ? accent(t) : accent, t];
};
const torus = (radius, thickness, center, tilt = 0, accent = .75) => (t, i) => {
  const a = t * TAU, b = i * GOLDEN, r = radius + Math.cos(b) * thickness;
  const x = Math.cos(a) * r, y = Math.sin(a) * r, z = Math.sin(b) * thickness;
  return [center[0] + x, center[1] + y * Math.cos(tilt) - z * Math.sin(tilt), center[2] + y * Math.sin(tilt) + z * Math.cos(tilt), accent, t];
};
const box = (center, size, accent = .25) => (t, i) => {
  const face = i % 6, local = Math.floor(i / 6), u = fract(local * .61803398875) - .5, v = fract(local * .41421356237) - .5;
  const axis = Math.floor(face / 2), p = [u, v, u]; p[axis] = face % 2 ? .5 : -.5;
  p[(axis + 1) % 3] = u; p[(axis + 2) % 3] = v;
  const window = face < 4 && Math.abs(fract((p[1] + .5) * 8) - .5) < .18 && Math.abs(fract((p[0] + .5) * 4) - .5) < .25;
  return p.map((value, index) => center[index] + value * size[index]).concat(window ? .95 : accent, 0);
};
function whale() {
  const parts = [surface(.60, (t, i) => {
    const a = i * GOLDEN, r = 18 * Math.sin(t * Math.PI) ** .42 * (1 - .63 * t * t), x = -58 + t * 111;
    const y = Math.cos(a) * r, z = Math.sin(a) * r * .83;
    return [x, y * .921 - z * .389, y * .389 + z * .921, .08 + .82 * clamp((-y + 2) / 16), clamp((x + 10) / 64)];
  }, 1)];
  for (const side of [-1, 1]) {
    parts.push(surface(.068, (t, i) => { const a = i * GOLDEN, w = 9 * Math.sin(t * Math.PI) ** .6;
      const y = -7 - t * 25 + Math.sin(a) * 1.7, z = side * (10 + t * 17 + Math.sin(a) * w * .34);
      return [-20 + t * 31 + Math.cos(a) * w, y * .921 - z * .389, y * .389 + z * .921, .35 + .6 * t, t]; }, 2));
    parts.push(surface(.078, (t, i) => { const a = i * GOLDEN, w = 8.5 * Math.sin(t * Math.PI) ** .65;
      return [49 + t * 17 + Math.cos(a) * w, Math.sin(t * Math.PI) * 3 + Math.sin(a) * w * .22, side * (t * 27 + Math.sin(a) * w * .7), .25 + .7 * t, 1]; }, 1));
  }
  parts.push(surface(.027, tube(t => [8 + t * 8, 11 + t * 15, -1], t => 3 * (1 - t) + .2, .7)),
    surface(.008, ellipse([-43, 4, 13], [1, .7, .55], 1)),
    surface(.014, tube(t => [-54 + t * 20, -4 - t, 4 + Math.sin(t * Math.PI / 2) * 9], .45, .9)),
    surface(.059, (t, i) => { const row = i % 5, u = fract(t * 1.001);
      return [-43 + u * 45, -12 - Math.sin(u * Math.PI) * 5 + row * .8, 6 + row * 1.3, .88, 0]; }));
  return parts;
}
function phoenix() {
  const parts = [surface(.12, ellipse([0, -3, 0], [8, 18, 7], .12)),
    surface(.04, tube(t => [-1 + t * 9 + Math.sin(t * TAU) * 3, 10 + t * 20, 2], t => 3.8 - t * 1.1, .4)),
    surface(.045, ellipse([8, 31, 2], [6.8, 5.5, 4.8], .55)),
    surface(.025, tube(t => [13 + t * 15, 30 - t * 3, 2], t => 2.6 * (1 - t) + .1, .95)),
    surface(.006, ellipse([10.2, 32.7, 6.8], [1, .7, .5], 1))];
  for (const side of [-1, 1]) {
    parts.push(surface(.265, (t, i, n) => {
      const feather = i % 14, step = Math.floor(i / 14), u = (step + .5) / Math.ceil(n / 14), a = step * GOLDEN;
      const s = Math.min(feather, 9) / 9, tipX = [18,25,33,42,51,59,66,72,77,72,64,55,45,35][feather];
      const tipY = [-13,-16,-17,-15,-11,-6,1,9,18,25,30,31,28,24][feather], width = 2.3 * Math.sin(u * Math.PI) ** .65;
      const x = side * (mix(8 + s * 29, tipX, u) + Math.cos(a) * width);
      return [x, mix(10 + Math.sin(s * Math.PI * .85) * 13, tipY, u) + Math.sin(u * Math.PI) * 3 + Math.sin(a) * width * .65,
        -3 + Math.sin(u * Math.PI) * 5 - s * 5 + Math.sin(a) * width, .16 + .84 * u * u, clamp((Math.abs(x) - 8) / 69)];
    }, 3));
  }
  parts.push(surface(.20, (t, i, n) => { const feather = i % 5, step = Math.floor(i / 5), u = (step + .5) / Math.ceil(n / 5), side = feather - 2, a = step * GOLDEN;
    const w = (3.8 + Math.abs(side) * .4) * Math.sin(u * Math.PI) ** .6;
    return [side * (1.3 + u * 10.7) + Math.cos(a) * w + Math.sin(u * Math.PI * 1.35) * side * 5,
      -14 - u * (48 - Math.abs(side) * 4) + Math.sin(a) * w * .3, 1 + Math.sin(u * Math.PI) * 10 + Math.sin(a) * w * .9, .16 + .82 * u * u, u]; }, 4),
    surface(.034, (t, i, n) => { const feather = i % 5, u = (Math.floor(i / 5) + .5) / Math.ceil(n / 5);
      return [4 - u * (12 + feather * 2), 34 + Math.sin(u * Math.PI / 2) * (6 + feather * 2.2), -1 + (feather - 2) * .85, .8, u]; }));
  return parts;
}
function dragon() {
  const spine = t => [-45 + t * 100, Math.sin(t * TAU * 1.3) * 15, Math.cos(t * TAU * 1.3) * 9];
  const parts = [surface(.52, tube(spine, t => 8 * (1 - .78 * t) + .4, t => .15 + .3 * t), 1),
    surface(.13, ellipse([-51, 10, 5], [13, 9, 10], .2)), surface(.065, ellipse([-63, 7, 7], [10, 5, 7], .45)),
    surface(.008, ellipse([-56, 13, 15], [1.4, 1, .5], 1))];
  for (const side of [-1, 1]) {
    parts.push(surface(.025, tube(t => [-48 + t * 8, 17 + t * 20, side * (5 + t * 5)], t => 2.5 * (1 - t) + .15, .9)),
      surface(.025, tube(t => [-65 - t * 14, 7 + Math.sin(t * Math.PI) * 12, side * (5 + t * 8)], .65, .85)));
    for (const at of [.23, .58]) {
      const c = spine(at);
      parts.push(surface(.03, tube(t => [c[0] - t * 8, c[1] - t * 18, c[2] + side * t * 13], t => 3 * (1 - t) + .7, .6), 2));
    }
  }
  parts.push(surface(.077, (t, i) => { const c = spine(t), spike = Math.sin(fract(t * 20) * Math.PI) * 6;
    return [c[0], c[1] + 6 + spike, c[2], .95, t]; }));
  return parts;
}
function lantern() {
  const parts = [surface(.66, (t, i) => { const a = i * GOLDEN, r = 22 * Math.sin(t * Math.PI) ** .42, rib = Math.abs(Math.sin(a * 6)) < .12;
    return [Math.cos(a) * r, -22 + t * 47, Math.sin(a) * r * .8, rib ? .95 : .08 + .25 * Math.sin(t * Math.PI), t]; }),
    surface(.06, torus(12, 2.2, [0, 25, 0], Math.PI / 2, .9)), surface(.06, torus(12, 2.1, [0, -23, 0], Math.PI / 2, .9)),
    surface(.05, tube(t => [0, 27 + t * 17, 0], .8, .9))];
  for (let strand = -2; strand <= 2; strand++) parts.push(surface(.034, tube(t => [strand * 2.4 + Math.sin(t * Math.PI) * strand, -24 - t * (24 - Math.abs(strand) * 3), 2 * Math.cos(t * Math.PI)], t => 1.4 * (1 - t) + .3, .9), 4));
  return parts;
}
function lotus() {
  const parts = [surface(.12, ellipse([0, 4, 0], [12, 7, 12], .8)), surface(.08, tube(t => [Math.sin(t * Math.PI) * 6, -42 + t * 39, 0], t => 2.4 - t * .8, .25))];
  for (let layer = 0; layer < 2; layer++) for (let petal = 0; petal < (layer ? 7 : 10); petal++) {
    const angle = petal / (layer ? 7 : 10) * TAU + layer * .2;
    parts.push(surface(layer ? .045 : .0485, (t, i) => {
      const u = t, v = fract(i * .61803398875) * 2 - 1, width = Math.sin(u * Math.PI) ** .7 * (layer ? 8 : 11), radial = 4 + u * (layer ? 26 : 39);
      return [Math.cos(angle) * radial - Math.sin(angle) * v * width, -5 + Math.sin(u * Math.PI * .76) * (layer ? 32 : 24) + (1 - v * v) * 2.5,
        Math.sin(angle) * radial + Math.cos(angle) * v * width, .2 + .65 * u, u];
    }, 5));
  }
  return parts;
}
function butterfly() {
  const parts = [surface(.10, ellipse([0, -1, 0], [3.8, 23, 5], .75)), surface(.035, ellipse([0, 23, 1], [5, 5, 5], .4))];
  for (const side of [-1, 1]) {
    parts.push(surface(.025, tube(t => [side * (2 + t * 11), 25 + t * 16, 2], t => .8 * (1 - t) + .3, .9)));
    for (const upper of [true, false]) parts.push(surface(upper ? .23 : .1775, (t, i) => {
      const v = 1 - 2 * t, r = Math.sqrt(Math.max(0, 1 - v * v)), a = i * GOLDEN;
      const x = side * ((upper ? 25 : 21) + Math.cos(a) * r * (upper ? 25 : 21));
      return [x, (upper ? 15 : -20) + v * (upper ? 24 : 20), Math.sin(a) * r * 5 + Math.abs(x) * .11,
        Math.sin(a * 3 + t * 13) > .4 ? .9 : .16 + .2 * t, Math.min(1, Math.abs(x) / 50)];
    }, 3));
  }
  return parts;
}
function city() {
  const parts = [surface(.12, box([0, -30, -2], [108, 4, 35], .75))];
  const towers = [[-43,32,13,-5],[-24,48,14,8],[-5,38,15,-2],[17,66,14,-8],[38,44,16,5]];
  for (const [x, height, width, z] of towers) {
    parts.push(surface(.155, box([x, -28 + height / 2, z], [width, height, 16], .15)));
    parts.push(surface(.021, tube(t => [x, -28 + height + t * (height > 50 ? 13 : 5), z], .8, .9)));
  }
  return parts;
}
function planet() {
  return [surface(.67, (t, i) => { const p = ellipse([0, 2, 0], [29, 29, 29], .1)(t, i);
    p[3] = Math.sin(p[0] * .16 + Math.sin(p[1] * .2)) + Math.cos(p[2] * .19 + p[1] * .1) > .5 ? .72 : .12; return p; }),
  surface(.33, (t, i) => { const a = t * TAU, r = 39 + fract(i * .61803398875) * 12, x = Math.cos(a) * r, z = Math.sin(a) * r;
    return [x, 2 + z * .28 + Math.sin(i * GOLDEN) * 1.1, z * .85, .82, t]; }, 6)];
}
function portal() {
  return [surface(.38, torus(45, 3.3, [0, 0, 0], .22, .2), 6), surface(.27, torus(32, 2.7, [0, 0, 0], 1.05, .7), 6),
    surface(.20, (t, i) => { const p = torus(23, 2.1, [0, 0, 0], -.7, .9)(t, i); return [p[2], p[1], p[0], p[3], t]; }, 6),
    surface(.15, ellipse([0, 0, 0], [11, 11, 11], .95))];
}
function comet() {
  const parts = [surface(.30, ellipse([-30, 5, 0], [17, 13, 13], .88))];
  for (let strand = -2; strand <= 2; strand++) parts.push(surface(.14, tube(t => [-17 + t * 78, 5 + strand * t * 5 + Math.sin(t * Math.PI) * 7, strand * t * 5], t => (3.8 - t * 3) * Math.sin((t * .94 + .03) * Math.PI) ** .3, t => .85 - t * .7), 4));
  return parts;
}
function tree() {
  const parts = [surface(.15, tube(t => [Math.sin(t * Math.PI) * 5, -42 + t * 64, 0], t => 5 * (1 - t) + 1.5, .7))];
  const crowns = [[0,32,0,23],[-24,18,4,22],[25,22,-3,22],[-11,40,-8,18],[17,42,8,17]];
  for (const [x, y, z, r] of crowns) {
    parts.push(surface(.145, ellipse([x, y, z], [r, r * .8, r * .72], .18)));
    parts.push(surface(.025, tube(t => [x * t, -1 + t * (y + 1), z * t], t => 2.5 * (1 - t) + .5, .65)));
  }
  return parts;
}
const FACTORIES = { whale, phoenix, dragon, lantern, lotus, butterfly, city, planet, portal, comet, tree };
const cache = new Map();
/** Model data chooses only a checked kind and palette; never executable geometry. */
export function createAiDroneActorGeometry(kind, count) {
  if (!Object.hasOwn(FACTORIES, kind) || !Number.isInteger(count) || count < 64 || count > 4096) throw new TypeError('Invalid volumetric actor budget');
  const key = `${kind}:${count}`; if (cache.has(key)) return cache.get(key);
  const components = FACTORIES[kind](), total = components.reduce((sum, item) => sum + item.weight, 0);
  const allocations = components.map(item => Math.max(1, Math.floor(count * item.weight / total)));
  for (let missing = count - allocations.reduce((sum, value) => sum + value, 0), i = 0; missing > 0; missing--, i++) allocations[i % allocations.length]++;
  const points = new Float32Array(count * 3), accents = new Float32Array(count), parts = new Uint8Array(count), weights = new Float32Array(count);
  let offset = 0;
  for (let component = 0; component < components.length; component++) {
    const n = allocations[component], entry = components[component];
    for (let local = 0; local < n; local++) {
      const id = offset + local, point = entry.sample((local + .5) / n, local, n);
      points.set(point.slice(0, 3), id * 3); accents[id] = clamp(point[3]); parts[id] = entry.part; weights[id] = clamp(point[4] || 0);
    }
    offset += n;
  }
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < count; i++) for (let axis = 0; axis < 3; axis++) { const value = points[i * 3 + axis]; bounds.min[axis] = Math.min(bounds.min[axis], value); bounds.max[axis] = Math.max(bounds.max[axis], value); }
  // Keep recognisable proportions but give the layout compiler one predictable
  // size envelope. Detailed whale/phoenix silhouettes remain original shapes.
  const scale = 112 / Math.max(...bounds.max.map((value, axis) => value - bounds.min[axis]));
  for (let i = 0; i < points.length; i++) points[i] *= scale;
  bounds.min = bounds.min.map(value => value * scale); bounds.max = bounds.max.map(value => value * scale);
  const result = Object.freeze({ kind, count, points, accents, parts, weights, bounds: Object.freeze({ min: Object.freeze(bounds.min), max: Object.freeze(bounds.max) }) });
  // A bounded cache protects repeated imported/generated programmes with many
  // allocations while preserving all objects currently held by live runtimes.
  if (cache.size >= 96) cache.delete(cache.keys().next().value);
  cache.set(key, result); return result;
}
