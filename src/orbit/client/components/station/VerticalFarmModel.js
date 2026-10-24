import * as THREE from 'three';
import { FARM_SITE,FARM_SITES,FARM_APPROACHES,FARM_RACKS,FARM_UTILITIES,FARM_TOTAL_AREA_M2 } from '../../../shared/farmLayout.js';
import { farmLightOn,farmLightFactor,farmJobTiming } from '../../../shared/farmSimulation.js';
import { FARM_CROPS } from '../../../shared/farmCrops.js';
import { stationWorldMatrix } from './stationWorldGeometry.js';
import { farmProcessState } from '../../../shared/farmEngineering.js';
import { buildFarmProcessParts } from './FarmProcessModel.js';

// Native low-poly geometry, not image impostors: every crop has a botanical
// silhouette (rosette, white petiole, berry, truss, lobed fruit, tuber, ear, pod).
// Representative display plants are NOT a plant-count or yield estimator.
export function createVerticalFarmModel(){
 const root=new THREE.Group();root.name='three-hall autonomous agriculture campus';root.userData.coordinateSpace='logical';
 const geometries=new Set(),materials=new Set();const own=g=>{geometries.add(g);return g;};
 const mat=o=>{const m=new THREE.MeshStandardMaterial({roughness:.8,...o});materials.add(m);return m;};
 const solid=mat({color:'#ffffff'}),metal=mat({color:'#ffffff',metalness:.1,roughness:.6}),glass=mat({color:'#b7ddd1',transparent:true,opacity:.1,depthWrite:false,side:THREE.DoubleSide});glass.forceSinglePass=true;
 const lighting=mat({color:'#fff0d0',emissive:'#ffe4ae',emissiveIntensity:.6,toneMapped:false});
 const plantMat=mat({color:'#ffffff',roughness:.92}),statusMat=mat({color:'#ffffff',emissive:'#4a7662',emissiveIntensity:.1});
 const boxG=own(new THREE.BoxGeometry(1,1,1)),leafG=own(new THREE.IcosahedronGeometry(1,0)),sphereG=own(new THREE.SphereGeometry(1,8,6)),cylG=own(new THREE.CylinderGeometry(.5,.5,1,8)),coneG=own(new THREE.ConeGeometry(1,2,8));
 const specs=[['cream-and-mint structural cassettes',boxG,solid],['utility machinery and trellises',boxG,metal],['observation glazing',boxG,glass],['water and process tanks',cylG,metal]] .map(([name,g,m])=>({name,g,m,parts:[]}));
 const [arch,hardware,windows,tanks]=specs;
 const add=(b,x,y,z,sx,sy,sz,color='#eae9db',approachId=null)=>b.parts.push({x,y,z,sx,sy,sz,color,approachId});
 for(const p of FARM_APPROACHES)add(arch,p.x,.04,p.z,p.width,.02,p.depth,'#c6decb',p.id);
 for(const site of FARM_SITES){const z=site.z;
  add(arch,-54,.02,z,40,.035,28,'#d4dbcc');add(arch,-54,.05,z,3.2,.015,28,'#bdd9cc');
  for(const dz of [-3.9,3.9])add(arch,-54,.06,z+dz,34.6,.012,2,'#c7ddcb');
  for(let i=0;i<6;i++){const zz=z-10+i*4;
    add(arch,-54,31.8,zz,36,.4,3.92,'#e9e7d5');add(arch,-54,31.99,zz,3,.02,3.9,['#76aa91','#d3a574','#b8aa63'][site.index]);
    for(const x of [-71.75,-36.25]){
      add(arch,x,.5,zz,.5,1,3.94);add(windows,x,15.6,zz,.12,29,3.5,'#c4e5dc');
      for(const y of [10.5,21,31])add(arch,x,y,zz,.5,.5,3.94,'#89b4a0');
    }
  }
  for(let i=0;i<=6;i++)for(const x of [-71.75,-36.25])add(arch,x,15.8,z-11.75+i*23.5/6,.5,31.6,.42,'#92bba7');
  for(const dz of [-11.75,11.75]){
    for(const x of [-63.8,-44.2]){add(arch,x,.5,z+dz,16.4,1,.5);add(windows,x,15.7,z+dz,15.9,29.5,.12,'#c1dfd2');for(const dx of [-8,-4,0,4,8])add(arch,x+dx,15.8,z+dz,.28,31.6,.5,'#a1c1ad');}
    add(arch,-54,4.1,z+dz,3.2,.6,.5,'#83b69a');add(windows,-54,18,z+dz,3.2,27.2,.12,'#c1dfd2');
    // Enormous repeated shelf rhythm, not an empty high warehouse.
    for(const x of [-55.75,-52.25])add(arch,x,1.9,z+dz,.3,3.8,.5,'#80a78f');
  }
  // Overhead shuttle: all travelling hardware stays above the visitor zone.
  for(const x of [-71.3,-36.7])add(hardware,x,31.2,z,.16,.18,22,'#8d9f99');
  add(hardware,-54,31.2,z,34.6,.12,.16,'#879c94');
  add(windows,-54,30.4,z,35.1,.035,22,'#adc7b3');
 }
 for(const rack of FARM_RACKS){
  for(const x of [rack.x-3.8,rack.x+3.8])for(const z of [rack.z-1.6,rack.z+1.6])add(hardware,x,15.25,z,.14,30.5,.14,'#739885');
  for(const y of rack.tierHeights){
   add(hardware,rack.x,y-.14,rack.z,7.8,.16,3.2,'#cbd9c9');
   add(hardware,rack.x,y,rack.z,7.2,.12,2.8,rack.cropId==='potato'?'#7e7766':'#a2bdad');
   if(rack.cropId==='potato'){
    // Explicit cutaway observation window: no opaque box secretly hiding tubers.
    add(hardware,rack.x,y-.7,rack.z,7.2,.06,2.8,'#5b6557');
    add(windows,rack.x,y-.42,rack.z,7.2,.55,2.8,'#c2d7c0');
    add(windows,rack.x,y-.4,rack.z-1.41,7,.5,.015,'#d4dec1');
   }
  }
 }
 for(const item of FARM_UTILITIES){if(item.role==='terminal')continue;
   const hardwareStart=hardware.parts.length,tankStart=tanks.parts.length;
   if(item.role==='water')add(tanks,item.x,1.2,item.z+.2,1.7,2.4,1.7,'#9dcabc');
   else if(item.role==='gas-seeds'){for(const dx of [-.5,.5])add(tanks,item.x+dx,1.1,item.z-.5,.65,2.2,.65,'#bcb5c8');add(hardware,item.x,1.25,item.z+.7,2.2,2.5,.9,'#ddd8bf');}
   else if(item.role!=='treatment'){add(hardware,item.x,item.height/2,item.z,item.width,item.height,item.depth,item.role==='packing'?'#d7cead':'#a0c2b2');for(let i=0;i<4;i++)add(hardware,item.x,.5+i*.4,item.z-1.22,1.7,.08,.05,'#6d998a');}
   const code={water:'TK',cooling:'HX',packing:'RC'}[item.role];
   if(code)for(const part of [...hardware.parts.slice(hardwareStart),...tanks.parts.slice(tankStart)])part.id=`H${item.hallIndex+1}-${code}`;
 }
 const process=buildFarmProcessParts();
 for(const e of process.parts)(e.kind==='cylinder'?tanks:hardware).parts.push(e);
 root.userData.processParts=process.parts;
 const q=new THREE.Quaternion(),euler=new THREE.Euler(),p=new THREE.Vector3(),scale=new THREE.Vector3(),m=new THREE.Matrix4(),color=new THREE.Color();
 for(const b of specs){const mesh=new THREE.InstancedMesh(b.g,b.m,b.parts.length);mesh.name=b.name;mesh.castShadow=b!==windows;mesh.receiveShadow=true;mesh.userData.parts=b.parts.map(e=>({approachId:e.approachId,equipmentId:e.id}));b.parts.forEach((e,i)=>{q.setFromEuler(euler.set(e.rx||0,e.ry||0,e.rz||0));m.compose(p.set(e.x,e.y,e.z),q,scale.set(e.sx,e.sy,e.sz));mesh.setMatrixAt(i,m);mesh.setColorAt(i,color.set(e.color));});mesh.computeBoundingBox();mesh.computeBoundingSphere();root.add(mesh);}
 for(const item of FARM_UTILITIES.filter(u=>u.role==='terminal')){
  const terminal=new THREE.Mesh(boxG,metal);terminal.name='farm operations terminal';terminal.position.set(item.x,.8,item.z);terminal.scale.set(1.1,1.6,.7);terminal.userData.farmTerminal=true;root.add(terminal);
  const screen=new THREE.Mesh(boxG,statusMat);screen.position.set(item.x,1.15,item.z-.36);screen.scale.set(.85,.54,.03);screen.userData.farmTerminal=true;root.add(screen);
 }
 const raw=new THREE.Group();raw.userData.stationSpace='raw';raw.name='mapped crops and state-driven shuttle equipment';root.add(raw);
 const parts=[],cropPoints=[];
 const part=(plant,kind,dx,dy,dz,sx,sy,sz,c,rx=0,ry=0,rz=0)=>parts.push({plant,kind,dx,dy,dz,sx,sy,sz,c,rx,ry,rz});
 for(let ri=0;ri<FARM_RACKS.length;ri++){const rack=FARM_RACKS[ri];for(const [tierIndex,y] of rack.tierHeights.entries())for(let row=0;row<2;row++)for(let col=0;col<6;col++){
  const plant=cropPoints.length;cropPoints.push({rackIndex:ri,trayIndex:tierIndex*2+(col>=3?1:0),x:rack.x+(col-2.5)*1.08,z:rack.z+(row-.5)*1.12,y:y+.08,variation:.94+((row+col)%3)*.04});
  const crop=rack.cropId;
  const leaf=(dx,dy,dz,sx,sy,sz,c,angle=0,tilt=0)=>part(plant,'leaf',dx,dy,dz,sx,sy,sz,c,tilt,angle);
  const stem=(dx,dy,dz,h=.9,c='#638449')=>part(plant,'stem',dx,dy,dz,.035,h,.035,c);
  const fruit=(dx,dy,dz,sx,sy,sz,c,kind='fruit')=>part(plant,kind,dx,dy,dz,sx,sy,sz,c);
  if(crop==='lettuce')for(let n=0;n<8;n++){const a=n*Math.PI/4;leaf(Math.cos(a)*.15,.15+(n%2)*.08,Math.sin(a)*.15,.23,.12,.39,n%2?'#a7d36a':'#73b557',a,.3);}
  if(crop==='pakchoi')for(let n=0;n<7;n++){const a=n*Math.PI*2/7;part(plant,'stem',Math.cos(a)*.1,.24,Math.sin(a)*.1,.08,.4,.07,'#e7f0cb',0,a,.25);leaf(Math.cos(a)*.19,.48,Math.sin(a)*.19,.19,.12,.3,'#3c9053',a,.4);}
  if(crop==='basil'){stem(0,.43,0,.85);for(let n=0;n<3;n++)for(const s of [-1,1])leaf(s*.19,.25+n*.25,0,.23,.07,.16,'#56aa78',n*.5,s*.3);}
  if(crop==='strawberry'){
   for(let n=0;n<6;n++){const a=n*Math.PI/3;leaf(Math.cos(a)*.18,.3,Math.sin(a)*.18,.19,.07,.21,'#4c9954',a);}
   for(const dx of [-.25,.2]){fruit(dx,.15,-.28,.13,.18,.13,'#ec5160','cone');for(let n=0;n<4;n++)fruit(dx+(n%2-.5)*.09,.12+Math.floor(n/2)*.08,-.4,.012,.018,.012,'#ffdfa0');}
   for(let n=0;n<5;n++){const a=n*Math.PI*2/5;fruit(.18+Math.cos(a)*.06,.48,Math.sin(a)*.06,.055,.025,.04,'#fff7de');}fruit(.18,.5,0,.04,.025,.04,'#f4c448');
  }
  if(crop==='tomato'||crop==='pepper'){
   stem(0,1,0,2,'#668344');part(plant,'stem',.12,1.1,.12,.018,2.2,.018,'#9eaa98');
   for(let n=0;n<6;n++){const s=n%2?1:-1;leaf(s*.22,.45+n*.23,.08,.25,.07,.15,'#4a8f4d',n*.5);}
   if(crop==='tomato')for(let n=0;n<5;n++)fruit((n%2?-.2:.2),.55+Math.floor(n/2)*.3,-.22,.15,.15,.15,n===4?'#99b558':'#e85e43');
   else for(const dx of [-.22,.23])for(let n=0;n<3;n++){const a=n*Math.PI*2/3;fruit(dx+Math.cos(a)*.07,.7,-.22+Math.sin(a)*.07,.1,.22,.1,dx<0?'#edba45':'#e57648');}
  }
  if(crop==='potato'){for(let n=0;n<7;n++){const a=n*Math.PI*2/7;stem(Math.cos(a)*.08,.35,Math.sin(a)*.08,.65);leaf(Math.cos(a)*.22,.62,Math.sin(a)*.22,.21,.1,.27,'#5d9650',a);}for(let n=0;n<3;n++)fruit((n-1)*.19,-.3,-.3,.18,.12,.13,'#c6a47e');}
  if(crop==='wheat')for(let n=0;n<3;n++){const dx=(n-1)*.12;stem(dx,.52,0,1.05,'#b9ab54');leaf(dx,.35,0,.025,.04,.42,'#a6b765',.6,.65);for(let k=0;k<5;k++)for(const s of [-1,1])part(plant,'leaf',dx+s*.04,1+k*.065,0,.045,.07,.045,'#d9b951',0,0,s*.5);}
  if(crop==='soybean'){stem(0,.52,0,1.05);for(let n=0;n<3;n++)for(let k=0;k<3;k++){const a=k*Math.PI*2/3;leaf(Math.cos(a)*.18,.32+n*.26,Math.sin(a)*.18,.15,.06,.21,'#64955b',a);}for(const dx of [-.18,.2])for(let n=0;n<3;n++)fruit(dx,.5+n*.09,-.15,.065,.075,.055,'#9cba61');}
 }}
 const dynamic={};for(const [kind,g]of[['leaf',leafG],['stem',cylG],['fruit',sphereG],['cone',coneG]]){
  const entries=parts.filter(p=>p.kind===kind);const mesh=new THREE.InstancedMesh(g,plantMat,entries.length);mesh.name=`crop morphology ${kind}`;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.castShadow=false;raw.add(mesh);dynamic[kind]={mesh,entries};
 }
 const foliage=dynamic.leaf.mesh;
 const lampCount=FARM_RACKS.reduce((a,r)=>a+r.layers,0),lampGlow=new THREE.InstancedMesh(boxG,lighting,lampCount*4),indicators=new THREE.InstancedMesh(sphereG,statusMat,18+process.markers.length),robots=new THREE.InstancedMesh(boxG,metal,3*8);
 for(const [mesh,name]of[[lampGlow,'crop-specific photoperiod lighting'],[indicators,'module condition indicators'],[robots,'three state-driven tray shuttles']]){mesh.name=name;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);raw.add(mesh);}
 const data={cropPoints,parts,dynamic,foliage,lampGlow,indicators,robots,lighting,processMarkers:process.markers,processSignature:'',signature:'',robotSignature:'',disposed:false,m:new THREE.Matrix4(),world:new THREE.Matrix4(),q:new THREE.Quaternion(),e:new THREE.Euler(),p:new THREE.Vector3(),scale:new THREE.Vector3(),color:new THREE.Color()};root.userData.farm=data;
 root.userData.stats={rackModules:18,halls:3,activeGrowingAreaM2:FARM_TOTAL_AREA_M2,activeTrays:lampCount,expandingTrays:0,cropInstances:parts.length,drawCalls:specs.length+6+4+3,pointLights:0,maxHeight:32,geometries:geometries.size,materials:materials.size,cropForms:Object.values(FARM_CROPS).map(c=>c.form)};
 root.userData.dispose=()=>{if(data.disposed)return;data.disposed=true;root.traverse(o=>{if(o.isInstancedMesh)o.dispose();});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();};
 updateVerticalFarmModel(root,null);return root;
}
function set(data,mesh,index,x,y,z,sx,sy,sz,color,rx=0,ry=0,rz=0){data.q.setFromEuler(data.e.set(rx,ry,rz));data.m.compose(data.p.set(x,y,z),data.q,data.scale.set(sx,sy,sz));mesh.setMatrixAt(index,stationWorldMatrix(data.m,data.world));if(color)mesh.setColorAt(index,data.color.set(color));}
const upload=mesh=>{mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;};
export function updateVerticalFarmModel(model,state,reducedMotion=false){
 const d=model?.userData.farm;if(!d||d.disposed)return;
 const racks=FARM_RACKS.map(l=>state?.racks?.find(r=>r.id===l.id)??{cropId:l.cropId,status:'empty',ageSeconds:0,health:1});
 const dim=farmLightFactor(state);d.lighting.emissiveIntensity=.6*dim;
 const signature=`${dim}|`+racks.map(r=>`${r.status}:${r.harvestedTrays||0}:${Math.round(r.ageSeconds/600)}:${Math.round(r.health*100)}:${farmLightOn(state,r)}`).join('|');
 if(signature!==d.signature){d.signature=signature;
  for(const {mesh,entries}of Object.values(d.dynamic)){entries.forEach((part,i)=>{const point=d.cropPoints[part.plant],r=racks[point.rackIndex],c=FARM_CROPS[r.cropId]||FARM_CROPS[FARM_RACKS[point.rackIndex].cropId],progress=clamp01(r.ageSeconds/c.durationSeconds),g=(r.status==='empty'||point.trayIndex<(r.harvestedTrays||0))?.00001:(.22+.78*Math.sqrt(progress))*point.variation;
   const unripe=part.kind==='fruit'||part.kind==='cone';
   const col=r.status==='failed'?'#9b8354':unripe&&['strawberry','tomato','pepper'].includes(c.id)&&progress<.6?'#91b36a':c.id==='wheat'&&progress<.65?'#9caf66':part.c;
   set(d,mesh,i,point.x+part.dx*g,point.y+part.dy*g,point.z+part.dz*g,part.sx*g,part.sy*g,part.sz*g,col,part.rx,part.ry,part.rz);
  });upload(mesh);}
  let li=0;for(let i=0;i<18;i++){const l=FARM_RACKS[i],r=racks[i],on=farmLightOn(state,r)&&r.status==='growing';
   set(d,d.indicators,i,l.x+(l.x<-54?3.8:-3.8),1.6,l.z-1.5,.12,.12,.12,r.status==='ready'?'#edc56d':r.status==='failed'?'#d77562':r.status==='empty'?'#a4aaa0':'#6ec9a0');
   for(const y of l.tierHeights){const h=y+(l.hallIndex===0?1.8:l.hallIndex===1?3.4:2.5);for(const dz of [-1.05,-.35,.35,1.05])set(d,d.lampGlow,li++,l.x,h,l.z+dz,on?6.8:.00001,on?.015:.00001,on?.12:.00001,'#fff0cb');}
  }upload(d.indicators);upload(d.lampGlow);
 }
 const process=farmProcessState(state),ps=JSON.stringify(process)+racks.map(r=>r.status).join('|');
 if(ps!==d.processSignature){d.processSignature=ps;
  d.processMarkers.forEach((point,i)=>{const rack=point.rackId?racks[FARM_RACKS.findIndex(r=>r.id===point.rackId)]:null;
   const operating=point.kind==='receiving'?process.receiving:point.kind==='treatment'?process.treatment:process.irrigation;
   const color=!process.power?'#858e88':!operating?'#d77a66':rack?.status==='empty'?'#d8bd79':'#70c8b1';
   set(d,d.indicators,18+i,point.x,point.y,point.z,.14,.14,.14,color);
  });upload(d.indicators);
 }
 const rs=state?.automation?.jobs?.map(j=>j?`${j.type}:${j.rackId}:${reducedMotion?Math.floor(j.elapsed/4):Math.floor(j.elapsed*5)}:${j.loadKg}`:'idle').join('|')||'idle';
 if(rs!==d.robotSignature){d.robotSignature=rs;for(let h=0;h<3;h++){
  const site=FARM_SITES[h],j=state?.automation?.jobs?.[h],rack=j?FARM_RACKS.find(r=>r.id===j.rackId):null;
  const t=j?.elapsed||0;let x=-69.6,y=30,z=site.z+9.5;
  if(rack){const timing=farmJobTiming(j),travel=Math.min(1,t/Math.max(.001,timing.travel));
   const lower=t<timing.travel?0:t<timing.travel+timing.lift?(t-timing.travel)/Math.max(.001,timing.lift):t<timing.pickAt?1:t<timing.returnAt?1-(t-timing.pickAt)/Math.max(.001,timing.lift):0;
   const returning=t>timing.returnAt?Math.min(1,(t-timing.returnAt)/Math.max(.001,timing.travel)):0;
   x=timing.homeX+(timing.targetX-timing.homeX)*travel*(1-returning);z=timing.homeZ+(timing.targetZ-timing.homeZ)*travel*(1-returning);y=30+(timing.targetY-30)*lower;
   if(t>timing.dropAt){const down=t<timing.deliverAt?Math.min(1,(t-timing.dropAt)/timing.dropLift):Math.max(0,1-(t-timing.deliverAt)/timing.dropLift);y=30+(3.6-30)*down;}
  }
  const load=j?.loadKg>0;const base=h*8;
  set(d,d.robots,base,x,30.7,z,3.1,.35,3.9,'#d3ad70');
  set(d,d.robots,base+1,x,(30+y)/2,z,.07,Math.max(.1,30-y),.07,'#839e96');
  set(d,d.robots,base+2,x,y,z,.9,.5,1.1,j?.type==='inspect'?'#82b4ca':'#d7b578');
  set(d,d.robots,base+3,x,y-.34,z,load?2.8:.00001,load?.4:.00001,load?3.6:.00001,'#83ac71');
  // Inspection head is a sensor schematic, not a claim of running AI vision.
  set(d,d.robots,base+4,x,y-.3,z-.57,.23,.13,.08,'#344f5e');
  set(d,d.robots,base+5,x,y-.18,z-.62,j?.type==='inspect'?.6:.00001,.025,.025,'#87c6cf');
  set(d,d.robots,base+6,-54,31.05,z,34.6,.12,.18,'#96aa9d');
  set(d,d.robots,base+7,x,30.95,z,.5,.12,1.2,'#4e6f65');
 }upload(d.robots);}
}
function clamp01(v){return Math.max(0,Math.min(1,Number.isFinite(v)?v:0));}
