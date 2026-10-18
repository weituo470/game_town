import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { createPurpleTicketBooth } from './createPurpleTicketBooth.js';

export default function PurpleTicketBooth({ position = [0, 0, 0], reducedMotion = false }) {
  const host = useRef();
  const asset = useRef();
  useLayoutEffect(() => {
    const parent = host.current;
    const booth = createPurpleTicketBooth();
    asset.current = booth;
    parent.add(booth.group);
    return () => {
      parent.remove(booth.group);
      booth.dispose();
      if (asset.current === booth) asset.current = null;
    };
  }, []);
  useFrame((_, delta) => asset.current?.update(delta, reducedMotion));
  return <group ref={host} name="PurpleTicketBooth" position={position} dispose={null} />;
}
