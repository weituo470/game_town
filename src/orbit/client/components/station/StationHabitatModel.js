import * as THREE from 'three';
import { RING_STATION, stationPoseFrame, sampleRingPath } from '../../../shared/ringStation.js';

// The town, its sea, and these unbuilt districts share one inner-cylinder map.
// A single full-width floor would bury the existing sea, so the developed town
// sector is deliberately left open for its own land / island / bridge meshes.
const SEGMENTS = Math.ceil(RING_STATION.length / 2);
export const STATION_DECK_HEIGHT = 0;
export const STATION_CONNECTORS = Object.freeze({
  north: Object.freeze({ centers: Object.freeze([-24, 24]), width: 8, minZ: -145, maxZ: -38 }),
});
const minZ = RING_STATION.centerZ - RING_STATION.length / 2;
const maxZ = RING_STATION.centerZ + RING_STATION.length / 2;
export const STATION_UNBUILT_LAND = Object.freeze({ minX: -153, maxX: 91, protectedMinZ: -145, protectedMaxZ: 40 });

const rectangle = (center, width, top, thickness) => [
  [center - width / 2, top], [center + width / 2, top],
  [center + width / 2, top - thickness], [center - width / 2, top - thickness],
];

/** Sweep in logical coordinates, then bend every vertex using the shared F. */
function sweptGeometry(profiles, ranges = [[minZ, maxZ]]) {
  const positions = [];
  const point = (z, profile) => stationPoseFrame({ x: profile[0], y: profile[1], z }).position;
  const quad = (a, b, c, d) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const [start, end] of ranges) {
    const segments = Math.ceil((end - start) / 2);
    for (const profile of profiles) for (let segment = 0; segment < segments; segment++) {
      const a = end - (end - start) * segment / segments;
      const b = end - (end - start) * (segment + 1) / segments;
      for (let edge = 0; edge < profile.length; edge++) {
        const next = (edge + 1) % profile.length;
        quad(point(a, profile[edge]), point(a, profile[next]), point(b, profile[next]), point(b, profile[edge]));
      }
    }
    // Close open shore cross-sections. A full circle already joins itself.
    if (end - start < RING_STATION.length - .001) for (const profile of profiles) {
      quad(point(start, profile[0]), point(start, profile[1]), point(start, profile[2]), point(start, profile[3]));
      quad(point(end, profile[3]), point(end, profile[2]), point(end, profile[1]), point(end, profile[0]));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** Owned static geometry; disposal never affects another scene or instance. */
export function createStationHabitat() {
  const group = new THREE.Group();
  group.name = 'Ring city — unbuilt land inside one cylindrical world';
  const geometries = new Set(), materials = new Set(), instances = [];
  const stats = { drawCalls: 0, triangles: 0, buildings: 0, trees: 0, lamps: 0, bridges: 2, instances: 0, pathSegments: SEGMENTS };
  const material = (color, extra = {}) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: 0.83, fog: false, ...extra });
    materials.add(value); return value;
  };
  const cream = material('#e5d9bd');
  const hull = material('#b6c6cb', { roughness: 0.64, metalness: 0.12 });
  const land = material('#879e7b');
  const paving = material('#c6b69b');
  const gold = material('#e8d2a1', { emissive: '#ffd089', emissiveIntensity: 0.32, metalness: 0.1 });
  const mesh = (name, geometry, mat, walkable = false) => {
    geometries.add(geometry);
    const object = new THREE.Mesh(geometry, mat);
    object.name = name;
    object.castShadow = false; object.receiveShadow = false;
    object.userData.walkableSurface = walkable;
    group.add(object);
    stats.drawCalls++;
    stats.triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    return object;
  };

  // Pressure hull is below the sea floor everywhere, including beneath islands.
  mesh('continuous ring seabed hull', sweptGeometry([rectangle(-31, 300, -4.8, 4)]), hull);
  const { minX, maxX, protectedMinZ, protectedMaxZ } = STATION_UNBUILT_LAND;
  mesh('unbuilt ring-city land', sweptGeometry([rectangle((minX + maxX) / 2, maxX - minX, 0, 3.4)], [[minZ, protectedMinZ], [protectedMaxZ, maxZ]]), land, true);
  // Ordinary bridges follow the same curvature as the old harbour, not a
  // separate runway into a background ring. Their surfaces meet at y=0.
  for (const x of STATION_CONNECTORS.north.centers) {
    mesh(`north harbour bridge ${x}`, sweptGeometry([rectangle(x, 8, 0, .8)], [[-145, -38]]), paving, true);
  }
  // A clear 28 m ocean band separates future land from each engineering rim.
  // No structural arc flares through the original town or islands.
  mesh('closed outer porcelain rims', sweptGeometry([
    rectangle(-181, 4.8, 2.2, 11), rectangle(119, 4.8, 2.2, 11),
  ]), cream);
  mesh('subtle rim navigation inlays', sweptGeometry([
    rectangle(-181, .36, 2.24, .08), rectangle(119, .36, 2.24, .08),
  ]), gold);

  const markerGeometry = new THREE.BoxGeometry(.75, .1, 2.2);
  geometries.add(markerGeometry);
  const count = 48;
  const markers = new THREE.InstancedMesh(markerGeometry, gold, count);
  markers.name = 'sparse outer-rim lights';
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), axis = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < count; i++) {
    const frame = sampleRingPath(Math.floor(i / 2) / (count / 2), i % 2 ? 119 : -181, 2.3);
    matrix.compose(new THREE.Vector3(...frame.position), q.setFromAxisAngle(axis, frame.rotationX), new THREE.Vector3(1, 1, 1));
    markers.setMatrixAt(i, matrix);
  }
  markers.instanceMatrix.needsUpdate = true;
  markers.computeBoundingBox(); markers.computeBoundingSphere();
  group.add(markers); instances.push(markers);
  stats.drawCalls++; stats.instances = count; stats.lamps = count; stats.triangles += 12 * count;
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  stats.bounds = bounds.min.toArray().concat(bounds.max.toArray());
  group.userData.stats = Object.freeze(stats);
  group.userData.station = RING_STATION;
  group.userData.walkable = true;
  group.userData.surfaceHeight = STATION_DECK_HEIGHT;
  group.userData.connectors = STATION_CONNECTORS;
  group.userData.unbuiltLand = STATION_UNBUILT_LAND;
  let disposed = false;
  group.userData.dispose = () => {
    if (disposed) return;
    disposed = true;
    instances.forEach(object => object.dispose());
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(value => value.dispose());
    group.userData.disposed = true;
  };
  return group;
}
