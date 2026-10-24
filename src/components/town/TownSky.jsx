import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { REALISTIC_ISLAND, inRealisticIsland } from '../../../shared/realistic-island.js';
import { METRO_ISLAND, inMetroIsland } from '../../../shared/metro-island.js';
import { groundHeight } from '../../../shared/world.js';
import { sampleDayNight } from '../../../shared/dayNight.js';

// Extend aerial exploration visibility without changing the established
// ground haze or the independently directed wonder/drone/outdoor cameras.
export function explorationFogOffset(viewMode, cameraHeight, playerHeight, outdoorActive = false, perspective = true) {
  if (outdoorActive || !perspective || (viewMode !== 'follow' && viewMode !== 'first-person')) return 0;
  const eyeHeight = Number.isFinite(cameraHeight) ? Math.max(0, cameraHeight) : 0;
  const altitude = Number.isFinite(playerHeight) ? Math.max(0, playerHeight) : 0;
  // The camera boom itself must not thin the fog while standing on the ground.
  // Looking upward can put the lens below the avatar; use the lower altitude.
  return Math.min(eyeHeight, altitude);
}

export const SKY_VERTEX_SHADER = /* glsl */`
  varying vec2 skyUv;
  void main() {
    skyUv = position.xy;
    // A far-plane backdrop works for BOTH orthographic and perspective cameras.
    // It never writes depth, casts shadows, receives fog, or blocks world geometry.
    gl_Position = vec4(position.xy, 0.999999, 1.0);
  }
`;

export const SKY_FRAGMENT_SHADER = /* glsl */`
  varying vec2 skyUv;
  uniform mat4 viewWorld;
  uniform float aspect, tanHalfFov, orthographicView;
  uniform float daylight, nightOpacity, twilight, animationTime;
  uniform float sunVisibility, moonVisibility;
  uniform vec3 sunDirection, moonDirection;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float puff(vec2 p, vec2 scale) { return 1.0 - smoothstep(0.68, 1.0, length(p / scale)); }
  float clouds(vec3 ray) {
    float longitude = atan(ray.x, -ray.z);
    float cloud = 0.0;
    for (int i = 0; i < 9; i++) {
      float n = float(i);
      float center = -3.14159 + n * 0.69813 + animationTime * 0.002;
      float dx = mod(longitude - center + 3.14159, 6.28318) - 3.14159;
      float altitude = 0.22 + hash(vec2(n, 7.2)) * 0.34;
      float width = 0.15 + hash(vec2(n, 3.6)) * 0.11;
      vec2 p = vec2(dx, ray.y - altitude);
      float c = puff(p, vec2(width, 0.07));
      c = max(c, puff(p - vec2(-width * 0.58, 0.014), vec2(width * 0.66, 0.055)));
      c = max(c, puff(p - vec2(width * 0.50, 0.035), vec2(width * 0.72, 0.089)));
      cloud = max(cloud, c);
    }
    return cloud * smoothstep(0.04, 0.16, ray.y);
  }

  void main() {
    vec3 ray;
    if (orthographicView > 0.5) {
      // A diorama's downward orthographic rays cannot see the real upper sky.
      // Its scenic backdrop uses a fixed panorama; first person uses world rays.
      ray = normalize(vec3(skyUv.x * max(aspect, 1.0) * 0.72, 0.14 + skyUv.y * 0.76, -1.0));
    } else {
      ray = normalize((viewWorld * vec4(skyUv.x * aspect * tanHalfFov, skyUv.y * tanHalfFov, -1.0, 0.0)).xyz);
    }
    float height = smoothstep(-0.18, 0.82, ray.y);
    vec3 dayColor = mix(vec3(0.69, 0.83, 0.93), vec3(0.14, 0.43, 0.74), height);
    vec3 nightColor = mix(vec3(0.040, 0.055, 0.115), vec3(0.006, 0.013, 0.043), height);
    vec3 color = mix(nightColor, dayColor, daylight);
    float horizon = pow(max(0.0, 1.0 - abs(ray.y) * 1.7), 3.0);
    color = mix(color, vec3(0.63, 0.24, 0.15), twilight * horizon * 0.54);

    // Stable seeded stars: no buffers/textures and no random changes per frame.
    vec2 starUv = vec2(atan(ray.x, ray.z) / 6.28318 + 0.5, asin(clamp(ray.y, -1.0, 1.0)) / 3.14159 + 0.5);
    vec2 grid = starUv * vec2(360.0, 180.0);
    vec2 cell = floor(grid);
    float seed = hash(cell);
    vec2 starCenter = vec2(hash(cell + 17.0), hash(cell + 71.0)) * 0.60 + 0.20;
    float starRadius = mix(0.06, 0.17, hash(cell + 4.0));
    float star = (1.0 - smoothstep(0.0, starRadius, length(fract(grid) - starCenter))) * step(0.973, seed);
    float shimmer = 0.82 + sin(animationTime * 0.6 + seed * 40.0) * 0.18;
    color += vec3(1.15, 1.25, 1.50) * star * shimmer * nightOpacity * smoothstep(-0.05, 0.12, ray.y);

    float sunDistance = length(ray - sunDirection);
    float sunDisk = 1.0 - smoothstep(0.050, 0.057, sunDistance);
    float sunGlow = exp(-sunDistance * sunDistance * 45.0) * 0.26;
    color += vec3(1.7, 1.18, 0.54) * (sunDisk + sunGlow) * sunVisibility;

    float moonDistance = length(ray - moonDirection);
    float moonDisk = 1.0 - smoothstep(0.045, 0.049, moonDistance);
    vec3 moonRight = normalize(cross(vec3(0.0, 1.0, 0.0), moonDirection));
    vec3 moonUp = cross(moonDirection, moonRight);
    vec2 moonUv = vec2(dot(ray - moonDirection, moonRight), dot(ray - moonDirection, moonUp)) / 0.046;
    float craters = 0.12 * (1.0 - smoothstep(0.14, 0.24, length(moonUv - vec2(-0.30, 0.30))))
      + 0.10 * (1.0 - smoothstep(0.20, 0.31, length(moonUv - vec2(0.35, -0.15))))
      + 0.07 * (1.0 - smoothstep(0.09, 0.16, length(moonUv - vec2(-0.25, -0.45))));
    color += vec3(0.21, 0.27, 0.41) * exp(-moonDistance * moonDistance * 160.0) * moonVisibility;
    color = mix(color, vec3(0.86, 0.92, 1.0) - craters, moonDisk * moonVisibility);

    float cloud = clouds(ray);
    vec3 cloudColor = mix(vec3(0.09, 0.115, 0.18), vec3(1.0, 0.99, 0.96), daylight);
    color = mix(color, cloudColor, cloud * (0.12 + daylight * 0.79));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSkyUniforms() {
  return {
    viewWorld: { value: new THREE.Matrix4() }, aspect: { value: 1 }, tanHalfFov: { value: 0.7 },
    orthographicView: { value: 1 }, daylight: { value: 1 }, nightOpacity: { value: 0 },
    twilight: { value: 0 }, animationTime: { value: 0 }, sunVisibility: { value: 1 }, moonVisibility: { value: 0 },
    sunDirection: { value: new THREE.Vector3() }, moonDirection: { value: new THREE.Vector3() },
  };
}

export function updateSkyMaterial(material, { camera, size, clock }, state, reducedMotion) {
  // R3F can clone or replace uniform wrappers during prop reconciliation. Always
  // mutate the live ShaderMaterial's wrappers, never the initial props object.
  if (!material?.uniforms) return;
  const uniforms = material.uniforms;
  uniforms.viewWorld.value.copy(camera.matrixWorld);
  uniforms.aspect.value = size.width / Math.max(1, size.height);
  uniforms.tanHalfFov.value = Math.tan((camera.fov || 70) * Math.PI / 360);
  uniforms.orthographicView.value = camera.isOrthographicCamera ? 1 : 0;
  for (const key of ['daylight', 'nightOpacity', 'twilight', 'sunVisibility', 'moonVisibility']) uniforms[key].value = state[key];
  uniforms.animationTime.value = reducedMotion ? 0 : clock.elapsedTime;
  uniforms.sunDirection.value.set(...state.sunDirection);
  uniforms.moonDirection.value.set(...state.moonDirection);
}

/** All atmospheric work uses refs/uniforms, never per-frame React updates. */
export default function TownSky({ spaceRuntime, timeRef, reducedMotion = false, viewMode = 'overview', playerPoseRef, outdoorSelected = null }) {
  const ambient = useRef();
  const hemisphere = useRef();
  const sun = useRef();
  const moon = useRef();
  const fog = useRef();
  const material = useRef();
  const uniforms = useMemo(createSkyUniforms, []);
  const colors = useMemo(() => ({
    daySky: new THREE.Color('#b9dcf3'), nightSky: new THREE.Color('#7288bd'),
    dayGround: new THREE.Color('#ac9274'), nightGround: new THREE.Color('#4b526e'),
    dayFog: new THREE.Color('#b8d7e8'), nightFog: new THREE.Color('#202a47'),
    daySun: new THREE.Color('#fff0cc'), duskSun: new THREE.Color('#f6b281'),
  }), []);
  useFrame(frame => {
    const state = sampleDayNight(timeRef?.current ?? 0);
    const space=spaceRuntime?.current.mode && spaceRuntime.current.mode!=="ground" ? THREE.MathUtils.smoothstep(frame.camera.position.y,700,2800):0;
    updateSkyMaterial(material.current, frame, {...state,daylight:state.daylight*(1-space),nightOpacity:Math.max(state.nightOpacity,space)}, reducedMotion);
    if (ambient.current) ambient.current.intensity = state.ambientIntensity;
    if (hemisphere.current) {
      hemisphere.current.intensity = state.hemisphereIntensity;
      hemisphere.current.color.copy(colors.nightSky).lerp(colors.daySky, state.daylight);
      hemisphere.current.groundColor.copy(colors.nightGround).lerp(colors.dayGround, state.daylight);
    }
    if (sun.current) {
      const p = playerPoseRef?.current;
      const islandFocus = viewMode === 'island' || (['follow', 'first-person'].includes(viewMode) && p && inRealisticIsland(p.x, p.z));
      const metroFocus = viewMode === 'metro' || (['follow', 'first-person'].includes(viewMode) && p && inMetroIsland(p.x, p.z));
      const fx = metroFocus ? (viewMode === 'metro' ? METRO_ISLAND.x : p.x) : islandFocus ? (viewMode === 'island' ? REALISTIC_ISLAND.x : p.x) : 0;
      const fz = metroFocus ? (viewMode === 'metro' ? METRO_ISLAND.z : p.z) : islandFocus ? (viewMode === 'island' ? REALISTIC_ISLAND.z : p.z) : 0;
      const fy = metroFocus ? 35 : islandFocus ? (viewMode === 'island' ? 12 : groundHeight(p.x, p.z)) : 0;
      sun.current.target.position.set(fx, fy, fz); sun.current.target.updateMatrixWorld();
      sun.current.position.set(...state.sunDirection).multiplyScalar(metroFocus ? 300 : 160).add(sun.current.target.position);
      const shadow = sun.current.shadow.camera, extent = metroFocus ? 190 : 105, far = metroFocus ? 520 : 360;
      if (shadow.right !== extent || shadow.far !== far) { shadow.left = -extent; shadow.right = extent; shadow.top = extent; shadow.bottom = -extent; shadow.far = far; shadow.updateProjectionMatrix(); sun.current.shadow.needsUpdate = true; }
      sun.current.intensity = state.sunIntensity;
      sun.current.color.copy(colors.duskSun).lerp(colors.daySun, state.daylight);
      sun.current.castShadow = state.sunIntensity > 0.01;
    }
    if (moon.current) {
      moon.current.position.set(...state.moonDirection).multiplyScalar(70);
      moon.current.intensity = state.moonIntensity;
    }
    if (fog.current) {
      fog.current.color.copy(colors.nightFog).lerp(colors.dayFog, state.daylight);
      const offset = viewMode === 'metro' ? 850 : viewMode === 'island' ? 300 : explorationFogOffset(viewMode, frame.camera.position.y, playerPoseRef?.current?.y, !!outdoorSelected, frame.camera.isPerspectiveCamera === true);
      fog.current.near = 175 + offset;
      fog.current.far = 340 + offset;
    }
  });
  return <>
    <color attach="background" args={['#92bbd7']} />
    <fog ref={fog} attach="fog" args={['#b8d7e8', 175, 340]} />
    <mesh frustumCulled={false} renderOrder={-1000} userData={{ isSky: true }} raycast={() => null}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={material} uniforms={uniforms} vertexShader={SKY_VERTEX_SHADER} fragmentShader={SKY_FRAGMENT_SHADER} depthWrite={false} />
    </mesh>
    <ambientLight ref={ambient} color="#edf0ff" intensity={0.64} />
    <hemisphereLight ref={hemisphere} args={['#b9dcf3', '#ac9274', 1.47]} />
    {/* Only the sun allocates a shadow map. The moon's cool fill keeps nights playable. */}
    <directionalLight ref={sun} castShadow position={[25, 36, -57]} intensity={2.7} color="#fff0cc" shadow-mapSize={[2048, 2048]} shadow-camera-left={-105} shadow-camera-right={105} shadow-camera-top={105} shadow-camera-bottom={-105} shadow-camera-near={0.5} shadow-camera-far={360} shadow-bias={-0.0003} shadow-normalBias={0.035} />
    <directionalLight ref={moon} position={[-25, -36, 57]} intensity={0} color="#8aa7e8" />
  </>;
}
