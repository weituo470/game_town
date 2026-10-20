import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { offshoreCameraShot } from './offshoreCamera.js';

export default function OffshoreCamera({ runtimeRef, view = 'director', reducedMotion = false }) {
  const start = useRef(null);
  useFrame(({ camera, clock }) => {
    if (!camera.isPerspectiveCamera) return;
    const now = Number.isFinite(clock?.elapsedTime) ? clock.elapsedTime : start.current ?? 0;
    start.current ??= now;
    const shot = offshoreCameraShot(camera.aspect, runtimeRef?.current?.sample, Math.max(0, now - start.current), view, reducedMotion);
    camera.position.set(...shot.position); camera.lookAt(...shot.target);
    if (camera.fov !== shot.fov || camera.near !== shot.near || camera.far !== shot.far || camera.zoom !== 1 || camera.view?.enabled) {
      camera.fov = shot.fov; camera.near = shot.near; camera.far = shot.far; camera.zoom = 1;
      camera.clearViewOffset(); camera.updateProjectionMatrix();
    }
  });
  return null;
}
