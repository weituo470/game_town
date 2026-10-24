import * as THREE from 'three';
import { RING_CITY_BUILDINGS, RING_CITY_DISTRICTS, RING_CITY_PLAZAS, RING_CITY_ROADS } from '../../../shared/ringCity.js';

// All coordinates stay in the shared logical town map. StationWorld is the
// ONLY owner of the cylindrical transform, including these long roads.
const COLORS = Object.freeze({
  wall: ['#eee2c6', '#f2e6ce', '#e7dcc4'], trim: '#fff1d7', base: '#d6c7a9',
  roof: ['#b7a4d0', '#8eb8b7', '#d79a85', '#a8b9ce', '#c7b38a', '#a6bd99'],
  glass: '#6f9ca6', door: '#688c8c', wood: '#a67f5c', iron: '#788b8a',
  grass: '#95ad85', leaves: ['#89a577', '#a9ba88', '#779d88'], light: '#fff1bc',
});

/** A low, clipped gable has a real flat ridge at the shared roof ceiling. */
function gableGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-.5, 0); shape.lineTo(.5, 0); shape.lineTo(.5, .08);
  shape.lineTo(.14, 1); shape.lineTo(-.14, 1); shape.lineTo(-.5, .08); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, steps: 1, bevelEnabled: false, curveSegments: 1 });
  geometry.translate(0, 0, -.5);
  return geometry;
}

/** An open semicircular arch, not a dark window painted onto a solid wall. */
function archGeometry() {
  const points = [];
  for (let i = 0; i <= 12; i++) { const t = i * Math.PI / 12; points.push([.5 * Math.cos(t), .5 * Math.sin(t)]); }
  for (let i = 12; i >= 0; i--) { const t = i * Math.PI / 12; points.push([.37 * Math.cos(t), .37 * Math.sin(t)]); }
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, steps: 1, bevelEnabled: false, curveSegments: 1 });
  geometry.translate(0, 0, -.5);
  return geometry;
}

// Subdivision happens in metres before the generic mapper bends the road.
// The 1.35 m grid avoids a single huge triangle spanning the station horizon.
function roadGeometry(roads) {
  const positions = [], normals = [], colors = [];
  const vertex = (x, y, z, color) => { positions.push(x, y, z); normals.push(0, 1, 0); colors.push(color.r, color.g, color.b); };
  for (const road of roads) {
    const nx = Math.ceil(road.width / 1.35), nz = Math.ceil(road.depth / 1.35);
    const minX = road.x - road.width / 2, minZ = road.z - road.depth / 2;
    const color = new THREE.Color(road.kind === 'main' ? '#cfbea0' : '#c7bba4');
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      const x0 = minX + road.width * ix / nx, x1 = minX + road.width * (ix + 1) / nx;
      const z0 = minZ + road.depth * iz / nz, z1 = minZ + road.depth * (iz + 1) / nz;
      // Crossroads have a tiny consistent lift to prevent coplanar z-fighting.
      const y = road.height + (road.kind === 'cross' ? .002 : 0);
      vertex(x0, y, z0, color); vertex(x0, y, z1, color); vertex(x1, y, z1, color);
      vertex(x0, y, z0, color); vertex(x1, y, z1, color); vertex(x1, y, z0, color);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Sparse, real street blocks. Owned resources, deterministic layout, no signs
 * promising shops, no interaction targets, no repeated copies of the old town.
 */
export function createRingCityModel() {
  const group = new THREE.Group();
  group.name = 'Ring city — first low-density neighbourhoods';
  const geometries = new Set(), materials = new Set(), instances = [];
  const ownGeometry = geometry => { geometries.add(geometry); return geometry; };
  const material = options => { const value = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .88, ...options }); materials.add(value); return value; };
  const matte = material({}), glass = material({ roughness: .44, metalness: .06 });
  const glow = material({ emissive: '#ffe4a4', emissiveIntensity: .28 });
  const roadMaterial = material({ vertexColors: true });
  const shapes = {
    box: ownGeometry(new THREE.BoxGeometry(1, 1, 1)),
    cylinder: ownGeometry(new THREE.CylinderGeometry(.5, .5, 1, 12)),
    gable: ownGeometry(gableGeometry()), arch: ownGeometry(archGeometry()),
    dome: ownGeometry(new THREE.SphereGeometry(.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
    leaf: ownGeometry(new THREE.IcosahedronGeometry(.5, 1)),
  };
  const batches = new Map();
  const stats = { buildings: RING_CITY_BUILDINGS.length, roads: RING_CITY_ROADS.length, districts: RING_CITY_DISTRICTS.length,
    plazas: RING_CITY_PLAZAS.length, trees: 0, lamps: 0, benches: 0, drawCalls: 0, triangles: 0, instances: 0 };
  const add = (shape, at, size, color, meta = {}, yaw = 0, mat = matte) => {
    const key = `${shape}:${mat.uuid}`;
    if (!batches.has(key)) batches.set(key, { shape, material: mat, entries: [] });
    batches.get(key).entries.push({ at, size, color, yaw, meta });
  };
  const box = (at, size, color, meta, yaw = 0, mat = matte) => add('box', at, size, color, meta, yaw, mat);

  const roads = new THREE.Mesh(ownGeometry(roadGeometry(RING_CITY_ROADS)), roadMaterial);
  roads.name = 'continuous ring neighbourhood roads';
  roads.receiveShadow = true;
  roads.userData.roadIds = RING_CITY_ROADS.map(road => road.id);
  roads.userData.walkableSurface = true;
  group.add(roads);
  stats.drawCalls++; stats.triangles += roads.geometry.attributes.position.count / 3;

  const districtById = new Map(RING_CITY_DISTRICTS.map(district => [district.id, district]));
  for (const building of RING_CITY_BUILDINGS) {
    const { width: w, depth: d, height: h, wallHeight: wall, roofHeight: roof } = building;
    const facing = building.z > districtById.get(building.district).z ? Math.PI : 0;
    const sign = facing === 0 ? 1 : -1;
    const wallColor = COLORS.wall[building.colorIndex % COLORS.wall.length];
    const roofColor = COLORS.roof[building.colorIndex % COLORS.roof.length];
    const part = (shape, role, at, size, color, yaw = 0, mat = matte) => add(shape,
      [building.x + at[0] * sign, at[1], building.z + at[2] * sign], size, color,
      { buildingId: building.id, role }, facing + yaw, mat);
    const wallBox = (role, at, size, color = wallColor, yaw = 0, mat = matte) => part('box', role, at, size, color, yaw, mat);
    wallBox('foundation', [0, .12, 0], [w * .98, .24, d * .98], COLORS.base);

    if (building.style === 'shop') {
      // Small community/service pavilion. The shallow dome fits the shared
      // maximum height, and the round cap is a real little landing surface.
      part('cylinder', 'walls', [0, wall / 2, 0], [w * .84, wall, d * .84], wallColor);
      part('cylinder', 'roof eave', [0, wall - .08, 0], [w * .95, .16, d * .95], COLORS.trim);
      part('dome', 'roof', [0, wall, 0], [w * .95, roof * 2, d * .95], roofColor);
      part('cylinder', 'roof landing cap', [0, h - .025, 0], [w * .13, .05, d * .13], roofColor);
      wallBox('door surround', [0, 1.16, d * .412], [1.45, 2.3, .16], COLORS.trim);
      wallBox('door', [0, 1.08, d * .427], [1.12, 2.1, .10], COLORS.door, 0, glass);
      wallBox('door handle', [.34, 1.1, d * .44], [.07, .32, .08], COLORS.base);
      for (const side of [-1, 1]) {
        wallBox('window frame', [side * w * .26, 2.2, d * .31], [w * .18, 1.12, .2], COLORS.trim);
        wallBox('window glass', [side * w * .26, 2.2, d * .327], [w * .135, .83, .1], COLORS.glass, 0, glass);
      }
    } else {
      const arcade = building.style === 'flat';
      const bodyDepth = arcade ? d * .70 : d * .84;
      const bodyZ = arcade ? -d * .08 : 0;
      const front = bodyZ + bodyDepth / 2;
      wallBox('walls', [0, wall / 2, bodyZ], [w * .84, wall, bodyDepth]);
      wallBox('lower belt', [0, .38, bodyZ], [w * .88, .18, bodyDepth + .12], COLORS.trim);
      if (building.floors > 1) wallBox('floor belt', [0, wall * .51, bodyZ], [w * .88, .18, bodyDepth + .12], COLORS.trim);
      wallBox('door surround', [0, 1.12, front + .07], [1.35, 2.24, .18], COLORS.trim);
      wallBox('door', [0, 1.05, front + .18], [1.04, 2.07, .1], COLORS.door, 0, glass);
      wallBox('door handle', [.3, 1.04, front + .245], [.07, .29, .06], COLORS.base);
      wallBox('entry step', [0, .16, Math.min(d * .445, front + .28)], [1.8, .28, .65], COLORS.base);
      for (let floor = 0; floor < building.floors; floor++) {
        const y = floor === 0 ? 1.9 : wall * .74;
        for (const side of [-1, 1]) {
          const x = side * w * .255;
          wallBox('window surround', [x, y, front + .09], [w * .205, 1.3, .2], COLORS.trim);
          wallBox('window glass', [x, y, front + .205], [w * .155, 1.02, .06], COLORS.glass, 0, glass);
          wallBox('window mullion', [x, y, front + .25], [.08, 1.04, .06], COLORS.trim);
          wallBox('window sill', [x, y - .68, front + .19], [w * .23, .15, .34], COLORS.trim);
          // Side windows make the building legible from the circumference too.
          wallBox('side window surround', [side * (w * .42 + .035), y, bodyZ], [.14, 1.3, d * .22], COLORS.trim);
          wallBox('side window glass', [side * (w * .42 + .12), y, bodyZ], [.04, 1.02, d * .16], COLORS.glass, 0, glass);
        }
      }
      if (arcade) {
        const porchZ = d * .40, archWidth = w * .32;
        for (const x of [-w * .32, 0, w * .32]) {
          wallBox('arcade column', [x, 1.0, porchZ], [.28, 2.0, .3], COLORS.trim);
        }
        for (const x of [-w * .16, w * .16]) part('arch', 'open arcade arch', [x, 1.85, porchZ], [archWidth, 1.48, .32], COLORS.trim);
        wallBox('porch canopy', [0, 2.74, d * .355], [w * .93, .22, d * .23], roofColor);
        wallBox('roof eave', [0, wall + .08, 0], [w * .96, .16, d * .94], COLORS.trim);
        wallBox('roof', [0, wall + roof / 2, 0], [w * .9, roof, d * .86], roofColor);
        // Keep the flat-roof building's full envelope inside its data footprint.
      } else {
        wallBox('roof eave', [0, wall - .06, 0], [w * .97, .18, d * .97], COLORS.trim);
        part('gable', 'roof', [0, wall, 0], [w * .98, roof, d * .98], roofColor);
        wallBox('door canopy', [0, 2.38, Math.min(d * .46, front + .13)], [1.8, .13, .5], roofColor);
      }
    }
  }

  // Each neighbourhood gets one deliberately open commons, not another row
  // of filler buildings. Props sit inside these commons, away from all roads.
  for (let index = 0; index < RING_CITY_PLAZAS.length; index++) {
    const plaza = RING_CITY_PLAZAS[index], { x, z, width: w, depth: d } = plaza;
    const meta = role => ({ plazaId: plaza.id, role });
    box([x, .035, z], [w, .07, d], plaza.kind === 'garden' ? COLORS.grass : '#d6c8af', meta('commons surface'));
    if (plaza.kind === 'garden') box([x, .075, z], [3, .05, d], '#d6c8af', meta('garden path'));
    else box([x, .08, z], [w * .44, .08, d * .44], COLORS.grass, meta('commons lawn'));
    for (const side of [-1, 1]) {
      const tx = x + side * w * .32, tz = z - d * .28;
      add('cylinder', [tx, .95, tz], [.34, 1.9, .34], COLORS.wood, meta('tree trunk'));
      add('leaf', [tx - .38, 2.85, tz], [2.5, 2.7, 2.5], COLORS.leaves[(index + 1) % 3], meta('tree crown'));
      add('leaf', [tx + .55, 2.7, tz + .15], [2.25, 2.45, 2.3], COLORS.leaves[index % 3], meta('tree crown'));
      stats.trees++;
      const lx = x + side * w * .38, lz = z + d * .34;
      add('cylinder', [lx, 1.65, lz], [.15, 3.3, .15], COLORS.iron, meta('lamp post'));
      box([lx, 3.29, lz], [.6, .18, .6], COLORS.iron, meta('lamp cap'));
      box([lx, 3.05, lz], [.4, .38, .4], COLORS.light, meta('lamp diffuser'), 0, glow);
      stats.lamps++;
      const bx = x + side * w * .28, bz = z + .7;
      box([bx, .56, bz], [2.1, .16, .6], COLORS.wood, meta('bench seat'));
      box([bx, .94, bz - .27], [2.1, .55, .12], COLORS.wood, meta('bench back'));
      for (const leg of [-1, 1]) box([bx + leg * .72, .29, bz], [.13, .5, .48], COLORS.iron, meta('bench leg'));
      stats.benches++;
    }
  }

  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0), position = new THREE.Vector3(), scale = new THREE.Vector3();
  for (const { shape, material: mat, entries } of batches.values()) {
    const geometry = shapes[shape], mesh = new THREE.InstancedMesh(geometry, mat, entries.length);
    mesh.name = `ring city ${shape} ${mat === glass ? 'glazing' : mat === glow ? 'lamps' : 'details'}`;
    mesh.userData.parts = entries.map(entry => entry.meta);
    mesh.castShadow = mat !== glow; mesh.receiveShadow = true;
    entries.forEach((entry, index) => {
      matrix.compose(position.fromArray(entry.at), quaternion.setFromAxisAngle(axis, entry.yaw), scale.fromArray(entry.size));
      // These buildings face 0 or PI. Remove sin(PI) residue so a roof's
      // shared centre edge stays watertight for exact-centre collision rays.
      for (let k = 0; k < 16; k++) if (Math.abs(matrix.elements[k]) < 1e-12) matrix.elements[k] = 0;
      mesh.setMatrixAt(index, matrix); mesh.setColorAt(index, new THREE.Color(entry.color));
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    group.add(mesh); instances.push(mesh);
    stats.drawCalls++; stats.instances += entries.length;
    stats.triangles += entries.length * (geometry.index?.count ?? geometry.attributes.position.count) / 3;
  }
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  stats.bounds = bounds.min.toArray().concat(bounds.max.toArray());
  stats.geometries = geometries.size; stats.materials = materials.size;
  group.userData.stats = Object.freeze(stats);
  group.userData.layout = { buildings: RING_CITY_BUILDINGS, roads: RING_CITY_ROADS, plazas: RING_CITY_PLAZAS };
  group.userData.coordinateSpace = 'logical';
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
