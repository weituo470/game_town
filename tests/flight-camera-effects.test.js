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
