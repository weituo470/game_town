import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Ocean } from './WonderPrimitives.jsx';
import { sampleRocket, sampleWonder } from '../../../shared/wonders.js';
import { createTownRocketPlumeResources, sampleTownRocketPlumes, writeTownRocketPlumeFrame } from './rocketPlume.js';

// This is a visual launch sequence, not an engineering or flight simulation.
// All moving elements sample the same absolute seconds so scrubbing is deterministic.
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (v) => { const n = clamp(v); return n * n * (3 - 2 * n); };
const random = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return x - Math.floor(x); };
const VERTICAL = new THREE.Vector3(0, 1, 0);
const ZERO_TIME = { current: 0 };
const SCANNED_SURFACES = ['aerial_grass_rock', 'concrete_floor'].flatMap(name => ['color', 'normal', 'roughness'].map(kind => `/wonders/${name}-${kind}.jpg`));

export function rocketAltitude(seconds) {
  const elapsed = Math.max(0, seconds - 12);
  return 0.3 * elapsed * elapsed + 0.012 * elapsed * elapsed * elapsed;
}
const rocketDrift = (seconds) => seconds > 32 ? Math.pow(seconds - 32, 2) * 0.025 : 0;
const rocketLean = (seconds) => seconds > 28 ? -smooth((seconds - 28) / 32) * 0.09 : 0;
const renderSeconds = value => Number.isFinite(value) ? clamp(value, 0, 60) : 0;

function Box({ position, size, material, ...props }) {
  return <mesh position={position} material={material} castShadow receiveShadow {...props}><boxGeometry args={size}/></mesh>;
}
function Cylinder({ position, radius, height, material, top = radius, segments = 48, ...props }) {
  return <mesh position={position} material={material} castShadow receiveShadow {...props}><cylinderGeometry args={[top, radius, height, segments]}/></mesh>;
}
function Ring({ position, radius, thickness = 0.035, material, ...props }) {
  return <mesh position={position} rotation={[Math.PI / 2, 0, 0]} material={material} {...props}><torusGeometry args={[radius, thickness, 5, 64]}/></mesh>;
}

function Beams({ lines, material, radius = 0.13 }) {
  const ref = useRef();
  const matrices = useMemo(() => {
    const dummy = new THREE.Object3D();
    return lines.map(([start, end, width]) => {
      const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
      const delta = b.clone().sub(a);
      dummy.position.copy(a).add(b).multiplyScalar(0.5);
      dummy.quaternion.setFromUnitVectors(VERTICAL, delta.clone().normalize());
      dummy.scale.set(width ?? radius, delta.length(), width ?? radius);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });
  }, [lines, radius]);
  useLayoutEffect(() => {
    matrices.forEach((matrix, i) => ref.current?.setMatrixAt(i, matrix));
    if (ref.current) { ref.current.instanceMatrix.needsUpdate = true; ref.current.computeBoundingSphere(); }
  }, [matrices]);
  return <instancedMesh ref={ref} args={[undefined, material, matrices.length]} castShadow receiveShadow><cylinderGeometry args={[1, 1, 1, 6]}/></instancedMesh>;
}

function StaticBatch({ children }) {
  const source = useRef();
  const [batches, setBatches] = useState([]);
  useLayoutEffect(() => {
    const root = source.current;
    if (!root) return;
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert(), buckets = new Map();
    const instance = new THREE.Matrix4();
    root.traverse(node => {
      if (!node.isMesh || !node.geometry || Array.isArray(node.material)) return;
      const base = new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld);
      const append = matrix => {
        const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
        geometry.applyMatrix4(matrix);
        if (!buckets.has(node.material)) buckets.set(node.material, []);
        buckets.get(node.material).push(geometry);
      };
      if (node.isInstancedMesh) {
        for (let i = 0; i < node.count; i++) { node.getMatrixAt(i, instance); append(new THREE.Matrix4().multiplyMatrices(base, instance)); }
      } else append(base);
    });
    const merged = [...buckets.entries()].map(([material, pieces]) => {
      const geometry = mergeGeometries(pieces, false);
      pieces.forEach(g => g.dispose()); geometry.computeBoundingSphere();
      return { geometry, material };
    });
    setBatches(merged);
    return () => merged.forEach(b => b.geometry.dispose());
    // The assembly is immutable; only its outer group moves during launch.
  }, []);
  return <group><group ref={source} visible={false}>{children}</group>{batches.map(({ geometry, material }) => <mesh key={material.uuid} geometry={geometry} material={material} castShadow receiveShadow dispose={null}/>)}</group>;
}

function makeSurfaceTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = kind === 'shell' ? 2048 : 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = kind === 'concrete' ? '#b3b0a5' : '#e9eae6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const shade = (random(i * 0.025) - 0.5) * (kind === 'concrete' ? 25 : 8);
    pixels.data[i] += shade; pixels.data[i + 1] += shade; pixels.data[i + 2] += shade;
  }
  ctx.putImageData(pixels, 0, 0);
  ctx.strokeStyle = kind === 'concrete' ? 'rgba(50,53,48,.16)' : 'rgba(87,95,98,.10)';
  ctx.lineWidth = kind === 'concrete' ? 2 : 1;
  for (let y = 0; y <= canvas.height; y += kind === 'concrete' ? 128 : 208) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
  }
  for (let x = 0; x <= 512; x += 128) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  if (kind === 'shell') {
    // Restrained grime, condensation trails and slightly mismatched sheet panels.
    // The tank is painted metal, not a perfectly white unlit cylinder.
    for (let row = 0; row < 10; row++) {
      ctx.fillStyle = `rgba(70,78,79,${0.015 + random(row + 54) * 0.035})`;
      ctx.fillRect(0, row * 208 + 1, 512, 205);
      for (let x = 5; x < 512; x += 17) {
        ctx.fillStyle = 'rgba(48,58,62,.18)'; ctx.fillRect(x, row * 208 + 3, 1.3, 1.8);
      }
    }
    for (let i = 0; i < 65; i++) {
      const x = random(i + 2) * 512, y = random(i + 91) * 1800;
      const length = 40 + random(i + 191) * 190;
      const g = ctx.createLinearGradient(0, y, 0, y + length);
      g.addColorStop(0, `rgba(72,80,78,${0.025 + random(i) * 0.06})`); g.addColorStop(1, 'rgba(72,80,78,0)');
      ctx.fillStyle = g; ctx.fillRect(x, y, 1 + random(i + 13) * 3, length);
    }
    const soot = ctx.createLinearGradient(0, 1670, 0, 2048);
    soot.addColorStop(0, 'rgba(55,63,65,0)'); soot.addColorStop(1, 'rgba(55,63,65,.19)');
    ctx.fillStyle = soot; ctx.fillRect(0, 1670, 512, 378);
    // A fictional mission marking is painted into the shell, not a floating UI label.
    ctx.save(); ctx.translate(28, 505); ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#35434a'; ctx.font = '600 62px Arial'; ctx.fillText('N O V A', 0, 0); ctx.restore();
    ctx.fillStyle = '#434c4c'; ctx.font = '600 30px Arial'; ctx.fillText('01', 19, 350);
    ctx.fillStyle = '#b68137'; ctx.fillRect(11, 1390, 11, 27);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'concrete' ? 8 : 1, kind === 'concrete' ? 8 : 1);
  texture.anisotropy = 8;
  return texture;
}

function useMaterials() {
  const scans = useTexture(SCANNED_SURFACES);
  const textures = useMemo(() => {
    const maps = scans.map((original, i) => {
      const texture = original.clone();
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = i % 3 === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.repeat.set(i < 3 ? 58 : 18, i < 3 ? 58 : 18);
      texture.anisotropy = 12; texture.needsUpdate = true;
      return texture;
    });
    const asphalt = maps[3].clone(); asphalt.repeat.set(4, 24); asphalt.needsUpdate = true;
    return { grass: maps[0], grassNormal: maps[1], grassRough: maps[2], concrete: maps[3], concreteNormal: maps[4], concreteRough: maps[5], asphalt, shell: makeSurfaceTexture('shell') };
  }, [scans]);
  const materials = useMemo(() => ({
    shell: new THREE.MeshStandardMaterial({ color: '#f0f1ec', map: textures.shell, bumpMap: textures.shell, bumpScale: 0.018, roughness: 0.44, metalness: 0.28 }),
    fairing: new THREE.MeshStandardMaterial({ color: '#dddeda', roughness: 0.37, metalness: 0.24 }),
    soot: new THREE.MeshStandardMaterial({ color: '#1d2326', roughness: 0.69, metalness: 0.42 }),
    charcoal: new THREE.MeshStandardMaterial({ color: '#343b3d', roughness: 0.63, metalness: 0.61 }),
    steel: new THREE.MeshStandardMaterial({ color: '#87918f', roughness: 0.44, metalness: 0.74 }),
    silver: new THREE.MeshStandardMaterial({ color: '#c9ceca', roughness: 0.32, metalness: 0.8 }),
    tower: new THREE.MeshStandardMaterial({ color: '#b9beb4', roughness: 0.65, metalness: 0.57 }),
    cream: new THREE.MeshStandardMaterial({ color: '#cecfb9', roughness: 0.8, metalness: 0.2 }),
    yellow: new THREE.MeshStandardMaterial({ color: '#e2ac35', roughness: 0.7, metalness: 0.24 }),
    red: new THREE.MeshStandardMaterial({ color: '#a84431', roughness: 0.61, metalness: 0.28 }),
    concrete: new THREE.MeshStandardMaterial({ color: '#b5b6ad', map: textures.concrete, normalMap: textures.concreteNormal, normalScale: new THREE.Vector2(0.65, 0.65), roughnessMap: textures.concreteRough, roughness: 0.91 }),
    ground: new THREE.MeshStandardMaterial({ color: '#c4c5b8', map: textures.grass, normalMap: textures.grassNormal, normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: textures.grassRough, roughness: 0.96, vertexColors: true }),
    sand: new THREE.MeshStandardMaterial({ color: '#9d977b', roughness: 1 }),
    asphalt: new THREE.MeshStandardMaterial({ color: '#353c3f', map: textures.asphalt, normalMap: textures.concreteNormal, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.95 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#1d3947', roughness: 0.16, metalness: 0.55, clearcoat: 1 }),
  }), [textures]);
  useEffect(() => () => { Object.values(materials).forEach(m => m.dispose()); Object.values(textures).forEach(t => t.dispose()); }, [materials, textures]);
  return materials;
}

function Fairing({ material }) {
  const geometry = useMemo(() => new THREE.LatheGeometry([
    new THREE.Vector2(2.5, 55.6), new THREE.Vector2(3.05, 56.6), new THREE.Vector2(3.15, 58.2),
    new THREE.Vector2(3.15, 61.9), new THREE.Vector2(2.93, 64), new THREE.Vector2(2.45, 66),
    new THREE.Vector2(1.76, 67.7), new THREE.Vector2(0.8, 69.2), new THREE.Vector2(0.04, 70.1),
    new THREE.Vector2(0, 70.16),
  ], 72), []);
  return <mesh geometry={geometry} material={material} castShadow receiveShadow/>;
}

function Engine({ position, materials, size = 1 }) {
  const geometry = useMemo(() => new THREE.LatheGeometry([
    new THREE.Vector2(0.49, 1.7), new THREE.Vector2(0.34, 1.35), new THREE.Vector2(0.29, 1.06),
    new THREE.Vector2(0.41, 0.72), new THREE.Vector2(0.66, 0.29), new THREE.Vector2(0.83, 0),
    new THREE.Vector2(0.77, -0.03), new THREE.Vector2(0.61, 0.3), new THREE.Vector2(0.33, 1.05),
  ], 32), []);
  return <group position={position} scale={size}>
    <mesh geometry={geometry} material={materials.charcoal} castShadow/>
    <Ring position={[0, 0.04, 0]} radius={0.81} thickness={0.065} material={materials.silver}/>
    <Ring position={[0, 1.46, 0]} radius={0.45} thickness={0.08} material={materials.steel}/>
    <Cylinder position={[0.58, 1.53, 0]} radius={0.14} height={1.2} material={materials.silver}/>
  </group>;
}

function Booster({ side, materials }) {
  const x = side * 4.7;
  return <group position={[x, 0.55, 0]}>
    <Cylinder position={[0, 23, 0]} radius={1.92} height={38} material={materials.shell}/>
    <Cylinder position={[0, 3.25, 0]} radius={1.92} height={2.5} material={materials.soot}/>
    <Cylinder position={[0, 43.2, 0]} radius={1.92} top={1.85} height={2.4} material={materials.soot}/>
    <mesh position={[0, 44.4, 0]} material={materials.fairing} castShadow><latheGeometry args={[[new THREE.Vector2(1.85, 0), new THREE.Vector2(1.7, 1.1), new THREE.Vector2(1.25, 2.4), new THREE.Vector2(0.55, 3.6), new THREE.Vector2(0.02, 4.2)], 48]}/></mesh>
    {[5, 9.5, 14, 19, 24, 29, 34, 39, 41.8].map(y => <Ring key={y} position={[0, y, 0]} radius={1.927} material={materials.silver}/>) }
    <Cylinder position={[side * 1.91, 23, 0.32]} radius={0.115} height={35} material={materials.fairing}/>
    {[0, 1, 2, 3, 4, 5].map(i => <Engine key={i} position={[Math.cos(i / 6 * Math.PI * 2) * 1.05, 0, Math.sin(i / 6 * Math.PI * 2) * 1.05]} materials={materials} size={0.7}/>)}
    <Engine position={[0, 0, 0]} materials={materials} size={0.7}/>
    {[-1, 1].map(sign => <group key={sign}>
      <Box position={[sign * 1.2, 6.5, 1.2]} size={[0.26, 7, 0.45]} material={materials.charcoal} rotation={[0.11, 0, sign * -0.08]}/>
      <Box position={[sign * 1.2, 38.4, 1.44]} size={[1.3, 0.2, 1.8]} material={materials.charcoal} rotation={[Math.PI / 2 - 0.1, 0, 0]}/>
    </group>)}
  </group>;
}

function RocketBody({ materials }) {
  const pipes = useMemo(() => [0, 1, 2, 3].flatMap(i => {
    const angle = 0.8 + i * Math.PI / 2;
    return [[[Math.sin(angle) * 2.53, 4, Math.cos(angle) * 2.53], [Math.sin(angle) * 2.53, 40, Math.cos(angle) * 2.53], 0.1]];
  }), []);
  return <group>
    <Cylinder position={[0, 23.5, 0]} radius={2.5} height={39} material={materials.shell}/>
    <Cylinder position={[0, 3.1, 0]} radius={2.5} top={2.45} height={2.3} material={materials.soot}/>
    <Cylinder position={[0, 45.5, 0]} radius={2.5} height={5} material={materials.soot}/>
    <Cylinder position={[0, 52, 0]} radius={2.5} height={8} material={materials.shell}/>
    <Fairing material={materials.fairing}/>
    <Beams lines={pipes} material={materials.fairing}/>
    {[4, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42.7, 43, 47.9, 51, 55.7].map((y, i) => <Ring key={y} position={[0, y, 0]} radius={2.505} thickness={i === 10 || i === 12 ? 0.07 : 0.028} material={materials.silver}/>)}
    {[0, 1, 2, 3].map(i => <Box key={i} position={[Math.sin(i * Math.PI / 2) * 2.52, 44.5, Math.cos(i * Math.PI / 2) * 2.52]} size={[0.38, 2.5, 0.08]} material={materials.steel} rotation={[0, i * Math.PI / 2, 0]}/>)}
    {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <Engine key={i} position={[Math.cos(i / 8 * Math.PI * 2) * 1.66, 0, Math.sin(i / 8 * Math.PI * 2) * 1.66]} materials={materials} size={0.85}/>)}
    <Engine position={[0, 0, 0]} materials={materials}/>
    <Booster side={-1} materials={materials}/><Booster side={1} materials={materials}/>
    {[-1, 1].map(side => <group key={side}>
      <Box position={[side * 3, 8.1, 0]} size={[2.2, 0.7, 1]} material={materials.silver}/>
      <Box position={[side * 3, 39.5, 0]} size={[2.2, 0.5, 0.8]} material={materials.silver}/>
      <Box position={[side * 1.4, 52.1, 2.06]} size={[0.13, 4.6, 0.1]} material={materials.red}/>
    </group>)}
    {/* Payload fairing split seam is a fine, dark meridian rather than a painted toy cone. */}
    <Box position={[0, 60.2, 3.154]} size={[0.034, 6.1, 0.013]} material={materials.charcoal}/>
    <Box position={[0, 50.4, 2.508]} size={[0.8, 0.35, 0.02]} material={materials.charcoal}/>
  </group>;
}

function ServiceTower({ materials, timeRef, reducedMotion }) {
  const arms = useRef();
  const beams = useMemo(() => {
    const lines = [];
    const x = -13.5, z = -1.5, w = 6.5;
    for (const dx of [-w / 2, w / 2]) for (const dz of [-w / 2, w / 2]) lines.push([[x + dx, 0, z + dz], [x + dx, 78, z + dz], 0.33]);
    for (let y = 1; y < 77; y += 6) {
      for (const side of [-1, 1]) {
        lines.push([[x - w / 2, y, z + side * w / 2], [x + w / 2, y + 6, z + side * w / 2], 0.15]);
        lines.push([[x + w / 2, y, z + side * w / 2], [x - w / 2, y + 6, z + side * w / 2], 0.15]);
        lines.push([[x + side * w / 2, y, z - w / 2], [x + side * w / 2, y + 6, z + w / 2], 0.15]);
        lines.push([[x + side * w / 2, y, z + w / 2], [x + side * w / 2, y + 6, z - w / 2], 0.15]);
      }
    }
    return lines;
  }, []);
  useFrame(() => { if (arms.current) arms.current.rotation.y = -smooth(((reducedMotion ? 0 : timeRef.current) - 7) / 5) * 1.45; });
  return <group>
    <StaticBatch>
    <Beams lines={beams} material={materials.tower}/>
    {Array.from({ length: 13 }, (_, i) => <group key={i}>
      <Box position={[-13.5, 2 + i * 6, -1.5]} size={[7.1, 0.22, 7.1]} material={materials.charcoal}/>
      <Box position={[-16.4, 2.8 + i * 6, -1.5]} size={[0.09, 1.3, 6.6]} material={materials.yellow}/>
    </group>)}
    <Box position={[-13.5, 40, -3.7]} size={[1.75, 76, 1.3]} material={materials.cream}/>
    <Cylinder position={[-12.4, 39, -3.7]} radius={0.17} height={75} material={materials.silver}/>
    <Cylinder position={[-11.8, 39, -3.7]} radius={0.12} height={75} material={materials.silver}/>
    <Box position={[-13.5, 79, -1.5]} size={[9.5, 1.1, 8]} material={materials.tower}/>
    <Box position={[-9.5, 80.5, -1.5]} size={[15, 1.15, 1.4]} material={materials.yellow}/>
    <Cylinder position={[-1.9, 77.5, -1.5]} radius={0.04} height={4.8} material={materials.charcoal}/>
    <mesh position={[-13.5, 81.1, -1.5]}><sphereGeometry args={[0.25, 12, 8]}/><meshBasicMaterial color="#ff4321"/></mesh>
    </StaticBatch>
    <group ref={arms} position={[-10.2, 0, -1.5]}>
      <StaticBatch>
      {[19, 39, 58, 66].map(y => <group key={y}>
        <Box position={[3.6, y, 0]} size={[7.2, 0.7, 1.65]} material={materials.tower}/>
        <Box position={[3.6, y + 1, -0.75]} size={[7.3, 0.08, 0.08]} material={materials.yellow}/>
        <Box position={[3.6, y + 1, 0.75]} size={[7.3, 0.08, 0.08]} material={materials.yellow}/>
        <Cylinder position={[6.9, y - 0.4, 0]} radius={0.3} height={2.4} material={materials.silver} rotation={[Math.PI / 2, 0, 0]}/>
        <Beams lines={[[[0, y - 3, 0], [6.8, y, 0], 0.19], [[0, y, 0], [6.8, y, 0], 0.15]]} material={materials.charcoal}/>
      </group>)}
      </StaticBatch>
    </group>
  </group>;
}

function LightningTower({ position, materials }) {
  const beams = useMemo(() => {
    const lines = [];
    for (let layer = 0; layer < 12; layer++) {
      const y = layer * 8, r1 = 2.8 - layer * 0.17, r2 = r1 - 0.17;
      for (let corner = 0; corner < 3; corner++) {
        const a = corner / 3 * Math.PI * 2, b = (corner + 1) / 3 * Math.PI * 2;
        lines.push([[Math.cos(a) * r1, y, Math.sin(a) * r1], [Math.cos(a) * r2, y + 8, Math.sin(a) * r2], 0.14]);
        lines.push([[Math.cos(a) * r1, y, Math.sin(a) * r1], [Math.cos(b) * r2, y + 8, Math.sin(b) * r2], 0.07]);
      }
    }
    return lines;
  }, []);
  return <group position={position}><Beams lines={beams} material={materials.steel}/><Cylinder position={[0, 100, 0]} radius={0.12} height={11} material={materials.cream}/></group>;
}

function CoastalTerrain({ material }) {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(970, 1000, 112, 112); g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position'), colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) - 255, z = p.getZ(i) + 90;
      const outer = smooth((Math.max(Math.abs(x) / 1.1, Math.abs(z)) - 72) / 85);
      let y = -0.18 + outer * (0.5 + Math.sin(x * 0.035) * Math.cos(z * 0.041) * 0.65 + Math.sin(x * 0.011 + z * 0.019) * 0.8);
      const shoreline = smooth((x - 182) / 46);
      y = THREE.MathUtils.lerp(y, -2.35, shoreline);
      x += shoreline * (Math.sin(z * 0.012) * 16 + Math.sin(z * 0.037) * 5);
      p.setXYZ(i, x, y, z);
      const patch = 0.91 + Math.sin(x * 0.013 + z * 0.017) * 0.07;
      colors.set([patch, patch - shoreline * 0.08, patch - shoreline * 0.18], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); g.computeVertexNormals(); return g;
  }, []);
  return <mesh geometry={geometry} material={material} receiveShadow/>;
}

function LaunchComplex({ materials, timeRef, reducedMotion }) {
  const sitePipes = useMemo(() => {
    const lines = [];
    for (let i = 0; i < 4; i++) {
      lines.push([[20 + i * 1.2, 1.1, -8], [20 + i * 1.2, 1.1, -80], 0.24 - i * 0.035]);
      lines.push([[20 + i * 1.2, 1.1, -8], [6, 1.1, -8], 0.24 - i * 0.035]);
    }
    return lines;
  }, []);
  return <group>
    <StaticBatch>
    {/* A coastal strip with an ocean horizon, not a finite floating diorama. */}
    <CoastalTerrain material={materials.ground}/>
    <Box position={[-5, 0.02, -7]} size={[132, 0.6, 127]} material={materials.concrete}/>
    <Box position={[0, 0.39, 93]} size={[22, 0.17, 150]} material={materials.asphalt}/>
    <Box position={[-105, 0.2, -26]} size={[205, 0.17, 14]} material={materials.asphalt}/>
    <Box position={[-40, 0.18, -145]} size={[16, 0.14, 180]} material={materials.asphalt}/>
    {Array.from({ length: 14 }, (_, i) => <Box key={i} position={[0, 0.49, 28 + i * 10]} size={[0.18, 0.025, 4.5]} material={materials.cream}/>)}
    <Box position={[0, 2.4, 0]} size={[19, 4.2, 17]} material={materials.concrete}/>
    <Box position={[0, 4.65, 0]} size={[20, 0.7, 18]} material={materials.charcoal}/>
    <Box position={[0, 1.6, 21]} size={[10, 2.2, 30]} material={materials.soot}/>
    <Box position={[-6, 2.3, 21]} size={[1.8, 4, 31]} material={materials.concrete}/>
    <Box position={[6, 2.3, 21]} size={[1.8, 4, 31]} material={materials.concrete}/>
    {[-1, 1].map(side => <group key={side}>
      <Box position={[side * 8.6, 5.5, 0]} size={[1.5, 2.5, 11]} material={materials.charcoal}/>
      <Cylinder position={[side * 7.5, 5.8, -5.8]} radius={0.23} height={5} material={materials.silver} rotation={[0, 0, side * 0.65]}/>
      <Box position={[side * 20.5, 0.5, 0]} size={[1.4, 0.18, 35]} material={materials.charcoal}/>
      {Array.from({ length: 12 }, (_, i) => <Box key={i} position={[side * 20.5, 0.61, -16 + i * 2.8]} size={[1.25, 0.05, 0.12]} material={materials.steel}/>)}
    </group>)}
    <LightningTower position={[-43, 0, -34]} materials={materials}/>
    <LightningTower position={[35, 0, -43]} materials={materials}/>
    <LightningTower position={[-53, 0, 36]} materials={materials}/>
    <Beams lines={sitePipes} material={materials.silver}/>
    {/* Water deluge tower and cryogenic tank farm establish industrial scale. */}
    <group position={[55, 0, -82]}>
      <Cylinder position={[0, 17, 0]} radius={2.4} height={34} material={materials.cream}/>
      <mesh position={[0, 35, 0]} scale={[11, 7, 11]} material={materials.cream} castShadow><sphereGeometry args={[1, 48, 24]}/></mesh>
      <Ring position={[0, 35, 0]} radius={11} thickness={0.2} material={materials.silver}/>
      <Cylinder position={[4.3, 17, 0]} radius={0.33} height={34} material={materials.silver}/>
    </group>
    {[-1, 0, 1].map((n, i) => <group key={n} position={[34 + n * 16, 0.4, -103]}>
      <Cylinder position={[0, 4.7, 0]} radius={5} height={9} material={materials.fairing}/>
      <mesh position={[0, 9.2, 0]} scale={[5, 1.7, 5]} material={materials.silver} castShadow><sphereGeometry args={[1, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2]}/></mesh>
      <Ring position={[0, 0.5, 0]} radius={5.08} thickness={0.18} material={materials.charcoal}/>
      <Cylinder position={[5.15, 4.7, 0]} radius={0.15} height={9} material={materials.silver}/>
    </group>)}
    <group position={[-85, 0, -92]}>
      <Box position={[0, 6.5, 0]} size={[52, 13, 28]} material={materials.cream}/>
      <Box position={[0, 13.2, 0]} size={[54, 0.7, 30]} material={materials.steel}/>
      <Box position={[0, 7.7, 14.15]} size={[47, 2.4, 0.15]} material={materials.glass}/>
      <Box position={[12, 4.2, 14.22]} size={[7.3, 8.3, 0.18]} material={materials.charcoal}/>
      {[-20, -12, -4, 4, 12, 20].map(x => <Box key={x} position={[x, 7.7, 14.3]} size={[0.15, 2.45, 0.1]} material={materials.cream}/>)}
      {[-14, 0, 14].map(x => <group key={x}>
        <Box position={[x, 14.5, 0]} size={[7, 2.7, 5]} material={materials.charcoal}/>
        <Cylinder position={[x, 16, 0]} radius={1.4} height={0.3} material={materials.steel}/>
      </group>)}
    </group>
    <group position={[-180, 0, -240]}>
      <Box position={[0, 28, 0]} size={[76, 56, 95]} material={materials.tower}/>
      <Box position={[0, 57, 0]} size={[78, 2, 97]} material={materials.steel}/>
      <Box position={[0, 25, 47.6]} size={[43, 49, 0.25]} material={materials.charcoal}/>
      {[-18, -12, -6, 0, 6, 12, 18].map(x => <Box key={x} position={[x, 25, 47.8]} size={[0.18, 48, 0.2]} material={materials.steel}/>)}
      {/* Corrugated assembly-hall cladding, pilasters and clerestory glazing.
          At the rising camera angle this used to read as an empty grey quad. */}
      {Array.from({ length: 24 }, (_, i) => <Box key={`rib-${i}`} position={[38.18, 28, -46 + i * 4]} size={[0.18, 55, 0.18]} material={materials.charcoal}/>)}
      {[8, 16, 24, 32, 40, 46].map(y => <Box key={`joint-${y}`} position={[38.22, y, 0]} size={[0.2, 0.13, 94]} material={materials.charcoal}/>)}
      {[-36, -18, 0, 18, 36].map(z => <group key={z}>
        <Box position={[38.7, 28, z]} size={[1.2, 56, 0.65]} material={materials.steel}/>
        <Box position={[38.22, 50.2, z]} size={[0.28, 3.3, 14]} material={materials.glass}/>
        <Box position={[23, 59.5, z]} size={[8, 4, 7]} material={materials.charcoal}/>
      </group>)}
      <Box position={[38.2, 1.7, 0]} size={[0.25, 3.4, 95]} material={materials.charcoal}/>
      <Box position={[39.15, 56.2, 0]} size={[0.7, 0.6, 96]} material={materials.charcoal}/>
      {[-29, 29].map(x => <Box key={x} position={[x, 27.5, 47.7]} size={[0.55, 55, 0.5]} material={materials.steel}/>)}
    </group>
    <group position={[75, 0, -155]}>
      <Box position={[0, 4.8, 0]} size={[34, 9.5, 18]} material={materials.tower}/>
      <Box position={[0, 9.8, 0]} size={[36, 0.6, 20]} material={materials.charcoal}/>
      {[-12, -4, 4, 12].map(x => <group key={x}>
        <Box position={[x, 4, 9.1]} size={[5.5, 7.5, 0.2]} material={materials.charcoal}/>
        <Cylinder position={[x, 12, -3]} radius={0.65} height={4.5} material={materials.steel}/>
      </group>)}
    </group>
    {/* Service cable gantries, pipe supports and generators break up empty hardstand. */}
    {[-75, -59, -43].map(z => <group key={z}>
      <Box position={[22, 1.6, z]} size={[7, 0.3, 1]} material={materials.charcoal}/>
      <Cylinder position={[19.2, 0.9, z]} radius={0.13} height={1.8} material={materials.steel}/>
      <Cylinder position={[25.2, 0.9, z]} radius={0.13} height={1.8} material={materials.steel}/>
    </group>)}
    {[-51, -42, -33].map(x => <group key={x} position={[x, 0.3, -53]}>
      <Box position={[0, 1.8, 0]} size={[6.5, 3.6, 4]} material={materials.cream}/>
      <Box position={[0, 1.8, 2.05]} size={[5.8, 2.6, 0.1]} material={materials.charcoal}/>
      {[-2, -1, 0, 1, 2].map(louver => <Box key={louver} position={[louver, 1.8, 2.13]} size={[0.1, 2.65, 0.1]} material={materials.steel}/>)}
    </group>)}
    {Array.from({ length: 16 }, (_, i) => <group key={i} position={[-67 + i * 9, 0, 61]}>
      <Cylinder position={[0, 1.8, 0]} radius={0.045} height={3.6} material={materials.charcoal} segments={6}/>
      {i < 15 && <Box position={[4.5, 1.8, 0]} size={[9, 0.045, 0.04]} material={materials.steel}/>}
    </group>)}
    {/* Tiny safety vehicles stay recognizable scale cues, not cartoon props. */}
    {[-31, -39, -47].map((x, i) => <group key={x} position={[x, 0.7, 43]}>
      <Box position={[0, 0.65, 0]} size={[2, 1.4, 4.8]} material={i === 0 ? materials.red : materials.fairing}/>
      <Box position={[0, 1.55, -0.3]} size={[1.8, 0.75, 2.3]} material={materials.glass}/>
      {[-1, 1].map(s => [-1.5, 1.5].map(z => <Cylinder key={`${s}-${z}`} position={[s, 0.2, z]} radius={0.45} height={0.22} rotation={[0, 0, Math.PI / 2]} material={materials.soot} segments={16}/>))}
    </group>)}
    </StaticBatch>
    <ServiceTower materials={materials} timeRef={timeRef} reducedMotion={reducedMotion}/>
  </group>;
}

// Soft volumetric-looking billboards use six octaves of CPU-generated density.
// Their irregular silhouette, transparent edge and directional shading avoid hard "smoke balls".
function makeCloudTexture() {
  const size = 256, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(size, size);
  const gridNoise = (x, y, frequency) => {
    const fx = x * frequency, fy = y * frequency, ix = Math.floor(fx), iy = Math.floor(fy);
    const sx = smooth(fx - ix), sy = smooth(fy - iy);
    const a = random(ix + iy * 179), b = random(ix + 1 + iy * 179);
    const c = random(ix + (iy + 1) * 179), d = random(ix + 1 + (iy + 1) * 179);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, sx), THREE.MathUtils.lerp(c, d, sx), sy);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let value = 0, strength = 0.56;
    for (let octave = 0; octave < 6; octave++) { value += gridNoise(u + 3.3, v + 8.1, 4 * 2 ** octave) * strength; strength *= 0.5; }
    const r = Math.hypot((u - 0.5) * 2, (v - 0.5) * 2);
    const edge = Math.pow(clamp((1 - r) * 1.8), 1.6);
    const density = clamp((value - 0.17) * 1.9) * edge;
    const shade = clamp(0.63 + value * 0.52 + (v - 0.5) * 0.12);
    const p = (y * size + x) * 4;
    pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = shade * 255;
    pixels.data[p + 3] = density * 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

const cloudVertex = `
  attribute vec3 particleCenter;
  attribute vec2 particleSize;
  attribute vec4 particleTint;
  attribute float particleRotation;
  varying vec2 vUv;
  varying vec4 vTint;
  void main() {
    vUv = uv; vTint = particleTint;
    vec2 p = position.xy * particleSize;
    float c = cos(particleRotation), s = sin(particleRotation);
    vec2 rotated = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    vec4 center = modelViewMatrix * vec4(particleCenter, 1.0);
    gl_Position = projectionMatrix * vec4(center.xyz + vec3(rotated, 0.0), 1.0);
  }
`;
const cloudFragment = `
  uniform sampler2D densityMap;
  varying vec2 vUv;
  varying vec4 vTint;
  void main() {
    vec4 cloud = texture2D(densityMap, clamp(vUv, vec2(0.0), vec2(1.0)));
    float alpha = clamp(cloud.a * vTint.a, 0.0, 1.0);
    // Negated comparison also rejects NaN, unlike "alpha < threshold".
    // A single non-finite fragment can poison a half-float bloom pyramid.
    if (!(alpha > 0.008)) discard;
    vec3 lit = clamp(vTint.rgb * cloud.rgb, vec3(0.0), vec3(4.0));
    if (!all(lessThan(abs(lit), vec3(100.0)))) discard;
    gl_FragColor = vec4(lit, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function LaunchClouds({ timeRef, reducedMotion, quality }) {
  const { camera } = useThree();
  const count = quality === 'high' ? 360 : 220;
  const setup = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index; geometry.attributes.position = quad.attributes.position; geometry.attributes.uv = quad.attributes.uv;
    const centers = new Float32Array(count * 3), sizes = new Float32Array(count * 2), tints = new Float32Array(count * 4), rotations = new Float32Array(count);
    geometry.setAttribute('particleCenter', new THREE.InstancedBufferAttribute(centers, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('particleSize', new THREE.InstancedBufferAttribute(sizes, 2).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('particleTint', new THREE.InstancedBufferAttribute(tints, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('particleRotation', new THREE.InstancedBufferAttribute(rotations, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.instanceCount = count;
    const densityMap = makeCloudTexture();
    const material = new THREE.ShaderMaterial({ uniforms: { densityMap: { value: densityMap } }, vertexShader: cloudVertex, fragmentShader: cloudFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    return { geometry, material, densityMap, centers, sizes, tints, rotations, particles: Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0, w: 0, h: 0, r: 0, g: 0, b: 0, a: 0, angle: 0, distance: 0 })) };
  }, [count]);
  useEffect(() => () => { setup.geometry.dispose(); setup.material.dispose(); setup.densityMap.dispose(); }, [setup]);
  useFrame(() => {
    const t = reducedMotion ? 0 : renderSeconds(timeRef.current);
    const groundCount = Math.floor(count * 0.64), trailCount = Math.floor(count * 0.26);
    const { particles, centers, sizes, tints, rotations, geometry } = setup;
    for (let i = 0; i < count; i++) {
      const p = particles[i], seed = random(i * 2.31), seed2 = random(i * 3.19 + 77);
      p.a = 0; p.w = p.h = 0; p.x = p.y = p.z = 0;
      if (i < groundCount) {
        const birth = 8 + (i % 48) * 0.19 + Math.floor(i / 48) * 0.09, age = t - birth;
        if (age >= 0 && age < 48) {
          const direction = seed * Math.PI * 2, spread = age * (2.4 + seed2 * 3.8);
          p.x = Math.cos(direction) * spread + age * 0.7;
          p.z = Math.sin(direction) * spread * 0.7 + 7;
          p.y = 1.2 + seed * 3.6 + Math.pow(age, 0.88) * (0.6 + seed2 * 0.8);
          p.w = 7 + age * (2.3 + seed * 0.9); p.h = p.w * (0.76 + seed2 * 0.23);
          const warm = (1 - smooth(age / 6)) * 0.4;
          p.r = 0.79 + seed * 0.14 + warm * 0.3; p.g = 0.78 + seed * 0.13 - warm * 0.13; p.b = 0.73 + seed * 0.13 - warm * 0.32;
          p.a = smooth(age / 0.7) * (1 - smooth((age - 30) / 18)) * 0.72;
        }
      } else if (i < groundCount + trailCount) {
        const id = i - groundCount, age = Math.pow(id / trailCount, 1.6) * 13.5, birth = t - age;
        if (birth >= 11.8) {
          const alt = rocketAltitude(birth);
          p.x = rocketDrift(birth) + Math.sin(seed * Math.PI * 2) * age * 0.7 + age * 0.8;
          p.z = Math.cos(seed * Math.PI * 2) * age * 0.9;
          // The white condensation trail begins AFTER the hot combustion zone.
          // Overlaying steam on the nozzle made the real plume look like grey rods.
          p.y = 5 + alt - 38 - age * 5;
          p.w = 4.5 + age * 3.4; p.h = p.w * 1.18;
          p.r = 0.95; p.g = 0.91; p.b = 0.83;
          p.a = clamp((p.y + 3) / 10) * smooth(age / 0.6) * (1 - age / 17) * 0.58;
        }
      } else {
        const id = i - groundCount - trailCount, age = (t * 0.7 + id * 0.131) % 4.8;
        const sourceY = id % 2 ? 42 : 18;
        p.x = 2.7 + age * (1.6 + seed); p.y = sourceY - age * 0.5; p.z = 1 + Math.sin(id) * 0.8;
        p.w = 1.8 + age * 2.3; p.h = p.w * 0.7;
        p.r = 0.85; p.g = 0.89; p.b = 0.9;
        p.a = Math.sin(age / 4.8 * Math.PI) * 0.28 * (1 - smooth((t - 8) / 3));
      }
      p.angle = seed * Math.PI * 2 + t * (seed2 - 0.5) * 0.07;
      p.distance = (p.x - camera.position.x) ** 2 + (p.y - camera.position.y) ** 2 + (p.z - camera.position.z) ** 2;
    }
    // Transparent layers are sorted back-to-front, including when the camera is freely orbited.
    const ordered = particles.slice().sort((a, b) => b.distance - a.distance);
    for (let i = 0; i < count; i++) {
      const p = ordered[i]; centers.set([p.x, p.y, p.z], i * 3); sizes.set([p.w, p.h], i * 2);
      tints.set([clamp(p.r, 0, 4), clamp(p.g, 0, 4), clamp(p.b, 0, 4), clamp(p.a)], i * 4); rotations[i] = p.angle;
    }
    Object.values(geometry.attributes).forEach(a => { if (a.isInstancedBufferAttribute) a.needsUpdate = true; });
  });
  return <mesh geometry={setup.geometry} material={setup.material} frustumCulled={false} renderOrder={5}/>;
}

const flameFragment = `
  uniform float time;
  uniform float power;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
  }
  void main() {
    vec2 safeUV = clamp(vUv, vec2(0.0), vec2(1.0));
    float down = clamp(1.0-safeUV.y, 0.0, 1.0);
    float flow = clamp(noise(vec2(safeUV.x * 11.0, down * 9.0 - time * 8.0)), 0.0, 1.0);
    float fine = clamp(noise(vec2(safeUV.x * 25.0 + 6.0, down * 34.0 - time * 17.0)), 0.0, 1.0);
    float center = (safeUV.x - 0.5) + (flow-0.5) * down * 0.17;
    float width = 0.10 + down * 0.22 + flow * 0.04;
    float widthSquared = max(width*width, 0.0001);
    float core = exp(-center*center / (widthSquared * 0.2));
    // Raster interpolation may overshoot the edge by an ulp. Never feed a
    // negative base to fractional pow, nor reversed edges to smoothstep.
    float envelope = exp(-center*center / widthSquared) * pow(max(1.0-down, 0.0), 0.45);
    float tip = 1.0 - smoothstep(0.56 + fine * 0.4, 1.0, down);
    float diamond = pow(max(0.0, sin(down * 77.0 - time * 2.0)), 7.0) * (1.0-down) * 0.5;
    vec3 orange = vec3(2.4, 0.28 + flow*0.22, 0.025);
    vec3 white = vec3(5.5, 4.5, 2.8);
    vec3 color = mix(orange, white, clamp(core * (1.0-down*0.65) + diamond, 0.0, 1.0));
    float alpha = clamp(envelope * tip * (0.7 + fine*0.3) * clamp(power, 0.0, 1.0) * 1.45, 0.0, 0.98);
    if (!(alpha > 0.008) || !all(lessThan(abs(color), vec3(100.0)))) discard;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
function EnginePlumes({ timeRef, reducedMotion }) {
  const refs = useRef([]), light = useRef();
  const materials = useMemo(() => Array.from({ length: 3 }, () => new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, power: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    // Normal alpha compositing preserves hot orange edges against a daylight sky;
    // additive-only blending saturated the already bright background into grey/white.
    // HDR emissive values still feed bloom in the high-quality pipeline.
    fragmentShader: flameFragment, transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.DoubleSide, toneMapped: false,
  })), []);
  useEffect(() => () => materials.forEach(m => m.dispose()), [materials]);
  useFrame(({ camera }) => {
    const t = reducedMotion ? 0 : renderSeconds(timeRef.current), power = smooth((t - 8) / 3.2);
    const alt = rocketAltitude(t);
    refs.current.forEach((plane, i) => {
      if (!plane) return;
      const localX = (i - 1) * 4.7, lean = rocketLean(t), drift = rocketDrift(t);
      const x = drift + localX * Math.cos(lean), length = (i === 1 ? 39 : 27) * power * (0.92 + 0.08 * Math.sin(t * 47 + i));
      plane.visible = power > 0.001;
      plane.position.set(x + Math.sin(lean) * length / 2, 6 + alt + localX * Math.sin(lean) - Math.cos(lean) * length / 2, 0);
      plane.rotation.set(0, Math.atan2(camera.position.x - x, camera.position.z), lean);
      plane.scale.set(i === 1 ? 13 : 9, length, 1);
      materials[i].uniforms.time.value = t + i * 0.41;
      materials[i].uniforms.power.value = power;
    });
    if (light.current) { light.current.position.y = 7 + Math.min(alt, 100); light.current.intensity = power * (2900 + Math.sin(t * 39) * 200); }
  });
  return <group>
    {[0, 1, 2].map(i => <mesh key={i} ref={r => { refs.current[i] = r; }} material={materials[i]} frustumCulled={false} renderOrder={6}><planeGeometry args={[1, 1]}/></mesh>)}
    <pointLight ref={light} position={[0, 7, 0]} color="#ff9b35" intensity={0} distance={160} decay={2}/>
  </group>;
}

export default function RocketExperience({ timeRef = ZERO_TIME, reducedMotion = false, quality = 'high', cameraMode = 'director' }) {
  const rocket = useRef(), materials = useMaterials();
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const t = reducedMotion ? 0 : renderSeconds(timeRef.current), altitude = rocketAltitude(t);
    if (rocket.current) {
      rocket.current.position.y = 6 + altitude;
      rocket.current.position.x = rocketDrift(t);
      rocket.current.rotation.z = rocketLean(t);
    }
    if (cameraMode === 'free') return;
    const mobile = camera.aspect < 0.8;
    const approach = smooth(t / 9), follow = smooth((t - 15) / 12);
    // Low camera, restrained dolly, then smooth climbing track. No surprise cuts.
    const distance = 1 + follow * 0.12;
    camera.position.set((mobile ? 85 : 78) * distance - approach * 7, 27 + altitude * (0.65 + follow * 0.34), (mobile ? 135 : 115) * distance - approach * 6);
    target.set(-3 + (rocket.current?.position.x ?? 0), 33 + altitude, 0);
    camera.fov = mobile ? 46 : 43;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
  });
  return <group>
    <Ocean timeRef={timeRef} reducedMotion={reducedMotion} size={5000} y={-2.4}/>
    <LaunchComplex materials={materials} timeRef={timeRef} reducedMotion={reducedMotion}/>
    <group ref={rocket} position={[0, 6, 0]}><StaticBatch><RocketBody materials={materials}/></StaticBatch></group>
    <LaunchClouds timeRef={timeRef} reducedMotion={reducedMotion} quality={quality}/>
    <EnginePlumes timeRef={timeRef} reducedMotion={reducedMotion}/>
  </group>;
}

// The town version shares the room's millisecond show clock and collision map.
// It intentionally does not mount the cinema's ocean, lights, camera or landmass.
function useTownRocketMaterials() {
  const resources = useMemo(() => {
    const shellMap = makeSurfaceTexture('shell'), concreteMap = makeSurfaceTexture('concrete');
    const material = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    const materials = {
      shell: new THREE.MeshStandardMaterial({ color: '#f0f1ec', map: shellMap, bumpMap: shellMap, bumpScale: 0.006, roughness: 0.44, metalness: 0.28 }),
      fairing: material('#dddeda', 0.37, 0.24), soot: material('#1d2326', 0.69, 0.42), charcoal: material('#343b3d', 0.63, 0.61),
      steel: material('#87918f', 0.44, 0.74), silver: material('#c9ceca', 0.32, 0.8), tower: material('#b9beb4', 0.65, 0.57),
      cream: material('#cecfb9', 0.8, 0.2), yellow: material('#e2ac35', 0.7, 0.24), red: material('#a84431', 0.61, 0.28),
      concrete: new THREE.MeshStandardMaterial({ color: '#aeb3aa', map: concreteMap, roughness: 0.96 }),
    };
    concreteMap.repeat.set(2, 2);
    return { materials, shellMap, concreteMap };
  }, []);
  useEffect(() => () => {
    Object.values(resources.materials).forEach(m => m.dispose()); resources.shellMap.dispose(); resources.concreteMap.dispose();
  }, [resources]);
  return resources.materials;
}

function TownGantry({ materials, timeRef, reducedMotion }) {
  const arms = useRef();
  const lines = useMemo(() => {
    const result = [];
    for (const x of [-1.2, 1.2]) for (const z of [-2.65, 2.65]) result.push([[x, 0.12, z], [x, 13.85, z], 0.085]);
    for (let level = 0; level < 8; level++) {
      const y = 0.15 + level * 1.7, next = Math.min(13.85, y + 1.7);
      for (const side of [-1, 1]) {
        result.push([[-1.2, y, side * 2.65], [1.2, next, side * 2.65], 0.038]);
        result.push([[1.2, y, side * 2.65], [-1.2, next, side * 2.65], 0.038]);
        result.push([[side * 1.2, y, -2.65], [side * 1.2, next, 2.65], 0.038]);
        result.push([[side * 1.2, y, 2.65], [side * 1.2, next, -2.65], 0.038]);
      }
    }
    return result;
  }, []);
  useFrame(() => {
    if (!arms.current) return;
    const state = sampleWonder('rocket', timeRef?.current ?? 0);
    arms.current.rotation.y = reducedMotion || !state.active ? 0 : smooth((state.seconds - 8) / 4) * 1.2;
  });
  return <group>
    {/* World bounds after the outer z=-61 anchor: x4.2..7, z-66..-60. */}
    <group position={[5.6, 0, -2]}>
      <StaticBatch>
        <Beams lines={lines} material={materials.tower}/>
        {[0.15, 1.85, 3.55, 5.25, 6.95, 8.65, 10.35, 12.05, 13.85].map((y, i) => <group key={y}>
          <Box position={[0, y, 0]} size={[2.62, 0.07, 5.7]} material={materials.charcoal}/>
          <Box position={[1.27, y + 0.21, 0]} size={[0.025, 0.035, 5.64]} material={materials.yellow}/>
          {i < 8 && <Box position={[0.83, y + 0.85, -2.48]} size={[0.46, 1.65, 0.12]} material={materials.silver} rotation={[0, 0, 0.13]}/>}
        </group>)}
        <Box position={[0.74, 7, 2.13]} size={[0.58, 13.75, 0.72]} material={materials.cream}/>
        <Cylinder position={[0.33, 6.9, 2.53]} radius={0.055} height={13.7} material={materials.silver} segments={12}/>
        <Cylinder position={[0.09, 6.9, 2.53]} radius={0.035} height={13.7} material={materials.silver} segments={12}/>
        <Box position={[0, 13.98, 0]} size={[2.8, 0.12, 6]} material={materials.tower}/>
      </StaticBatch>
    </group>
    <group ref={arms} position={[4.22, 0, -1.2]}>
      <StaticBatch>
        {[3.8, 7.9, 11.7].map(y => <group key={y}>
          <Box position={[-1.65, y, 0]} size={[3.3, 0.15, 0.57]} material={materials.tower}/>
          <Box position={[-1.65, y + 0.25, -0.27]} size={[3.32, 0.025, 0.025]} material={materials.yellow}/>
          <Box position={[-1.65, y + 0.25, 0.27]} size={[3.32, 0.025, 0.025]} material={materials.yellow}/>
          <Beams lines={[[[0, y - 0.75, 0], [-3.1, y, 0], 0.045]]} material={materials.charcoal}/>
          <Cylinder position={[-3.16, y - 0.08, 0]} radius={0.075} height={0.7} material={materials.silver} rotation={[Math.PI / 2, 0, 0]} segments={12}/>
        </group>)}
      </StaticBatch>
    </group>
  </group>;
}

const townCloudVertex = `
  attribute vec3 particleCenter;
  attribute vec2 particleSize;
  attribute vec4 particleTint;
  attribute float particleRotation;
  varying vec2 vUv;
  varying vec4 vTint;
  void main() {
    vUv = uv; vTint = particleTint;
    // Centers are local to the translated town spaceport. Billboard dimensions
    // inherit any outer group scaling before being aligned in camera space.
    vec2 worldScale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
    vec2 p = position.xy * particleSize * worldScale;
    float c = cos(particleRotation), s = sin(particleRotation);
    vec2 rotated = vec2(c*p.x-s*p.y, s*p.x+c*p.y);
    vec4 center = modelViewMatrix * vec4(particleCenter, 1.0);
    gl_Position = projectionMatrix * vec4(center.xyz + vec3(rotated, 0.0), 1.0);
  }
`;

function TownLaunchEffects({ timeRef, reducedMotion, active }) {
  const group = useRef(), smoke = useRef();
  const cameraLocal = useMemo(() => new THREE.Vector3(), []);
  const count = 80, groundCount = 56;
  const resources = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1), geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index; geometry.attributes.position = quad.attributes.position; geometry.attributes.uv = quad.attributes.uv;
    const centers = new Float32Array(count * 3), sizes = new Float32Array(count * 2), tints = new Float32Array(count * 4), rotations = new Float32Array(count);
    geometry.setAttribute('particleCenter', new THREE.InstancedBufferAttribute(centers, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('particleSize', new THREE.InstancedBufferAttribute(sizes, 2).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('particleTint', new THREE.InstancedBufferAttribute(tints, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('particleRotation', new THREE.InstancedBufferAttribute(rotations, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.instanceCount = count;
    const densityMap = makeCloudTexture();
    const smokeMaterial = new THREE.ShaderMaterial({ uniforms: { densityMap: { value: densityMap } }, vertexShader: townCloudVertex, fragmentShader: cloudFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const particles = Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0, size: 0, a: 0, angle: 0, depth: 0 }));
    return { geometry, centers, sizes, tints, rotations, densityMap, smokeMaterial, particles };
  }, []);
  useEffect(() => () => {
    resources.geometry.dispose(); resources.densityMap.dispose(); resources.smokeMaterial.dispose();
  }, [resources]);
  useFrame(({ camera }) => {
    if (!group.current) return;
    const ms = Number.isFinite(timeRef?.current) ? timeRef.current : 0;
    const pose = sampleRocket(ms, reducedMotion), state = sampleWonder('rocket', ms);
    const visible = Boolean(active && pose.flame && pose.visible);
    group.current.visible = visible;
    if (!visible) return; // Distant wonders keep the solid silhouette, not particle CPU/GPU cost.
    group.current.updateWorldMatrix(true, false);
    camera.getWorldPosition(cameraLocal); group.current.worldToLocal(cameraLocal);
    const t = state.seconds;
    const { particles, centers, sizes, tints, rotations, geometry } = resources;
    for (let i = 0; i < count; i++) {
      const p = particles[i], seed = random(i * 2.31), seed2 = random(i * 3.19 + 77);
      p.x = p.y = p.z = p.size = p.a = 0;
      if (i < groundCount) {
        const age = t - (10 + (i % 20) * 0.13 + Math.floor(i / 20) * 0.08);
        if (age >= 0 && age < 28) {
          const angle = seed * Math.PI * 2, spread = 8 * (1 - Math.exp(-age * (0.09 + seed2 * 0.04)));
          p.x = Math.cos(angle) * spread + age * 0.03; p.z = Math.sin(angle) * spread * 0.8;
          p.y = 0.3 + age * (0.1 + seed * 0.07);
          p.size = 1.1 + Math.min(age, 12) * (0.25 + seed2 * 0.1);
          p.a = smooth(age / 0.5) * (1 - smooth(age / 28)) * pose.smoke * 0.55;
        }
      } else {
        const age = Math.pow((i - groundCount) / (count - groundCount), 1.6) * 5.5;
        const historical = sampleRocket(ms - age * 1000, false);
        if (historical.flame) {
          p.x = Math.sin(seed * Math.PI * 2) * age * 0.15 + age * 0.12;
          p.z = Math.cos(seed * Math.PI * 2) * age * 0.2;
          // The hot exhaust stays unobscured for its full 12.2 m before steam
          // expands into the wake. This is the same absolute launch history.
          p.y = 0.85 + historical.height - 12.2 - age * 1.5;
          p.size = 0.7 + age * 0.6;
          p.a = clamp(p.y / 2) * smooth(age / 0.4) * (1 - age / 7) * 0.48;
        }
      }
      p.angle = seed * Math.PI * 2 + t * (seed2 - 0.5) * 0.07;
      p.depth = (p.x-cameraLocal.x)**2 + (p.y-cameraLocal.y)**2 + (p.z-cameraLocal.z)**2;
    }
    const ordered = particles.slice().sort((a, b) => b.depth - a.depth);
    ordered.forEach((p, i) => {
      centers.set([p.x, p.y, p.z], i * 3); sizes.set([p.size, p.size * 0.84], i * 2);
      tints.set([0.93, 0.88, 0.78, clamp(p.a)], i * 4); rotations[i] = p.angle;
    });
    for (const a of Object.values(geometry.attributes)) if (a.isInstancedBufferAttribute) a.needsUpdate = true;
  });
  return <group ref={group} visible={false}>
    <mesh ref={smoke} geometry={resources.geometry} material={resources.smokeMaterial} frustumCulled={false} renderOrder={5}/>
  </group>;
}

// Keep the inexpensive hot jets visible even when the launch island is distant.
// Only the more expensive steam billboards above are gated by player proximity.
export function TownRocketPlumes({ timeRef, reducedMotion = false }) {
  const group = useRef(), light = useRef();
  const resources = useMemo(createTownRocketPlumeResources, []);
  useEffect(() => () => resources.dispose(), [resources]);
  useFrame(() => {
    const sample = sampleTownRocketPlumes(timeRef?.current ?? 0, reducedMotion);
    if (group.current) group.current.visible = sample.visible;
    if (light.current) {
      light.current.intensity = sample.visible ? sample.light : 0;
      light.current.position.y = .8 + sample.height;
    }
    if (sample.visible) writeTownRocketPlumeFrame(resources, sample);
  });
  return <group ref={group} name="town-rocket-hot-plumes" visible={false}>
    {resources.materials.map((material, i) => <mesh key={i} name={i === 0 ? 'rocket-plume-white-core' : 'rocket-plume-turbulent-sheath'} geometry={resources.geometry} material={material} frustumCulled={false} renderOrder={6+i} dispose={null}/>)}
    <pointLight ref={light} position={[0, .8, 0]} color="#ff9b42" intensity={0} distance={24} decay={2}/>
  </group>;
}

/** Mount once in the existing Town Canvas. timeRef.current is shared-room milliseconds. */
export function TownRocket({ timeRef = ZERO_TIME, reducedMotion = false, active = true }) {
  const rocket = useRef(), materials = useTownRocketMaterials();
  useFrame(() => {
    if (!rocket.current) return;
    const pose = sampleRocket(timeRef?.current ?? 0, reducedMotion);
    rocket.current.position.y = 0.85 + pose.height;
    rocket.current.visible = pose.visible;
  });
  return <group name="town-rocket-detail" position={[0, 0, -61]}>
    <StaticBatch>
      <Cylinder position={[0, 0.19, 0]} radius={3.5} height={0.38} material={materials.concrete}/>
      <Cylinder position={[0, 0.42, 0]} radius={2.9} height={0.09} material={materials.charcoal}/>
      <Ring position={[0, 0.48, 0]} radius={3.3} thickness={0.045} material={materials.yellow}/>
      {[-1, 1].map(side => <group key={side}>
        <Box position={[side * 1.68, 0.64, 0]} size={[0.25, 0.42, 2.3]} material={materials.charcoal}/>
        <Cylinder position={[side * 2.45, 0.58, -1.5]} radius={0.055} height={1.1} material={materials.silver} rotation={[0, 0, side * 0.55]} segments={12}/>
      </group>)}
      <Beams lines={[[[3.4, 0.25, -2], [4.8, 0.25, -2], 0.055], [[3.3, 0.25, -2.3], [5, 0.25, -2.3], 0.04]]} material={materials.silver}/>
    </StaticBatch>
    <TownGantry materials={materials} timeRef={timeRef} reducedMotion={reducedMotion}/>
    <group ref={rocket} position={[0, 0.85, 0]} scale={0.2}><StaticBatch><RocketBody materials={materials}/></StaticBatch></group>
    <TownLaunchEffects timeRef={timeRef} reducedMotion={reducedMotion} active={active}/>
    <TownRocketPlumes timeRef={timeRef} reducedMotion={reducedMotion}/>
  </group>;
}
