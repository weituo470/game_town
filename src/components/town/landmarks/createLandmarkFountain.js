import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const FOUNTAIN_SPEC = Object.freeze({
  name: 'Starfall Observatory Fountain',
  radius: 5.5,
  height: 8.5,
  collisionRadius: 5.9,
  drawCallBudget: 35,
  waterLevels: Object.freeze([0.83, 2.92, 4.79]),
});

const TAU = Math.PI * 2;
const polar = (radius, y, angle) => new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);

// Keep Three's standard lighting, shadows, fog and tone mapping. Only the
// surface colour receives inexpensive, texture-free procedural water detail.
function waterMaterial(mode, clock) {
  const surface = mode === 'surface';
  const material = new THREE.MeshStandardMaterial({
    name: 'fountain-water-' + mode,
    color: surface ? '#6bbfc0' : '#b6eee3',
    roughness: surface ? 0.24 : 0.31,
    metalness: surface ? 0.16 : 0.05,
    emissive: surface ? '#245e63' : '#71b7b0',
    emissiveIntensity: surface ? 0.2 : 0.3,
    // Opaque stylised water avoids transparent sorting, backface double draws,
    // transmission render targets and the need for another water render pass.
  });
  material.userData.fountainTime = clock;
  material.customProgramCacheKey = () => 'landmark-fountain-v1-' + mode;
  material.onBeforeCompile = shader => {
    shader.uniforms.uFountainTime = clock;
    shader.vertexShader = 'varying vec2 vFountainUv;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      '#include <uv_vertex>\nvFountainUv = uv;',
    );
    shader.fragmentShader = 'uniform float uFountainTime;\nvarying vec2 vFountainUv;\n' + shader.fragmentShader;
    const waterCode = surface ? `
      vec2 q = (vFountainUv - 0.5) * 2.0;
      float r = length(q);
      float ring = sin(r * 48.0 - uFountainTime * 2.2);
      float crossWave = sin(q.x * 31.0 + sin(q.y * 26.0 + uFountainTime * 0.65));
      float caustic = smoothstep(0.80, 1.0, crossWave) * 0.14;
      float edge = smoothstep(0.72, 0.99, r);
      diffuseColor.rgb *= 0.88 + ring * 0.065 + caustic;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.63, 0.91, 0.83), edge * 0.28);
    ` : `
      // Tube U follows the water path, so bright parcels travel downstream.
      float parcel = sin(vFountainUv.x * 100.0 - uFountainTime * 8.0);
      float crest = smoothstep(0.25, 0.94, parcel);
      diffuseColor.rgb *= 0.76 + crest * 0.30;
    `;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n' + waterCode,
    );
  };
  return material;
}

/**
 * Pure Three factory, deliberately separate from React for deterministic QA.
 * Every invocation owns its resources; no global GPU cache survives unmount.
 */
export function createLandmarkFountain() {
  const group = new THREE.Group();
  group.name = 'StarfallFountainAsset';
  group.userData.landmark = 'starfall-observatory';
  group.userData.elapsed = 0;
  const clock = { value: 0 };
  const resources = { geometries: new Set(), materials: new Set() };
  const temporary = new Set();
  const batches = new Map();
  const ownMaterial = material => { resources.materials.add(material); return material; };
  const ownGeometry = geometry => { resources.geometries.add(geometry); return geometry; };
  const temp = geometry => { temporary.add(geometry); return geometry; };
  const standard = (name, color, options = {}) => ownMaterial(new THREE.MeshStandardMaterial({
    name, color, roughness: 0.78, ...options,
  }));
  const stone = standard('warm-honey-limestone', '#d1b594');
  const limestone = standard('carved-ivory-rim', '#f0d8b2', { roughness: 0.69 });
  const shadowStone = standard('terracotta-inset', '#9b7e66');
  const bronze = standard('aged-brass', '#997544', { roughness: 0.41, metalness: 0.61 });
  const gold = standard('polished-brass-edges', '#dfb968', { roughness: 0.29, metalness: 0.58 });
  const enamel = standard('teal-enamel', '#387e83', { roughness: 0.33, metalness: 0.2 });
  const pearl = standard('star-pearl-and-lanterns', '#c0eee0', {
    roughness: 0.26, metalness: 0.12, emissive: '#94dccc', emissiveIntensity: 0.65,
  });
  const water = ownMaterial(waterMaterial('surface', clock));
  const flow = ownMaterial(waterMaterial('flow', clock));
  const foam = ownMaterial(new THREE.MeshBasicMaterial({
    name: 'soft-surface-ripples', color: '#d6f3d8',
    transparent: true, opacity: 0.42, depthWrite: false, toneMapped: true,
  }));

  // Reuse primitives during construction, then bake material batches. All
  // builder-only source/clone geometry is released immediately after merging.
  const cylinder = temp(new THREE.CylinderGeometry(1, 1, 1, 64));
  const sphere = temp(new THREE.SphereGeometry(1, 16, 10));
  const bead = temp(new THREE.IcosahedronGeometry(1, 1));
  const box = temp(new THREE.BoxGeometry(1, 1, 1));
  const transform = new THREE.Object3D();
  const add = (geometry, material, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) => {
    transform.position.set(...position);
    transform.scale.set(...scale);
    transform.rotation.set(...rotation);
    transform.updateMatrix();
    const copy = geometry.clone().applyMatrix4(transform.matrix);
    // Merging indexed and non-indexed primitives requires a common topology.
    const baked = copy.index ? copy.toNonIndexed() : copy;
    if (baked !== copy) copy.dispose();
    baked.clearGroups();
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(baked);
  };
  const disk = (radius, y, thickness, material) => add(cylinder, material, [0, y, 0], [radius, thickness, radius]);
  const lathe = (profile, material, position) => {
    const geometry = temp(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 64));
    add(geometry, material, position);
  };
  const torus = (radius, tube, y, material, rotation = [-Math.PI / 2, 0, 0], position = [0, y, 0]) => {
    const geometry = temp(new THREE.TorusGeometry(radius, tube, 8, 80));
    add(geometry, material, position, [1, 1, 1], rotation);
  };
  const tube = (points, radius, material, segments = 32) => {
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = temp(new THREE.TubeGeometry(curve, segments, radius, 7, false));
    add(geometry, material);
    return curve;
  };
  const waterDisk = (radius, y) => {
    const geometry = temp(new THREE.CircleGeometry(radius, 80));
    add(geometry, water, [0, y, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]);
  };

  // A broad three-step stylobate, kept entirely inside a 5.5-unit disk.
  disk(5.5, 0.09, 0.18, stone);
  disk(5.23, 0.235, 0.15, limestone);
  disk(4.98, 0.375, 0.13, stone);
  torus(4.92, 0.032, 0.446, gold);
  disk(4.61, 0.51, 0.16, shadowStone);
  lathe([
    [4.37, 0.51], [4.64, 0.48], [4.76, 0.60], [4.76, 0.88],
    [4.88, 1.01], [4.85, 1.14], [4.59, 1.19], [4.36, 1.09],
    [4.31, 0.95], [4.31, 0.62], [4.37, 0.51],
  ], limestone);
  torus(4.76, 0.042, 0.76, bronze);
  torus(4.56, 0.045, 1.145, gold);
  waterDisk(4.32, 0.83);
  // Alternating stone keys are real masonry, not a texture or lettering.
  for (let i = 0; i < 32; i++) {
    const a = i * TAU / 32;
    add(box, i % 4 === 0 ? bronze : stone, polar(4.67, 1.178, a).toArray(), [0.20, 0.055, 0.31], [0, -a, 0]);
  }
  for (let i = 0; i < 24; i++) {
    const a = i * TAU / 24;
    add(bead, bronze, polar(4.78, 0.88, a).toArray(), [0.065, 0.065, 0.065]);
  }

  // Structural pedestal and two scalloped, load-bearing water dishes.
  lathe([
    [0, 0.59], [1.02, 0.59], [1.12, 0.76], [1.08, 0.93],
    [0.74, 1.10], [0.60, 1.67], [0.73, 2.15], [0.53, 2.32], [0, 2.32],
  ], stone);
  torus(1.02, 0.06, 0.91, gold);
  torus(0.65, 0.055, 1.83, bronze);
  lathe([
    [0.46, 2.23], [1.04, 2.28], [1.82, 2.53], [2.34, 2.75],
    [2.50, 2.91], [2.45, 3.04], [2.26, 3.01], [2.17, 2.83],
    [1.50, 2.62], [0.46, 2.43], [0.46, 2.23],
  ], limestone);
  torus(2.43, 0.055, 3.008, gold);
  torus(2.17, 0.045, 2.66, bronze);
  waterDisk(2.31, 2.92);
  lathe([
    [0, 2.77], [0.63, 2.77], [0.69, 3.06], [0.42, 3.31],
    [0.35, 3.91], [0.48, 4.30], [0, 4.48],
  ], bronze);
  add(sphere, enamel, [0, 3.67, 0], [0.46, 0.55, 0.46]);
  lathe([
    [0.30, 4.32], [0.82, 4.37], [1.30, 4.55], [1.54, 4.76],
    [1.50, 4.90], [1.33, 4.87], [1.24, 4.69], [0.30, 4.49], [0.30, 4.32],
  ], limestone);
  waterDisk(1.38, 4.79);
  torus(1.48, 0.055, 4.88, gold);
  torus(1.15, 0.045, 4.49, bronze);

  // Three sweeping brass ribs surround an open armillary crown. Unlike a
  // scaled-up tiered fountain, the crown remains legible against the skyline.
  disk(0.43, 4.99, 0.33, bronze);
  disk(0.29, 5.35, 0.52, gold);
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3 + Math.PI / 6;
    const ribs = [[0.32, 4.95], [0.70, 5.35], [1.12, 6.12], [1.03, 6.94], [0.50, 7.51], [0.12, 7.58]];
    tube(ribs.map(([r, y]) => polar(r, y, a)), 0.105, bronze, 40);
    tube(ribs.map(([r, y]) => polar(r + 0.035, y + 0.018, a)), 0.035, gold, 40);
    add(sphere, gold, polar(0.54, 5.20, a).toArray(), [0.18, 0.12, 0.18]);
  }
  // Tilted ecliptic and equatorial inlays are genuine 3D closed rings.
  torus(1.29, 0.075, 6.56, gold, [-Math.PI / 2 + 0.43, 0, 0.28], [0, 6.56, 0]);
  torus(0.78, 0.025, 6.53, bronze, [-Math.PI / 2, 0, 0], [0, 6.53, 0]);
  add(bead, pearl, [0, 6.56, 0], [0.49, 0.60, 0.49]);
  disk(0.12, 6.02, 0.66, gold);
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    // Small gold stars carried on the crown, not billboard particles.
    add(bead, gold, polar(1.29, 6.56 - Math.sin(a) * 0.51, a).toArray(), [0.085, 0.085, 0.085]);
  }
  lathe([[0, 0], [0.15, 0.05], [0.24, 0.24], [0.21, 0.43], [0.10, 0.67], [0, 0.92]], gold, [0, 7.58, 0]);

  // Arc jets and staggered spillways form a continuous three-level water path.
  // Each path has the same flow shader; no textures, physics, or CPU particles.
  const landingSites = [];
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8;
    const nozzle = polar(3.91, 1.03, a + Math.PI / 8);
    add(sphere, bronze, nozzle.toArray(), [0.21, 0.13, 0.21]);
    add(sphere, gold, [nozzle.x, 1.12, nozzle.z], [0.09, 0.09, 0.09]);
    const jet = [];
    for (let j = 0; j <= 20; j++) {
      const t = j / 20;
      jet.push(polar(3.91 - 1.82 * t, 1.15 + 1.77 * t + 1.34 * 4 * t * (1 - t), a + Math.PI / 8));
    }
    tube(jet, 0.045, flow, 40);
    // Three adjacent filaments read as a small waterfall rather than a hose.
    for (let lane = -1; lane <= 1; lane++) {
      const angle = a + lane * 0.036;
      tube([
        polar(2.30, 2.94, angle), polar(2.55, 2.87, angle),
        polar(2.90, 2.33, angle), polar(3.13, 1.55, angle), polar(3.19, 0.85, angle),
      ], lane === 0 ? 0.062 : 0.033, flow, 28);
    }
    landingSites.push({ radius: 3.19, y: 0.842, angle: a, size: 0.38 });
    add(sphere, pearl, polar(3.19, 0.86, a).toArray(), [0.13, 0.025, 0.13]);
    add(sphere, enamel, polar(4.66, 0.91, a).toArray(), [0.14, 0.18, 0.14]);
    add(bead, pearl, polar(4.68, 0.93, a).toArray(), [0.074, 0.10, 0.074]);
  }
  for (let i = 0; i < 6; i++) {
    const a = i * TAU / 6 + Math.PI / 12;
    for (let lane = -1; lane <= 1; lane++) {
      const angle = a + lane * 0.045;
      tube([
        polar(1.35, 4.81, angle), polar(1.58, 4.71, angle),
        polar(1.85, 4.09, angle), polar(1.97, 3.44, angle), polar(1.98, 2.94, angle),
      ], lane === 0 ? 0.052 : 0.029, flow, 26);
    }
    landingSites.push({ radius: 1.98, y: 2.934, angle: a, size: 0.23 });
  }
  // Three fine crown springs connect the sculpture to the upper reservoir.
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3 + Math.PI / 2;
    tube([polar(0.23, 5.47, a), polar(0.66, 5.48, a), polar(0.97, 5.10, a), polar(1.03, 4.80, a)], 0.037, flow, 24);
    landingSites.push({ radius: 1.03, y: 4.804, angle: a, size: 0.20 });
  }

  let partCount = 0;
  for (const [material, parts] of batches) {
    const geometry = ownGeometry(mergeGeometries(parts, false));
    partCount += parts.length;
    parts.forEach(part => part.dispose());
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material.name;
    mesh.castShadow = material !== water && material !== flow && material !== pearl;
    mesh.receiveShadow = material !== flow && material !== pearl;
    group.add(mesh);
  }
  temporary.forEach(geometry => geometry.dispose());
  temporary.clear();
  batches.clear();

  // A single instanced draw covers all expanding impact rings. No per-frame
  // geometry allocation: only 34 small matrices change.
  const rippleGeometry = ownGeometry(new THREE.TorusGeometry(1, 0.035, 8, 64));
  const ripples = new THREE.InstancedMesh(rippleGeometry, foam, landingSites.length * 2);
  ripples.name = 'expanding-impact-rings';
  ripples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ripples.castShadow = false;
  ripples.receiveShadow = false;
  ripples.renderOrder = 2;
  // Conservative local bounds include every animated ring at every phase.
  ripples.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.5, 0), 5.2);
  group.add(ripples);
  const light = new THREE.PointLight('#b9e7d2', 3.2, 9, 2);
  light.name = 'single-unshadowed-fountain-light';
  light.position.set(0, 5.9, 0);
  light.castShadow = false;
  group.add(light);

  const placeRipples = time => {
    let index = 0;
    landingSites.forEach((site, siteIndex) => {
      for (let layer = 0; layer < 2; layer++) {
        const phase = (time * 0.43 + siteIndex * 0.173 + layer * 0.5) % 1;
        const size = site.size * (0.24 + phase * 0.76);
        transform.position.copy(polar(site.radius, site.y + layer * 0.002, site.angle));
        transform.rotation.set(-Math.PI / 2, 0, 0);
        // Flatten late rings instead of globally fading all impacts together.
        transform.scale.set(size, size, 0.7 * (1 - phase) + 0.08);
        transform.updateMatrix();
        ripples.setMatrixAt(index++, transform.matrix);
      }
    });
    ripples.instanceMatrix.needsUpdate = true;
  };
  placeRipples(0);
  group.updateMatrixWorld(true);

  const stats = {
    drawCalls: 0, triangles: 0,
    geometries: resources.geometries.size, materials: resources.materials.size,
    textures: 0, pointLights: 1, partCount,
  };
  group.traverse(object => {
    if (!object.isMesh) return;
    stats.drawCalls++;
    stats.triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
  });
  group.userData.stats = Object.freeze(stats);
  group.userData.spec = FOUNTAIN_SPEC;
  let disposed = false;
  return {
    group,
    stats: group.userData.stats,
    update(delta, reducedMotion = false) {
      if (disposed || reducedMotion || !Number.isFinite(delta) || delta <= 0) return;
      // Avoid a large jump after a background tab resumes.
      clock.value += Math.min(delta, 0.05);
      group.userData.elapsed = clock.value;
      placeRipples(clock.value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      ripples.dispose();
      resources.geometries.forEach(geometry => geometry.dispose());
      resources.materials.forEach(material => material.dispose());
      resources.geometries.clear();
      resources.materials.clear();
    },
  };
}
