const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function spectatorPose(pose,look={},zoom=1){
 const {position:p,target:t}=pose;
 if(!Array.isArray(p)||!Array.isArray(t)||p.length!==3||t.length!==3||![...p,...t].every(Number.isFinite))throw Error('Invalid spectator pose');
 const yaw=Number.isFinite(look.yaw)?look.yaw:0,pitch=Number.isFinite(look.pitch)?look.pitch:0,z=clamp(Number.isFinite(zoom)?zoom:1,.45,2.5);
 if(!yaw&&!pitch&&z===1)return {...pose,position:[...p],target:[...t]};
 const d=p.map((v,i)=>v-t[i]),r=Math.max(2,Math.hypot(...d)*z),theta=Math.atan2(d[0],d[2])-yaw,phi=clamp(Math.acos(clamp(d[1]/Math.max(.001,Math.hypot(...d)),-1,1))-pitch,.08,Math.PI-.08);
 const position=[t[0]+r*Math.sin(phi)*Math.sin(theta),Math.max(1.2,t[1]+r*Math.cos(phi)),t[2]+r*Math.sin(phi)*Math.cos(theta)];
 return {...pose,position,target:[...t],far:Math.max(pose.far||600,r*2+Math.hypot(...t))};
}
