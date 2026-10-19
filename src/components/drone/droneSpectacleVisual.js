import * as THREE from 'three';
import { createDroneFireworkBuffers, DRONE_FIREWORKS_BUDGET } from '../../../shared/droneFireworks.js';

// Firework beads need to survive a wide establishing shot without relying on
// bloom. Their luminous discs stay compact; only the small core exceeds SDR.
export const FIREWORK_LIGHT_PROFILE = Object.freeze({ worldSize: 1.24, minPixels: 3.2, maxPixels: 13, alphaGain: 1.24, coreOuter: .64 });

export const FIREWORK_VERTEX_SHADER = /* glsl */`
  attribute vec3 aVelocity;
  attribute vec3 aTiming;
  attribute vec3 aMotion;
  attribute vec3 color;
  attribute float aSeed;
  uniform float uTime;
  uniform float uEnd;
  uniform float uViewportHeight;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float age = uTime - aTiming.x, t = max(0.0, age - aTiming.z);
    float travel = (1.0 - exp(-aMotion.y * t)) / aMotion.y;
    vec3 world = position + aVelocity * travel;
    world.y -= .5 * aMotion.x * t * t;
    vec4 view = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * view;
    float perspective = step(.5, abs(projectionMatrix[2][3]));
    float attenuation = mix(1.0, 1.0 / max(1.0, -view.z), perspective);
    gl_PointSize = clamp(${FIREWORK_LIGHT_PROFILE.worldSize} * aMotion.z * uViewportHeight * projectionMatrix[1][1] * .5 * attenuation, ${FIREWORK_LIGHT_PROFILE.minPixels}, ${FIREWORK_LIGHT_PROFILE.maxPixels.toFixed(1)});
    float phase = clamp(age / aTiming.y, 0.0, 1.0);
    float live = step(aTiming.z, age) * (1.0 - step(aTiming.y, age)) * (1.0 - step(uEnd, uTime)) * clamp((world.y - 35.0) / 5.0, 0.0, 1.0);
    float tail = mix(.62, 1.0, 1.0 - step(.001, aTiming.z));
    float shimmer = .94 + .06 * sin(age * 16.0 + aSeed * 6.2831853);
    vAlpha = min(1.0, live * pow(1.0 - phase, .62) * min(1.0, t * 18.0) * tail * shimmer * ${FIREWORK_LIGHT_PROFILE.alphaGain});
    vColor = color;
  }
`;
export const ROCKET_VERTEX_SHADER = /* glsl */`
  attribute vec3 aTiming;
  attribute vec3 color;
  uniform float uTime;
  uniform float uEnd;
  uniform float uViewportHeight;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float age = uTime - aTiming.x, tail = aTiming.z;
    float p = clamp((age - tail * .42) / aTiming.y, 0.0, 1.0);
    vec3 world = vec3(position.x - (1.0 - p) * position.x * .12,
      5.0 + (position.y - 5.0) * (1.0 - pow(1.0 - p, 1.5)), position.z + (1.0 - p) * 12.0);
    vec4 view = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * view;
    float perspective = step(.5, abs(projectionMatrix[2][3]));
    float attenuation = mix(1.0, 1.0 / max(1.0, -view.z), perspective);
    gl_PointSize = clamp((.82 + .42 * (1.0 - tail)) * uViewportHeight * projectionMatrix[1][1] * .5 * attenuation, 2.6, 12.0);
    vAlpha = step(tail * .42, age) * (1.0 - step(aTiming.y, age)) * (1.0 - step(uEnd, uTime)) * pow(1.0 - tail, 1.7);
    vColor = color;
  }
`;
export const FIREWORK_FRAGMENT_SHADER = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 point = gl_PointCoord * 2.0 - 1.0;
    float radius = length(point);
    if (radius > .83 || vAlpha < .004) discard;
    float core = 1.0 - smoothstep(.24, ${FIREWORK_LIGHT_PROFILE.coreOuter}, radius);
    float halo = exp(-radius * radius * 11.0) * .16;
    // Compact, alpha-composited lights: never a broad additive flash.
    vec3 light = mix(vColor * 1.16, vec3(1.28, 1.20, 1.04), core * .38);
    gl_FragColor = vec4(light, min(1.0, (core + halo) * vAlpha));
    #include <colorspace_fragment>
  }
`;

/** Loaded exclusively by the curated sample chunk, never by the startup graph. */
export function createDroneSpectacleVisual(sampleId, count = 4096) {
  const data = createDroneFireworkBuffers(sampleId, count), group = new THREE.Group();
  group.name = `DroneSpectacleFireworks:${sampleId}`;
  const uniforms = { uTime: { value: 0 }, uEnd: { value: data.end }, uViewportHeight: { value: 720 } };
  const geometry = new THREE.BufferGeometry();
  for (const [name, values, size] of [['position', data.origin, 3], ['aVelocity', data.velocity, 3], ['aTiming', data.timing, 3], ['aMotion', data.motion, 3], ['color', data.color, 3], ['aSeed', data.seed, 1]]) geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
  const rocketGeometry = new THREE.BufferGeometry();
  for (const [name, values] of [['position', data.rocketOrigin], ['aTiming', data.rocketTiming], ['color', data.rocketColor]]) rocketGeometry.setAttribute(name, new THREE.BufferAttribute(values, 3));
  const settings = { uniforms, fragmentShader: FIREWORK_FRAGMENT_SHADER, transparent: true, blending: THREE.NormalBlending, depthWrite: false, depthTest: true, toneMapped: false, fog: false };
  const material = new THREE.ShaderMaterial({ ...settings, vertexShader: FIREWORK_VERTEX_SHADER });
  const rocketMaterial = new THREE.ShaderMaterial({ ...settings, vertexShader: ROCKET_VERTEX_SHADER });
  const sparks = new THREE.Points(geometry, material), rockets = new THREE.Points(rocketGeometry, rocketMaterial);
  sparks.name = 'SeparatedBallisticFireworkSparks'; rockets.name = 'DiscreteAscendingFireworkRockets';
  for (const points of [sparks, rockets]) { points.frustumCulled = false; points.renderOrder = 5; group.add(points); }
  group.visible = false;
  let disposed = false;
  return {
    group,
    stats: Object.freeze({ sparkPoints: data.count, rocketPoints: data.rocketCount, drawCalls: DRONE_FIREWORKS_BUDGET.drawCalls }),
    update(timeMs, reducedMotion = false, viewportHeight = 720) {
      if (disposed) return false;
      const seconds = Number.isFinite(timeMs) ? Math.max(0, timeMs / 1000) : 0;
      uniforms.uTime.value = seconds;
      uniforms.uViewportHeight.value = Number.isFinite(viewportHeight) ? Math.max(1, viewportHeight) : 720;
      group.visible = !reducedMotion && seconds >= data.start && seconds < data.end;
      return group.visible;
    },
    dispose() {
      if (disposed) return;
      disposed = true; group.visible = false;
      geometry.dispose(); rocketGeometry.dispose(); material.dispose(); rocketMaterial.dispose();
      group.clear();
    },
  };
}
