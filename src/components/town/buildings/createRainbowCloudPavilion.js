import * as THREE from 'three';
import { createStorybookKit } from './StorybookBuildingKit.js';

export const RAINBOW_SPEC = Object.freeze({
  name:'彩虹云端凉亭', width:11.7, depth:5.1, height:9.1, groundY:0,
  reference:'彩虹云端凉亭_三视图.jpg', drawCallBudget:35, triangleBudget:150000,
});

/** Seven solid coloured arches, sculpted clouds and an open four-post pavilion. */
export function createRainbowCloudPavilion() {
  const kit=createStorybookKit({name:'RainbowCloudPavilionAsset',palette:{
    cloud:'#f7f6ee', cloudShade:'#e4e8eb', cloudBright:'#fffdf5',
    red:'#e4798c', orange:'#e9a06c', yellow:'#efcd72', green:'#8fc4a1', blue:'#7bbacb', indigo:'#839bc7', violet:'#ad91ca',
    wood:'#c78e63', woodLight:'#e6b88b', woodDark:'#966244', cream:'#f3e4c9',
    gold:{color:'#d9b36d',metalness:.32,roughness:.5}, roof:'#5394b8',roofLight:'#7db7cc',roofDark:'#39748f',
    crystal:{color:'#bce3ed',metalness:.18,roughness:.22}, glint:{color:'#f3fcff',emissive:'#c7e7f3',emissiveIntensity:.12,roughness:.25},
  }});
  const {group}=kit;
  // Main cloud bodies overlap into one soft silhouette. There is no flat image.
  function cloud(cx,cy,cz,s) {
    const puffs=[
      [0,0,0,1.42,.82,1.08],[-1,.02,.06,.98,.76,.91],[1.06,.03,.01,.92,.77,.88],
      [-.57,.46,-.4,.93,.82,.87],[.52,.52,-.46,.96,.78,.92],
      [-.69,-.13,.63,.86,.68,.79],[.52,-.19,.67,.98,.73,.79],
      [-1.17,-.23,.4,.66,.59,.69],[1.17,-.13,.46,.71,.64,.73],
      [.12,-.41,.08,1.07,.55,.98],[-.15,.51,.3,.96,.75,.87],
    ];
    puffs.forEach(([x,y,z,rx,ry,rz],i)=>kit.sphere(i===9?'cloudShade':i%4===0?'cloudBright':'cloud',
      [cx+x*s,cy+y*s,cz+z*s],[rx*s,ry*s,rz*s]));
  }
  cloud(-3.55,1.56,0,1.15);
  cloud(2.5,2.59,.05,1.3);
  // A small separate vapour curl balances the large cloud without a base plaque.
  kit.sphere('cloudShade',[-4.72,.43,-.12],[.6,.43,.55]);
  kit.sphere('cloud',[-4.38,.52,.37],[.64,.52,.6]);

  const bands=['red','orange','yellow','green','blue','indigo','violet'];
  bands.forEach((mat,index)=>{
    const radius=3.61-index*.29;
    const points=[];
    for(let i=0;i<=44;i++){
      const theta=Math.PI*i/44;
      points.push([-.65+radius*Math.cos(theta),2.02+radius*Math.sin(theta)+.67*(Math.cos(theta)+1),-.48]);
    }
    kit.tube(mat,points,.173,72);
  });

  const cx=2.56,cz=.05;
  // Porcelain platform and gold-edged frieze sit in the top of the right cloud.
  kit.box('cream',[cx,3.68,cz],[2.83,.4,2.5]);
  kit.box('gold',[cx,3.89,cz],[2.89,.08,2.56]);
  kit.box('cloudBright',[cx,3.98,cz],[2.69,.12,2.38]);
  for(const z of [-1.23,1.33]) {
    kit.box('gold',[cx,3.62,z],[2.52,.045,.035]);
    for(let i=0;i<7;i++) {
      const x=cx-1.08+i*.36;
      kit.tube('woodLight',[[x-.11,3.67,z],[x,3.53,z+.015],[x+.11,3.67,z]],.025,8);
    }
  }
  const columns=[];
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const x=cx+sx*1.05,z=cz+sz*.91;columns.push([x,z]);
    kit.box('gold',[x,4.08,z],[.34,.12,.34]);
    kit.cylinder('wood',[x,5.12,z],.115,2.05);
    kit.cylinder('woodLight',[x-.032,5.13,z+.063],.026,1.94);
    kit.cylinder('gold',[x,6.11,z],.17,.15);
    kit.box('woodLight',[x,6.28,z],[.3,.2,.3]);
    kit.cylinder('woodDark',[x,4.21,z],.14,.08);
  }
  for(const z of [cz-.91,cz+.91]){
    kit.box('wood',[cx,6.32,z],[2.5,.23,.22]);
    kit.box('gold',[cx,6.45,z],[2.55,.055,.26]);
    // Repeating curved fretwork is visible beneath the eaves.
    for(let i=0;i<6;i++){
      const x=cx-.92+i*.37;
      kit.tube('gold',[[x-.13,6.2,z],[x-.07,6.08,z],[x+.07,6.08,z],[x+.13,6.2,z]],.028,10);
    }
  }
  for(const x of [cx-1.05,cx+1.05]){
    kit.box('wood',[x,6.32,cz],[.22,.23,2.1]);
    kit.box('gold',[x,6.45,cz],[.25,.055,2.13]);
  }
  for(const [x,z]of columns){
    const sx=Math.sign(x-cx),sz=Math.sign(z-cz);
    kit.tube('woodLight',[[x,5.83,z],[x-sx*.12,6.08,z],[x-sx*.42,6.25,z]],.058,14);
    kit.tube('woodLight',[[x,5.83,z],[x,6.08,z-sz*.12],[x,6.25,z-sz*.4]],.058,14);
  }
  // Back bench and two short side balustrades leave the front entrance open.
  kit.box('woodLight',[cx,4.48,cz-.72],[1.72,.14,.4]);
  for(const x of [cx-.62,cx+.62])kit.box('wood',[x,4.27,cz-.72],[.12,.39,.24]);
  kit.box('gold',[cx,4.91,cz-.91],[1.86,.06,.08]);
  for(let i=0;i<6;i++)kit.beam('woodLight',[cx-.77+i*.31,4.51,cz-.91],[cx-.77+i*.31,4.9,cz-.91],.028);
  for(const x of [cx-1.05,cx+1.05]){
    kit.box('gold',[x,4.82,cz],[.08,.07,1.52]);
    for(const z of [-.56,0,.56])kit.beam('woodLight',[x,4.08,cz+z],[x,4.81,cz+z],.034);
  }

  // Four curved blue roof patches. Each strip is a small closed solid rather
  // than a double-sided plane; ribs and corner finials are separate geometry.
  function roofPoint(face,t,u){
    const y=8.13-2.02*Math.sqrt(t)+.37*Math.pow(t,7);
    const across=u*1.64*t, radial=1.56*t;
    if(face===0)return[cx+across,y,cz+radial];
    if(face===1)return[cx-across,y,cz-radial];
    if(face===2)return[cx+radial,y,cz-across];
    return[cx-radial,y,cz+across];
  }
  function roofStrip(face,u0,u1){
    const positions=[],indices=[],steps=14;
    for(let layer=0;layer<2;layer++)for(let i=0;i<=steps;i++)for(const u of [u0,u1]){
      const p=roofPoint(face,.035+.965*i/steps,u);p[1]-=layer*.1;positions.push(...p);
    }
    const row=(steps+1)*2;
    for(let i=0;i<steps;i++){
      const a=i*2,b=a+2;
      // Winding is corrected below from the face normal against the roof peak.
      indices.push(a,b,a+1,a+1,b,b+1,a+row,a+1+row,b+row,a+1+row,b+1+row,b+row);
      for(const k of [0,1]){const s=a+k,e=b+k;indices.push(s,s+row,e,e,s+row,e+row);}
    }
    indices.push(0,1,row,1,row+1,row,row-2,row*2-2,row-1,row-1,row*2-2,row*2-1);
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
    // Explicit surfaces are generated with top normals up, irrespective of side.
    const p=geo.attributes.position,n=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    const ids=geo.index.array;
    a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]);c.fromBufferAttribute(p,ids[2]);n.crossVectors(b.sub(a),c.sub(a));
    if(n.y<0){for(let i=0;i<ids.length;i+=3)[ids[i+1],ids[i+2]]=[ids[i+2],ids[i+1]];geo.computeVertexNormals();}
    return kit.custom(geo);
  }
  for(let face=0;face<4;face++){
    for(let i=0;i<15;i++){
      const u0=-1+i*2/15,u1=-1+(i+1)*2/15;
      kit.add(roofStrip(face,u0,u1),i%4===0?'roofLight':i%3===0?'roofDark':'roof');
      const points=[];for(let k=0;k<=18;k++){const p=roofPoint(face,.09+.91*k/18,(u0+u1)/2);p[1]+=.025;points.push(p);}
      kit.tube(i%4===0?'roofLight':'roof',points,.025,20);
    }
    const edge=[];for(let k=0;k<=20;k++)edge.push(roofPoint(face,1,-1+2*k/20));kit.tube('gold',edge,.07,24);
    const ridge=[];for(let k=0;k<=22;k++){const p=roofPoint(face,.035+.965*k/22,1);p[1]+=.09;ridge.push(p);}kit.tube('gold',ridge,.065,26);
    const tip=roofPoint(face,1,1);kit.tube('gold',[tip,[tip[0]*.99+cx*.01,tip[1]+.12,tip[2]],[tip[0],tip[1]+.31,tip[2]]],.073,10);
    kit.sphere('gold',[tip[0],tip[1]+.34,tip[2]],[.09,.105,.09]);
  }
  // Join the truncated roof strips to the finial; no floating crown.
  kit.add(kit.custom(new THREE.ConeGeometry(.17,.5,16)),'gold',[cx,8.0,cz]);
  kit.cylinder('gold',[cx,8.22,cz],.15,.17);
  kit.sphere('gold',[cx,8.48,cz],[.18,.22,.18]);

  // Faceted rain jewels on fine gold threads beneath the raised cloud.
  const drops=kit.scope('CloudRainJewels',[2.5,2.3,.1]);
  const jewel=kit.custom(new THREE.OctahedronGeometry(1,0));
  [[1.05,1.13,.4,.15],[1.7,.75,.85,.13],[2.45,.43,.65,.22],[3.14,.88,.8,.13],[3.87,1.21,.25,.15]].forEach(([x,y,z,s],i)=>{
    kit.beam('gold',[x,2.13,z],[x,y+s*1.6,z],.009);
    kit.add(jewel,'crystal',[x,y,z],[s,s*1.65,s*.7],[0,.2+i*.4,0]);
    kit.sphere('glint',[x-s*.33,y+s*.45,z+s*.58],[s*.18,s*.28,s*.11]);
    kit.sphere('crystal',[x,y+s*1.9,z],[.04,.05,.04]);
  });
  kit.scope('static');
  const stats=kit.finish();let elapsed=0,disposed=false;
  group.userData.spec=RAINBOW_SPEC;group.userData.elapsed=0;
  return{group,stats,update(delta,reducedMotion=false){
    if(disposed||reducedMotion||!Number.isFinite(delta)||delta<=0)return;
    elapsed+=Math.min(delta,.05);drops.rotation.z=Math.sin(elapsed*.7)*.018;drops.rotation.x=Math.sin(elapsed*.51)*.012;
    kit.materials.glint.emissiveIntensity=.12+Math.sin(elapsed*.8)*.035;group.userData.elapsed=elapsed;
  },dispose(){if(disposed)return;disposed=true;kit.dispose();}};
}
