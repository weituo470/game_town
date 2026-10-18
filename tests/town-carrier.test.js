import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as React from 'react';
import * as THREE from 'three';
import { CARRIER_SOLIDS, sampleJet } from '../shared/wonders.js';

const file=new URL('../src/components/wonders/CarrierExperience.jsx',import.meta.url);
const require=createRequire(file);
// Geometry/placement tests use an empty texture in Node; the production canvas
// texture generation itself remains untouched and is checked in the browser.
const source=fs.readFileSync(file,'utf8').replace('const deckMap=createDeckTexture(), hullMap=createHullTexture();','const deckMap=new THREE.Texture(), hullMap=new THREE.Texture();');
const compiled=await transformWithEsbuild(source,'CarrierExperience.jsx',{loader:'jsx',jsx:'automatic',format:'cjs'});

function renderTown(options={}){
  const frames=[],effects=[],cleanups=[];
  const module={exports:{}};
  vm.runInNewContext(compiled.code,{
    module,exports:module.exports,
    require(id){
      if(id==='react')return{...React,useMemo:fn=>fn(),useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)};
      if(id==='@react-three/fiber')return{useFrame:fn=>frames.push(fn),useThree(){throw Error('TownCarrier may not own a camera or renderer');}};
      if(id==='./WonderPrimitives.jsx')return{Ocean(){throw Error('TownCarrier may not own an ocean');}};
      return require(id);
    },
  });
  const create=node=>{
    if(!React.isValidElement(node))return null;
    if(typeof node.type==='function')return create(node.type(node.props));
    const p=node.props;
    let object;
    if(node.type==='mesh')object=new THREE.Mesh(p.geometry,p.material);
    else if(node.type==='instancedMesh')object=new THREE.InstancedMesh(...p.args);
    else if(node.type==='group')object=new THREE.Group();
    else throw Error(`Unexpected owned scene element ${String(node.type)}`);
    object.name=p.name||'';
    if(p.position)object.position.set(...p.position);
    if(p.rotation)object.rotation.set(...p.rotation);
    if(p.scale){if(typeof p.scale==='number')object.scale.setScalar(p.scale);else object.scale.set(...p.scale);}
    if(p.visible!==undefined)object.visible=p.visible;
    if(p.ref)p.ref.current=object;
    React.Children.forEach(p.children,child=>{const next=create(child);if(next)object.add(next);});
    return object;
  };
  const timeRef={current:0};
  const root=create(React.createElement(module.exports.TownCarrier,{timeRef,...options}));
  effects.forEach(fn=>{const cleanup=fn();if(typeof cleanup==='function')cleanups.push(cleanup);});root.updateMatrixWorld(true);
  return {root,timeRef,layout:module.exports.TOWN_CARRIER_LAYOUT,frame(){frames.forEach(fn=>fn());root.updateMatrixWorld(true);},dispose(){cleanups.forEach(fn=>fn());}};
}

function vertices(object){
  const result=[],point=new THREE.Vector3();
  object.traverse(node=>{
    if(!node.isMesh||node.isInstancedMesh)return;
    const p=node.geometry.getAttribute('position');
    for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(node.matrixWorld);result.push(point.clone());}
  });
  return result;
}
const near=(a,b,epsilon=1e-5)=>assert.ok(Math.abs(a-b)<epsilon,`${a} vs ${b}`);

test('town carrier: actual deck geometry exactly covers the shared 18x30 walkable rectangle at y=0',()=>{
  const app=renderTown(),deck=app.root.getObjectByName('town-carrier-walkable-deck');
  const box=new THREE.Box3().setFromObject(deck);
  near(box.min.x,54);near(box.max.x,72);near(box.min.z,5);near(box.max.z,35);near(box.max.y,0);
  assert.equal(app.layout.parked.length,2);app.dispose();
});

test('town carrier: bridge base, upper decks and mast all remain inside the authoritative island solid',()=>{
  const app=renderTown(),island=app.root.getObjectByName('town-carrier-island'),points=vertices(island).filter(p=>p.y>=-.01&&p.y<1.4);
  const box=new THREE.Box3().setFromPoints(points),solid=CARRIER_SOLIDS[0];
  assert.ok(box.min.x>=solid.x-solid.width/2&&box.max.x<=solid.x+solid.width/2);
  assert.ok(box.min.z>=solid.z-solid.depth/2&&box.max.z<=solid.z+solid.depth/2);
  const full=new THREE.Box3().setFromObject(island);
  assert.ok(full.min.x>=solid.x-solid.width/2-.001&&full.max.x<=solid.x+solid.width/2+.001,`island bounds ${JSON.stringify({min:full.min,max:full.max})}`);
  assert.ok(full.min.z>=solid.z-solid.depth/2-.001&&full.max.z<=solid.z+solid.depth/2+.001);
  assert.ok(box.max.x-box.min.x>2.4&&box.max.z-box.min.z>5.6,'the bridge remains a substantial walk-around landmark');
  app.dispose();
});

test('town carrier: two detailed parked jets stay within the existing two aircraft solids and their wheels touch deck',()=>{
  const app=renderTown(),points=vertices(app.root.getObjectByName('town-carrier-parked-aircraft'));
  for(const solid of CARRIER_SOLIDS.slice(1)){
    const box=new THREE.Box3().setFromPoints(points.filter(p=>Math.abs(p.z-solid.z)<5));
    assert.ok(box.min.x>=solid.x-solid.width/2&&box.max.x<=solid.x+solid.width/2);
    assert.ok(box.min.z>=solid.z-solid.depth/2-.05&&box.max.z<=solid.z+solid.depth/2+.05);
    near(box.min.y,0,.0001);
  }
  app.dispose();
});

test('town carrier: flight uses shared millisecond world trajectory, never the independent cinema clock',()=>{
  const app=renderTown(),jet=app.root.getObjectByName('town-carrier-active-aircraft');
  for(const t of [0,60000,68000,72000,80000,95000,104000,180000]){
    app.timeRef.current=t;app.frame();const expected=sampleJet(t,false);
    near(jet.position.x,expected.x);near(jet.position.y,expected.y);near(jet.position.z,expected.z);
    assert.equal(jet.visible,expected.visible);
  }
  app.dispose();
});

test('town carrier: reduced motion rests on deck but distant flight keeps the shared trajectory',()=>{
  const reduced=renderTown({reducedMotion:true});reduced.timeRef.current=80000;reduced.frame();
  const jet=reduced.root.getObjectByName('town-carrier-active-aircraft'),rest=sampleJet(80000,true);
  near(jet.position.x,rest.x);near(jet.position.y,rest.y);near(jet.position.z,rest.z);reduced.dispose();
  const idle=renderTown({active:false}),distant=idle.root.getObjectByName('town-carrier-active-aircraft');
  for(const t of [68000,74000,80000,95000,104000,110000]){
    idle.timeRef.current=t;idle.frame();const p=sampleJet(t,false);
    near(distant.position.x,p.x);near(distant.position.y,p.y);near(distant.position.z,p.z);
    assert.equal(distant.visible,p.visible);
  }
  idle.dispose();
});
