import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateLyricCues, findLyricCue, splitLyricLines, createLyricPointForms, createLyricFlightFrame } from '../src/components/drone/musicLyricPoints.js';
import { createMusicRehearsalRuntime } from '../src/components/drone/musicRehearsalRuntime.js';
import { createRehearsalPlan } from '../shared/musicRehearsal.js';
import { createDroneFleet } from '../shared/droneShow.js';
const cues=[{startMs:9000,endMs:12000,text:'原创测试甲'},{startMs:12000,endMs:15000,text:'原创测试乙'},{startMs:20000,endMs:23000,text:'原创测试丙'}];
const forms=cues.map((_,j)=>({points:Array.from({length:36},(_,i)=>[(i%9)*1.1-4.4,40+Math.floor(i/9)*1.1,j]),width:10,lines:1}));
test('lyric boundaries are exact, gap-safe and do not hold across instrumental passages',()=>{
 assert.equal(findLyricCue(cues,8999),-1);assert.equal(findLyricCue(cues,9000),0);assert.equal(findLyricCue(cues,12000),1);assert.equal(findLyricCue(cues,15000),-1);assert.equal(findLyricCue(cues,19999),-1);assert.equal(findLyricCue(cues,20000),2);assert.equal(findLyricCue(cues,23000),-1);
});
test('lyric inputs reject overlapping, invalid and oversized rows',()=>{
 assert.equal(validateLyricCues(cues,32000).length,3);
 for(const bad of [[{...cues[0],endMs:33000}],[{...cues[0],startMs:NaN}],[{...cues[0],text:' '}],[cues[1],cues[0]],Array(201).fill(cues[0])]) assert.throws(()=>validateLyricCues(bad,32000));
});
test('type wraps by Unicode code points, not broken surrogate pairs',()=>{
 assert.deepEqual(splitLyricLines('甲乙丙丁',2),['甲乙','丙丁']);assert.deepEqual(splitLyricLines('😀😀甲',2),['😀😀','甲']);
});
test('letter compiler samples discrete alpha glyphs and caches duplicate text',()=>{
 const made=[];
 const canvasFactory=()=>{const c={width:0,height:0,getContext(){return {clearRect(){},fillText(...v){made.push(v)},measureText(s){return {width:s.length*26}},getImageData(){const a=new Uint8ClampedArray(c.width*c.height*4);for(let y=10;y<20;y++)for(let x=190;x<210;x++)a[(y*c.width+x)*4+3]=255;return {data:a};}}}};return c;};
 const result=createLyricPointForms([cues[0],cues[0]],{canvasFactory});assert.equal(result[0],result[1]);assert(result[0].points.length>0);assert(result[0].points.every(p=>p.every(Number.isFinite)));assert.equal(made.length,1);
});
test('alternating text banks physically form ahead without removing the current phrase',()=>{
 const before=createLyricFlightFrame(cues,forms,11600,100);const current=before(0),next=before(1);assert.equal(current.cueIndex,0);assert.equal(next.cueIndex,1);assert(next.size<current.size);assert.notDeepEqual(next.point,forms[1].points[0]);
 const formed=createLyricFlightFrame(cues,forms,12000,100);assert.deepEqual(formed(1).point,forms[1].points[0]);assert.equal(formed(1).size,.22);
 assert.equal(formed(0).size,0,'old sentence lights switch off at its real end, without a ghost over the new words');
 const gap=createLyricFlightFrame(cues,forms,18000,100);assert.equal(gap(0),null);assert.equal(gap(1),null);
});
test('dense glyphs use the full lamp budget rather than losing half at a ceil stride boundary',()=>{
 const dense=[{points:Array.from({length:101},(_,i)=>[i,76,14]),width:101}];
 const frame=createLyricFlightFrame([cues[0]],dense,10000,200);
 assert.equal(Array.from({length:100},(_,i)=>frame(i*2)).filter(Boolean).length,100);
 assert.equal(frame(198).point[0],99);
});
test('the workbench validates timing without stripping authored and user-edited picture themes',()=>{
 const plan=createRehearsalPlan({durationMs:32000,lyrics:[{...cues[0],theme:'crowd'}]});
 assert.equal(plan.cues[0].theme,'crowd');
 const source=fs.readFileSync(new URL('../src/components/drone/MusicRehearsal.jsx',import.meta.url),'utf8');
 assert.match(source,/validateLyricCues\(shiftedLyrics, resource.durationMs\); plan = createRehearsalPlan/);
 assert.match(source,/lyrics: shiftedLyrics, beats/);
});
test('lyric fleet is deterministic, uses the existing buffers, never exports raw lyrics and returns all drones',()=>{
 const plan=createRehearsalPlan({durationMs:32000,lyrics:cues});assert(!JSON.stringify(plan).includes(cues[0].text));
 const runtime=createMusicRehearsalRuntime(plan,{lyrics:cues,lyricForms:forms});
 assert(runtime.program.supportsLyricDrones);
 for(const n of [2048,4096]){
  const fleet=createDroneFleet(n),ids=fleet.identities.slice(),p=fleet.positions;
  runtime.update(fleet,10000);assert.equal(fleet.positions,p);assert(fleet.positions.every(Number.isFinite));assert.deepEqual(fleet.identities,ids);
  assert.equal(fleet.positions[1],forms[0].points[0][1]);assert.equal(fleet.sizes[0],Math.fround(.22));
  const saved=fleet.positions.slice();runtime.update(fleet,20500);runtime.update(fleet,10000);assert.deepEqual(fleet.positions,saved);
  runtime.update(fleet,32000);assert.deepEqual(fleet.positions,fleet.bases);assert(fleet.colors.every(x=>x===0));
 }
});

