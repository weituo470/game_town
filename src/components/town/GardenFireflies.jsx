import {useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {sampleDayNight} from '../../../shared/dayNight.js';
export default function GardenFireflies({ reducedMotion, timeRef }) {
  const material = useRef();
  const points = useRef();
  const positions = useMemo(() => {
    const result = [];
    for (let i = 0; i < 28; i++) {
      const side = i % 2 ? 1 : -1;
      result.push(side * (10.8 + Math.sin(i * 6.3) * 2.3), 0.9 + (i % 7) * 0.43, Math.sin(i * 2.4) * 11.8);
    }
    return new Float32Array(result);
  }, []);
  const uniforms = useMemo(() => ({ time: { value: 0 }, pixelRatio: { value: 1 }, nightOpacity: { value: 0 } }), []);
  useFrame(({ clock, gl }) => {
    if (!material.current) return;
    material.current.uniforms.time.value = reducedMotion ? 0 : clock.elapsedTime;
    material.current.uniforms.pixelRatio.value = gl.getPixelRatio();
    material.current.uniforms.nightOpacity.value = sampleDayNight(timeRef?.current ?? 0).nightOpacity;
    if (points.current) points.current.visible = material.current.uniforms.nightOpacity.value > 0.01;
  });
  return <points ref={points} frustumCulled={false}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
    <shaderMaterial ref={material} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending}
      vertexShader={`
        uniform float time; uniform float pixelRatio; varying float glow;
        void main() {
          vec3 p = position;
          float phase = position.x * 1.7 + position.z;
          p.x += sin(time * .23 + phase) * .3;
          p.y += sin(time * .42 + phase) * .24;
          glow = .45 + .35 * sin(time * .7 + phase);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
          gl_PointSize = (3. + glow * 3.) * pixelRatio;
        }`}
      fragmentShader={`
        varying float glow; uniform float nightOpacity;
        void main() {
          float d = length(gl_PointCoord - .5) * 2.;
          float alpha = pow(max(0., 1. - d), 2.) * glow * nightOpacity;
          gl_FragColor = vec4(2.2, 1.65, .65, alpha);
        }`} />
  </points>;
}

