import { Children, isValidElement, lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Ocean } from './WonderPrimitives.jsx';
import { sampleJet, sampleWonder } from '../../../shared/wonders.js';
import { sampleCarrierBattle } from '../../../shared/carrierBattle.js';
const CarrierBattleHardware = lazy(() => import('./CarrierBattleHardware.jsx'));
const CarrierBattleDock = lazy(() => import('./CarrierBattleHardware.jsx').then(module => ({ default: module.CarrierBattleDock })));

// A fictional, full-scale carrier. All dimensions are in metres; no remote assets.
const DECK_Y = 18.3;
const AIRCRAFT_Y = DECK_Y + .65 + 1.97;
const clamp = THREE.MathUtils.clamp;
const ease = x => x * x * (3 - 2 * x);
const deckOutline = [[-24,145],[24,145],[29,119],[30,75],[34,62],[34,35],[28,18],[28,-85],[22,-124],[12,-143],[-12,-143],[-24,-126],[-29,-82],[-32,-20],[-43,25],[-43,95],[-31,119]];

function surfaceGeometry(points, height = 0.25) {
  const shape = new THREE.Shape();
  points.forEach(([x,z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 4 });
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (positions.getX(i) + 50) / 100, (150 - positions.getZ(i)) / 300);
  uv.needsUpdate = true;
  return geometry;
}

function loft(rings, radialSegments = 16) {
  const vertices = [], uv = [], indices = [];
  rings.forEach(([z,rx,ry,cy = 0], i) => {
    for (let j = 0; j <= radialSegments; j++) {
      const angle = j / radialSegments * Math.PI * 2;
      vertices.push(Math.cos(angle) * rx, Math.sin(angle) * ry + cy, z);
      uv.push(j / radialSegments, i / (rings.length - 1));
      if (i < rings.length - 1 && j < radialSegments) {
        const a = i * (radialSegments + 1) + j, b = a + radialSegments + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function hullGeometry() {
  const sections = [[-143,0.5],[-134,10],[-115,19],[-80,24],[-25,26],[45,26],[108,25],[139,23]];
  const profile = [[-1,17.8],[-.97,11],[-.88,3],[-.67,-5],[-.35,-9],[0,-10],[.35,-9],[.67,-5],[.88,3],[.97,11],[1,17.8]];
  const positions = [], uv = [], indices = [];
  sections.forEach(([z,width], i) => {
    profile.forEach(([x,y], j) => {
      positions.push(x * width, y + (z < -115 ? (1 - width / 19) * 9 : 0), z);
      uv.push((z + 145) / 290, j / (profile.length - 1));
      if (i < sections.length - 1 && j < profile.length - 1) {
        const a = i * profile.length + j, b = a + profile.length;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

function createDeckTexture() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 4096;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#42484b'; ctx.fillRect(0, 0, c.width, c.height);
  let seed = 822;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // Fine non-skid coating: tonal grain rather than painted checkerboards.
  for (let i = 0; i < 60000; i++) {
    const n = Math.floor(35 + random() * 75);
    ctx.fillStyle = `rgba(${n},${n + 3},${n + 5},.26)`;
    ctx.fillRect(random() * c.width, random() * c.height, 1 + random() * 3, 1 + random() * 3);
  }
  ctx.save(); ctx.scale(c.width / 100, c.height / 300); ctx.translate(50,150);
  const line = (points, color, width = .28, dash = []) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath();
    points.forEach(([x,z],i) => i ? ctx.lineTo(x,z) : ctx.moveTo(x,z)); ctx.stroke(); ctx.setLineDash([]);
  };
  // Angled landing strip, alongside two long bow catapults.
  line([[-33,136],[-10,-112]], '#ece5cd', .4);
  line([[-8,140],[14,-105]], '#ece5cd', .4);
  line([[-20.5,136],[2,-108]], '#f2eddb', .44, [5,4]);
  line([[-31.7,134],[-8.9,-112]], '#d0a448', .18);
  line([[-9.3,140],[12.7,-105]], '#d0a448', .18);
  [-9, 5].forEach(x => {
    line([[x,-134],[x,77]], '#232b2e', .6);
    line([[x-.3,-134],[x-.3,77]], '#a2aaa9', .1);
    line([[x+.3,-134],[x+.3,77]], '#a2aaa9', .1);
  });
  for (let z = -126; z < 140; z += 5.5) for (let x = -38; x < 29; x += 5.5) {
    ctx.fillStyle = '#212b2d'; ctx.beginPath(); ctx.arc(x,z,.19,0,Math.PI*2); ctx.fill();
    line([[x-.28,z],[x+.28,z]], '#788083', .055);
    line([[x,z-.28],[x,z+.28]], '#788083', .055);
  }
  // Landing tyre scars and expansion joints stay subtle at grazing angles.
  for (let i = 0; i < 85; i++) {
    const z = 28 + random() * 94, x = -20 + random() * 15;
    line([[x,z],[x+.3,z-5-random()*14]], 'rgba(13,19,22,.18)', .12 + random()*.2);
  }
  for (let z = -120; z < 140; z += 18) line([[-45,z],[35,z]], 'rgba(10,18,20,.16)', .075);
  // Arresting wires; prominent approach bars and elevator safety boundaries.
  [78,88,98,108].forEach(z => line([[-33,z],[8,z+3.8]], '#161e23', .15));
  [116,121,126].forEach(z => line([[-29,z],[-23,z+.5]], '#ece8dc', .65));
  [[19,-94,12,22],[22,72,12,23],[-32,65,15,25]].forEach(([x,z,w,h]) => {
    ctx.strokeStyle='#d9ae45'; ctx.lineWidth=.2; ctx.setLineDash([1.2,.8]); ctx.strokeRect(x-w/2,z-h/2,w,h); ctx.setLineDash([]);
    ctx.strokeStyle='#2b3437';ctx.lineWidth=.35;ctx.strokeRect(x-w/2+.6,z-h/2+.6,w-1.2,h-1.2);
  });
  line([[15,-129],[20,-118],[25,-90],[25,-8]], '#d2b35b', .3, [2.5,1.2]);
  ctx.fillStyle = '#e6e5dc'; ctx.font='900 12px Arial'; ctx.textAlign='center'; ctx.fillText('68',1,-115);
  ctx.font='700 3px Arial';ctx.fillStyle='#c6ccc8';ctx.fillText('CAUTION',22,97);
  ctx.restore();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

function createHullTexture() {
  const c = document.createElement('canvas'); c.width=2048;c.height=512;const ctx=c.getContext('2d');
  ctx.fillStyle='#6b767c';ctx.fillRect(0,0,c.width,c.height);
  for(let i=0;i<64;i++) {
    const x=i*32;ctx.fillStyle=i%3===0?'rgba(215,222,220,.035)':'rgba(10,20,23,.035)';ctx.fillRect(x,0,31,512);
    ctx.strokeStyle='rgba(16,29,32,.12)';ctx.lineWidth=1;ctx.strokeRect(x,.5,32,511);
    const g=ctx.createLinearGradient(0,0,0,512);g.addColorStop(0,'rgba(21,34,36,.2)');g.addColorStop(.32,'rgba(154,87,39,.045)');g.addColorStop(1,'rgba(9,30,33,.18)');ctx.fillStyle=g;ctx.fillRect(x,0,8,512);
  }
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;return tex;
}

function createAssets() {
  const deckMap=createDeckTexture(), hullMap=createHullTexture();
  const materials={
    hull:new THREE.MeshStandardMaterial({map:hullMap,color:'#c0c8c9',roughness:.68,metalness:.34}),
    deck:new THREE.MeshStandardMaterial({map:deckMap,roughness:.89,metalness:.15}),
    steel:new THREE.MeshStandardMaterial({color:'#869397',roughness:.53,metalness:.5}),
    lightSteel:new THREE.MeshStandardMaterial({color:'#c5cdcc',roughness:.48,metalness:.45}),
    dark:new THREE.MeshStandardMaterial({color:'#1e2a30',roughness:.55,metalness:.55}),
    glass:new THREE.MeshPhysicalMaterial({color:'#152f3d',metalness:.54,roughness:.13,clearcoat:1,clearcoatRoughness:.06}),
    jet:new THREE.MeshStandardMaterial({color:'#aab7ba',roughness:.43,metalness:.47}),
    jetDark:new THREE.MeshStandardMaterial({color:'#59696f',roughness:.55,metalness:.4}),
    tyre:new THREE.MeshStandardMaterial({color:'#12191c',roughness:.87}),
    yellow:new THREE.MeshStandardMaterial({color:'#ddac44',roughness:.55,metalness:.18}),
    white:new THREE.MeshStandardMaterial({color:'#e6e9df',roughness:.6}),
    red:new THREE.MeshStandardMaterial({color:'#a44c42',roughness:.6}),
    greenLight:new THREE.MeshBasicMaterial({color:'#6af0d5',toneMapped:false}),
    warmLight:new THREE.MeshBasicMaterial({color:'#ffe5aa',toneMapped:false}),
    exhaust:new THREE.MeshBasicMaterial({color:'#8d9eff',transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}),
    flame:new THREE.MeshBasicMaterial({color:'#ffd3a1',transparent:true,opacity:.84,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}),
  };
  const finShape = new THREE.Shape(); finShape.moveTo(-2.2,0);finShape.lineTo(.6,3.5);finShape.lineTo(2.1,3.3);finShape.lineTo(2.5,0);finShape.closePath();
  const fin = new THREE.ExtrudeGeometry(finShape,{depth:.12,bevelEnabled:false});fin.rotateY(-Math.PI/2);
  const geometries={
    box:new THREE.BoxGeometry(1,1,1),sphere:new THREE.SphereGeometry(1,20,12),cylinder:new THREE.CylinderGeometry(1,1,1,16),
    cone:new THREE.ConeGeometry(1,1,16,1,true),
    hull:hullGeometry(),deck:surfaceGeometry(deckOutline,.65),
    body:loft([[-6,.58,.55,.12],[-4,.8,.67,.18],[-1,1.15,.66,0],[2,1.6,.64,-.1],[5.7,1.32,.5,-.04],[7.5,.87,.42,0],[8,.64,.36,0]],24),
    nose:loft([[-9.64,.025,.025],[-8.7,.23,.22,.03],[-7.1,.46,.43,.08],[-6,.58,.55,.12]],20),
    wing:surfaceGeometry([[0,-3.6],[2,-2.1],[6.6,3.0],[6.1,4.2],[2.1,3.3],[0,4.4]],.16),
    tail:surfaceGeometry([[0,4.7],[2,4.1],[4.6,7.3],[4,8],[0,7.6]],.13),fin,
    window:new THREE.PlaneGeometry(1,1),
  };
  return {materials,geometries,dispose(){Object.values(materials).forEach(x=>x.dispose());Object.values(geometries).forEach(x=>x.dispose());deckMap.dispose();hullMap.dispose();}};
}

function Part({assets,kind='box',material='steel',at=[0,0,0],size=[1,1,1],rotation=[0,0,0],...props}) {
  return <mesh geometry={assets.geometries[kind]} material={assets.materials[material]} position={at} scale={size} rotation={rotation} castShadow receiveShadow {...props}/>;
}

function InstancedParts({assets,parts,kind='box',material='steel'}) {
  const ref=useRef();
  useEffect(()=>{const matrix=new THREE.Object3D();parts.forEach((p,i)=>{matrix.position.set(...p.at);matrix.scale.set(...(p.size||[1,1,1]));matrix.rotation.set(...(p.rotation||[0,0,0]));matrix.updateMatrix();ref.current.setMatrixAt(i,matrix.matrix);});ref.current.instanceMatrix.needsUpdate=true;ref.current.computeBoundingSphere();},[parts]);
  return <instancedMesh ref={ref} args={[assets.geometries[kind],assets.materials[material],parts.length]} castShadow receiveShadow/>;
}

function Aircraft({assets,position=[0,0,0],rotation=[0,0,0],active=false,aircraftRef,exhaustRef,gearRef}) {
  return <group ref={aircraftRef} position={position} rotation={rotation}>
    <Part assets={assets} kind="body" material="jet"/>
    <Part assets={assets} kind="nose" material="jetDark"/>
    {[-1,1].map(side=><group key={side}>
      <Part assets={assets} kind="wing" material="jet" size={[side,1,1]} at={[0,0,0]}/>
      <Part assets={assets} kind="tail" material="jet" size={[side,1,1]} at={[0,.16,0]}/>
      <Part assets={assets} kind="fin" material="jet" at={[side*1.05,.35,5.2]} rotation={[0,0,-side*.2]}/>
      <Part assets={assets} at={[side*1.22,-.31,-1.7]} size={[.88,.67,2.6]} material="jetDark"/>
      <Part assets={assets} at={[side*1.22,-.28,-3.02]} size={[.64,.42,.03]} material="dark"/>
      <Part assets={assets} kind="cylinder" at={[side*.66,-.06,7.5]} size={[.49,1.35,.49]} rotation={[Math.PI/2,0,0]} material="dark"/>
      <Part assets={assets} kind="cylinder" at={[side*.66,-.06,8.2]} size={[.41,.04,.41]} rotation={[Math.PI/2,0,0]} material="tyre"/>
      <Part assets={assets} at={[side*6.15,.11,3.25]} size={[.16,.13,2.2]} material="lightSteel"/>
      <Part assets={assets} kind="sphere" at={[side*6.3,.17,3.2]} size={[.1,.08,.13]} material={side<0?'red':'greenLight'}/>
      <Part assets={assets} at={[side*3.6,.19,2.4]} size={[1.3,.018,.25]} material="jetDark"/>
    </group>)}
    <Part assets={assets} kind="sphere" at={[0,.66,-3.95]} size={[.78,.68,2.15]} material="jetDark"/>
    <Part assets={assets} kind="sphere" at={[0,.77,-3.98]} size={[.68,.61,1.97]} material="glass"/>
    <Part assets={assets} at={[0,1.28,-3.5]} size={[.075,.06,2.1]} material="jetDark"/>
    <group ref={gearRef}>
      {[[0,-5.6],[-1.6,2.2],[1.6,2.2]].map(([x,z],i)=><group key={i}>
        <Part assets={assets} kind="cylinder" at={[x,-.99,z]} size={[.075,1.4,.075]} material="lightSteel"/>
        <Part assets={assets} kind="cylinder" at={[x,-1.63,z]} size={[.34,.25,.34]} rotation={[0,0,Math.PI/2]} material="tyre"/>
        <Part assets={assets} kind="cylinder" at={[x+.14,-1.63,z]} size={[.16,.04,.16]} rotation={[0,0,Math.PI/2]} material="steel"/>
      </group>)}
    </group>
    {active&&<group ref={exhaustRef} visible={false}>
      {[-.66,.66].map(x=><group key={x}>
        <Part assets={assets} kind="cone" at={[x,-.06,10.9]} size={[.4,5.3,.4]} rotation={[Math.PI/2,0,0]} material="exhaust" castShadow={false} receiveShadow={false}/>
        <Part assets={assets} kind="cone" at={[x,-.06,9.4]} size={[.25,2.6,.25]} rotation={[Math.PI/2,0,0]} material="flame" castShadow={false} receiveShadow={false}/>
      </group>)}
    </group>}
  </group>;
}

function parkedAircraftParts() {
  const parts=[];
  const add=(kind,material,at=[0,0,0],size=[1,1,1],rotation=[0,0,0])=>parts.push({kind,material,at,size,rotation});
  add('body','jet');add('nose','jetDark');
  for(const side of [-1,1]){
    add('wing','jet',[0,0,0],[side,1,1]);add('tail','jet',[0,.16,0],[side,1,1]);
    add('fin','jet',[side*1.05,.35,5.2],[1,1,1],[0,0,-side*.2]);
    add('box','jetDark',[side*1.22,-.31,-1.7],[.88,.67,2.6]);
    add('box','dark',[side*1.22,-.28,-3.02],[.64,.42,.03]);
    add('cylinder','dark',[side*.66,-.06,7.5],[.49,1.35,.49],[Math.PI/2,0,0]);
    add('cylinder','tyre',[side*.66,-.06,8.2],[.41,.04,.41],[Math.PI/2,0,0]);
    add('box','lightSteel',[side*6.15,.11,3.25],[.16,.13,2.2]);
    add('sphere',side<0?'red':'greenLight',[side*6.3,.17,3.2],[.1,.08,.13]);
    add('box','jetDark',[side*3.6,.19,2.4],[1.3,.018,.25]);
  }
  add('sphere','jetDark',[0,.66,-3.95],[.78,.68,2.15]);
  add('sphere','glass',[0,.77,-3.98],[.68,.61,1.97]);
  add('box','jetDark',[0,1.28,-3.5],[.075,.06,2.1]);
  for(const [x,z] of [[0,-5.6],[-1.6,2.2],[1.6,2.2]]){
    add('cylinder','lightSteel',[x,-.99,z],[.075,1.4,.075]);
    add('cylinder','tyre',[x,-1.63,z],[.34,.25,.34],[0,0,Math.PI/2]);
    add('cylinder','steel',[x+.14,-1.63,z],[.16,.04,.16],[0,0,Math.PI/2]);
  }
  return parts;
}

function ParkedFleet({assets,parked}) {
  // Bake all eight stationary aircraft into one mesh per material. This saves
  // hundreds of draw calls, including the ocean's reflection and shadow pass.
  const meshes=useMemo(()=>{
    const buckets={},partTransform=new THREE.Object3D(),planeTransform=new THREE.Object3D();
    const definitions=parkedAircraftParts();
    for(const [x,z,yaw] of parked){
      planeTransform.position.set(x,AIRCRAFT_Y,z);planeTransform.rotation.set(0,yaw,0);planeTransform.updateMatrix();
      for(const p of definitions){
        partTransform.position.set(...p.at);partTransform.scale.set(...p.size);partTransform.rotation.set(...p.rotation);partTransform.updateMatrix();
        const matrix=new THREE.Matrix4().multiplyMatrices(planeTransform.matrix,partTransform.matrix);
        const source=assets.geometries[p.kind],g=source.index?source.toNonIndexed():source.clone();
        g.applyMatrix4(matrix);
        if(matrix.determinant()<0){
          for(const attribute of Object.values(g.attributes))for(let i=0;i<attribute.count;i+=3)for(let k=0;k<attribute.itemSize;k++){
            const a=(i+1)*attribute.itemSize+k,b=(i+2)*attribute.itemSize+k,v=attribute.array[a];attribute.array[a]=attribute.array[b];attribute.array[b]=v;
          }
        }
        (buckets[p.material]??=[]).push(g);
      }
    }
    return Object.entries(buckets).map(([material,geometries])=>{
      const geometry=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());geometry.computeBoundingSphere();return {material,geometry};
    });
  },[assets,parked]);
  useEffect(()=>()=>meshes.forEach(x=>x.geometry.dispose()),[meshes]);
  return <group>{meshes.map(({material,geometry})=><mesh key={material} geometry={geometry} material={assets.materials[material]} castShadow receiveShadow/>)}</group>;
}

function StaticAssembly({assets,children}) {
  // Compile the fixed ship assembly once. Deck fixtures still use expressive
  // metre-based JSX, but render as a handful of material-batched meshes.
  const compiled=useMemo(()=>{
    const buckets={},retained=[];
    const visit=(nodes,parent)=>Children.forEach(nodes,node=>{
      if(!isValidElement(node))return;
      if(node.type===Part){
        const p=node.props, transform=new THREE.Object3D();
        transform.position.set(...(p.at||[0,0,0]));transform.scale.set(...(p.size||[1,1,1]));transform.rotation.set(...(p.rotation||[0,0,0]));transform.updateMatrix();
        const matrix=new THREE.Matrix4().multiplyMatrices(parent,transform.matrix),source=assets.geometries[p.kind||'box'];
        const g=source.index?source.toNonIndexed():source.clone();g.applyMatrix4(matrix);
        (buckets[p.material||'steel']??=[]).push(g);
      } else if(node.type==='group'){
        const transform=new THREE.Object3D();transform.position.set(...(node.props.position||[0,0,0]));transform.rotation.set(...(node.props.rotation||[0,0,0]));transform.scale.set(...(node.props.scale||[1,1,1]));transform.updateMatrix();
        visit(node.props.children,new THREE.Matrix4().multiplyMatrices(parent,transform.matrix));
      } else retained.push(<group key={`instances-${retained.length}`}>{node}</group>);
    });
    visit(children,new THREE.Matrix4());
    const meshes=Object.entries(buckets).map(([material,geometries])=>{
      const geometry=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());geometry.computeBoundingSphere();return{material,geometry};
    });
    return {meshes,retained};
    // This component intentionally compiles an immutable model, not live props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[assets]);
  useEffect(()=>()=>compiled.meshes.forEach(x=>x.geometry.dispose()),[compiled]);
  return <group>{compiled.meshes.map(({material,geometry})=><mesh key={material} geometry={geometry} material={assets.materials[material]} castShadow receiveShadow/>)}{compiled.retained}</group>;
}

function Carrier({assets}) {
  const details=useMemo(()=>{
    const rail=[],windows=[],apertures=[],ribs=[],lights=[],white=[];
    // Catwalks below deck, with fine stanchions, not fence-sized toy railings.
    for(const side of [-1,1]) for(let z=-102;z<136;z+=3.8) {
      const x=side<0?(z>23&&z<97?-43.4:-30):29.8;
      if(side>0&&z>10&&z<76) continue;
      rail.push({at:[x,17.8,z],size:[.12,1.15,.12]});
      rail.push({at:[x,18.32,z],size:[.12,.12,3.9]});
      if(Math.round(z)%2===0)lights.push({at:[x-.3*side,19,z],size:[.18,.13,.32]});
    }
    for(const side of [-1,1])for(let z=-91;z<131;z+=10) {
      apertures.push({at:[side*25.2,11.8,z],size:[.14,2.4,6.1]});
      ribs.push({at:[side*27.3,14.5,z],size:[.7,5.2,.7],rotation:[0,0,-side*.25]});
    }
    for(let z=14;z<=49;z+=3.1){windows.push({at:[14.57,35.4,z],size:[.055,1.5,2.3]});windows.push({at:[28.43,35.4,z],size:[.055,1.5,2.3]});}
    for(let x=16;x<29;x+=2.8)windows.push({at:[x,35.4,10.97],size:[2,1.5,.055]});
    for(let z=15;z<49;z+=5.3)windows.push({at:[15.38,29.7,z],size:[.055,.8,1.9]});
    for(let z=30;z<48;z+=3.8)windows.push({at:[16.45,24,z],size:[.055,.7,1.4]});
    for(let z=-110;z<75;z+=9)lights.push({at:[-10.1,19.03,z],size:[.1,.07,.6]});
    for(let z=-75;z<132;z+=8)white.push({at:[-25,17.25,z],size:[1.9,.9,1.9]});
    return {rail,windows,apertures,ribs,lights,white};
  },[]);
  return <StaticAssembly assets={assets}>
    <Part assets={assets} kind="hull" material="hull"/>
    <Part assets={assets} kind="deck" material="deck" at={[0,DECK_Y,0]}/>
    <Part assets={assets} at={[0,5.4,139]} size={[45,23,1.2]} material="hull"/>
    <Part assets={assets} at={[-6,11,139.8]} size={[25,8,.1]} material="dark"/>
    {[-15,-6,3].map(x=><Part key={x} assets={assets} at={[x,11.5,140]} size={[.55,8.8,.7]} material="steel"/>)}
    <Part assets={assets} at={[-8,8,143]} size={[31,.7,6]} material="steel"/>
    <InstancedParts assets={assets} parts={details.rail} material="lightSteel"/>
    <InstancedParts assets={assets} parts={details.windows} material="glass"/>
    <InstancedParts assets={assets} parts={details.apertures} material="dark"/>
    <InstancedParts assets={assets} parts={details.ribs}/>
    <InstancedParts assets={assets} parts={details.lights} material="greenLight"/>
    <InstancedParts assets={assets} parts={details.white} material="white" kind="sphere"/>
    {/* Island is a stepped, cantilevered structure with wraparound glazing. */}
    <Part assets={assets} at={[22,23.1,34]} size={[11,8.4,34]} material="hull"/>
    <Part assets={assets} at={[22,29.2,31]} size={[12.8,4,39]} material="steel"/>
    <Part assets={assets} at={[21.5,33.8,31]} size={[13.8,5.2,40]} material="hull"/>
    <Part assets={assets} at={[21.5,37,31]} size={[15,1.2,42]} material="lightSteel"/>
    <Part assets={assets} at={[24,40.2,39]} size={[8.5,5.5,14]} material="steel"/>
    <Part assets={assets} at={[24,43.1,40]} size={[9.3,.7,15.1]} material="dark"/>
    <Part assets={assets} at={[22,39.8,23]} size={[5.8,5.1,9]} material="steel"/>
    <Part assets={assets} kind="cylinder" at={[22,45,22]} size={[.7,10,.7]} material="lightSteel"/>
    <Part assets={assets} at={[22,49,22]} size={[11,.6,.65]} material="steel"/>
    <Part assets={assets} at={[22,45.2,22]} size={[8,.4,.5]} material="steel"/>
    {[-5,-2.5,2.5,5].map(x=><Part key={x} assets={assets} kind="cylinder" at={[22+x,51,22]} size={[.07,5,.07]} material="dark"/>)}
    <Part assets={assets} kind="cylinder" at={[25,51,40]} size={[.4,17,.4]} material="lightSteel"/>
    <Part assets={assets} at={[25,55.4,40]} size={[7.8,.3,.4]} material="dark"/>
    <Part assets={assets} kind="sphere" at={[20,41,14]} size={[2,2,2]} material="white"/>
    <Part assets={assets} kind="sphere" at={[27,44.6,33]} size={[1.4,1.4,1.4]} material="white"/>
    {[-1,1].map(side=><group key={side}>
      <Part assets={assets} at={[22+side*7.2,38,31]} size={[.08,1.2,41]} material="lightSteel"/>
      {[17,28,39,49].map(z=><Part key={z} assets={assets} at={[22+side*7.2,37.7,z]} size={[.12,1.1,.12]} material="lightSteel"/>)}
    </group>)}
    {/* Elevators, rescue craft, mooring fixtures and replenishment equipment. */}
    {[[29,85],[-36,64],[25,-89]].map(([x,z],i)=><group key={i}>
      <Part assets={assets} at={[x,17.7,z]} size={[i===1?15:12,1,22]} material="steel"/>
      <Part assets={assets} at={[x,18.24,z-10.7]} size={[i===1?15:12,.07,.3]} material="yellow"/>
    </group>)}
    {[[-28,56],[-27,-37],[29,116]].map(([x,z],i)=><group key={i}>
      <Part assets={assets} at={[x,8,z]} size={[6,1,14]} material="steel"/>
      <Part assets={assets} kind="sphere" at={[x,9.5,z]} size={[1.8,.95,5.2]} material="dark"/>
      <Part assets={assets} kind="sphere" at={[x,9.9,z]} size={[1.3,.65,3.6]} material="lightSteel"/>
      <Part assets={assets} at={[x,10.7,z+1]} size={[1.5,1.6,1.9]} material="steel"/>
    </group>)}
    {[[-9,87],[5,60]].map(([x,z],i)=><group key={i} position={[x,DECK_Y+1,z]} rotation={[-.32,0,0]}>
      <Part assets={assets} at={[0,0,0]} size={[9,.35,4.6]} material="steel"/>
      {[-3,-1.5,0,1.5,3].map(dx=><Part key={dx} assets={assets} at={[dx,.2,0]} size={[.08,.08,4.5]} material="dark"/>)}
    </group>)}
    {/* Aircraft tractors and deck personnel establish the immense scale. */}
    {[[-26,103],[16,61],[20,-38]].map(([x,z],i)=><group key={i} position={[x,19.5,z]}>
      <Part assets={assets} size={[2,1,3.8]} material="yellow"/>
      <Part assets={assets} at={[.35,.85,-.2]} size={[1.1,.8,1.1]} material="dark"/>
      {[-1,1].flatMap(s=>[-1.2,1.2].map(p=><Part key={`${s}${p}`} assets={assets} kind="cylinder" at={[s,-.3,p]} size={[.46,.28,.46]} rotation={[0,0,Math.PI/2]} material="tyre"/>))}
    </group>)}
    {[[-17,80],[-18,84],[-4,73],[12,61],[16,56],[10,-43],[-24,116],[20,92]].map(([x,z],i)=><group key={i} position={[x,19,z]}>
      <Part assets={assets} kind="cylinder" at={[0,.8,0]} size={[.22,.8,.18]} material={i%3?'yellow':'red'}/>
      <Part assets={assets} kind="sphere" at={[0,1.38,0]} size={[.18,.2,.18]} material="white"/>
      {[-.12,.12].map(dx=><Part key={dx} assets={assets} at={[dx,.27,0]} size={[.14,.6,.16]} material="dark"/>)}
    </group>)}
  </StaticAssembly>;
}

// Exported pure sampler makes scrubbing and acceptance testing deterministic.
export function sampleCarrierAircraft(seconds) {
  const t=((seconds%60)+60)%60;
  if(t<8) {const p=clamp((t-2)/6,0,1);return {position:[-9,AIRCRAFT_Y,75-207*p*p],pitch:.045*p,yaw:0,bank:0,thrust:t>1,gear:true};}
  if(t<20) {const p=(t-8)/12;return {position:[-9-110*Math.sin(p*Math.PI*.7),AIRCRAFT_Y+185*p, -132-760*p],pitch:.1,yaw:.15+Math.sin(p*2)*.08,bank:.08*Math.sin(p*Math.PI),thrust:true,gear:p<.18};}
  if(t<40) {const p=(t-20)/20,a=-Math.PI/2-p*Math.PI*1.45;return {position:[-70+560*Math.cos(a),206+35*Math.sin(p*Math.PI),-400+560*Math.sin(a)],pitch:.02,yaw:-a,bank:.35,thrust:false,gear:false};}
  const p=(t-40)/20;
  return {position:[-210+200*p,110-89*p,-980+1110*p],pitch:-.075,yaw:Math.PI+.18,bank:0,thrust:false,gear:p>.8};
}

const CAMERA_KEYS=[
  [0,[-205,108,-245],[0,22,0],43],
  [2,[-168,80,-205],[-3,24,-10],43],
  [4,[-38,32,125],[-9,22,48],48],
  [7,[-31,28,-45],[-9,24,-110],48],
  [9,[-55,41,-180],[-18,33,-215],48],
  [13,[-93,101,-430],[-93,98,-450],53],
  [17,[-133,174,-710],[-122,164,-700],48],
  [20,[-245,106,-220],[0,23,-15],43],
  [28,[-225,66,135],[0,27,18],42],
  [36,[115,82,211],[8,29,25],43],
  [43,[74,53,43],[21,34,27],49],
  [50,[68,38,-89],[3,22,-35],47],
  [57,[-190,102,-251],[0,22,0],43],
  [60,[-205,108,-245],[0,22,0],43],
];

function sampleCamera(t) {
  let i=0;while(i<CAMERA_KEYS.length-2&&t>CAMERA_KEYS[i+1][0])i++;
  const a=CAMERA_KEYS[i],b=CAMERA_KEYS[i+1],p=ease(clamp((t-a[0])/(b[0]-a[0]),0,1));
  return {position:a[1].map((v,j)=>THREE.MathUtils.lerp(v,b[1][j],p)),target:a[2].map((v,j)=>THREE.MathUtils.lerp(v,b[2][j],p)),fov:THREE.MathUtils.lerp(a[3],b[3],p)};
}

export default function CarrierExperience({timeRef,reducedMotion,quality='high',cameraMode='director'}) {
  const assets=useMemo(createAssets,[]);
  const aircraft=useRef(),exhaust=useRef(),gear=useRef(),radar=useRef(),cameraTarget=useRef(new THREE.Vector3()),previousTime=useRef(null);
  const {camera}=useThree();
  useEffect(()=>()=>assets.dispose(),[assets]);
  const parked=useMemo(()=>[
    [19,-69,-.12],[20,-43,-.12],[18,-16,-.12],
    [17,95,Math.PI+.22],[6,120,Math.PI+.22],[-25,119,Math.PI+.38],[-32,61,Math.PI/2],[-31,37,Math.PI/2],
  ],[]);
  useFrame((_,delta)=>{
    const t=reducedMotion?0:((timeRef?.current??0)%60+60)%60;
    const p=sampleCarrierAircraft(t);
    if(aircraft.current){aircraft.current.position.set(...p.position);aircraft.current.rotation.set(p.pitch,p.yaw,p.bank);}
    if(exhaust.current){exhaust.current.visible=p.thrust;exhaust.current.scale.z=1+.06*Math.sin(t*61);}
    if(gear.current)gear.current.visible=p.gear;
    if(radar.current)radar.current.rotation.y=t*.8;
    if(cameraMode!=='free'){
      const shot=sampleCamera(t), target=new THREE.Vector3(...shot.target), position=new THREE.Vector3(...shot.position);
      // Portrait keeps the complete hull readable instead of cropping its bow.
      const portrait=camera.aspect<1?1.35:1;
      position.sub(target).multiplyScalar(portrait).add(target);
      // The launch cut tracks the actual aircraft, not an approximate orbit.
      if(t>=8&&t<18){
        target.set(...p.position);target.y+=1;
        position.copy(target).add(new THREE.Vector3(-25,12,38).multiplyScalar(portrait));
      }
      const jump=previousTime.current===null||Math.abs(t-previousTime.current)>1.5;
      const alpha=jump?1:1-Math.exp(-delta*4.3);
      camera.position.lerp(position,alpha);cameraTarget.current.lerp(target,alpha);camera.lookAt(cameraTarget.current);
      camera.fov=THREE.MathUtils.lerp(camera.fov,shot.fov,alpha);camera.updateProjectionMatrix();
    }
    previousTime.current=t;
  });
  return <group>
    <Ocean timeRef={timeRef} reducedMotion={reducedMotion} size={quality==='low'?2400:4000} y={0}/>
    <Carrier assets={assets}/>
    <ParkedFleet assets={assets} parked={parked}/>
    <Aircraft assets={assets} active aircraftRef={aircraft} exhaustRef={exhaust} gearRef={gear}/>
    <group ref={radar} position={[22,51.1,22]}>
      <Part assets={assets} at={[0,0,0]} size={[7.4,3.1,.45]} material="dark"/>
      {[-3,-2,-1,0,1,2,3].map(x=><Part key={x} assets={assets} at={[x,0,-.26]} size={[.07,2.8,.06]} material="steel"/>)}
    </group>
    {/* Foam wake uses long transparent meshes: no particle storm or extra passes. */}
    <CarrierWake timeRef={timeRef} reducedMotion={reducedMotion}/>
  </group>;
}

function CarrierWake({timeRef,reducedMotion}) {
  const ref=useRef();
  const geometry=useMemo(()=>{
    const positions=[],uv=[],indices=[];
    for(let i=0;i<40;i++){
      const z=135+i*10,w=20+i*1.7;
      positions.push(-w,.16,z,w,.16,z);uv.push(0,i/39,1,i/39);
      if(i<39){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
    }
    for(const side of [-1,1]){
      const start=positions.length/3;
      for(let i=0;i<24;i++){
        const p=i/23,z=-140+p*240,x=side*(4+24*(1-Math.exp(-p*7))),width=1.4+p*4;
        positions.push(x,.18,z,x+side*width,.18,z);uv.push(0,p,1,p);
        if(i<23){const a=start+i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
      }
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
  },[]);
  const material=useMemo(()=>new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{uTime:{value:0}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec2 vUv;uniform float uTime;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    void main(){float edge=pow(abs(vUv.x-.5)*2.,2.5);float n=noise(vec2(vUv.x*38.,vUv.y*86.-uTime*1.7));float foam=smoothstep(.34,.76,n)*(.3+edge*.4)*(1.-vUv.y);float center=exp(-pow((vUv.x-.5)*8.,2.))*(1.-vUv.y)*.22;gl_FragColor=vec4(.7,.91,.91,(foam+center)*.65);}`}),[]);
  useEffect(()=>()=>{geometry.dispose();material.dispose();},[geometry,material]);
  useFrame(()=>{material.uniforms.uTime.value=reducedMotion?0:timeRef?.current??0;});
  return <mesh ref={ref} geometry={geometry} material={material} frustumCulled={false}/>;
}

// The town variant shares the detailed materials, hull and aircraft but is
// deliberately fitted to the existing walkable deck and authoritative solids.
// Do not uniformly scale the cinema ship: its angled outline leaves holes in
// the rectangular walkable contract, and its bridge would land in the runway.
export const TOWN_CARRIER_LAYOUT = Object.freeze({
  deck: Object.freeze({ x:63,z:20,width:18,depth:30,top:0 }),
  hull: Object.freeze({ position:[63,-2.3,20],scale:[.31,.12,30/288] }),
  island: Object.freeze({ position:[69.5,0,21],scale:[3.4/15.26,.18,7/42],origin:[-21.63,-18.9,-31] }),
  parked: Object.freeze([[69,10,-.08],[69,31,.08]]),
  parkedScale:.2,
  activeScale:.22,
});

function createTownAssets() {
  const assets=createAssets();
  const deck=surfaceGeometry([[-9,15],[9,15],[9,-15],[-9,-15]],.22);
  const p=deck.getAttribute('position'),uv=deck.getAttribute('uv');
  for(let i=0;i<uv.count;i++)uv.setXY(i,(p.getX(i)+9)/18,(15-p.getZ(i))/30);
  uv.needsUpdate=true;
  assets.geometries.townDeck=deck;
  return assets;
}

function TownIsland({assets,radarRef}) {
  const windows=useMemo(()=>{
    const p=[];
    for(let z=14;z<=49;z+=3.1){p.push({at:[14.57,35.4,z],size:[.055,1.5,2.3]});p.push({at:[28.43,35.4,z],size:[.055,1.5,2.3]});}
    for(let x=16;x<29;x+=2.8)p.push({at:[x,35.4,10.97],size:[2,1.5,.055]});
    for(let z=15;z<49;z+=5.3)p.push({at:[15.38,29.7,z],size:[.055,.8,1.9]});
    return p;
  },[]);
  const layout=TOWN_CARRIER_LAYOUT.island;
  return <group name="town-carrier-island" position={layout.position} scale={layout.scale}><group position={layout.origin}>
    <StaticAssembly assets={assets}>
      <Part assets={assets} at={[22,23.1,34]} size={[11,8.4,34]} material="hull"/>
      <Part assets={assets} at={[22,29.2,31]} size={[12.8,4,39]} material="steel"/>
      <Part assets={assets} at={[21.5,33.8,31]} size={[13.8,5.2,40]} material="hull"/>
      <Part assets={assets} at={[21.5,37,31]} size={[15,1.2,42]} material="lightSteel"/>
      <Part assets={assets} at={[24,40.2,39]} size={[8.5,5.5,14]} material="steel"/>
      <Part assets={assets} at={[24,43.1,40]} size={[9.3,.7,15.1]} material="dark"/>
      <Part assets={assets} at={[22,39.8,23]} size={[5.8,5.1,9]} material="steel"/>
      <Part assets={assets} kind="cylinder" at={[22,45,22]} size={[.7,10,.7]} material="lightSteel"/>
      <Part assets={assets} at={[22,49,22]} size={[11,.6,.65]} material="steel"/>
      <Part assets={assets} at={[22,45.2,22]} size={[8,.4,.5]} material="steel"/>
      {[-5,-2.5,2.5,5].map(x=><Part key={x} assets={assets} kind="cylinder" at={[22+x,51,22]} size={[.07,5,.07]} material="dark"/>)}
      <Part assets={assets} kind="cylinder" at={[25,51,40]} size={[.4,17,.4]} material="lightSteel"/>
      <Part assets={assets} at={[25,55.4,40]} size={[7.8,.3,.4]} material="dark"/>
      <Part assets={assets} kind="sphere" at={[20,41,14]} size={[2,2,2]} material="white"/>
      <Part assets={assets} kind="sphere" at={[27,44.6,33]} size={[1.4,1.4,1.4]} material="white"/>
      {[-1,1].map(side=><group key={side}>
        <Part assets={assets} at={[22+side*7.2,38,31]} size={[.08,1.2,41]} material="lightSteel"/>
        {[17,28,39,49].map(z=><Part key={z} assets={assets} at={[22+side*7.2,37.7,z]} size={[.12,1.1,.12]} material="lightSteel"/>)}
      </group>)}
    </StaticAssembly>
    <InstancedParts assets={assets} parts={windows} material="glass"/>
    <group ref={radarRef} position={[22,51.1,22]}>
      <Part assets={assets} size={[7.4,3.1,.45]} material="dark"/>
      {[-3,-2,-1,0,1,2,3].map(x=><Part key={x} assets={assets} at={[x,0,-.26]} size={[.07,2.8,.06]} material="steel"/>)}
    </group>
  </group></group>;
}

function TownCarrierDeckDetails({assets}) {
  const parts=useMemo(()=>{
    const rails=[],lights=[],windows=[],braces=[];
    for(const x of [54.1,71.9])for(let z=5.4;z<=34.6;z+=1.45){
      if(x<60&&z>19.35&&z<24.65)continue;
      rails.push({at:[x,.46,z],size:[.055,.92,.055]});
    }
    for(const [x,z,length] of [[54.1,12.1,13.9],[54.1,29.85,10.1],[71.9,20,29.8]])for(const y of [.5,.9])rails.push({at:[x,y,z],size:[.05,.05,length]});
    for(const z of [5.1,34.9]){
      for(let x=54.2;x<=71.9;x+=1.45)rails.push({at:[x,.46,z],size:[.055,.92,.055]});
      for(const y of [.5,.9])rails.push({at:[63,y,z],size:[17.8,.05,.05]});
    }
    for(const x of [54.55,71.45])for(let z=6;z<35;z+=2)lights.push({at:[x,.035,z],size:[.075,.045,.22]});
    for(const side of [-1,1])for(let z=8;z<34;z+=2.2){
      windows.push({at:[63+side*7.82,-.68,z],size:[.035,.45,1.25]});
      braces.push({at:[63+side*8.1,-.37,z],size:[.13,.7,.13],rotation:[0,0,-side*.2]});
    }
    return {rails,lights,windows,braces};
  },[]);
  return <group>
    <InstancedParts assets={assets} parts={parts.rails} material="lightSteel"/>
    <InstancedParts assets={assets} parts={parts.lights} material="greenLight"/>
    <InstancedParts assets={assets} parts={parts.windows} material="dark"/>
    <InstancedParts assets={assets} parts={parts.braces} material="steel"/>
    {/* Elevators remain flush: no rendered obstruction outside shared solids. */}
    <StaticAssembly assets={assets}>
      <Part assets={assets} at={[70.15,.004,14.3]} size={[3.4,.008,3.8]} material="steel"/>
      <Part assets={assets} at={[70.15,.001,12.44]} size={[3.4,.012,.055]} material="yellow"/>
      <Part assets={assets} at={[70.15,.001,16.16]} size={[3.4,.012,.055]} material="yellow"/>
      <Part assets={assets} at={[55.8,.004,27.2]} size={[3.3,.008,4.1]} material="steel"/>
      <Part assets={assets} at={[55.8,.001,25.18]} size={[3.3,.012,.055]} material="yellow"/>
      <Part assets={assets} at={[55.8,.001,29.22]} size={[3.3,.012,.055]} material="yellow"/>
      <Part assets={assets} at={[62,.012,20]} size={[.045,.018,27.9]} material="lightSteel"/>
    </StaticAssembly>
  </group>;
}

export function TownCarrier({timeRef,reducedMotion=false,active=true,battleTimeRef=null}) {
  const assets=useMemo(createTownAssets,[]),jet=useRef(),exhaust=useRef(),gear=useRef(),radar=useRef(),liftingHull=useRef();
  const layout=TOWN_CARRIER_LAYOUT;
  const parked=useMemo(()=>layout.parked.map(([x,z,yaw])=>[x/layout.parkedScale,z/layout.parkedScale,yaw]),[]);
  useEffect(()=>()=>assets.dispose(),[assets]);
  useFrame(()=>{
    // Room trajectories must stay live from every vantage point. Proximity only
    // gates decorative work, never the silhouette seen from the original town.
    const time=timeRef?.current??0,p=sampleJet(time,reducedMotion),show=sampleWonder('carrier',time);
    const battle=battleTimeRef?sampleCarrierBattle(battleTimeRef.current,{reducedMotion}):null;
    if(liftingHull.current)liftingHull.current.position.y=battle?.carrier.height??0;
    if(jet.current){jet.current.position.set(p.x,p.y,p.z);jet.current.rotation.set(0,p.yaw,0);jet.current.rotateX(p.pitch);jet.current.visible=!battle&&p.visible;}
    if(exhaust.current){exhaust.current.visible=active&&!reducedMotion&&show.active&&['takeoff','flight'].includes(show.phase);if(exhaust.current.visible)exhaust.current.scale.z=1+.05*Math.sin(time*.06);}
    if(gear.current)gear.current.visible=p.y<1.5;
    if(radar.current&&active)radar.current.rotation.y=reducedMotion?0:time/1800;
  });
  return <group name="town-carrier-integrated">
    <group ref={liftingHull} name="town-carrier-lifting-hull">
    <group position={layout.hull.position} scale={layout.hull.scale}>
      <Part assets={assets} kind="hull" material="hull"/>
      <Part assets={assets} at={[0,5.4,139]} size={[45,23,1.2]} material="hull"/>
      <Part assets={assets} at={[-6,11,139.8]} size={[25,8,.1]} material="dark"/>
      <Part assets={assets} at={[-8,8,143]} size={[31,.7,6]} material="steel"/>
    </group>
    <Part assets={assets} name="town-carrier-walkable-deck" kind="townDeck" at={[63,-.22,20]} material="deck"/>
    <TownCarrierDeckDetails assets={assets}/>
    <TownIsland assets={assets} radarRef={radar}/>
    <group name="town-carrier-parked-aircraft" position={[0,-(DECK_Y+.65)*layout.parkedScale,0]} scale={layout.parkedScale}>
      <ParkedFleet assets={assets} parked={parked}/>
    </group>
    <group name="town-carrier-active-aircraft" ref={jet} position={[62,.8,29]}>
      <group position={[0,1.97*layout.activeScale-.8,0]} scale={layout.activeScale}>
        <Aircraft assets={assets} active exhaustRef={exhaust} gearRef={gear}/>
      </group>
    </group>
    {battleTimeRef&&<Suspense fallback={null}><CarrierBattleHardware timeRef={battleTimeRef} reducedMotion={reducedMotion}/></Suspense>}
    </group>
    {battleTimeRef&&<Suspense fallback={null}><CarrierBattleDock timeRef={battleTimeRef} reducedMotion={reducedMotion}/></Suspense>}
  </group>;
}
