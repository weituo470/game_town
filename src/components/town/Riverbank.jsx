import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RIVER, RIVER_PIER, FISHING_SPOT } from '../../../shared/river.js';
import { RIVER_SURFACES } from './riverSurfaces.js';

function Block({ at, size, color, ...props }) {
  return <mesh position={at} receiveShadow castShadow {...props}><boxGeometry args={size}/><meshStandardMaterial color={color} roughness={0.9}/></mesh>;
}
function Instances({ entries, color, kind = 'box', roughness = 0.85 }) {
  const ref = useRef();
  useLayoutEffect(() => {
    if (!ref.current) return;
    const object = new THREE.Object3D();
    entries.forEach((item, index) => {
      object.position.set(...item.at); object.scale.set(...item.size); object.rotation.set(...(item.rotation || [0, 0, 0])); object.updateMatrix(); ref.current.setMatrixAt(index, object.matrix);
    });
    ref.current.instanceMatrix.needsUpdate = true; ref.current.computeBoundingSphere();
  }, [entries]);
  return <instancedMesh ref={ref} args={[null, null, entries.length]} receiveShadow>
    {kind === 'stone' ? <dodecahedronGeometry args={[1, 0]}/> : kind === 'reed' ? <cylinderGeometry args={[0.5, 0.5, 1, 5]}/> : <boxGeometry/>}
    <meshStandardMaterial color={color} roughness={roughness}/>
  </instancedMesh>;
}
function RiverFlow({ reducedMotion }) {
  const streaks = useRef(), fish = useRef(), dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const t = reducedMotion ? 0 : clock.elapsedTime;
    if (streaks.current) {
      for (let i = 0; i < 24; i++) {
        const z = RIVER.z - RIVER.depth / 2 + ((i * 3.71 + t * 0.48) % RIVER.depth);
        dummy.position.set(RIVER.x + Math.sin(i * 1.9) * 2.3, RIVER.waterY + 0.018, z);
        dummy.scale.set(0.018 + (i % 3) * 0.009, 0.008, 0.55 + i % 4 * 0.22); dummy.rotation.set(0, Math.sin(i) * 0.12, 0); dummy.updateMatrix(); streaks.current.setMatrixAt(i, dummy.matrix);
      }
      streaks.current.instanceMatrix.needsUpdate = true;
    }
    if (fish.current) {
      for (let i = 0; i < 6; i++) {
        dummy.position.set(RIVER.x + Math.sin(t * 0.16 + i * 1.7) * 1.8, RIVER.waterY + 0.012, -9 + Math.sin(t * 0.19 + i) * 6);
        dummy.scale.set(0.11, 0.012, 0.42); dummy.rotation.set(0, Math.sin(t * 0.17 + i) * 0.4, 0); dummy.updateMatrix(); fish.current.setMatrixAt(i, dummy.matrix);
      }
      fish.current.instanceMatrix.needsUpdate = true;
    }
  });
  return <>
    <instancedMesh name="river-flow-streaks" ref={streaks} args={[null, null, 24]} renderOrder={RIVER_SURFACES.streakOrder} frustumCulled={false}><boxGeometry/><meshBasicMaterial color="#b9e6d3" transparent opacity={0.32} depthWrite={false}/></instancedMesh>
    <instancedMesh name="river-fish-silhouettes" ref={fish} args={[null, null, 6]} renderOrder={RIVER_SURFACES.fishOrder} frustumCulled={false}><sphereGeometry args={[1, 10, 6]}/><meshBasicMaterial color="#1b4c57" transparent opacity={0.4} depthWrite={false}/></instancedMesh>
  </>;
}
export default function Riverbank({ reducedMotion }) {
  const pieces = useMemo(() => {
    const boards = [], alternate = [], bolts = [], posts = [], stones = [], reeds = [], seeds = [];
    for (let i = 0; i < 38; i++) {
      const x = RIVER_PIER.x - RIVER_PIER.width / 2 + (i + 0.5) * RIVER_PIER.width / 38;
      (i % 3 ? boards : alternate).push({ at: [x, 0.035, RIVER_PIER.z], size: [RIVER_PIER.width / 38 - 0.022, 0.16, RIVER_PIER.depth] });
      for (const side of [-1, 1]) bolts.push({ at: [x, 0.121, RIVER_PIER.z + side * 0.96], size: [0.035, 0.01, 0.035] });
    }
    for (let i = 0; i < 7; i++) for (const side of [-1, 1]) posts.push({ at: [-51.6 + i * 1.8, 0.14, -4 + side * 1.14], size: [0.15, 1.65, 0.15] });
    for (let i = 0; i < 27; i++) {
      const z = -37 + i * 1.51, scale = 0.3 + i % 4 * 0.08;
      stones.push({ at: [-54.8 - Math.sin(i * 1.9) * 0.18, -0.1, z], size: [scale * 1.2, scale * 0.7, scale], rotation: [0, i, 0.15] });
      if (i % 2 === 0) stones.push({ at: [-48.35, -0.15, z], size: [scale, scale * 0.8, scale * 0.9], rotation: [0.2, i, 0] });
      for (let j = 0; j < 3; j++) {
        const x = -55.1 - j * 0.16, height = 0.5 + (i + j) % 4 * 0.16;
        reeds.push({ at: [x, height / 2 - 0.22, z + j * 0.2], size: [0.035, height, 0.035], rotation: [0.1, 0, -0.12] });
        seeds.push({ at: [x + 0.03, height - 0.2, z + j * 0.2], size: [0.065, 0.16, 0.065] });
      }
    }
    return { boards, alternate, bolts, posts, stones, reeds, seeds };
  }, []);
  return <group name="Western river and fishing pier">
    <Block name="riverbed" at={[RIVER.x, RIVER_SURFACES.bedY, RIVER.z]} size={[RIVER.width + 0.4, RIVER_SURFACES.bedHeight, RIVER.depth]} color="#285c68"/>
    <mesh name="river-water" position={[RIVER.x, RIVER.waterY, RIVER.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={RIVER_SURFACES.waterOrder} receiveShadow><planeGeometry args={[RIVER.width, RIVER.depth]}/><meshStandardMaterial color="#438d95" roughness={0.25} metalness={0.12} transparent opacity={0.94} depthWrite={false}/></mesh>
    <Block at={[-56.1, -0.2, RIVER.z]} size={[2.4, 0.55, RIVER.depth]} color="#667c60"/>
    <Block at={[-55.1, -0.18, RIVER.z]} size={[0.6, 0.28, RIVER.depth]} color="#969c7d"/>
    <Instances entries={pieces.boards} color="#ba9063"/>
    <Instances entries={pieces.alternate} color="#c6a173"/>
    <Instances entries={pieces.bolts} color="#625f55"/>
    <Instances entries={pieces.posts} color="#7f664e"/>
    <Instances entries={pieces.stones} color="#a6a68b" kind="stone"/>
    <Instances entries={pieces.reeds} color="#7e9b62" kind="reed"/>
    <Instances entries={pieces.seeds} color="#79694d" kind="reed"/>
    {[-1, 1].map(side => <Block key={side} at={[RIVER_PIER.x + 1.1, 0.7, -4 + side * 1.14]} size={[9.6, 0.1, 0.1]} color="#c7b58f"/>)}
    {/* The fishing end has open water access, rather than a railing through the line. */}
    <Block at={[-47, 0.4, -3.1]} size={[1.35, 0.16, 0.45]} color="#b38a5d"/>
    <Block at={[-47, 0.7, -2.94]} size={[1.35, 0.55, 0.1]} color="#a9845b"/>
    {[-47.5, -46.5].map(x => <Block key={x} at={[x, 0.2, -3.1]} size={[0.12, 0.4, 0.28]} color="#786756"/>)}
    <mesh position={[FISHING_SPOT.x + 0.5, 0.3, -4.8]} castShadow><cylinderGeometry args={[0.24, 0.19, 0.5, 16, 1, true]}/><meshStandardMaterial color="#8aa5ac" metalness={0.5} side={THREE.DoubleSide}/></mesh>
    <mesh position={[FISHING_SPOT.x + 0.5, 0.55, -4.8]} rotation={[-Math.PI / 2, 0, 0]}><torusGeometry args={[0.24, 0.025, 6, 24]}/><meshStandardMaterial color="#d1d9ce" metalness={0.7}/></mesh>
    <Block at={[-48.3, 0.23, -4.75]} size={[0.6, 0.35, 0.35]} color="#66877d"/>
    <Block at={[-48.3, 0.42, -4.75]} size={[0.64, 0.06, 0.39]} color="#d2b47a"/>
    <RiverFlow reducedMotion={reducedMotion}/>
  </group>;
}
