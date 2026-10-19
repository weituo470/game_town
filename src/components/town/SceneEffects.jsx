import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SAOPass } from 'three/addons/postprocessing/SAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { sampleDayNight } from '../../../shared/dayNight.js';
import { notifyDroneVideoFrame } from '../../lib/droneVideoFrame.js';
import { createFrameBudget, sampleFrameBudget, sceneRenderProfile, setSceneRenderRatio } from '../drone/dronePerformance.js';

// All effects use the installed Three renderer. No second canvas, remote assets,
// replacement game loop, or changes to the authoritative simulation are needed.
export class HalfResolutionAO extends SAOPass {
  setSize(width, height) { super.setSize(Math.ceil(width / 2), Math.ceil(height / 2)); }
  render(renderer, writeBuffer, readBuffer, ...rest) {
    // SAOPass updates near/far on every render, but snapshots the inverse
    // projection only on construction/resize. Free-flight changes far and view
    // switches change FOV without resizing: keep depth reconstruction in sync.
    this.saoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);
    const hidden = [];
    this.scene.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (object.visible && (object.userData?.isSky || materials.some(material => material?.transparent))) {
        hidden.push(object);
        object.visible = false;
      }
    });
    try { super.render(renderer, writeBuffer, readBuffer, ...rest); }
    finally { hidden.forEach(object => { object.visible = true; }); }
  }
}

export function GardenFireflies({ reducedMotion, timeRef }) {
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

export default function SceneEffects({ performanceMode = 'town', faithfulBlackHole = false }) {
  const { gl, scene, camera, size, invalidate } = useThree();
  const pipeline = useRef(null);
  const shadowElapsed = useRef(0);
  const latestSize = useRef(size);
  latestSize.current = size;

  useEffect(() => {
    if (performanceMode !== 'drone') return undefined;
    // The spectator's night lighting is static. Retain the town's shadows but
    // refresh their geometry once a second rather than on all 60 render frames.
    const previousAutoUpdate = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    shadowElapsed.current = 0;
    gl.domElement.dataset.shadowUpdateHz = '1';
    return () => {
      gl.shadowMap.autoUpdate = previousAutoUpdate;
      gl.shadowMap.needsUpdate = true;
      delete gl.domElement.dataset.shadowUpdateHz;
    };
  }, [gl, performanceMode]);

  useEffect(() => {
    const previousToneMapping = gl.toneMapping;
    const previousExposure = gl.toneMappingExposure;
    const previousInfoAutoReset = gl.info.autoReset;
    // The website's original black-hole compositor already produces its final
    // light and colours. A second ACES curve or bloom would change the source
    // look. Its presentation shader decodes sRGB for this neutral OutputPass.
    gl.toneMapping = faithfulBlackHole ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.08;
    gl.info.autoReset = false;
    const restoreEnvironment = () => {
      gl.toneMapping = previousToneMapping;
      gl.toneMappingExposure = previousExposure;
      gl.info.autoReset = previousInfoAutoReset;
      setSceneRenderRatio(gl, null);
    };
    // Some WebGL2 devices cannot render to HDR buffers. Keep the playable
    // shaded scene rather than constructing an incomplete framebuffer.
    if (!gl.extensions.has('EXT_color_buffer_float')) {
      gl.domElement.dataset.visualQuality = 'standard';
      gl.domElement.dataset.effectsDpr = String(gl.getPixelRatio());
      gl.domElement.dataset.ambientOcclusion = 'off';
      invalidate();
      return restoreEnvironment;
    }
    const initialProfile = sceneRenderProfile({ mode: performanceMode, maxSamples: gl.capabilities.maxSamples });
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: initialProfile.samples });
    const composer = new EffectComposer(gl, target);
    const render = new RenderPass(scene, camera);
    // Do not even allocate depth/normal/AO framebuffers for the sky show.
    // Its transparent emitters never needed AO; the original town still does.
    const ao = performanceMode === 'drone' ? null : new HalfResolutionAO(scene, camera);
    if (ao) Object.assign(ao.params, {
      saoBias: 0.6, saoIntensity: 0.022, saoScale: 6,
      saoKernelRadius: 28, saoMinResolution: 0.001,
      saoBlurRadius: 4, saoBlurStdDev: 2, saoBlurDepthCutoff: 0.015,
    });
    const bloom = faithfulBlackHole ? null : new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.55, 1.12);
    const output = new OutputPass();
    [render, ao, bloom, output].filter(Boolean).forEach(pass => composer.addPass(pass));
    const state = { composer, ao, bloom, budget: createFrameBudget(performanceMode) };
    pipeline.current = state;
    const resize = () => {
      const dimensions = latestSize.current;
      const profile = sceneRenderProfile({ mode: performanceMode, width: dimensions.width, pixelRatio: gl.getPixelRatio(), stage: state.budget.stage });
      composer.setPixelRatio(profile.pixelRatio);
      composer.setSize(dimensions.width, dimensions.height);
      setSceneRenderRatio(gl, profile.pixelRatio);
      if (ao) ao.enabled = profile.ao;
      gl.domElement.dataset.visualQuality = profile.quality;
      gl.domElement.dataset.effectsDpr = String(profile.pixelRatio);
      gl.domElement.dataset.ambientOcclusion = profile.ao ? 'on' : 'off';
      gl.domElement.dataset.effectsMsaa = String(initialProfile.samples);
    };
    state.resize = resize;
    resize();
    const restore = () => { resize(); invalidate(); };
    gl.domElement.addEventListener('webglcontextrestored', restore);
    invalidate();
    return () => {
      gl.domElement.removeEventListener('webglcontextrestored', restore);
      pipeline.current = null;
      [ao, bloom, output].filter(Boolean).forEach(pass => pass.dispose());
      composer.dispose();
      restoreEnvironment();
    };
  }, [gl, scene, camera, invalidate, performanceMode, faithfulBlackHole]);

  useEffect(() => { pipeline.current?.resize(); invalidate(); }, [size.width, size.height, invalidate]);

  useFrame((_, delta) => {
    if (performanceMode === 'drone') {
      shadowElapsed.current += Math.min(Math.max(delta, 0), 1);
      if (shadowElapsed.current >= 1) {
        gl.shadowMap.needsUpdate = true;
        shadowElapsed.current = 0;
      }
    }
    const state = pipeline.current;
    gl.info.reset();
    if (!state) { gl.render(scene, camera); notifyDroneVideoFrame(gl.domElement); return; }
    state.composer.render(delta);
    notifyDroneVideoFrame(gl.domElement);
    // The budget changes only after sustained slow frames, never on a single
    // seek / shader compile. DOM typography and all 4096 identities stay intact.
    const sample = sampleFrameBudget(state.budget, delta, document.hidden);
    if (sample) {
      gl.domElement.dataset.renderFps = String(Math.round(sample.fps));
      gl.domElement.dataset.renderCalls = String(gl.info.render.calls);
      gl.domElement.dataset.renderTriangles = String(gl.info.render.triangles);
      if (sample.changed) state.resize();
    }
  }, 1);

  return null;
}
