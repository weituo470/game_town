import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import GptBrandEmblem from '../gpt/GptBrandEmblem.jsx';
import { GPT_PEDESTAL, GPT_PAVILIONS, GPT_PILLARS } from '../../../shared/gpt-park.js';
import { GPT_GROUND_LAYERS, GPT_BRIDGE_SURFACE, GPT_GARDEN_BEDS } from './gptParkSurfaces.js';

const C = Object.freeze({
  stone: '#e3eee5', silver: '#d9f2e7', mint: '#67f1bd', emerald: '#0b6651',
  dark: '#073c33', water: '#07342d', trim: '#a8c8b5', gold: '#e9d7a4',
});
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

function Block({ at, size, color = C.stone, metalness = 0.12, roughness = 0.6, ...rest }) {
  return <mesh position={at} {...rest}><boxGeometry args={size}/><meshStandardMaterial color={color} metalness={metalness} roughness={roughness}/></mesh>;
}
function Cylinder({ at, radius, top = radius, height, color = C.stone, sides = 48, ...rest }) {
  return <mesh position={at} {...rest}><cylinderGeometry args={[top, radius, height, sides]}/><meshStandardMaterial color={color} metalness={0.22} roughness={0.42}/></mesh>;
}
function GlowRing({ at = [0, 0, 0], radius, width = 0.045, color = C.mint, rotation = [-Math.PI / 2, 0, 0], opacity = 1 }) {
  return <mesh position={at} rotation={rotation}><torusGeometry args={[radius, width, 6, 80]}/><meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} toneMapped={false}/></mesh>;
}
function Beam({ from, to, width = 0.08, color = C.silver, glow = false }) {
  const [position, quaternion, length] = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), d = b.clone().sub(a);
    return [a.add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), d.length()];
  // The input coordinates are small immutable construction data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.join(','), to.join(',')]);
  return <mesh position={position} quaternion={quaternion}>
    <cylinderGeometry args={[width, width, length, 8]}/>
    {glow ? <meshBasicMaterial color={color} toneMapped={false}/> : <meshStandardMaterial color={color} metalness={0.4} roughness={0.35}/>}
  </mesh>;
}

/** Text is local CanvasTexture, with no Google/font-file network request. */
function Sign({ text, at, width = 5.4, height = 1.5, color = '#e8fff4', background = '#093e33', rotation = [0, 0, 0] }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1536; canvas.height = 384;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#6ad8af'; ctx.lineWidth = 5; ctx.strokeRect(8, 8, 1520, 368);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${text.length > 5 ? 168 : 225}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.fillText(text, 768, 202);
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.anisotropy = 4;
    return result;
  }, [text, color, background]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh position={at} rotation={rotation}><planeGeometry args={[width, height]}/><meshBasicMaterial map={texture} toneMapped={false}/></mesh>;
}

/** Official white Blossom on a neutral black medallion, with independent orbit architecture. */
function InspirationKnot({ timeRef, reducedMotion }) {
  const sculpture = useRef(), orbit = useRef();
  useFrame(({ clock }) => {
    const t = (timeRef?.current ?? clock.elapsedTime * 1000) / 1000;
    if (sculpture.current) {
      sculpture.current.position.y = 6.45 + (reducedMotion ? 0 : Math.sin(t * 0.55) * 0.12);
      // Preserve the six-petal silhouette toward the hero camera; do not rotate it edge-on.
      sculpture.current.rotation.y = reducedMotion ? 0.55 : 0.55 + Math.sin(t * 0.12) * 0.15;
      sculpture.current.rotation.z = reducedMotion ? 0.03 : 0.03 + Math.sin(t * 0.15) * 0.04;
    }
    if (orbit.current) orbit.current.rotation.y = reducedMotion ? 0.4 : t * 0.12;
  });
  return <group>
    <group ref={sculpture} position={[0, 6.45, 0]} scale={1.2} rotation={[0, 0.55, 0.03]}>
      <GptBrandEmblem size={6.15}/>
    </group>
    <group ref={orbit} position={[0, 5.6, 0]}>
      <GlowRing radius={5.05} width={0.035} rotation={[Math.PI / 2.9, 0.2, -0.25]} color="#b9f8d7" opacity={0.65}/>
      <mesh position={[4.85, 1.1, 0]}><sphereGeometry args={[0.13, 10, 8]}/><meshBasicMaterial color="#eafff4" toneMapped={false}/></mesh>
    </group>
    <Cylinder at={[0, 0.35, 0]} radius={4.27} height={0.7} color={C.dark}/>
    <mesh position={[0, 0.715, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[4.1, 96]}/><meshStandardMaterial color={C.water} metalness={0.7} roughness={0.14} emissive="#064032" emissiveIntensity={0.12}/></mesh>
    <GlowRing at={[0, 0.74, 0]} radius={4.15} width={0.065}/>
    {[1.2, 2, 2.9].map((r, i) => <GlowRing key={r} at={[0, 0.735, 0]} radius={r} width={0.016} opacity={0.2 + i * 0.08}/>)}
    <Cylinder at={[0, 1.0, 0]} radius={0.95} top={0.6} height={0.6} color={C.silver}/>
    <mesh position={[0, 2.2, 0]}><coneGeometry args={[0.22, 2.1, 6]}/><meshBasicMaterial color="#5ed8aa" transparent opacity={0.38} depthWrite={false}/></mesh>
  </group>;
}

function CreatePavilion() {
  return <group>
    {Array.from({ length: 6 }, (_, i) => <group key={i} rotation={[0, i * TAU / 6, 0]}>
      <mesh position={[0, 2.1, 0.65]} rotation={[-0.55, 0, 0]} scale={[0.73, 1.9, 0.48]}>
        <sphereGeometry args={[1, 16, 12, 0, TAU, 0, Math.PI / 1.65]}/>
        <meshStandardMaterial color={i % 2 ? C.silver : '#96cbb7'} metalness={0.36} roughness={0.3} side={THREE.DoubleSide}/>
      </mesh>
    </group>)}
    <mesh position={[0, 3.2, 0]} rotation={[0, Math.PI / 4, 0]}><octahedronGeometry args={[0.73]}/><meshStandardMaterial color={C.mint} emissive={C.emerald} emissiveIntensity={0.6} metalness={0.2} roughness={0.2}/></mesh>
    <GlowRing at={[0, 1.0, 0]} radius={1.45} width={0.045}/>
  </group>;
}

function CodePavilion() {
  return <group>
    {/* A substantial silver portal, not a scaffold: luminous brackets frame a solid floating voxel. */}
    {[-1, 1].map(side => <group key={side}>
      <Block at={[side * 1.35, 2.55, 0]} size={[0.48, 4.1, 0.9]} color={C.silver} metalness={0.38} roughness={0.3}/>
      <Block at={[side * 1.08, 2.6, 0.27]} size={[0.075, 3.65, 0.18]} color={C.emerald}/>
      <Beam from={[side * 0.48, 3.38, 0.7]} to={[side * 0.95, 2.88, 0.7]} width={0.105} color={C.mint} glow/>
      <Beam from={[side * 0.95, 2.88, 0.7]} to={[side * 0.48, 2.38, 0.7]} width={0.105} color={C.mint} glow/>
    </group>)}
    <Block at={[0, 4.58, 0]} size={[3.18, 0.54, 0.9]} color={C.silver} metalness={0.38} roughness={0.3}/>
    <Block at={[0, 4.93, 0]} size={[3.38, 0.12, 1.06]} color={C.emerald}/>
    <Block at={[0, 0.73, 0]} size={[3.18, 0.36, 0.9]} color={C.silver} metalness={0.38}/>
    <Block at={[0, 2.87, 0]} size={[0.66, 0.66, 0.66]} color="#75e3b1" metalness={0.4} roughness={0.2} rotation={[0.45, 0.65, 0.25]}/>
    <GlowRing at={[0, 1.38, 0]} radius={0.7} width={0.028}/>
  </group>;
}

/** Small upward converging light seeds connect the mirror pool to the suspended sculpture. */
function InspirationStream({ timeRef, reducedMotion }) {
  const points = useRef();
  const count = 55;
  const positions = useMemo(() => new Float32Array(count * 3), []);
  useFrame(({ clock }) => {
    const t = reducedMotion ? 0 : (timeRef?.current ?? clock.elapsedTime * 1000) / 1000;
    for (let i = 0; i < count; i++) {
      const life = (i / count + t * 0.115) % 1;
      const angle = i * 2.39996 + t * 0.18;
      const radius = 2.9 * (1 - life) + 0.18;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.9 + life * 5.0;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    if (points.current) points.current.geometry.attributes.position.needsUpdate = true;
  });
  return <points ref={points} frustumCulled={false}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]}/></bufferGeometry>
    <pointsMaterial color="#b6ffdc" size={0.095} transparent opacity={0.8} depthWrite={false} toneMapped={false} sizeAttenuation/>
  </points>;
}

function VoicePavilion({ timeRef, reducedMotion }) {
  const wave = useRef();
  useFrame(({ clock }) => {
    const t = (timeRef?.current ?? clock.elapsedTime * 1000) / 1000;
    if (wave.current && !reducedMotion) wave.current.rotation.y = Math.sin(t * 0.3) * 0.13;
  });
  return <group ref={wave}>
    {[2.6, 3.6, 4.7, 5.65, 4.7, 3.6, 2.6].map((height, i) => <group key={i} position={[(i - 3) * 0.5, 0, Math.abs(i - 3) * 0.2 - 0.5]}>
      <Cylinder at={[0, height / 2 + 0.5, 0]} radius={0.16} top={0.11} height={height} color={i % 2 ? C.silver : '#78b9a0'} sides={12}/>
      <mesh position={[0, height + 0.55, 0]}><sphereGeometry args={[0.19, 12, 8]}/><meshBasicMaterial color={C.mint} toneMapped={false}/></mesh>
      <Beam from={[0, 0.7, 0.18]} to={[0, height + 0.4, 0.12]} width={0.023} color="#bafddd" glow/>
    </group>)}
    {[1.4, 1.8].map(r => <GlowRing key={r} at={[0, 0.55, 0]} radius={r} width={0.04}/>)}
  </group>;
}

function ExplorePavilion({ timeRef, reducedMotion }) {
  const orbits = useRef();
  useFrame(({ clock }) => {
    if (orbits.current) orbits.current.rotation.y = reducedMotion ? 0 : (timeRef?.current ?? clock.elapsedTime * 1000) / 9000;
  });
  return <group>
    {[-1, 1].map(x => [-1, 1].map(z => <Beam key={`${x}:${z}`} from={[x * 1.3, 0.5, z * 1.3]} to={[x * 0.6, 2.8, z * 0.6]} width={0.12}/>))}
    <Cylinder at={[0, 2.2, 0]} radius={1.6} top={1.25} height={0.24} color={C.silver}/>
    <mesh position={[0, 3.45, 0]}><icosahedronGeometry args={[1.0, 2]}/><meshStandardMaterial color="#97f7cb" metalness={0.32} roughness={0.2} emissive="#0b7a50" emissiveIntensity={0.25}/></mesh>
    <group ref={orbits} position={[0, 3.45, 0]}>
      <GlowRing radius={1.6} width={0.05} rotation={[Math.PI / 2.8, 0.3, 0.3]} color={C.silver}/>
      <GlowRing radius={1.78} width={0.04} rotation={[0.5, Math.PI / 3, -0.35]} color={C.mint}/>
      <mesh position={[1.6, 0, 0]}><sphereGeometry args={[0.16, 12, 8]}/><meshBasicMaterial color="#effff7"/></mesh>
    </group>
  </group>;
}

function Pavilion({ pavilion, timeRef, reducedMotion, onSelect }) {
  return <group position={[pavilion.x, 0, pavilion.z]} onClick={onSelect ? e => { e.stopPropagation(); onSelect(pavilion.id); } : undefined}>
    <Cylinder at={[0, 0.2, 0]} radius={pavilion.radius} height={0.4} color={C.dark}/>
    <Cylinder at={[0, 0.43, 0]} radius={pavilion.radius - 0.12} height={0.12} color={C.stone}/>
    <GlowRing at={[0, 0.53, 0]} radius={pavilion.radius - 0.22} width={0.035}/>
    {pavilion.id === 'create' && <CreatePavilion/>}
    {pavilion.id === 'code' && <CodePavilion/>}
    {pavilion.id === 'voice' && <VoicePavilion timeRef={timeRef} reducedMotion={reducedMotion}/>}
    {pavilion.id === 'explore' && <ExplorePavilion timeRef={timeRef} reducedMotion={reducedMotion}/>}
    <Sign text={pavilion.name} at={[0, 0.98, 2.12]} width={2.9} height={0.73}/>
  </group>;
}

/** Instanced landscaping stays at four draw calls even when viewed as a complete park. */
function GardenTrees() {
  const trunks = useRef(), crowns = useRef(), crownsTop = useRef(), planters = useRef();
  const trees = useMemo(() => {
    const placements = [];
    [-1, 1].forEach(side => {
      [-68.9, -62.4, -57.6, -48.4].forEach((z, i) => placements.push({ x: 38 + side * 14.1, z, s: 0.85 + i % 2 * 0.16 }));
      [-10, -5.8, 0, 5.8, 10].forEach((x, i) => placements.push({ x: 38 + x, z: -70.2, s: 0.8 + i % 3 * 0.1 }));
    });
    return placements.filter((tree, i, all) => all.findIndex(t => t.x === tree.x && t.z === tree.z) === i);
  }, []);
  useEffect(() => {
    const dummy = new THREE.Object3D();
    trees.forEach(({ x, z, s }, i) => {
      const set = (ref, y, scale) => { dummy.position.set(x, y, z); dummy.scale.set(...scale); dummy.rotation.set(0, i * 1.4, 0); dummy.updateMatrix(); ref.current.setMatrixAt(i, dummy.matrix); };
      set(trunks, 1.0 * s, [0.12 * s, 1.9 * s, 0.12 * s]);
      set(crowns, 2.1 * s, [0.9 * s, 1.2 * s, 0.9 * s]);
      set(crownsTop, 2.85 * s, [0.65 * s, 0.9 * s, 0.65 * s]);
      set(planters, 0.14, [1.1, 0.28, 1.1]);
    });
    [trunks, crowns, crownsTop, planters].forEach(ref => { ref.current.instanceMatrix.needsUpdate = true; ref.current.computeBoundingSphere(); });
  }, [trees]);
  return <group>
    <instancedMesh ref={trunks} args={[null, null, trees.length]}><cylinderGeometry args={[1, 1.3, 1, 7]}/><meshStandardMaterial color="#6d8173" roughness={0.85}/></instancedMesh>
    <instancedMesh ref={crowns} args={[null, null, trees.length]}><icosahedronGeometry args={[1, 1]}/><meshStandardMaterial color="#28684e" roughness={0.9}/></instancedMesh>
    <instancedMesh ref={crownsTop} args={[null, null, trees.length]}><icosahedronGeometry args={[1, 0]}/><meshStandardMaterial color="#498762" roughness={0.9}/></instancedMesh>
    <instancedMesh ref={planters} args={[null, null, trees.length]}><cylinderGeometry args={[1, 1, 1, 16]}/><meshStandardMaterial color="#9fbaa5" roughness={0.8}/></instancedMesh>
  </group>;
}

/** Fourteen white-stone garden troughs, kept inside the edge planting beds and away from routes. */
function GardenBorders() {
  const troughs = useRef(), soil = useRef(), bushes = useRef();
  const gardens = useMemo(() => [
    ...[-1, 1].flatMap(side => [-68.6, -63.5, -58.4, -53.3, -48.2].map(z => ({ x: 38 + side * 14.05, z, angle: 0 }))),
    ...[-9.3, -4.6, 4.6, 9.3].map(x => ({ x: 38 + x, z: -70.15, angle: Math.PI / 2 })),
  ], []);
  useEffect(() => {
    const dummy = new THREE.Object3D();
    gardens.forEach(({ x, z, angle }, i) => {
      dummy.position.set(x, 0.24, z); dummy.rotation.set(0, angle, 0); dummy.scale.set(1.55, 0.48, 2.75); dummy.updateMatrix();
      troughs.current.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 0.49; dummy.scale.set(1.24, 0.035, 2.42); dummy.updateMatrix(); soil.current.setMatrixAt(i, dummy.matrix);
      for (let j = 0; j < 3; j++) {
        const offset = (j - 1) * 0.77;
        dummy.position.set(x + Math.sin(angle) * offset, 0.72 + (j % 2) * 0.11, z + Math.cos(angle) * offset);
        dummy.rotation.set(0, angle + j, 0); dummy.scale.set(0.61, 0.39 + j % 2 * 0.12, 0.61); dummy.updateMatrix();
        bushes.current.setMatrixAt(i * 3 + j, dummy.matrix);
      }
    });
    [troughs, soil, bushes].forEach(ref => { ref.current.instanceMatrix.needsUpdate = true; ref.current.computeBoundingSphere(); });
  }, [gardens]);
  return <group>
    <instancedMesh ref={troughs} args={[null, null, gardens.length]}><boxGeometry args={[1, 1, 1]}/><meshStandardMaterial color="#f0f4e9" roughness={0.65}/></instancedMesh>
    <instancedMesh ref={soil} args={[null, null, gardens.length]}><boxGeometry args={[1, 1, 1]}/><meshStandardMaterial color="#365b43" roughness={0.95}/></instancedMesh>
    <instancedMesh ref={bushes} args={[null, null, gardens.length * 3]}><icosahedronGeometry args={[1, 1]}/><meshStandardMaterial color="#5a9060" roughness={0.9}/></instancedMesh>
  </group>;
}

function Promenade({ timeRef, reducedMotion }) {
  const dust = useRef();
  const dustPositions = useMemo(() => {
    const array = new Float32Array(72 * 3);
    for (let i = 0; i < 72; i++) {
      const angle = i * 2.399963, radius = 5 + (i % 13) * 0.55;
      array[i * 3] = Math.cos(angle) * radius;
      array[i * 3 + 1] = 0.6 + ((i * 19) % 59) / 59 * 4.0;
      array[i * 3 + 2] = Math.sin(angle) * radius;
    }
    return array;
  }, []);
  useFrame(({ clock }) => {
    if (dust.current && !reducedMotion) dust.current.rotation.y = (timeRef?.current ?? clock.elapsedTime * 1000) / 48000;
  });
  return <group position={[GPT_PEDESTAL.x, 0, GPT_PEDESTAL.z]}>
    {[5.2, 8.4, 11.3].map((radius, i) => <mesh key={radius} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.026 + i * 0.002, 0]}>
      <ringGeometry args={[radius - (i === 0 ? 0.55 : 0.18), radius, 100]}/><meshStandardMaterial color={i === 0 ? C.trim : '#b2cdbb'} roughness={0.76}/>
    </mesh>)}
    {[5.45, 8.5, 11.45].map(radius => <GlowRing key={radius} at={[0, 0.044, 0]} radius={radius} width={0.026} color="#74c7a4"/>)}
    {Array.from({ length: 16 }, (_, i) => <group key={i} rotation={[0, i * TAU / 16, 0]}>
      <Block at={[0, 0.022, 7.85]} size={[0.065, 0.035, 5.2]} color="#afc8b5"/>
    </group>)}
    {Array.from({ length: 14 }, (_, i) => {
      const a = (i + 0.5) * TAU / 14;
      return <group key={i} position={[Math.sin(a) * 6.3, 0, Math.cos(a) * 6.3]}>
        <Cylinder at={[0, 0.5, 0]} radius={0.055} height={1} color="#638d77" sides={8}/>
        <mesh position={[0, 1.08, 0]}><sphereGeometry args={[0.11, 8, 6]}/><meshBasicMaterial color="#d9ffe9" toneMapped={false}/></mesh>
      </group>;
    })}
    <points ref={dust}><bufferGeometry><bufferAttribute attach="attributes-position" args={[dustPositions, 3]}/></bufferGeometry><pointsMaterial color="#b4ffda" size={0.065} transparent opacity={0.75} depthWrite={false} sizeAttenuation/></points>
  </group>;
}

function Entrance() {
  return <group>
    <Block {...GPT_BRIDGE_SURFACE} color="#bdd4c4"/>
    {Array.from({ length: 13 }, (_, i) => <Block key={i} at={[38, 0.015, -44.7 + i * 0.6]} size={[6.65, 0.025, 0.035]} color="#8ead99"/>)}
    {[-1, 1].map(side => <group key={side}>
      <Beam from={[38 + side * 3.3, 0.8, -44.7]} to={[38 + side * 3.3, 0.8, -37.2]} width={0.055}/>
      <Beam from={[38 + side * 3.3, 0.84, -44.7]} to={[38 + side * 3.3, 0.84, -37.2]} width={0.019} glow/>
      {[-44.6, -42.3, -39.9, -37.3].map(z => <Block key={z} at={[38 + side * 3.3, 0.4, z]} size={[0.09, 0.8, 0.09]} color={C.trim}/>)}
    </group>)}
    {GPT_PILLARS.map(p => <group key={p.x}>
      <Block at={[p.x, 1.95, p.z]} size={[p.width, 3.9, p.depth]} color={C.dark}/>
      <Block at={[p.x, 1.95, p.z + p.depth / 2 + 0.01]} size={[0.1, 3.5, 0.035]} color={C.mint}/>
    </group>)}
    <Block at={[38, 4.08, -44.6]} size={[8, 0.46, 1]} color={C.silver} metalness={0.42}/>
    <Block at={[38, 4.37, -44.6]} size={[8.35, 0.14, 1.14]} color={C.emerald}/>
    <GptBrandEmblem size={1.05} position={[34.5, 4.1, -43.95]}/>
    <Sign text="GPT PARK" at={[38, 4.1, -43.98]} width={5.5} height={1.15}/>
    <Sign text="GPT PARK" at={[38, 4.1, -45.22]} width={5.5} height={1.15} rotation={[0, Math.PI, 0]}/>
  </group>;
}

export default function GptPark({ timeRef, reducedMotion = false, viewMode = 'overview', onSelect }) {
  return <group name="gpt-park" userData={{ viewMode }}>
    {/* The visible footprint is exactly the shared rectangular ground contract. */}
    {GPT_GROUND_LAYERS.map((layer, i) => <Block key={layer.name} {...layer} color={i === 0 ? '#749887' : C.stone}/>)}
    {[-1, 1].map(side => <group key={side}>
      <Block at={[38 + side * 15.85, -0.3, -58]} size={[0.12, 0.1, 27.5]} color={C.mint}/>
      <Block at={[38, -0.3, -58 + side * 13.85]} size={[31.5, 0.1, 0.12]} color={C.mint}/>
    </group>)}
    {GPT_GARDEN_BEDS.map(bed => <Block key={bed.name} {...bed} color="#88a88b"/>)}
    <Block at={[38, 0.025, -50]} size={[4.5, 0.04, 11.4]} color="#b9d5c3"/>
    {[-1, 1].map(side => <Beam key={side} from={[38 + side * 2.28, 0.06, -44.3]} to={[38 + side * 2.28, 0.06, -54.2]} width={0.035} color="#76c99e" glow/>)}
    <Promenade timeRef={timeRef} reducedMotion={reducedMotion}/>
    <group position={[GPT_PEDESTAL.x, 0, GPT_PEDESTAL.z]} onClick={onSelect ? e => { e.stopPropagation(); onSelect('core'); } : undefined}>
      <InspirationKnot timeRef={timeRef} reducedMotion={reducedMotion}/>
      <InspirationStream timeRef={timeRef} reducedMotion={reducedMotion}/>
      <Sign text="GPT" at={[0, 0.96, 4.18]} width={2.45} height={0.85}/>
    </group>
    {GPT_PAVILIONS.map(p => <Pavilion key={p.id} pavilion={p} timeRef={timeRef} reducedMotion={reducedMotion} onSelect={onSelect}/>)}
    <GardenTrees/>
    <GardenBorders/>
    <Entrance/>
  </group>;
}
