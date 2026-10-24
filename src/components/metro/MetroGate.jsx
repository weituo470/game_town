import { lazy, Suspense, useRef, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { METRO_ISLAND } from '../../../shared/metro-island.js';
const MetroIsland = lazy(() => import('./MetroIsland.jsx'));

export default function MetroGate({ playerPoseRef, viewMode, onStatus, revision = 0, ...props }) {
  const [loaded, setLoaded] = useState(viewMode === 'metro');
  const elapsed = useRef(0);
  const onReady = useCallback(() => onStatus?.('ready'), [onStatus]);
  const onError = useCallback(() => onStatus?.('error'), [onStatus]);
  useFrame((_, dt) => {
    if (loaded) return;
    elapsed.current += dt;
    if (elapsed.current < .25 && viewMode !== 'metro') return;
    elapsed.current = 0;
    const p = playerPoseRef?.current;
    if (viewMode === 'metro' || p && Math.hypot(p.x - METRO_ISLAND.x, p.z - METRO_ISLAND.z) < 250) setLoaded(true);
  });
  return loaded ? <Suspense fallback={null}><MetroIsland key={revision} {...props} onReady={onReady} onError={onError}/></Suspense> : null;
}
