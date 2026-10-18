import * as THREE from 'three';
import { BLACK_HOLE_SHADERS } from './deepflowBlackHoleShaders.js';

// Original, asset-free placeholder for the open-source edition. One ordinary
// scene mesh replaces the former website renderer and its offscreen passes.
export const BLACK_HOLE_VISUAL = Object.freeze({
  durationMs: 90000,
  center: Object.freeze([0, 130, -50]),
  width: 320, height: 180, aspect: 16 / 9,
});
const clamp = value => Math.min(1, Math.max(0, value));
const smooth = (start, end, value) => {
  const x = clamp((value - start) / (end - start));
  return x * x * (3 - 2 * x);
};
const safeTime = value => Number.isFinite(value) ? Math.max(0, value) : 0;
// Keep shader uniforms small even after an arbitrary large absolute-time seek.
const phase = (milliseconds, reducedMotion) => reducedMotion ? 0 : (milliseconds / 1000) % (Math.PI * 2 / .15);

export function sampleBlackHoleEnvelope(timeMs, reducedMotion = false) {
  const milliseconds = safeTime(timeMs), seconds = milliseconds / 1000;
  const opacity = smooth(0, 10, seconds) * (1 - smooth(76, 90, seconds));
  return { seconds, opacity, growth: reducedMotion ? 1 : .35 + .65 * smooth(0, 24, seconds),
    time: phase(milliseconds, reducedMotion), visible: opacity > .00001 && seconds < 90 };
}

export function createBlackHoleVisual({ ambient = false } = {}) {
  const group = new THREE.Group();
  group.name = ambient ? 'game-town-ambient-black-hole' : 'game-town-black-hole';
  group.position.fromArray(BLACK_HOLE_VISUAL.center);
  const geometry = new THREE.PlaneGeometry(BLACK_HOLE_VISUAL.width, BLACK_HOLE_VISUAL.height);
  const material = new THREE.ShaderMaterial({
    vertexShader: ambient ? BLACK_HOLE_SHADERS.skyVertex : BLACK_HOLE_SHADERS.vertex,
    fragmentShader: BLACK_HOLE_SHADERS.fragment,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uAspect: { value: BLACK_HOLE_VISUAL.aspect } },
    transparent: true, blending: THREE.NormalBlending, depthWrite: false,
    depthTest: ambient, depthFunc: THREE.LessEqualDepth, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'game-town-black-hole-ring';
  mesh.frustumCulled = false;
  mesh.renderOrder = ambient ? -998 : 6;
  mesh.castShadow = mesh.receiveShadow = false;
  if (ambient) mesh.userData.isSky = true;
  // In ambient mode, BOTH dark core and ring use this one far-depth surface.
  // Every opaque town object therefore occludes it; transparent town surfaces
  // render later. There is no fullscreen matte and no foreground black decal.
  group.add(mesh);
  const visibility = { opacity: 1, growth: 1, visible: true };
  let disposed = false, dirty = true, lastKey = '', lastTime = 0, lastReduced = false;
  const update = (timeMs, reducedMotion = false, ambientOptions) => {
    if (disposed) return false;
    if (ambient && ambientOptions) {
      for (const key of ['opacity', 'growth']) if (Number.isFinite(ambientOptions[key])) visibility[key] = clamp(ambientOptions[key]);
      if (typeof ambientOptions.visible === 'boolean') visibility.visible = ambientOptions.visible;
    }
    lastTime = safeTime(timeMs); lastReduced = Boolean(reducedMotion);
    const state = ambient ? { ...visibility, time: phase(lastTime, lastReduced),
      visible: visibility.visible && visibility.opacity > .00001 && visibility.growth > .00001,
    } : sampleBlackHoleEnvelope(lastTime, lastReduced);
    const key = [state.opacity, state.growth, state.time, state.visible].join(':');
    if (key === lastKey) return false;
    lastKey = key; dirty = true;
    group.visible = state.visible;
    material.uniforms.uOpacity.value = state.opacity;
    material.uniforms.uTime.value = state.time;
    mesh.scale.setScalar(state.growth);
    return true;
  };
  const setAmbientVisibility = options => ambient ? update(lastTime, lastReduced, options) : false;
  // Compatibility hook: the town's existing renderer draws the mesh itself.
  // Never create a second renderer, render target, clock or context listener.
  const render = () => {
    if (disposed || !group.visible || !dirty) return false;
    dirty = false;
    return true;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    geometry.dispose(); material.dispose(); group.clear();
  };
  update(0);
  return { group, mesh, material, mode: ambient ? 'ambient' : 'show',
    update, setAmbientVisibility, render, dispose, resources: [geometry, material] };
}
