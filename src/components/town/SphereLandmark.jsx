import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { SPHERE_LANDMARK } from '../../../shared/sphere-landmark.js';
import { sampleDayNight } from '../../../shared/dayNight.js';
import { createSphereLandmark } from '../sphere/createSphereLandmark.js';

/** Shares the town Canvas; animation never inherits the 180-second daylight wrap. */
export default function SphereLandmark({ timeRef, lightTimeRef, reducedMotion = false, mode = 'auto', onSelect }) {
  const mount = useRef(), model = useRef();
  useEffect(() => {
    const parent = mount.current;
    if (!parent) return undefined;
    const instance = createSphereLandmark(); model.current = instance; parent.add(instance.group);
    return () => { if (model.current === instance) model.current = null; parent.remove(instance.group); instance.dispose(); };
  }, []);
  useFrame(({ clock }) => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const time = clock.elapsedTime * 1000;
    const lightTime = lightTimeRef?.current ?? timeRef?.current ?? time;
    model.current?.update(time, { mode, reducedMotion, night: sampleDayNight(lightTime).nightOpacity });
  });
  const select = event => {
    if (!onSelect || event.button > 0 || !event.object?.userData.sphereLandmark) return;
    event.stopPropagation(); onSelect(SPHERE_LANDMARK.id);
  };
  return <group ref={mount} name="sphere-world-landmark" position={[SPHERE_LANDMARK.x, 0, SPHERE_LANDMARK.z]} onClick={select}/>;
}
