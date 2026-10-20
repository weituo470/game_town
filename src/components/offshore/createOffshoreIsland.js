import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OFFSHORE_ISLAND, OFFSHORE_DOCK, OFFSHORE_BRIDGE, OFFSHORE_SEATS, offshoreSeatLocal } from '../../../shared/offshore-island.js';
import { offshoreWakeVertexShader, offshoreWakeFragmentShader, offshoreSprayVertexShader, offshoreSprayFragmentShader } from './offshoreShaders.js';

export const OFFSHORE_MODEL_SPEC = Object.freeze({ length: OFFSHORE_ISLAND.length, width: OFFSHORE_ISLAND.width, deckY: OFFSHORE_ISLAND.deckY, towerY: 31, waterY: -1.28,
  drawCallBudget: 35, triangleBudget: 65000, passengerX: offshoreSeatLocal(0).x, passengerZ: Object.freeze(Array.from({ length: OFFSHORE_SEATS }, (_, i) => offshoreSeatLocal(i).z)) });
const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const v3 = p => new THREE.Vector3(...p);
const UP = new THREE.Vector3(0, 1, 0);

function roundedRectangle(width, length, radius) {
  const x = -width / 2, z = -length / 2, shape = new THREE.Shape();
  shape.moveTo(x + radius, z); shape.lineTo(x + width - radius, z); shape.quadraticCurveTo(x + width, z, x + width, z + radius);
  shape.lineTo(x + width, z + length - radius); shape.quadraticCurveTo(x + width, z + length, x + width - radius, z + length);
  shape.lineTo(x + radius, z + length); shape.quadraticCurveTo(x, z + length, x, z + length - radius);
  shape.lineTo(x, z + radius); shape.quadraticCurveTo(x, z, x + radius, z);
  return shape;
}
function textTexture({ width = 1536, height = 320, dock = false, helipad = false } = {}) {
  let texture;
  if (typeof document === 'undefined') {
    // Geometry/disposal tests run without a DOM; the real browser always uses
    // its own installed system fonts and the fully drawn canvas below.
    texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  } else {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (helipad) {
      ctx.fillStyle = '#315d4b'; ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#fff3bc'; ctx.lineWidth = width * .035; ctx.beginPath(); ctx.arc(width / 2, height / 2, width * .35, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fff3bc'; ctx.font = `700 ${Math.round(width * .48)}px Arial,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', width / 2, height * .515);
    } else {
      ctx.fillStyle = '#f8f5e8'; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#8e1830'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${dock ? 126 : 142}px "Microsoft YaHei","PingFang SC",sans-serif`;
      ctx.fillText('上海交通大学', width / 2, height * .35, width * .92);
      ctx.font = `600 ${dock ? 70 : 68}px "Microsoft YaHei","PingFang SC",sans-serif`;
      ctx.fillText('远海浮动岛', width / 2, height * .79, width * .86);
      ctx.fillStyle = '#c49643'; ctx.fillRect(width * .14, height * .59, width * .72, 3);
    }
    texture = new THREE.CanvasTexture(canvas);
  }
  texture.name = helipad ? 'offshore-original-H-mark' : 'offshore-plain-chinese-nameplate';
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; texture.needsUpdate = true;
  return texture;
}

/** One GPU mesh per material, including the hundreds of rail/lattice members. */
function builder(name) {
  const group = new THREE.Group(); group.name = name;
  const buckets = new Map(), materials = new Set(), textures = new Set(), resources = new Set();
  const bases = { box: new THREE.BoxGeometry(1, 1, 1), tube: new THREE.CylinderGeometry(1, 1, 1, 6), ball: new THREE.SphereGeometry(1, 12, 8), plane: new THREE.PlaneGeometry(1, 1) };
  const mat = (name, color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ name, color, roughness: .65, metalness: .1, ...extra }); materials.add(m); return m; };
  const mapped = (name, texture) => { textures.add(texture); return mat(name, '#ffffff', { map: texture, roughness: .75, metalness: 0, emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: .08 }); };
  const put = (shape, surface, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0], owned = false) => {
    let copy = shape.clone();
    if (copy.index) { const nonIndexed = copy.toNonIndexed(); copy.dispose(); copy = nonIndexed; }
    const matrix = new THREE.Matrix4().compose(v3(position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), v3(scale)); copy.applyMatrix4(matrix);
    if (!buckets.has(surface)) buckets.set(surface, []); buckets.get(surface).push(copy);
    if (owned) shape.dispose();
  };
  const box = (surface, position, size, rotation) => put(bases.box, surface, position, size, rotation);
  const sphere = (surface, position, size) => put(bases.ball, surface, position, size);
  const cylinder = (surface, position, radius, height, segments = 12, topRadius = radius) => put(new THREE.CylinderGeometry(topRadius, radius, height, segments), surface, position, [1, 1, 1], [0, 0, 0], true);
  const beam = (surface, a, b, radius = .065) => {
    const start = v3(a), end = v3(b), direction = end.clone().sub(start), length = direction.length();
    if (length < 1e-6) return;
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize());
    const copy = bases.tube.toNonIndexed(); copy.applyMatrix4(new THREE.Matrix4().compose(start.add(end).multiplyScalar(.5), quaternion, new THREE.Vector3(radius, length, radius)));
    if (!buckets.has(surface)) buckets.set(surface, []); buckets.get(surface).push(copy);
  };
  const rounded = (surface, x, y, z, width, length, height, radius = .6) => {
    const shape = new THREE.ExtrudeGeometry(roundedRectangle(width, length, radius), { depth: height, bevelEnabled: false, curveSegments: 6 });
    put(shape, surface, [x, y, z], [1, 1, 1], [-Math.PI / 2, 0, 0], true);
  };
  const plane = (surface, position, size, rotation) => put(bases.plane, surface, position, [size[0], size[1], 1], rotation);
  const finish = () => {
    for (const [surface, parts] of buckets) {
      const merged = mergeGeometries(parts, false);
      if (!merged) throw new Error(`Unable to merge offshore geometry: ${surface.name}`);
      merged.computeBoundingBox(); merged.computeBoundingSphere(); resources.add(merged);
      const mesh = new THREE.Mesh(merged, surface); mesh.name = surface.name; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
      for (const part of parts) part.dispose();
    }
    for (const base of Object.values(bases)) base.dispose(); buckets.clear();
  };
  const track = (object, surface) => { group.add(object); resources.add(object.geometry); materials.add(surface); return object; };
  let disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; for (const value of resources) value.dispose(); for (const value of materials) value.dispose(); for (const value of textures) value.dispose(); group.clear(); };
  const stats = () => Object.freeze({ drawCalls: group.children.filter(item => item.isMesh || item.isPoints).length,
    triangles: group.children.reduce((sum, mesh) => sum + (mesh.isMesh ? (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 : 0), 0),
    materials: materials.size, geometries: resources.size, textures: textures.size });
  return { group, mat, mapped, put, box, sphere, cylinder, beam, rounded, plane, finish, track, stats, dispose, isDisposed: () => disposed };
}

function rail(b, surface, a, z, c, w, y = 8) {
  const length = Math.hypot(c - a, w - z), count = Math.max(1, Math.ceil(length / 1.6));
  for (const height of [.45, .95]) b.beam(surface, [a, y + height, z], [c, y + height, w], .045);
  for (let i = 0; i <= count; i++) { const t = i / count, x = a + (c - a) * t, zz = z + (w - z) * t; b.beam(surface, [x, y, zz], [x, y + .98, zz], .045); }
}
function tower(b, white, red, dark) {
  const baseY = 8.05, topY = 30.65, centerZ = -3, levels = 7;
  const width = y => 2.8 - (y - baseY) / (topY - baseY) * 1.35;
  for (let level = 0; level < levels; level++) {
    const low = baseY + (topY - baseY) * level / levels, high = baseY + (topY - baseY) * (level + 1) / levels;
    const surface = level >= 5 ? white : red, lo = width(low), hi = width(high);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let side = 0; side < 4; side++) {
      const p = corners[side], q = corners[(side + 1) % 4];
      const a = [p[0] * lo, low, centerZ + p[1] * lo], c = [p[0] * hi, high, centerZ + p[1] * hi];
      const d = [q[0] * lo, low, centerZ + q[1] * lo], e = [q[0] * hi, high, centerZ + q[1] * hi];
      b.beam(surface, a, c, .105); b.beam(surface, a, d, .075); b.beam(surface, a, e, .065); b.beam(surface, d, c, .065);
    }
  }
  b.box(red, [0, 30.82, centerZ], [3.25, .36, 3.25]);
  b.box(dark, [0, 8.1, centerZ - 2.85], [7.6, .27, .45]); b.box(dark, [0, 8.1, centerZ + 2.85], [7.6, .27, .45]);
}
function crane(b, yellow, red, white, dark, base, end) {
  const [x, z] = base;
  b.cylinder(yellow, [x, 9.3, z], 1.35, 2.6, 16); b.cylinder(yellow, [x, 13.3, z], .64, 6, 12);
  b.box(yellow, [x, 16.5, z], [2.3, 2.7, 2.6]); b.box(dark, [x, 17.1, z + 1.31], [1.6, 1.2, .04]);
  const start = v3([x, 17.7, z]), target = v3(end), direction = target.clone().sub(start).normalize(), right = direction.clone().cross(UP).normalize(), up = right.clone().cross(direction).normalize();
  const offsets = [right.clone().multiplyScalar(-.62).add(up.clone().multiplyScalar(-.32)), right.clone().multiplyScalar(.62).add(up.clone().multiplyScalar(-.32)), up.clone().multiplyScalar(.72)];
  const point = (u, edge) => start.clone().lerp(target, u).add(offsets[edge]).toArray();
  for (let bay = 0; bay < 10; bay++) {
    const mat = bay < 3 || bay >= 7 ? red : white;
    for (let edge = 0; edge < 3; edge++) {
      b.beam(mat, point(bay / 10, edge), point((bay + 1) / 10, edge), .075);
      b.beam(mat, point(bay / 10, edge), point(bay / 10, (edge + 1) % 3), .06);
      b.beam(mat, point(bay / 10, edge), point((bay + 1) / 10, (edge + 1) % 3), .055);
    }
  }
  const back = start.clone().sub(direction.clone().multiplyScalar(2.7));
  b.box(red, back.toArray(), [2.2, 1.1, 2.1]);
  const apex = [x, 21, z - 1]; b.beam(yellow, [x - .7, 15.8, z - .8], apex, .12); b.beam(yellow, [x + .7, 15.8, z - .8], apex, .12);
  b.beam(dark, apex, end, .027); b.beam(dark, [x, 20.8, z - 1], back.toArray(), .027);
  b.beam(dark, end, [end[0], end[1] - 5.1, end[2]], .035);
  b.cylinder(yellow, [end[0], end[1] - 5.25, end[2]], .18, .45, 8); b.beam(dark, [end[0], end[1] - 5.4, end[2]], [end[0] + .23, end[1] - 5.65, end[2]], .06);
}
function deckhouse(b, white, glazing, metal, center, width, depth, height, rows) {
  const [x, z] = center, bottom = 8.08;
  b.rounded(white, x, bottom, z, width, depth, height, .65);
  b.rounded(white, x, bottom + height, z, width + .45, depth + .45, .27, .8);
  for (let row = 0; row < rows; row++) {
    const y = bottom + 1 + row * (height - 1.7) / Math.max(1, rows - 1);
    const count = Math.max(5, Math.floor(width / 1.1));
    for (let i = 0; i < count; i++) {
      const px = x + (i - (count - 1) / 2) * (width - 1.6) / Math.max(1, count - 1);
      for (const side of [-1, 1]) b.box(glazing, [px, y, z + side * (depth / 2 + .012)], [.39, row === rows - 1 ? .61 : .48, .035]);
    }
    for (let i = 0; i < 4; i++) for (const side of [-1, 1]) b.box(glazing, [x + side * (width / 2 + .012), y, z + (i - 1.5) * (depth - 1.6) / 3], [.035, .5, .4]);
  }
  // Roof walkways, vents and aerials strengthen scale without extra draw calls.
  b.box(metal, [x + width * .22, bottom + height + .45, z], [1.25, .55, 1.8]);
  b.beam(white, [x - width * .2, bottom + height + .2, z], [x - width * .2, bottom + height + 2.1, z], .07);
  b.beam(white, [x - width * .2 - .65, bottom + height + 1.8, z], [x - width * .2 + .65, bottom + height + 1.8, z], .06);
}

export function createOffshoreIsland() {
  const b = builder('offshore-floating-island'), spec = OFFSHORE_MODEL_SPEC;
  const green = b.mat('offshore-deep-green-pontoons', '#215b43', { roughness: .48, metalness: .2 });
  const deck = b.mat('offshore-working-green-decks', '#53705b', { roughness: .87 });
  const white = b.mat('offshore-ivory-structure', '#edece1', { roughness: .61 });
  const red = b.mat('offshore-signal-red-lattice', '#a32235', { roughness: .46, metalness: .2 });
  const yellow = b.mat('offshore-crane-safety-yellow', '#e7b928', { roughness: .49, metalness: .2 });
  const metal = b.mat('offshore-industrial-blue-steel', '#466778', { roughness: .58, metalness: .28 });
  const dark = b.mat('offshore-cables-and-exhausts', '#26353c', { roughness: .62 });
  const glass = b.mat('offshore-deckhouse-windows', '#284755', { roughness: .24, metalness: .4, emissive: '#83b7bd', emissiveIntensity: .04 });
  const orange = b.mat('offshore-rescue-orange', '#ed6631', { roughness: .49 });
  const label = b.mapped('offshore-readable-nameplates', textTexture());
  const helipad = b.mapped('offshore-H-landing-mark', textTexture({ width: 1024, height: 1024, helipad: true }));
  for (const x of [-9, 9]) {
    b.rounded(green, x, -2.15, 0, 8, spec.length, 2.55, 3.5);
    b.rounded(red, x, -1.35, 0, 8.025, spec.length + .025, .13, 3.5);
    for (const z of [-11.3, 11.3]) {
      b.put(new THREE.CylinderGeometry(3.6, 4.65, 2.25, 4), green, [x, 1.5, z], [1, 1, 1], [0, Math.PI / 4, 0], true);
      b.rounded(white, x, 2.42, z, 6.3, 6.4, 5.58, 1.05);
    }
  }
  for (const z of [-8.8, 8.8]) for (const y of [1.0, 2.1]) b.beam(green, [-8.5, y, z], [8.5, y, z], .38);
  const decks = [[0, 9, 26, 12], [0, -11, 26, 8], [-8.25, -2, 9.5, 10], [8.25, -2, 9.5, 10]];
  for (const [x, z, width, depth] of decks) { b.box(white, [x, 7.25, z], [width, 1.25, depth]); b.box(deck, [x, 7.94, z], [width, .12, depth]); }
  for (const x of [-12.75, 12.75]) rail(b, white, x, -14.75, x, 14.75);
  rail(b, white, -12.75, -14.75, 12.75, -14.75);
  rail(b, white, -12.75, 14.75, -9.55, 14.75); rail(b, white, -6.45, 14.75, 12.75, 14.75);
  for (const x of [-3.65, 3.65]) rail(b, yellow, x, -7.05, x, 3.05);
  // Central opening stays genuinely empty; only narrow derrick foot beams span it.
  tower(b, white, red, dark);
  deckhouse(b, white, glass, metal, [0, 11.25], 13, 7.3, 6.1, 4);
  deckhouse(b, white, glass, metal, [7.4, -10.5], 8.4, 7.5, 5.5, 4);
  b.box(metal, [-7.7, 9.3, -11.6], [5.5, 2.6, 4]);
  for (let i = 0; i < 3; i++) { b.cylinder(dark, [-4.9 + i * .65, 12.8, -11.7], .18, 5, 8); b.beam(dark, [-4.9 + i * .65, 15.3, -11.7], [-4.9 + i * .65, 15.6, -12.2], .18); }
  // Open blue equipment rack beside the moon pool, not a filled cube.
  for (const x of [-7, -4.2]) for (const z of [-6.3, -3]) b.beam(metal, [x, 8, z], [x, 11.3, z], .12);
  for (const y of [8.5, 9.9, 11.3]) { rail(b, metal, -7, -6.3, -4.2, -6.3, y - .95); rail(b, metal, -7, -3, -4.2, -3, y - .95); b.beam(metal, [-7, y, -6.3], [-7, y, -3], .1); b.beam(metal, [-4.2, y, -6.3], [-4.2, y, -3], .1); }
  crane(b, yellow, red, white, dark, [-9.4, -4.6], [-8.8, 23, 16.2]);
  crane(b, yellow, red, white, dark, [9.4, 4.3], [8.8, 24, -15.8]);
  for (const x of [-10.4, 10.4]) for (const z of [-11.8, 11.8]) {
    b.rounded(orange, x, 8.35, z, 1.8, 4.9, .9, .85); b.sphere(orange, [x, 9.14, z], [.86, .64, 2.24]);
    b.box(glass, [x, 9.46, z], [1.36, .27, 1.7]);
    for (const end of [-1, 1]) { b.beam(white, [x + Math.sign(x) * 1.0, 8, z + end * 2.5], [x + Math.sign(x) * 1.0, 10.1, z + end * 2.5], .075); b.beam(white, [x + Math.sign(x) * 1.0, 10.1, z + end * 2.5], [x, 10.1, z + end * 2.5], .075); b.beam(dark, [x, 10.1, z + end * 2.5], [x, 8.9, z + end * 2.0], .024); }
  }
  // Eight-sided helideck and its proper circle/H marking, no external logo.
  b.put(new THREE.CylinderGeometry(5.65, 5.65, .24, 8), white, [7.15, 14.35, -9.9], [1, 1, 1], [0, Math.PI / 8, 0], true);
  b.put(new THREE.CircleGeometry(5.46, 8), helipad, [7.15, 14.477, -9.9], [1, 1, 1], [-Math.PI / 2, 0, Math.PI / 8], true);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + Math.PI / 8, c = (i + 1) / 8 * TAU + Math.PI / 8;
    b.beam(white, [7.15 + Math.cos(a) * 5.6, 14.5, -9.9 + Math.sin(a) * 5.6], [7.15 + Math.cos(c) * 5.6, 14.5, -9.9 + Math.sin(c) * 5.6], .055);
  }
  b.cylinder(white, [0, 15.4, 11.3], .23, 2, 10); b.sphere(white, [0, 17, 11.3], [1.15, 1.2, 1.15]);
  for (const x of [-.9, .9]) for (const z of [10.4, 12.2]) b.beam(white, [x, 14.45, z], [x, 16.1, z], .055);
  for (const side of [-1, 1]) b.plane(label, [side * 13.025, 6.83, 0], [21, 2.25], [0, side * Math.PI / 2, 0]);
  // Forward nameplate remains visible in the default bow-quarter observation.
  b.plane(label, [0, 13.42, 14.925], [7.1, 1.47], [0, 0, 0]);
  b.finish();

  const uniforms = { uTime: { value: 0 }, uSpeed: { value: 0 }, uNight: { value: 0 } };
  const wakeMaterial = new THREE.ShaderMaterial({ name: 'offshore-procedural-wake', uniforms, vertexShader: offshoreWakeVertexShader, fragmentShader: offshoreWakeFragmentShader, transparent: true, depthWrite: false });
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(30, 34, 1, 1), wakeMaterial); wake.name = 'offshore-stern-wake'; wake.rotation.x = -Math.PI / 2; wake.position.set(0, spec.waterY + .045, -34); wake.renderOrder = 2; wake.frustumCulled = false; b.track(wake, wakeMaterial);
  const sprayPositions = new Float32Array(64 * 3), sprayGeometry = new THREE.BufferGeometry(); sprayGeometry.setAttribute('position', new THREE.BufferAttribute(sprayPositions, 3));
  const sprayMaterial = new THREE.ShaderMaterial({ name: 'offshore-bow-spray', uniforms, vertexShader: offshoreSprayVertexShader, fragmentShader: offshoreSprayFragmentShader, transparent: true, depthWrite: false });
  const spray = new THREE.Points(sprayGeometry, sprayMaterial); spray.name = 'offshore-bow-spray'; spray.frustumCulled = false; b.track(spray, sprayMaterial);
  const statistics = b.stats();
  b.group.userData.offshoreFeatures = Object.freeze({ bow: '+z', deckY: 8, towerY: 31, moonPool: Object.freeze({ minX: -3.5, maxX: 3.5, minZ: -7, maxZ: 3 }), passengerX: -8, passengerZ: spec.passengerZ, landmarkText: Object.freeze(['上海交通大学', '远海浮动岛']) });
  let lastState;
  const update = (elapsedMs = 0, { speed = 0, progress = 0, stationary = false, reducedMotion = false, night = 0 } = {}) => {
    if (b.isDisposed()) return null;
    const time = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) / 1000 : 0, velocity = Number.isFinite(speed) ? Math.abs(speed) : 0;
    const normalizedProgress = Number.isFinite(progress) ? clamp(progress) : 0;
    // The shared final leg is a stern-first docking maneuver, not a second
    // teleport/turn. Its water trail belongs on the opposite end of the hull.
    const direction = speed < 0 || normalizedProgress > 122 / 150 ? -1 : 1;
    const active = stationary || reducedMotion ? 0 : clamp(velocity / 3.5), darkness = night === true ? 1 : Number.isFinite(night) ? clamp(night) : 0;
    uniforms.uTime.value = reducedMotion ? 0 : time; uniforms.uSpeed.value = active; uniforms.uNight.value = darkness;
    wake.visible = active > .01; spray.visible = active > .01;
    wake.position.z = -34 * direction; wake.rotation.z = direction < 0 ? Math.PI : 0;
    glass.emissiveIntensity = .04 + darkness * .22; label.emissiveIntensity = .08 + darkness * .14; helipad.emissiveIntensity = .08 + darkness * .1;
    if (spray.visible) {
      for (let i = 0; i < 64; i++) {
        const phase = ((time * 1.4 + i * .61803398875) % 1), side = i % 2 ? 1 : -1, k = i * 3;
        sprayPositions[k] = side * (9 + Math.sin(i * 2.4) * .75 + phase * 1.5);
        sprayPositions[k + 1] = spec.waterY + .1 + Math.sin(phase * Math.PI) * (.45 + (i % 5) * .07) * active;
        sprayPositions[k + 2] = (17.9 - phase * (2.6 + velocity * .25) + Math.sin(i * 1.5) * .45) * direction;
      }
      sprayGeometry.attributes.position.needsUpdate = true;
    }
    lastState = Object.freeze({ time, speed: velocity, progress: normalizedProgress, stationary: Boolean(stationary), reducedMotion: Boolean(reducedMotion), night: darkness, wake: active, direction });
    return lastState;
  };
  update(0, { stationary: true });
  return Object.freeze({ group: b.group, update, dispose: b.dispose, statistics });
}

/** The island moves; this warm-stone dock stays at its world-space coordinates. */
export function createOffshoreDock() {
  const b = builder('offshore-static-town-dock');
  const stone = b.mat('offshore-dock-warm-gray-stone', '#b5ad9e', { roughness: .9, metalness: .02 });
  const blue = b.mat('offshore-dock-sea-blue-rails', '#527986', { roughness: .64, metalness: .22 });
  const white = b.mat('offshore-dock-ivory-gateway', '#e6dfcd', { roughness: .74 });
  const yellow = b.mat('offshore-dock-safety-lines', '#e9c64b', { roughness: .8, metalness: .02 });
  const label = b.mapped('offshore-dock-readable-gateway', textTexture({ dock: true }));
  b.box(stone, [OFFSHORE_DOCK.x, -.32, OFFSHORE_DOCK.z], [OFFSHORE_DOCK.width, .64, OFFSHORE_DOCK.depth]);
  b.box(stone, [OFFSHORE_BRIDGE.x, -.27, OFFSHORE_BRIDGE.z], [OFFSHORE_BRIDGE.width, .5, OFFSHORE_BRIDGE.depth]);
  for (const x of [8.3, 23.7]) for (const z of [53, 63]) b.cylinder(blue, [x, -1.4, z], .32, 2.8, 8);
  rail(b, blue, 7, 52, 12.8, 52, 0); rail(b, blue, 19.2, 52, 25, 52, 0);
  rail(b, blue, 7, 52, 7, 64, 0); rail(b, blue, 7, 64, 25, 64, 0);
  // East edge has an intentional boarding gate, never a rail through passengers.
  rail(b, blue, 25, 52, 25, 56, 0); rail(b, blue, 25, 60, 25, 64, 0);
  for (const x of [13, 19]) rail(b, blue, x, 38, x, 52, -.02);
  for (const x of [7.5, 24.5]) b.box(yellow, [x, .014, 58], [.13, .018, 11]);
  for (const z of [52.5, 63.5]) b.box(yellow, [16, .014, z], [17, .018, .13]);
  for (let i = 0; i < 10; i++) b.box(yellow, [23.7, .016, 54 + i * .85], [.75, .018, .13], [0, -.5, 0]);
  for (const x of [9.4, 22.6]) b.box(white, [x, 2.2, 53.3], [.48, 4.4, .48]);
  b.box(white, [16, 4.05, 53.3], [14, 2.25, .38]);
  b.plane(label, [16, 4.05, 53.09], [13.6, 2.05], [0, Math.PI, 0]);
  b.plane(label, [16, 4.05, 53.51], [13.6, 2.05], [0, 0, 0]);
  for (const z of [54.8, 61.2]) { b.cylinder(blue, [24, .38, z], .2, .76, 8); b.box(blue, [24, .7, z], [.7, .13, .22]); }
  b.finish(); const statistics = b.stats();
  const update = (_elapsed = 0, { night = 0 } = {}) => { if (b.isDisposed()) return null; const darkness = night === true ? 1 : Number.isFinite(night) ? clamp(night) : 0; label.emissiveIntensity = .08 + darkness * .2; return { night: darkness }; };
  return Object.freeze({ group: b.group, update, dispose: b.dispose, statistics });
}
