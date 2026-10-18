import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformWithEsbuild } from 'vite';
import * as THREE from 'three';
import * as jsx from 'react/jsx-runtime';
import * as dayNight from '../shared/dayNight.js';

const file=new URL('../src/components/town/TownSky.jsx',import.meta.url);
const source=await transformWithEsbuild(fs.readFileSync(file,'utf8'),'TownSky.jsx',{loader:'jsx',jsx:'automatic',format:'cjs'});
function load(onFrame=()=>{}){
  const module={exports:{}};
  vm.runInNewContext(source.code,{module,exports:module.exports,require(id){
    if(id==='three')return THREE;
    if(id==='react')return {useRef:current=>({current}),useMemo:fn=>fn()};
    if(id==='react/jsx-runtime')return jsx;
    if(id==='@react-three/fiber')return {useFrame:onFrame};
    if(id==='../../../shared/dayNight.js')return dayNight;
    throw new Error(id);
  }});
  return module.exports;
}
const {explorationFogOffset}=load();
function all(node,result=[]){if(Array.isArray(node))node.forEach(child=>all(child,result));else if(node?.props){result.push(node);all(node.props.children,result);}return result;}
function harness(props={}){
  let frame;
  const module=load(callback=>{frame=callback;});
  const timeRef={current:0},playerPoseRef={current:{y:0}};
  const tree=module.default({timeRef,playerPoseRef,viewMode:'follow',...props});
  const nodes=all(tree),fogNode=nodes.find(node=>node.type==='fog'),shaderNode=nodes.find(node=>node.type==='shaderMaterial');
  const fog=new THREE.Fog(...fogNode.props.args),material=new THREE.ShaderMaterial({uniforms:shaderNode.props.uniforms});
  fogNode.props.ref.current=fog;shaderNode.props.ref.current=material;
  const camera=new THREE.PerspectiveCamera(58,1280/720,.08,420);
  return {fog,material,camera,timeRef,playerPoseRef,
    frame(){camera.updateMatrixWorld(true);frame({camera,size:{width:1280,height:720},clock:{elapsedTime:15}});},
    dispose(){material.dispose();},
  };
}

test('high-altitude fog: only free exploration shifts the original 175/340m range',()=>{
  for(const mode of ['follow','first-person']){
    assert.equal(explorationFogOffset(mode,20,0),0,'the ground camera boom does not change fog');
    assert.equal(explorationFogOffset(mode,103,80),80);
    assert.equal(explorationFogOffset(mode,68,80),68,'a low upward-looking camera uses its actual positive altitude');
    assert.equal(explorationFogOffset(mode,1003,1000),1000);
    assert.equal(explorationFogOffset(mode,1003,1000,true),0,'outdoor practice retains directed atmosphere');
    assert.equal(explorationFogOffset(mode,1003,1000,false,false),0,'retained orthographic cameras keep original fog');
  }
  for(const mode of ['overview','wonder','drone','unknown',undefined])assert.equal(explorationFogOffset(mode,1003,1000),0);
  for(const value of [NaN,Infinity,-Infinity,-10,undefined,null,'80']){
    assert.equal(explorationFogOffset('follow',value,80),0);
    assert.equal(explorationFogOffset('follow',90,value),0);
  }
});

test('high-altitude fog: actual TownSky frame updates live Fog and restores the ground range without changing sky/light colours',()=>{
  const h=harness();h.camera.position.y=20;h.frame();
  assert.equal(h.fog.near,175);assert.equal(h.fog.far,340);
  const dayColor=h.fog.color.clone(),daylight=h.material.uniforms.daylight.value;
  for(const altitude of [80,400,1000]){
    h.playerPoseRef.current.y=altitude;h.camera.position.y=altitude+2;h.frame();
    assert.equal(h.fog.near,175+altitude);assert.equal(h.fog.far,340+altitude);
    assert.ok(h.camera.position.y<h.fog.near,'ground below the camera no longer becomes a solid fog wall');
    assert.deepEqual(h.fog.color,dayColor);assert.equal(h.material.uniforms.daylight.value,daylight);
    assert.equal(h.material.uniforms.orthographicView.value,0);
  }
  h.timeRef.current=90000;h.frame();assert.notDeepEqual(h.fog.color,dayColor);
  assert.equal(h.fog.near,1175);assert.equal(h.fog.far,1340);
  assert.equal(h.material.uniforms.daylight.value,dayNight.sampleDayNight(90000).daylight);
  h.playerPoseRef.current.y=0;h.camera.position.y=20;h.frame();
  assert.equal(h.fog.near,175);assert.equal(h.fog.far,340);h.dispose();
});

test('high-altitude fog: actual directed and outdoor TownSky frames retain original haze at any altitude',()=>{
  for(const props of [{viewMode:'overview'},{viewMode:'wonder'},{viewMode:'drone'},{viewMode:'follow',outdoorSelected:'fishing'}]){
    const h=harness(props);h.playerPoseRef.current.y=1000;h.camera.position.y=1010;h.frame();
    assert.equal(h.fog.near,175);assert.equal(h.fog.far,340);h.dispose();
  }
});
