import test from 'node:test';
import assert from 'node:assert/strict';
import { DRONE_SAMPLE_PROGRAMS, createDroneSampleRuntime } from '../shared/droneSamplePrograms.js';
import { createDroneShortCamera } from '../shared/droneSampleCamera.js';
import { createDroneFleet } from '../shared/droneShow.js';
import { createDroneFireworkBuffers, sampleFireworkParticle } from '../shared/droneFireworks.js';

const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const normalized = a => { const n = Math.hypot(...a); return a.map(v => v / n); };
const dot = (a, b) => a.reduce((v, x, i) => v + x * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function projection(point, pose, aspect) {
  const forward = normalized(pose.target.map((v, i) => v - pose.position[i]));
  const right = normalized(cross(forward, [0,1,0])), up = cross(right, forward);
  const v = point.map((n, i) => n - pose.position[i]), depth = dot(v, forward);
  const half = depth * Math.tan(pose.fov * Math.PI / 360);
  return [dot(v, right) / half / aspect, dot(v, up) / half, depth];
}
test('short-film rails are absolute-time, finite, continuous and stationary in reduced motion', () => {
  for (const show of DRONE_SAMPLE_PROGRAMS) {
    const runtime = createDroneSampleRuntime(show.id);
    for (const aspect of [16/9,1,390/844,.25,4]) {
      let prior = runtime.camera(0, aspect);
      for (let t=100;t<=show.duration;t+=100) {
        const pose = runtime.camera(t, aspect);
        assert.deepEqual(pose, runtime.camera(t, aspect));
        assert.ok([...pose.position,...pose.target,pose.fov,pose.near,pose.far].every(Number.isFinite));
        assert.ok(pose.position[1] > 10 && pose.position[2] > 80);
        assert.ok(distance(pose.position,prior.position) < 14, `camera jump ${show.id}/${t}/${aspect}`);
        assert.ok(distance(pose.target,prior.target) < 4);
        prior=pose;
      }
      const reduced=runtime.camera(0,aspect,true);
      for(const t of [12000,show.duration/2,show.duration-12000,show.duration]) assert.deepEqual(runtime.camera(t,aspect,true),reduced);
      for(const chapter of runtime.program.chapters) {
        assert.ok(distance(runtime.camera(chapter.start-.001,aspect).position,runtime.camera(chapter.start,aspect).position)<.01);
      }
    }
    assert.deepEqual(runtime.camera(NaN), runtime.camera(0));
    assert.deepEqual(runtime.camera(-1),runtime.camera(0));
    assert.deepEqual(runtime.camera(show.duration+1),runtime.camera(show.duration));
  }
});
test('hero silhouettes occupy a meaningful screen area and stay inside desktop and portrait cameras', () => {
  for(const show of DRONE_SAMPLE_PROGRAMS) {
    const runtime=createDroneSampleRuntime(show.id), fleet=createDroneFleet(2048);
    for(const time of [runtime.program.heroTime,runtime.program.highlightTime]) {
      runtime.update(fleet,time);
      for(const aspect of [16/9,2560/1215,390/844]) {
        const pose=runtime.camera(time,aspect), projected=[];
        for(let i=0;i<fleet.count;i++) if(fleet.sizes[i]>.02) projected.push(projection(Array.from(fleet.positions.subarray(i*3,i*3+3)),pose,aspect));
        assert.ok(projected.length>500,'a substantial lit fleet, not a sparse icon');
        let inside=0,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
        for(const [x,y,z] of projected) {
          if(Math.abs(x)<.98&&Math.abs(y)<.98&&z>pose.near&&z<pose.far) inside++;
          minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        }
        assert.ok(inside/projected.length>.99, `cropped fleet ${show.id}/${time}/${aspect}: ${inside/projected.length}`);
        if(aspect>1 && time===runtime.program.heroTime) assert.ok(minY>-.69,`hero behind playback controls ${show.id}: ${minY}`);
        // Compare the same 16:9 field on ultrawide displays, not unused side gutters.
        if(aspect>1) assert.ok(Math.max((maxX-minX)*aspect/(16/9),maxY-minY)>.82,`hero too small ${show.id}/${time}`);
      }
    }
  }
});
test('gravity stunt uses one locked shot and unknown programme identifiers are rejected', () => {
  const gate=createDroneSampleRuntime('gravity-gate');
  for(const t of [50000,55000,60000]) assert.deepEqual(gate.camera(t),gate.camera(50000));
  assert.throws(()=>createDroneShortCamera(null),TypeError);
  assert.throws(()=>createDroneShortCamera({sampleId:'network-script',duration:100000}),TypeError);
});

test('the whale-family camera keeps every story beat and the outer fireworks in frame on desktop and 390px portrait', () => {
  const runtime = createDroneSampleRuntime('tidal-whale'), fleet = createDroneFleet(2048), fireworks = createDroneFireworkBuffers('tidal-whale', 2048);
  for (const aspect of [16/9, 2560/1215, 390/844]) {
    for (let time = 8000; time <= 108000; time += 1000) {
      runtime.update(fleet, time); const pose = runtime.camera(time, aspect);
      let inside = 0;
      for (let index = 0; index < fleet.count; index++) {
        const point = Array.from(fleet.positions.subarray(index * 3, index * 3 + 3)), [x, y, depth] = projection(point, pose, aspect);
        if (Math.abs(x) < .98 && Math.abs(y) < .98 && depth > 80 && depth < pose.far) inside++;
      }
      assert.ok(inside / fleet.count > .995, `whale family crop/flythrough at ${time}/${aspect}: ${inside / fleet.count}`);
      for (let index = 0; index < fireworks.count; index += 9) {
        const point = sampleFireworkParticle(fireworks, index, time);
        if (point[3] < .07) continue;
        const [x, y, depth] = projection(Array.from(point.slice(0, 3)), pose, aspect);
        assert.ok(Math.abs(x) < .98 && Math.abs(y) < .98 && depth > 80, `firework framing ${time}/${aspect}`);
      }
    }
  }
});

test('parent/calf and family hero shots reserve the lower 270px for the real 720px playback HUD', () => {
  const runtime = createDroneSampleRuntime('tidal-whale'), fleet = createDroneFleet(4096), aspect = 16 / 9;
  for (const time of [46000, 78000, 90000]) {
    runtime.update(fleet, time); const pose = runtime.camera(time, aspect);
    for (let index = 0; index < fleet.count; index++) {
      // During the parent/calf scene, the remaining identities are deliberately
      // dim water, not a character. The two formed whales must clear the HUD.
      if (time === 46000 && (fleet.identities[index] * 1597) % 4096 >= 2688) continue;
      const [, y] = projection(Array.from(fleet.positions.subarray(index * 3, index * 3 + 3)), pose, aspect);
      const pixelY = (1 - y) * 360;
      assert.ok(pixelY < 450, `whale behind real playback HUD at ${time}: y=${pixelY}`);
    }
  }
});
