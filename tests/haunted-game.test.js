import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAP, START, EXIT, CLUES, OPTIONAL, walkable, initialState, movePlayer, inspectItem, shortestPath, canFinish, resultFor, createActiveClock, nextGoal } from '../src/minigames/haunted/logic.js';
import { auditSources } from '../scripts/check-readability.mjs';
import { createHouseAudio } from '../src/minigames/haunted/audio.js';
const go = (state, goal) => shortestPath(state.position, goal).reduce((s, [dx,dy]) => movePlayer(s,dx,dy),state);

test('map is enclosed, rectangular and every walkable tile, clue and exit is reachable', () => {
  assert.ok(MAP.every(row=>row.length===13));
  MAP.forEach((row,y)=>[...row].forEach((tile,x)=> { if(tile!=='#') assert.notEqual(shortestPath(START,{x,y}),null); }));
  for(const target of [...CLUES,...OPTIONAL,EXIT]) assert.ok(shortestPath(START,target).length>0);
  assert.equal(new Set([...CLUES,...OPTIONAL].map(item=>`${item.x},${item.y}`)).size,5);
  for(let x=0;x<13;x++) { assert.equal(walkable(x,0),false); assert.equal(walkable(x,10),false); }
});
test('walls and bounds stop movement; diagonal/invalid moves do not mutate state',()=>{
  const s=initialState();
  assert.deepEqual(movePlayer(s,-1,0).position,START);
  assert.equal(movePlayer(s,-1,0).steps,0);
  assert.equal(movePlayer(s,1,1),s);
  assert.equal(walkable(-1,2),false);
  assert.equal(walkable(500,500),false);
});
test('all clues can be collected in any order and exit remains locked until all three',()=>{
  for (const order of [[0,1,2],[2,0,1],[1,2,0],[0,2,1],[2,1,0],[1,0,2]]) {
    let state=go(initialState(),EXIT); assert.equal(canFinish(state),false); assert.equal(resultFor(state,10,'touch'),null);
    for(const i of order) {
      state=go(state,CLUES[i]);
      const inspected=inspectItem(state); assert.equal(inspected.item.id,CLUES[i].id); state=inspected.state;
      assert.equal(inspectItem(state).item,null);
    }
    state=go(state,EXIT); assert.ok(canFinish(state));
    const result=resultFor(state,78.623,'touch');
    assert.equal(result.gameId,'haunted'); assert.equal(result.durationSeconds,78.6); assert.equal(result.score,100);
    assert.equal(result.inputDevice,'touch'); assert.equal(result.completed,true); assert.equal(result.difficulty,'standard');
    assert.equal(result.metrics.cluesFound,3); assert.ok(result.metrics.uniqueTiles<=state.steps+1);
    assert.ok(Object.values(result.metrics).every(v=>['number','boolean','string'].includes(typeof v)));
    assert.ok(Object.keys(result.metrics).length<=30);
    assert.equal(canFinish({...state,completed:true}),false);
    assert.equal(resultFor({...state,completed:true},100,'touch'),null);
  }
});
test('optional stories are optional, idempotent, and do not unlock the gate',()=>{
  let s=initialState();
  for(const target of OPTIONAL) { s=inspectItem(go(s,target)).state; assert.equal(inspectItem(s).item,null); }
  assert.equal(s.explored.length,2); assert.equal(s.collected.length,0); assert.equal(canFinish(go(s,EXIT)),false);
});
test('route hint always leads to a remaining clue and eventually the garden',()=>{
  let s=initialState();
  for(let i=0;i<3;i++) { const goal=nextGoal(s); assert.ok(!s.collected.includes(goal.id)); s=inspectItem(go(s,goal)).state; }
  assert.equal(nextGoal(s).id,'exit'); assert.ok(canFinish(go(s,nextGoal(s))));
});
test('active clock excludes pause/blur/story time and tolerates repeated starts/stops',()=>{
  let now=0; const clock=createActiveClock(()=>now);
  now=5000; assert.equal(clock.seconds(),0); clock.start(); clock.start(); now=6500; assert.equal(clock.seconds(),1.5);
  clock.stop(); clock.stop(); now=25000; assert.equal(clock.seconds(),1.5);
  clock.start(); now=28000; clock.stop(); assert.equal(clock.seconds(),4.5);
  clock.reset(); assert.equal(clock.seconds(),0);
});
test('haunted UI readability regression covers CSS variables, local styles and media queries',()=>{
  const sources=['src/styles.css','src/minigames/haunted/haunted.css','src/minigames/haunted/Game.jsx'].map(path=>({path,content:fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8')}));
  const report=auditSources(sources); assert.deepEqual(report.issues,[]);
  assert.ok(report.stats.mediaQueries>=2);
});
test('audio is opt-in and pause/close clean all ambient loops and active voices',async()=>{
  const oldWindow=globalThis.window, oldSet=globalThis.setInterval, oldClear=globalThis.clearInterval;
  let intervals=0, stops=0, closes=0, resumes=0, suspends=0;
  const voices=[];
  class Context {
    state='suspended'; currentTime=0; destination={};
    async resume(){this.state='running';resumes++;}
    async suspend(){this.state='suspended';suspends++;}
    async close(){this.state='closed';closes++;}
    createOscillator(){const oscillator={frequency:{},connect(){},disconnect(){},start(){},stop(){stops++;}};voices.push(oscillator);return oscillator;}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  try {
    globalThis.window={AudioContext:Context};globalThis.setInterval=()=>{intervals++;return 1;};globalThis.clearInterval=id=>{if(id)intervals--;};
    const audio=createHouseAudio();audio.step();audio.play();assert.equal(intervals,0);assert.equal(resumes,0);
    assert.equal(await audio.enable(),true);audio.play();audio.play();assert.equal(intervals,1);
    audio.step();audio.discover();assert.equal(voices.length,3);
    audio.pause();assert.equal(intervals,0);assert.ok(stops>=3);assert.equal(suspends,1);
    audio.play();assert.equal(intervals,1);audio.close();assert.equal(intervals,0);assert.equal(closes,1);
  } finally {globalThis.window=oldWindow;globalThis.setInterval=oldSet;globalThis.clearInterval=oldClear;}
});
test('primary UI text colors retain sufficient contrast',()=>{
  const luminance=hex=>{const c=hex.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
  for(const [a,b] of [['34433c','fbf8f1'],['fff8e7','385a4c'],['edf0d8','11262e'],['52604e','fbf8f1']]) {const x=luminance(a),y=luminance(b);assert.ok((Math.max(x,y)+.05)/(Math.min(x,y)+.05)>=4.5);}
});
