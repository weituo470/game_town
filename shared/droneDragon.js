/**
 * Original electric-blue dragon artwork made from the show's real emitters.
 * Facing +Z: long muzzle on the left, swept membrane wings, curled tail right.
 * No texture, billboard, downloaded outline or additional particles are used.
 */
export const DRAGON_COUNT = 4096;

// Parts are deliberately anatomical, including outlines in their parent part,
// so the show can flex an entire wing without separating its bones and skin.
export const DRAGON_PARTS = Object.freeze({
  BODY: 0, FAR_WING: 1, NEAR_WING: 2, HEAD: 3,
  TAIL: 4, LEGS: 5, BREATH: 6, SPINES: 7,
});

const PALETTE = Object.freeze({
  membrane: [0.07, 0.23, 1.07],
  violet: [0.21, 0.19, 1.12],
  blue: [0.10, 0.44, 1.22],
  cyan: [0.20, 0.91, 1.34],
  ice: [0.68, 1.13, 1.42],
});
const mix = (a, b, t) => a + (b - a) * t;

function halton(index, base) {
  let value = 0, fraction = 1;
  while (index > 0) {
    fraction /= base;
    value += fraction * (index % base);
    index = Math.floor(index / base);
  }
  return value;
}

function smoothPath(nodes, steps = 18) {
  const result = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[Math.max(0, i - 1)], b = nodes[i];
    const c = nodes[i + 1], d = nodes[Math.min(nodes.length - 1, i + 2)];
    for (let j = 0; j < steps; j++) {
      const t = j / steps, t2 = t * t, t3 = t2 * t;
      result.push(b.map((v, axis) => 0.5 * ((2 * v) + (-a[axis] + c[axis]) * t
        + (2 * a[axis] - 5 * v + 4 * c[axis] - d[axis]) * t2
        + (-a[axis] + 3 * v - 3 * c[axis] + d[axis]) * t3)));
    }
  }
  result.push(nodes[nodes.length - 1]);
  return result;
}

function cubic(a, b, c, d, steps = 18) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps, u = 1 - t;
    return a.map((value, axis) => u * u * u * value + 3 * u * u * t * b[axis]
      + 3 * u * t * t * c[axis] + t * t * t * d[axis]);
  });
}

function curveSegments(segments) {
  return segments.flatMap((segment, i) => cubic(...segment).slice(i ? 1 : 0));
}

function measure(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1]
    + Math.hypot(...points[i].map((value, axis) => value - points[i - 1][axis])));
  return { points, distances, length: distances[distances.length - 1] };
}

function atLength(path, t) {
  const distance = Math.max(0, Math.min(1, t)) * path.length;
  let low = 1, high = path.points.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (path.distances[mid] < distance) low = mid + 1;
    else high = mid;
  }
  const u = (distance - path.distances[low - 1])
    / Math.max(1e-8, path.distances[low] - path.distances[low - 1]);
  return path.points[low].map((value, axis) => mix(path.points[low - 1][axis], value, u));
}

function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > y) !== (b[1] > y)
      && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function createArtwork() {
  const positions = new Float32Array(DRAGON_COUNT * 3);
  const colors = new Float32Array(DRAGON_COUNT * 3);
  const parts = new Uint8Array(DRAGON_COUNT);
  let cursor = 0;
  function point(position, part, color = 'blue', intensity = 1) {
    if (cursor >= DRAGON_COUNT) throw new Error('Dragon artwork point budget exceeded');
    for (let axis = 0; axis < 3; axis++) {
      // Leave a deliberate open diagonal on the left for the long breath.
      positions[cursor * 3 + axis] = axis === 0 && part !== DRAGON_PARTS.BREATH
        ? position[axis] * 0.9 + 7 : position[axis];
      colors[cursor * 3 + axis] = PALETTE[color][axis] * intensity;
    }
    parts[cursor++] = part;
  }
  function line(nodes, quantity, part, color = 'cyan', smooth = true) {
    const path = measure(smooth ? smoothPath(nodes) : nodes);
    for (let i = 0; i < quantity; i++) point(atLength(path, (i + 0.5) / quantity), part, color);
  }
  function lines(paths, quantity, part, color = 'cyan') {
    const lengths = paths.map(path => measure(path).length);
    const total = lengths.reduce((sum, length) => sum + length, 0);
    let consumed = 0;
    paths.forEach((path, i) => {
      const count = i === paths.length - 1 ? quantity - consumed : Math.floor(quantity * lengths[i] / total);
      consumed += count;
      line(path, count, part, color, false);
    });
  }
  function surface(polygon, quantity, part, zAt, color = 'membrane', seed = 0) {
    const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let accepted = 0;
    for (let sample = seed + 1; accepted < quantity; sample++) {
      const x = mix(x0, x1, halton(sample, 2)), y = mix(y0, y1, halton(sample, 3));
      if (!insidePolygon(x, y, polygon)) continue;
      const ridges = 0.88 + 0.12 * Math.sin(x * 0.66 + y * 0.43);
      point([x, y, zAt(x, y)], part, color, ridges);
      accepted++;
    }
  }
  function tube(nodes, radii, quantity, part, color = 'blue', depthRatio = 0.7) {
    const path = measure(smoothPath(nodes));
    for (let i = 0; i < quantity; i++) {
      const u = (i + 0.5) / quantity;
      const p = atLength(path, u), before = atLength(path, u - 0.002), after = atLength(path, u + 0.002);
      const angle = i * 2.399963229728653;
      const heading = Math.atan2(after[1] - before[1], after[0] - before[0]);
      const span = u * (radii.length - 1), segment = Math.min(radii.length - 2, Math.floor(span));
      const radius = mix(radii[segment], radii[segment + 1], span - segment);
      const offset = Math.cos(angle) * radius;
      point([p[0] - Math.sin(heading) * offset, p[1] + Math.cos(heading) * offset,
        p[2] + Math.sin(angle) * radius * depthRatio], part, color, 0.88 + 0.12 * Math.sin(angle));
    }
  }

  // 540: a continuous serpentine neck and muscular torso, not a flat oval.
  const body = [[-27, 79, 1], [-20, 76, 0], [-14, 70, -1], [-4, 68, -2], [10, 63, -3], [24, 55, -3]];
  tube(body, [2.7, 3.7, 4.6, 6.7, 7.0, 4.5], 388, DRAGON_PARTS.BODY);
  line([[-27, 82, 1], [-18, 80, 0], [-10, 76, -1], [2, 74, -2], [15, 68, -3], [27, 58, -3]], 74, DRAGON_PARTS.BODY, 'cyan');
  line([[-27, 76, 3], [-20, 71, 3], [-15, 64, 3], [-5, 61, 3], [8, 57, 2], [21, 51, 0]], 54, DRAGON_PARTS.BODY, 'blue');
  line([[-21, 76, 4], [-13, 68, 4], [-3, 66, 5], [10, 61, 4], [22, 55, 1]], 24, DRAGON_PARTS.BODY, 'ice');

  // 790: the more distant wing is visibly behind the near wing in Z.
  const farRoot = [-6, 73, -12], farKnuckle = [-27, 113, -20];
  const farOutline = curveSegments([
    [farRoot, [-19, 83, -16], [-25, 105, -19], farKnuckle],
    [farKnuckle, [-17, 108, -22], [-8, 111, -21], [4, 111, -18]],
    [[4, 111, -18], [3, 104, -17], [11, 101, -16], [17, 98, -14]],
    [[17, 98, -14], [7, 99, -15], [3, 93, -14], [3, 87, -13]],
    [[3, 87, -13], [-3, 92, -14], [-5, 81, -12], farRoot],
  ]);
  surface(farOutline, 572, DRAGON_PARTS.FAR_WING,
    (x, y) => -13 - (y - 75) * 0.2 + Math.sin(x * 0.23 + y * 0.11) * 1.1, 'violet', 13);
  line(farOutline, 135, DRAGON_PARTS.FAR_WING, 'blue', false);
  lines([
    smoothPath([farRoot, [-14, 91, -15], farKnuckle]),
    smoothPath([farKnuckle, [-13, 105, -20], [4, 111, -18]]),
    smoothPath([farKnuckle, [-8, 99, -18], [17, 98, -14]]),
    smoothPath([farKnuckle, [-12, 95, -16], [3, 87, -13]]),
  ], 83, DRAGON_PARTS.FAR_WING, 'cyan');

  // 1120: concave bat-like membrane panels; sparse pale spars, deep-blue skin.
  const nearRoot = [-2, 73, 1], knuckle = [18, 114, -4];
  const nearOutline = curveSegments([
    [nearRoot, [5, 84, 0], [11, 108, -3], knuckle],
    [knuckle, [29, 111, -3], [42, 108, -2], [57, 110, -1]],
    [[57, 110, -1], [49, 102, 1], [47, 93, 2], [53, 83, 3]],
    [[53, 83, 3], [44, 90, 3], [40, 84, 4], [36, 76, 4]],
    [[36, 76, 4], [29, 83, 4], [24, 79, 5], [19, 68, 5]],
    [[19, 68, 5], [10, 77, 5], [4, 76, 3], nearRoot],
  ]);
  surface(nearOutline, 812, DRAGON_PARTS.NEAR_WING, (x, y) => {
    const fanAngle = Math.atan2(y - 114, x - 18);
    return mix(5, -4, Math.max(0, Math.min(1, (y - 68) / 46)))
      + Math.sin(fanAngle * 11) * Math.sin((114 - y) / 48 * Math.PI) * 1.5;
  }, 'membrane', 47);
  line(nearOutline, 177, DRAGON_PARTS.NEAR_WING, 'blue', false);
  lines([
    smoothPath([nearRoot, [9, 91, -1], knuckle]),
    smoothPath([knuckle, [35, 107, -2], [57, 110, -1]]),
    smoothPath([knuckle, [39, 98, 1], [53, 83, 3]]),
    smoothPath([knuckle, [28, 96, 1], [36, 76, 4]]),
    smoothPath([knuckle, [19, 93, 2], [19, 68, 5]]),
  ], 115, DRAGON_PARTS.NEAR_WING, 'cyan');
  line([[15, 111, -3], [19, 116, -4], [21, 112, -3]], 16, DRAGON_PARTS.NEAR_WING, 'ice');

  // 430: an armoured wedge skull, swept-back horns and a hinged lower jaw.
  // The mouth is a narrow negative-space wedge, not two detached smiling arcs.
  // Keep the same head budget/identity range as the other show formations.
  const skull = [[-24.6, 77.8, 5], [-23, 82.5, 4], [-25.8, 85.4, 4], [-30.4, 86.2, 5],
    [-33.3, 84.7, 6], [-36.8, 82.5, 7], [-40.7, 82, 7], [-43.3, 80.1, 7],
    [-44, 78, 7], [-42.2, 77, 7], [-38.8, 77.4, 7], [-35.6, 77.3, 7],
    [-30.2, 76.4, 6], [-26, 77.4, 5], [-24.6, 77.8, 5]];
  surface(skull, 144, DRAGON_PARTS.HEAD,
    (x, y) => 5.8 + Math.sin((x + 44) / 21 * Math.PI) * 1.3, 'blue', 5);
  line(skull, 94, DRAGON_PARTS.HEAD, 'cyan', false);
  const jaw = [[-42.4, 74.5, 7], [-38.5, 74.5, 7], [-33.6, 75.2, 6.7],
    [-29.5, 76.8, 6], [-26, 77.4, 5], [-29.4, 74.7, 6], [-34.7, 73.4, 7],
    [-39.9, 73.2, 7], [-42.4, 74.5, 7]];
  surface(jaw, 42, DRAGON_PARTS.HEAD, (x) => 6 + Math.min(1, (-x - 26) / 10), 'blue', 71);
  line(jaw, 42, DRAGON_PARTS.HEAD, 'cyan', false);
  // Horn roots are embedded in the crown. Short, rearward tips read as horns
  // rather than the old long upright ears merging into the distant wing.
  lines([
    [[-29.6, 85.7, 5], [-25.2, 89.1, 3], [-18.7, 90.5, 0], [-23.8, 85.2, 4], [-29.6, 85.7, 5]],
    [[-24.8, 83.9, 2], [-20.6, 86.5, 0], [-16.3, 87.6, -2], [-21.1, 83.3, 1], [-24.8, 83.9, 2]],
  ], 46, DRAGON_PARTS.HEAD, 'blue');
  // A single angular cheek ridge joins the jaw hinge to the muscular neck;
  // its rear endpoint overlaps the existing body instead of floating in air.
  line([[-30.6, 82, 7.5], [-28.9, 79.4, 7], [-26, 77.4, 5], [-24.3, 77.8, 2.4]],
    16, DRAGON_PARTS.HEAD, 'cyan', false);
  line([[-35.5, 83.2, 8.2], [-33.4, 83.8, 8.3], [-30.8, 83, 8.2]],
    14, DRAGON_PARTS.HEAD, 'cyan', false);
  lines([
    [[-39.3, 77.3, 7.6], [-38.8, 76.1, 7.6], [-38.1, 77.4, 7.6]],
    [[-35.6, 77.3, 7.6], [-35.1, 76.2, 7.6], [-34.4, 77.1, 7.6]],
  ], 12, DRAGON_PARTS.HEAD, 'cyan');
  // Ten lamps make one small slanted eye; no white circular outline/pupil
  // bloom that would turn the head into a startled, smiling cartoon face.
  line([[-34, 81.7, 8.5], [-31.6, 82.1, 8.5], [-32.3, 80.9, 8.5], [-34, 81.7, 8.5]],
    10, DRAGON_PARTS.HEAD, 'ice', false);
  line([[-41.6, 79.5, 8], [-40.6, 80, 8], [-39.8, 79.6, 8]],
    10, DRAGON_PARTS.HEAD, 'blue', false);

  // 410: a tapering, curled three-dimensional tail rather than a spiral symbol.
  const tail = [[24, 55, -3], [36, 48, -4], [46, 38, -2], [43, 28, 0], [29, 25, 1], [18, 28, 2], [12, 34, 3]];
  tube(tail, [4.6, 3.8, 2.7, 1.9, 1.2, 0.75, 0.15], 285, DRAGON_PARTS.TAIL, 'blue', 0.85);
  line([[27, 57, -3], [39, 50, -4], [49, 39, -2], [45, 27, 0], [29, 24, 1], [17, 27, 2], [12, 34, 3]], 86, DRAGON_PARTS.TAIL, 'cyan');
  line([[23, 51, 0], [33, 45, 0], [43, 37, 1], [41, 30, 2], [29, 26, 2], [18, 29, 3]], 27, DRAGON_PARTS.TAIL, 'blue');
  line([[12, 34, 3], [10, 36, 3], [10, 31, 3], [15, 31, 3], [12, 34, 3]], 12, DRAGON_PARTS.TAIL, 'ice', false);

  // 300: bent joints and spread claw silhouettes retain the animal's gesture.
  const legs = [
    { nodes: [[-7, 67, 3], [-6, 57, 6], [-15, 53, 7], [-17, 48, 8]], radii: [2.7, 2.1, 1.2, 0.65] },
    { nodes: [[3, 65, -4], [6, 55, -3], [1, 50, -1]], radii: [2.3, 1.4, 0.6] },
    { nodes: [[23, 58, 2], [29, 51, 4], [24, 44, 6], [31, 41, 8]], radii: [4, 3, 1.7, 0.65] },
    { nodes: [[27, 53, -6], [35, 47, -5], [35, 41, -3]], radii: [2.5, 1.7, 0.55] },
  ];
  legs.forEach((leg, i) => tube(leg.nodes, leg.radii, i === 0 || i === 2 ? 52 : 27, DRAGON_PARTS.LEGS, 'blue'));
  const claws = [
    [[-17, 50, 8], [-20, 48, 8], [-21, 45, 9]],
    [[-17, 50, 8], [-17, 46, 9], [-16, 44.5, 9]],
    [[-16, 51, 8], [-13, 48, 9], [-13, 46, 9]],
    [[0, 52, 0], [-3, 49, 0], [-3, 47, 1]],
    [[1, 51, 0], [3, 48, 1], [5, 48, 1]],
    [[30, 42, 8], [31, 38, 9], [29, 36, 9]],
    [[31, 42, 8], [35, 40, 9], [35, 37, 9]],
    [[30, 43, 8], [37, 44, 9], [39, 42, 9]],
    [[35, 42, -3], [39, 40, -1], [40, 38, 0]],
    [[34, 42, -2], [33, 38, -1], [34, 36, 0]],
  ];
  lines(claws.map(path => smoothPath(path)), 100, DRAGON_PARTS.LEGS, 'cyan');
  lines(legs.map(leg => smoothPath(leg.nodes.map(([x, y, z]) => [x - 1, y + 1, z + 2]))), 42, DRAGON_PARTS.LEGS, 'blue');

  // 370: forked electrical breath, distinct streams with negative space between.
  // This part can be modulated progressively mouth-to-tip using x/y distance.
  const breath = [];
  for (let strand = 0; strand < 7; strand++) {
    const reach = 0.66 + strand / 6 * 0.34;
    breath.push(Array.from({ length: 95 }, (_, i) => {
      const t = i / 94, envelope = Math.sin(t * Math.PI * 0.8);
      const spread = (strand - 3) * t * 1.3;
      // The first lamps sit between the new lips. Fade the attachment offset
      // out downstream so the existing tributaries and total bounds stay put.
      const mouthAttach = (1 - t) ** 2;
      return [-29.72 - 1.08 * mouthAttach - 30.5 * reach * t + spread * 0.45 + Math.sin(t * 18 + strand) * envelope * 0.9,
        74.5 + 1.3 * mouthAttach - 47 * reach * t - spread * 0.75 + Math.sin(t * 24 + strand * 0.9) * envelope * 1.05,
        7 + (strand - 3) * t * 0.42 + Math.sin(t * 9 + strand) * 0.3];
    }));
  }
  // Three thin tributaries fork away from the core. They spend the same point
  // budget rather than hiding extra particle effects behind the drone fleet.
  const forks = [
    [[-35, 65, 7], [-43, 62, 7.5], [-51, 56, 7], [-59, 53, 6.5]],
    [[-39, 59, 7], [-47, 52, 6.5], [-53, 49, 7], [-60, 43, 6]],
    [[-45, 48, 7], [-44, 40, 8], [-48, 34, 8.5], [-51, 26, 9]],
  ];
  forks.forEach((nodes, index) => {
    const path = measure(smoothPath(nodes));
    breath[index * 2] = Array.from({ length: 95 }, (_, i) => {
      const t = i / 94, position = atLength(path, t);
      position[0] += Math.sin(t * 33 + index) * Math.sin(t * Math.PI) * 0.36;
      position[1] += Math.sin(t * 27 + index) * Math.sin(t * Math.PI) * 0.31;
      return position;
    });
  });
  lines(breath, 308, DRAGON_PARTS.BREATH, 'cyan');
  lines([breath[1].slice(12, 68), breath[3].slice(0, 50), breath[5].slice(40, 95)], 62, DRAGON_PARTS.BREATH, 'ice');

  // 136: a jagged spinal ridge; blue rather than a white overexposed halo.
  const ridge = [
    [[-23, 81, 2], [-20, 87, 0], [-18, 79, 1]],
    [[-17, 78, 0], [-14, 83, -2], [-11, 75, 0]],
    [[-8, 75, -1], [-5, 81, -3], [-2, 74, -1]],
    [[1, 74, -2], [5, 79, -4], [8, 71, -2]],
    [[11, 70, -3], [15, 74, -5], [18, 66, -3]],
    [[21, 63, -3], [25, 67, -5], [27, 58, -3]],
    [[31, 55, -4], [35, 58, -6], [36, 51, -4]],
    [[40, 46, -3], [45, 48, -5], [44, 42, -3]],
    [[46, 36, -1], [50, 35, -3], [45, 31, 0]],
  ];
  lines(ridge, 136, DRAGON_PARTS.SPINES, 'blue');

  if (cursor !== DRAGON_COUNT) throw new Error(`Dragon artwork count mismatch: ${cursor}`);
  return { positions, colors, parts };
}

let artwork;
/**
 * Select real, permanent drone identities (0..4095). Input order is preserved.
 * An odd permutation spreads both even-identity 2K and complete 4K fleets over
 * every anatomical group. The same identity always receives exactly the same
 * Float32 position, colour and part, irrespective of the quality setting.
 */
export function createDragonFormation(identities) {
  if (!Array.isArray(identities) && !ArrayBuffer.isView(identities)) {
    throw new TypeError('Dragon identities must be an array or typed array');
  }
  if (!Number.isInteger(identities.length)) throw new TypeError('Dragon identities need a length');
  for (const identity of identities) {
    if (!Number.isInteger(identity) || identity < 0 || identity >= DRAGON_COUNT) {
      throw new RangeError(`Dragon identity must be an integer from 0 to ${DRAGON_COUNT - 1}`);
    }
  }
  artwork ??= createArtwork();
  const positions = new Float32Array(identities.length * 3);
  const colors = new Float32Array(identities.length * 3);
  const parts = new Uint8Array(identities.length);
  for (let i = 0; i < identities.length; i++) {
    const source = (identities[i] * 997) % DRAGON_COUNT;
    positions.set(artwork.positions.subarray(source * 3, source * 3 + 3), i * 3);
    colors.set(artwork.colors.subarray(source * 3, source * 3 + 3), i * 3);
    parts[i] = artwork.parts[source];
  }
  return { positions, colors, parts };
}
