import {useEffect,useRef} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import FirstPersonLook from '../town/FirstPersonLook.jsx';
import {spectatorPose} from './spectatorOrbit.js';
export default function SpectatorOrbit({poseRef,inputRef,recenterRef,onStatus,program}){
 const {gl}=useThree(),look=useRef({yaw:0,pitch:0}),zoom=useRef(1),lastReset=useRef(recenterRef?.current);
 useEffect(()=>{look.current={yaw:0,pitch:0};zoom.current=1;},[program]);
 useEffect(()=>{const wheel=e=>{e.preventDefault();zoom.current=Math.max(.45,Math.min(2.5,zoom.current*Math.exp(Math.max(-300,Math.min(300,e.deltaY))*.0015)));};gl.domElement.addEventListener('wheel',wheel,{passive:false});return()=>{gl.domElement.removeEventListener('wheel',wheel);delete gl.domElement.dataset.spectatorOrbit;};},[gl]);
 useFrame(({camera})=>{
  const pose=poseRef.current;if(!pose||!camera.isPerspectiveCamera)return;
  if(lastReset.current!==recenterRef?.current){lastReset.current=recenterRef?.current;look.current={yaw:0,pitch:0};zoom.current=1;}
  const action=inputRef?.current?.orbitAction;if(action&&inputRef.current){delete inputRef.current.orbitAction;const l=look.current;
   if(action==='left')l.yaw-=.18;if(action==='right')l.yaw+=.18;if(action==='up')l.pitch+=.12;if(action==='down')l.pitch-=.12;
   if(action==='in')zoom.current=Math.max(.45,zoom.current/1.2);if(action==='out')zoom.current=Math.min(2.5,zoom.current*1.2);
  }
  const result=spectatorPose(pose,look.current,zoom.current);
  camera.position.set(...result.position);camera.lookAt(...result.target);if(camera.far<result.far){camera.far=result.far;camera.updateProjectionMatrix();}camera.updateMatrixWorld();
  gl.domElement.dataset.spectatorOrbit=JSON.stringify({yaw:look.current.yaw,pitch:look.current.pitch,zoom:zoom.current,position:result.position});
 },-.09);
 return <FirstPersonLook enabled active orbitOnly lookRef={look} onStatus={onStatus}/>;
}
