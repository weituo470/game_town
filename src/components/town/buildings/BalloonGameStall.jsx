import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { createBalloonGameStall } from './createBalloonGameStall.js';

/** Ground-centred decoration; placement and collision are owned by the town. */
export default function BalloonGameStall({ position = [0, 0, 0], reducedMotion = false }) {
  const host = useRef();
  const asset = useRef();
  useLayoutEffect(() => {
    const parent = host.current;
    const stall = createBalloonGameStall();
    asset.current = stall;
    parent.add(stall.group);
    return () => {
      parent.remove(stall.group);
      stall.dispose();
      if (asset.current === stall) asset.current = null;
    };
  }, []);
  useFrame((_, delta) => asset.current?.update(delta, reducedMotion));
  return <group ref={host} name="BalloonGameStall" position={position} dispose={null} />;
}
