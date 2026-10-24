import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BUND_THEMES, sampleShanghaiBundPoint } from '../src/components/drone/shanghaiBundPoints.js';
import { LOCAL_MUSIC_PROGRAMMES, getLocalMusicProgramme } from '../src/lib/localMusicCatalogue.js';
import { createRehearsalPlan, MUSIC_THEMES } from '../shared/musicRehearsal.js';
import { createMusicRehearsalRuntime } from '../src/components/drone/musicRehearsalRuntime.js';
import { createDroneFleet } from '../shared/droneShow.js';
test('local music catalogue preserves both programmes, no arbitrary URLs or recording payloads',()=>{
 assert.deepEqual(LOCAL_MUSIC_PROGRAMMES.map(e=>e.id),['ordinary-road','shanghai-bund']);
 for(const id of ['../secret','constructor','https://other.test'])assert.equal(getLocalMusicProgramme(id),null);
 assert.equal(getLocalMusicProgramme('shanghai-bund').title,'上海滩');
 assert(!JSON.stringify(LOCAL_MUSIC_PROGRAMMES).includes('data:audio'));
});
test('Bund scenes extend the music-only schema, not the original eight-scene draft or public AI protocol',()=>{
 for(const theme of BUND_THEMES){assert(Object.hasOwn(MUSIC_THEMES,theme));const p=createRehearsalPlan({durationMs:32000,lyrics:[{startMs:8000,endMs:24000,text:'原创江岸测试',theme}]});assert.equal(p.cues[0].theme,theme);}
 assert.equal(createRehearsalPlan({durationMs:32000}).cues.length,8);
});
test('all six original Bund formations are finite, bounded, deterministic and reduced-motion safe',()=>{
 for(const theme of BUND_THEMES){
  const a=new Float64Array(6),b=new Float64Array(6);
  for(let id=0;id<4096;id+=11){assert.equal(sampleShanghaiBundPoint(theme,id,44,false,a),true);assert(a.every(Number.isFinite));assert(Math.abs(a[0])<=88);assert(a[1]>=28&&a[1]<=108);sampleShanghaiBundPoint(theme,id,44,false,b);assert.deepEqual(a,b);sampleShanghaiBundPoint(theme,id,1,true,a);sampleShanghaiBundPoint(theme,id,99,true,b);assert.deepEqual(a,b);}
 }
 assert.equal(sampleShanghaiBundPoint('unknown',0,0,false,new Float64Array(6)),false);
});
test('the river has moving crests and the skyline, couple and harbor are different compositions',()=>{
 const samples=BUND_THEMES.map(theme=>{const p=new Float64Array(6);sampleShanghaiBundPoint(theme,1501,10,false,p);return [...p];});
 assert(new Set(samples.map(p=>p.join(','))).size>=5);
 const a=new Float64Array(6),b=new Float64Array(6);sampleShanghaiBundPoint('bund-tide',50,1,false,a);sampleShanghaiBundPoint('bund-tide',50,10,false,b);assert.notDeepEqual(a,b);
});
test('new music choreography retains identities, backwards seeking, shared buffers and full return',()=>{
 const lyrics=BUND_THEMES.map((theme,i)=>({startMs:8000+i*3000,endMs:11000+i*3000,text:'原创江岸测试',theme}));
 const p=createRehearsalPlan({durationMs:40000,lyrics});const runtime=createMusicRehearsalRuntime(p);
 for(const count of [2048,4096]){const f=createDroneFleet(count),ids=f.identities.slice(),buffer=f.positions;for(const t of [0,8000,12000,18000,24000,35000,40000]){runtime.update(f,t);assert(f.positions.every(Number.isFinite));assert.equal(f.positions,buffer);assert.deepEqual(f.identities,ids);}assert.deepEqual(f.positions,f.bases);runtime.update(f,15000);const saved=f.positions.slice();runtime.update(f,25000);runtime.update(f,15000);assert.deepEqual(f.positions,saved);}
});
test('new scenery is sampled points only, without foreign models, line renderers or movie textures',()=>{
 const source=fs.readFileSync(new URL('../src/components/drone/shanghaiBundPoints.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/new THREE|LineSegments|CanvasTexture|\.glb|\.mp4|fetch\(/);
});
