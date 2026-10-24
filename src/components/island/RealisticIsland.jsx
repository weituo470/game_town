import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { createRealisticIslandVisual } from './realisticIslandVisual.js';

/** The parent lazy-loads this landmark inside the existing continuous Canvas. */
export default function RealisticIsland({ quality = 'high', reducedMotion = false, timeRef, onSelect }) {
  const mount = useRef(), visual = useRef();
  useEffect(() => {
    const parent = mount.current, model = createRealisticIslandVisual({ quality });
    visual.current = model; parent.add(model.group);
    return () => { visual.current = null; parent.remove(model.group); model.dispose(); };
  }, [quality]);
  useFrame(({ clock }) => visual.current?.update(timeRef?.current ?? clock.elapsedTime * 1000, { reducedMotion }));
  return <group ref={mount} name="realistic-island-world-landmark" onClick={event => {
    if (!onSelect || event.button > 0) return;
    event.stopPropagation(); onSelect();
  }}/>;
}
