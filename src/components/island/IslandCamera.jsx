import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import SpectatorOrbit from '../drone/SpectatorOrbit.jsx';
import { sampleIslandCamera, islandCameraFloor } from './islandCamera.js';

export default function IslandCamera({ shot = 'aerial' }) {
  const poseRef = useRef(null);
  const canvasRef = useRef(null);
  useEffect(() => () => { if (canvasRef.current) delete canvasRef.current.dataset.islandCamera; }, []);
  useFrame(({ camera, size }) => {
    if (!camera.isPerspectiveCamera) return;
    const pose = sampleIslandCamera(shot, size.width / Math.max(1, size.height));
    poseRef.current = pose;
    if (camera.fov !== pose.fov || camera.far !== pose.far) {
      camera.fov = pose.fov; camera.far = pose.far; camera.near = pose.near; camera.updateProjectionMatrix();
    }
    camera.position.set(...pose.position); camera.lookAt(...pose.target);
  }, -.1);
  useFrame(({ camera, gl }) => {
    if (!camera.isPerspectiveCamera || !poseRef.current) return;
    canvasRef.current = gl.domElement;
    camera.position.y = islandCameraFloor(camera.position.toArray());
    camera.lookAt(...poseRef.current.target); camera.updateMatrixWorld();
    gl.domElement.dataset.islandCamera = JSON.stringify({ shot, position: camera.position.toArray() });
  }, -.08);
  return <SpectatorOrbit key={shot} poseRef={poseRef} program={`island-${shot}`} />;
}
