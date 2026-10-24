import { lazy, Suspense, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { REALISTIC_ISLAND } from '../../../shared/realistic-island.js';
const RealisticIsland = lazy(() => import('./RealisticIsland.jsx'));

export default function IslandGate({ playerPoseRef, viewMode, ...props }) {
  const [loaded, setLoaded] = useState(viewMode === 'island');
  const elapsed = useRef(0);
  useFrame((_, dt) => {
    if (loaded) return;
    elapsed.current += dt;
    if (elapsed.current < .25 && viewMode !== 'island') return;
    elapsed.current = 0;
    const p = playerPoseRef?.current;
    if (viewMode === 'island' || p && Math.hypot(p.x - REALISTIC_ISLAND.x, p.z - REALISTIC_ISLAND.z) < 210) setLoaded(true);
  });
  return loaded ? <Suspense fallback={null}><RealisticIsland {...props}/></Suspense> : null;
}
