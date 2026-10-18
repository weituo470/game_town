import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOSE_THIRD_PERSON, closeThirdPersonCamera, closeThirdPersonLens } from '../src/components/town/firstPerson.js';
import { WORLD_LOCATIONS } from '../shared/world.js';

const open = { blocked: () => false };
const separation = ({ position:p, target:t }) => Math.hypot(p.x-t.x,p.y-t.y,p.z-t.z);

test('close-third-person camera: default boom is 4.4m behind and above a visible full-body target', () => {
  const pose = Object.freeze({ x:0,y:0,z:0 });
  const view = closeThirdPersonCamera(pose,0,.12,open);
  assert.equal(CLOSE_THIRD_PERSON.fov,58);
  assert.ok(Math.abs(separation(view)-4.4)<1e-12);
  assert.ok(view.position.z>4.2 && view.position.y>2.2);
  assert.equal(view.target.y,1.15); assert.equal(view.clipped,false);
  assert.deepEqual(pose,{x:0,y:0,z:0});
});

test('close-third-person camera: orbit heading and flying altitude are independent of the avatar simulation', () => {
  for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
    const grounded=closeThirdPersonCamera({x:3,y:0,z:5},yaw,.12,open);
    const flying=closeThirdPersonCamera({x:3,y:16,z:5},yaw,.12,open);
    assert.ok(Math.abs(flying.position.y-grounded.position.y-16)<1e-12);
    assert.equal(flying.position.x,grounded.position.x);assert.equal(flying.position.z,grounded.position.z);
    assert.ok(Math.abs(flying.target.y-grounded.target.y-16)<1e-12);
    assert.ok((flying.position.x-3)*Math.sin(yaw)+(flying.position.z-5)*-Math.cos(yaw)<-4);
  }
});

test('close-third-person camera: portrait gives the full character room while desktop stays close', () => {
  const mobile=closeThirdPersonLens(390/844),desktop=closeThirdPersonLens(1280/720);
  assert.deepEqual(mobile,{distance:5.2,fov:62});assert.deepEqual(desktop,{distance:4.4,fov:58});
  for(const aspect of [390/844,.65]){
    const view=closeThirdPersonCamera({x:0,y:0,z:0},0,.12,{...open,aspect});
    assert.ok(Math.abs(separation(view)-5.2)<1e-12);
    const wall=closeThirdPersonCamera({x:0,y:0,z:0},0,.12,{aspect,blocked:(x,y,z)=>z>2.3&&y<9});
    assert.equal(wall.clipped,true);assert.ok(wall.position.z<2.1,'longer portrait boom still sweeps walls');
  }
  for(const aspect of [1,NaN,0,undefined])assert.equal(closeThirdPersonLens(aspect).distance,4.4);
});

test('close-third-person camera: swept boom retreats before a wall, but high flight clears its roof', () => {
  const wall={blocked:(x,y,z)=>z>2.3&&y<9};
  const near=closeThirdPersonCamera({x:0,y:0,z:0},0,.12,wall);
  assert.equal(near.clipped,true);assert.ok(near.position.z<2.1);assert.ok(separation(near)<2.3);
  const above=closeThirdPersonCamera({x:0,y:12,z:0},0,.12,wall);
  assert.equal(above.clipped,false);assert.ok(Math.abs(separation(above)-4.4)<1e-12);
});

test('close-third-person camera: a thin intervening wall is not missed even if the endpoint is clear', () => {
  const view=closeThirdPersonCamera({x:0,y:0,z:0},0,.12,{blocked:(x,y,z)=>z>2&&z<2.15});
  assert.equal(view.clipped,true);assert.ok(view.position.z<2);
});

test('close-third-person camera: real town building geometry shortens the camera without changing feet', () => {
  const building=WORLD_LOCATIONS[0];
  const pose=Object.freeze({x:building.x,y:0,z:building.z+3.9});
  const close=closeThirdPersonCamera(pose,Math.PI,.12);
  assert.equal(close.clipped,true);assert.ok(close.distance<3.8);
  const aerial=closeThirdPersonCamera({...pose,y:14},Math.PI,.12);
  assert.equal(aerial.clipped,false);
  assert.equal(pose.y,0);
});

test('close-third-person camera: tight corners use a clear over-head fallback and invalid inputs remain finite', () => {
  const tight=closeThirdPersonCamera({x:0,y:8,z:0},0,.12,{blocked:(x,y,z)=>z>.2});
  assert.equal(tight.clipped,true);assert.equal(tight.position.x,0);assert.equal(tight.position.z,0);assert.equal(tight.position.y,10.7);
  for(const pose of [null,{}, {x:Infinity,y:NaN,z:undefined}])for(const pitch of [-100,0,100,NaN]){
    const view=closeThirdPersonCamera(pose,NaN,pitch,open);
    assert.ok(Object.values(view.position).every(Number.isFinite));assert.ok(Object.values(view.target).every(Number.isFinite));
    assert.ok(view.position.y>=.35);
  }
});
