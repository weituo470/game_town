import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createStorybookKit } from '../src/components/town/buildings/StorybookBuildingKit.js';

test('storybook kit batches by material and pivot without changing world positions', () => {
  const kit=createStorybookKit({name:'KitTest',palette:{red:'#f00',blue:'#00f',unused:'#fff'}});
  kit.box('red',[1,1,0],[1,1,1]); kit.box('red',[2,1,0],[1,1,1]);
  const moving=kit.scope('Moving',[4,1,0]); kit.sphere('blue',[4,2,0],[.5,.5,.5]);
  const light=new THREE.PointLight();kit.group.add(light);
  const stats=kit.finish();
  assert.equal(stats.drawCalls,2); assert.equal(stats.materials,2);assert.equal(stats.partCount,3);assert.equal(stats.pointLights,1);
  assert.equal(kit.materials.unused,undefined);
  const b=new THREE.Box3().setFromObject(moving);assert.ok(Math.abs(b.min.y-1.5)<1e-6);assert.ok(Math.abs(b.max.y-2.5)<1e-6);
  assert.throws(()=>kit.box('red'),/finalized/);kit.dispose();
});

test('storybook kit owns independent geometry, materials and texture disposal exactly once', () => {
  const texture=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);texture.needsUpdate=true;
  const a=createStorybookKit({palette:{paint:{color:'#fed',map:texture}}});
  const b=createStorybookKit({palette:{paint:'#fed'}});
  for(const kit of [a,b]){kit.box('paint',[0,.5,0],[1,1,1]);kit.finish();}
  assert.notEqual(a.group.children[0].geometry,b.group.children[0].geometry);assert.notEqual(a.materials.paint,b.materials.paint);
  const seen=[];let count=0;
  for(const resource of [a.group.children[0].geometry,a.materials.paint,texture])resource.addEventListener('dispose',()=>{seen.push(resource);count++;});
  assert.equal(a.group.userData.stats.textures,1);a.dispose();a.dispose();assert.equal(count,3);assert.equal(new Set(seen).size,3);
  assert.ok(b.group.children[0].geometry.attributes.position.count>0);b.dispose();
});
