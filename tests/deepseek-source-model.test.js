import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { transformWithEsbuild } from 'vite';
import * as jsx from 'react/jsx-runtime';
import { createDeepSeekPark, DEEPSEEK_MODEL } from '../src/components/deepseek/createDeepSeekPark.js';
import * as parkContract from '../shared/deepseek-park.js';
import * as world from '../shared/world.js';

function canvas(){
  const context=new Proxy({createLinearGradient(){return {addColorStop(){}};}},{get(target,key){return target[key]??(()=>{});},set(target,key,value){target[key]=value;return true;}});
  return {width:0,height:0,getContext:()=>context};
}
const create=()=>createDeepSeekPark({createCanvas:canvas});
const vector=(v)=>v.toArray().every(Number.isFinite);

test('DeepSeek source model keeps the original six towers, full whale, layered tower, fountain and 140m source footprint on the town Three engine',()=>{
  assert.equal(THREE.REVISION,'180');const park=create();
  assert.equal(park.anchors.towers.length,6);
  assert.equal(park.anchors.whale.children[0].children.length,15,'source sphere-composed whale is not replaced by the old placeholder');
  assert.equal(park.anchors.whale.scale.x,1.72);
  assert.deepEqual(park.anchors.layerStack.position.toArray(),[0,0,-32]);
  assert.deepEqual(park.anchors.fountain.position.toArray(),[0,0,27]);
  assert.deepEqual(park.anchors.gate.position.toArray(),[0,0,42]);
  const bounds=new THREE.Box3().setFromObject(park.group);
  assert.equal(bounds.min.x,-70);assert.equal(bounds.max.x,70);assert.equal(bounds.min.z,-70);assert.equal(bounds.max.z,70);
  assert.equal(park.group.position.y,-DEEPSEEK_MODEL.groundY);
  assert.ok(park.statistics.meshCount<=110,'static lamp batching lowers the original 143 meshes');
  assert.equal(park.statistics.triangleCount,35014);assert.equal(park.statistics.particleCount,880);assert.equal(park.statistics.textureCount,2);
  let cameras=0,lights=0;park.group.traverse(node=>{if(node.isCamera)cameras++;if(node.isLight)lights++;});
  assert.equal(cameras,0);assert.equal(lights,0);park.dispose();
});

test('DeepSeek source update is absolute-time deterministic, finite under invalid/epoch clocks and frozen under reduced motion',()=>{
  const a=create(),b=create();
  for(const t of [0,10,1000,9999,1700000000000,NaN,Infinity,-10]){
    a.update(t);b.update(t);
    assert.deepEqual(a.anchors.whale.position.toArray(),b.anchors.whale.position.toArray());
    a.group.traverse(node=>{assert.ok(vector(node.position));if(node.isPoints)assert.ok(node.geometry.attributes.position.array.every(Number.isFinite));});
    for(const layer of a.anchors.layerStack.children)assert.ok(Number.isFinite(layer.rotation.z));
  }
  a.update(12000);const first=a.anchors.layerStack.children.filter(node=>node.userData.spin).map(node=>node.rotation.z);
  a.update(25000);a.update(12000);assert.deepEqual(a.anchors.layerStack.children.filter(node=>node.userData.spin).map(node=>node.rotation.z),first,'seeking does not accumulate rotation drift');
  a.update(900000,true);const before=a.anchors.whale.rotation.toArray();assert.equal(a.update(1200000,true),false);assert.deepEqual(a.anchors.whale.rotation.toArray(),before);
  a.dispose();b.dispose();
});

test('DeepSeek own geometry/materials/textures/instance buffers dispose exactly once without touching a parent or the town engine',()=>{
  const park=create(),parent=new THREE.Group();parent.add(park.group);
  const resources=new Set();park.group.traverse(node=>{
    if(node.geometry)resources.add(node.geometry);if(node.isInstancedMesh)resources.add(node);
    for(const material of(Array.isArray(node.material)?node.material:[node.material]))if(material){resources.add(material);for(const value of Object.values(material))if(value?.isTexture)resources.add(value);}
  });
  const disposed=new Map();for(const resource of resources)resource.addEventListener('dispose',()=>disposed.set(resource,(disposed.get(resource)||0)+1));
  park.dispose();park.dispose();assert.equal(parent.children.length,0);assert.equal(park.group.children.length,0);assert.equal(park.update(120),false);
  assert.equal(disposed.size,resources.size);for(const count of disposed.values())assert.equal(count,1);
});

const file=new URL('../src/components/town/DeepSeekPark.jsx',import.meta.url);
const compiled=await transformWithEsbuild(fs.readFileSync(file,'utf8'),'DeepSeekPark.jsx',{loader:'jsx',jsx:'automatic',format:'cjs'});
function componentModule(hooks={}){
  const module={exports:{}};
  vm.runInNewContext(compiled.code,{module,exports:module.exports,document:{hidden:false,createElement:canvas},require(id){
    if(id==='react')return hooks;if(id==='@react-three/fiber')return {useFrame:hooks.useFrame};if(id==='react/jsx-runtime')return jsx;
    if(id==='three')return THREE;if(id==='../../../shared/deepseek-park.js')return parkContract;if(id==='../../../shared/world.js')return world;
    if(id==='../deepseek/createDeepSeekPark.js')return {createDeepSeekPark:options=>createDeepSeekPark({...options,createCanvas:canvas})};throw new Error(id);
  }});return module.exports;
}
const {deepSeekBridgePieces}=componentModule();
test('DeepSeek L bridge uses shared bounds, disjoint coplanar tops and open bend interiors',()=>{
  const pieces=deepSeekBridgePieces();assert.ok(pieces.decks.length>3);assert.ok(pieces.rails.length>10);
  for(let i=0;i<pieces.decks.length;i++)for(let j=i+1;j<pieces.decks.length;j++){
    const a=pieces.decks[i],b=pieces.decks[j];const overlapX=(a.size[0]+b.size[0])/2-Math.abs(a.at[0]-b.at[0]);const overlapZ=(a.size[2]+b.size[2])/2-Math.abs(a.at[2]-b.at[2]);assert.ok(overlapX<=1e-8||overlapZ<=1e-8);
  }
  for(const point of [{x:-38,z:-39.5},{x:-38,z:-43},{x:-58,z:-43},{x:-79,z:-43},{x:-79,z:-44.3}]){
    assert.ok(pieces.decks.some(part=>Math.abs(point.x-part.at[0])<=part.size[0]/2+1e-8&&Math.abs(point.z-part.at[2])<=part.size[2]/2+1e-8),'route has a visible zero-height deck');
    assert.ok(pieces.rails.every(part=>Math.abs(point.x-part.at[0])>part.size[0]/2+.4||Math.abs(point.z-part.at[2])>part.size[2]/2+.4),'rails do not cross the walk route');
  }
});

test('town-context island replaces the dark display plinth with grass, warm paths and a flush waterfront while preserving landmarks',()=>{
  const park=createDeepSeekPark({createCanvas:canvas,townContext:true});
  const top=park.group.getObjectByName('deepseek-ground-tier-2');
  assert.equal(top.material.color.getHex(),0x748469);
  assert.equal(top.geometry.type,'RingGeometry');assert.equal(top.geometry.parameters.innerRadius,15.1);
  assert.equal(top.position.y,.32);assert.ok(top.position.y<DEEPSEEK_MODEL.groundY,'grass cannot z-fight with .335 paths');
  assert.equal(park.group.getObjectByName('deepseek-ground-tier-0').material.color.getHex(),0x9c9985);
  assert.ok(park.group.getObjectByName('deepseek-waterfront-walk'));
  assert.ok(park.group.getObjectByName('deepseek-shore-curb'));
  assert.equal(park.anchors.towers.length,6); assert.equal(park.anchors.whale.scale.x,1.72);
  assert.ok(park.statistics.meshCount<=112);assert.ok(park.statistics.triangleCount<36000);
  park.dispose();
});

test('DeepSeek R3F wrapper mounts/disposes per effect replay, exposes local observation mode and uses only the shared frame clock',()=>{
  const refs=[],effects=[];let frame;
  const module=componentModule({useRef(value){const ref={current:value};refs.push(ref);return ref;},useEffect(fn){effects.push(fn);},useMemo(fn){return fn();},useFrame(fn){frame=fn;}});
  const timeRef={current:1000};const tree=module.default({inTown:false,timeRef});
  const child=tree.props.children.find(node=>node?.props?.ref);assert.deepEqual([...child.props.position],[0,0,0]);assert.equal(child.props.scale,1);
  const parent=new THREE.Group();child.props.ref.current=parent;
  const cleanup=effects[0]();assert.equal(parent.children.length,1);const first=parent.children[0];
  frame({clock:{elapsedTime:400}});assert.ok(first.getObjectByName('deepseek-whale').rotation.y>0);
  cleanup();assert.equal(parent.children.length,0);const cleanupAgain=effects[0]();assert.equal(parent.children.length,1);assert.notEqual(parent.children[0],first);cleanupAgain();
});
