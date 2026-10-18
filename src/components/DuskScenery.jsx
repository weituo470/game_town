import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { GAMES } from '../lib/catalog';
import { WORLD_LOCATIONS } from '../../shared/world.js';
import { sampleDayNight } from '../../shared/dayNight.js';
import { GEOMETRY, MATERIAL, castsSceneryShadow, configureSceneryBatch, createBalloonBatches, createSceneryBatches, isVenueLabelVisible } from './town/DuskSceneryModel.js';

export { createSceneryBatches } from './town/DuskSceneryModel.js';

function Batch({ kind, material, entries, materials = MATERIAL }) {
  const mesh = useRef();
  useLayoutEffect(() => {
    const ownedMesh = mesh.current;
    if (!ownedMesh) return;
    return configureSceneryBatch(ownedMesh, entries);
  }, [entries]);
  return <instancedMesh ref={mesh} args={[GEOMETRY[kind], materials[material], entries.length]} castShadow={castsSceneryShadow(kind, material)} receiveShadow={!['glow', 'contact', 'lamp'].includes(material)} renderOrder={material === 'contact' ? 1 : material === 'glow' ? 2 : 0} dispose={null} />;
}

function LightBalloons({ reducedMotion }) {
  const group = useRef();
  const batches = useMemo(createBalloonBatches, []);
  useFrame(({ clock }) => { if (group.current) group.current.position.y = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.35) * 0.22; });
  return <group ref={group}>{batches.map(batch => <Batch key={`${batch.kind}:${batch.material}`} {...batch} />)}</group>;
}

const VENUE_LIGHTS = {
  balloons: { y: 2.8, dz: 2.3, color: '#ffd29c', intensity: 15, distance: 7 },
  haunted: { y: 2.5, dz: 3.2, color: '#b296e4', intensity: 15, distance: 7 },
  rhythm: { y: 3.2, dz: 2.1, color: '#ffba75', intensity: 20, distance: 8 },
  puzzle: { y: 2.8, dz: 0.7, color: '#ffdca3', intensity: 13, distance: 7 },
};

function VenueLabel({ game, completed }) {
  const label = useRef(null);
  const observer = useRef(null);
  const dimensions = useRef({ width: 168, height: 48 });
  const shown = useRef(false);
  const point = useRef(new THREE.Vector3());
  const anchor = useMemo(() => [game.position[0], game.id === 'haunted' ? 8.1 : 6.9, game.position[2]], [game]);
  const bindLabel = useCallback(node => {
    observer.current?.disconnect();
    observer.current = null;
    label.current = node;
    shown.current = false;
    if (!node) return;
    node.style.visibility = 'hidden';
    const measure = () => { dimensions.current = { width: node.offsetWidth || 168, height: node.offsetHeight || 48 }; };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(measure);
      observer.current.observe(node);
    }
  }, []);
  useFrame(({ camera, size }) => {
    if (!label.current) return;
    point.current.set(...anchor).project(camera);
    const visible = isVenueLabelVisible({
      x: (point.current.x + 1) * size.width / 2,
      y: (1 - point.current.y) * size.height / 2,
      clipZ: point.current.z,
      width: size.width,
      height: size.height,
      labelWidth: dimensions.current.width,
      labelHeight: dimensions.current.height,
    });
    // Update only the changed DOM property, never React state on every frame.
    if (visible !== shown.current) {
      label.current.style.visibility = visible ? 'visible' : 'hidden';
      shown.current = visible;
    }
  });
  return <Html center position={anchor} zIndexRange={[8, 0]} className="town-label-anchor" style={{ pointerEvents: 'none' }}>
    <div ref={bindLabel} className={`world-label dusk-label${completed ? ' is-complete' : ''}`} style={{ '--venue-color': game.color }}>
      <span className="world-label-dot" aria-hidden="true">{completed ? '✓' : ''}</span>{game.name}
    </div>
  </Html>;
}

export default function DuskScenery({ reducedMotion, completedIds = [], overview = false, timeRef }) {
  const batches = useMemo(createSceneryBatches, []);
  const width = useThree(state => state.size.width);
  const lights = useRef([]);
  // Clone only the two animated materials: multiple canvases must not fight over
  // the module-owned shared scenery materials, and instancing remains intact.
  const materials = useMemo(() => ({ ...MATERIAL, lamp: MATERIAL.lamp.clone(), glow: MATERIAL.glow.clone() }), []);
  useEffect(() => () => { materials.lamp.dispose(); materials.glow.dispose(); }, [materials]);
  useFrame(() => {
    const cycle = sampleDayNight(timeRef?.current ?? 0);
    materials.lamp.emissiveIntensity = 0.2 + 2.8 * cycle.lampIntensity;
    materials.glow.opacity = 0.26 * cycle.lampIntensity;
    WORLD_LOCATIONS.forEach((place, index) => {
      if (lights.current[index]) lights.current[index].intensity = VENUE_LIGHTS[place.id].intensity * cycle.lampIntensity;
    });
  });
  return <>
    {/* TownSky owns background, fog and shared sun/moon illumination. */}
    {WORLD_LOCATIONS.map((place, index) => {
      const light = VENUE_LIGHTS[place.id];
      return light && <pointLight key={place.id} ref={node => { lights.current[index] = node; }} position={[place.x, light.y, place.z + light.dz]} color={light.color} intensity={light.intensity * 0.12} distance={light.distance} decay={2} />;
    })}
    {batches.map(batch => <Batch key={`${batch.kind}:${batch.material}`} {...batch} materials={materials} />)}
    <LightBalloons reducedMotion={reducedMotion} />
    {GAMES.map(game => <group key={game.id}>
      {!overview && width > 760 && <VenueLabel game={game} completed={completedIds.includes(game.id)} />}
      <mesh position={[game.door[0], 0.15, game.door[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.58, 0.7, 40]} /><meshBasicMaterial color={completedIds.includes(game.id) ? '#b1d3aa' : '#f3d49b'} transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
    </group>)}
  </>;
}
