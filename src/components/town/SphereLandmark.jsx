import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { SPHERE_LANDMARK } from '../../../shared/sphere-landmark.js';
import { sampleDayNight } from '../../../shared/dayNight.js';
import { createSphereLandmark, sampleSphereWall } from '../sphere/createSphereLandmark.js';
import { createSphereBubbles } from '../sphere/createSphereBubbles.js';

/** Shares the town Canvas; animation never inherits the 180-second daylight wrap. */
export default function SphereLandmark({ timeRef, lightTimeRef, reducedMotion = false, mode = 'auto', bubbleCue = 0, onSelect }) {
  const mount = useRef(), model = useRef(), bubbles = useRef();
  const bubbleClock = useRef({ cue: null, mode: null, start: 0, modeStart: 0 });
  useEffect(() => {
    const parent = mount.current;
    if (!parent) return undefined;
    const instance = createSphereLandmark(), atmosphere = createSphereBubbles();
    model.current = instance; bubbles.current = atmosphere; parent.add(instance.group, atmosphere.group);
    return () => { if (model.current === instance) model.current = null; bubbles.current = null; parent.remove(instance.group, atmosphere.group); instance.dispose(); atmosphere.dispose(); };
  }, []);
  useFrame(({ clock }) => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const time = clock.elapsedTime * 1000;
    const lightTime = lightTimeRef?.current ?? timeRef?.current ?? time;
    if (bubbleClock.current.cue !== bubbleCue || bubbleClock.current.mode !== mode) {
      const modeStart = bubbleClock.current.mode === mode ? bubbleClock.current.modeStart : time;
      bubbleClock.current = { cue: bubbleCue, mode, start: time, modeStart };
    }
    // Entering auto always starts its full smile scene, never a global-clock tail.
    const wallTime = mode === 'auto' ? Math.max(0, time - bubbleClock.current.modeStart) : time;
    const wall = sampleSphereWall(wallTime, { mode, reducedMotion });
    const faceOpacity = (wall.mode === 'smile' ? 1 - wall.blend : 0) + (wall.nextMode === 'smile' ? wall.blend : 0);
    if (faceOpacity > .01 && !bubbleClock.current.visible) bubbleClock.current.start = time;
    bubbleClock.current.visible = faceOpacity > .01;
    const night = sampleDayNight(lightTime).nightOpacity;
    const bubbleExpression = bubbles.current?.update(Math.max(0, time - bubbleClock.current.start), { opacity: faceOpacity, reducedMotion, night });
    model.current?.update(wallTime, { mode, reducedMotion, night, bubbleExpression });
  });
  const select = event => {
    if (!onSelect || event.button > 0 || !event.object?.userData.sphereLandmark) return;
    event.stopPropagation(); onSelect(SPHERE_LANDMARK.id);
  };
  return <group ref={mount} name="sphere-world-landmark" position={[SPHERE_LANDMARK.x, 0, SPHERE_LANDMARK.z]} onClick={select}/>;
}
