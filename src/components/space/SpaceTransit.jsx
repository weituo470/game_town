import {useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {SPACE_ELEVATOR as E,ELEVATOR_BOTTOM,ELEVATOR_TOP} from '../../../shared/space-elevator.js';
import {RAIL,railFrame,railPoint,sampleRail} from '../../../shared/space-rail.js';
export function Beam({a,b,r=.18,color='#8d9da7'}){const t=useMemo(()=>{const p=new THREE.Vector3(...a),q=new THREE.Vector3(...b),v=q.clone().sub(p);return {p:p.add(q).multiplyScalar(.5),q:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize()),h:v.length()};},[a,b]);return <mesh position={t.p} quaternion={t.q}><cylinderGeometry args={[r,r,t.h,6]}/><meshStandardMaterial color={color} metalness={.65} roughness={.45} fog={false}/></mesh>;}
function Box({position,size,color='#d5d9d8',metal=.4,...props}){return <mesh position={position} {...props}><boxGeometry args={size}/><meshStandardMaterial color={color} metalness={metal} roughness={.48} fog={false}/></mesh>;}
function Sign({text,width=12,position=[0,0,0],rotation=[0,0,0]}){const texture=useMemo(()=>{const c=document.createElement('canvas');c.width=1024;c.height=192;const x=c.getContext('2d');x.fillStyle='#102b36';x.fillRect(0,0,1024,192);x.strokeStyle='#f5b84c';x.lineWidth=12;x.strokeRect(6,6,1012,180);x.font='bold 70px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillStyle='#f3f6ed';x.fillText(text,512,100);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;},[text]);return <group position={position} rotation={rotation}>{[0,1].map(side=><mesh key={side} position={[0,0,side?-.012:0]} rotation={[0,side?Math.PI:0,0]}><planeGeometry args={[width,width*192/1024]}/><meshBasicMaterial map={texture} side={THREE.FrontSide} fog={false}/></mesh>)}</group>;}
function Platform({at,label}){const f=railFrame(at);return <group position={f.position} rotation={[0,f.yaw,0]}>
 <Box position={[0,-.6,0]} size={[22,1.2,25]} color="#344f59"/><Box position={[0,-.06,0]} size={[20,.2,23]} color="#b0bab9"/>
 {[-1,1].map(s=><group key={s}>{[-1,1].map(z=><Box key={'post'+z} position={[s*8,3.5,z*9]} size={[.45,7,.45]} color="#54676e"/>)}<Box position={[s*2.1,.025,0]} size={[.15,.05,21]} color="#f6bd58"/>{[-1,1].map(z=><Box key={z} position={[s*7,2.4,z*10.6]} size={[.35,4.8,.35]} color="#f0ab40"/>)}</group>)}
 {[-1,1].map(s=><mesh key={'canopy'+s} position={[s*7.5,7,0]}><boxGeometry args={[5,.16,25]}/><meshStandardMaterial color="#a6c8d4" transparent opacity={.12} depthWrite={false} fog={false}/></mesh>)}<Sign text={label} width={15} position={[0,5.7,11.65]}/><Sign text="候车 → 车门停稳后登乘" width={12} position={[0,3.3,-11.55]}/>
 </group>;}
class TubeCurve extends THREE.Curve{getPoint(t,target=new THREE.Vector3()){return target.set(...railPoint(t));}}
function Tube(){const curve=useMemo(()=>new TubeCurve(),[]),rings=useRef();
 const frames=useMemo(()=>Array.from({length:120},(_,i)=>railFrame(i/119)),[]);
 
 useFrame(()=>{if(!rings.current||rings.current.userData.ready)return;const o=new THREE.Object3D(),normal=new THREE.Vector3(0,0,1);frames.forEach((f,i)=>{o.position.set(...f.position);o.position.y+=2.6;o.quaternion.setFromUnitVectors(normal,new THREE.Vector3(Math.sin(f.yaw),0,Math.cos(f.yaw)));o.updateMatrix();rings.current.setMatrixAt(i,o.matrix);});rings.current.instanceMatrix.needsUpdate=true;rings.current.userData.ready=true;});
 return <group name="continuous-ocean-tube-railway">
  <mesh position={[0,2.6,0]}><tubeGeometry args={[curve,256,4.2,12,false]}/><meshPhysicalMaterial color="#91bdca" transparent opacity={.075} roughness={.12} metalness={.1} side={THREE.DoubleSide} depthWrite={false} fog={false}/></mesh>
  <instancedMesh ref={rings} args={[null,null,120]} frustumCulled={false}><torusGeometry args={[4.2,.095,5,16]}/><meshStandardMaterial color="#587782" metalness={.8} roughness={.4} fog={false}/></instancedMesh>
  {[-1,1].map(x=><group key={x}><mesh position={[x*1.25,-.42,0]}><tubeGeometry args={[curve,256,.14,5,false]}/><meshStandardMaterial color="#a9dfe4" emissive="#49bacf" emissiveIntensity={.6} metalness={.8} fog={false}/></mesh><mesh position={[x*3.5,1.8,0]}><tubeGeometry args={[curve,256,.07,5,false]}/><meshBasicMaterial color="#5fbdcf" fog={false}/></mesh></group>)}
  {Array.from({length:15},(_,i)=>{const f=railFrame((i+1)/16);return <group key={i}><Box position={[f.position[0],(f.position[1]-6)/2,f.position[2]]} size={[1.1,f.position[1]+6,1.1]} color="#36525d"/><Box position={[f.position[0],-4,f.position[2]]} size={[6,2,6]} color="#283e48"/></group>;})}
 </group>;}
function Train({runtime}){const root=useRef(),doorA=useRef(),doorB=useRef();useFrame(()=>{const s=runtime.current,t=s.train;if(!t||!root.current)return;root.current.position.set(...t.position);root.current.rotation.y=t.yaw;const open=t.docked?1:0;for(const [door,sign] of [[doorA,-1],[doorB,1]])if(door.current)door.current.position.z=THREE.MathUtils.lerp(door.current.position.z,sign*(.8+open*1.5),.15);});
 return <group ref={root} name="boardable-magnetic-train">
  <Box position={[0,-.22,0]} size={[3.3,.4,14]} color="#162e3b"/><Box position={[0,3.5,0]} size={[3.5,.35,14]} color="#e5e9e5"/>
  {[-1,1].map(s=><group key={s}>{[-1,1].map(z=><Box key={'belt'+z} position={[s*1.58,.45,z*4.5]} size={[.15,.9,4.8]} color="#e6e8dc"/>)}<Box position={[s*1.58,3,0]} size={[.15,.5,13.8]} color="#ecad3b"/>{[-1,1].map(z=><mesh key={z} position={[s*1.58,1.9,z*4.5]}><boxGeometry args={[.08,2,3.5]}/><meshPhysicalMaterial color="#9dd0e4" transparent opacity={.1} depthWrite={false} roughness={.15} fog={false}/></mesh>)}{[-1,1].map(z=><Box key={'seat'+z} position={[s*1.1,.5,z*4.4]} size={[.5,.8,2]} color="#365568"/>)}</group>)}
  {[-1,1].map(z=><group key={z}><Box position={[0,.5,z*6.8]} size={[3.2,1,.25]} color="#edf1e9"/><Box position={[0,3.3,z*6.8]} size={[3.2,.35,.25]} color="#edf1e9"/><mesh position={[0,2,z*6.8]}><boxGeometry args={[3,2.1,.08]}/><meshPhysicalMaterial color="#9cd6e9" transparent opacity={.12} roughness={.1} depthWrite={false} fog={false}/></mesh><Box position={[0,.5,z*7]} size={[2.2,.12,.1]} color="#a8eeff"/></group>)}
  <group position={[1.66,1.85,0]}><group ref={doorA}><Box position={[0,0,0]} size={[.1,2.7,1.5]} color="#527384"/></group><group ref={doorB}><Box position={[0,0,0]} size={[.1,2.7,1.5]} color="#527384"/></group></group>
  <Sign text="星环快线 01" width={7} position={[-1.68,1.9,0]} rotation={[0,-Math.PI/2,0]}/>
 </group>;}
export function OceanRail({runtime}){return <><Tube/><Platform at={0} label="游戏小镇 · 星环快线"/><Platform at={1} label="远海枢纽 · 太空电梯"/><Box position={[36,-.3,44]} size={[13,.6,12]} color="#a0aaa8"/><Train runtime={runtime}/></>;}
export function IndustrialPort(){return <group position={[E.port.x,0,E.port.z]} name="heavy-industry-spaceport">
 <mesh position={[0,-2.1,0]} receiveShadow><cylinderGeometry args={[34,37,4.2,64]}/><meshStandardMaterial color="#3e535b" metalness={.6} roughness={.7} fog={false}/></mesh>
 <mesh position={[0,-.1,0]}><cylinderGeometry args={[32.5,32.5,.2,64]}/><meshStandardMaterial color="#9ca6a4" roughness={.8} fog={false}/></mesh>
 {[-1,1].map(x=>[-1,1].map(z=><group key={`${x},${z}`}><Box position={[x*9,17,z*8]} size={[1.6,34,1.6]} color="#637581"/><Box position={[x*9,27,z*8]} size={[2.5,2,2.5]} color="#e4a93d"/></group>))}
 <Box position={[0,33,0]} size={[21,2,18]} color="#c6ccc9"/><Box position={[0,31.5,9]} size={[19,1,1]} color="#e9ac37"/>
 {[-1,1].map(s=><><Box key={'control'+s} position={[s*22,4,-10]} size={[12,8,16]} color="#bdc5bf"/><Box key={'roof'+s} position={[s*22,8.3,-10]} size={[13,.6,17]} color="#435d6b"/><Sign key={'sign'+s} text={s<0?'动力 / ENGINE':'航站 / ORBIT'} width={10} position={[s*22,5,-1.9]}/></>)}
 {Array.from({length:18},(_,i)=>{const t=i*Math.PI/9;return <Box key={i} position={[Math.cos(t)*31,1,Math.sin(t)*31]} size={[.25,2,.25]} color="#eab248"/>;})}
 <Box position={[0,.02,0]} size={[5,.04,7]} color="#d9aa3e"/><Sign text="01 / 太空电梯" width={16} position={[0,28,9.05]}/>
 </group>;}
export function ElevatorCabin({cabin,runtime}){const doors=useRef();useFrame(()=>{const s=runtime.current;if(doors.current){const elapsed=s.now-(s.pose?.spaceStartAt||0),riding=['ascent','descent'].includes(s.mode),open=!riding||elapsed<1500||elapsed>E.durationMs-1500;doors.current.scale.x=THREE.MathUtils.lerp(doors.current.scale.x,open?.03:1,.12);}});return <group ref={cabin} name="continuous-heavy-elevator-cabin">
 <Box position={[0,-.4,0]} size={[8,.8,10]} color="#334c5d"/><Box position={[0,8.4,0]} size={[8.8,.8,10.5]} color="#dce0da"/><Box position={[0,7.6,0]} size={[8.5,.6,10.2]} color="#df9f2f"/>
 {[-1,1].map(x=>[-1,1].map(z=><group key={`${x}:${z}`}><Box position={[x*3.7,4,z*4.5]} size={[.55,8,.55]} color="#b4c2c6"/><Box position={[x*4.2,4,z*3]} size={[.7,2,1.4]} color="#e6a33b"/></group>))}
 {[-1,1].map(s=><group key={s}><Box position={[s*3.8,.75,0]} size={[.3,1.5,9]} color="#b6c1c1"/>{s<0?<Box position={[0,.75,s*4.6]} size={[7.5,1.5,.3]} color="#a9b8ba"/>:[-1,1].map(x=><Box key={x} position={[x*2.9,.75,4.6]} size={[1.6,1.5,.3]} color="#a9b8ba"/>)}<Box position={[s*3.8,4,0]} size={[.12,.18,9]} color="#ffe1a0"/><mesh position={[s*3.8,3,0]}><boxGeometry args={[.08,3,8]}/><meshPhysicalMaterial color="#a3d5e2" transparent opacity={.13} roughness={.2} depthWrite={false} fog={false}/></mesh><Box position={[s*2.7,-1.2,0]} size={[.9,1.8,7]} color="#283f50"/></group>)}
 <group ref={doors} position={[0,3.5,4.8]}><Box position={[0,0,0]} size={[7,4,.18]} color="#4e7180"/></group>
 <Sign text="EARTH ↔ 星环城" width={6} position={[0,6,4.85]}/>
 <pointLight position={[0,5,0]} color="#a7deff" intensity={18} distance={18}/>
 </group>;}
export function ElevatorTethers(){return <>{[-1,1].map(s=><Beam key={s} a={ELEVATOR_BOTTOM.map((v,i)=>v+(i===0?s*4.5:0))} b={ELEVATOR_TOP.map((v,i)=>v+(i===0?s*4.5:0))} r={.35} color="#9eabb3"/>)}</>;}
export function Planet(){const root=useRef();useFrame(({camera})=>{if(root.current)root.current.visible=camera.position.y>2000;});return <group ref={root} name="continuous-earth-horizon">
 <mesh position={[0,-6371100,0]}><sphereGeometry args={[6371000,192,128]}/><shaderMaterial uniforms={{}} vertexShader={`varying vec3 p; varying vec3 n;void main(){p=position;n=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`} fragmentShader={`varying vec3 p;varying vec3 n;void main(){vec3 d=normalize(p);float a=sin(d.x*34.)+sin(d.z*29.)+sin((d.x+d.z)*72.)*.3;float cloud=smoothstep(.55,.95,sin(d.x*180.+d.z*70.)*sin(d.z*120.-d.x*80.));vec3 ocean=vec3(.018,.13,.27);vec3 land=vec3(.12,.23,.18);vec3 c=mix(ocean,land,smoothstep(1.25,1.65,a));c=mix(c,vec3(.75,.83,.87),cloud*.7);float light=.5+.5*max(0.,dot(d,normalize(vec3(-.3,1.,.4))));gl_FragColor=vec4(c*light,1.);}`}/></mesh>
 <mesh position={[0,-6371100,0]}><sphereGeometry args={[6376500,96,64]}/><meshBasicMaterial color="#439dd5" transparent opacity={.08} side={THREE.BackSide} depthWrite={false} fog={false}/></mesh>
 </group>;}
