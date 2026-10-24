// Deterministic tube railway. Both server and renderer sample this same curve.
// Absolute room epoch; no browser timer can speed up a multiplayer train.
import {SPACE_ELEVATOR as E} from './space-layout.js';
export const RAIL = Object.freeze({dwell:18000,travel:48000,points:[[36,0,57],[175,14,42],[510,32,-250],[865,22,-760],[E.port.x-15,0,E.port.z+18]]});
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export function railPoint(t){
 const points=RAIL.points,u=clamp(t,0,1)*(points.length-1),i=Math.min(points.length-2,Math.floor(u)),f=u-i;
 const p0=points[Math.max(0,i-1)],p1=points[i],p2=points[i+1],p3=points[Math.min(points.length-1,i+2)];
 return p1.map((_,k)=>.5*((2*p1[k])+(-p0[k]+p2[k])*f+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*f*f+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*f*f*f));
}
const samples=Array.from({length:513},(_,i)=>railPoint(i/512));
const lengths=[0];for(let i=1;i<samples.length;i++)lengths[i]=lengths[i-1]+Math.hypot(...samples[i].map((v,k)=>v-samples[i-1][k]));
export const RAIL_LENGTH=lengths.at(-1);
export function railArc(f){
 const d=clamp(f,0,1)*RAIL_LENGTH;let lo=0,hi=512;
 while(lo+1<hi){const mid=(lo+hi)>>1;if(lengths[mid]<d)lo=mid;else hi=mid;}
 return (lo+(d-lengths[lo])/(lengths[hi]-lengths[lo]))/512;
}
export function railFrame(progress){
 const t=railArc(progress),position=railPoint(t),a=railPoint(Math.max(0,t-.0001)),b=railPoint(Math.min(1,t+.0001));
 return {position,yaw:Math.atan2(b[0]-a[0],b[2]-a[2])};
}
export function sampleRail(epoch,time,from=0){
 const waiting=epoch<0&&time<-epoch,start=Math.abs(epoch),elapsed=Math.max(0,time-start),departing=!!epoch&&!waiting&&elapsed<2000,raw=epoch&&!waiting?clamp((elapsed-2000)/RAIL.travel,0,1):0;
 const e=raw*raw*raw*(10+raw*(-15+6*raw)),progress=from===1?1-e:e,docked=!epoch||waiting||raw===1,station=docked?(raw===1?1-from:from):-1;
 return {...railFrame(progress),progress,docked,station,departing,dwellRemaining:waiting?Math.ceil((-epoch-time)/1000):0,remaining:docked?0:Math.ceil((RAIL.travel+2000-elapsed)/1000),direction:from===1?-1:1};
}
// A negative departure epoch denotes open doors until its absolute timestamp.
// Both server and solo simulation advance the same schedule, including long sleeps.
export function advanceRailSchedule(epoch,time,from=0){
 if(!epoch)return {railEpoch:-(time+RAIL.dwell),railFrom:from};
 const start=Math.abs(epoch),arrival=start+2000+RAIL.travel;
 if(time<arrival)return {railEpoch:time<start?-start:start,railFrom:from};
 const cycle=RAIL.dwell+2000+RAIL.travel,n=Math.floor((time-arrival)/cycle),departure=arrival+n*cycle+RAIL.dwell;
 return {railEpoch:time<departure?-departure:departure,railFrom:(1-from+n)%2};
}
export function nearRailStation(p){return RAIL.points.reduce((best,at,i)=>i!==0&&i!==RAIL.points.length-1?best:Math.hypot(p.x-at[0],p.z-at[2])<12?(i===0?0:1):best,-1);}
export function railLocal(p,train){const dx=p.x-train.position[0],dz=p.z-train.position[2],c=Math.cos(train.yaw),s=Math.sin(train.yaw);return {railX:dx*c-dz*s,railZ:dx*s+dz*c};}
export function canBoardRail(p,train){const l=railLocal(p,train);return train.docked&&!p.aboard&&(!p.spaceMode||p.spaceMode==='ground')&&p.y>=0&&p.y<.5&&Math.abs(l.railX)<2.7&&Math.abs(l.railZ)<2.2;}
export function railPassenger(p,train){const x=clamp(Number(p.railX)||0,-1.2,1.2),z=clamp(Number(p.railZ)||0,-5.5,5.5),c=Math.cos(train.yaw),s=Math.sin(train.yaw);return {railX:x,railZ:z,x:train.position[0]+x*c+z*s,y:train.position[1],z:train.position[2]-x*s+z*c,yaw:(p.railYaw||0)+train.yaw,spaceMode:'rail',vy:0,jetpack:false,thrusting:false,hovering:false,moving:!!p.moving};}
export function stepRail(p,input,dt){let x=Number(input?.x)||0,z=Number(input?.z)||0;const n=Math.hypot(x,z);if(n>1){x/=n;z/=n;}const d=3*Math.max(0,Math.min(.1,dt));return {...p,railX:clamp((p.railX||0)+x*d,-1.2,1.2),railZ:clamp((p.railZ||0)+z*d,-5.5,5.5),railYaw:n>.001?Math.atan2(x,z):p.railYaw,moving:n>.001};}
export function railExit(p,train){return {...railPassenger(p,train),spaceMode:'ground',railX:0,railZ:0,railYaw:0,moving:false};}
