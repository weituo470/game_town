import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { OUTDOOR_GAMES, HOP_PLATFORMS } from '../../minigames/outdoor.js';
import { FISHING_SPOT, RIVER } from '../../../shared/river.js';
import Riverbank from './Riverbank.jsx';
import { RIVER_SURFACES } from './riverSurfaces.js';

function Cylinder({ at, radius, height, color, ...props }) {
  return <mesh position={at} castShadow receiveShadow {...props}><cylinderGeometry args={[radius,radius,height,24]}/><meshStandardMaterial color={color}/></mesh>;
}
function FishingProps({ runtimeRef, reducedMotion }) {
  const root = useRef(), float = useRef(), rod = useRef(), fish = useRef(), line = useRef(), rings = useRef([]), splash = useRef([]);
  const positions = useMemo(() => new Float32Array(9), []);
  useFrame(({ clock }) => {
    const state = runtimeRef?.current, playing = state?.id === 'fishing';
    if (root.current) root.current.visible = playing;
    if (!playing) return;
    const t = reducedMotion ? 0 : clock.elapsedTime, phase = state.phase;
    const casting = phase === 'casting', lifting = phase === 'lifting' || phase === 'caught';
    const castT = casting ? Math.min(1,state.timer/0.65) : 1, liftT = phase === 'lifting' ? Math.min(1,state.timer/0.85) : 1;
    const theta = casting ? -0.45+castT*1.42 : lifting ? 1-liftT*0.7 : ['waiting','bite'].includes(phase) ? 1 : 0.65;
    if (rod.current) rod.current.rotation.x = theta+(phase==='bite'?Math.sin(t*14)*0.025:0);
    const tip = [0.38,1.05+Math.cos(theta)*2.8,0.35+Math.sin(theta)*2.8];
    let end = [0.38,RIVER.waterY+0.06,3.35];
    if (casting) end = [0.38,1.4*(1-castT)+RIVER.waterY*castT+Math.sin(castT*Math.PI)*1.65,0.6+castT*2.75];
    else if (phase==='bite') end[1]-=0.13+Math.sin(t*16)*0.05;
    else if (phase==='waiting') end[1]+=Math.sin(t*2.1)*0.026;
    if (lifting) end = [0.38,RIVER.waterY+(2.5-RIVER.waterY)*liftT,3.35-liftT*1.35];
    if (float.current) { float.current.visible=casting||['waiting','bite'].includes(phase); float.current.position.set(...end); float.current.rotation.z=phase==='bite'?Math.sin(t*15)*0.22:Math.sin(t*2)*0.07; }
    if (line.current) {
      line.current.visible=casting||lifting||['waiting','bite'].includes(phase);
      positions.set(tip,0); positions.set([(tip[0]+end[0])/2,(tip[1]+end[1])/2-(casting?0.35:0.06),(tip[2]+end[2])/2],3); positions.set(end,6);
      line.current.geometry.attributes.position.needsUpdate=true;
    }
    if (fish.current) {
      fish.current.visible=lifting; fish.current.position.set(end[0],end[1]-0.38,end[2]); fish.current.rotation.z=Math.sin(t*9)*0.15;
      if(state.fish){fish.current.children[0].material.color.set(state.fish.color);fish.current.scale.setScalar(0.8+state.fish.lengthCm/65);}
    }
    rings.current.forEach((ring,i)=>{
      if(!ring)return;
      ring.visible=phase==='bite'||(phase==='waiting'&&state.timer<0.7)||phase==='lifting';
      const size=reducedMotion?0.8+i*0.25:0.25+((t*0.8+i*0.35)%1)*1.1;
      ring.scale.setScalar(size);ring.material.opacity=Math.max(0.08,0.7-size*0.35);
    });
    splash.current.forEach((mesh,i)=>{
      if(!mesh)return;
      mesh.visible=phase==='bite'||(phase==='waiting'&&state.timer<0.3);
      mesh.position.set(0.38+Math.sin(i*1.8)*0.18,RIVER.waterY+0.07+Math.abs(Math.sin(t*8+i))*0.25,3.35+Math.cos(i*1.8)*0.18);
    });
  });
  return <group ref={root} position={[FISHING_SPOT.x,0,FISHING_SPOT.z]} rotation={[0,FISHING_SPOT.yaw,0]} visible={false}>
    <group ref={rod} position={[0.38,1.05,0.35]}>
      <Cylinder at={[0,1.4,0]} radius={0.025} height={2.8} color="#c3a074"/>
      <Cylinder at={[0,0.18,0]} radius={0.055} height={0.55} color="#6c5848"/>
      <mesh position={[0.07,0.38,0]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[0.11,0.11,0.08,12]}/><meshStandardMaterial color="#899ba4" metalness={0.7}/></mesh>
    </group>
    <line ref={line} frustumCulled={false}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions,3]}/></bufferGeometry><lineBasicMaterial color="#f1e8cf"/></line>
    <group ref={float} visible={false}>
      <Cylinder at={[0,0.08,0]} radius={0.07} height={0.22} color="#ed775e"/>
      <Cylinder at={[0,-0.06,0]} radius={0.06} height={0.1} color="#fff1d0"/>
      <Cylinder at={[0,0.23,0]} radius={0.012} height={0.18} color="#efdca7"/>
    </group>
    {[0,1,2].map(i=><mesh key={i} ref={node=>{rings.current[i]=node;}} position={[0.38,RIVER.waterY+0.023+i*0.001,3.35]} rotation={[-Math.PI/2,0,0]} renderOrder={RIVER_SURFACES.rippleOrder} visible={false}><ringGeometry args={[0.37,0.395,40]}/><meshBasicMaterial color="#d2efdf" transparent opacity={0.5} depthWrite={false}/></mesh>)}
    {[0,1,2,3,4].map(i=><mesh key={i} ref={node=>{splash.current[i]=node;}} visible={false}><sphereGeometry args={[0.025,6,4]}/><meshBasicMaterial color="#d9eee0"/></mesh>)}
    <group ref={fish} visible={false}>
      <mesh scale={[0.18,0.4,0.12]}><sphereGeometry args={[1,16,12]}/><meshStandardMaterial color="#d3c881" roughness={0.35} metalness={0.18}/></mesh>
      <mesh position={[0,-0.4,0]} rotation={[0,0,Math.PI]}><coneGeometry args={[0.21,0.27,3]}/><meshStandardMaterial color="#c68f69"/></mesh>
      <mesh position={[0.13,0.15,0.08]}><sphereGeometry args={[0.035,8,6]}/><meshBasicMaterial color="#182f36"/></mesh>
      <mesh position={[-0.17,0,0]} rotation={[0,0,-0.65]}><coneGeometry args={[0.12,0.2,3]}/><meshStandardMaterial color="#bcb799"/></mesh>
    </group>
  </group>;
}
export default function OutdoorScenery({runtimeRef,onStart,playing,active,reducedMotion}) {
  return <group>
    <Riverbank reducedMotion={reducedMotion}/>
    {HOP_PLATFORMS.map((p,index)=><group key={index}>
      <Cylinder at={[p.x,0.57,p.z]} radius={p.radius} height={1} color={index===0||index===8?'#72a99b':index%2?'#b18cbd':'#d1a274'}/>
      <Cylinder at={[p.x,1.07,p.z]} radius={p.radius*0.9} height={0.05} color="#f3dbac"/>
      <Cylinder at={[p.x,1.1,p.z]} radius={0.28} height={0.015} color="#83b89c"/>
    </group>)}
    <FishingProps runtimeRef={runtimeRef} reducedMotion={reducedMotion}/>
    {OUTDOOR_GAMES.filter(game=>!game.global).map(game=><Html key={game.id} position={[game.x,game.id==='hop'?3:2.8,game.z]} center zIndexRange={[5,0]} style={{display:playing?'none':'block'}}><button className="outdoor-world-label" disabled={!active||!!playing} onClick={event=>{event.stopPropagation();onStart?.(game.id);}} aria-label={`在${game.place}游玩${game.name}`}>{game.place} · {game.name} ↗</button></Html>)}
  </group>;
}
