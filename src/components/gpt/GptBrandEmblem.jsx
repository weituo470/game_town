import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { appUrl } from '../../lib/appUrl.js';

// Official, unmodified white SVG from openai/openai-agents-python.
// Its square viewBox and original clear space are preserved on a neutral black sign.
export default function GptBrandEmblem({ size = 6, position = [0, 0, 0], rotation = [0, 0, 0] }) {
  const logo = useLoader(THREE.TextureLoader, appUrl('/gpt/openai-blossom.svg'));
  logo.colorSpace = THREE.SRGBColorSpace;
  return <group position={position} rotation={rotation} name="official-openai-emblem">
    <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[size * .55, size * .55, .24, 96]}/><meshStandardMaterial color="#080909" metalness={.42} roughness={.3}/></mesh>
    <mesh position={[0, 0, .13]}><circleGeometry args={[size * .55, 96]}/><meshBasicMaterial color="#050505" toneMapped={false}/></mesh>
    <mesh position={[0, 0, .14]}><planeGeometry args={[size, size]}/><meshBasicMaterial map={logo} transparent toneMapped={false} depthWrite={false}/></mesh>
  </group>;
}
