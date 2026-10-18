import { useEffect, useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { WONDERS } from '../../../shared/wonders.js';

function CarrierLoadingDeck() {
  const hull = useMemo(() => {
    const outline = new THREE.Shape();
    outline.moveTo(-7.7, 14); outline.lineTo(7.7, 14);
    outline.lineTo(7.8, -9); outline.lineTo(4.8, -14);
    outline.lineTo(0, -15); outline.lineTo(-4.8, -14);
    outline.lineTo(-7.8, -9); outline.closePath();
    return new THREE.ExtrudeGeometry(outline, { depth: 1.3, bevelEnabled: false, steps: 1 });
  }, []);
  useEffect(() => () => hull.dispose(), [hull]);
  return <group name="loading-carrier-footprint">
    {/* Exact authoritative walkable rectangle: x54..72, z5..35, top y=0. */}
    <mesh position={[63, -.11, 20]} receiveShadow raycast={() => null}>
      <boxGeometry args={[18, .22, 30]}/>
      <meshStandardMaterial color="#56636a" roughness={.85}/>
    </mesh>
    <mesh geometry={hull} position={[63, -.22, 20]} rotation={[Math.PI / 2, 0, 0]} receiveShadow raycast={() => null}>
      <meshStandardMaterial color="#3e4d55" roughness={.87}/>
    </mesh>
  </group>;
}

/** Synchronous Suspense fallback; disappears when the real on-site show mounts. */
export default function WonderLoading({ id }) {
  const wonder = WONDERS.find(item => item.id === id);
  if (!wonder) return null;
  return <group name={`wonder-loading-${id}`}>
    {id === 'carrier' && <CarrierLoadingDeck/>}
    <Html position={[wonder.x, id === 'rocket' ? 4 : 3, wonder.z]} center zIndexRange={[7, 0]} style={{ pointerEvents: 'none' }}>
      <span className="wonder-world-label" role="status" aria-live="polite" aria-label={`${wonder.name}：正在加载现场细节`} style={{ fontSize: 'var(--text-control, 1rem)' }}>
        正在加载现场细节
      </span>
    </Html>
  </group>;
}
