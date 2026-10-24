import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { appUrl } from '../../lib/appUrl.js';
import { createMetroIslandRuntime } from './metroTraffic.js';
import assetMetadata from '../../../shared/metro-asset.json' with { type: 'json' };

// One reusable asset promise. A failed fetch is evicted so the island's own retry
// control can recover; exceptions never unmount the existing town Canvas.
let cachedAsset;
function loadCity() {
  if (!cachedAsset) cachedAsset = new GLTFLoader().loadAsync(appUrl(`/metro-island/city.glb?v=${assetMetadata.revision}`)).catch(error => {
    cachedAsset = null; throw error;
  });
  return cachedAsset;
}

export default function MetroIsland({ timeRef, motionTimeRef, reducedMotion = false, quality = 'high', onReady, onError }) {
  const mount = useRef(), runtime = useRef(), callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  useEffect(() => {
    let cancelled = false, model;
    loadCity().then(asset => {
      if (cancelled || !mount.current) return;
      model = createMetroIslandRuntime(asset.scene);
      runtime.current = model; mount.current.add(model.group);
      callbacks.current.onReady?.();
    }).catch(error => {
      if (!cancelled) callbacks.current.onError?.(error);
    });
    return () => {
      cancelled = true; runtime.current = null;
      if (model) { mount.current?.remove(model.group); model.dispose(); }
    };
  }, []);
  useFrame(({ clock }) => runtime.current?.update(timeRef?.current ?? 0, {
    // Lighting preview can freeze world time at noon. Car choreography must not.
    seconds: Number.isFinite(motionTimeRef?.current) ? motionTimeRef.current / 1000 : clock.elapsedTime,
    reducedMotion,
  }));
  return <group ref={mount} name="metro-island-lazy-asset-mount" userData={{ quality }}/>;
}
