import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformWithEsbuild } from 'vite';
import * as THREE from 'three';
import { SAOPass } from 'three/addons/postprocessing/SAOPass.js';
import { flightCameraFar } from '../src/components/town/camera.js';

const file=new URL('../src/components/town/SceneEffects.jsx',import.meta.url);
const source=await transformWithEsbuild(fs.readFileSync(file,'utf8'),'SceneEffects.jsx',{loader:'jsx',jsx:'automatic',format:'cjs'});
const module={exports:{}};
vm.runInNewContext(source.code,{
  module,exports:module.exports,
  require(id){
    if(id==='three')return THREE;
    if(id==='three/addons/postprocessing/SAOPass.js')return {SAOPass};
    return {};
  },
});
const {HalfResolutionAO}=module.exports;

test('free-flight AO: real SAOPass inverse projection follows altitude, FOV and aspect without reallocating its uniform',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,1280/720,.08,420);
  const ao=new HalfResolutionAO(scene,camera,new THREE.Vector2(16,16));
  assert.ok(ao instanceof SAOPass);
  const wrapper=ao.saoMaterial.uniforms.cameraInverseProjectionMatrix;
  const matrix=wrapper.value;
  const originalRender=SAOPass.prototype.render;
  let renders=0;
  SAOPass.prototype.render=function(){
    renders++;
    assert.equal(this.saoMaterial.uniforms.cameraInverseProjectionMatrix,wrapper);
    assert.equal(wrapper.value,matrix,'render updates the existing matrix instead of allocating');
    assert.deepEqual(matrix.elements,camera.projectionMatrixInverse.elements);
    const identity=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,matrix);
    identity.elements.forEach((value,index)=>assert.ok(Math.abs(value-(index%5===0?1:0))<1e-8));
    for(const viewPoint of [new THREE.Vector3(0,0,-4.4),new THREE.Vector3(3,6,-Math.min(camera.far-1,1000))]){
      const clip=viewPoint.clone().applyMatrix4(camera.projectionMatrix);
      const reconstructed=clip.clone().applyMatrix4(matrix);
      assert.ok(reconstructed.distanceTo(viewPoint)<1e-6,'the shader inverse reconstructs view-space depth');
    }
  };
  try{
    for(const [height,fov,aspect] of [[0,50,1280/720],[80,50,1280/720],[1000,58,1280/720],[1000,62,390/844],[0,50,1280/720]]){
      camera.far=flightCameraFar(height);camera.fov=fov;camera.aspect=aspect;camera.updateProjectionMatrix();
      ao.render(null,null,null,0);
    }
    assert.equal(renders,5);
  }finally{SAOPass.prototype.render=originalRender;ao.dispose();}
});

test('free-flight AO: excluded sky/transparency are restored even when the underlying render throws',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(58,1,.08,840);
  const sky=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial());sky.userData.isSky=true;
  const glass=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial({transparent:true}));
  const opaque=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial());
  const alreadyHidden=new THREE.Group();alreadyHidden.visible=false;alreadyHidden.userData.isSky=true;
  scene.add(sky,glass,opaque,alreadyHidden);
  const ao=new HalfResolutionAO(scene,camera,new THREE.Vector2(16,16));
  const originalRender=SAOPass.prototype.render;
  SAOPass.prototype.render=function(){assert.equal(sky.visible,false);assert.equal(glass.visible,false);assert.equal(opaque.visible,true);throw new Error('test render failure');};
  try{
    assert.throws(()=>ao.render(null,null,null),/test render failure/);
    assert.equal(sky.visible,true);assert.equal(glass.visible,true);assert.equal(opaque.visible,true);assert.equal(alreadyHidden.visible,false);
  }finally{SAOPass.prototype.render=originalRender;ao.dispose();for(const mesh of [sky,glass,opaque]){mesh.geometry.dispose();mesh.material.dispose();}}
});


test('AO physical radius, minimum distance and blur depth remain invariant at space viewing ranges',()=>{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,1,.08,1800);
 const ao=new HalfResolutionAO(scene,camera,new THREE.Vector2(16,16));
 Object.assign(ao.params,{saoScale:6,saoMinResolution:.001,saoBlurDepthCutoff:.015});
 const saved={...ao.params},original=SAOPass.prototype.render;
 SAOPass.prototype.render=function(){
  assert.ok(Math.abs(this.params.saoScale/camera.far-6/420)<1e-10);
  assert.ok(Math.abs(this.params.saoMinResolution*camera.far-.42)<1e-10);
  assert.ok(Math.abs(this.params.saoBlurDepthCutoff*(camera.far-camera.near)-.015*(420-camera.near))<1e-8);
  if(camera.far===200000)throw new Error('restore parameters');
 };
 try{for(const far of [1800,12000,160000,200000]){
  camera.far=far;camera.updateProjectionMatrix();
  if(far===200000)assert.throws(()=>ao.render(null,null,null),/restore parameters/);else ao.render(null,null,null);
  assert.deepEqual(ao.params,saved);
 }}finally{SAOPass.prototype.render=original;ao.dispose();}
});

test('HDR AO cannot create negative colour halos',()=>{const ao=new HalfResolutionAO(new THREE.Scene(),new THREE.PerspectiveCamera());assert.match(ao.saoMaterial.fragmentShader,/clamp\(ambientOcclusion, 0.0, 0.35\)/);ao.dispose();});
