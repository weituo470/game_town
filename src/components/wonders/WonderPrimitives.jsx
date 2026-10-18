import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// A real reflected scene, not a painted blue plane. Small waves perturb the
// reflection and sun highlight; Fresnel preserves the distant silver horizon.
const WATER_SHADER = {
  uniforms: { color: { value: new THREE.Color('#14535d') }, tDiffuse: { value: null }, textureMatrix: { value: new THREE.Matrix4() }, time: { value: 0 } },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 reflectionUV; varying vec3 world;
    void main(){vec4 w=modelMatrix*vec4(position,1.); world=w.xyz;
      reflectionUV=textureMatrix*vec4(position,1.); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 color; uniform float time;
    varying vec4 reflectionUV; varying vec3 world;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
    float waves(vec2 p,float detail){
      vec2 drift=vec2(time*.24,time*.13);
      float broad=noise(p*.11+drift*.3)*.8;
      float mid=noise(p*.37-drift*.55)*.19;
      float fine=noise(p*1.23+drift)*.045;
      return broad+mid+fine*detail;
    }
    void main(){
      vec2 p=world.xz;
      float detail=1./(1.+length(cameraPosition-world)*.006);
      float h=waves(p,detail);
      vec2 d=vec2(h-waves(p+vec2(.12,0.),detail),h-waves(p+vec2(0.,.12),detail))/.12;
      vec3 n=normalize(vec3(d.x,1.,d.y)); vec3 v=normalize(cameraPosition-world);
      float fres=.035+.965*pow(1.-max(dot(n,v),0.),5.);
      vec2 uv=reflectionUV.xy/reflectionUV.w+d*.045;
      vec3 reflected=texture2D(tDiffuse,clamp(uv,vec2(.002),vec2(.998))).rgb;
      vec3 sun=normalize(vec3(-.6,.45,-.8));
      float spec=pow(max(dot(reflect(-sun,n),v),0.),180.);
      vec3 water=color*(.6+.4*max(dot(n,sun),0.));
      vec3 result=mix(water,reflected*.85,clamp(fres+.04,0.,1.))+vec3(1.5,1.2,.75)*spec*2.;
      float foam=pow(max(0.,d.x+d.y-.16),3.)*1.8;
      result+=foam; gl_FragColor=vec4(result,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export function Ocean({ timeRef, reducedMotion = false, size = 2000, y = 0, color = '#144953' }) {
  const { size: viewport } = useThree();
  const water = useMemo(() => {
    const mesh = new Reflector(new THREE.PlaneGeometry(size, size), { color, shader: WATER_SHADER, textureWidth: viewport.width < 700 ? 512 : 1024, textureHeight: 512, clipBias: .003, multisample: 0 });
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = y;
    return mesh;
  }, [size, y, color]);
  useEffect(() => () => { water.geometry.dispose(); water.dispose(); }, [water]);
  useFrame(() => { water.material.uniforms.time.value = reducedMotion ? 0 : timeRef?.current ?? 0; });
  return <primitive object={water} />;
}

export function CinemaEffects({ quality }) {
  const { gl, scene, camera, size } = useThree();
  const pipeline = useRef(null);
  useEffect(() => {
    if (quality === 'balanced' || !gl.extensions.has('EXT_color_buffer_float')) return;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Math.min(2, gl.capabilities.maxSamples) });
    const composer = new EffectComposer(gl, target);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .22, .45, 1.2);
    const output = new OutputPass();
    composer.addPass(new RenderPass(scene, camera)); composer.addPass(bloom); composer.addPass(output);
    pipeline.current = composer;
    return () => { pipeline.current = null; bloom.dispose(); output.dispose(); composer.dispose(); };
  }, [gl, scene, camera, quality]);
  useEffect(() => { pipeline.current?.setPixelRatio(Math.min(gl.getPixelRatio(), 1.5)); pipeline.current?.setSize(size.width, size.height); }, [size, quality, gl]);
  useFrame((_, delta) => { if (pipeline.current) pipeline.current.render(delta); else gl.render(scene, camera); }, 1);
  return null;
}
