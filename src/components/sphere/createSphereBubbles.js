import * as THREE from 'three';
import { SPHERE_BUBBLE_BUDGET, sampleSphereBubble, sampleSphereBubbleCue } from './sphereBubbleCycle.js';

const vertexShader = /* glsl */`
  attribute float aOpacity;
  varying float vOpacity;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  #include <fog_pars_vertex>
  void main() {
    vOpacity=aOpacity;
    vec4 localPosition=instanceMatrix*vec4(position,1.);
    vec4 worldPosition=modelMatrix*localPosition;
    vWorldPosition=worldPosition.xyz;
    vWorldNormal=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
    vec4 mvPosition=viewMatrix*worldPosition;
    gl_Position=projectionMatrix*mvPosition;
    #include <fog_vertex>
  }
`;
const bubbleFragment = /* glsl */`
  uniform float uNight;
  varying float vOpacity;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  #include <fog_pars_fragment>
  void main() {
    if(vOpacity<.001) discard;
    vec3 n=normalize(vWorldNormal), v=normalize(cameraPosition-vWorldPosition);
    float facing=max(0.,dot(n,v)), rim=pow(1.-facing,2.7);
    vec3 film=.58+.42*cos(vec3(0.,2.1,4.2)+(1.-facing)*12.5+n.y*2.5);
    vec3 light=normalize(vec3(-.5,.8,.7));
    float glint=pow(max(0.,dot(n,normalize(light+v))),85.);
    float crescent=pow(max(0.,dot(n,light)),9.)*rim;
    vec3 color=mix(vec3(.74,.9,1.),film,.6)+vec3(1.)*(glint*.9+crescent*.55);
    color*=1.+uNight*.13;
    float alpha=clamp(.026+rim*.53+glint*.77+crescent*.32,0.,.92)*vOpacity;
    gl_FragColor=vec4(color,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;
const cloudFragment = /* glsl */`
  uniform float uNight;
  varying float vOpacity;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  #include <fog_pars_fragment>
  void main() {
    if(vOpacity<.001) discard;
    vec3 n=normalize(vWorldNormal), v=normalize(cameraPosition-vWorldPosition);
    float facing=max(0.,dot(n,v));
    float diffuse=.64+.32*max(0.,dot(n,normalize(vec3(-.4,.9,.5))));
    float crown=smoothstep(-.45,.68,n.y);
    vec3 daylight=mix(vec3(.69,.78,.87),vec3(1.,.995,.98),crown);
    vec3 color=mix(daylight,vec3(.66,.75,.87),uNight*.72)*diffuse;
    color+=vec3(.065,.075,.085)*pow(1.-facing,2.);
    float alpha=smoothstep(.015,.23,facing)*vOpacity*.82;
    gl_FragColor=vec4(color,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;
const LOBES = Object.freeze([
  Object.freeze([-.83, 0, .08, .82]), Object.freeze([.7, .08, .05, .87]),
  Object.freeze([-.08, .55, -.1, .91]), Object.freeze([-.28, -.24, .38, .79]),
  Object.freeze([.25, -.18, -.48, .75]),
]);

/** Two bounded instanced batches. No transmission, textures, lights or offscreen pass. */
export function createSphereBubbles() {
  const group = new THREE.Group(); group.name = 'sphere-bubble-cloud-voyage';
  const bubbleGeometry = new THREE.SphereGeometry(1, 24, 12), cloudGeometry = new THREE.SphereGeometry(1, 12, 8);
  const bubbleAlpha = new THREE.InstancedBufferAttribute(new Float32Array(SPHERE_BUBBLE_BUDGET.capacity), 1).setUsage(THREE.DynamicDrawUsage);
  const cloudAlpha = new THREE.InstancedBufferAttribute(new Float32Array(SPHERE_BUBBLE_BUDGET.capacity * LOBES.length), 1).setUsage(THREE.DynamicDrawUsage);
  bubbleGeometry.setAttribute('aOpacity', bubbleAlpha); cloudGeometry.setAttribute('aOpacity', cloudAlpha);
  const makeMaterial = (name, fragmentShader) => new THREE.ShaderMaterial({ name, vertexShader, fragmentShader,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uNight: { value: 0 } }]),
    transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide, fog: true, toneMapped: true });
  const bubbleMaterial = makeMaterial('sphere-iridescent-soap-film', bubbleFragment);
  const cloudMaterial = makeMaterial('sphere-soft-cloud-billows', cloudFragment);
  const bubbles = new THREE.InstancedMesh(bubbleGeometry, bubbleMaterial, SPHERE_BUBBLE_BUDGET.capacity);
  const clouds = new THREE.InstancedMesh(cloudGeometry, cloudMaterial, SPHERE_BUBBLE_BUDGET.capacity * LOBES.length);
  bubbles.name = 'sphere-soap-bubbles'; clouds.name = 'sphere-bubble-clouds';
  bubbles.renderOrder = 3; clouds.renderOrder = 2;
  for (const mesh of [bubbles, clouds]) { mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.raycast = () => {}; group.add(mesh); }
  const dummy = new THREE.Object3D(), samples = Array.from({ length: SPHERE_BUBBLE_BUDGET.capacity }, () => ({}));
  let disposed = false, previousTime = null, previousOpacity = null, previousReduced = null;
  const triangles = geometry => (geometry.index?.count ?? geometry.attributes.position.count) / 3;
  const statistics = Object.freeze({ drawCalls: 2, instances: bubbles.count + clouds.count, geometries: 2, materials: 2,
    triangles: triangles(bubbleGeometry) * bubbles.count + triangles(cloudGeometry) * clouds.count });
  group.userData.sphereBubbleStatistics = statistics;
  function update(timeMs = 0, { opacity = 1, reducedMotion = false, night = 0 } = {}) {
    if (disposed) return null;
    const time = (Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0) % SPHERE_BUBBLE_BUDGET.cycleMs;
    const strength = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0;
    const darkness = night === true ? 1 : Number.isFinite(night) ? Math.max(0, Math.min(1, night)) : 0;
    const cue = sampleSphereBubbleCue(time, { reducedMotion });
    bubbleMaterial.uniforms.uNight.value = darkness; cloudMaterial.uniforms.uNight.value = darkness;
    group.visible = strength > .001;
    // A different facade hides this batch completely; do not keep uploading
    // forty-eight invisible transforms until the smile returns.
    if (strength === 0 && previousOpacity === 0) return cue;
    const frameTime = reducedMotion ? 0 : time;
    if (frameTime === previousTime && strength === previousOpacity && reducedMotion === previousReduced) return cue;
    previousTime = frameTime; previousOpacity = strength; previousReduced = reducedMotion;
    for (let index = 0; index < samples.length; index++) {
      const pose = sampleSphereBubble(time, index, { reducedMotion }, samples[index]);
      dummy.position.set(pose.x, pose.y, pose.z); dummy.scale.setScalar(pose.visible ? pose.radius : 0); dummy.updateMatrix();
      bubbles.setMatrixAt(index, dummy.matrix); bubbleAlpha.array[index] = pose.bubbleOpacity * strength;
      for (let lobe = 0; lobe < LOBES.length; lobe++) {
        const shape = LOBES[lobe], offset = index * LOBES.length + lobe;
        dummy.position.set(pose.x + shape[0] * pose.cloudScale * pose.cloudSpread,
          pose.y + shape[1] * pose.cloudScale, pose.z + shape[2] * pose.cloudScale * pose.cloudSpread);
        dummy.scale.setScalar(pose.visible ? pose.cloudScale * shape[3] : 0); dummy.updateMatrix();
        clouds.setMatrixAt(offset, dummy.matrix); cloudAlpha.array[offset] = pose.cloudOpacity * strength;
      }
    }
    bubbles.instanceMatrix.needsUpdate = true; clouds.instanceMatrix.needsUpdate = true;
    bubbleAlpha.needsUpdate = true; cloudAlpha.needsUpdate = true;
    return cue;
  }
  function dispose() {
    if (disposed) return; disposed = true;
    bubbles.dispose(); clouds.dispose(); bubbleGeometry.dispose(); cloudGeometry.dispose(); bubbleMaterial.dispose(); cloudMaterial.dispose();
    group.clear(); group.removeFromParent();
  }
  update(0);
  return Object.freeze({ group, update, dispose, statistics });
}
