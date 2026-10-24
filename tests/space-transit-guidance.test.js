import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import * as THREE from 'three';import {transformWithEsbuild} from 'vite';
import * as elevator from '../shared/space-elevator.js';import * as rail from '../shared/space-rail.js';
test('actual world frame boards a waiting passenger and guides a physical cabin entry without teleport requests',async()=>{
 const code=await transformWithEsbuild(fs.readFileSync(new URL('../src/components/space/SpaceWorld.jsx',import.meta.url),'utf8'),'SpaceWorld.jsx',{loader:'jsx',jsx:'automatic',format:'cjs'});
 let frame,time=1000;const camera=new THREE.PerspectiveCamera(58,1,.1,180000),gl={domElement:{dataset:{}}},module={exports:{}};
 vm.runInNewContext(code.code,{module,exports:module.exports,performance:{now:()=>time},require(id){
  if(id==='react')return {useRef:v=>({current:v}),useEffect:fn=>fn(),useMemo:fn=>fn(),useLayoutEffect:()=>{}};
  if(id==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(id==='@react-three/fiber')return {useThree:()=>({camera,gl,invalidate(){}}),useFrame:fn=>{frame=fn;}};
  if(id==='three')return THREE;if(id.endsWith('/shared/space-elevator.js'))return elevator;if(id.endsWith('/shared/space-rail.js'))return rail;
  return {};
 }});
 const run=(state,pose)=>{module.exports.default({runtime:{current:state},playerPoseRef:{current:pose},network:{status:'offline'},viewMode:'first-person',active:true});frame({},.05);};
 const state={mode:'ground',railEpoch:-5000,railFrom:0,autoBoard:true,input:{x:0,z:0}};
 run(state,{x:36,y:0,z:54.8});assert.equal(state.mode,'rail');assert.equal(state.autoBoard,false);assert.equal(state.pose.jetpack,false);
 const landing={mode:'ground',railEpoch:-5000,railFrom:0,walkToCabin:true,walkTo:{x:1100,z:-1040},look:{yaw:0,pitch:.12}};
 run(landing,{...elevator.SPACE_ELEVATOR.port});assert.equal(landing.mode,'ascent');assert.equal(landing.walkToCabin,false);assert.equal(landing.walkTo,null);
 assert.equal(landing.pose.spaceStartAt,time);assert.equal(camera.position.y,2.6);assert.equal(landing.pose.y,0);
 time+=30000;frame({},.05);assert(landing.pose.y>0);assert(camera.position.distanceTo(new THREE.Vector3(landing.pose.x,landing.pose.y,landing.pose.z))<3);
 assert(camera.position.toArray().every(Number.isFinite));
});
