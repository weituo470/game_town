import test from 'node:test';
import assert from 'node:assert/strict';
import {RAIL,RAIL_LENGTH,railPoint,railFrame,sampleRail,railPassenger,canBoardRail,stepRail} from '../shared/space-rail.js';
import {isWalkable,getDestination} from '../shared/world.js';
import {sampleElevator,SPACE_ELEVATOR as E,canAscend} from '../shared/space-elevator.js';
test('tube line joins town walkway to remote island using real shared endpoints',()=>{
 assert.ok(RAIL_LENGTH>1500&&RAIL_LENGTH<1800);
 assert.deepEqual(railPoint(0),RAIL.points[0]);assert.deepEqual(railPoint(1),RAIL.points.at(-1));
 assert.ok(isWalkable(36,40));assert.ok(isWalkable(36,54.8));assert.ok(isWalkable(E.port.x-15,E.port.z+18));
 assert.deepEqual(getDestination('spaceport'),{x:36,z:54.8,yaw:Math.PI/2});
});
test('single leg has continuous motion and stable endpoints (automatic schedule owns subsequent legs)',()=>{
 const epoch=1000,end=2000+RAIL.travel;
 assert.equal(sampleRail(0,999999).station,0);assert.equal(sampleRail(0,999999,1).station,1);
 assert.equal(sampleRail(epoch,epoch).departing,true);assert.equal(sampleRail(epoch,epoch+end).station,1);
 let previous=sampleRail(epoch,epoch).position,max=0;
 for(let t=16;t<end;t+=16){const p=sampleRail(epoch,epoch+t).position;max=Math.max(max,Math.hypot(...p.map((v,i)=>v-previous[i])));previous=p;}
 assert.ok(max<1.3,'less than one metre per 16 ms, no route teleport');
 assert.equal(sampleRail(epoch,epoch+999999).station,1);
 assert.equal(sampleRail(epoch,epoch+end,1).station,0);
});
test('boarding requires a physical stopped car, onboard walking is bounded, air exit cannot be forged',()=>{
 const train=sampleRail(0,0),frame=railFrame(0),at={x:36,y:0,z:57};
 assert.ok(canBoardRail(at,train));assert.equal(canBoardRail({...at,x:0},train),false);assert.equal(canBoardRail(at,sampleRail(1,5001)),false);
 const p=railPassenger({railX:999,railZ:-999},train);assert.equal(p.railX,1.2);assert.equal(p.railZ,-5.5);
 for(let i=0;i<1000;i++)Object.assign(p,stepRail(p,{x:1,z:1,thrust:true},.1));assert.ok(p.railX<=1.2&&p.railZ<=5.5);assert.equal(p.jetpack,false);
 assert.ok(Number.isFinite(frame.yaw));
});
test('lift holds doors at both ends, reaches 100 km, and requires walking inside the cabin',()=>{
 assert.equal(sampleElevator(3000).progress,0);assert.equal(sampleElevator(E.durationMs-3000).progress,1);
 assert.ok(sampleElevator(E.durationMs).position[1]>99000);
 assert.equal(canAscend({x:E.port.x+4,z:E.port.z,y:0}),false);
 assert.ok(canAscend({x:E.port.x+1,z:E.port.z,y:0}));
});
