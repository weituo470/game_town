import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { createLandmarkFountain } from './createLandmarkFountain.js';

/** Ground-centred landmark. Collision and plaza belong to the parent town. */
export default function LandmarkFountain({ position = [0, 0, 2], reducedMotion = false }) {
  const host = useRef();
  const asset = useRef();

  // Allocate only after commit: a discarded StrictMode render owns no GPU assets.
  // StrictMode's setup -> cleanup -> setup creates a fresh, independent asset.
  useLayoutEffect(() => {
    const parent = host.current;
    const fountain = createLandmarkFountain();
    asset.current = fountain;
    parent.add(fountain.group);
    return () => {
      parent.remove(fountain.group);
      fountain.dispose();
      if (asset.current === fountain) asset.current = null;
    };
  }, []);

  useFrame((_, delta) => asset.current?.update(delta, reducedMotion));

  // The factory owns all descendants and their cleanup, not R3F's reconciler.
  return <group ref={host} name="LandmarkFountain" position={position} dispose={null} />;
}
