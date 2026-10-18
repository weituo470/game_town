import * as THREE from 'three';
import { sampleRocket, sampleWonder } from '../../../shared/wonders.js';

// These dimensions are in the town's world units, outside RocketBody's .2 scale.
// Engine bells end at RocketBody local y=0; boosters begin at local y=.55.
export const TOWN_ROCKET_NOZZLES = Object.freeze([
  Object.freeze({ x: -.94, y: .96, z: 0, length: 8.6, radius: .56 }),
  Object.freeze({ x: 0, y: .85, z: 0, length: 12.2, radius: .78 }),
  Object.freeze({ x: .94, y: .96, z: 0, length: 8.6, radius: .56 }),
]);
export const TOWN_ROCKET_PLUME_COUNT = 7; // Three rising plumes + four pad deflections.
export const TOWN_ROCKET_PAD_SURFACE = .48;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const x = clamp(value); return x*x*(3-2*x); };

/** Pure absolute-time visual sample; it never advances or replaces rocket physics. */
export function sampleTownRocketPlumes(ms, reducedMotion = false) {
  const time = Number.isFinite(ms) ? ms : 0;
  const pose = sampleRocket(time, reducedMotion), state = sampleWonder('rocket', time);
  const t = state.seconds, lit = pose.flame && pose.visible && !reducedMotion;
  const ignition = lit ? smooth((t - 10) / 2.3) : 0;
  const power = ignition * (.965 + Math.sin(t * 43) * .023 + Math.sin(t * 71) * .012);
  const jets = TOWN_ROCKET_NOZZLES.map((nozzle, i) => ({
    origin: [nozzle.x, nozzle.y + pose.height, nozzle.z], axis: [0, -1, 0],
    length: nozzle.length * ignition * (.97 + .03 * Math.sin(t * 34 + i * 2.1)),
    radius: nozzle.radius * (.7 + .3 * ignition), power, seed: i * 1.71,
  }));
  // The fixed concrete pad redirects the early exhaust sideways rather than
  // letting a long vertical flame draw through the solid platform. These wisps
  // fade away as the nozzle clears the pad and the airborne plume takes over.
  const deflection = power * Math.exp(-pose.height / 2.4);
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI * (.25 + i * .5), x = Math.cos(angle), z = Math.sin(angle);
    jets.push({ origin: [x * .45, .53, z * .45], axis: [x, .11, z],
      length: 3.7 * ignition, radius: .35, power: deflection * .8, seed: 7 + i * 1.91 });
  }
  return { visible: lit && ignition > .0001, seconds: t, height: pose.height, power,
    light: power * (145 + 35 * Math.sin(t * 37)), jets };
}

export const townRocketPlumeVertex = `
  attribute vec3 jetOrigin;
  attribute vec3 jetAxis;
  attribute vec4 jetShape;
  attribute float jetSeed;
  uniform float time;
  uniform float coreLayer;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec3 vJet;
  varying float vPower;
  void main() {
    float down = uv.y;
    float angle = uv.x * 6.28318530718;
    vec3 axis = normalize(jetAxis);
    vec3 reference = abs(axis.y) > .95 ? vec3(1., 0., 0.) : vec3(0., 1., 0.);
    vec3 side = normalize(cross(axis, reference));
    vec3 across = normalize(cross(side, axis));
    vec3 radial = side * cos(angle) + across * sin(angle);
    float ripple = sin(down * 36. - time * 29. + angle * 3. + jetSeed) *
      sin(down * 21. - time * 17. - angle * 4.) * down * .095;
    // A bell-sized throat, expanding jet and tapered, broken-up tail. The
    // throat stays exactly anchored; turbulence increases downstream only.
    float profile = (.68 + sin(down * 3.14159265) * .38) * pow(max(1. - down, .00001), .38);
    float layerRadius = mix(1., .52, coreLayer);
    float radius = jetShape.y * layerRadius * max(.004, profile + ripple);
    float coreLength = mix(1., .77, coreLayer);
    vec3 center = jetOrigin + axis * (down * jetShape.x * coreLength);
    vec3 p = center + radial * radius;
    vWorldPosition = (modelMatrix * vec4(p, 1.)).xyz;
    vNormal = normalize(mat3(modelMatrix) * radial);
    vJet = vec3(down, angle, jetSeed);
    vPower = jetShape.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
  }
`;

export const townRocketPlumeFragment = `
  uniform float time;
  uniform float coreLayer;
  uniform float padSurface;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec3 vJet;
  varying float vPower;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
  }
  void main() {
    // Depth testing still applies. This additional clip prevents a hot column
    // appearing below the launch platform if viewed from the harbour edge.
    if (vWorldPosition.y < padSurface || vPower < .001) discard;
    float down = clamp(vJet.x, 0., 1.);
    vec2 ring = vec2(cos(vJet.y), sin(vJet.y));
    float turbulent = noise(vec2(ring.x * 2.7 + ring.y * 3.1 + vJet.z, down * 11. - time * 9.));
    float fine = noise(vec2(ring.x * 6.1 - ring.y * 5.4 - vJet.z, down * 37. - time * 24.));
    float facing = abs(dot(normalize(vNormal), normalize(cameraPosition - vWorldPosition)));
    float softEdge = smoothstep(.02, .65, facing);
    float tail = 1. - smoothstep(.43 + turbulent * .24, 1., down);
    float wisps = mix(1., .38 + fine * .62, smoothstep(.12, .8, down));
    float shock = pow(max(0., .5 + .5*cos(down * 43. + sin(time*13.)*.08)), 11.) * (1.-down);
    vec3 orange = mix(vec3(2.8, .39, .035), vec3(1.9, .15, .012), down);
    vec3 hot = mix(vec3(5.8, 4.8, 3.3), vec3(3.8, 1.25, .16), smoothstep(.25, .95, down));
    vec3 color = mix(orange, hot, clamp(coreLayer * .93 + shock * .31, 0., 1.));
    float alpha = softEdge * tail * wisps * vPower * mix(.43, .78, coreLayer);
    alpha *= .83 + shock * .17;
    if (alpha < .012) discard;
    gl_FragColor = vec4(color, min(alpha, .92));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createTownRocketPlumeResources() {
  const radialSegments = 24, axialSegments = 32, positions = [], uvs = [], indices = [];
  for (let y = 0; y <= axialSegments; y++) for (let x = 0; x <= radialSegments; x++) {
    const u = x / radialSegments, v = y / axialSegments;
    positions.push(Math.cos(u*Math.PI*2), -v, Math.sin(u*Math.PI*2)); uvs.push(u, v);
  }
  for (let y = 0; y < axialSegments; y++) for (let x = 0; x < radialSegments; x++) {
    const a = y*(radialSegments+1)+x, b = a+radialSegments+1;
    indices.push(a,b,a+1,b,b+1,a+1);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  for (const [name, size] of [['jetOrigin',3],['jetAxis',3],['jetShape',4],['jetSeed',1]]) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(TOWN_ROCKET_PLUME_COUNT*size),size).setUsage(THREE.DynamicDrawUsage));
  }
  geometry.instanceCount = TOWN_ROCKET_PLUME_COUNT;
  const materials = [1, 0].map(coreLayer => new THREE.ShaderMaterial({
    uniforms: { time:{value:0}, coreLayer:{value:coreLayer}, padSurface:{value:TOWN_ROCKET_PAD_SURFACE} },
    vertexShader: townRocketPlumeVertex, fragmentShader: townRocketPlumeFragment,
    transparent:true, depthWrite:false, depthTest:true, side:THREE.DoubleSide,
    blending:THREE.NormalBlending, toneMapped:false,
  }));
  return { geometry, materials, dispose() { geometry.dispose(); materials.forEach(m=>m.dispose()); } };
}

export function writeTownRocketPlumeFrame(resources, sample) {
  const { geometry, materials } = resources;
  sample.jets.forEach((jet, i) => {
    geometry.attributes.jetOrigin.setXYZ(i, ...jet.origin);
    geometry.attributes.jetAxis.setXYZ(i, ...jet.axis);
    geometry.attributes.jetShape.setXYZW(i, jet.length, jet.radius, jet.power, 0);
    geometry.attributes.jetSeed.setX(i, jet.seed);
  });
  for (const name of ['jetOrigin','jetAxis','jetShape','jetSeed']) geometry.attributes[name].needsUpdate = true;
  materials.forEach(material => { material.uniforms.time.value = sample.seconds; });
}
