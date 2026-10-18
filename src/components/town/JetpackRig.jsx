import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { jetpackVisualState } from './jetpackVisual.js';

// Mounted inside each avatar, including the local fallback/generated actor.
export default function JetpackRig({ poseRef, reducedMotion }) {
  const rig = useRef(), jets = useRef();
  const initial = jetpackVisualState(poseRef.current);
  useFrame(({ clock }) => {
    const visual = jetpackVisualState(poseRef.current);
    if (rig.current) rig.current.visible = visual.equipped;
    if (jets.current) {
      jets.current.visible = visual.firing;
      // A softer sustained plume holds the hover, without adding vertical force.
      const power = visual.hovering ? 0.7 : 1;
      jets.current.scale.y = power * (reducedMotion ? 1 : 0.85 + Math.sin(clock.elapsedTime * 35) * 0.13);
    }
  });
  return <group ref={rig} visible={initial.equipped}>
    <mesh position={[0, 1.08, -0.36]} castShadow><boxGeometry args={[0.82, 0.72, 0.32]}/><meshStandardMaterial color="#607d8e" metalness={0.45} roughness={0.4}/></mesh>
    {[-0.32, 0.32].map(x => <group key={x} position={[x, 0.98, -0.48]}>
      <mesh castShadow><capsuleGeometry args={[0.19, 0.62, 4, 12]}/><meshStandardMaterial color="#c4c9d5" metalness={0.6} roughness={0.3}/></mesh>
      <mesh position={[0, -0.42, 0]}><cylinderGeometry args={[0.15, 0.2, 0.2, 12]}/><meshStandardMaterial color="#344455" metalness={0.7}/></mesh>
      <mesh position={[0, 0.06, -0.17]}><boxGeometry args={[0.23, 0.22, 0.03]}/><meshStandardMaterial color="#8ddde2" emissive="#5cc4d3" emissiveIntensity={0.6}/></mesh>
    </group>)}
    <group ref={jets} visible={initial.firing}>{[-0.32, 0.32].map(x => <group key={x} position={[x, 0.13, -0.48]}>
      <mesh rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.14, 0.85, 12]}/><meshBasicMaterial color="#69d9f7" transparent opacity={0.85}/></mesh>
      <mesh position={[0, 0.1, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.08, 0.5, 12]}/><meshBasicMaterial color="#fff1d6"/></mesh>
    </group>)}</group>
  </group>;
}
