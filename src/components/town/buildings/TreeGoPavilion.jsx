import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { createTreeGoPavilion } from './createTreeGoPavilion.js';

/** Ground-centred scene ornament; world collision/placement belongs to town. */
export default function TreeGoPavilion({ position = [0, 0, 0], reducedMotion = false }) {
  const host = useRef();
  const asset = useRef();
  useLayoutEffect(() => {
    const parent = host.current;
    const pavilion = createTreeGoPavilion();
    asset.current = pavilion;
    parent.add(pavilion.group);
    return () => {
      parent.remove(pavilion.group);
      pavilion.dispose();
      if (asset.current === pavilion) asset.current = null;
    };
  }, []);
  useFrame((_, delta) => asset.current?.update(delta, reducedMotion));
  return <group ref={host} name="TreeGoPavilion" position={position} dispose={null} />;
}
