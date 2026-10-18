import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import * as React from 'react';
import * as THREE from 'three';
import { WONDERS, WONDER_CYCLE_MS, sampleRocket } from '../shared/wonders.js';
import { townWonderCamera } from '../src/components/town/camera.js';
import { TOWN_ROCKET_NOZZLES, TOWN_ROCKET_PLUME_COUNT, TOWN_ROCKET_PAD_SURFACE,
  sampleTownRocketPlumes, createTownRocketPlumeResources, writeTownRocketPlumeFrame } from '../src/components/wonders/rocketPlume.js';

const near = (a,b,epsilon=1e-6) => assert.ok(Math.abs(a-b)<epsilon, `${a} != ${b}`);
const finite = item => {
  if(typeof item==='number')assert.ok(Number.isFinite(item));
  else if(item && typeof item==='object')Object.values(item).forEach(finite);
};

test('rocket plume: the three throats match the actual .2-scaled engine and booster bell origins', () => {
  const sample = sampleTownRocketPlumes(144000), pose = sampleRocket(144000);
  assert.equal(TOWN_ROCKET_NOZZLES.length,3);
  for(let i=0;i<3;i++) {
    const nozzle=TOWN_ROCKET_NOZZLES[i], jet=sample.jets[i];
    near(jet.origin[0],(i-1)*4.7*.2); near(jet.origin[1],.85+pose.height+(i===1?0:.55*.2));
    assert.deepEqual(jet.axis,[0,-1,0]); near(jet.radius,nozzle.radius);
    assert.ok(jet.length>nozzle.length*.93 && jet.length<=nozzle.length);
  }
});

test('rocket plume: ignition grows from zero, sustains ascent and stops exactly at the existing reset boundary', () => {
  const first=sampleTownRocketPlumes(130000), early=sampleTownRocketPlumes(130400), ignition=sampleTownRocketPlumes(132300);
  assert.equal(first.visible,false); assert.equal(first.power,0);
  assert.ok(early.visible && early.jets[1].length>0 && early.jets[1].length<ignition.jets[1].length);
  for(const ms of [133000,140000,148000,151999])assert.equal(sampleTownRocketPlumes(ms).visible,true);
  for(const ms of [0,120000,129999,152000,159999,160000,180000]) {
    const sample=sampleTownRocketPlumes(ms); assert.equal(sample.visible,false); assert.equal(sample.light,0);
    sample.jets.forEach(jet=>assert.equal(jet.power,0));
  }
});

test('rocket plume: ground exhaust deflects above the pad and fades as the main nozzles lift away', () => {
  const ignition=sampleTownRocketPlumes(132500), airborne=sampleTownRocketPlumes(145000);
  for(const jet of ignition.jets.slice(3)) {
    assert.ok(jet.origin[1]>TOWN_ROCKET_PAD_SURFACE && jet.axis[1]>0);
    assert.ok(jet.length>3 && jet.power>.7);
  }
  airborne.jets.slice(3).forEach(jet=>assert.ok(jet.power<.00001));
  assert.ok(airborne.jets[1].power>.9, 'ascending nozzle keeps firing after the pad deflection stops');
});

test('rocket plume: absolute samples survive rewind, cycle wrap, reduced motion and invalid inputs', () => {
  for(const ms of [NaN,Infinity,-Infinity,undefined,-1000,0,129999,130000,130001,133000,145000,151999,152000,180000]) {
    const sample=sampleTownRocketPlumes(ms); finite(sample);
    if(Number.isFinite(ms))assert.deepEqual(sample,sampleTownRocketPlumes(ms+WONDER_CYCLE_MS));
    const reduced=sampleTownRocketPlumes(ms,true);
    assert.equal(reduced.visible,false); assert.equal(reduced.power,0); assert.equal(reduced.light,0);
    reduced.jets.forEach(jet=>assert.equal(jet.power,0));
  }
  const before=sampleTownRocketPlumes(138000);sampleTownRocketPlumes(151999);
  assert.deepEqual(sampleTownRocketPlumes(138000),before);
});

test('rocket plume: fixed two-layer instanced geometry is volumetric and has no history-driven particle allocation', () => {
  const resources=createTownRocketPlumeResources();
  assert.equal(resources.materials.length,2);assert.equal(resources.geometry.instanceCount,TOWN_ROCKET_PLUME_COUNT);
  assert.equal(TOWN_ROCKET_PLUME_COUNT,7);
  const p=resources.geometry.attributes.position;
  assert.ok(p.count<1000); assert.ok(Array.from(p.array).some((v,i)=>i%3===2 && v>.9));
  assert.ok(Array.from(p.array).some((v,i)=>i%3===2 && v<-.9));
  const attrs={...resources.geometry.attributes}, geometries=resources.geometry;
  for(const time of [131000,145000,138000,151999]) {
    const sample=sampleTownRocketPlumes(time);writeTownRocketPlumeFrame(resources,sample);
    assert.equal(resources.geometry,geometries);
    for(const name of Object.keys(attrs))assert.equal(resources.geometry.attributes[name],attrs[name]);
    near(resources.geometry.attributes.jetOrigin.getY(1),sample.jets[1].origin[1],1e-5);
    near(resources.geometry.attributes.jetShape.getX(1),sample.jets[1].length,1e-5);
    for(const material of resources.materials) {
      assert.equal(material.uniforms.time.value,sample.seconds);assert.equal(material.depthTest,true);
      assert.equal(material.depthWrite,false);assert.equal(material.blending,THREE.NormalBlending);
      assert.equal(material.uniforms.padSurface.value,.48);
    }
  }
  let disposal=0;[resources.geometry,...resources.materials].forEach(item=>item.addEventListener('dispose',()=>disposal++));
  resources.dispose();assert.equal(disposal,3);
});

test('rocket plume: complete above-pad tails remain inside desktop and phone observation frusta throughout ascent', () => {
  const wonder=WONDERS.find(w=>w.id==='rocket');
  for(const aspect of [1440/900,390/736,390/844])for(let time=133000;time<152000;time+=137) {
    const shot=townWonderCamera(wonder.arrival,time,aspect), camera=new THREE.PerspectiveCamera(shot.fov,aspect,.08,420);
    camera.position.set(...shot.position);camera.lookAt(...shot.target);camera.updateMatrixWorld(true);
    const sample=sampleTownRocketPlumes(time);
    for(const jet of sample.jets.slice(0,3))for(const side of [-1,1]) {
      const tip=new THREE.Vector3(jet.origin[0]+side*jet.radius,Math.max(.48,jet.origin[1]-jet.length),-61).project(camera);
      assert.ok(Math.abs(tip.x)<.95 && Math.abs(tip.y)<.95 && tip.z>-1 && tip.z<1,`${time}, ${aspect}, tail ${tip.toArray()}`);
    }
  }
});

const file=new URL('../src/components/wonders/RocketExperience.jsx',import.meta.url), require=createRequire(file);
const compiled=await transformWithEsbuild(fs.readFileSync(file,'utf8').replace('function makeSurfaceTexture(kind) {','function makeSurfaceTexture(kind) { return new THREE.Texture();'),'RocketExperience.jsx',{loader:'jsx',jsx:'automatic',format:'cjs'});
function harness() {
  const frames=[],effects=[],module={exports:{}};
  vm.runInNewContext(compiled.code,{module,exports:module.exports,require(id) {
    if(id==='react')return{...React,useMemo:fn=>fn(),useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)};
    if(id==='@react-three/fiber')return{useFrame:fn=>frames.push(fn),useThree(){throw Error('plumes cannot own the camera');}};
    if(id==='@react-three/drei')return{useTexture(){throw Error('town plumes need no external textures');}};
    if(id==='./WonderPrimitives.jsx')return{};
    return require(id);
  }});
  return {module:module.exports,frames,effects};
}

test('rocket plume: actual TownRocket mounts the volume independently of active/proximity', () => {
  const h=harness(),timeRef={current:142000};
  for(const active of [true,false]) {
    const node=h.module.TownRocket({timeRef,active,reducedMotion:false});
    const child=React.Children.toArray(node.props.children).find(el=>el.type===h.module.TownRocketPlumes);
    assert.ok(child); assert.equal(child.props.timeRef,timeRef);assert.equal(child.props.reducedMotion,false);
    assert.equal(Object.hasOwn(child.props,'active'),false);
  }
});

test('rocket plume: actual frame callbacks hide light and mesh at reset/reduced and restore after rewind', () => {
  for(const reducedMotion of [false,true]) {
    const h=harness(),timeRef={current:142000},node=h.module.TownRocketPlumes({timeRef,reducedMotion});
    const root=new THREE.Group();node.props.ref.current=root;
    const children=React.Children.toArray(node.props.children), lightNode=children.find(el=>el.type==='pointLight');
    const light=new THREE.PointLight();lightNode.props.ref.current=light;
    assert.equal(children.filter(el=>el.type==='mesh').length,2);
    const cleanups=h.effects.map(fn=>fn()).filter(Boolean);
    for(const ms of [142000,152000,138000,180000]) {
      timeRef.current=ms;h.frames.forEach(fn=>fn());
      const expected=sampleTownRocketPlumes(ms,reducedMotion);
      assert.equal(root.visible,expected.visible);near(light.intensity,expected.visible?expected.light:0);
      near(light.position.y,.8+expected.height);
    }
    cleanups.forEach(fn=>fn());
  }
});
