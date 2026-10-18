import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleOrca } from '../../../shared/wonders.js';
import { Ocean } from './WonderPrimitives.jsx';
import { bodySection, createBodyGeometry, createSkinTexture, createSkinMicrotexture, createDorsal, createPectoral, createFluke, sampleCinematicOrca } from './OrcaAssets.js';

const TAU = Math.PI * 2;
const fract = x => x - Math.floor(x);
const rand = n => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453123);
const easing = (a, b, n) => THREE.MathUtils.smoothstep(n, a, b);

function useWhaleAssets() {
  const assets = useMemo(() => {
    const skin = createSkinTexture();
    const micro = createSkinMicrotexture();
    const body = createBodyGeometry();
    const dorsal = createDorsal();
    const left = createPectoral(-1), right = createPectoral(1), fluke = createFluke();
    const mouths = [-1, 1].map(side => {
      const points = Array.from({ length: 20 }, (_, i) => {
        const z = -3.78 + i / 19 * 1.7, [rx, ry, cy] = bodySection(z);
        const y = -0.2 - i / 19 * 0.1;
        return new THREE.Vector3(side * (Math.sqrt(Math.max(0.02, 1 - ((y - cy) / ry) ** 2)) * rx + 0.006), y, z);
      });
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 50, 0.012, 5, false);
    });
    return { skin, micro, body, dorsal, left, right, fluke, mouths };
  }, []);
  useEffect(() => () => Object.values(assets).flat().forEach(a => a.dispose?.()), [assets]);
  return assets;
}

function Whale({ assets, timeRef, reducedMotion, companion = false, townIndex = null }) {
  const group = useRef(), tail = useRef(), bodyMaterial = useRef(), shaderRef = useRef();
  const black = '#04090d';
  const finMaterial = { color: black, roughness: .43, roughnessMap: assets.micro, bumpMap: assets.micro, bumpScale: .012, clearcoat: .45, clearcoatRoughness: .24, envMapIntensity: .55, side: THREE.DoubleSide };
  const bodyCompile = shader => {
    shader.uniforms.swimTime = { value: 0 };
    shader.vertexShader = `uniform float swimTime;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      float tailWeight = smoothstep(.5, 3.98, position.z);
      transformed.y += sin(swimTime * 2.0 - position.z * .6) * tailWeight * .18;
    `);
    shaderRef.current = shader;
  };
  useFrame(() => {
    const isTown = townIndex !== null;
    const sourceTime = timeRef?.current ?? 0;
    const t = reducedMotion ? (isTown ? 0 : 8) : sourceTime / (isTown ? 1000 : 1);
    const p = isTown ? sampleOrca(sourceTime, townIndex, reducedMotion) : sampleCinematicOrca(t, companion);
    group.current.position.set(p.x, p.y, p.z);
    group.current.rotation.set(0, p.yaw, 0);
    group.current.rotateX(p.pitch); group.current.rotateZ(p.roll ?? 0);
    const phase = t + (companion ? 1.2 : 0);
    if (shaderRef.current) shaderRef.current.uniforms.swimTime.value = phase;
    tail.current.position.y = -0.1 + Math.sin(phase * 2 - 3.75 * 0.6) * 0.18;
    tail.current.rotation.x = Math.cos(phase * 2 - 3.75 * 0.6) * 0.17;
  });
  return <group ref={group} scale={townIndex === null ? (companion ? 0.78 : 1) : townIndex === 0 ? .59 : .56}>
    <mesh geometry={assets.body} castShadow receiveShadow>
      <meshPhysicalMaterial ref={bodyMaterial} map={assets.skin} roughness={0.4} roughnessMap={assets.micro} bumpMap={assets.micro} bumpScale={0.018} metalness={0} clearcoat={0.55} clearcoatRoughness={0.23} envMapIntensity={0.7} onBeforeCompile={bodyCompile}/>
    </mesh>
    <mesh geometry={assets.dorsal} castShadow><meshPhysicalMaterial {...finMaterial}/></mesh>
    {[assets.left, assets.right].map((g, i) => <mesh key={i} geometry={g} position={[0, -0.54, 0]} rotation={[0, 0, (i ? 1 : -1) * 0.19]} castShadow><meshPhysicalMaterial {...finMaterial}/></mesh>)}
    <group ref={tail} position={[0, -0.1, 3.72]}><mesh geometry={assets.fluke} castShadow><meshPhysicalMaterial {...finMaterial}/></mesh></group>
    {[-1, 1].map((side, i) => <group key={side}>
      <mesh position={[side * 0.794, 0.2, -2.77]} scale={[0.026, 0.055, 0.067]}><sphereGeometry args={[1, 16, 10]}/><meshPhysicalMaterial color="#010304" roughness={0.035} clearcoat={1}/></mesh>
      <mesh geometry={assets.mouths[i]}><meshStandardMaterial color="#010608" roughness={0.28}/></mesh>
    </group>)}
    <mesh position={[0, 1.005, -1.79]} scale={[0.08, 0.014, 0.17]}><sphereGeometry args={[1, 16, 8]}/><meshStandardMaterial color="#02070a" roughness={0.3}/></mesh>
  </group>;
}

const sprayVertex = `
  attribute vec3 velocity; attribute float delay; attribute float seed;
  uniform float age; uniform float intensity; uniform float pixelScale;
  varying float alpha; varying float brightness;
  void main(){
    float t=max(0.,age-delay);
    vec3 p=position + velocity*t; p.y-=2.6*t*t;
    p.xz+=sin(vec2(seed*16.,seed*23.)+t*3.)*.1*t;
    alpha=step(delay,age)*smoothstep(-.2,.15,p.y)*(1.-smoothstep(1.1,3.2,t));
    brightness=.75+seed*.25;
    vec4 mv=modelViewMatrix*vec4(p,1.);
    gl_Position=projectionMatrix*mv;
    gl_PointSize=clamp((1.6+seed*3.8)*pixelScale/-mv.z,1.,24.)*intensity;
  }
`;
const sprayFragment = `
  varying float alpha; varying float brightness;
  void main(){
    vec2 q=gl_PointCoord-.5; float d=length(q);
    float a=(1.-smoothstep(.08,.49,d))*alpha*.64;
    if(a<.01) discard;
    gl_FragColor=vec4(vec3(.78,.92,1.)*brightness,a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function Spray({ at, start, timeRef, reducedMotion, count = 1400, strength = 1 }) {
  const material = useRef(), group = useRef();
  const geometry = useMemo(() => {
    const p = [], v = [], d = [], s = [];
    for (let i = 0; i < count; i++) {
      const a = rand(i * 7.1) * TAU, r = rand(i * 4.7) * 1.35;
      p.push(Math.cos(a) * r, 0.03, Math.sin(a) * r);
      const speed = 1.4 + rand(i * 1.31) * 2.8;
      v.push(Math.cos(a) * speed * strength, (2 + rand(i * 2.7) * 5.7) * strength, Math.sin(a) * speed * strength);
      d.push(rand(i * 3.61) * 0.45); s.push(rand(i * 5.7));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('velocity', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('delay', new THREE.Float32BufferAttribute(d, 1));
    g.setAttribute('seed', new THREE.Float32BufferAttribute(s, 1));
    return g;
  }, [count, strength]);
  const uniforms = useMemo(() => ({ age: { value: -1 }, intensity: { value: 1 }, pixelScale: { value: 160 } }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ size }) => {
    const t = reducedMotion ? 8 : (timeRef?.current ?? 0) % 60;
    const age = t - start;
    group.current.visible = age >= 0 && age < 4.2;
    material.current.uniforms.age.value = age;
    material.current.uniforms.pixelScale.value = size.height * 0.2;
  });
  return <group ref={group} position={at}><points geometry={geometry} frustumCulled={false}>
    <shaderMaterial ref={material} uniforms={uniforms} vertexShader={sprayVertex} fragmentShader={sprayFragment} transparent depthWrite={false} blending={THREE.NormalBlending}/>
  </points></group>;
}

// Water shed from the skin keeps moving after the whale has left the surface.
// Each drop samples a historical absolute pose: pausing and scrubbing produce
// exactly the same airborne curtain without keeping an accumulated simulation.
function WaterTrail({ timeRef, reducedMotion, count = 900, companion = false }) {
  const material = useRef();
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pointSize', new THREE.Float32BufferAttribute(Array.from({ length: count }, (_, i) => i % 5 === 0 ? 3.3 : .35 + rand(i * 3.3) * .9), 1));
    return g;
  }, [count]);
  const uniforms = useMemo(() => ({ pixelScale: { value: 85 } }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ size }) => {
    const t = reducedMotion ? 8 : (timeRef?.current ?? 0) % 60;
    const p = geometry.attributes.position, opacity = geometry.attributes.alpha;
    for (let i = 0; i < count; i++) {
      const age = fract(t / 2.9 + rand(i * 1.17)) * 2.9;
      const born = sampleCinematicOrca(t - age, companion);
      const scale = companion ? .78 : 1;
      const localX = (rand(i * 8.11) - .5) * 1.6 * scale, localY = -.64 * scale, localZ = (rand(i * 4.63) * 6.5 - 2.8) * scale;
      const ry = Math.cos(born.pitch) * localY - Math.sin(born.pitch) * localZ;
      const rz = Math.sin(born.pitch) * localY + Math.cos(born.pitch) * localZ;
      const x = born.x + Math.cos(born.yaw) * localX + Math.sin(born.yaw) * rz + (rand(i * 6.9) - .5) * age * .45;
      const y = born.y + ry - .45 * age - 2.4 * age * age;
      const z = born.z - Math.sin(born.yaw) * localX + Math.cos(born.yaw) * rz + (rand(i * 3.1) - .5) * age * .45;
      p.setXYZ(i, x, Math.max(.02, y), z);
      const bornAboveWater = easing(.6, 1.4, born.y), fade = Math.max(0, 1 - age / 2.9) * easing(.02, .2, y);
      opacity.setX(i, bornAboveWater * fade * (i % 5 === 0 ? .075 : .38));
    }
    p.needsUpdate = opacity.needsUpdate = true;
    material.current.uniforms.pixelScale.value = size.height * .12;
  });
  return <points geometry={geometry} frustumCulled={false}><shaderMaterial ref={material} uniforms={uniforms} transparent depthWrite={false}
    vertexShader={`attribute float alpha; attribute float pointSize; uniform float pixelScale; varying float opacity;
      void main(){opacity=alpha; vec4 p=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*p; gl_PointSize=clamp(pointSize*pixelScale/-p.z,1.,18.);}`}
    fragmentShader={`varying float opacity; void main(){float a=exp(-dot(gl_PointCoord-.5,gl_PointCoord-.5)*16.)*opacity; if(a<.008)discard; gl_FragColor=vec4(.77,.9,.93,a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`}/></points>;
}

const foamVertex = `varying vec2 coord; void main(){coord=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const foamFragment = `
  varying vec2 coord; uniform float phase; uniform float opacity;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  void main(){
    float r=length(coord); float a=atan(coord.y,coord.x);
    float d=r+.045*sin(a*19.+phase*3.)+.025*sin(a*37.-phase);
    float edge=exp(-pow((d-.72)*12.,2.))+.55*exp(-pow((d-.9)*26.,2.));
    float grain=.45+.55*hash(floor(coord*180.));
    float alpha=edge*grain*opacity;
    if(alpha<.01)discard;
    gl_FragColor=vec4(.72,.91,.93,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
function FoamRing({ at, start, timeRef, reducedMotion, duration = 10, growth = 1 }) {
  const mesh = useRef(), material = useRef();
  const uniforms = useMemo(() => ({ phase: { value: 0 }, opacity: { value: 0 } }), []);
  useFrame(() => {
    const t = reducedMotion ? 8 : (timeRef?.current ?? 0) % 60;
    const age = t - start;
    mesh.current.visible = age >= 0 && age < duration;
    mesh.current.scale.setScalar(1.4 + Math.max(0, age) * growth);
    material.current.uniforms.phase.value = age;
    material.current.uniforms.opacity.value = Math.max(0, 1 - age / duration) * 0.7;
  });
  return <mesh ref={mesh} position={[at[0], 0.035, at[2]]} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[2.2, 2.2]}/><shaderMaterial ref={material} uniforms={uniforms} vertexShader={foamVertex} fragmentShader={foamFragment} transparent depthWrite={false}/>
  </mesh>;
}

function Wake({ timeRef, reducedMotion, companion = false }) {
  const group = useRef(), rings = useRef([]);
  useFrame(() => {
    const t = reducedMotion ? 8 : timeRef?.current ?? 0, now = sampleCinematicOrca(t, companion);
    group.current.visible = now.y < 1.8;
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const p = sampleCinematicOrca(t - i * 0.23, companion);
      ring.position.set(p.x, 0.022 + i * 0.001, p.z);
      ring.rotation.set(-Math.PI / 2, 0, -p.yaw);
      ring.scale.set(1.0 + i * 0.19, 2.4 + i * 0.29, 1);
      ring.material.opacity = (1 - i / 12) * 0.12;
    });
  });
  return <group ref={group}>{Array.from({ length: 12 }, (_, i) => <mesh key={i} ref={v => { rings.current[i] = v; }}>
    <ringGeometry args={[0.96, 1, 80, 1, Math.PI * 0.1, Math.PI * 1.8]}/><meshBasicMaterial color="#cdf1ee" transparent opacity={0.1} depthWrite={false}/>
  </mesh>)}</group>;
}

function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy, a = fx * fx * (3 - 2 * fx), b = fy * fy * (3 - 2 * fy);
  const h = (dx, dy) => rand((ix + dx) * 1.37 + (iy + dy) * 57.63);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(0, 0), h(1, 0), a), THREE.MathUtils.lerp(h(0, 1), h(1, 1), a), b);
}
function fbm(x, y) {
  let sum = 0, weight = .5;
  for (let i = 0; i < 5; i++) { sum += noise2(x, y) * weight; x = x * 2.03 + 17.1; y = y * 2.03 + 9.2; weight *= .5; }
  return sum;
}
function createIslandGeometry(width, depth, height, seed) {
  const nx = 110, nz = 62, positions = [], colors = [], uv = [], ids = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx * 2 - 1, v = j / nz * 2 - 1;
    const x = u * width * .5, z = v * depth * .5;
    const n = fbm(x * .085 + seed, z * .085 + seed * 5);
    const shore = Math.max(0, 1 - u * u - v * v * (1.15 + .22 * Math.sin(u * 6)));
    const ridge = Math.pow(shore, .78) * (.53 + n * .73);
    const y = -2 + ridge * height + (fbm(x * .56 + seed, z * .56) - .45) * 1.7 * shore;
    positions.push(x, y, z); uv.push(x * .075, z * .075);
    const stratum = Math.sin(y * 1.9 + n * 4) * .02;
    const vegetation = easing(height * .42, height * .76, y) * (.5 + n * .3);
    const wet = y < 1.1 ? .58 : 1;
    colors.push((.42 - vegetation * .11 + stratum) * wet, (.44 - vegetation * .055 + stratum) * wet, (.41 - vegetation * .13 + stratum) * wet);
    if (i < nx && j < nz) {
      const a = j * (nx + 1) + i;
      ids.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ids); g.computeVertexNormals(); return g;
}
function createBrokenRock(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = .67 + fbm(x * 3 + seed, z * 4 + y * 3) * .52;
    const ledge = .08 * Math.sin(y * 11 + seed);
    p.setXYZ(i, x * d + ledge, y * d * .84 + .1 * Math.sin(x * 5 + z * 2), z * d);
  }
  g.computeVertexNormals(); return g;
}
function Coast() {
  // Locally bundled Poly Haven CC0 scan; only the colour channel is sRGB.
  const loaded = useLoader(THREE.TextureLoader, ['/wonders/rock_boulder_dry-color.jpg', '/wonders/rock_boulder_dry-normal.jpg', '/wonders/rock_boulder_dry-roughness.jpg']);
  const assets = useMemo(() => {
    const maps = { color: loaded[0].clone(), normal: loaded[1].clone(), roughness: loaded[2].clone() };
    Object.values(maps).forEach(map => { map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4; map.needsUpdate = true; });
    maps.color.colorSpace = THREE.SRGBColorSpace;
    maps.normal.colorSpace = maps.roughness.colorSpace = THREE.NoColorSpace;
    const islands = [[-72, -112, 106, 56, 23, 1.3], [8, -150, 144, 71, 28, 7.9], [112, -133, 101, 65, 21, 13.3]]
      .map(([x, z, w, d, h, seed]) => ({ at: [x, 0, z], geometry: createIslandGeometry(w, d, h, seed) }));
    const rocks = Array.from({ length: 13 }, (_, i) => ({
      at: [(rand(i * 8.1) - .5) * 170, .25 + rand(i * 7.7), -82 - rand(i * 2.3) * 36],
      scale: [1.7 + rand(i * 3.7) * 4.8, 1.0 + rand(i * 4.1) * 3.9, 1.7 + rand(i * 6.3) * 3.4],
      angle: rand(i * 11.7) * TAU, geometry: createBrokenRock(i * 3.1 + 2),
    }));
    return { maps, islands, rocks };
  }, [loaded[0], loaded[1], loaded[2]]);
  useEffect(() => () => {
    Object.values(assets.maps).forEach(map => map.dispose());
    [...assets.islands, ...assets.rocks].forEach(a => a.geometry.dispose());
  }, [assets]);
  return <group>
    {assets.islands.map((island, i) => <mesh key={i} position={island.at} geometry={island.geometry} receiveShadow>
      <meshStandardMaterial vertexColors map={assets.maps.color} normalMap={assets.maps.normal} normalScale={[.8, .8]} roughnessMap={assets.maps.roughness} roughness={.98}/>
    </mesh>)}
    {assets.rocks.map((rock, i) => <mesh key={i} position={rock.at} scale={rock.scale} rotation={[.07 * i, rock.angle, .13]} geometry={rock.geometry} receiveShadow>
      <meshStandardMaterial color="#afb3a4" map={assets.maps.color} normalMap={assets.maps.normal} normalScale={[.85, .85]} roughnessMap={assets.maps.roughness} roughness={.98}/>
    </mesh>)}
  </group>;
}

function SeaBirds({ timeRef, reducedMotion }) {
  const birds = useRef([]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-.7,0,.08,-.28,.1,-.06,0,0,0, 0,0,0,.28,.1,-.06,.7,0,.08, -.08,0,.14,0,.04,-.25,.08,0,.14], 3));
    g.computeVertexNormals(); return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(() => birds.current.forEach((b, i) => {
    if (!b) return;
    const t = reducedMotion ? 8 : timeRef?.current ?? 0;
    const a = t * 0.045 + i * 0.7;
    b.position.set(Math.sin(a) * (24 + i * 1.8), 13 + i * 1.2 + Math.sin(a * 2) * 1.2, -18 + Math.cos(a) * 7);
    b.rotation.set(Math.sin(t * 0.6 + i) * 0.12, a + Math.PI / 2, Math.sin(a) * 0.2);
  }));
  return <group>{Array.from({ length: 7 }, (_, i) => <mesh key={i} ref={v => { birds.current[i] = v; }} geometry={geometry}><meshStandardMaterial color="#e0e5da" roughness={0.8} side={THREE.DoubleSide}/></mesh>)}</group>;
}

function Director({ timeRef, reducedMotion, cameraMode }) {
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    if (cameraMode === 'free') return;
    const t = reducedMotion ? 8 : (timeRef?.current ?? 0) % 60;
    const whale = sampleCinematicOrca(t), mobile = size.width / size.height < 0.9;
    const wide = easing(19, 25, t) * (1 - easing(36, 41, t));
    const angle = 0.34 + Math.sin(t / 60 * TAU) * 0.27;
    const radius = (mobile ? 24 : 15.4) + wide * 5;
    const focusX = whale.x * (1 - wide * 0.4), focusZ = whale.z - wide * 2;
    // Absolute, deterministic camera sampling means scrubbing never changes framing.
    camera.position.set(focusX + Math.sin(angle) * radius, 3.8 + Math.max(0, whale.y) * 0.58 + wide * 2, focusZ + Math.cos(angle) * radius);
    target.set(focusX, Math.max(0.6, whale.y + 0.4) - (mobile ? 0.7 : 0.8), focusZ - 0.2);
    camera.fov = mobile ? 47 : 43; camera.near = 0.1; camera.far = 1000;
    camera.updateProjectionMatrix(); camera.lookAt(target);
  });
  return null;
}

const townFoamVertex = `varying vec2 coord; varying vec2 poolCoord;
  void main(){coord=position.xy; vec4 world=modelMatrix*vec4(position,1.);
  poolCoord=vec2((world.x+64.)/8.45,(world.z-19.)/7.45);
  gl_Position=projectionMatrix*viewMatrix*world;}`;
const townFoamFragment = foamFragment
  .replace('varying vec2 coord;', 'varying vec2 coord; varying vec2 poolCoord;')
  .replace('void main(){', 'void main(){if(dot(poolCoord,poolCoord)>1.)discard;');

function TownOrcaWater({ timeRef, reducedMotion, active, index }) {
  const points = useRef(), material = useRef(), foams = useRef([]);
  const count = 128;
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pointSize', new THREE.Float32BufferAttribute(Array.from({ length: count }, (_, i) => .025 + rand(i * 1.9) * .065), 1));
    return g;
  }, []);
  const uniforms = useMemo(() => ({ pixelScale: { value: 30 }, orthographic: { value: 1 } }), []);
  const foamUniforms = useMemo(() => Array.from({ length: 5 }, () => ({ phase: { value: 0 }, opacity: { value: 0 } })), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ camera, size }) => {
    const enabled = active && !reducedMotion;
    points.current.visible = enabled;
    foams.current.forEach(foam => { if (foam) foam.visible = enabled; });
    if (!enabled) return;
    const time = timeRef?.current ?? 0, seconds = time / 1000, scale = index === 0 ? .59 : .56;
    const position = geometry.attributes.position, opacity = geometry.attributes.alpha;
    for (let i = 0; i < count; i++) {
      const age = fract(seconds / 1.55 + rand(i * 1.17)) * 1.55;
      // The source of truth remains the multiplayer town's millisecond sampler.
      const born = sampleOrca(time - age * 1000, index, false);
      const lx = (rand(i * 8.11) - .5) * 1.5 * scale;
      const ly = -.55 * scale, lz = (rand(i * 4.63) * 6.1 - 2.7) * scale;
      const ry = Math.cos(born.pitch) * ly - Math.sin(born.pitch) * lz;
      const rz = Math.sin(born.pitch) * ly + Math.cos(born.pitch) * lz;
      const x = born.x + Math.cos(born.yaw) * lx + Math.sin(born.yaw) * rz + (rand(i * 6.9) - .5) * age * .18;
      const y = born.y + ry - age * .25 - age * age * 2.3;
      const z = born.z - Math.sin(born.yaw) * lx + Math.cos(born.yaw) * rz + (rand(i * 3.1) - .5) * age * .18;
      position.setXYZ(i, x, Math.max(-.025, y), z);
      const insidePool = ((x + 64) / 8.45) ** 2 + ((z - 19) / 7.45) ** 2 <= 1;
      opacity.setX(i, insidePool ? easing(.15, .8, born.y) * easing(-.02, .1, y) * (1 - age / 1.55) * .52 : 0);
    }
    position.needsUpdate = opacity.needsUpdate = true;
    const ortho = camera.isOrthographicCamera;
    material.current.uniforms.orthographic.value = ortho ? 1 : 0;
    material.current.uniforms.pixelScale.value = ortho ? size.height / ((camera.top - camera.bottom) / camera.zoom) : size.height * .6;
    foams.current.forEach((foam, j) => {
      if (!foam) return;
      const age = j * .21, p = sampleOrca(time - age * 1000, index, false);
      foam.visible = p.splash > .06;
      foam.position.set(p.x, -.016 + j * .001, p.z);
      foam.scale.setScalar(.5 + age * 1.5);
      foam.material.uniforms.phase.value = seconds + age;
      foam.material.uniforms.opacity.value = p.splash * (1 - age / 1.4) * .5;
    });
  });
  return <group>
    <points ref={points} geometry={geometry} frustumCulled={false}><shaderMaterial ref={material} uniforms={uniforms} transparent depthWrite={false}
      vertexShader={`attribute float alpha; attribute float pointSize; uniform float pixelScale; uniform float orthographic; varying float opacity;
        void main(){opacity=alpha; vec4 p=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*p;
        float distanceScale=mix(1./max(.1,-p.z),1.,orthographic); gl_PointSize=clamp(pointSize*pixelScale*distanceScale,1.,6.);}`}
      fragmentShader={`varying float opacity; void main(){float a=exp(-dot(gl_PointCoord-.5,gl_PointCoord-.5)*18.)*opacity; if(a<.01)discard; gl_FragColor=vec4(.77,.93,.96,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`}/></points>
    {foamUniforms.map((foamUniform, j) => <mesh key={j} ref={v => { foams.current[j] = v; }} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[2.2, 2.2]}/><shaderMaterial uniforms={foamUniform} vertexShader={townFoamVertex} fragmentShader={townFoamFragment} transparent depthWrite={false}/>
    </mesh>)}
  </group>;
}

/** Additive main-town show. No water plane, lights, camera, sky or environment. */
export function TownOrcaShow({ timeRef, reducedMotion = false, active = true }) {
  const assets = useWhaleAssets();
  return <group name="town-detailed-orca-show">
    {[0, 1].map(index => <group key={index}>
      <Whale assets={assets} timeRef={timeRef} reducedMotion={reducedMotion} townIndex={index}/>
      <TownOrcaWater timeRef={timeRef} reducedMotion={reducedMotion} active={active} index={index}/>
    </group>)}
  </group>;
}

export default function OrcaExperience({ timeRef, reducedMotion = false, quality = 'high', cameraMode = 'director' }) {
  const assets = useWhaleAssets();
  const impacts = useMemo(() => [
    { t: 4.1, who: false, strength: 0.62 }, { t: 11.75, who: false, strength: 1.2 },
    { t: 27.1, who: false, strength: 0.62 }, { t: 28.3, who: true, strength: 0.5 },
    { t: 34.75, who: false, strength: 1.25 }, { t: 34.95, who: true, strength: 0.95 },
    { t: 50.2, who: false, strength: 0.8 },
  ].map(e => {
    const p = sampleCinematicOrca(e.t, e.who);
    return { ...e, at: [p.x, 0, p.z] };
  }), []);
  return <group>
    <Ocean timeRef={timeRef} reducedMotion={reducedMotion} size={800} color="#0b3943"/>
    <Coast/>
    <Whale assets={assets} timeRef={timeRef} reducedMotion={reducedMotion}/>
    <Whale assets={assets} timeRef={timeRef} reducedMotion={reducedMotion} companion/>
    <WaterTrail timeRef={timeRef} reducedMotion={reducedMotion} count={quality === 'balanced' ? 500 : 1000}/>
    <WaterTrail timeRef={timeRef} reducedMotion={reducedMotion} count={quality === 'balanced' ? 250 : 550} companion/>
    <Wake timeRef={timeRef} reducedMotion={reducedMotion}/>
    <Wake timeRef={timeRef} reducedMotion={reducedMotion} companion/>
    {impacts.map((event, i) => <group key={i}>
      <Spray at={event.at} start={event.t} timeRef={timeRef} reducedMotion={reducedMotion} count={quality === 'balanced' ? 700 : 1700} strength={event.strength}/>
      <FoamRing at={event.at} start={event.t} timeRef={timeRef} reducedMotion={reducedMotion} growth={event.strength * 0.95}/>
    </group>)}
    <SeaBirds timeRef={timeRef} reducedMotion={reducedMotion}/>
    <Director timeRef={timeRef} reducedMotion={reducedMotion} cameraMode={cameraMode}/>
  </group>;
}
