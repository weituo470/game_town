import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs';
import { createRainbowCloudPavilion as create, RAINBOW_SPEC } from '../src/components/town/buildings/createRainbowCloudPavilion.js';
function state(a){return JSON.stringify({elapsed:a.group.userData.elapsed,groups:a.group.children.filter(o=>o.isGroup).map(o=>[o.position.toArray(),o.rotation.toArray()]),materials:a.group.children.flatMap(o=>o.isMesh?[o.material.emissiveIntensity]:o.children.filter(m=>m.isMesh).map(m=>m.material.emissiveIntensity))});}
test('rainbow factory exposes its named independently reusable contract',t=>{
 const a=create();t.after(()=>a.dispose());assert.equal(a.group.name,'RainbowCloudPavilionAsset');assert.equal(a.group.userData.spec,RAINBOW_SPEC);assert.equal(a.stats,a.group.userData.stats);assert.equal(a.group.userData.elapsed,0);assert.ok(a.group.getObjectByName('CloudRainJewels'));
});
test('rainbow geometry is finite and reported resources agree with actual meshes',t=>{
 const a=create();t.after(()=>a.dispose());let meshes=0,tris=0;const mats=new Set();a.group.traverse(o=>{if(!o.isMesh)return;meshes++;mats.add(o.material);assert.equal(o.material.map,null);tris+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;for(const attr of Object.values(o.geometry.attributes))for(const v of attr.array)assert.ok(Number.isFinite(v));});assert.equal(meshes,a.stats.drawCalls);assert.equal(meshes,a.stats.geometries);assert.equal(tris,a.stats.triangles);assert.equal(mats.size,a.stats.materials);assert.ok(meshes<=RAINBOW_SPEC.drawCallBudget);assert.ok(tris<=RAINBOW_SPEC.triangleBudget);
});
test('rainbow remains above the ground and inside its animation envelope',t=>{
 const a=create();t.after(()=>a.dispose());for(let phase=0;phase<7;phase++){for(let i=0;i<45;i++)a.update(.05);a.group.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(a.group);assert.ok(b.min.y>=-1e-5);assert.ok(Math.abs(b.min.x)<=RAINBOW_SPEC.width/2);assert.ok(b.max.x<=RAINBOW_SPEC.width/2);assert.ok(Math.abs(b.min.z)<=RAINBOW_SPEC.depth/2);assert.ok(b.max.z<=RAINBOW_SPEC.depth/2);assert.ok(b.max.y<=RAINBOW_SPEC.height);}
});
test('only rain jewel transform animates and reduced-motion freezes exactly',t=>{
 const a=create();t.after(()=>a.dispose());const meshes=a.group.children.filter(o=>o.isMesh),before=meshes.map(o=>o.matrix.toArray());const initial=state(a);a.update(.05);assert.notEqual(state(a),initial);assert.deepEqual(meshes.map(o=>o.matrix.toArray()),before);const frozen=state(a);for(let i=0;i<12;i++)a.update(.05,true);assert.equal(state(a),frozen);a.update(.05);assert.notEqual(state(a),frozen);
});
test('invalid deltas are ignored and large deltas are clamped',t=>{
 const a=create();t.after(()=>a.dispose());const initial=state(a);for(const delta of [NaN,Infinity,-Infinity,0,-1,undefined])a.update(delta);assert.equal(state(a),initial);a.update(100);assert.equal(a.group.userData.elapsed,.05);
});
test('rainbow GPU resources are independently owned and disposed once',()=>{
 const a=create(),b=create();assert.notEqual(a.group.children.find(o=>o.isMesh).geometry,b.group.children.find(o=>o.isMesh).geometry);const resources=new Set();a.group.traverse(o=>{if(o.isMesh){resources.add(o.geometry);resources.add(o.material);}});let disposal=0;for(const r of resources)r.addEventListener('dispose',()=>disposal++);const host=new THREE.Group();host.add(a.group);a.dispose();a.dispose();assert.equal(disposal,resources.size);assert.equal(host.children.length,0);const frozen=state(a);a.update(.05);assert.equal(state(a),frozen);b.update(.05);assert.equal(b.group.userData.elapsed,.05);b.dispose();const fresh=create();fresh.update(.05);assert.equal(fresh.group.userData.elapsed,.05);fresh.dispose();
});
test('rainbow R3F wrapper allocates and cleans up after commit',()=>{
 const text=fs.readFileSync(new URL('../src/components/town/buildings/RainbowCloudPavilion.jsx',import.meta.url),'utf8');assert.match(text,/useLayoutEffect/);assert.match(text,/parent\.remove\(building\.group\)/);assert.match(text,/building\.dispose\(\)/);assert.match(text,/dispose=\{null\}/);
});

