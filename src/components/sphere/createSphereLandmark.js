import * as THREE from 'three';
import { SPHERE_LANDMARK, SPHERE_BRIDGE, SPHERE_MODES } from '../../../shared/sphere-landmark.js';
import { sphereWallVertexShader, sphereWallFragmentShader } from './sphereWallShaders.js';

const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const p = clamp(value); return p * p * (3 - 2 * p); };
const ART_MODES = SPHERE_MODES.filter(mode => mode.id !== 'auto').map(mode => mode.id);
export const SPHERE_RENDER_BUDGET = Object.freeze({ drawCalls: 15, triangles: 30000, cycleMs: 72000, modeMs: 18000, crossfadeMs: 1400 });

/** Pure absolute-time sampler: seeking/reduced motion never depends on a RAF. */
export function sampleSphereWall(timeMs = 0, { mode = 'auto', reducedMotion = false, night = 0 } = {}) {
  const time = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  const validMode = ART_MODES.includes(mode) ? mode : 'auto';
  const stableTime = reducedMotion ? 6200 : time % 3600000;
  let current = ART_MODES.indexOf(validMode), next, blend = 0;
  if (current < 0) {
    const cycle = reducedMotion ? 0 : time % SPHERE_RENDER_BUDGET.cycleMs;
    current = Math.floor(cycle / SPHERE_RENDER_BUDGET.modeMs);
    const local = cycle % SPHERE_RENDER_BUDGET.modeMs;
    blend = reducedMotion ? 0 : smooth((local - SPHERE_RENDER_BUDGET.modeMs + SPHERE_RENDER_BUDGET.crossfadeMs) / SPHERE_RENDER_BUDGET.crossfadeMs);
  }
  next = validMode === 'auto' ? (current + 1) % ART_MODES.length : current;
  return Object.freeze({ mode: ART_MODES[current], nextMode: ART_MODES[next], modeIndex: current, nextModeIndex: next,
    timeSeconds: stableTime / 1000, blend, reducedMotion: Boolean(reducedMotion), night: night === true ? 1 : Number.isFinite(night) ? clamp(night) : 0 });
}

function stoneMaterial() {
  const material = new THREE.MeshStandardMaterial({ name: 'sphere-warm-town-stone', color: '#c4b49b', roughness: .89, metalness: .02 });
  material.customProgramCacheKey = () => 'sphere-town-stone-v1';
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vPaving;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaving=position;');
    shader.fragmentShader = 'varying vec3 vPaving;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 tile=vec2(vPaving.x + mod(floor(vPaving.z/2.8),2.)*2.1,vPaving.z)/vec2(4.2,2.8);
      vec2 edge=min(fract(tile),1.-fract(tile));
      float seam=1.-smoothstep(.006,.018,min(edge.x,edge.y));
      float variation=fract(sin(dot(floor(tile),vec2(19.17,73.83)))*4231.57);
      diffuseColor.rgb*=.93+variation*.10-seam*.12;
    `);
  };
  return material;
}

/**
 * An original sphere theatre, in local coordinates. The town wrapper applies
 * the shared world center once; bridge coordinates are translated back here.
 * No assets, new renderer, render target, timer, audio or network dependency.
 */
export function createSphereLandmark() {
  const spec = SPHERE_LANDMARK, group = new THREE.Group();
  group.name = 'sphere-landmark';
  group.userData.sphereLandmark = spec.id;
  const geometries = new Set(), materials = new Set(), objects = [];
  const geometry = value => { geometries.add(value); return value; };
  const material = value => { materials.add(value); return value; };
  const stone = material(stoneMaterial());
  const trim = material(new THREE.MeshStandardMaterial({ name: 'sphere-limestone-trim', color: '#d5c4a4', roughness: .72, metalness: .11 }));
  const champagne = material(new THREE.MeshStandardMaterial({ name: 'sphere-champagne-frame', color: '#a79676', roughness: .42, metalness: .5 }));
  // Opaque stylised glazing is one pass: no double-sided transmission targets.
  const glass = material(new THREE.MeshStandardMaterial({ name: 'sphere-entry-glass', color: '#749394', roughness: .19, metalness: .48, emissive: '#8aada5', emissiveIntensity: .05 }));
  const lamp = material(new THREE.MeshStandardMaterial({ name: 'sphere-warm-path-lamps', color: '#fff0c6', roughness: .36, emissive: '#ffd697', emissiveIntensity: .35 }));
  const add = (name, shape, surface, position = [0, 0, 0], rotation = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(shape, surface); mesh.name = name; mesh.position.set(...position); mesh.rotation.set(...rotation);
    mesh.receiveShadow = true; mesh.userData.sphereLandmark = spec.id; group.add(mesh); objects.push(mesh); return mesh;
  };
  const batch = (name, shape, surface, placements) => {
    const mesh = new THREE.InstancedMesh(shape, surface, placements.length), dummy = new THREE.Object3D();
    placements.forEach((entry, index) => {
      dummy.position.set(...entry.position); dummy.rotation.set(...(entry.rotation || [0, 0, 0])); dummy.scale.set(...(entry.scale || [1, 1, 1])); dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.name = name; mesh.userData.sphereLandmark = spec.id; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.receiveShadow = true;
    group.add(mesh); objects.push(mesh); return mesh;
  };
  const box = geometry(new THREE.BoxGeometry(1, 1, 1));
  add('sphere-island-town-paving', geometry(new THREE.CylinderGeometry(spec.groundRadius, spec.groundRadius, .8, 96)), stone, [0, -.4, 0]);
  add('sphere-promenade-inlay', geometry(new THREE.RingGeometry(21.65, 22.15, 96)), trim, [0, .014, 0], [-Math.PI / 2, 0, 0]);
  add('sphere-low-stone-plinth', geometry(new THREE.CylinderGeometry(18.3, 18.3, .34, 96)), trim, [0, .17, 0]);
  add('sphere-glazed-drum', geometry(new THREE.CylinderGeometry(16.4, 16.4, spec.baseY - .27, 96)), glass, [0, (spec.baseY + .41) / 2, 0]);
  add('sphere-drum-cap', geometry(new THREE.CylinderGeometry(16.6, 16.6, .14, 96)), trim, [0, spec.baseY + .07, 0]);

  // One shared box instance batch includes mullions, entry canopy and handles.
  const frames = [];
  for (let i = 0; i < 40; i++) {
    const angle = i / 40 * TAU;
    frames.push({ position: [Math.sin(angle) * 16.45, 1.22, Math.cos(angle) * 16.45], scale: [.13, 1.75, .17], rotation: [0, angle, 0] });
  }
  const front = new THREE.Group(); front.rotation.y = spec.faceYaw; front.updateMatrix();
  const frontPoint = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(front.matrix).toArray();
  frames.push({ position: frontPoint(0, 2.37, 17.25), scale: [11.8, .22, 4.1], rotation: [0, spec.faceYaw, 0] });
  for (const x of [-4.8, 4.8]) frames.push({ position: frontPoint(x, 1.26, 18.4), scale: [.18, 2.15, .18], rotation: [0, spec.faceYaw, 0] });
  for (const x of [-.23, .23]) frames.push({ position: frontPoint(x, 1.25, 16.62), scale: [.08, .65, .10], rotation: [0, spec.faceYaw, 0] });
  batch('sphere-facade-frames-and-canopy', box, champagne, frames);

  const wallUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uMode: { value: 0 }, uNextMode: { value: 1 }, uBlend: { value: 0 }, uNight: { value: 0 }, uReduced: { value: 0 },
  }]);
  const wallMaterial = material(new THREE.ShaderMaterial({ name: 'sphere-led-artwork', uniforms: wallUniforms, vertexShader: sphereWallVertexShader,
    fragmentShader: sphereWallFragmentShader, fog: true, toneMapped: true }));
  const thetaLength = Math.acos((spec.baseY - spec.centerY) / spec.radius);
  const wall = add('sphere-led-wall', geometry(new THREE.SphereGeometry(spec.radius, 112, 64, 0, TAU, 0, thetaLength)), wallMaterial, [0, spec.centerY, 0], [0, spec.faceYaw, 0]);
  wall.castShadow = true;

  const posts = [], lights = [];
  for (let index = 0; index < 14; index++) {
    const angle = index / 14 * TAU;
    // Keep the bridge/entry axis open, rather than putting furniture in travel.
    if (Math.abs(Math.atan2(Math.sin(angle - spec.faceYaw), Math.cos(angle - spec.faceYaw))) < .39) continue;
    const x = Math.sin(angle) * 24, z = Math.cos(angle) * 24;
    posts.push({ position: [x, .43, z], scale: [1, 1, 1] }); lights.push({ position: [x, .94, z], scale: [1, 1, 1] });
  }
  batch('sphere-promenade-bollards', geometry(new THREE.CylinderGeometry(.105, .145, .86, 8)), champagne, posts);
  batch('sphere-promenade-lamps', geometry(new THREE.SphereGeometry(.23, 10, 6)), lamp, lights);

  const bridge = SPHERE_BRIDGE, bx = bridge.x - spec.x, bz = bridge.z - spec.z;
  const deck = add('sphere-town-bridge-deck', box, stone, [bx, -.24, bz]); deck.scale.set(bridge.width, .44, bridge.depth); // top -0.02, island top 0
  const rails = [];
  for (const sign of [-1, 1]) {
    const z = bz + sign * bridge.depth / 2;
    const begin = Math.max(bx - bridge.width / 2, Math.sqrt(Math.max(0, spec.groundRadius ** 2 - z * z)) + .05), end = bx + bridge.width / 2;
    if (end <= begin) continue;
    rails.push({ position: [(begin + end) / 2, .95, z], scale: [end - begin, .12, .12] });
    const count = Math.max(1, Math.ceil((end - begin) / 2.4));
    for (let i = 0; i <= count; i++) rails.push({ position: [begin + (end - begin) * i / count, .44, z], scale: [.12, .9, .12] });
  }
  batch('sphere-town-bridge-rails', box, champagne, rails);
  let disposed = false;
  const statistics = Object.freeze({ drawCalls: objects.length, triangles: objects.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1), 0),
    geometries: geometries.size, materials: materials.size });
  group.userData.sphereStatistics = statistics;
  const update = (timeMs = 0, options = {}) => {
    if (disposed) return null;
    const state = sampleSphereWall(timeMs, options);
    wallUniforms.uTime.value = state.timeSeconds; wallUniforms.uMode.value = state.modeIndex; wallUniforms.uNextMode.value = state.nextModeIndex;
    wallUniforms.uBlend.value = state.blend; wallUniforms.uNight.value = state.night; wallUniforms.uReduced.value = state.reducedMotion ? 1 : 0;
    glass.emissiveIntensity = .05 + state.night * .15; lamp.emissiveIntensity = .35 + state.night * .8;
    return state;
  };
  const dispose = () => {
    if (disposed) return; disposed = true;
    for (const mesh of objects) if (mesh.isInstancedMesh) mesh.dispose();
    for (const shape of geometries) shape.dispose();
    for (const surface of materials) surface.dispose();
    group.clear();
  };
  update(0);
  return Object.freeze({ group, update, dispose, statistics });
}
