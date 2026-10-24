import { FARM_RACKS, FARM_SITES } from '../../../shared/farmLayout.js';

// Axis-aligned, low-poly process hardware, built inside existing collision
// envelopes. Shared source-water runs are BELOW the walking deck, never hoses
// across visitor aisles. Nutrient/return loops stay inside their own rack.
export const PROCESS_COLORS = Object.freeze({ water:'#60abc9', nutrient:'#d4a45b', return:'#58a995', reject:'#b66f69', light:'#e5c780', metal:'#7c9d91', cream:'#e8e1cb' });
export function buildFarmProcessParts() {
  const parts = [], markers = [];
  let owner;
  const add = (kind, id, x,y,z,sx,sy,sz,color,rx=0,ry=0,rz=0) => parts.push({kind,id,...owner,x,y,z,sx,sy,sz,color,rx,ry,rz});
  const box = (id,x,y,z,sx,sy,sz,c) => add('box',id,x,y,z,sx,sy,sz,c);
  const cylinder = (id,x,y,z,sx,sy,sz,c,rx=0,ry=0,rz=0) => add('cylinder',id,x,y,z,sx,sy,sz,c,rx,ry,rz);
  const pipe = (id,a,b,color,width=.075) => {
    const axis = a.findIndex((v,i)=>Math.abs(v-b[i])>1e-8);
    if(axis<0)return;
    const length=Math.abs(a[axis]-b[axis]);
    if(a.some((v,i)=>i!==axis&&Math.abs(v-b[i])>1e-8))throw Error('Process pipe must be axis aligned');
    cylinder(id,...a.map((v,i)=>(v+b[i])/2),width,length,width,color,axis===2?Math.PI/2:0,0,axis===0?Math.PI/2:0);
  };
  const valve = (id,x,y,z,color) => {
    box(id,x,y,z,.2,.16,.16,color);box(id,x,y+.15,z,.38,.05,.06,PROCESS_COLORS.metal);
  };
  for(const site of FARM_SITES) {
    owner={hallIndex:site.index,scope:'utility',ownerId:`water-${site.index}`};
    const z=site.z-3.9, id=`H${site.index+1}`;
    // Air gap inlet, transparent level tube, overflow to contained drain.
    pipe(`${id}-TK`,[-70,2.94,z+.2],[-69.4,2.94,z+.2],PROCESS_COLORS.water);
    pipe(`${id}-TK`,[-69.4,2.94,z+.2],[-69.4,2.55,z+.2],PROCESS_COLORS.water);
    cylinder(`${id}-TK`,-69.4,2.4,z+.2,.22,.06,.22,PROCESS_COLORS.metal);
    pipe(`${id}-TK`,[-70,-.3,z],[-70,.3,z],PROCESS_COLORS.water);
    cylinder(`${id}-TK`,-69.14,1.2,z+.4,.07,1.9,.07,PROCESS_COLORS.water);
    box(`${id}-TK`,-70,.12,z,2.12,.2,2.3,PROCESS_COLORS.metal);
    for(const dx of [-.5,.1]) {
      cylinder(`${id}-F`,-70+dx,.8,z-.95,.28,1.15,.28,PROCESS_COLORS.cream);
      cylinder(`${id}-F`,-70+dx,1.42,z-.95,.34,.09,.34,PROCESS_COLORS.water);
    }
    pipe(`${id}-F`,[-70.5,1.42,z-.95],[-69.9,1.42,z-.95],PROCESS_COLORS.water);
    pipe(`${id}-F`,[-69.9,1.42,z-.95],[-69.9,2.94,z-.95],PROCESS_COLORS.water);
    pipe(`${id}-F`,[-69.9,2.94,z-.95],[-70,2.94,z-.95],PROCESS_COLORS.water);
    pipe(`${id}-F`,[-70,2.94,z-.95],[-70,2.94,z+.2],PROCESS_COLORS.water);
    pipe(`${id}-F`,[-70.5,.3,z-.95],[-70.5,-.3,z-.95],PROCESS_COLORS.water);
    valve(`${id}-F`,-70.5,.45,z-.95,PROCESS_COLORS.water);
    owner={hallIndex:site.index,scope:'underdeck',ownerId:`water-${site.index}`};
    pipe(`${id}-TK`,[-70,-.3,z],[-44.1,-.3,z],PROCESS_COLORS.water,.12);
    for(const rack of FARM_RACKS.filter(r=>r.hallIndex===site.index)) {
      pipe(`${id}-TK`,[rack.x,-.3,z],[rack.x,-.3,rack.z],PROCESS_COLORS.water);
      pipe(`${id}-TK`,[rack.x,-.3,rack.z],[rack.x-3.4,-.3,rack.z],PROCESS_COLORS.water);
    }
    owner={hallIndex:site.index,scope:'utility',ownerId:`treatment-${site.index}`};
    // Cabinet: isolated reject/quality-hold tanks, not a cross-crop return mixer.
    for(const dx of [-.55,.4])cylinder(`${id}-F`,-70+dx,.8,site.z+3.9,.6,1.4,.6,dx<0?PROCESS_COLORS.reject:PROCESS_COLORS.cream);
    box(`${id}-F`,-70,.12,site.z+3.9,2.15,.2,2.3,PROCESS_COLORS.metal);
    owner={hallIndex:site.index,scope:'utility',ownerId:`cooling-${site.index}`};
    for(const dz of [-.6,.5]) {
      cylinder(`${id}-HX`,-38,2.2,z+dz,1.5,.12,1.5,PROCESS_COLORS.metal,Math.PI/2);
      for(const dx of [-.35,.35])box(`${id}-HX`,-38+dx,2.2,z+dz-.08,.08,.9,.06,PROCESS_COLORS.cream);
    }
    owner={hallIndex:site.index,scope:'utility',ownerId:`packing-${site.index}`};
    const pz=site.z+9.5;
    // Receiving table matches a single 2.8 x 3.6m half-tray; real conveyor
    // rollers, load-cell feet, scanner, cool-buffer door and quarantine bin.
    box(`${id}-RC`,-69.6,2.78,pz,2.94,.12,3.5,PROCESS_COLORS.metal);
    for(let k=0;k<9;k++)cylinder(`${id}-RC`,-69.6,2.9,pz-1.5+k*.375,.095,2.8,.095,PROCESS_COLORS.cream,0,0,Math.PI/2);
    for(const dx of [-1.2,1.2])for(const dz of [-1.4,1.4])box(`${id}-RC`,-69.6+dx,.18,pz+dz,.24,.3,.24,PROCESS_COLORS.light);
    box(`${id}-QC`,-69.6,1.35,pz-1.72,2.5,2.3,.06,'#c2d8c8');
    box(`${id}-QC`,-68.5,1.35,pz-1.77,.06,.5,.04,PROCESS_COLORS.metal);
    box(`${id}-RC`,-70.82,2.4,pz-1.5,.25,.3,.2,'#344f5e');
    box(`${id}-QC`,-70.55,.6,pz+.95,.65,1,.7,PROCESS_COLORS.reject);
    markers.push({kind:'receiving',hallIndex:site.index,x:-68.4,y:2.5,z:pz+1.5});
  }
  for(const rack of FARM_RACKS) {
    const {x,z}=rack, id=rack.id.toUpperCase();
    owner={rackId:rack.id,hallIndex:rack.hallIndex,scope:'rack',ownerId:rack.id};
    const back=z+1.49;
    // Wet-end service cassette, contained in rack footprint (no visitor hazards).
    box(`${id}-MX`,x-2.7,.48,back,1.6,.7,.45,PROCESS_COLORS.return);
    box(`${id}-MX`,x-2.7,.86,back,1.65,.07,.49,PROCESS_COLORS.cream);
    for(const [i,[dx,code,c]] of [[-.9,'DA',PROCESS_COLORS.nutrient],[-.45,'DB','#c7ad71']].entries()) {
      cylinder(`${id}-${code}`,x+dx,.6,back,.32,1,.32,c);
      box(`${id}-${code}`,x+dx,1.16,back,.27,.14,.24,PROCESS_COLORS.metal);
      // Separate concentrate lines all the way to distinct dilution ports.
      // No A/B tee upstream of the water-filled mixing tank.
      const yy=1.4+i*.14,zz=back+(i? .12:-.12),port=x-2.9+i*.4;
      pipe(`${id}-${code}`,[x+dx,1.27,back],[x+dx,1.27,zz],c,.04);
      pipe(`${id}-${code}`,[x+dx,1.27,zz],[x+dx,yy,zz],c,.04);
      pipe(`${id}-${code}`,[x+dx,yy,zz],[port,yy,zz],c,.04);
      pipe(`${id}-${code}`,[port,yy,zz],[port,.86,zz],c,.04);
    }
    box(`${id}-PH`,x-.55,.12,back,1.2,.12,.5,PROCESS_COLORS.metal);
    for(const [i,dx] of [.12,.5].entries()) {
      const zz=back-.12,yy=1.7+i*.14,port=x-2.65+i*.4;
      cylinder(`${id}-PH`,x+dx,.5,back,.23,.65,.23,i?PROCESS_COLORS.water:PROCESS_COLORS.reject);
      box(`${id}-PH`,x+dx,.89,back,.2,.12,.22,PROCESS_COLORS.metal);
      box(`${id}-PH`,x+dx,.12,back,.34,.12,.48,PROCESS_COLORS.metal);
      pipe(`${id}-PH`,[x+dx,.95,back],[x+dx,.95,zz],PROCESS_COLORS.reject,.025);
      pipe(`${id}-PH`,[x+dx,.95,zz],[x+dx,yy,zz],PROCESS_COLORS.reject,.025);
      pipe(`${id}-PH`,[x+dx,yy,zz],[port,yy,zz],PROCESS_COLORS.reject,.025);
      pipe(`${id}-PH`,[port,yy,zz],[port,.86,zz],PROCESS_COLORS.reject,.025);
    }
    cylinder(`${id}-P`,x-3.55,.43,back,.35,.6,.35,PROCESS_COLORS.water,0,0,Math.PI/2);
    cylinder(`${id}-P`,x-3.55,.77,back,.22,.08,.22,PROCESS_COLORS.cream,Math.PI/2);
    box(`${id}-SN`,x+1.05,.75,back,.65,1.2,.4,PROCESS_COLORS.cream);
    box(`${id}-SN`,x+1.05,.94,back-.22,.49,.36,.04,'#345b56');
    for(const dx of [-.35,0,.35]) {
      cylinder(`${id}-SN`,x-2.7+dx,.72,back-.08,.045,.42,.045,PROCESS_COLORS.cream);
      pipe(`${id}-SN`,[x-2.7+dx,.95,back-.08],[x-2.7+dx,1.03,back-.08],PROCESS_COLORS.metal,.025);
    }
    cylinder(`${id}-UV`,x+2.75,.6,back,.32,1,.32,PROCESS_COLORS.metal);
    box(`${id}-UV`,x+2.75,.6,back-.18,.08,.65,.03,'#a69fc9');
    cylinder(`${id}-UV`,x+3.3,.6,back,.28,1,.28,PROCESS_COLORS.cream);
    box(`${id}-AIR`,x+1.9,.22,back,.5,.35,.4,PROCESS_COLORS.water);
    pipe(`${id}-AIR`,[x+1.9,.45,back],[x-2.7,.45,back],PROCESS_COLORS.water,.035);
    const top=rack.tierHeights.at(-1)+.3;
    pipe(`${id}-P`,[x-3.72,.35,back],[x-3.72,top,back],PROCESS_COLORS.nutrient,.1);
    pipe(`${id}-UV`,[x+3.72,.35,back],[x+3.72,top,back],PROCESS_COLORS.return,.13);
    pipe(`${id}-UV`,[x+3.72,.35,back],[x+3.3,.35,back],PROCESS_COLORS.return);
    pipe(`${id}-UV`,[x+3.3,1.1,back],[x+2.75,1.1,back],PROCESS_COLORS.return);
    pipe(`${id}-UV`,[x+2.75,.35,back],[x-2.7,.35,back],PROCESS_COLORS.return);
    pipe(`${id}-MX`,[x-3.4,-.3,z],[x-3.4,1.2,z],PROCESS_COLORS.water);
    pipe(`${id}-MX`,[x-3.4,1.2,z],[x-3.4,1.2,back],PROCESS_COLORS.water);
    pipe(`${id}-MX`,[x-3.4,1.2,back],[x-3.2,1.2,back],PROCESS_COLORS.water);
    pipe(`${id}-MX`,[x-3.2,1.2,back],[x-3.2,1.04,back],PROCESS_COLORS.water);
    pipe(`${id}-P`,[x-3.55,.4,back],[x-3.72,.4,back],PROCESS_COLORS.nutrient);
    for(const y of rack.tierHeights) {
      pipe(`${id}-SV`,[x-3.72,y+.22,back],[x+3.4,y+.22,back],PROCESS_COLORS.nutrient,.055);
      pipe(`${id}-SV`,[x-3.4,y-.04,z-1.48],[x+3.72,y-.04,z-1.48],PROCESS_COLORS.return,.07);
      pipe(`${id}-SV`,[x+3.72,y-.04,z-1.48],[x+3.72,y-.04,back],PROCESS_COLORS.return,.07);
      valve(`${id}-SV`,x-3.4,y+.22,back,PROCESS_COLORS.nutrient);
      for(const dx of [-2.7,-.9,.9,2.7]) {
        pipe(`${id}-SV`,[x+dx,y+.16,z-1.15],[x+dx,y+.16,back],PROCESS_COLORS.nutrient,.025);
        for(const dz of [-.7,.45])cylinder(`${id}-SV`,x+dx,y+.1,z+dz,.09,.14,.09,PROCESS_COLORS.metal);
      }
      const lampY=y+(rack.hallIndex===0?1.8:rack.hallIndex===1?3.4:2.5);
      for(const dz of [-1.05,-.35,.35,1.05])box(`${id}-LED`,x,lampY+.06,z+dz,6.8,.1,.15,PROCESS_COLORS.cream);
      box(`${id}-LED`,x+3.45,lampY,back,.28,.28,.2,PROCESS_COLORS.metal);
      pipe(`${id}-LED`,[x+3.45,lampY,back],[x+3.45,y+.6,back],PROCESS_COLORS.light,.035);
      box(`${id}-PAR`,x+3.35,y+.6,z-1.5,.22,.13,.22,PROCESS_COLORS.cream);
      cylinder(`${id}-PAR`,x+3.35,y+.7,z-1.5,.12,.05,.12,PROCESS_COLORS.light);
      // Distributed air-mixing fans; these are equipment locations, not CFD.
      cylinder(`${id}-FAN`,x+2.6,y+1.25,back,.48,.12,.48,PROCESS_COLORS.metal,Math.PI/2);
      box(`${id}-FAN`,x+2.6,y+1.25,back-.08,.38,.04,.04,PROCESS_COLORS.cream);
      box(`${id}-FAN`,x+2.6,y+1.25,back-.08,.04,.38,.04,PROCESS_COLORS.cream);
    }
    markers.push({kind:'irrigation',rackId:rack.id,hallIndex:rack.hallIndex,x:x-3.72,y:1.7,z:back-.08});
    markers.push({kind:'dosing',rackId:rack.id,hallIndex:rack.hallIndex,x:x-.65,y:1.45,z:back-.08});
    markers.push({kind:'treatment',rackId:rack.id,hallIndex:rack.hallIndex,x:x+2.75,y:1.25,z:back-.08});
  }
  return {parts,markers};
}
