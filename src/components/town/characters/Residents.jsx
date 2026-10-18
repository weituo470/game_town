import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { createWinterGirl } from './WinterGirl.js';
import { createCapBoy } from './CapBoy.js';
import { createNpcModel, animateNpcModel } from './NpcModels.js';
import { NPCS } from '../../../lib/npcCatalog.js';
import { sampleNpc, findNearestNpc } from '../../../../shared/npcSimulation.js';

// These bounded asset caches share geometry/materials between the town and the
// portrait viewer. Closing a portrait never disposes the living town's models.
const originals = new Map();
function residentAsset(kind) {
  if (!originals.has(kind)) originals.set(kind, kind === 'girl' ? createWinterGirl() : createCapBoy());
  return originals.get(kind);
}

export function ResidentModel({ kind = 'girl', position = [0, 0, 0], scale = 1, facing = 0, reducedMotion = false, onClick }) {
  const root = useRef();
  const model = useMemo(() => residentAsset(kind).clone(true), [kind]);
  useFrame(({ clock }) => {
    if (!root.current) return;
    const phase = kind === 'girl' ? 0 : 1.8;
    const idle = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 1.35 + phase);
    root.current.scale.set(scale, scale * (1 + idle * 0.003), scale);
    root.current.rotation.y = facing + (reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.38 + phase) * 0.035);
  });
  return <group ref={root} position={position} scale={scale} rotation={[0, facing, 0]} onClick={onClick}>
    <primitive object={model} dispose={null} />
  </group>;
}

const npcAssets = new Map();
function npcAsset(id) {
  if (!npcAssets.has(id)) npcAssets.set(id, createNpcModel(id));
  return npcAssets.get(id);
}

function WalkingResident({ npc, timeRef, reducedMotion, selected, playerPoseRef, onInspect, active }) {
  const root = useRef(null);
  const model = useMemo(() => npcAsset(npc.id).clone(true), [npc.id]);
  useFrame((_, delta) => {
    const time = timeRef?.current ?? 0;
    const state = sampleNpc(npc.id, time);
    if (!root.current || !state) return;
    root.current.position.set(state.x, 0.16, state.z);
    // Keep shared routes identical in multiplayer. A nearby resident turns
    // toward you only while dwelling; no client can stop other players' NPCs.
    const player = playerPoseRef.current;
    const facing = selected && !state.moving && player ? Math.atan2(player.x - state.x, player.z - state.z) : state.yaw;
    root.current.rotation.y += Math.atan2(Math.sin(facing - root.current.rotation.y), Math.cos(facing - root.current.rotation.y)) * Math.min(1, delta * 9);
    animateNpcModel(model, { moving: state.moving, activity: selected && !state.moving ? 'greet' : state.activity, time: time / 1000, reducedMotion });
  });
  return <group ref={root} name={`resident-${npc.id}`} onClick={event => { event.stopPropagation(); if (active) onInspect?.(npc.id); }}>
    <primitive object={model} dispose={null}/>
    {selected && active && <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}><ringGeometry args={[0.68, 0.76, 32]}/><meshBasicMaterial color="#f4d194" transparent opacity={0.7} depthWrite={false}/></mesh>
      <Html center position={[0, 3.4, 0]} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}><div className="npc-world-label">{npc.name}<span>F · 聊一聊</span></div></Html>
    </>}
  </group>;
}

export default function TownResidents({ reducedMotion, onInspect, timeRef, playerPoseRef, onNearestNpc, nearestNpcId, viewMode, active }) {
  const last = useRef(null);
  const elapsed = useRef(0);
  useFrame((_, delta) => {
    elapsed.current += delta;
    if (elapsed.current < 0.15) return;
    elapsed.current = 0;
    const next = active && viewMode !== 'overview' ? findNearestNpc(playerPoseRef.current, timeRef?.current ?? 0, 4)?.id ?? null : null;
    if (next !== last.current) { last.current = next; onNearestNpc?.(next); }
  });
  return <group name="Town residents — deterministic ambient schedules">
    {NPCS.map(npc => <WalkingResident key={npc.id} npc={npc} timeRef={timeRef} reducedMotion={reducedMotion} selected={nearestNpcId === npc.id && viewMode !== 'overview'} playerPoseRef={playerPoseRef} onInspect={onInspect} active={active}/>)}
  </group>;
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  const materials = new Set();
  originals.forEach(model => model.traverse(object => {
    object.geometry?.dispose();
    if (object.material) materials.add(object.material);
  }));
  materials.forEach(material => material.dispose());
  originals.clear();
  const geometries = new Set();
  const npcMaterials = new Set();
  npcAssets.forEach(model => model.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => npcMaterials.add(material));
  }));
  geometries.forEach(geometry => geometry.dispose());
  npcMaterials.forEach(material => material.dispose());
  npcAssets.clear();
});
