import * as THREE from 'three';
import { RING_STATION } from '../../../shared/ringStation.js';

// This adapter changes *real* geometry/matrixWorld, not a beauty-pass shader.
// Consequently HTML anchors, lights, shadows and Three's raycaster see F too.
const OWNED = Symbol('station-world-owned');
const identity = new THREE.Matrix4();
const boundsCache = new WeakMap();

export function stationWorldPoint(point, target = new THREE.Vector3()) {
  const theta = (RING_STATION.centerZ - point.z) / RING_STATION.radius;
  const radial = point.y - RING_STATION.radius;
  return target.set(point.x, RING_STATION.radius + radial * Math.cos(theta), RING_STATION.centerZ + radial * Math.sin(theta));
}

/** The rigid local frame at the logical origin; scale/rotation stay intact. */
export function stationWorldMatrix(logical, target = new THREE.Matrix4()) {
  const e = target === logical ? logical.elements.slice() : logical.elements;
  const theta = (RING_STATION.centerZ - e[14]) / RING_STATION.radius;
  const c = Math.cos(theta), s = Math.sin(theta);
  target.copy(logical);
  const out = target.elements;
  for (const offset of [0, 4, 8]) {
    out[offset + 1] = c * e[offset + 1] - s * e[offset + 2];
    out[offset + 2] = s * e[offset + 1] + c * e[offset + 2];
  }
  out[12] = e[12]; out[13] = RING_STATION.radius + (e[13] - RING_STATION.radius) * c;
  out[14] = RING_STATION.centerZ + (e[13] - RING_STATION.radius) * s;
  return target;
}

function geometryBounds(geometry) {
  const attribute = geometry.getAttribute('position');
  const previous = boundsCache.get(geometry);
  if (previous?.attribute === attribute && previous.version === attribute.version) return previous.box;
  const box = new THREE.Box3().setFromBufferAttribute(attribute);
  boundsCache.set(geometry, { attribute, version: attribute.version, box });
  return box;
}

export function stationGeometrySpan(geometry, logical) {
  const box = geometryBounds(geometry).clone().applyMatrix4(logical);
  return box.max.z - box.min.z;
}

function needsBake(geometry, logical, threshold) {
  const box = geometryBounds(geometry).clone().applyMatrix4(logical);
  // Factory-merged meshes may store world-like coordinates in vertices while
  // their Object3D origin is zero. A narrow off-centre object still needs F;
  // rotating its zero origin alone would leave it on the old flat ground.
  return box.max.z - box.min.z > threshold
    || Math.abs((box.min.z + box.max.z) * .5 - logical.elements[14]) > threshold * .5;
}

function canBake(object, geometry) {
  return object.isMesh && !object.isSkinnedMesh && !geometry.isInstancedBufferGeometry
    && geometry.getAttribute('position')?.usage === THREE.StaticDrawUsage
    && !Object.keys(geometry.morphAttributes).length;
}

/**
 * Clone/subdivide triangles in logical world metres, then bake F into the
 * curved object's local coordinates. Never mutate a shared source geometry.
 * All vertex attributes and material groups survive the subdivision.
 */
export function bakeStationGeometry(source, logical, curved, { maxEdge = 2, maxTriangles = 1000000, instanceColor = null } = {}) {
  if (!(maxEdge > 0)) throw new RangeError('maxEdge must be positive');
  const attributes = Object.entries(source.attributes).filter(([, attribute]) => !attribute.isInstancedBufferAttribute);
  const layout = []; let width = 0;
  for (const [name, attribute] of attributes) { layout.push({ name, attribute, offset: width }); width += attribute.itemSize; }
  const positionLayout = layout.find(item => item.name === 'position');
  if (!positionLayout) throw new TypeError('Station geometry needs position');
  const normalLayout = layout.find(item => item.name === 'normal');
  const colorLayout = layout.find(item => item.name === 'color');
  const tangentLayout = layout.find(item => item.name === 'tangent');
  const values = Object.fromEntries(layout.map(({ name }) => [name, []]));
  if (instanceColor && !colorLayout) values.color = [];
  const inverse = curved.clone().invert();
  const logicalNormals = new THREE.Matrix3().getNormalMatrix(logical);
  const curvedNormalInverse = new THREE.Matrix3().setFromMatrix4(curved).transpose();
  const p = new THREE.Vector3(), normal = new THREE.Vector3();
  const pOffset = positionLayout.offset;
  let triangles = 0, longestEdge = 0;
  const read = index => {
    const result = new Array(width);
    for (const { attribute, offset } of layout) for (let k = 0; k < attribute.itemSize; k++) result[offset + k] = attribute.getComponent(index, k);
    return result;
  };
  const world = vertex => new THREE.Vector3(vertex[pOffset], vertex[pOffset + 1], vertex[pOffset + 2]).applyMatrix4(logical);
  const midpoint = (a, b) => a.map((v, i) => (v + b[i]) * .5);
  const emit = vertex => {
    p.set(vertex[pOffset], vertex[pOffset + 1], vertex[pOffset + 2]).applyMatrix4(logical);
    const theta = (RING_STATION.centerZ - p.z) / RING_STATION.radius;
    const c = Math.cos(theta), s = Math.sin(theta);
    const jacobianZ = 1 - p.y / RING_STATION.radius;
    const safeZ = Math.abs(jacobianZ) < 1e-6 ? (jacobianZ < 0 ? -1e-6 : 1e-6) : jacobianZ;
    stationWorldPoint(p, p).applyMatrix4(inverse);
    for (const { name, attribute, offset } of layout) {
      const output = values[name];
      if (name === 'position') output.push(p.x, p.y, p.z);
      else if (name === 'normal') {
        normal.set(vertex[offset], vertex[offset + 1], vertex[offset + 2]).applyMatrix3(logicalNormals);
        const y = normal.y, z = normal.z / safeZ;
        normal.y = c * y - s * z; normal.z = s * y + c * z;
        normal.applyMatrix3(curvedNormalInverse).normalize(); output.push(normal.x, normal.y, normal.z);
      } else if (name === 'tangent' && attribute.itemSize === 4) {
        // Tangents are vectors (J), whereas normals use inverse transpose.
        normal.set(vertex[offset], vertex[offset + 1], vertex[offset + 2]).transformDirection(logical);
        const y = normal.y, z = normal.z * safeZ;
        normal.y = c * y - s * z; normal.z = s * y + c * z;
        normal.transformDirection(inverse); output.push(normal.x, normal.y, normal.z, vertex[offset + 3]);
      } else {
        for (let k = 0; k < attribute.itemSize; k++) output.push(vertex[offset + k] * (name === 'color' && instanceColor && k < 3 ? [instanceColor.r, instanceColor.g, instanceColor.b][k] : 1));
      }
    }
    if (instanceColor && !colorLayout) values.color.push(instanceColor.r, instanceColor.g, instanceColor.b);
  };
  const subdivide = (a, b, c, wa, wb, wc, depth = 0) => {
    const edges = [wa.distanceToSquared(wb), wb.distanceToSquared(wc), wc.distanceToSquared(wa)];
    const largest = Math.max(...edges);
    if (largest > maxEdge * maxEdge * (1 + 1e-10)) {
      if (depth >= 32) throw new RangeError('Station triangle subdivision limit exceeded');
      const edge = edges.indexOf(largest);
      if (edge === 0) { const m = midpoint(a, b), wm = wa.clone().add(wb).multiplyScalar(.5); subdivide(a, m, c, wa, wm, wc, depth + 1); subdivide(m, b, c, wm, wb, wc, depth + 1); }
      else if (edge === 1) { const m = midpoint(b, c), wm = wb.clone().add(wc).multiplyScalar(.5); subdivide(a, b, m, wa, wb, wm, depth + 1); subdivide(a, m, c, wa, wm, wc, depth + 1); }
      else { const m = midpoint(c, a), wm = wc.clone().add(wa).multiplyScalar(.5); subdivide(a, b, m, wa, wb, wm, depth + 1); subdivide(m, b, c, wm, wb, wc, depth + 1); }
      return;
    }
    if (++triangles > maxTriangles) throw new RangeError('Station geometry triangle budget exceeded');
    longestEdge = Math.max(longestEdge, Math.sqrt(largest)); emit(a); emit(b); emit(c);
  };
  const geometry = new THREE.BufferGeometry();
  const count = source.index?.count ?? source.getAttribute('position').count;
  const drawStart = source.drawRange.start, drawEnd = Math.min(count, drawStart + source.drawRange.count);
  const groups = source.groups.length ? source.groups : [{ start: 0, count, materialIndex: 0 }];
  for (const group of groups) {
    const start = Math.max(group.start, drawStart), end = Math.min(group.start + group.count, drawEnd);
    const resultStart = triangles * 3;
    for (let i = start; i + 2 < end; i += 3) {
      const a = read(source.index ? source.index.getX(i) : i), b = read(source.index ? source.index.getX(i + 1) : i + 1), c = read(source.index ? source.index.getX(i + 2) : i + 2);
      subdivide(a, b, c, world(a), world(b), world(c));
    }
    if (triangles * 3 > resultStart) geometry.addGroup(resultStart, triangles * 3 - resultStart, group.materialIndex);
  }
  for (const { name, attribute } of layout) geometry.setAttribute(name, new THREE.Float32BufferAttribute(values[name], attribute.itemSize));
  if (instanceColor && !colorLayout) geometry.setAttribute('color', new THREE.Float32BufferAttribute(values.color, 3));
  if (!normalLayout) geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.stationBake = { triangles, maxLogicalEdge: longestEdge, sourceUuid: source.uuid, hasTangents: !!tangentLayout };
  return geometry;
}

function mergeBaked(parts) {
  const merged = new THREE.BufferGeometry();
  if (!parts.length) return merged;
  for (const [name, attribute] of Object.entries(parts[0].attributes)) {
    const length = parts.reduce((sum, part) => sum + part.getAttribute(name).array.length, 0);
    const array = new Float32Array(length); let offset = 0;
    for (const part of parts) { const data = part.getAttribute(name).array; array.set(data, offset); offset += data.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize));
  }
  let offset = 0;
  for (const part of parts) { for (const group of part.groups) merged.addGroup(offset + group.start, group.count, group.materialIndex); offset += part.getAttribute('position').count; }
  merged.computeBoundingBox(); merged.computeBoundingSphere();
  return merged;
}

const materialsOf = material => Array.isArray(material) ? material : [material];
const arraysEqual = (a, b, start = 0, end = a.length) => { for (let i = start; i < end; i++) if (a[i] !== b[i]) return false; return true; };

/**
 * A reversible Object3D adapter. Local matrices ALWAYS remain logical.
 * userData.stationSpace='raw': subtree already mapped (shader/sky).
 * userData.stationSpace='rigid': map this anchor, keep its whole animated rig
 * rigid, including bones. Put this on the shared parent of skinned mesh+bones.
 * Dynamic vertex shaders/buffers need raw+F in their own shader; no GPU readback.
 */
export function createStationWorldMapper(root, { maxEdge = 2, bendThreshold = 2, externalFrame = false, onWarning = () => {} } = {}) {
  const records = new Map();
  const outerFrame = new THREE.Matrix4();
  const stats = { geometryBakes: 0, instanceBakes: 0, matrixUpdates: 0, warnings: [] };
  let disposed = false, syncing = false, generation = 0;
  const warn = message => { stats.warnings.push(message); onWarning(message); };
  const makeRecord = object => {
    let record = records.get(object);
    if (record) return record;
    record = { object, logical: new THREE.Matrix4(), previous: null, updateMatrixWorld: object.updateMatrixWorld, updateWorldMatrix: object.updateWorldMatrix, hadUpdateMatrixWorld: Object.hasOwn(object, 'updateMatrixWorld'), hadUpdateWorldMatrix: Object.hasOwn(object, 'updateWorldMatrix'), geometry: object.geometry, baked: null, dynamic: false, context: null };
    records.set(object, record);
    if (object.isInstancedMesh) {
      record.setMatrixAt = object.setMatrixAt; record.hadSetMatrixAt = Object.hasOwn(object, 'setMatrixAt'); record.dirtyInstances = new Set();
      object.setMatrixAt = function (index, matrix) {
        if (record.logicalInstances) {
          let different = false; for (let k = 0; k < 16; k++) if (record.logicalInstances[index * 16 + k] !== Math.fround(matrix.elements[k])) different = true;
          if (different) { record.logicalInstances.set(matrix.elements, index * 16); record.dirtyInstances.add(index); }
        }
        record.setMatrixAt.call(this, index, matrix);
      };
    }
    object.updateMatrixWorld = () => updateSubtree(object);
    object.updateWorldMatrix = (_parents, children) => updatePath(object, !!children);
    return record;
  };
  const restoreGeometry = record => {
    if (record.baked) { if (record.object.geometry === record.baked) record.object.geometry = record.geometry; record.baked.dispose(); record.baked = null; }
  };
  const removeProxy = record => {
    if (!record.proxy) return;
    record.object.remove(record.proxy); record.proxy.geometry.dispose();
    for (const material of materialsOf(record.proxy.material)) material.dispose();
    record.proxy = null;
  };
  const release = record => {
    const object = record.object;
    restoreGeometry(record); removeProxy(record);
    for (const part of record.instanceParts?.values() ?? []) part.geometry.dispose();
    if (record.logicalInstances && object.instanceMatrix === record.instanceAttribute) {
      object.instanceMatrix.array.set(record.logicalInstances); object.instanceMatrix.needsUpdate = true;
      object.boundingBox = record.originalBoundingBox; object.boundingSphere = record.originalBoundingSphere;
      if (record.originalBoundingBox) object.computeBoundingBox();
      if (record.originalBoundingSphere) object.computeBoundingSphere();
    }
    object.matrixWorld.copy(record.logical);
    if (record.hadUpdateMatrixWorld) object.updateMatrixWorld = record.updateMatrixWorld; else delete object.updateMatrixWorld;
    if (record.hadUpdateWorldMatrix) object.updateWorldMatrix = record.updateWorldMatrix; else delete object.updateWorldMatrix;
    if (record.setMatrixAt) { if (record.hadSetMatrixAt) object.setMatrixAt = record.setMatrixAt; else delete object.setMatrixAt; }
  };
  const updateInstances = (record, mode, logicalChanged) => {
    const object = record.object, attribute = object.instanceMatrix;
    if (!record.logicalInstances || record.instanceAttribute !== attribute || record.logicalInstances.length !== attribute.array.length) {
      removeProxy(record);
      for (const part of record.instanceParts?.values() ?? []) part.geometry.dispose();
      record.instanceParts = new Map();
      record.instanceAttribute = attribute; record.logicalInstances = attribute.array.slice(); record.renderedInstances = attribute.array.slice(); record.instanceVersion = -1;
      record.originalBoundingBox = object.boundingBox?.clone() ?? null; record.originalBoundingSphere = object.boundingSphere?.clone() ?? null;
      record.movingInstances = new Set(); record.instanceCount = -1;
      record.instancesInitialized = attribute.version > 0;
    }
    const external = attribute.version !== record.instanceVersion;
    const positionVersion = record.geometry.getAttribute('position')?.version;
    const geometryChanged = record.instanceGeometryVersion !== positionVersion || record.instanceGeometry !== record.geometry;
    if (record.instanceGeometryVersion !== undefined && geometryChanged) record.dynamic = true;
    let changed = record.instanceCount !== object.count || logicalChanged || record.instanceVersion < 0 || record.instanceMode !== mode || record.instanceColorVersion !== object.instanceColor?.version || geometryChanged || record.dirtyInstances.size > 0;
    if (external && record.instanceVersion >= 0) {
      for (let i = 0; i < object.count; i++) if (!record.dirtyInstances.has(i) && !arraysEqual(attribute.array, record.renderedInstances, i * 16, i * 16 + 16)) {
        const logicalChanged = !arraysEqual(attribute.array, record.logicalInstances, i * 16, i * 16 + 16);
        record.logicalInstances.set(attribute.array.subarray(i * 16, i * 16 + 16), i * 16);
        if (record.instancesInitialized && logicalChanged) record.movingInstances.add(i);
        changed = true;
      }
    }
    if (record.instancesInitialized) for (const i of record.dirtyInstances) record.movingInstances.add(i);
    if ((external && record.instanceVersion >= 0) || record.dirtyInstances.size) record.instancesInitialized = true;
    record.dirtyInstances.clear();
    if (!changed) { record.instanceVersion = attribute.version; if (record.proxy) record.proxy.matrixWorld.copy(object.matrixWorld); return; }
    if (logicalChanged && record.previous) record.dynamic = true;
    const inverse = object.matrixWorld.clone().invert(), local = new THREE.Matrix4(), logical = new THREE.Matrix4(), curved = new THREE.Matrix4();
    const color = new THREE.Color(), parts = [], usedParts = new Set();
    const mayBake = mode === 'curve' && !record.dynamic && attribute.usage === THREE.StaticDrawUsage && canBake(object, record.geometry);
    // Per-instance cache means moving one small prop cannot rebake all static
    // ground in its batch. Merged proxy is likewise retained if parts match.
    for (let i = 0; i < object.count; i++) {
      local.fromArray(record.logicalInstances, i * 16); logical.multiplyMatrices(record.logical, local);
      const wide = mayBake && !record.movingInstances.has(i) && needsBake(record.geometry, logical, bendThreshold);
      if (wide) {
        try {
          if (object.instanceColor) object.getColorAt(i, color); else color.setRGB(1, 1, 1);
          let cached = record.instanceParts.get(i);
          if (!cached || cached.source !== record.geometry || !cached.logical.equals(logical) || !cached.color.equals(color)) {
            cached?.geometry.dispose(); record.instanceParts.delete(i);
            const part = bakeStationGeometry(record.geometry, logical, object.matrixWorld, { maxEdge, instanceColor: color });
            part.userData.stationInstanceId = i;
            cached = { geometry: part, logical: logical.clone(), source: record.geometry, color: color.clone() }; record.instanceParts.set(i, cached);
            stats.geometryBakes++; stats.instanceBakes++;
          }
          parts.push(cached.geometry); usedParts.add(i);
          local.makeScale(0, 0, 0).toArray(attribute.array, i * 16);
          continue;
        } catch (error) { warn(`Station instance ${object.name || object.uuid}: ${error.message}`); record.movingInstances.add(i); }
      }
      if (mode === 'curve') { stationWorldMatrix(logical, curved); local.multiplyMatrices(inverse, curved); }
      // raw/rigid subtree: use its original logical local instance transform.
      else local.fromArray(record.logicalInstances, i * 16);
      local.toArray(attribute.array, i * 16);
    }
    for (const [index, part] of record.instanceParts) if (!usedParts.has(index)) { part.geometry.dispose(); record.instanceParts.delete(index); }
    const sameParts = record.proxy && record.proxyParts?.length === parts.length && parts.every((part, i) => record.proxyParts[i] === part) && record.proxySourceMaterial === object.material;
    if (!sameParts) removeProxy(record);
    if (parts.length && !sameParts) {
      const geometry = mergeBaked(parts); let faceStart = 0;
      const instanceFaces = parts.map(part => { const start = faceStart; faceStart += part.getAttribute('position').count / 3; return { start, end: faceStart, instanceId: part.userData.stationInstanceId }; });
      const clones = materialsOf(object.material).map(source => { const material = source.clone(); material.vertexColors = true; material.onBeforeCompile = source.onBeforeCompile; material.customProgramCacheKey = source.customProgramCacheKey; if (source.isShaderMaterial) material.uniforms = source.uniforms; return material; });
      const proxy = new THREE.Mesh(geometry, Array.isArray(object.material) ? clones : clones[0]);
      proxy[OWNED] = true; proxy.name = `${object.name || 'instances'}:station-surface`; proxy.matrixAutoUpdate = false; proxy.matrixWorldAutoUpdate = false;
      proxy.castShadow = object.castShadow; proxy.receiveShadow = object.receiveShadow; proxy.renderOrder = object.renderOrder; proxy.layers.mask = object.layers.mask;
      proxy.customDepthMaterial = object.customDepthMaterial; proxy.customDistanceMaterial = object.customDistanceMaterial;
      proxy.userData = { ...object.userData, stationInstanceSurface: true }; proxy.matrixWorld.copy(object.matrixWorld);
      // Keep animated material uniforms/properties without mutating shared material.
      proxy.onBeforeRender = () => clones.forEach((target, i) => { const source = materialsOf(object.material)[i]; for (const key of ['opacity', 'emissiveIntensity', 'roughness', 'metalness']) if (key in source) target[key] = source[key]; for (const key of ['color', 'emissive']) if (source[key]) target[key].copy(source[key]); });
      if (Object.hasOwn(object, 'raycast')) proxy.raycast = object.raycast;
      else proxy.raycast = function (raycaster, hits) {
        const start = hits.length; THREE.Mesh.prototype.raycast.call(this, raycaster, hits);
        for (let i = start; i < hits.length; i++) {
          hits[i].instanceId = instanceFaces.find(range => hits[i].faceIndex >= range.start && hits[i].faceIndex < range.end)?.instanceId;
          hits[i].object = object; // Preserve R3F's original event target/bubbling.
        }
      };
      object.add(proxy); record.proxy = proxy; record.proxyParts = parts.slice(); record.proxySourceMaterial = object.material;
    }
    attribute.needsUpdate = true; record.instanceVersion = attribute.version;
    record.renderedInstances.set(attribute.array); record.instanceCount = object.count; record.instanceMode = mode; record.instanceColorVersion = object.instanceColor?.version;
    record.instanceGeometryVersion = positionVersion; record.instanceGeometry = record.geometry;
    object.computeBoundingBox(); object.computeBoundingSphere();
  };
  const updateObject = (object, parentLogical, inherited) => {
    const record = makeRecord(object); record.seen = generation;
    if (object.matrixAutoUpdate) object.updateMatrix();
    record.logical.multiplyMatrices(parentLogical, object.matrix);
    const changed = !record.previous || !record.previous.equals(record.logical);
    let context = inherited;
    const setting = object.userData?.stationSpace;
    if (setting === 'raw') context = { mode: 'raw' };
    else if (setting === 'rigid' && inherited.mode !== 'raw') context = { mode: 'rigid', transform: stationWorldMatrix(record.logical).multiply(record.logical.clone().invert()) };
    if (context.mode === 'raw') object.matrixWorld.copy(record.logical);
    else if (context.mode === 'rigid') object.matrixWorld.multiplyMatrices(context.transform, record.logical);
    else stationWorldMatrix(record.logical, object.matrixWorld);
    object.matrixWorldNeedsUpdate = false; record.context = context; stats.matrixUpdates++;
    if (object.isSkinnedMesh && object.bindMode === 'attached') object.bindMatrixInverse.copy(object.matrixWorld).invert();
    if (object.geometry && object.geometry !== record.baked && object.geometry !== record.geometry) {
      restoreGeometry(record); removeProxy(record); record.geometry = object.geometry; record.dynamic = false; record.previous = null; record.instanceVersion = -1;
    }
    if (object.isInstancedMesh) updateInstances(record, context.mode, changed);
    else if (object.isMesh && record.geometry) {
      if (record.previous && changed) { record.dynamic = true; restoreGeometry(record); }
      const position = record.geometry.getAttribute('position');
      if (record.positionVersion !== undefined && record.positionVersion !== position?.version) { record.dynamic = true; restoreGeometry(record); }
      record.positionVersion = position?.version;
      if (context.mode !== 'curve') restoreGeometry(record);
      else if (!record.dynamic && !record.baked && canBake(object, record.geometry) && needsBake(record.geometry, record.logical, bendThreshold)) {
        try { record.baked = bakeStationGeometry(record.geometry, record.logical, object.matrixWorld, { maxEdge }); object.geometry = record.baked; stats.geometryBakes++; }
        catch (error) { record.dynamic = true; warn(`Station geometry ${object.name || object.uuid}: ${error.message}`); }
      }
    }
    if (!record.previous) record.previous = new THREE.Matrix4(); record.previous.copy(record.logical);
    return record;
  };
  const visit = (object, parentLogical, context) => {
    if (object[OWNED]) return;
    const record = updateObject(object, parentLogical, context);
    for (const child of object.children) if (!child[OWNED]) visit(child, record.logical, record.context);
    if(externalFrame) object.matrixWorld.premultiply(outerFrame);
    if (record.proxy) record.proxy.matrixWorld.copy(object.matrixWorld);
  };
  function updatePath(object, children = false) {
    if (disposed || syncing) return;
    syncing = true;
    try {
      const path = []; for (let node = object; node; node = node.parent) { path.push(node); if (node === root) break; }
      if (path[path.length - 1] !== root) return;
      root.parent?.updateWorldMatrix(true, false);
      if(externalFrame) outerFrame.copy(root.parent?.matrixWorld ?? identity);
      let logical = externalFrame ? identity : (root.parent?.matrixWorld ?? identity), context = { mode: 'curve' };
      for (let i = path.length - 1; i >= 0; i--) { const record = updateObject(path[i], logical, context); logical = record.logical; context = record.context; }
      if (children) for (const child of object.children) if (!child[OWNED]) visit(child, logical, context);
      if(externalFrame) for(const node of path) node.matrixWorld.premultiply(outerFrame);
    } finally { syncing = false; }
  }
  function updateSubtree(object) { if (object === root) sync(); else updatePath(object, true); }
  function sync() {
    if (disposed || syncing) return;
    syncing = true; generation++;
    try {
      root.parent?.updateWorldMatrix(true, false);
      if(externalFrame) outerFrame.copy(root.parent?.matrixWorld ?? identity);
      visit(root, externalFrame ? identity : (root.parent?.matrixWorld ?? identity), { mode: 'curve' });
      for (const [object, record] of records) if (record.seen !== generation) { release(record); records.delete(object); }
    } finally { syncing = false; }
  }
  makeRecord(root);
  return {
    sync, stats,
    getLogicalMatrix: object => records.get(object)?.logical.clone() ?? null,
    dispose() { if (disposed) return; disposed = true; for (const record of records.values()) release(record); records.clear(); },
  };
}
