// A single continuous world, in visual metres. Not a real orbital engineering scale.
import { stationPoseFrame, RING_STATION } from '../src/orbit/shared/ringStation.js';
import {SPACE_ELEVATOR} from './space-layout.js';
export {SPACE_ELEVATOR,inSpacePort} from './space-layout.js';
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,s)=>a.map(v=>v*s);
const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
const norm=a=>mul(a,1/Math.hypot(...a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const axisX=norm(mul(SPACE_ELEVATOR.cityCenter,-1));
const axisY=norm(sub([0,1,0],mul(axisX,dot(axisX,[0,1,0]))));
const axisZ=cross(axisX,axisY);
export const CITY_BASIS=Object.freeze([axisX,axisY,axisZ].map(Object.freeze));
export function cityDirection(p){return [0,1,2].map(i=>p[0]*axisX[i]+p[1]*axisY[i]+p[2]*axisZ[i]);}
const centre=[RING_STATION.centerX,RING_STATION.centerY,RING_STATION.centerZ];
export function cityToWorld(p){return add(SPACE_ELEVATOR.cityCenter,cityDirection(sub(p,centre)));}
export function worldToCity(p){const d=sub(p,SPACE_ELEVATOR.cityCenter);return add(centre,CITY_BASIS.map(axis=>dot(d,axis)));}
export function orbitWorldPose(p){
 const f=stationPoseFrame(p);return {position:cityToWorld(f.position),up:cityDirection(f.normal),tangent:cityDirection(f.tangent),rotationX:f.rotationX};
}
export const ELEVATOR_BOTTOM=Object.freeze([SPACE_ELEVATOR.port.x,0,SPACE_ELEVATOR.port.z]);
export const ELEVATOR_TOP=Object.freeze(orbitWorldPose(SPACE_ELEVATOR.dock).position);
export function elevatorProgress(elapsed){const t=Math.max(0,Math.min(1,(elapsed-4000)/(SPACE_ELEVATOR.durationMs-8000)));return t*t*t*(10+t*(-15+6*t));}
export function sampleElevator(elapsed,direction='ascent'){
 const q=elevatorProgress(elapsed),p=direction==='descent'?1-q:q;
 const position=add(ELEVATOR_BOTTOM,mul(sub(ELEVATOR_TOP,ELEVATOR_BOTTOM),p));
 const ringUp=orbitWorldPose(SPACE_ELEVATOR.dock).up;
 const up=norm(add(mul([0,1,0],1-p),mul(ringUp,p)));
 return {position,up,progress:p,arrived:elapsed>=SPACE_ELEVATOR.durationMs};
}

export function canAscend(p){return !p.aboard&&(!p.spaceMode||p.spaceMode==='ground')&&Math.hypot(p.x-ELEVATOR_BOTTOM[0],p.z-ELEVATOR_BOTTOM[2])<2.1&&p.y>=0&&p.y<.5;}
export function canDescend(p){return p.spaceMode==='orbit'&&Math.hypot(p.orbitX-SPACE_ELEVATOR.dock.x,p.orbitZ-SPACE_ELEVATOR.dock.z)<2.1&&p.orbitY<.5;}
export function celestialAngularDiameter(){return 2*Math.atan(SPACE_ELEVATOR.envelopeRadius/Math.hypot(...SPACE_ELEVATOR.cityCenter))*180/Math.PI;}

export const SPACE_ACTIONS=Object.freeze(['ascend','descend','rail-board','rail-exit','rail-depart','rail-call']);
export function validSpaceAction(v,last=-1){return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>['action','seq'].includes(k))&&SPACE_ACTIONS.includes(v.action)&&Number.isSafeInteger(v.seq)&&v.seq>=0&&v.seq>last;}
export function orbitState(p){return {x:p.orbitX,y:p.orbitY,z:p.orbitZ,yaw:p.yaw,vy:p.vy,moving:p.moving,jetpack:p.jetpack,hovering:p.hovering,thrusting:p.thrusting};}
export function placeInOrbit(p,local){const world=orbitWorldPose(local);return {...local,x:world.position[0],y:world.position[1],z:world.position[2],orbitX:local.x,orbitY:local.y,orbitZ:local.z,spaceMode:'orbit'};}
export function advanceElevator(p,time){
 const shot=sampleElevator(Math.max(0,time-p.spaceStartAt),p.spaceMode);
 if(shot.arrived){return p.spaceMode==='ascent'?placeInOrbit(p,{...SPACE_ELEVATOR.dock,vy:0,moving:false,jetpack:false,thrusting:false,hovering:false}):{x:ELEVATOR_BOTTOM[0],y:0,z:ELEVATOR_BOTTOM[2],yaw:0,vy:0,moving:false,jetpack:false,thrusting:false,hovering:false,spaceMode:'ground'};}
 return {x:shot.position[0],y:shot.position[1],z:shot.position[2],vy:0,moving:false,jetpack:false,thrusting:false,hovering:false};
}

// Keep the same timebase if a socket drops mid-ride. Never subtract an epoch
// start timestamp from performance.now(), which would snap the cabin to origin.
export function spaceClockTime(state,snapshot,perf){
 if(snapshot&&Number.isFinite(snapshot.serverTime)&&snapshot.serverTime>0&&Number.isFinite(snapshot.receivedAtPerf))state.clockOffset=snapshot.serverTime-snapshot.receivedAtPerf;
 return perf+(Number.isFinite(state.clockOffset)?state.clockOffset:0);
}
