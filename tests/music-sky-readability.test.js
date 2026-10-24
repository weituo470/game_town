import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicFleet, musicFleetCount } from '../src/components/drone/musicFleet.js';
import { LYRIC_GLYPH_PROFILE, createLyricPointForms } from '../src/components/drone/musicLyricPoints.js';
import { createMusicRehearsalRuntime } from '../src/components/drone/musicRehearsalRuntime.js';
import { createRehearsalPlan } from '../shared/musicRehearsal.js';
import { createDroneFleet, DRONE_COUNT } from '../shared/droneShow.js';
import { createFleetUpdateGate } from '../src/components/drone/dronePerformance.js';

test('paused music re-samples lettering after a responsive layout revision',()=>{
 const gate=createFleetUpdateGate();assert(gate(12000,false,null,0));assert(!gate(12000,false,null,0));assert(gate(12000,false,null,1));assert(!gate(12000,false,null,1));assert(gate(12000,false,null,2));
});

test('music has 16384 / 12288 unique aircraft without raising the legacy artwork limit',()=>{
 assert.equal(musicFleetCount('high'),16384);assert.equal(musicFleetCount('low'),12288);
 for(const count of [12288,16384]){
  const fleet=createMusicFleet(count);assert.equal(new Set(fleet.identities).size,count);assert(fleet.bases.every(Number.isFinite));assert.deepEqual(fleet.positions,fleet.bases);
  assert.equal(new Set(Array.from({length:count},(_,i)=>`${fleet.bases[i*3]},${fleet.bases[i*3+2]}`)).size,count);
  assert(fleet.pads.every(p=>p>=0&&p<4));
 }
 assert.equal(DRONE_COUNT,4096);assert.throws(()=>createDroneFleet(16384));assert.throws(()=>createMusicFleet(65536));
});

test('48px high-detail glyphs keep a two-pixel sampling lattice and fit a bounded subtitle band',()=>{
 let font='';
 const canvasFactory=()=>{
  const c={width:0,height:0,getContext(){return {
   clearRect(){}, set font(v){font=v}, fillText(){},
   measureText(s){return {width:[...s].length*48}},
   getImageData(){const data=new Uint8ClampedArray(c.width*c.height*4);for(let y=10;y<52;y++)for(let x=80;x<550;x++)data[(y*c.width+x)*4+3]=255;return {data}}
  }}};
  return c;
 };
 const row={text:'原创点阵文字清晰测试'};
 const [form]=createLyricPointForms([row],{canvasFactory});
 assert.equal(LYRIC_GLYPH_PROFILE.fontPixels,48);assert.match(font,/48px/);assert.equal(form.sampleStep,2);assert(form.points.length>4000);assert(form.width<=248+1e-8);assert(form.height<=52+1e-8);
 assert(form.points.every(p=>p.every(Number.isFinite)));assert(new Set(form.points.map(p=>p.join(','))).size===form.points.length);
});

test('large music fleet preserves every glyph sample, seek identity and complete landing',()=>{
 const lyrics=[{startMs:8000,endMs:15000,text:'原创点阵测试',theme:'bund-skyline'}];
 const forms=[{width:160,lines:1,points:Array.from({length:3001},(_,i)=>[(i%100-50)*1.1,105+Math.floor(i/100)*.5,14])}];
 const runtime=createMusicRehearsalRuntime(createRehearsalPlan({durationMs:32000,lyrics}),{lyrics,lyricForms:forms});
 for(const quality of ['low','high']){
  const fleet=runtime.createFleet(runtime.fleetCount(quality)),ids=fleet.identities.slice(),positions=fleet.positions;
  runtime.update(fleet,10000);assert.equal(fleet.musicStats.lyricLamps,3001);assert.equal(fleet.musicStats.lyricRequired,3001);assert(fleet.musicStats.storyLamps>1000);
  const saved=fleet.positions.slice();runtime.update(fleet,21000);runtime.update(fleet,10000);assert.deepEqual(fleet.positions,saved);assert.equal(fleet.positions,positions);assert.deepEqual(fleet.identities,ids);
  const storyY=Array.from({length:fleet.count-fleet.musicStats.textBudget},(_,j)=>fleet.positions[(j+fleet.musicStats.textBudget)*3+1]);assert(Math.max(...storyY)>215);
  runtime.update(fleet,32000);assert.deepEqual(fleet.positions,fleet.bases);assert(fleet.colors.every(x=>x===0));
 }
 for(const aspect of [.46,1.78,2.35])assert(Object.values(runtime.camera(10000,aspect)).flat().every(Number.isFinite));
});
