import { lazy, Suspense, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { PIXEL_ISLAND } from '../../../shared/pixel-island.js';

const PixelIsland = lazy(() => import('./PixelIsland.jsx'));

/** No voxel buffers, textures or controller are parsed for the first town frame. */
export default function PixelGate({ playerPoseRef, viewMode, runtimeRef, onReady, reducedMotion }) {
  const [loaded, setLoaded] = useState(viewMode === 'pixel');
  const elapsed = useRef(0);
  useFrame((_, dt) => {
    if (loaded) return;
    elapsed.current += dt;
    if (elapsed.current < .3 && viewMode !== 'pixel') return;
    elapsed.current = 0;
    const p = playerPoseRef?.current;
    if (viewMode === 'pixel' || p && Math.hypot(p.x - PIXEL_ISLAND.x, p.z - PIXEL_ISLAND.z) < 125) setLoaded(true);
  });
  return loaded ? <Suspense fallback={null}><PixelIsland runtimeRef={runtimeRef} onReady={onReady} active={viewMode === 'pixel'} reducedMotion={reducedMotion}/></Suspense> : null;
}
