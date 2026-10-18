import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { WONDERS, WONDER_BRIDGES } from '../../../shared/wonders.js';
import { sampleDayNight } from '../../../shared/dayNight.js';
import TownWater from './TownWater.jsx';
import WonderLoading from './WonderLoading.jsx';

const TownOrcaShow = React.lazy(() => import('../wonders/OrcaExperience.jsx').then(m => ({ default: m.TownOrcaShow })));
const TownCarrier = React.lazy(() => import('../wonders/CarrierExperience.jsx').then(m => ({ default: m.TownCarrier })));
const TownRocket = React.lazy(() => import('../wonders/RocketExperience.jsx').then(m => ({ default: m.TownRocket })));

// Harbour details are instanced, not hundreds of separate draw calls.
function Batch({ entries, rock = false }) {
  const ref = useRef();
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    entries.forEach((e,i) => {
      dummy.position.set(...e.at); dummy.scale.set(...e.size); dummy.rotation.set(...(e.rotation || [0,0,0])); dummy.updateMatrix();
      ref.current.setMatrixAt(i,dummy.matrix); ref.current.setColorAt(i,color.set(e.color));
    });
    ref.current.instanceMatrix.needsUpdate = true; ref.current.instanceColor.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [entries]);
  return <instancedMesh ref={ref} args={[null,null,entries.length]} castShadow receiveShadow>
    {rock ? <icosahedronGeometry args={[1,1]}/> : <boxGeometry args={[1,1,1]}/>}
    <meshStandardMaterial roughness={rock ? .96 : .77}/>
  </instancedMesh>;
}

function makeHarbour() {
  const boxes=[],rocks=[],lamps=[];
  const box=(at,size,color='#b4a18a',rotation)=>boxes.push({at,size,color,rotation});
  const rail=(x,z,length,along='z')=>{
    box([x,.93,z],along==='x'?[length,.1,.12]:[.12,.1,length],'#aa946f');
    for(let i=0,n=Math.ceil(length/2);i<=n;i++){
      const d=-length/2+i*length/n;box([x+(along==='x'?d:0),.48,z+(along==='z'?d:0)],[.12,.96,.12],'#627a76');
    }
  };
  for(const r of WONDER_BRIDGES){
    const horizontal=r.width>r.depth,len=horizontal?r.width:r.depth;
    box([r.x,-.24,r.z],[r.width,.48,r.depth],'#a18c70');
    for(let i=0;i<Math.ceil(len);i++)box([r.x+(horizontal?i-len/2+.5:0),.015,r.z+(horizontal?0:i-len/2+.5)],horizontal?[.035,.025,r.depth]:[r.width,.025,.035],'#766d5c');
    for(const side of [-1,1]){
      const x=r.x+(horizontal?0:side*(r.width/2-.12)),z=r.z+(horizontal?side*(r.depth/2-.12):0);
      rail(x,z,len,horizontal?'x':'z');
      for(const d of [-len*.36,len*.36]){
        const lx=x+(horizontal?d:0),lz=z+(horizontal?0:d);
        box([lx,-1.05,lz],[.28,2.1,.28],'#626b68');
        box([lx,1.5,lz],[.11,3,.11],'#596d69');
        box([lx,3.06,lz],[.44,.09,.44],'#52675f'); lamps.push([lx,2.87,lz]);
      }
    }
  }
  // The existing protected bridge-head trees stay in the authoritative map.
  // Two clear paving lanes visibly route around them instead of into a trunk.
  for(const side of [-1,1])for(const z of [20.8,23.2])box([side*41,.068,z],[6,.022,.75],'#c1b199');
  // Warm town paving continues across both islands; water remains non-walkable.
  // Keep the lagoon bed below displaced wave troughs; paving/collision stay fixed.
  box([-63,-.95,20],[28,1.1,28],'#8a8877');
  box([0,-.58,-60],[30,1.1,30],'#858c7b');box([0,-.07,-60],[29.9,.12,29.9],'#aaa68f');
  for(let i=0;i<13;i++){
    box([0,-.001,-74+i*2],[29.6,.012,.025],'#8c927e');
  }
  box([0,.006,-49.5],[3.4,.02,8],'#c4b698');
  // Coping follows the exact shared collision ellipse; the promenade stays open.
  for(let i=0;i<64;i++){
    const a=i/64*Math.PI*2;box([-64+Math.cos(a)*8.72,.06,19+Math.sin(a)*7.72],[.86,.18,.35],'#d3c4a6',[0,-a+Math.PI/2,0]);
  }
  for(let row=0;row<3;row++){
    box([-64,.20+row*.25,28+row*1.5],[17,.4,.8],row%2?'#778d80':'#a5b5a0');
    box([-64,.7+row*.25,28.3+row*1.5],[17,.65,.16],'#647e77');
  }
  rail(-76.5,20,27);rail(-63,6.3,27,'x');rail(-63,33.6,27,'x');
  rail(-14.5,-60,29);rail(14.5,-60,29);rail(0,-74.6,29,'x');
  // Control building retains its existing collision footprint.
  box([-9,1.4,-70],[7,2.8,4],'#c2c0a8');box([-9,2.9,-70],[7.35,.22,4.35],'#688782');
  box([-9,2.0,-67.96],[6,.75,.05],'#406577');
  for(let i=0;i<6;i++)box([-11.5+i,2,-67.91],[.08,.85,.08],'#d8cbae');
  box([-9,.04,-65.3],[6,.08,4.9],'#b5a88d');
  for(const [x,z] of [[-74,9],[-53,9],[-75,31],[-52,31],[-12,-48],[12,-48],[-12,-73],[12,-73]]){
    box([x,1.55,z],[.13,3.1,.13],'#5a716b');box([x,3.12,z],[.48,.1,.48],'#5a716b');lamps.push([x,2.91,z]);
  }
  // Revetment stays below feet and softens the abrupt diorama edge.
  const coast=(x,z,w,d)=>{
    for(let i=0;i<Math.ceil((w+d)*2/1.9);i++){
      const p=(i*1.9)%(2*(w+d)); let rx,rz;
      if(p<w){rx=x-w/2+p;rz=z-d/2;}else if(p<w+d){rx=x+w/2;rz=z-d/2+p-w;}else if(p<2*w+d){rx=x+w/2-(p-w-d);rz=z+d/2;}else{rx=x-w/2;rz=z+d/2-(p-2*w-d);}
      const atBridge=WONDER_BRIDGES.some(b=>Math.abs(rx-b.x)<b.width/2+.65&&Math.abs(rz-b.z)<b.depth/2+.65);
      const otherOpening=(Math.abs(rx+48)<1&&Math.abs(rz+4)<2)||(Math.abs(rz+43.1)<1&&Math.abs(rx-38)<4.5);
      if(atBridge||otherOpening)continue;
      const f=.5+.5*Math.sin(i*8.37);rocks.push({at:[rx,-.75,rz],size:[.9+f*.5,.36+f*.24,.75+f*.4],rotation:[.1,i*.7,.1],color:i%3===0?'#9a9d89':'#818a7b'});
    }
  };
  coast(0,.4,96.4,87.4);coast(-63,20,28.2,28.2);coast(0,-60,30.2,30.2);
  return {boxes,rocks,lamps};
}

function HarbourLights({ positions, lightTimeRef }) {
  const mesh=useRef(),mat=useRef();
  useLayoutEffect(()=>{const d=new THREE.Object3D();positions.forEach((p,i)=>{d.position.set(...p);d.updateMatrix();mesh.current.setMatrixAt(i,d.matrix);});mesh.current.instanceMatrix.needsUpdate=true;},[positions]);
  useFrame(()=>{if(mat.current)mat.current.emissiveIntensity=.25+2.2*sampleDayNight(lightTimeRef?.current??0).lampIntensity;});
  return <instancedMesh ref={mesh} args={[null,null,positions.length]}><boxGeometry args={[.3,.32,.3]}/><meshStandardMaterial ref={mat} color="#f4ddae" emissive="#ffd299" emissiveIntensity={.4}/></instancedMesh>;
}

function LagoonGround() {
  const geometry=useMemo(()=>{
    const shape=new THREE.Shape();shape.moveTo(-14,-14);shape.lineTo(14,-14);shape.lineTo(14,14);shape.lineTo(-14,14);shape.closePath();
    const hole=new THREE.Path();hole.absellipse(-1,1,8.45,7.45,0,Math.PI*2,true);shape.holes.push(hole);
    return new THREE.ShapeGeometry(shape,72);
  },[]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <mesh geometry={geometry} position={[-63,-.01,20]} rotation={[-Math.PI/2,0,0]} receiveShadow><meshStandardMaterial color="#b1a38c" roughness={.85}/></mesh>;
}

export default function WonderIslands({ timeRef, battleTimeRef = null, lightTimeRef, reducedMotion, playerPoseRef, onNearestWonder, viewMode }) {
  const nearest=useRef(null), labels=useRef([]), [nearId,setNearId]=useState(null);
  const harbour=useMemo(makeHarbour,[]);
  useFrame(()=>{
    const p=playerPoseRef?.current;
    const found=p&&WONDERS.find(w=>Math.hypot(p.x-w.x,p.z-w.z)<24);
    if((found?.id??null)!==nearest.current){nearest.current=found?.id??null;setNearId(nearest.current);onNearestWonder?.(nearest.current);}
    labels.current.forEach((node,i)=>{if(node)node.style.display=!['overview','wonder'].includes(viewMode)&&nearest.current===WONDERS[i].id?'block':'none';});
  });
  return <group name="three-wonders-integrated">
    <TownWater timeRef={timeRef} lightTimeRef={lightTimeRef} reducedMotion={reducedMotion}/>
    <Batch entries={harbour.boxes}/><Batch entries={harbour.rocks} rock/>
    <LagoonGround/>
    <HarbourLights positions={harbour.lamps} lightTimeRef={lightTimeRef}/>
    <TownWater pool timeRef={timeRef} lightTimeRef={lightTimeRef} reducedMotion={reducedMotion}/>
    <Suspense fallback={<WonderLoading id="orca"/>}><TownOrcaShow timeRef={timeRef} reducedMotion={reducedMotion} active={nearId==='orca'||viewMode==='overview'}/></Suspense>
    <Suspense fallback={<WonderLoading id="carrier"/>}><TownCarrier timeRef={timeRef} battleTimeRef={battleTimeRef} reducedMotion={reducedMotion} active={nearId==='carrier'||viewMode==='overview'}/></Suspense>
    <Suspense fallback={<WonderLoading id="rocket"/>}><TownRocket timeRef={timeRef} reducedMotion={reducedMotion} active={nearId==='rocket'||viewMode==='overview'}/></Suspense>
    {WONDERS.map((w,i)=><Html key={w.id} position={[w.x,w.id==='rocket'?16:7.5,w.z]} center zIndexRange={[7,0]} style={{pointerEvents:'none'}}><span ref={node=>{labels.current[i]=node;}} className="wonder-world-label" style={{display:'none'}}>{w.name}</span></Html>)}
  </group>;
}

