import test from 'node:test';
import assert from 'node:assert/strict';
import {RAIL,RAIL_LENGTH,advanceRailSchedule,sampleRail,nearRailStation,canBoardRail} from '../shared/space-rail.js';
import {SPACE_ELEVATOR as E} from '../shared/space-layout.js';

test('remote terminal is 1.5 km offshore and both station contracts follow its new location',()=>{
 assert(Math.hypot(E.port.x,E.port.z)>1500);assert(RAIL_LENGTH>1500);
 assert.equal(nearRailStation({x:E.port.x-15,z:E.port.z+18}),1);
 assert.equal(nearRailStation({x:36,z:54.8}),0);
 assert.equal(nearRailStation({x:405,z:-362}),-1);
});
test('unattended service opens doors, departs automatically, dwells remotely, then returns',()=>{
 const initial=advanceRailSchedule(0,1000),departure=1000+RAIL.dwell;
 const sample=(time,state=initial)=>{const next=advanceRailSchedule(state.railEpoch,time,state.railFrom);return {state:next,train:sampleRail(next.railEpoch,time,next.railFrom)};};
 assert.equal(sample(1000).train.docked,true);assert.equal(sample(1000).train.dwellRemaining,18);
 assert(canBoardRail({x:36,y:0,z:54.8},sample(1000).train));
 assert.equal(sample(departure).train.docked,false);
 const arrival=departure+2000+RAIL.travel,atIsland=sample(arrival);
 assert.equal(atIsland.train.station,1);assert.equal(atIsland.train.dwellRemaining,18);
 const returning=sample(arrival+RAIL.dwell+10000,atIsland.state);
 assert.equal(returning.train.docked,false);assert.equal(returning.train.direction,-1);
 assert.equal(sample(arrival+RAIL.dwell+2000+RAIL.travel).train.station,0);
});
test('schedule advancement is continuous, repeatable, and catches up after a long suspended tab',()=>{
 let state=advanceRailSchedule(0,1000),previous=sampleRail(state.railEpoch,1000,state.railFrom).position;
 const end=1000+(RAIL.dwell+RAIL.travel+2000)*3;
 for(let time=1016;time<end;time+=16){state=advanceRailSchedule(state.railEpoch,time,state.railFrom);const t=sampleRail(state.railEpoch,time,state.railFrom);assert(Math.hypot(...t.position.map((x,i)=>x-previous[i]))<1.3);previous=t.position;}
 const late=end+200000,initial=advanceRailSchedule(0,1000),direct=advanceRailSchedule(initial.railEpoch,late,initial.railFrom),incremental=advanceRailSchedule(state.railEpoch,late,state.railFrom);
 assert.deepEqual(direct,incremental);
});
