import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleDayNight } from '../../../shared/dayNight.js';
import { LAGOON_WATER, LAGOON_WAVE_GLSL, createLagoonWaterState, sampleLagoonWater } from '../../../shared/lagoonWater.js';

const lagoonVertex = `
  varying vec3 world, waveNormal; varying float waveHeight;
  ${LAGOON_WAVE_GLSL}
  void main(){
    vec4 p=modelMatrix*vec4(position,1.);vec2 q=p.xz;
    waveHeight=waterHeight(q);p.y+=waveHeight;
    float stepSize=${LAGOON_WATER.normalStep};
    float dx=(waterHeight(q+vec2(stepSize,0.))-waterHeight(q-vec2(stepSize,0.)))/(2.*stepSize);
    float dz=(waterHeight(q+vec2(0.,stepSize))-waterHeight(q-vec2(0.,stepSize)))/(2.*stepSize);
    waveNormal=normalize(vec3(-dx,1.,-dz));world=p.xyz;
    gl_Position=projectionMatrix*viewMatrix*p;
  }`;

const lagoonFragment = `
  uniform float time,daylight;uniform vec3 deep,shallow,sun;
  varying vec3 world,waveNormal;varying float waveHeight;
  void main(){
    vec2 p=world.xz-vec2(-64.,19.);
    float radius=clamp(length(p/vec2(8.45,7.45)),0.,1.);
    vec3 n=normalize(waveNormal),v=normalize(cameraPosition-world),reflected=reflect(-v,n);
    float fresnel=pow(1.-clamp(dot(n,v),0.,1.),2.7);
    vec3 sky=mix(vec3(.055,.085,.17),vec3(.36,.61,.76),daylight);
    sky=mix(sky,vec3(.72,.83,.85)*(.18+.82*daylight),pow(1.-abs(reflected.y),3.)*.55);
    float shimmer=pow(max(0.,dot(reflect(-normalize(sun),n),v)),170.);
    float broad=pow(max(0.,dot(reflect(-normalize(sun),n),v)),22.);
    float caustic=pow(.5+.5*sin(p.x*1.35+sin(p.y*1.1-time*.4)+time*.35),8.)
      *pow(.5+.5*sin(p.y*1.7-p.x*.4-time*.45),4.);
    vec3 water=mix(deep,shallow,.16+.53*radius*radius)*(.28+.72*daylight);
    water+=vec3(.10,.18,.14)*caustic*(.2+.8*daylight);
    vec3 col=mix(water,sky,.12+fresnel*.58);
    // Keep glints below the town bloom threshold; a sun-facing lagoon must
    // retain blue-green depth rather than turn into a white luminous disk.
    col+=vec3(1.,.88,.68)*shimmer*(.04+.26*daylight);
    col+=vec3(.28,.44,.48)*broad*(.045+.11*daylight);
    // White water is a transient steep crest, not a flat circle decal.
    float crest=smoothstep(.035,.105,waveHeight)*(1.-smoothstep(.86,1.,radius));
    col=mix(col,vec3(.71,.88,.86)*(.4+.6*daylight),crest*.46);
    gl_FragColor=vec4(col,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Shared water uses TownSky's day/night state, with no independent environment.
export default function TownWater({ timeRef, lightTimeRef = timeRef, reducedMotion, pool = false }) {
  const material = useRef();
  const lagoon = useMemo(() => pool ? createLagoonWaterState() : null, [pool]);
  const uniforms = useMemo(() => ({ time: { value: 0 }, daylight: { value: 1 }, sun: { value: new THREE.Vector3(.36,.52,-.82).normalize() }, deep: { value: new THREE.Color(pool ? '#176f79' : '#245e70') }, shallow: { value: new THREE.Color(pool ? '#69b2ad' : '#6ca3ad') }, ...(pool ? { motion: { value: 1 }, whales: { value: Array.from({ length: 2 }, () => new THREE.Vector4()) }, impacts: { value: Array.from({ length: LAGOON_WATER.impactSlots }, () => new THREE.Vector4(0, 0, 99, 0)) } } : {}) }), [pool]);
  useFrame(() => {
    if (!material.current) return;
    const sky=sampleDayNight(lightTimeRef?.current??0),u=material.current.uniforms;
    u.time.value=reducedMotion?0:(timeRef?.current??0)/1000;u.daylight.value=sky.daylight;
    u.sun.value.set(...(sky.daylight>.1?sky.sunDirection:sky.moonDirection));
    if (pool) {
      sampleLagoonWater(timeRef?.current??0, reducedMotion, lagoon);
      u.time.value=lagoon.time;u.motion.value=lagoon.motion;
      for(let i=0;i<2;i++)u.whales.value[i].fromArray(lagoon.whales[i]);
      for(let i=0;i<LAGOON_WATER.impactSlots;i++)u.impacts.value[i].fromArray(lagoon.impacts[i]);
    }
  });
  return <mesh name={pool?'town-lagoon-water':'shared-town-sea'} position={pool?[-64,-.025,19]:[0,-1.28,-16]} rotation={[-Math.PI/2,0,0]} scale={pool?[8.45,7.45,1]:[1,1,1]} raycast={()=>null}>
    {/* The distant footsteps camera travels west of the original 900m sea.
        Extending this single two-triangle surface avoids a visible square edge. */}
    {pool?<ringGeometry args={[0,1,LAGOON_WATER.segments,LAGOON_WATER.rings]}/>:<planeGeometry args={[3000,3000]}/>}
    <shaderMaterial ref={material} uniforms={uniforms} side={THREE.DoubleSide}
      vertexShader={pool?lagoonVertex:`varying vec3 world;void main(){vec4 p=modelMatrix*vec4(position,1.);world=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`}
      fragmentShader={pool?lagoonFragment:`
        uniform float time,daylight; uniform vec3 deep,shallow,sun; varying vec3 world;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
        float height(vec2 p){return noise(p*.35+vec2(time*.05,0.))*.65+noise(p*1.4+vec2(-time*.11,time*.06))*.24+noise(p*4.-time*.12)*.06;}
        void main(){vec2 p=world.xz;float h=height(p);float dx=height(p+vec2(.09,0))-h,dz=height(p+vec2(0,.09))-h;
          vec3 n=normalize(vec3(-dx*1.6,.22,-dz*1.6)),v=normalize(cameraPosition-world);
          float fresnel=pow(1.-clamp(dot(n,v),0.,1.),3.),sparkle=pow(max(0.,dot(reflect(-normalize(sun),n),v)),85.);
          vec3 sky=mix(vec3(.06,.10,.19),vec3(.48,.69,.79),daylight),water=mix(deep,shallow,clamp(h*.58,0.,1.))*(.28+.72*daylight);
          vec3 col=mix(water,sky,fresnel*.65)+sparkle*vec3(1.,.83,.57)*(.07+.40*daylight);
          col+=vec3(.08,.12,.11)*smoothstep(.64,.79,h)*(.25+.75*daylight);gl_FragColor=vec4(col,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`}/>
  </mesh>;
}
