import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { createCarrierBattleVisual } from './carrierBattleGeometry.js';

const ZERO_TIME = Object.freeze({ current: 0 });

/** The existing town owns camera, carrier, ocean and absolute programme clock. */
export default function CarrierBattleScene({ timeRef = ZERO_TIME, reducedMotion = false }) {
  const host = useRef(null), visual = useRef(null);
  useLayoutEffect(() => {
    const parent = host.current;
    const asset = createCarrierBattleVisual();
    visual.current = asset;
    parent.add(asset.group);
    return () => {
      parent.remove(asset.group);
      asset.dispose();
      if (visual.current === asset) visual.current = null;
    };
  }, []);
  useFrame(() => { visual.current?.update(timeRef.current, reducedMotion); }, -.2);
  return <group ref={host} name="CarrierBattleScene" dispose={null}/>;
}
