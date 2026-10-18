import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import GptBrandEmblem from './GptBrandEmblem.jsx';

// Scheme B: a monumental orbital sanctuary. All coordinates are local to the island.
const TAU = Math.PI * 2;
const M = Object.freeze({ obsidian: '#11191f', dark: '#080f14', steel: '#93a8b1', silver: '#e3eff3', cyan: '#64e7ef' });
const ORBITS = Object.freeze([
  // The three orbits occupy the lower architectural layer. Their hero-camera
  // projections stay below the emblem instead of cutting across the official mark.
  { radius: 13.1, at: [0, 3.4, 0], rotation: [1.12, 0.18, 0.32], thickness: 0.23, phase: 0.7, speed: 0.055 },
  { radius: 14.7, at: [0, 3.8, 0], rotation: [1.04, -0.22, -0.54], thickness: 0.18, phase: 3.2, speed: -0.041 },
  { radius: 16.0, at: [0, 4.0, 0], rotation: [1.25, 0.12, 0.65], thickness: 0.12, phase: 4.4, speed: 0.032 },
]);
const PLACES = Object.freeze([
  { id: 'create', x: -10, z: 6, height: 7.0, side: -1, yaw: 0.22 },
  { id: 'code', x: 10, z: 6, height: 7.0, side: 1, yaw: -0.22 },
  { id: 'voice', x: -10, z: -8, height: 10.6, side: -1, yaw: -0.18 },
  { id: 'explore', x: 10, z: -8, height: 10.6, side: 1, yaw: 0.18 },
]);

function Block({ at, size, color = M.silver, metalness = 0.48, roughness = 0.32, ...rest }) {
  return <mesh position={at} {...rest}><boxGeometry args={size}/><meshStandardMaterial color={color} metalness={metalness} roughness={roughness}/></mesh>;
}

function Plinth({ radius, top = radius, height, y, color = M.obsidian }) {
  return <mesh position={[0, y, 0]} receiveShadow><cylinderGeometry args={[top, radius, height, 112]}/><meshStandardMaterial color={color} metalness={0.36} roughness={0.32}/></mesh>;
}

function Ring({ radius, width = 0.04, at = [0, 0, 0], rotation = [-Math.PI / 2, 0, 0], color = M.cyan, glow = false, opacity = 1, arc = TAU }) {
  return <mesh position={at} rotation={rotation}>
    <torusGeometry args={[radius, width, 8, 128, arc]}/>
    {glow ? <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} toneMapped={false}/> : <meshStandardMaterial color={color} metalness={0.46} roughness={0.26}/>}
  </mesh>;
}

function OrbitalArc({ spec, timeRef, reducedMotion }) {
  const satellite = useRef(), secondary = useRef();
  useFrame(({ clock }) => {
    const t = reducedMotion ? 0 : (timeRef?.current ?? clock.elapsedTime * 1000) / 1000;
    const a = spec.phase + t * spec.speed;
    if (satellite.current) satellite.current.position.set(Math.cos(a) * spec.radius, Math.sin(a) * spec.radius, 0);
    if (secondary.current) secondary.current.position.set(Math.cos(a + Math.PI) * spec.radius, Math.sin(a + Math.PI) * spec.radius, 0);
  });
  return <group position={spec.at} rotation={spec.rotation}>
    <Ring radius={spec.radius} width={spec.thickness} rotation={[0, 0, 0]} color={M.silver}/>
    <Ring radius={spec.radius - spec.thickness * 0.32} width={0.022} at={[0, 0, spec.thickness * 0.96]} rotation={[0, 0, 0]} glow opacity={0.85}/>
    <group ref={satellite}>
      <mesh><sphereGeometry args={[0.28, 16, 12]}/><meshStandardMaterial color={M.silver} metalness={0.6} roughness={0.2}/></mesh>
      <mesh><sphereGeometry args={[0.095, 10, 8]}/><meshBasicMaterial color="#e6ffff" toneMapped={false}/></mesh>
    </group>
    <mesh ref={secondary}><sphereGeometry args={[0.11, 10, 8]}/><meshBasicMaterial color={M.cyan} toneMapped={false}/></mesh>
  </group>;
}

/** Bevelled, carved-through monoliths provide mass and a clean, architectural silhouette. */
function portalGeometry(height) {
  const shape = new THREE.Shape();
  shape.moveTo(-1.65, 0); shape.lineTo(1.65, 0); shape.lineTo(1.65, height - 0.85);
  shape.lineTo(0.65, height); shape.lineTo(-1.15, height - 0.3); shape.lineTo(-1.65, height - 1.25); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.87, 1.0); hole.lineTo(-0.87, height - 1.8); hole.lineTo(0.82, height - 1.35);
  hole.lineTo(0.82, 1.0); hole.closePath(); shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.1, bevelSegments: 2, steps: 1 });
}

function ShrineCore({ kind, height }) {
  const y = Math.min(4.2, height * 0.5);
  if (kind === 'create') return <group position={[0, y, 0.1]}>
    <mesh><sphereGeometry args={[0.58, 28, 20]}/><meshStandardMaterial color="#b6dce6" roughness={0.22} metalness={0.62}/></mesh>
    <Ring radius={0.82} width={0.025} rotation={[0.9, 0.3, 0]} glow/>
    <Ring radius={0.97} width={0.018} rotation={[0.3, 1.1, 0.4]} color={M.silver}/>
  </group>;
  if (kind === 'code') return <group position={[0, y, 0.1]}>
    <Block at={[0, 0, 0]} size={[0.86, 0.86, 0.86]} rotation={[0.45, 0.65, 0.2]} color={M.silver} metalness={0.55}/>
    <mesh rotation={[0.45, 0.65, 0.2]}><boxGeometry args={[1.12, 1.12, 1.12]}/><meshBasicMaterial color={M.cyan} wireframe toneMapped={false}/></mesh>
  </group>;
  if (kind === 'voice') return <group position={[0, y, 0.1]}>
    {[0.4, 0.65, 0.9].map((radius, i) => <Ring key={radius} radius={radius} width={0.045} at={[0, 0, i * 0.22]} rotation={[0, 0, 0]} glow={i === 1} color={i === 1 ? M.cyan : M.silver}/>)}
  </group>;
  return <group position={[0, y, 0.1]}>
    <mesh><octahedronGeometry args={[0.92, 0]}/><meshStandardMaterial color="#caeaf1" metalness={0.6} roughness={0.2}/></mesh>
    <Ring radius={1.1} width={0.024} rotation={[1.05, 0.35, 0]} glow/>
  </group>;
}

function Monolith({ site, onSelect }) {
  const geometry = useMemo(() => portalGeometry(site.height), [site.height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <group position={[site.x, 0.8, site.z]} rotation={[0, site.yaw, 0]} onClick={onSelect ? event => { event.stopPropagation(); onSelect(site.id); } : undefined}>
    <Block at={[0, 0.12, 0]} size={[4.2, 0.24, 3.6]} color="#24323b"/>
    <Block at={[0, 0.29, 0]} size={[3.65, 0.12, 2.85]} color={M.steel}/>
    <mesh geometry={geometry} position={[0, 0.36, -0.6]} castShadow>
      <meshStandardMaterial color={M.silver} metalness={0.45} roughness={0.26}/>
    </mesh>
    <Block at={[site.side * 1.25, site.height / 2, 0.74]} size={[0.11, site.height - 1.5, 0.045]} color="#23383f"/>
    <mesh position={[site.side * 1.25, site.height / 2, 0.772]}><boxGeometry args={[0.028, site.height - 1.9, 0.025]}/><meshBasicMaterial color={M.cyan} toneMapped={false}/></mesh>
    <Block at={[0, 1.02, 0.07]} size={[1.7, 0.1, 1.15]} color="#6c929e"/>
    <ShrineCore kind={site.id} height={site.height}/>
    {[0, 1, 2].map(i => <Block key={i} at={[site.side * 1.8, 0.75 + i * 0.23, 0]} size={[0.32, 0.08, 1.8]} color={M.steel}/>) }
  </group>;
}

function CentralEmblem({ timeRef, reducedMotion, onSelect }) {
  const badge = useRef(), halo = useRef();
  useFrame(({ clock }) => {
    const t = (timeRef?.current ?? clock.elapsedTime * 1000) / 1000;
    if (badge.current) badge.current.position.y = 13.0 + (reducedMotion ? 0 : Math.sin(t * 0.48) * 0.14);
    if (halo.current) halo.current.rotation.z = reducedMotion ? -0.6 : -0.6 + t * 0.025;
  });
  return <group ref={badge} position={[0, 13, 0]} rotation={[0, 0.55, 0]} onClick={onSelect ? event => { event.stopPropagation(); onSelect('heart'); } : undefined}>
    <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[4.7, 4.7, 0.65, 96]}/><meshStandardMaterial color="#050709" metalness={0.3} roughness={0.3}/></mesh>
    <Ring radius={4.7} width={0.12} at={[0, 0, 0.3]} rotation={[0, 0, 0]} color={M.silver}/>
    <Ring radius={4.76} width={0.035} at={[0, 0, -0.31]} rotation={[0, 0, 0]} glow/>
    <GptBrandEmblem size={6.3} position={[0, 0, 0.345]}/>
    <group ref={halo} rotation={[0, 0, -0.6]}>
      <Ring radius={5.35} width={0.06} at={[0, 0, -0.08]} rotation={[0, 0, 0]} color={M.silver} arc={Math.PI * 1.54}/>
      <Ring radius={5.35} width={0.08} at={[0, 0, -0.08]} rotation={[0, 0, Math.PI * 1.74]} glow arc={Math.PI * 0.12}/>
    </group>
    {[-1, 1].map(side => <Block key={side} at={[side * 4.74, 0, -0.03]} size={[0.55, 0.78, 0.8]} color={M.steel}/>) }
  </group>;
}

function Island() {
  return <group>
    <Plinth radius={18} top={17.9} height={1.7} y={-0.9} color="#101921"/>
    <Plinth radius={17.6} top={17.6} height={0.28} y={0.03} color="#37444c"/>
    <Plinth radius={16.8} height={0.26} y={0.29} color="#1e2b33"/>
    <Plinth radius={15.9} height={0.24} y={0.54} color="#26333b"/>
    <Plinth radius={15.0} height={0.2} y={0.76} color="#111b22"/>
    {[{ r: 17.65, y: -0.37 }, { r: 16.8, y: 0.42 }, { r: 15.9, y: 0.66 }, { r: 15.0, y: 0.87 }].map(({ r, y }, i) => <Ring key={r} radius={r} width={i === 0 ? 0.034 : 0.045} at={[0, y, 0]} color={i === 0 ? M.cyan : M.steel} glow={i === 0}/>) }
    {/* A broad unbroken mirror pool leaves the central emblem visually quiet. */}
    <Plinth radius={8.75} top={8.7} height={0.23} y={0.98} color="#586b73"/>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.1, 0]} receiveShadow><circleGeometry args={[8.48, 112]}/><meshStandardMaterial color="#051820" metalness={0.79} roughness={0.095} emissive="#082b33" emissiveIntensity={0.1}/></mesh>
    <Ring radius={8.51} width={0.03} at={[0, 1.12, 0]} glow opacity={0.72}/>
    {[2.3, 3.2, 4.3].map((r, i) => <Ring key={r} radius={r} width={0.013} at={[0, 1.115, 0]} glow opacity={0.12 + i * 0.035}/>) }
    {Array.from({ length: 24 }, (_, i) => <group key={i} rotation={[0, i * TAU / 24, 0]}>
      <Block at={[0, 0.875, 12.0]} size={[0.04, 0.02, 4.75]} color="#5c707c"/>
      {i % 3 === 0 && <mesh position={[0, 0.891, 13.1]}><boxGeometry args={[0.06, 0.018, 1.8]}/><meshBasicMaterial color={M.cyan} toneMapped={false}/></mesh>}
    </group>)}
    {/* The hero approach is a single broad dark causeway with silver reveals. */}
    <Block at={[0, 0.9, 12.5]} size={[5.4, 0.1, 6.5]} color="#293942"/>
    {[-1, 1].map(side => <Block key={side} at={[side * 2.68, 0.97, 12.5]} size={[0.05, 0.04, 6.5]} color={M.silver}/>) }
    {[10.1, 11.7, 13.3, 14.9].map(z => <Block key={z} at={[0, 0.96, z]} size={[5.35, 0.024, 0.045]} color="#68848f"/>)}
  </group>;
}

function QuietStars({ timeRef, reducedMotion }) {
  const node = useRef();
  const positions = useMemo(() => {
    const result = new Float32Array(36 * 3);
    for (let i = 0; i < 36; i++) {
      const a = i * 2.39996, r = 3.5 + i % 7 * 0.48;
      result[i * 3] = Math.cos(a) * r;
      result[i * 3 + 1] = 1.7 + ((i * 13) % 31) / 31 * 8.5;
      result[i * 3 + 2] = Math.sin(a) * r;
    }
    return result;
  }, []);
  useFrame(({ clock }) => {
    if (node.current) node.current.rotation.y = reducedMotion ? 0 : (timeRef?.current ?? clock.elapsedTime * 1000) / 90000;
  });
  return <points ref={node}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]}/></bufferGeometry><pointsMaterial color="#b5f5ff" size={0.055} transparent opacity={0.58} depthWrite={false} toneMapped={false}/></points>;
}

export default function OrbitalSanctum({ timeRef, reducedMotion = false, onSelect }) {
  return <group name="gpt-orbital-sanctum">
    <Island/>
    {/* A far silver aperture creates a second depth plane behind the four carved pylons. */}
    <Ring radius={6.75} width={0.15} at={[0, 7.0, -13.3]} rotation={[0.12, 0, 0]} color="#b3c5ce"/>
    <Ring radius={6.47} width={0.027} at={[0, 7.0, -13.25]} rotation={[0.12, 0, 0]} glow opacity={0.55}/>
    {PLACES.map(site => <Monolith key={site.id} site={site} onSelect={onSelect}/>)}
    {ORBITS.map((spec, i) => <OrbitalArc key={i} spec={spec} timeRef={timeRef} reducedMotion={reducedMotion}/>)}
    <CentralEmblem timeRef={timeRef} reducedMotion={reducedMotion} onSelect={onSelect}/>
    <QuietStars timeRef={timeRef} reducedMotion={reducedMotion}/>
  </group>;
}
