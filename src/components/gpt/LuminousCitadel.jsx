import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import GptBrandEmblem from './GptBrandEmblem.jsx';

// Scheme C: an open civic conservatory, not a recoloured technology campus.
// All construction is local to the origin, inside an 18 m radius and below 17 m.
const TAU = Math.PI * 2;
const PALETTE = Object.freeze({
  porcelain: '#f7f3e8', white: '#fffdf4', shade: '#cddbd6',
  gold: '#ceb47c', champagne: '#ebd6a7', water: '#a4d9df',
  waterDeep: '#568e9d', garden: '#aac2a0', leaf: '#6e9672', trunk: '#a09f82',
});

function Box({ position, size, color = PALETTE.porcelain, ...props }) {
  return <mesh position={position} {...props}><boxGeometry args={size}/><meshStandardMaterial color={color} roughness={0.44} metalness={0.12}/></mesh>;
}

function Cylinder({ position, radius, top = radius, height, color = PALETTE.porcelain, sides = 48, ...props }) {
  return <mesh position={position} {...props}><cylinderGeometry args={[top, radius, height, sides]}/><meshStandardMaterial color={color} roughness={0.38} metalness={color === PALETTE.gold ? 0.68 : 0.15}/></mesh>;
}

function Ring({ position, radius, thickness = 0.06, color = PALETTE.gold, rotation = [-Math.PI / 2, 0, 0], ...props }) {
  return <mesh position={position} rotation={rotation} {...props}><torusGeometry args={[radius, thickness, 8, 96]}/><meshStandardMaterial color={color} metalness={0.62} roughness={0.3}/></mesh>;
}

function OwnedGeometry({ geometry }) {
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry"/>;
}

function makePetalIsland() {
  const shape = new THREE.Shape();
  const points = Array.from({ length: 121 }, (_, i) => {
    const angle = i / 120 * TAU;
    const radius = 16.7 + 1.1 * Math.cos(angle * 6);
    return new THREE.Vector2(Math.sin(angle) * radius, Math.cos(angle) * radius);
  });
  shape.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach(point => shape.lineTo(point.x, point.y));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.78, bevelEnabled: true, bevelSize: 0.11, bevelThickness: 0.11, bevelSegments: 2, steps: 1 });
}

function gardenGeometry() {
  const shape = new THREE.Shape();
  const inner = 9.9, outer = 16.15, start = 0.13, end = Math.PI / 3 - 0.13;
  shape.moveTo(Math.sin(start) * inner, Math.cos(start) * inner);
  for (let i = 0; i <= 30; i += 1) {
    const a = start + (end - start) * i / 30;
    shape.lineTo(Math.sin(a) * outer, Math.cos(a) * outer);
  }
  for (let i = 30; i >= 0; i -= 1) {
    const a = start + (end - start) * i / 30;
    shape.lineTo(Math.sin(a) * inner, Math.cos(a) * inner);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 24);
}

function CrownTree({ position, scale = 1 }) {
  return <group position={position} scale={scale}>
    <Cylinder position={[0, 1.15, 0]} radius={0.1} top={0.075} height={2.1} color={PALETTE.trunk} sides={8}/>
    <mesh position={[0, 2.35, 0]} scale={[0.95, 0.82, 0.95]}><sphereGeometry args={[1, 12, 10]}/><meshStandardMaterial color={PALETTE.leaf} roughness={0.92}/></mesh>
    <Cylinder position={[0, 0.15, 0]} radius={0.72} height={0.22} color={PALETTE.porcelain} sides={24}/>
  </group>;
}

function SixPetalGarden({ timeRef, reducedMotion }) {
  const island = useMemo(makePetalIsland, []);
  const garden = useMemo(gardenGeometry, []);
  // Six meshes borrow this geometry; the owning garden releases it once.
  useEffect(() => () => garden.dispose(), [garden]);
  const water = useRef();
  useFrame(({ clock }) => {
    const t = Number.isFinite(timeRef?.current) ? timeRef.current / 1000 : clock.elapsedTime;
    if (water.current) water.current.emissiveIntensity = reducedMotion ? 0.04 : 0.045 + Math.sin(t * 0.32) * 0.025;
  });
  return <group>
    <Cylinder position={[0, -0.8, 0]} radius={15.9} top={16.7} height={0.65} color={PALETTE.shade} sides={6} rotation={[0, Math.PI / 6, 0]}/>
    <mesh position={[0, -0.65, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <OwnedGeometry geometry={island}/><meshStandardMaterial color={PALETTE.porcelain} roughness={0.48} metalness={0.12}/>
    </mesh>
    {/* Six broad landscaped lobes alternate with lake-blue radial canals. */}
    {Array.from({ length: 6 }, (_, i) => <group key={i} rotation={[0, i * TAU / 6, 0]}>
      <mesh geometry={garden} position={[0, 0.255, 0]} rotation={[-Math.PI / 2, 0, 0]}><meshStandardMaterial color={PALETTE.garden} roughness={0.95} side={THREE.DoubleSide}/></mesh>
      <Box position={[0, 0.19, 10.95]} size={[1.55, 0.08, 11.6]} color={PALETTE.waterDeep}/>
      <mesh position={[0, 0.245, 10.95]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[1.3, 11.5]}/><meshStandardMaterial ref={i === 0 ? water : undefined} color={PALETTE.water} metalness={0.34} roughness={0.16} emissive="#8fced9" emissiveIntensity={0.04}/></mesh>
      {[-1, 1].map(side => <Box key={side} position={[side * 0.84, 0.3, 10.95]} size={[0.1, 0.1, 11.7]} color={PALETTE.champagne}/>)}
      <Box position={[0, 0.36, 8.7]} size={[3.4, 0.17, 1.4]} color={PALETTE.white}/>
      <CrownTree position={[Math.sin(0.34) * 15, 0.22, -Math.cos(0.34) * 15]} scale={0.88}/>
      <CrownTree position={[Math.sin(0.71) * 15, 0.22, -Math.cos(0.71) * 15]} scale={0.78}/>
      {/* Flush gold inlays make the radial plan legible without tiny ornament. */}
      <Box position={[0, 0.28, 3.5]} size={[0.065, 0.018, 5.1]} color={PALETTE.gold}/>
    </group>)}
    <Cylinder position={[0, 0.24, 0]} radius={8.25} height={0.23} color={PALETTE.white}/>
    <Ring position={[0, 0.365, 0]} radius={8.04} thickness={0.045}/>
    <Ring position={[0, 0.368, 0]} radius={5.7} thickness={0.025} color={PALETTE.champagne}/>
    {/* A small reflecting court below the suspended brand gives the centre air. */}
    <Cylinder position={[0, 0.38, 0]} radius={3.65} height={0.14} color={PALETTE.gold}/>
    <mesh position={[0, 0.46, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[3.53, 72]}/><meshStandardMaterial color={PALETTE.water} roughness={0.12} metalness={0.35}/></mesh>
  </group>;
}

const roofCurve = () => new THREE.CatmullRomCurve3([
  new THREE.Vector3(8.0, 0.55, 0), new THREE.Vector3(7.85, 5.1, 0),
  new THREE.Vector3(6.55, 9.3, 0), new THREE.Vector3(3.6, 12.95, 0),
  new THREE.Vector3(0.7, 14.25, 0),
]);

function makeRoofSail(curve) {
  const positions = [], indices = [];
  const length = 26, across = 8;
  for (let i = 0; i <= length; i += 1) {
    const progress = i / length, point = curve.getPoint(0.47 + progress * 0.53);
    const breadth = 0.08 + 1.05 * Math.sin(progress * Math.PI) ** 0.8;
    for (let j = 0; j <= across; j += 1) {
      const side = (j / across - 0.5) * 2;
      positions.push(point.x, point.y + (1 - side * side) * 0.2, side * breadth);
      if (i < length && j < across) {
        const a = i * (across + 1) + j, b = a + across + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function OpenLotusCrown({ timeRef, reducedMotion }) {
  const curve = useMemo(roofCurve, []);
  const sail = useMemo(() => makeRoofSail(curve), [curve]);
  const halo = useRef();
  useEffect(() => () => sail.dispose(), [sail]);
  useFrame(({ clock }) => {
    const t = Number.isFinite(timeRef?.current) ? timeRef.current / 1000 : clock.elapsedTime;
    if (halo.current) halo.current.rotation.y = reducedMotion ? 0 : t * 0.025;
  });
  return <group>
    {Array.from({ length: 6 }, (_, i) => <group key={i} rotation={[0, i * TAU / 6 + Math.PI / 6, 0]}>
      <mesh castShadow><tubeGeometry args={[curve, 64, 0.22, 10, false]}/><meshStandardMaterial color={PALETTE.white} metalness={0.18} roughness={0.36}/></mesh>
      <mesh position={[0, 0.035, 0.225]}><tubeGeometry args={[curve, 64, 0.045, 6, false]}/><meshStandardMaterial color={PALETTE.gold} metalness={0.72} roughness={0.26}/></mesh>
      <mesh geometry={sail} castShadow><meshStandardMaterial color={PALETTE.white} side={THREE.DoubleSide} metalness={0.14} roughness={0.38}/></mesh>
      <Cylinder position={[8, 0.5, 0]} radius={0.53} height={0.28} color={PALETTE.gold} sides={24}/>
    </group>)}
    <Ring position={[0, 14.24, 0]} radius={0.84} thickness={0.15} color={PALETTE.champagne}/>
    <group ref={halo} position={[0, 13.45, 0]}>
      {/* Three long, slow arcs read as one crown, never a cloud of particles. */}
      {[0, 1, 2].map(i => <mesh key={i} rotation={[-Math.PI / 2, 0, i * TAU / 3]}><torusGeometry args={[2.1, 0.028, 6, 40, Math.PI / 2]}/><meshBasicMaterial color="#fff4d8" toneMapped={false}/></mesh>)}
    </group>
  </group>;
}

function towerPoint(t, angle, height, width, lean) {
  const radius = width * (0.04 + 0.96 * (1 - t) ** 0.73);
  const twist = angle + t * 0.58;
  const rib = 0.86 + Math.cos(angle * 3) * 0.14;
  return new THREE.Vector3(Math.cos(twist) * radius * rib + lean * Math.sin(t * Math.PI / 2), 0.3 + t * height, Math.sin(twist) * radius * rib);
}

function makeTower(height, width, lean) {
  const positions = [], indices = [], levels = 36, sides = 30;
  for (let level = 0; level <= levels; level += 1) {
    for (let side = 0; side <= sides; side += 1) {
      const point = towerPoint(level / levels, side / sides * TAU, height, width, lean);
      positions.push(point.x, point.y, point.z);
      if (level < levels && side < sides) {
        const a = level * (sides + 1) + side, b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function CurvedTower({ height = 14, width = 1.55, lean = 0.7, observatory = false, hovered = false }) {
  const geometry = useMemo(() => makeTower(height, width, lean), [height, width, lean]);
  const spines = useMemo(() => Array.from({ length: 3 }, (_, i) => new THREE.CatmullRomCurve3(
    Array.from({ length: 37 }, (_, step) => towerPoint(step / 36, i * TAU / 3, height, width + 0.045, lean)),
  )), [height, width, lean]);
  const deckT = 0.63, deckX = lean * Math.sin(deckT * Math.PI / 2);
  return <group>
    <Cylinder position={[0, 0.26, 0]} radius={width + 0.55} height={0.32} color={PALETTE.white}/>
    <Ring position={[0, 0.44, 0]} radius={width + 0.43} thickness={hovered ? 0.085 : 0.05}/>
    <mesh castShadow><OwnedGeometry geometry={geometry}/><meshStandardMaterial color={PALETTE.white} roughness={0.35} metalness={0.18} side={THREE.DoubleSide}/></mesh>
    {spines.map((curve, i) => <mesh key={i}><tubeGeometry args={[curve, 48, 0.04, 6, false]}/><meshStandardMaterial color={PALETTE.gold} metalness={0.72} roughness={0.25}/></mesh>)}
    {observatory && <group position={[deckX, 0.3 + height * deckT, 0]}>
      <Cylinder position={[0, 0, 0]} radius={1.85} top={1.72} height={0.22} color={PALETTE.white}/>
      <Ring position={[0, 0.12, 0]} radius={1.78} thickness={0.035}/>
      <mesh position={[0, 0.5, 0]}><cylinderGeometry args={[1.52, 1.65, 0.75, 48, 1, true]}/><meshStandardMaterial color="#c5e0df" transparent opacity={0.32} roughness={0.18} metalness={0.25} side={THREE.DoubleSide} depthWrite={false}/></mesh>
      <Cylinder position={[0, 0.91, 0]} radius={1.72} top={1.4} height={0.2} color={PALETTE.white}/>
    </group>}
  </group>;
}

function Colonnade({ hovered }) {
  return <group>
    <Cylinder position={[0, 0.35, 0]} radius={2.8} height={0.45} color={PALETTE.white}/>
    <Ring position={[0, 0.59, 0]} radius={2.59} thickness={hovered ? 0.09 : 0.045}/>
    {Array.from({ length: 8 }, (_, i) => {
      const a = i * TAU / 8;
      return <group key={i} position={[Math.sin(a) * 2.15, 0, Math.cos(a) * 2.15]}>
        <Cylinder position={[0, 2.35, 0]} radius={0.11} top={0.085} height={3.55} color={PALETTE.white} sides={12}/>
        <Cylinder position={[0, 0.7, 0]} radius={0.19} height={0.15} color={PALETTE.gold} sides={16}/>
        <Cylinder position={[0, 4.1, 0]} radius={0.21} height={0.16} color={PALETTE.gold} sides={16}/>
      </group>;
    })}
    <Ring position={[0, 4.25, 0]} radius={2.18} thickness={0.23} color={PALETTE.white}/>
    <Ring position={[0, 4.42, 0]} radius={2.18} thickness={0.05}/>
    <Cylinder position={[0, 1.3, 0]} radius={0.65} top={0.5} height={1.5} color={PALETTE.porcelain}/>
    <mesh position={[0, 2.35, 0]} scale={[0.9, 0.55, 0.9]}><sphereGeometry args={[0.75, 20, 12]}/><meshStandardMaterial color={PALETTE.water} roughness={0.15} metalness={0.3}/></mesh>
  </group>;
}

function CloudTerraces({ timeRef, reducedMotion, hovered }) {
  const top = useRef();
  useFrame(({ clock }) => {
    const t = Number.isFinite(timeRef?.current) ? timeRef.current / 1000 : clock.elapsedTime;
    if (top.current) top.current.rotation.y = reducedMotion ? 0.12 : 0.12 + Math.sin(t * 0.12) * 0.1;
  });
  return <group>
    <Cylinder position={[0, 0.35, 0]} radius={2.75} height={0.44} color={PALETTE.white}/>
    <Ring position={[0, 0.58, 0]} radius={2.5} thickness={hovered ? 0.09 : 0.045}/>
    {[-1, 1].flatMap(x => [-1, 1].map(z => <Cylinder key={`${x}:${z}`} position={[x * 1.3, 3.0, z * 1.3]} radius={0.095} height={5.3} color={PALETTE.gold} sides={12}/>))}
    {[1.05, 3.1, 5.15].map((y, i) => <group key={y} position={[0, y, 0]} rotation={[0, i * 0.16, 0]}>
      <mesh scale={[1, 1, 0.76]}><cylinderGeometry args={[2.35, 2.4, 0.2, 48]}/><meshStandardMaterial color={PALETTE.white} roughness={0.38} metalness={0.15}/></mesh>
      <Ring position={[0, 0.12, 0]} radius={2.23} thickness={0.035} scale={[1, 0.76, 1]}/>
    </group>)}
    <group ref={top} position={[0, 5.65, 0]}>
      <mesh rotation={[0, 0, Math.PI / 7]}><torusGeometry args={[1.2, 0.16, 12, 64]}/><meshStandardMaterial color={PALETTE.gold} roughness={0.25} metalness={0.62}/></mesh>
      <mesh position={[0, 0, 0]}><sphereGeometry args={[0.48, 24, 16]}/><meshStandardMaterial color={PALETTE.water} roughness={0.12} metalness={0.3}/></mesh>
    </group>
  </group>;
}

function District({ id, position, onSelect, children }) {
  const [hovered, setHovered] = useState(false);
  return <group position={position}
    onClick={onSelect ? event => { event.stopPropagation(); onSelect(id); } : undefined}
    onPointerOver={onSelect ? event => { event.stopPropagation(); setHovered(true); } : undefined}
    onPointerOut={onSelect ? () => setHovered(false) : undefined}>
    {children(hovered)}
  </group>;
}

function BrandSanctuary({ onSelect }) {
  return <group onClick={onSelect ? event => { event.stopPropagation(); onSelect('heart'); } : undefined}>
    {/* The official asset owns the mark. The architecture only supplies a quiet frame. */}
    <group position={[0, 7, 1]} rotation={[0, 0.55, 0]}>
      <Cylinder position={[0, 0, -0.27]} radius={3.67} height={0.22} color={PALETTE.gold} rotation={[Math.PI / 2, 0, 0]} castShadow/>
      <Cylinder position={[0, 0, -0.13]} radius={3.55} height={0.16} color={PALETTE.white} rotation={[Math.PI / 2, 0, 0]}/>
      <GptBrandEmblem size={6} position={[0, 0, 0.015]}/>
      {[-1, 1].map(side => <Box key={side} position={[side * 2.65, -4.9, -0.31]} size={[0.075, 3.3, 0.1]} color={PALETTE.gold}/>)}
    </group>
    <Cylinder position={[0, 0.6, 1]} radius={1.9} top={1.6} height={0.2} color={PALETTE.white}/>
  </group>;
}

export default function LuminousCitadel({ timeRef, reducedMotion = false, onSelect }) {
  return <group name="gpt-luminous-citadel">
    <SixPetalGarden timeRef={timeRef} reducedMotion={reducedMotion}/>
    <OpenLotusCrown timeRef={timeRef} reducedMotion={reducedMotion}/>
    <BrandSanctuary onSelect={onSelect}/>
    <District id="create" position={[-10, 0.1, 6]} onSelect={onSelect}>{hovered => <Colonnade hovered={hovered}/>}</District>
    <District id="code" position={[10, 0.1, 6]} onSelect={onSelect}>{hovered => <CloudTerraces hovered={hovered} timeRef={timeRef} reducedMotion={reducedMotion}/>}</District>
    <District id="voice" position={[-10, 0.1, -8]} onSelect={onSelect}>{hovered => <CurvedTower height={15.7} width={1.7} lean={0.8} observatory hovered={hovered}/>}</District>
    <District id="explore" position={[10, 0.1, -8]} onSelect={onSelect}>{hovered => <CurvedTower height={13.8} width={1.7} lean={-0.8} observatory hovered={hovered}/>}</District>
    <group position={[-14, 0.1, -0.8]}><CurvedTower height={10.3} width={1.25} lean={0.65}/></group>
    <group position={[14, 0.1, -0.8]}><CurvedTower height={11.7} width={1.25} lean={-0.65}/></group>
  </group>;
}
