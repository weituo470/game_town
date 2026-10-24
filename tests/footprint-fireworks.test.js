import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FOOTPRINT_EVENTS, FOOTPRINT_SHOW, FOOTPRINT_FINALE, sampleFootprintPoint, sampleFootprintCamera, footprintWorldPoint, sampleFootprintParticle } from '../shared/footprintFireworksScore.js';
import { createFootprintRuntime, createFootprintBuffers, createFootprintFireworkVisual } from '../src/components/drone/footprintFireworks.js';
import { DRONE_SAMPLE_PROGRAMS, FIREWORK_SAMPLE_PROGRAMS, createDroneSampleRuntime } from '../shared/droneSamplePrograms.js';
import { isAiDroneRuntime } from '../shared/dronePrograms.js';

test('29 alternating footsteps arrive in order before the independent finale', () => {
  assert.equal(FOOTPRINT_EVENTS.length,29); assert.equal(FOOTPRINT_SHOW.duration,104000);
  FOOTPRINT_EVENTS.forEach((e,i) => { assert.equal(e.side,i%2?'right':'left'); assert(Math.abs(e.at-(10+i*2.1))<1e-9); assert(e.center.every(Number.isFinite)); });
  assert(FOOTPRINT_EVENTS.at(-1).at+6.5<FOOTPRINT_FINALE[0].at);
  assert.equal(DRONE_SAMPLE_PROGRAMS.length,3); assert.equal(FIREWORK_SAMPLE_PROGRAMS[0].id,'footsteps-of-light');
});
test('the sole is a hollow mirrored perimeter, not an interior point fill', () => {
  const points=Array.from({length:1024},(_,i)=>sampleFootprintPoint(i,'left',1024));
  points.forEach((p,i)=>{ assert.deepEqual(sampleFootprintPoint(i,'right',1024),[-p[0],p[1],p[2]]);assert(p.every(Number.isFinite));assert(Math.hypot(p[0]+1,p[1]+4)>4); });
  assert(Math.max(...points.map(p=>p[1]))>22);assert(Math.min(...points.map(p=>p[1]))< -20);
});
test('every footprint lies horizontally in world XZ with a large empty center', () => {
  for(const event of FOOTPRINT_EVENTS) {
    const points=Array.from({length:64},(_,i)=>footprintWorldPoint(event,i));
    assert(points.every(p=>p[1]===event.center[1]));
    assert(Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]))>50);
    assert(Math.max(...points.map(p=>p[2]))-Math.min(...points.map(p=>p[2]))>20);
  }
});
test('the same particles meet at the apex continuously and then fall with smooth local bursts', () => {
  for(const event of FOOTPRINT_EVENTS)for(let i=0;i<64;i++) {
    const p=footprintWorldPoint(event,i),v=[2.3,1.1,-1.7];
    const before=sampleFootprintParticle(p,v,-1e-6),apex=sampleFootprintParticle(p,v,0),after=sampleFootprintParticle(p,v,1e-6);
    assert.deepEqual(apex,p);assert(Math.hypot(...before.map((x,k)=>x-apex[k]))<.00001);assert(Math.hypot(...after.map((x,k)=>x-apex[k]))<.00001);
    assert(sampleFootprintParticle(p,v,4)[1]<apex[1]-10);
  }
});
test('a cached local runtime hides the entire drone fleet instead of disguising it as fireworks', () => {
  const r=createDroneSampleRuntime('footsteps-of-light'); assert.equal(createDroneSampleRuntime('footsteps-of-light'),r); assert(isAiDroneRuntime(r)); assert.equal(r.program.soundtrackDurationMs,r.program.duration);
  const f={positions:new Float32Array(300),bases:new Float32Array(300).fill(1),colors:new Float32Array(300).fill(1),sizes:new Float32Array(100).fill(1)};
  for(const t of [NaN,-50,0,10500,70000,95000,104000,Infinity]) { r.update(f,t); assert(f.sizes.every(v=>v===0));assert(f.colors.every(v=>v===0));assert.deepEqual(f.positions,f.bases);assert(Number.isFinite(f.state.elapsed)); }
  const a=r.sample(32500);r.sample(99000);assert.deepEqual(r.sample(32500),a);
  const c=r.program.chapters;assert.equal(c[0].start,0);c.slice(1).forEach((item,i)=>assert.equal(item.start,c[i].end));assert.equal(c.at(-1).end,r.program.duration);
  assert(Object.isFrozen(createFootprintRuntime()));
});
test('preallocated ballistic sparks are finite, bounded, deterministic and quality tiered', () => {
  const a=createFootprintBuffers(),b=createFootprintBuffers(),low=createFootprintBuffers(2048);
  assert(a.size.length<55000);assert(low.size.length<a.size.length*.6);assert(a.rocketSize.length<1600);
  for(const key of Object.keys(a)) {assert(a[key].every(Number.isFinite));assert.deepEqual(a[key],b[key]);}
  for(let i=0;i<a.timing.length;i+=3)assert(a.timing[i]>=5&&a.timing[i]+a.timing[i+1]<104);
});
test('two draw calls, absolute seek, reduced motion, double disposal and no drone lines', () => {
  const v=createFootprintFireworkVisual();assert.equal(v.stats.drawCalls,2);assert.equal(v.group.children.length,2);assert(v.group.children.every(p=>p.isPoints));
  assert(v.update(32000));const objects=v.group.children.map(p=>p.geometry);v.update(85000);v.update(32000);assert.deepEqual(v.group.children.map(p=>p.geometry),objects);
  assert.equal(v.update(32000,true),false);assert.equal(v.update(104000),false);v.dispose();v.dispose();assert.equal(v.update(32000),false);
});
test('camera remains finite at chapter boundaries and preserves mobile framing', () => {
  for(let t=0;t<=104000;t+=500)for(const a of [.25,390/844,16/9,4,NaN])for(const reduced of [false,true]) {const c=sampleFootprintCamera(t,a,reduced);assert([...c.position,...c.target,c.far].every(Number.isFinite));assert(c.far>800);}
  for(const t of [10000,26800,52000,72000,75000,95000]) {const a=sampleFootprintCamera(t-.1),b=sampleFootprintCamera(t+.1);assert(Math.hypot(...a.position.map((v,i)=>v-b.position[i]))<.1);}
});
test('CC0 recorded shell break, attribution and repeatable synchronized mix are shipped', () => {
  const audio=new URL('../public/audio/footsteps-of-light.mp3',import.meta.url);assert(fs.statSync(audio).size>1000000);assert(fs.statSync(audio).size<3000000);
  const script=fs.readFileSync(new URL('../scripts/create-footprint-soundscape.py',import.meta.url),'utf8');assert(script.includes('default_rng(20080808)'));assert(!/requests\.|urlopen/.test(script));assert(script.includes('at+.065-peak_time'));assert(fs.existsSync(new URL('../public/audio/sources/firework-336008-cc0.mp3',import.meta.url)));const license=fs.readFileSync(new URL('../public/licenses/footprint-fireworks-audio.txt',import.meta.url),'utf8');assert(license.includes('CC0 1.0')&&license.includes('Rudmer_Rotteveel'));
});
test('compact sparks keep a sampleable bright core and the fixed cinema fills resized viewports', () => {
  const js=fs.readFileSync(new URL('../src/components/drone/footprintFireworks.js',import.meta.url),'utf8');
  assert(js.includes('perspective),3.2,9.'));assert(js.includes('smoothstep(.08,.76,r)'));
  const css=fs.readFileSync(new URL('../src/components/drone/drone-integration.css',import.meta.url),'utf8');
  assert.match(css,/\.town-shell\.is-drone \{[^}]*inset: 0;[^}]*height: auto;/);
});
test('a single extended sea surface covers the western cinematic path without more triangles', () => {
  for(const event of FOOTPRINT_EVENTS)assert(Math.abs(event.center[0])+250<1500);
  const js=fs.readFileSync(new URL('../src/components/town/TownWater.jsx',import.meta.url),'utf8');
  assert(js.includes('<planeGeometry args={[3000,3000]}/>'));assert(!js.includes('segments={'));
});
