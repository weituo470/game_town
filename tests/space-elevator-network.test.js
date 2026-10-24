import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Client} from '@colyseus/sdk';
import {matchMaker} from '@colyseus/core';
import {createTownServer} from '../server/index.js';
import {PROTOCOL_VERSION} from '../shared/protocol.js';
import {SPACE_ELEVATOR as E,cityToWorld,orbitWorldPose,validSpaceAction} from '../shared/space-elevator.js';
import {cityMatrix} from '../src/components/space/spaceOrientation.js';
import {createStationWorldMapper} from '../src/orbit/client/components/station/stationWorldGeometry.js';
import {stationPoseFrame} from '../src/orbit/shared/ringStation.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,message){for(let i=0;i<160;i++){if(check())return;await sleep(25);}assert.ok(check(),message);}
test('remote city mapper bends logical metres before applying the kilometre parent transform',()=>{
 const parent=new THREE.Group();parent.matrix.copy(cityMatrix);parent.matrixAutoUpdate=false;
 const root=new THREE.Group();parent.add(root);
 const box=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5),new THREE.MeshBasicMaterial());box.position.set(72,0,75);root.add(box);
 const mapper=createStationWorldMapper(root,{externalFrame:true});mapper.sync();
 const at=new THREE.Vector3();box.getWorldPosition(at);const expected=cityToWorld(stationPoseFrame({x:72,y:0,z:75}).position);
 assert.ok(at.distanceTo(new THREE.Vector3(...expected))<1e-6);parent.updateMatrixWorld(true);box.getWorldPosition(at);assert.ok(at.distanceTo(new THREE.Vector3(...expected))<1e-6);
 mapper.dispose();box.geometry.dispose();box.material.dispose();
});
test('space commands reject coordinates, replay, nonfinite sequence and unknown actions',()=>{
 assert.ok(validSpaceAction({action:'ascend',seq:0}));
 for(const p of [{action:'ascend',seq:0,x:420},{action:'teleport',seq:1},{action:'ascend',seq:NaN},{action:'descend',seq:-1},[],null])assert.equal(validSpaceAction(p),false);
 assert.equal(validSpaceAction({action:'ascend',seq:1},1),false);
});
test('two real SDK peers observe server-owned ascent, city walking, blocked shortcuts and descent',async()=>{
 const server=await createTownServer({port:0,secret:'space-elevator-tests-only-minimum-32-bytes',npcConfig:{enabled:false},npcSpeechConfig:{enabled:false},aiDroneConfig:{enabled:false},gameImageConfig:{enabled:false},gameCharacterConfig:{enabled:false},architectConfig:{enabled:false},architectSchedule:false});
 const rooms=[];let code;
 const post=async(path,body)=>{const response=await fetch(server.url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 const connect=async(name)=>{const guest=await post('/api/guest',{name});const data=await post(code?'/api/towns/join':'/api/towns',{...guest,protocolVersion:PROTOCOL_VERSION,...(code?{code}:{})});code=data.code;const room=await new Client(server.url).consumeSeatReservation(data.reservation);room.onMessage('notice',()=>{});rooms.push(room);await until(()=>room.state?.players?.has(room.sessionId),'replicated first state');return room;};
 try{
  const a=await connect('乘梯验收员'),b=await connect('地面观察员'),id=a.sessionId;
  const me=()=>a.state.players.get(id),peer=()=>b.state.players.get(id);
  a.send('space',{action:'ascend',seq:0});await until(()=>me().spaceSeq===0,'invalid far request acknowledged');assert.equal(me().spaceMode,'ground');
  a.send('travel',{id:'spaceport'});await until(()=>Math.abs(me().x-36)<.1,'named shortcut only reaches town rail station');
  const authoritative=matchMaker.getLocalRoomById(a.roomId),player=authoritative.state.players.get(id);
  Object.assign(player,{x:E.port.x,z:E.port.z,y:0});await until(()=>Math.abs(me().x-E.port.x)<.1,'test fixture at physical elevator');
  a.send('space',{action:'ascend',seq:1});await until(()=>peer()?.spaceMode==='ascent','peer sees ascent');assert.equal(me().aboard,false);
  const launch=player.spaceStartAt;
  a.send('space',{action:'ascend',seq:1});await sleep(80);assert.equal(player.spaceStartAt,launch,'replay cannot restart ride');
  player.spaceStartAt-=E.durationMs;await until(()=>peer()?.spaceMode==='orbit','server reaches ring');
  const expected=orbitWorldPose(E.dock).position;assert.ok(Math.hypot(me().x-expected[0],me().y-expected[1],me().z-expected[2])<.1);
  const localX=me().orbitX;a.send('input',{x:-1,z:0,seq:0});await until(()=>me().orbitX<localX-.1,'authoritative walking on ring');a.send('input',{x:0,z:0,seq:1,stop:true});
  a.send('travel',{id:'center'});await sleep(100);assert.equal(me().spaceMode,'orbit','ground shortcut cannot teleport an orbit player');
  a.send('space',{action:'descend',seq:2});await until(()=>peer()?.spaceMode==='descent','peer sees descent');
  player.spaceStartAt-=E.durationMs;await until(()=>peer()?.spaceMode==='ground','server lands at offshore port');assert.ok(Math.hypot(me().x-E.port.x,me().z-E.port.z)<.1);assert.equal(me().y,0);
 }finally{await Promise.all(rooms.map(r=>r.leave().catch(()=>{})));await server.close();}
});
