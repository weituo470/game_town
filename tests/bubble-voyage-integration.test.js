import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { sphereCameraShot } from '../src/components/sphere/sphereCamera.js';
import { createSphereLandmark } from '../src/components/sphere/createSphereLandmark.js';
import { createSphereBubbles } from '../src/components/sphere/createSphereBubbles.js';
import { sampleSphereBubble, sampleSphereBubbleCue } from '../src/components/sphere/sphereBubbleCycle.js';
import { SPHERE_LANDMARK } from '../shared/sphere-landmark.js';
const source = path => fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('the whole facade plus bubble atmosphere stays within the original 15-call / 30000-triangle envelope', () => {
  const wall = createSphereLandmark(), bubbles = createSphereBubbles();
  assert.ok(wall.statistics.drawCalls + bubbles.statistics.drawCalls <= 15);
  assert.ok(wall.statistics.triangles + bubbles.statistics.triangles <= 30000);
  wall.dispose(); bubbles.dispose();
});

test('every visible bubble and cloud remains in-frame at desktop and 390px widths', () => {
  for (const [width,height] of [[1280,720],[390,844]]) for (const orbit of [false,true]) {
    for (const t of [3,7,12,16,22,26]) {
      const shot=sphereCameraShot(width/height,t,orbit);
      const camera=new THREE.PerspectiveCamera(shot.fov,width/height,shot.near,shot.far);
      camera.position.set(...shot.position); camera.lookAt(...shot.target); camera.updateMatrixWorld();
      for(let i=0;i<8;i++) {
        const p=sampleSphereBubble(t*1000,i);
        if(!p.visible)continue;
        const radius=Math.max(p.radius,p.cloudScale*2.2);
        for(const [x,y] of [[0,radius],[0,-radius],[-radius,0],[radius,0]]) {
          const pixel=new THREE.Vector3(SPHERE_LANDMARK.x+p.x+x,p.y+y,SPHERE_LANDMARK.z+p.z).project(camera);
          assert.ok(Math.abs(pixel.x)<.96);
          const screenY=(1-pixel.y)/2;
          assert.ok(screenY>.13&&screenY<(width<600?.56:.77),`cloud clear of HUD ${width} ${t}: ${screenY}`);
        }
      }
    }
  }
});

test('face anticipation, pursed lips and upward gaze receive the same absolute bubble cue', () => {
  const wall=createSphereLandmark(), uniforms=wall.group.getObjectByName('sphere-led-wall').material.uniforms;
  for(const time of [1000,5000,15000,24000]) {
    const cue=sampleSphereBubbleCue(time);wall.update(time,{mode:'smile',bubbleExpression:cue});
    assert.equal(uniforms.uBlow.value,cue.blow);assert.equal(uniforms.uPuff.value,cue.cheek);assert.equal(uniforms.uLookUp.value,cue.lookUp);
  }
  const wrapper=source('src/components/town/SphereLandmark.jsx');
  assert.match(wrapper,/bubbleClock\.current\.cue !== bubbleCue/);
  assert.match(wrapper,/faceOpacity > \.01 && !bubbleClock\.current\.visible/);
  assert.match(wrapper,/atmosphere\.dispose\(\)/);
  assert.match(wrapper,/opacity: faceOpacity/);
  wall.dispose();
});

test('dock keyboard and touch affordance share the one-click voyage callback and respect modal focus', () => {
  const app=source('src/App.jsx'), player=source('src/components/town/PlayerController.jsx');
  assert.match(app,/nearOffshoreDock && event\.key\.toLowerCase\(\) === 'e'/);
  assert.match(app,/onOffshoreTour=\{startOffshoreCruise\}/);
  assert.match(app,/offshore\.boardAndDepart\(\)/);
  assert.match(player,/nearDock !== nearOffshoreDock\.current/);
  assert.match(player,/current\.y < 1\.5/);
  assert.match(player,/onNearestOffshoreDock\?\.\(nearDock\)/);
});
