import test from 'node:test';
import assert from 'node:assert/strict';
import { JETPACK, stepAvatar, stepFlightVertical, stoppedVertical, flightFloor, safeLanding } from '../shared/jetpack.js';
import { SPAWN, DISTRICTS, isWalkable } from '../shared/world.js';
import { WONDERS, EXPLORATION_BOUNDS } from '../shared/wonders.js';
import { FISHING_SPOT, onRiverPier, RIVER_PIER } from '../shared/river.js';
import { validInput } from '../server/TownRoom.js';
import { sequencedInput } from '../src/components/town/inputSequence.js';

const start = (position = SPAWN) => ({ ...position, y: 0, vy: 0, jetpack: false, thrusting: false, hovering: false });
function run(state, input, seconds, fps = 60) { for (let t=0;t<seconds-1e-9;t+=1/fps) Object.assign(state,stepAvatar(state,input,Math.min(1/fps,seconds-t))); return state; }

test('global jetpack: every district, wonder and river pier can launch in place without a route', () => {
  for (const position of [SPAWN,...DISTRICTS,...WONDERS.map(w=>w.arrival),FISHING_SPOT]) {
    const s=start(position); run(s,{x:0,z:0,thrust:true},1);
    assert.ok(s.y>2 && s.jetpack && s.thrusting,JSON.stringify(position)); assert.equal(s.x,position.x); assert.equal(s.z,position.z);
  }
});
test('global jetpack: releasing instantly cuts upward momentum, falls, and can reignite before landing', () => {
  const s=start(); run(s,{x:0,z:0,thrust:true},2); const height=s.y;
  run(s,{x:0,z:0,thrust:false},0.05); assert.ok(s.y<height); assert.ok(s.vy<0); assert.equal(s.thrusting,false);
  run(s,{x:0,z:0,thrust:true},0.5); assert.ok(s.vy>0); assert.equal(s.thrusting,true);
  run(s,{x:0,z:0,thrust:false},10); assert.equal(s.y,0); assert.equal(s.jetpack,false);
});
test('global jetpack: sustained flight has no altitude/fuel cap while horizontal boundaries remain bounded', () => {
  const heights=[];
  for(const fps of [15,60,120]) {
    const s=start();run(s,{x:0,z:0,thrust:true},60,fps);assert.ok(s.y>400);assert.equal(s.thrusting,true);heights.push(s.y);
    const firstHeight=s.y;run(s,{x:1,z:0,thrust:true},40,fps);assert.ok(s.x<=EXPLORATION_BOUNDS.maxX);assert.ok(s.y>firstHeight+279);
  }
  assert.ok(Math.max(...heights)-Math.min(...heights)<0.02);
  assert.equal(Object.hasOwn(JETPACK,'ceiling'),false);
});
test('global jetpack: high flight clears roofs; releasing lands on roof, low flight cannot pass through walls', () => {
  const s={...start({x:10,z:10,yaw:0}),y:11,jetpack:true};run(s,{x:1,z:0,thrust:false},0.7);
  assert.ok(s.x>14);run(s,{x:0,z:0,thrust:false},2);assert.equal(s.y,9);assert.equal(flightFloor(s.x,s.z),9);
  const low={...start({x:10,z:10,yaw:0}),y:2,jetpack:true};run(low,{x:1,z:0,thrust:false},0.7);assert.ok(low.x<11.8);
});
test('global jetpack: water landing returns to a walkable bank and stop cuts engine without teleporting', () => {
  const s={...start({x:-53.5,z:-12,yaw:0}),y:0.02,vy:-3,jetpack:true};run(s,{x:0,z:0,thrust:false},0.1);
  assert.equal(s.y,0);assert.ok(isWalkable(s.x,s.z));assert.equal(s.moving,false);
  const cut=stoppedVertical({y:12,vy:7,jetpack:true,thrusting:true});assert.equal(cut.thrusting,false);assert.ok(!('y' in cut));assert.equal(cut.vy,0);
  const safe=safeLanding(-70,-15);assert.ok(isWalkable(safe.x,safe.z));
});
test('river: entire pier connects the original west street to the fishing position; water is not walkable', () => {
  for(let x=RIVER_PIER.x-RIVER_PIER.width/2+0.3;x<=-38;x+=0.2) assert.ok(isWalkable(x,-4),`pier gap at ${x}`);
  assert.ok(onRiverPier(FISHING_SPOT.x,FISHING_SPOT.z));assert.equal(isWalkable(-53.5,-12),false);
});
test('global jetpack: packets contain intent only, preserve release false, reject spoofed positions and non-booleans', () => {
  const snapshot={selfId:'self',players:[{id:'self',seq:5,connected:true}]};
  for(const thrust of [true,false]){const p=sequencedInput({x:0,z:0,thrust},0,snapshot,'self');assert.equal(p.thrust,thrust);assert.equal(validInput(p,5),true);}
  for(const extra of [{thrust:1},{thrust:'true'},{thrust:true,y:99},{thrust:true,jetpack:true},{thrust:true,stop:true},{thrust:true,jump:true}]) assert.equal(validInput({x:0,z:0,seq:9,...extra}),false);
  assert.ok(Number.isFinite(stepFlightVertical({y:Infinity,vy:NaN},true,NaN).y));
});
