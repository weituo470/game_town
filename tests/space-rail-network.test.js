import test from 'node:test';import assert from 'node:assert/strict';
import {Client} from '@colyseus/sdk';import {matchMaker} from '@colyseus/core';
import {createTownServer} from '../server/index.js';import {PROTOCOL_VERSION} from '../shared/protocol.js';import {RAIL} from '../shared/space-rail.js';import {SPACE_ELEVATOR as E} from '../shared/space-layout.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(f){for(let i=0;i<160;i++){if(f())return;await sleep(25);}assert.ok(f());}
test('SDK peers share a moving train, bounded carriage walking, station exits and safe carriage state',async()=>{
 const server=await createTownServer({port:0,secret:'rail-network-tests-only-minimum-32-bytes',npcConfig:{enabled:false},npcSpeechConfig:{enabled:false},aiDroneConfig:{enabled:false},gameImageConfig:{enabled:false},gameCharacterConfig:{enabled:false},architectConfig:{enabled:false},architectSchedule:false});
 const peers=[];let code;
 const post=async(path,body)=>{const r=await fetch(server.url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 async function join(name){const guest=await post('/api/guest',{name}),seat=await post(code?'/api/towns/join':'/api/towns',{...guest,protocolVersion:PROTOCOL_VERSION,...(code?{code}:{})});code=seat.code;const r=await new Client(server.url).consumeSeatReservation(seat.reservation);r.onMessage('notice',()=>{});peers.push(r);await until(()=>r.state?.players?.has(r.sessionId));return r;}
 try{
 const a=await join('车厢验收'),b=await join('站台观察');const me=()=>a.state.players.get(a.sessionId),peer=()=>b.state.players.get(a.sessionId),room=matchMaker.getLocalRoomById(a.roomId),p=room.state.players.get(a.sessionId);
 a.send('space',{action:'rail-board',seq:0});await until(()=>me().spaceSeq===0);assert.equal(me().spaceMode,'ground','cannot board remotely');
 a.send('travel',{id:'spaceport'});await until(()=>Math.abs(me().z-54.8)<.01);
 room.state.railEpoch=0;a.send('space',{action:'rail-board',seq:1});await until(()=>peer()?.spaceMode==='rail');assert.ok(Math.abs(me().railX)<=1.201);
 a.send('input',{seq:0,x:0,z:1,thrust:true});await until(()=>me().railZ>.2);assert.equal(me().jetpack,false);
 a.send('input',{seq:1,x:0,z:0,stop:true});a.send('space',{action:'rail-depart',seq:2});await until(()=>room.state.railEpoch>0);room.state.railEpoch=Date.now()-5000;await until(()=>me().x>39);const x=me().x;
 await sleep(200);assert.ok(me().x>x,'passenger follows actual train translation');assert.ok(Math.abs(peer().x-me().x)<5);
 a.send('space',{action:'rail-exit',seq:3});a.send('travel',{id:'center'});await sleep(150);assert.equal(me().spaceMode,'rail','moving train blocks exit and shortcuts');
 room.state.railEpoch=Date.now()-(2000+RAIL.travel);await until(()=>Math.abs(me().x-(E.port.x-15))<2);a.send('space',{action:'rail-exit',seq:4});await until(()=>peer()?.spaceMode==='ground');assert.ok(Math.hypot(me().x-(E.port.x-15),me().z-(E.port.z+18))<6);
 }finally{await Promise.all(peers.map(p=>p.leave().catch(()=>{})));await server.close();}
});


