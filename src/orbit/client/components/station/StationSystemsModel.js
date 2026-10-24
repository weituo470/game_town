import * as THREE from 'three';
import { RING_STATION } from '../../../shared/ringStation.js';
import { STATION_CABIN } from '../../../shared/stationCabin.js';
import { stationPhaseAt } from '../../../shared/stationPhysics.js';
import { sampleStationLighting, STATION_SUN_DIRECTION } from '../../../shared/stationLighting.js';

// A closed geometric boundary, NOT a gas solver or a certified pressure vessel.
// The existing terrain/hull stays intact inside it. R159.4 avoids coplanar
// surfaces with the old R158.8 seabed. The inner roof gives 72 m ground clearance.
export const STATION_SYSTEMS = Object.freeze({
  outerRadius: STATION_CABIN.outerRadius, roofRadius: STATION_CABIN.roofRadius, roofHeight: STATION_CABIN.roofHeight,
  minX: STATION_CABIN.minX, maxX: STATION_CABIN.maxX,
  segments: 512, primaryRibs: 16, longitudinalFrames: 32,
  lightXs: Object.freeze([-116, -31, 54]), lightRadius: 79,
  pointLights: 4, coreRadius: 6, coreAccessible: false,
});
const NO_HIT = () => {};
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const CENTER = new THREE.Vector3(RING_STATION.centerX, RING_STATION.centerY, RING_STATION.centerZ);
const circlePoint = (x, radius, angle) => new THREE.Vector3(x, CENTER.y - radius * Math.cos(angle), CENTER.z - radius * Math.sin(angle));

/** Four shared vertex rings, no unsealed angular seam or missing end caps. */
function pressureBoundaryGeometry() {
  const { segments, minX, maxX, outerRadius, roofRadius } = STATION_SYSTEMS;
  const profile = [[minX, outerRadius], [maxX, outerRadius], [maxX, roofRadius], [minX, roofRadius]];
  const positions = [], indices = [];
  for (const [x, r] of profile) for (let i = 0; i < segments; i++) positions.push(...circlePoint(x, r, i / segments * Math.PI * 2).toArray());
  const geometry = new THREE.BufferGeometry();
  for (let edge = 0; edge < 4; edge++) {
    const start = indices.length;
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments, row = (edge + 1) % 4;
      const a = edge * segments + i, b = row * segments + i, c = row * segments + next, d = edge * segments + next;
      indices.push(a, c, b, a, d, c);
    }
    geometry.addGroup(start, indices.length - start, [0, 1, 2, 1][edge]);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.closedPressureBoundary = true;
  return geometry;
}

// A broad paint/inspection panel just outside the real hull, not a screen-space
// decal. Its arc is tessellated so it never cuts through the cylinder.
function exteriorMarkerGeometry() {
  const positions = [], normals = [];
  const radius = STATION_SYSTEMS.outerRadius + .1, segments = 24;
  const vertex = (x, angle) => {
    positions.push(x, -radius * Math.cos(angle), -radius * Math.sin(angle));
    normals.push(0, -Math.cos(angle), -Math.sin(angle));
  };
  for (let i = 0; i < segments; i++) {
    const a = -.08 + .16 * i / segments, b = -.08 + .16 * (i + 1) / segments;
    vertex(-.5, a); vertex(.5, b); vertex(.5, a);
    vertex(-.5, a); vertex(-.5, b); vertex(.5, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

export function createStationSystemsModel() {
  const root = new THREE.Group();
  root.name = 'station pressure enclosure and utility systems';
  root.userData.stationSpace = 'raw';
  root.userData.coordinateSpace = 'world';
  root.userData.simulation = 'closed geometry only; no atmosphere or stress solver';
  const geometries = new Set(), materials = new Set(), instanceMeshes = [];
  const own = geometry => { geometries.add(geometry); return geometry; };
  const material = options => {
    const result = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .76, ...options });
    materials.add(result); return result;
  };
  const cream = material({ roughness: .82 });
  const hull = material({ color: '#a6bac0', metalness: .12, side: THREE.DoubleSide });
  const wall = material({ color: '#cee9ec', transparent: true, opacity: .075, roughness: .25, side: THREE.DoubleSide, depthWrite: false });
  const roof = material({ color: '#d8eff0', transparent: true, opacity: .045, roughness: .16, side: THREE.DoubleSide, depthWrite: false });
  // A single transparent pass avoids doubling the tint on the same pane.
  wall.forceSinglePass = true; roof.forceSinglePass = true;
  const lamp = material({ color: '#fff0cf', emissive: '#fff0cf', emissiveIntensity: 2.2, toneMapped: false });
  const hardware = material({ metalness: .2 });
  const unitBox = own(new THREE.BoxGeometry(1, 1, 1));
  const unitCylinder = own(new THREE.CylinderGeometry(.5, .5, 1, 16));
  const primaryRing = own(new THREE.TorusGeometry(78.75, .38, 4, 192));
  const rimRing = own(new THREE.TorusGeometry(159.0, .85, 6, 192));
  const bearingRing = own(new THREE.TorusGeometry(9, 1, 6, 64));
  const lightRing = own(new THREE.TorusGeometry(79, .32, 6, 192));
  const portRing = own(new THREE.TorusGeometry(6.7, .6, 6, 48));
  const exteriorMarker = own(exteriorMarkerGeometry());
  const batches = [];
  const batch = (parent, name, geometry, mat) => {
    const result = { parent, name, geometry, material: mat, entries: [] }; batches.push(result); return result;
  };
  const add = (batch, at, size, color = '#fff1d7', quaternion = new THREE.Quaternion(), role = '') => {
    batch.entries.push({ at: at.isVector3 ? at.clone() : new THREE.Vector3(...at), size: new THREE.Vector3(...size), color, quaternion: quaternion.clone(), role });
  };
  const along = (batch, a, b, width, depth, color, role) => {
    const direction = b.clone().sub(a);
    add(batch, a.clone().add(b).multiplyScalar(.5), [width, direction.length(), depth], color,
      new THREE.Quaternion().setFromUnitVectors(Y_AXIS, direction.normalize()), role);
  };
  const faceX = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI / 2);
  const cylinderX = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, Math.PI / 2);
  const opaque = batch(root, 'cream pressure frames and exterior bearing supports', unitBox, cream);
  const ribs = batch(root, 'sixteen primary circular roof ribs', primaryRing, cream);
  const rims = batch(root, 'end pressure-hull rings', rimRing, cream);
  const bearings = batch(root, 'rotating end bearing collars', bearingRing, hardware);
  const lamps = batch(root, 'three continuous artificial daylight bands', lightRing, lamp);
  const lampNodes = batch(root, 'four visible internal light modules', unitBox, lamp);
  const hullMarkers = batch(root, 'asymmetric exterior hull inspection bands', exteriorMarker, hardware);
  const pressure = new THREE.Mesh(own(pressureBoundaryGeometry()), [hull, wall, roof]);
  pressure.name = 'closed annular pressure boundary';
  pressure.raycast = NO_HIT; pressure.castShadow = false; pressure.receiveShadow = false;
  pressure.renderOrder = 2;
  pressure.userData.closedPressureBoundary = true;
  root.add(pressure);
  // Unequal positions, lengths and colours make actual rotation readable from
  // the external camera without text, blinking arrows or covering the city.
  for (const marker of [
    { angle: .35, x: -31, length: 276, color: '#527e83' },
    { angle: 2.0, x: -75, length: 180, color: '#d9bd83' },
    { angle: 4.6, x: 15, length: 160, color: '#527e83' },
  ]) {
    add(hullMarkers, [marker.x, CENTER.y, CENTER.z], [marker.length, 1, 1], marker.color,
      new THREE.Quaternion().setFromAxisAngle(X_AXIS, marker.angle), 'exterior inspection band');
  }
  for (let i = 0; i < STATION_SYSTEMS.primaryRibs; i++) {
    const x = STATION_SYSTEMS.minX + RING_STATION.width * i / (STATION_SYSTEMS.primaryRibs - 1);
    add(ribs, [x, CENTER.y, CENTER.z], [1, 1, 1], '#e6dcc3', faceX, 'main rib');
  }
  for (let i = 0; i < STATION_SYSTEMS.longitudinalFrames; i++) {
    const angle = i * Math.PI * 2 / STATION_SYSTEMS.longitudinalFrames;
    const q = new THREE.Quaternion().setFromAxisAngle(X_AXIS, angle);
    add(opaque, circlePoint(CENTER.x, 78.55, angle), [RING_STATION.width, .22, .22], '#d0d9cd', q, 'fine roof frame');
    for (const x of [STATION_SYSTEMS.minX, STATION_SYSTEMS.maxX]) {
      along(opaque, circlePoint(x, 78, angle), circlePoint(x, 159.4, angle), .65, .65, '#d4d6c6', 'end pressure-wall rib');
    }
  }
  for (const x of [STATION_SYSTEMS.minX, STATION_SYSTEMS.maxX]) add(rims, [x, CENTER.y, CENTER.z], [1, 1, 1], '#e6dcc3', faceX, 'hull end ring');
  for (const x of STATION_SYSTEMS.lightXs) add(lamps, [x, CENTER.y, CENTER.z], [1, 1, 1], '#fff0cf', faceX, 'artificial daylight band');

  // Bearings and trusses are outside the pressure ends; there is deliberately
  // no open corridor from the inhabited ring to this not-yet-accessible hub.
  for (const side of [-1, 1]) {
    const endX = CENTER.x + side * 158;
    add(bearings, [endX, CENTER.y, CENTER.z], [1, 1, 1], '#b4c2c2', faceX, 'rotating bearing');
    for (let i = 0; i < 4; i++) {
      const angle = (i + .5) * Math.PI / 2;
      along(opaque, circlePoint(endX, 10, angle), circlePoint(endX, 159, angle), 1.1, 1.1, '#bec9c4', 'closed maintenance truss');
      along(opaque, circlePoint(endX, 159, angle), circlePoint(CENTER.x + side * 150, 159, angle), 1.3, 1.3, '#e6dcc3', 'end truss anchor');
    }
  }

  const nonRotating = new THREE.Group();
  nonRotating.name = 'non-rotating service and docking core — not open';
  nonRotating.position.copy(CENTER);
  nonRotating.userData.accessible = false;
  nonRotating.userData.referenceFrame = 'inertial';
  root.add(nonRotating);
  const coreBoxes = batch(nonRotating, 'external solar wings radiators and hub details', unitBox, hardware);
  const coreCylinders = batch(nonRotating, 'non-rotating axial core and sealed docking ends', unitCylinder, hardware);
  const ports = batch(nonRotating, 'sealed docking collars — no player access', portRing, hardware);
  add(coreCylinders, [0, 0, 0], [8, 338, 8], '#afc1c7', cylinderX, 'unopened axial core');
  add(coreCylinders, [0, 0, 0], [12, 62, 12], '#e8dfc7', cylinderX, 'service core');
  const solarQ = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, new THREE.Vector3(...STATION_SUN_DIRECTION));
  const radiatorNormal = new THREE.Vector3(...STATION_SUN_DIRECTION).cross(X_AXIS).normalize();
  const radiatorQ = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, radiatorNormal);
  for (const side of [-1, 1]) {
    add(coreCylinders, [side * 171, 0, 0], [12, 12, 12], '#d6ded6', cylinderX, 'sealed docking module');
    add(ports, [side * 177, 0, 0], [1, 1, 1], '#c3a879', faceX, 'docking collar');
    add(coreCylinders, [side * 177.2, 0, 0], [9.6, .35, 9.6], '#516b7a', cylinderX, 'closed docking hatch');
    for (const wing of [-1, 1]) {
      const solarCenter = new THREE.Vector3(side * 207, wing * 26, 0);
      // Rotate the solar panel itself toward the shared inertial sun. The
      // entire hardware group then receives Q(-phase), never a second warp.
      add(coreBoxes, solarCenter, [25, 39, .65], '#657b8d', solarQ, 'solar frame');
      add(coreBoxes, solarCenter.clone().add(new THREE.Vector3(0, 0, .4).applyQuaternion(solarQ)), [23.7, 37.7, .08], '#315777', solarQ, 'solar cells');
      for (let line = -2; line <= 2; line++) {
        add(coreBoxes, solarCenter.clone().add(new THREE.Vector3(line * 4.7, 0, .49).applyQuaternion(solarQ)), [.1, 37.7, .08], '#91b4c2', solarQ, 'solar cell seam');
      }
      for (let line = -3; line <= 3; line++) {
        add(coreBoxes, solarCenter.clone().add(new THREE.Vector3(0, line * 5.2, .5).applyQuaternion(solarQ)), [23.7, .1, .08], '#91b4c2', solarQ, 'solar cell seam');
      }
      along(coreBoxes, new THREE.Vector3(side * 174, 0, 0), solarCenter, .8, .8, '#aebfc3', 'solar support');
      const radiatorCenter = new THREE.Vector3(side * 198, 0, wing * 31);
      add(coreBoxes, radiatorCenter, [19, 31, .55], '#d9e5df', radiatorQ, 'heat radiator');
      for (let line = -2; line <= 2; line++) {
        add(coreBoxes, radiatorCenter.clone().add(new THREE.Vector3(line * 3.2, 0, .33).applyQuaternion(radiatorQ)), [.16, 29, .08], '#a3c0c5', radiatorQ, 'radiator coolant channel');
      }
      along(coreBoxes, new THREE.Vector3(side * 174, 0, 0), radiatorCenter, .65, .65, '#b1c3c3', 'radiator support');
    }
  }
  const pointLights = [];
  for (let i = 0; i < STATION_SYSTEMS.pointLights; i++) {
    const angle = i * Math.PI / 2, at = circlePoint(CENTER.x, STATION_SYSTEMS.lightRadius + .25, angle);
    add(lampNodes, at, [3.2, .35, 2.4], '#fff0cf', new THREE.Quaternion().setFromAxisAngle(X_AXIS, angle), 'light source');
    const light = new THREE.PointLight('#fff0d0', 10000, 380, 2);
    light.name = `internal daylight source ${i + 1}`;
    light.position.copy(at); light.castShadow = false;
    root.add(light); pointLights.push(light);
  }
  const transform = new THREE.Matrix4();
  let triangles = pressure.geometry.index.count / 3, drawCalls = pressure.geometry.groups.length, instanceCount = 0;
  for (const entry of batches) {
    if (!entry.entries.length) continue;
    const mesh = new THREE.InstancedMesh(entry.geometry, entry.material, entry.entries.length);
    mesh.name = entry.name; mesh.raycast = NO_HIT;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.userData.roles = entry.entries.map(item => item.role);
    entry.entries.forEach((item, index) => {
      transform.compose(item.at, item.quaternion, item.size);
      for (let k = 0; k < 16; k++) if (Math.abs(transform.elements[k]) < 1e-12) transform.elements[k] = 0;
      mesh.setMatrixAt(index, transform); mesh.setColorAt(index, new THREE.Color(item.color));
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    entry.parent.add(mesh); instanceMeshes.push(mesh);
    drawCalls++; instanceCount += mesh.count;
    triangles += (entry.geometry.index?.count ?? entry.geometry.attributes.position.count) / 3 * mesh.count;
  }
  root.userData.systems = { pressure, nonRotating, lampMaterial: lamp, pointLights };
  root.userData.stats = Object.freeze({
    closedPressureBoundaries: 1, roofHeight: STATION_SYSTEMS.roofHeight,
    primaryRibs: STATION_SYSTEMS.primaryRibs, pointLights: pointLights.length,
    solarWings: 4, radiatorWings: 4, exteriorMarkers: 3, coreAccessible: false,
    drawCalls, triangles, instances: instanceCount, geometries: geometries.size, materials: materials.size,
  });
  root.updateMatrixWorld(true);
  let disposed = false;
  root.userData.dispose = () => {
    if (disposed) return;
    disposed = true;
    instanceMeshes.forEach(mesh => mesh.dispose());
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(value => value.dispose());
    root.userData.disposed = true;
  };
  return root;
}

/** Absolute physical phase is independent from the artificial day/night dial. */
export function updateStationSystemsModel(model, physicsTimeMs = 0, lightingTimeMs = 0) {
  if (!model || model.userData.disposed) return;
  const { nonRotating, lampMaterial, pointLights } = model.userData.systems;
  const phase = stationPhaseAt(physicsTimeMs);
  const { daylight } = sampleStationLighting(physicsTimeMs, lightingTimeMs);
  nonRotating.quaternion.setFromAxisAngle(X_AXIS, -phase);
  lampMaterial.emissiveIntensity = .35 + daylight * 1.85;
  for (const light of pointLights) light.intensity = 1000 + daylight * 9000;
  model.userData.phase = phase;
  model.userData.daylight = daylight;
}
