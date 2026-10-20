import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformWithEsbuild } from 'vite';
import * as THREE from 'three';
import { sphereCameraShot } from '../src/components/sphere/sphereCamera.js';
import { SPHERE_LANDMARK, SPHERE_MODES } from '../shared/sphere-landmark.js';
const source = path => fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('sphere viewer fits the actual globe above controls on desktop and phone',()=>{
 for (const [width,height] of [[1280,720],[390,844],[320,740]]) {
  for (const orbit of [false,true]) for (const time of [0,7,20,40]) {
   const shot=sphereCameraShot(width/height,time,orbit);
   const camera=new THREE.PerspectiveCamera(shot.fov,width/height,shot.near,shot.far);
   camera.position.set(...shot.position);camera.lookAt(...shot.target);camera.updateMatrixWorld();
   for(let y=0;y<=16;y++)for(let a=0;a<32;a++){
    const phi=y/16*Math.acos((SPHERE_LANDMARK.baseY-SPHERE_LANDMARK.centerY)/SPHERE_LANDMARK.radius), angle=a/32*Math.PI*2;
    const point=new THREE.Vector3(SPHERE_LANDMARK.x+Math.sin(phi)*Math.cos(angle)*18,SPHERE_LANDMARK.centerY+Math.cos(phi)*18,SPHERE_LANDMARK.z+Math.sin(phi)*Math.sin(angle)*18).project(camera);
    assert.ok(Math.abs(point.x)<.95,`horizontal fit ${width}`);
    const pixelY=(1-point.y)/2*height;
    assert.ok(pixelY>105 && pixelY<height-(width<600?225:115),`HUD gap ${width} ${pixelY}`);
   }
  }
 }
});
test('sphere camera is finite and reduced motion fixes an orbiting shot',()=>{
 for(const aspect of [NaN,Infinity,0,-1,.1,1,3])for(const t of [NaN,Infinity,-100,0,1234]){
  const shot=sphereCameraShot(aspect,t,true,true);
  assert.ok([...shot.position,...shot.target,shot.fov].every(Number.isFinite));
 }
 assert.deepEqual(sphereCameraShot(.5,100,true,true),sphereCameraShot(.5,0,false));
 assert.notDeepEqual(sphereCameraShot(1.6,10,true),sphereCameraShot(1.6,0,true));
});

const cameraCode = (await transformWithEsbuild(source('src/components/sphere/SphereCamera.jsx'), 'SphereCamera.jsx', { loader: 'jsx', format: 'cjs' })).code;
function mountCamera(props = {}) {
 let frame;
 const module = { exports: {} };
 vm.runInNewContext(cameraCode, { module, exports: module.exports, require(id) {
  if (id === 'react') return { useRef: value => ({ current: value }) };
  if (id === '@react-three/fiber') return { useFrame: callback => { frame = callback; } };
  if (id === './sphereCamera.js') return { sphereCameraShot };
  throw new Error(`Unexpected camera dependency: ${id}`);
 } });
 module.exports.default(props);
 return frame;
}

test('mounted sphere camera stays continuous across the 180s town-clock wrap and ignores light-preview clock changes', () => {
 const townTime = { current: 179000 }, camera = new THREE.PerspectiveCamera(44, 16 / 9, .1, 420);
 const frame = mountCamera({ orbit: true, timeRef: townTime });
 frame({ camera, clock: { elapsedTime: 901.5 } });
 assert.deepEqual(camera.position.toArray(), sphereCameraShot(camera.aspect, 0, true).position);
 townTime.current = 179999;
 frame({ camera, clock: { elapsedTime: 902.499 } }); const before = camera.position.clone();
 townTime.current = 0;
 frame({ camera, clock: { elapsedTime: 902.5 } });
 assert.ok(camera.position.distanceTo(before) < .01, 'world clock wrap must not jump the camera');
 assert.deepEqual(camera.position.toArray(), sphereCameraShot(camera.aspect, 1, true).position);
 townTime.current = 90000;
 frame({ camera, clock: { elapsedTime: 902.501 } });
 assert.deepEqual(camera.position.toArray(), sphereCameraShot(camera.aspect, 902.501 - 901.5, true).position);
});

test('a new sphere camera mount starts at the face, and non-perspective frames do not consume its opening', () => {
 const frame = mountCamera({ orbit: true });
 frame({ camera: new THREE.OrthographicCamera(), clock: { elapsedTime: 50 } });
 const camera = new THREE.PerspectiveCamera(44, 1.5, .1, 420);
 frame({ camera, clock: { elapsedTime: 80 } });
 assert.deepEqual(camera.position.toArray(), sphereCameraShot(1.5, 0, true).position);
 frame({ camera, clock: { elapsedTime: 82 } });
 assert.notDeepEqual(camera.position.toArray(), sphereCameraShot(1.5, 0, true).position);
 mountCamera({ orbit: true })({ camera, clock: { elapsedTime: 1000 } });
 assert.deepEqual(camera.position.toArray(), sphereCameraShot(1.5, 0, true).position);
});
test('main map, atlas and external facade controls are wired without a second Canvas',()=>{
 const app=source('src/App.jsx'),town=source('src/components/Town.jsx'),atlas=source('src/components/TownAtlas.jsx'),hud=source('src/components/sphere/SphereControls.jsx');
 assert.match(app,/SphereControls = React\.lazy/);assert.match(app,/TownAtlas = React\.lazy/);
 assert.match(town,/SphereLandmark = lazy/);assert.match(town,/SphereCamera = lazy/);
 assert.match(town,/viewMode === 'sphere'/);assert.match(app,/active=\{!droneWatching && !sphereWatching/);
 assert.match(atlas,/SPHERE_BRIDGE/);assert.match(atlas,/onTravel\('sphere'\)/);
 assert.match(hud,/aria-pressed=\{mode === item.id\}/);assert.match(hud,/event.key === 'Escape'/);
 assert.doesNotMatch(hud,/<Canvas|createRoot|fetch\(/);
 assert.deepEqual(SPHERE_MODES.map(x=>x.id),['auto','smile','eye','earth','basketball']);
});
