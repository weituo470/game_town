import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { sphereCameraShot } from './sphereCamera.js';

export default function SphereCamera({ orbit = false, reducedMotion = false }) {
  const start = useRef(null);
  useFrame(({ camera, clock }) => {
    if (!camera.isPerspectiveCamera) return;
    // The shared town clock wraps every three minutes. A personal camera rail
    // instead starts on its first perspective frame and follows monotonic time.
    const now = Number.isFinite(clock?.elapsedTime) ? clock.elapsedTime : start.current ?? 0;
    start.current ??= now;
    const shot = sphereCameraShot(camera.aspect, Math.max(0, now - start.current), orbit, reducedMotion);
    camera.position.set(...shot.position);
    camera.lookAt(...shot.target);
    if (camera.fov !== shot.fov || camera.near !== shot.near || camera.far !== shot.far || camera.zoom !== 1) {
      camera.fov = shot.fov; camera.near = shot.near; camera.far = shot.far; camera.zoom = 1;
      camera.clearViewOffset(); camera.updateProjectionMatrix();
    }
  });
  return null;
}
