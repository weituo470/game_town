import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DEEPSEEK_PARK, PARK_SCALE, PARK_BRIDGES } from '../../../shared/deepseek-park.js';
import { WORLD_BOUNDS } from '../../../shared/world.js';
import { createDeepSeekPark } from '../deepseek/createDeepSeekPark.js';

const inside = (x, z, rect) => x >= rect.minX - 1e-8 && x <= rect.maxX + 1e-8 && z >= rect.minZ - 1e-8 && z <= rect.maxZ + 1e-8;

/** Render only the exposed union: no overlapping coplanar bridge tops at bends. */
export function deepSeekBridgePieces() {
  const rects = PARK_BRIDGES.map((rect, index) => ({
    minX: rect.x - rect.width / 2, maxX: rect.x + rect.width / 2,
    minZ: index === PARK_BRIDGES.length - 1 ? Math.max(rect.z - rect.depth / 2, DEEPSEEK_PARK.z + DEEPSEEK_PARK.radius) : rect.z - rect.depth / 2,
    maxZ: index === 0 ? Math.min(rect.z + rect.depth / 2, WORLD_BOUNDS.minZ) : rect.z + rect.depth / 2,
    horizontal: rect.width > rect.depth,
  }));
  const xs = [...new Set(rects.flatMap(rect => [rect.minX, rect.maxX]))].sort((a, b) => a - b);
  const zs = [...new Set(rects.flatMap(rect => [rect.minZ, rect.maxZ]))].sort((a, b) => a - b);
  const decks = [], rails = [], seams = [];
  for (let x = 0; x < xs.length - 1; x++) for (let z = 0; z < zs.length - 1; z++) {
    const cx = (xs[x] + xs[x + 1]) / 2, cz = (zs[z] + zs[z + 1]) / 2;
    if (rects.some(rect => inside(cx, cz, rect))) decks.push({ at: [cx, -.2, cz], size: [xs[x + 1] - xs[x], .4, zs[z + 1] - zs[z]] });
  }
  for (const rect of rects) {
    const from = rect.horizontal ? rect.minX : rect.minZ, to = rect.horizontal ? rect.maxX : rect.maxZ;
    for (const side of [-1, 1]) {
      const edge = rect.horizontal ? (side < 0 ? rect.minZ : rect.maxZ) : (side < 0 ? rect.minX : rect.maxX);
      let spans = [[from, to]];
      for (const other of rects) {
        if (other === rect || (rect.horizontal ? edge < other.minZ || edge > other.maxZ : edge < other.minX || edge > other.maxX)) continue;
        const low = (rect.horizontal ? other.minX : other.minZ) - .15, high = (rect.horizontal ? other.maxX : other.maxZ) + .15;
        spans = spans.flatMap(([a, b]) => high <= a || low >= b ? [[a, b]] : [[a, Math.max(a, low)], [Math.min(b, high), b]].filter(([left, right]) => right - left > .1));
      }
      for (const [a, b] of spans) {
        rails.push({ at: rect.horizontal ? [(a + b) / 2, .96, edge] : [edge, .96, (a + b) / 2], size: rect.horizontal ? [b - a, .12, .12] : [.12, .12, b - a] });
        const count = Math.max(1, Math.ceil((b - a) / 3));
        for (let i = 0; i <= count; i++) { const point = a + (b - a) * i / count; rails.push({ at: rect.horizontal ? [point, .45, edge] : [edge, .45, point], size: [.14, .9, .14] }); }
      }
    }
  }
  // Small joints belong to each disjoint deck tile, not a second full deck.
  for (const deck of decks) if (deck.size[0] > 2) {
    const count = Math.floor(deck.size[0] / 2);
    for (let i = 1; i <= count; i++) seams.push({ at: [deck.at[0] - deck.size[0] / 2 + i * deck.size[0] / (count + 1), .009, deck.at[2]], size: [.025, .018, deck.size[2]] });
  }
  return { decks, rails, seams };
}

function BridgeBatch({ pieces, color }) {
  const mesh = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    pieces.forEach((piece, index) => {
      dummy.position.set(...piece.at); dummy.scale.set(...piece.size); dummy.updateMatrix();
      mesh.current.setMatrixAt(index, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [pieces, dummy]);
  return <instancedMesh ref={mesh} args={[null, null, pieces.length]} receiveShadow>
    <boxGeometry args={[1, 1, 1]}/><meshStandardMaterial color={color} roughness={.8} metalness={.12}/>
  </instancedMesh>;
}
function DeepSeekBridges() {
  const pieces = useMemo(deepSeekBridgePieces, []);
  return <group name="deepseek-world-bridges">
    <BridgeBatch pieces={pieces.decks} color="#b3a18a"/>
    <BridgeBatch pieces={pieces.rails} color="#b2ab91"/>
    <BridgeBatch pieces={pieces.seams} color="#8e8270"/>
  </group>;
}

/**
 * inTown=true: shared waterfront transform, warm town paving and exposed bridge.
 * inTown=false: normalized source-local origin, scale 1, no bridge. The same
 * geometry powers the separate observation view; callers may override position/scale.
 * timeRef is milliseconds, matching the town clock. No private RAF or renderer.
 */
export default function DeepSeekPark({ timeRef, reducedMotion = false, inTown = true, paused = false, position, scale, onSelect, active = true, seed = 0x4453504b }) {
  const modelRoot = useRef(), model = useRef();
  const worldPosition = position ?? (inTown ? [DEEPSEEK_PARK.x, 0, DEEPSEEK_PARK.z] : [0, 0, 0]);
  const worldScale = Number.isFinite(scale) && scale > 0 ? scale : inTown ? PARK_SCALE : 1;
  useEffect(() => {
    const parent = modelRoot.current;
    if (!parent) return undefined;
    const park = createDeepSeekPark({ seed, townContext: inTown });
    model.current = park; parent.add(park.group);
    return () => { if (model.current === park) model.current = null; parent.remove(park.group); park.dispose(); };
  }, [seed, inTown]);
  useFrame(({ clock }) => {
    if (paused || document.hidden) return;
    model.current?.update(timeRef?.current ?? clock.elapsedTime * 1000, reducedMotion);
  });
  const inspect = event => {
    if (!active || !onSelect || event.button > 0) return;
    const spot = event.object?.userData.deepseekSpot;
    if (!spot) return;
    event.stopPropagation(); onSelect(spot);
  };
  return <group name="deepseek-park">
    {inTown && <DeepSeekBridges/>}
    <group ref={modelRoot} position={worldPosition} scale={worldScale} onClick={inspect}/>
  </group>;
}
