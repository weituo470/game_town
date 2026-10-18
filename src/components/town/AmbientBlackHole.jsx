import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { createAmbientBlackHoleRuntime } from './ambientBlackHoleRuntime.js';

export default function AmbientBlackHole({ enabled, timeRef, reducedMotion = false, onAppearance }) {
  const { scene, gl } = useThree();
  const runtime = useRef(null);
  const callback = useRef(onAppearance);
  const resumed = useRef(false);
  callback.current = onAppearance;
  useEffect(() => {
    const instance = createAmbientBlackHoleRuntime({ scene, gl, onAppearance: id => callback.current?.(id) });
    runtime.current = instance;
    const visibility = () => { resumed.current = true; };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      instance.dispose(); if (runtime.current === instance) runtime.current = null;
    };
  }, [scene, gl]);
  useFrame(({ camera, size }, delta) => {
    runtime.current?.frame({ delta: resumed.current ? 0 : delta, camera, size, reducedMotion, worldTimeMs: timeRef?.current ?? 0, enabled: enabled && !document.hidden });
    resumed.current = false;
  });
  return null;
}
