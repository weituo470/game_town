import * as THREE from 'three';
import layout from '../../../shared/metro-layout.json' with { type: 'json' };
import { sampleDayNight } from '../../../shared/dayNight.js';

const I = layout.island;
const clamp = n => Math.max(0, Math.min(1, n));
export const METRO_TRAFFIC_COUNT = 10;
export const METRO_ORIGIN = Object.freeze([I.x, 0, I.z]);

/** Rounded four-street traffic circuit, derived only from the collision layout. */
export function createMetroRoute() {
  const northSouth = layout.roads.filter(r => r.axis === 'z').map(r => r.x).sort((a, b) => a - b);
  const eastWest = layout.roads.filter(r => r.axis === 'x').map(r => r.z).sort((a, b) => a - b);
  const minX = northSouth[0] + 2.1 - I.x, maxX = northSouth.at(-1) - 2.1 - I.x;
  const minZ = eastWest[0] + 2.1 - I.z, maxZ = eastWest.at(-1) - 2.1 - I.z;
  const radius = 4.8;
  const points = [];
  for (const [cx, cz, start] of [[maxX - radius, minZ + radius, -90], [maxX - radius, maxZ - radius, 0], [minX + radius, maxZ - radius, 90], [minX + radius, minZ + radius, 180]]) {
    for (let j = 0; j <= 6; j++) {
      const a = (start + j * 15) * Math.PI / 180;
      points.push(new THREE.Vector3(cx + Math.cos(a) * radius, .53, cz + Math.sin(a) * radius));
    }
  }
  // A closed centripetal spline keeps the ten cars inside the road surface and
  // rounds junctions; no scene, camera, light, physics owner or remote API.
  return new THREE.CatmullRomCurve3(points, true, 'centripetal');
}

export function sampleMetroTraffic(route, seconds, index = 0) {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const distance = route.getLength();
  const phase = ((t * 6.8 / distance + index / METRO_TRAFFIC_COUNT) % 1 + 1) % 1;
  const position = route.getPointAt(phase), tangent = route.getTangentAt(phase);
  return { position, yaw: Math.atan2(tangent.x, tangent.z) };
}

/** Local runtime owns cloned materials and traffic resources, not cached GLB geometry. */
export function createMetroIslandRuntime(sourceScene) {
  const group = new THREE.Group();
  group.name = 'metro-island-original-blender-city';
  group.position.set(...METRO_ORIGIN);
  const city = sourceScene.clone(true), materials = new Map(), emissive = [];
  city.name = 'metro-island-cached-gltf-clone';
  city.traverse(node => {
    if (!node.isMesh) return;
    const clone = value => {
      if (!materials.has(value)) {
        const m = value.clone();
        m.envMapIntensity = /glass|window/.test(m.name) ? 1.9 : .65;
        if (/glass|window/.test(m.name)) m.color.setRGB(.15, .23, .28);
        if (/foliage/.test(m.name)) {
          m.transparent = false; m.alphaTest = .16;
          m.alphaToCoverage = true; m.side = THREE.DoubleSide;
          m.depthWrite = true;
        }
        if (/window-lit/.test(m.name)) {
          m.emissive.set(m.name.endsWith('warm') ? '#ffd394' : m.name.endsWith('cool') ? '#b3d7ed' : '#ece8d7');
          m.emissiveIntensity = 0;
          emissive.push({ material: m, strength: .65 });
        } else if (m.name === 'metro-architectural-light') {
          m.emissive.set('#ffe2ad'); m.emissiveIntensity = 0;
          emissive.push({ material: m, strength: 1.2 });
        }
        materials.set(value, m);
      }
      return materials.get(value);
    };
    node.material = Array.isArray(node.material) ? node.material.map(clone) : clone(node.material);
    node.receiveShadow = true;
    // Thin leaves cast detailed silhouettes; glazing should not shadow through
    // the shell and force 10k tiny second-pass window draw primitives.
    node.castShadow = !/glass|window|architectural-light|road-/.test(node.name);
  });
  group.add(city);

  const route = createMetroRoute(), traffic = new THREE.Group();
  traffic.name = 'ten-road-aligned-instanced-electric-cars'; group.add(traffic);
  const resources = new Set(), batches = [];
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .26, metalness: .56 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: '#11202a', roughness: .18, metalness: .6 });
  const tireMaterial = new THREE.MeshStandardMaterial({ color: '#161a1b', roughness: .94 });
  const lampMaterial = new THREE.MeshStandardMaterial({ color: '#e8e7db', emissive: '#e7eedf', emissiveIntensity: .1, roughness: .3 });
  const rearMaterial = new THREE.MeshStandardMaterial({ color: '#99191b', emissive: '#ff161c', emissiveIntensity: .18, roughness: .3 });
  for (const m of [bodyMaterial, darkMaterial, tireMaterial, lampMaterial, rearMaterial]) resources.add(m);
  function batch(name, geometry, material, count, offsets) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
    traffic.add(mesh); resources.add(geometry); batches.push({ mesh, offsets });
    return mesh;
  }
  const body = batch('metro-car-painted-bodies', new THREE.BoxGeometry(1.82, .58, 4.1), bodyMaterial, METRO_TRAFFIC_COUNT, [[0, 0, 0]]);
  const colors = ['#b7c1c7', '#384c5d', '#c7c6bc', '#9eaea8', '#d9d9d3', '#3d4956', '#8a5c50', '#596a74', '#b9aaa0', '#414c53'];
  for (let i = 0; i < METRO_TRAFFIC_COUNT; i++) body.setColorAt(i, new THREE.Color(colors[i]));
  batch('metro-car-roof-and-glazing', new THREE.BoxGeometry(1.57, .58, 2.15), darkMaterial, METRO_TRAFFIC_COUNT, [[0, .48, -.23]]);
  const tireGeometry = new THREE.CylinderGeometry(.35, .35, .19, 10); tireGeometry.rotateZ(Math.PI / 2);
  batch('metro-car-tires', tireGeometry, tireMaterial, METRO_TRAFFIC_COUNT * 4, [[-.91, -.15, -1.28], [.91, -.15, -1.28], [-.91, -.15, 1.28], [.91, -.15, 1.28]]);
  batch('metro-car-front-headlights', new THREE.BoxGeometry(.36, .13, .035), lampMaterial, METRO_TRAFFIC_COUNT * 2, [[-.52, -.03, 2.06], [.52, -.03, 2.06]]);
  batch('metro-car-red-tail-lights', new THREE.BoxGeometry(.38, .13, .035), rearMaterial, METRO_TRAFFIC_COUNT * 2, [[-.52, -.03, -2.06], [.52, -.03, -2.06]]);
  const base = new THREE.Matrix4(), local = new THREE.Matrix4(), matrix = new THREE.Matrix4(), q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), unit = new THREE.Vector3(1, 1, 1), offset = new THREE.Vector3();
  let motion = 0, disposed = false;
  function update(worldTimeMs = 0, { seconds = 0, reducedMotion = false } = {}) {
    if (disposed) return;
    const night = clamp(sampleDayNight(worldTimeMs).nightOpacity);
    for (const e of emissive) e.material.emissiveIntensity = e.strength * night;
    lampMaterial.emissiveIntensity = .12 + night * 2.2;
    rearMaterial.emissiveIntensity = .25 + night * 1.5;
    if (!reducedMotion && Number.isFinite(seconds)) motion = Math.max(0, seconds);
    for (let i = 0; i < METRO_TRAFFIC_COUNT; i++) {
      const sample = sampleMetroTraffic(route, motion, i);
      q.setFromAxisAngle(up, sample.yaw); base.compose(sample.position, q, unit);
      for (const b of batches) b.offsets.forEach((p, k) => {
        local.makeTranslation(...p); matrix.multiplyMatrices(base, local);
        b.mesh.setMatrixAt(i * b.offsets.length + k, matrix);
      });
    }
    for (const b of batches) b.mesh.instanceMatrix.needsUpdate = true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const m of materials.values()) m.dispose();
    resources.forEach(resource => resource.dispose());
    group.clear();
  }
  update(0);
  return { group, update, dispose, city, traffic, materials, route, budget: { addedDrawCalls: batches.length, cars: METRO_TRAFFIC_COUNT, trafficTriangles: 10 * (12 + 12 + 4 * 40 + 2 * 12 + 2 * 12) } };
}
