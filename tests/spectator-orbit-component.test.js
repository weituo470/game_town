import fs from 'node:fs';import vm from 'node:vm';import * as THREE from 'three';import {transformWithEsbuild} from 'vite';
import {spectatorPose} from '../src/components/drone/spectatorOrbit.js';import test from 'node:test';import assert from 'node:assert/strict';
test('actual spectator component handles UI, wheel, reset and disposes all canvas listeners',async()=>{
 const code=await transformWithEsbuild(fs.readFileSync(new URL('../src/components/drone/SpectatorOrbit.jsx',import.meta.url),'utf8'),'SpectatorOrbit.jsx',{loader:'jsx',jsx:'automatic',format:'cjs'});
 const effects=[],listeners=new Map();let frame;const gl={domElement:{dataset:{},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}};
 const module={exports:{}};vm.runInNewContext(code.code,{module,exports:module.exports,require(id){if(id==='react')return {useRef:v=>({current:v}),useEffect:fn=>effects.push(fn() )};if(id==='react/jsx-runtime')return {jsx:(type,props)=>({type,props})};if(id==='@react-three/fiber')return {useThree:()=>({gl}),useFrame:fn=>{frame=fn;}};if(id==='./spectatorOrbit.js')return {spectatorPose};if(id==='../town/FirstPersonLook.jsx')return {__esModule:true,default:'CanvasLook'};throw Error(id);}});
 const poseRef={current:{position:[10,50,180],target:[0,40,0],far:600}},inputRef={current:{}},recenterRef={current:0},camera=new THREE.PerspectiveCamera(50,1,.1,600);
 const tree=module.exports.default({poseRef,inputRef,recenterRef,program:'avatar'});assert.equal(tree.props.orbitOnly,true);
 const render=()=>{camera.position.set(...poseRef.current.position);frame({camera});};render();assert.deepEqual(camera.position.toArray(),poseRef.current.position);
 inputRef.current.orbitAction='left';render();assert.notDeepEqual(camera.position.toArray(),poseRef.current.position);assert.equal(inputRef.current.orbitAction,undefined);
 inputRef.current.orbitAction='in';render();assert.ok(JSON.parse(gl.domElement.dataset.spectatorOrbit).zoom<1);
 let prevented=false;listeners.get('wheel')({deltaY:100,preventDefault(){prevented=true;}});render();assert.ok(prevented);
 recenterRef.current++;render();assert.deepEqual(camera.position.toArray(),poseRef.current.position);
 for(const fn of effects)fn?.();assert.equal(listeners.size,0);assert.equal(gl.domElement.dataset.spectatorOrbit,undefined);
});
