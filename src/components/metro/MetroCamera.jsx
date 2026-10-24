import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import SpectatorOrbit from '../drone/SpectatorOrbit.jsx';
import { sampleMetroCamera, metroCameraFloor } from './metroCamera.js';

export default function MetroCamera({ shot = 'skyline' }) {
  const poseRef = useRef(null), canvasRef = useRef(null);
  useEffect(() => () => { if (canvasRef.current) delete canvasRef.current.dataset.metroCamera; }, []);
  useFrame(({ camera, size }) => {
    if (!camera.isPerspectiveCamera) return;
    const pose = sampleMetroCamera(shot, size.width / Math.max(1, size.height));
    poseRef.current = pose;
    if (camera.fov !== pose.fov || camera.far !== pose.far) {
      camera.fov = pose.fov; camera.far = pose.far; camera.near = pose.near; camera.updateProjectionMatrix();
    }
    camera.position.set(...pose.position); camera.lookAt(...pose.target);
  }, -.1);
  useFrame(({ camera, gl }) => {
    if (!camera.isPerspectiveCamera || !poseRef.current) return;
    canvasRef.current = gl.domElement;
    camera.position.y = metroCameraFloor(camera.position.toArray());
    camera.lookAt(...poseRef.current.target); camera.updateMatrixWorld();
    gl.domElement.dataset.metroCamera = JSON.stringify({ shot, position: camera.position.toArray() });
  }, -.08);
  return <SpectatorOrbit key={shot} poseRef={poseRef} program={`metro-${shot}`}/>;
}
