import {useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {RingStationHabitat,RingCityDistricts} from '../../orbit/client/components/station/RingStation.jsx';
import RingOldQuarter from '../../orbit/client/components/DuskScenery.jsx';
import RingFountain from '../../orbit/client/components/town/landmarks/LandmarkFountain.jsx';
import StationWorld from '../../orbit/client/components/station/StationWorld.jsx';
import VerticalFarm from '../../orbit/client/components/station/VerticalFarm.jsx';
import StationSystems from '../../orbit/client/components/station/StationSystems.jsx';
import useVerticalFarm from '../../orbit/client/lib/useVerticalFarm.js';
import {stationPoseFrame} from '../../orbit/shared/ringStation.js';
import {stepAvatar as stepOrbit} from '../../orbit/shared/jetpack.js';
import {stationWalkCamera} from '../../orbit/client/components/station/stationWalkCamera.js';
import {SPACE_ELEVATOR as E,CITY_BASIS,cityDirection,cityToWorld,ELEVATOR_BOTTOM,ELEVATOR_TOP,canAscend,canDescend,sampleElevator,advanceElevator,orbitState,placeInOrbit,orbitWorldPose,spaceClockTime} from '../../../shared/space-elevator.js';
import {cityMatrix,cityQuaternion} from './spaceOrientation.js';
import {OceanRail,IndustrialPort,ElevatorCabin,ElevatorTethers,Planet} from './SpaceTransit.jsx';
import {advanceRailSchedule,nearRailStation,sampleRail,canBoardRail,railLocal,railPassenger,stepRail,railExit} from '../../../shared/space-rail.js';
const zero={x:0,z:0};
const arr=p=>[p.x,p.y,p.z];
function CelestialVeil({runtime}){
 const shell=useRef(),rim=useRef();
 useFrame(({camera})=>{const d=camera.position.distanceTo(new THREE.Vector3(...E.cityCenter));const opacity=THREE.MathUtils.smoothstep(d,700,4200);if(shell.current){shell.current.material.opacity=opacity*.74;shell.current.visible=opacity>.001;}if(rim.current)rim.current.material.opacity=opacity*.12;});
 // A real translucent outer shield, not a billboard or substitute scene.
 return <group position={E.cityCenter} name="celestial-city-envelope">
  <mesh ref={shell}><sphereGeometry args={[E.envelopeRadius,64,48]}/><meshStandardMaterial color="#c4d9de" emissive="#51788a" emissiveIntensity={.32} roughness={.83} transparent opacity={.74} depthWrite={false} fog={false}/></mesh>
  <mesh ref={rim}><sphereGeometry args={[E.envelopeRadius+8,48,32]}/><meshBasicMaterial color="#c0e5ff" side={THREE.BackSide} transparent opacity={.12} depthWrite={false} fog={false}/></mesh>
 </group>;
}
function City({runtime,timeRef,reducedMotion}){
 const root=useRef(),marker=useRef(),clock=useRef(0),logicalPose=useRef(null),farm=useVerticalFarm();
 useEffect(()=>{runtime.current.farm=farm;return()=>{runtime.current.farm=null;};},[farm,runtime]);
 useLayoutEffect(()=>{root.current.traverse(o=>{if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.fog=false;}if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}});},[]);
 useFrame((_,dt)=>{clock.current+=Math.min(dt,.1)*1000;const s=runtime.current;root.current.visible=new THREE.Vector3(...E.cityCenter).distanceTo(new THREE.Vector3(...(s.cameraPosition||[0,0,0])))<3600;logicalPose.current=s.mode==='orbit'?orbitState(s.pose):null;if(marker.current){marker.current.visible=s.mode==='orbit'&&!!s.waypoint;if(s.waypoint){const frame=stationPoseFrame({...s.waypoint,y:3});marker.current.position.set(...frame.position);marker.current.rotation.set(frame.rotationX,0,0);}}});
 const dock=orbitWorldPose(E.dock);const localDock=new THREE.Vector3(...cityToWorld([0,0,0]));
 return <group ref={root} matrix={cityMatrix} matrixAutoUpdate={false} name="continuous-ring-city">
   <RingStationHabitat/>
   <StationSystems physicsClock={clock} timeRef={timeRef}/>
   <StationWorld><RingOldQuarter timeRef={timeRef} reducedMotion={reducedMotion} overview/><RingFountain position={[0,0,2]} reducedMotion={reducedMotion}/><RingCityDistricts/><VerticalFarm farmStateRef={farm.stateRef} playerPoseRef={logicalPose} reducedMotion={reducedMotion} onOpen={id=>{runtime.current.farmOpen=id||'overview';}}/></StationWorld>
   <group ref={marker} visible={false}><mesh rotation={[Math.PI,0,0]}><coneGeometry args={[.6,1.3,8]}/><meshBasicMaterial color="#6ee6ff" fog={false}/></mesh></group>
   <ambientLight intensity={.45} color="#d9edff"/>
 </group>;
}
export default function SpaceWorld({runtime,playerPoseRef,network,viewMode,active,timeRef,reducedMotion}){
 const {camera,gl,invalidate}=useThree();const cabin=useRef(),target=useRef(new THREE.Vector3()),desired=useRef(new THREE.Vector3()),up=useRef(new THREE.Vector3(0,1,0));
 const serverTick=useRef(-1),wasConnected=useRef(false),networkRef=useRef(network);networkRef.current=network;
 useEffect(()=>{const s=runtime.current;s.loaded=true;return()=>{s.loaded=false;};},[runtime]);
 useFrame((_,dt)=>{
   const s=runtime.current,n=networkRef.current,connected=n?.status==='connected';
   const snapshot=n?.snapshotRef?.current,self=connected?snapshot?.players?.find(p=>p.id===(snapshot.selfId||n.selfId)):null;
   const now=spaceClockTime(s,connected?snapshot:null,performance.now());s.now=now;
   if(connected&&self&&snapshot.tick!==serverTick.current){
     const previous=s.mode;serverTick.current=snapshot.tick;s.mode=self.spaceMode||'ground';
     if(s.mode!=='ground')s.pose={...self};
     else if(previous!=='ground')s.returnPose={...self};
   }
   if(wasConnected.current&&!connected&&s.mode!=='ground'){s.message='联机连接已中断，保留当前位置；重新连接后以服务器为准。';}
   wasConnected.current=connected;
   s.railEpoch=connected?snapshot?.railEpoch??s.railEpoch:s.railEpoch??0;
   s.railFrom=connected?snapshot?.railFrom??0:s.railFrom??0;
   if(!connected)Object.assign(s,advanceRailSchedule(s.railEpoch,now,s.railFrom));
   s.train=sampleRail(s.railEpoch,now,s.railFrom);
   if(s.autoBoard&&s.mode==='ground'&&canBoardRail(connected?self||{}:playerPoseRef.current||{},s.train)){s.autoBoard=false;s.action='rail-board';}
   if(s.mode==='rail'&&s.train.docked&&s.autoExitStation===s.train.station){s.autoExitStation=null;s.action='rail-exit';}
   if(s.walkToCabin&&canAscend(connected?self||{}:playerPoseRef.current||{})){s.walkToCabin=false;s.walkTo=null;s.action='ascend';}
   if(s.action){const action=s.action;s.action=null;const pose=connected?self:s.mode==='ground'?playerPoseRef.current:s.pose;
     const rail=action.startsWith('rail-'),valid=pose&&(rail?(action==='rail-board'?canBoardRail(pose,s.train):action==='rail-call'?s.mode==='ground'&&s.train.docked&&s.train.station!==nearRailStation(pose)&&nearRailStation(pose)>=0:s.mode==='rail'&&s.train.docked):(action==='ascend'?canAscend(pose):canDescend(pose)));
     if(valid){
       if(connected)n.sendSpace?.(action);
       else if(rail){if(['rail-depart','rail-call'].includes(action)){s.railFrom=s.train.station;s.railEpoch=now;}else if(action==='rail-board'){s.mode='rail';s.pose=railPassenger({...pose,...railLocal(pose,s.train),railYaw:0},s.train);}else{s.mode='ground';s.returnPose=railExit(pose,s.train);s.pose=s.returnPose;}}
       else{s.mode=action==='ascend'?'ascent':'descent';s.pose={...pose,spaceMode:s.mode,spaceStartAt:now};Object.assign(s.pose,advanceElevator(s.pose,now));}
       s.journeyLook={...(s.look||{yaw:0,pitch:.12})};s.message='';
     }else s.message=rail?'请在列车停稳、车门打开后，从车门中央登乘。':'请步行进入运输厢中央的黄色登梯区域。';
   }
   if(s.mode==='rail'){
     const input=active&&!s.uiBlocked&&!['connecting','reconnecting'].includes(n?.status)?s.input||zero:zero;
     s.pose=railPassenger(stepRail(s.pose,input,dt),s.train);s.progress=s.train.progress;
   }
   if(s.mode==='ascent'||s.mode==='descent'){
     const shot=sampleElevator(now-s.pose.spaceStartAt,s.mode);
     Object.assign(s.pose,advanceElevator(s.pose,now));
     if(!connected&&shot.arrived){s.mode=s.pose.spaceMode;if(s.mode==='ground')s.returnPose={...s.pose};}
     s.progress=shot.progress;
   }else if(s.mode==='orbit'){
     const input=active&&!s.uiBlocked&&!['connecting','reconnecting'].includes(n?.status)?s.input||zero:zero;
     if(!connected||self?.connected!==false)Object.assign(s.pose,placeInOrbit(s.pose,stepOrbit(orbitState(s.pose),input,Math.min(.1,dt))));
   }
   if(cabin.current){const riding=['ascent','descent'].includes(s.mode);cabin.current.visible=true;
     const t=riding?sampleElevator(now-s.pose.spaceStartAt,s.mode):s.mode==='orbit'?{position:ELEVATOR_TOP,up:orbitWorldPose(E.dock).up}:{position:ELEVATOR_BOTTOM,up:[0,1,0]};
     cabin.current.position.set(...t.position);cabin.current.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),up.current.set(...t.up));}
   if(s.mode!=='ground'&&camera.isPerspectiveCamera){
     const look=s.look||{yaw:0,pitch:.12};let shot;
     if(s.mode==='rail'){
       const yaw=(s.train.direction>0?Math.PI:0)+look.yaw-(s.journeyLook?.yaw??look.yaw);s.surfaceYaw=yaw;
       const direction=new THREE.Vector3(Math.sin(yaw-s.train.yaw),0,-Math.cos(yaw-s.train.yaw)),p=new THREE.Vector3(...arr(s.pose));
       const outside=s.railView!=='interior',side=new THREE.Vector3().crossVectors(direction,new THREE.Vector3(0,1,0)).normalize();
       shot={position:p.clone().addScaledVector(direction,outside?-12:-3).addScaledVector(side,outside?10:0).add(new THREE.Vector3(0,outside?10:2.25,0)).toArray(),target:p.clone().addScaledVector(direction,outside?6:14).add(new THREE.Vector3(0,2+(look.pitch-.12)*12,0)).toArray(),up:[0,1,0]};
     }else if(s.mode==='orbit'){
       const p=orbitState(s.pose),distance=viewMode==='first-person'?5.6:11,pitch=Math.max(.18,Math.min(.95,look.pitch+.6));
       const surfaceYaw=look.yaw-(s.journeyLook?.yaw??look.yaw)-2.2;s.surfaceYaw=surfaceYaw;
       const local={position:{x:p.x-Math.sin(surfaceYaw)*Math.cos(pitch)*distance,y:p.y+2.8+Math.sin(pitch)*2,z:p.z+Math.cos(surfaceYaw)*Math.cos(pitch)*distance},target:{x:p.x+Math.sin(surfaceYaw)*14,y:p.y+2.5,z:p.z-Math.cos(surfaceYaw)*14},distance};
       const frame=stationWalkCamera(local,p);shot={position:cityToWorld(arr(frame.position)),target:cityToWorld(arr(frame.target)),up:cityDirection(frame.up)};
     }else{
       const t=sampleElevator(now-s.pose.spaceStartAt,s.mode),u=new THREE.Vector3(...t.up),forward=new THREE.Vector3(...ELEVATOR_TOP).sub(new THREE.Vector3(...ELEVATOR_BOTTOM)).normalize();
       const side=new THREE.Vector3().crossVectors(u,forward).normalize();if(side.lengthSq()<.1)side.set(1,0,0);
       const p=new THREE.Vector3(...t.position),base=s.journeyLook||{yaw:look.yaw,pitch:look.pitch};
       const direction=s.mode==='descent'?forward.clone().negate():forward.clone();
       direction.applyAxisAngle(u,look.yaw-base.yaw);
       const sideView=new THREE.Vector3().crossVectors(direction,u).normalize();
       const eye=p.clone().addScaledVector(direction,-8).addScaledVector(u,12).addScaledVector(sideView,18);
       shot={position:eye.toArray(),target:p.clone().addScaledVector(direction,4).addScaledVector(u,2+(look.pitch-base.pitch)*90).toArray(),up:t.up};
       if(s.elevatorView!=='exterior'){const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),u);const outward=new THREE.Vector3(-E.port.x,0,-E.port.z).normalize().applyQuaternion(rotation).applyAxisAngle(u,look.yaw-base.yaw);const eye=p.clone().addScaledVector(u,2.6);shot={position:eye.toArray(),target:eye.clone().addScaledVector(outward,18).addScaledVector(u,(look.pitch-base.pitch)*14).toArray(),up:t.up};}
       if(s.elevatorView==='exterior'&&s.mode==='ascent'&&t.progress>.88){
         const yaw=look.yaw-base.yaw-2.2,pitch=Math.max(.18,Math.min(.95,look.pitch+.6)),d=viewMode==='first-person'?5.6:11;
         const local={position:{x:E.dock.x-Math.sin(yaw)*Math.cos(pitch)*d,y:E.dock.y+2.8+Math.sin(pitch)*2,z:E.dock.z+Math.cos(yaw)*Math.cos(pitch)*d},target:{x:E.dock.x+Math.sin(yaw)*14,y:E.dock.y+2.5,z:E.dock.z-Math.cos(yaw)*14},distance:d};
         const walk=stationWalkCamera(local,E.dock),blend=THREE.MathUtils.smoothstep(t.progress,.88,1);
         shot={position:new THREE.Vector3(...shot.position).lerp(new THREE.Vector3(...cityToWorld(arr(walk.position))),blend).toArray(),target:new THREE.Vector3(...shot.target).lerp(new THREE.Vector3(...cityToWorld(arr(walk.target))),blend).toArray(),up:new THREE.Vector3(...shot.up).lerp(new THREE.Vector3(...cityDirection(walk.up)),blend).normalize().toArray()};
       }
     }
     camera.position.set(...shot.position);camera.up.set(...shot.up);target.current.set(...shot.target);camera.lookAt(target.current);camera.clearViewOffset();
   }else if(s.previousMode&&s.previousMode!=='ground')camera.up.set(0,1,0);
   s.previousMode=s.mode;s.cameraPosition=camera.position.toArray();
   if(s.mode!=='ground'&&camera.near!==.4){camera.near=.4;camera.updateProjectionMatrix();}
   if(!['drone','sphere','offshore'].includes(viewMode)&&camera.far<E.far){camera.far=E.far;camera.updateProjectionMatrix();}
   gl.domElement.dataset.spaceMode=s.mode;
   const visiblePose=s.mode==='ground'?playerPoseRef.current:s.pose;
   if(visiblePose)gl.domElement.dataset.spacePosition=JSON.stringify([visiblePose.x,visiblePose.y,visiblePose.z].map(v=>Math.round(v*100)/100));
   gl.domElement.dataset.railPosition=JSON.stringify(s.train.position.map(v=>Math.round(v*100)/100));
   gl.domElement.dataset.railDock=String(s.train.station);
   gl.domElement.dataset.spaceAltitude=String(Math.round(s.pose?.y||0));
   if(s.pose)gl.domElement.dataset.orbitPosition=JSON.stringify([s.pose.orbitX,s.pose.orbitY,s.pose.orbitZ].map(v=>Math.round((v||0)*100)/100));
   gl.domElement.dataset.spaceProgress=String(Math.round((s.progress||0)*1000)/1000);
   gl.domElement.dataset.cityDistance=String(Math.round(camera.position.distanceTo(new THREE.Vector3(...E.cityCenter))));
   gl.domElement.dataset.spaceWorld='single-continuous-scene';
 },.5);
 return <>
  <IndustrialPort/>
  <OceanRail runtime={runtime}/>
  <ElevatorTethers/>
  <Planet/>
  <City runtime={runtime} timeRef={timeRef} reducedMotion={reducedMotion}/>
  <CelestialVeil runtime={runtime}/>
  <ElevatorCabin cabin={cabin} runtime={runtime}/>
 </>;
}
