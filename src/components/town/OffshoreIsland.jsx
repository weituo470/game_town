import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { sampleDayNight } from '../../../shared/dayNight.js';
import { createOffshoreIsland, createOffshoreDock } from '../offshore/createOffshoreIsland.js';

/** One moving ship and one fixed dock inside the existing town Canvas. */
export default function OffshoreIsland({ offshoreRef, lightTimeRef, reducedMotion = false, onSelect }) {
  const mount = useRef(), ship = useRef(), dock = useRef();
  useEffect(() => {
    const parent = mount.current;
    const vessel = createOffshoreIsland(), harbour = createOffshoreDock();
    ship.current = vessel; dock.current = harbour;
    parent.add(vessel.group, harbour.group);
    return () => {
      ship.current = null; dock.current = null;
      parent.remove(vessel.group, harbour.group);
      vessel.dispose(); harbour.dispose();
    };
  }, []);
  useFrame(({ clock }) => {
    const runtime = offshoreRef?.current;
    if (!runtime || !ship.current) return;
    const { sample } = runtime;
    ship.current.group.position.set(sample.x, sample.y, sample.z);
    ship.current.group.rotation.set(sample.pitch, sample.yaw, sample.roll, 'XYZ');
    const options = { speed: sample.moving ? 1 : 0, progress: sample.progress,
      stationary: !sample.moving, reducedMotion, night: sampleDayNight(lightTimeRef?.current ?? 0).nightOpacity };
    ship.current.update(clock.elapsedTime * 1000, options);
    dock.current?.update(clock.elapsedTime * 1000, options);
  });
  return <group ref={mount} name="offshore-world-landmark" onClick={event => {
    if (!onSelect || event.button > 0) return;
    event.stopPropagation(); onSelect();
  }}/>;
}
