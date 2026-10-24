import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSphereFace, SPHERE_FACE_CYCLE_MS, SPHERE_FACE_BEATS } from '../src/components/sphere/sphereFacePerformance.js';
import { sampleSphereBubbleCue } from '../src/components/sphere/sphereBubbleCycle.js';
import { createSphereLandmark, SPHERE_RENDER_BUDGET } from '../src/components/sphere/createSphereLandmark.js';
import { sphereWallFragmentShader } from '../src/components/sphere/sphereWallShaders.js';

test('eight named story beats fit the existing 28s bubble narrative', () => {
  assert.equal(SPHERE_FACE_CYCLE_MS, 28000);
  assert.equal(SPHERE_FACE_BEATS.length, 8);
  assert.equal(new Set(SPHERE_FACE_BEATS.map(x => x.id)).size, 8);
  for (const beat of SPHERE_FACE_BEATS) {
    const cue = sampleSphereBubbleCue(beat.atMs);
    assert.equal(sampleSphereFace(beat.atMs, { bubbleExpression: cue }).phase, beat.id);
  }
});

test('smile, round blow, wonder, wink, smirk, laugh and yawn have distinct geometry', () => {
  const pose = ms => sampleSphereFace(ms, { bubbleExpression: sampleSphereBubbleCue(ms) });
  const neutral = pose(0), blowing = pose(5200), wonder = pose(11800), wink = pose(17200), smirk = pose(18500), laugh = pose(20600), yawn = pose(24200);
  assert.ok(neutral.smile > .6 && neutral.mouthWidth > neutral.mouthHeight * 5);
  assert.ok(blowing.roundness > .98 && Math.abs(blowing.mouthHeight - blowing.mouthWidth) < .01);
  assert.ok(wonder.gazeY > .08 && wonder.mouthHeight > .1);
  assert.ok(wink.leftOpen < .2 && wink.rightOpen > .9);
  assert.ok(smirk.leftBrowLift > smirk.rightBrowLift + .03);
  assert.ok(laugh.laugh > .95 && laugh.mouthWidth > .2 && laugh.leftOpen < .3);
  assert.ok(yawn.sleepy > .95 && yawn.mouthHeight > .18 && yawn.mouthHeight > yawn.mouthWidth * 1.8);
});

test('arbitrary seeks and whole cycles remain deterministic and invalid time is safe', () => {
  for (const ms of [0, 950, 5200, 11800, 17200, 20600, 24200, 27999]) {
    assert.deepEqual(sampleSphereFace(ms), sampleSphereFace(ms + SPHERE_FACE_CYCLE_MS * 100));
    assert.deepEqual(sampleSphereFace(ms), sampleSphereFace(ms));
  }
  assert.deepEqual(sampleSphereFace(NaN), sampleSphereFace(0));
  assert.deepEqual(sampleSphereFace(Infinity), sampleSphereFace(0));
  assert.deepEqual(sampleSphereFace(-20), sampleSphereFace(0));
});

test('the resettable bubble clock controls acting even when the global clock is different', () => {
  for (const t of [0, 6200, 11800, 17200, 20600, 24200]) {
    const cue = sampleSphereBubbleCue(t);
    assert.deepEqual(sampleSphereFace(900000, { bubbleExpression: cue }), sampleSphereFace(t, { bubbleExpression: cue }));
  }
  assert.equal(sampleSphereFace(24200, { bubbleExpression: sampleSphereBubbleCue(0) }).phase, 'welcome');
});

test('all numeric parameters are finite and remain bounded throughout a complete performance', () => {
  const out = {};
  for (let t = 0; t <= 56000; t += 17) {
    const result = sampleSphereFace(t, { bubbleExpression: sampleSphereBubbleCue(t) }, out);
    assert.equal(result, out);
    for (const [key, n] of Object.entries(result)) if (key !== 'phase') assert.ok(Number.isFinite(n), key);
    for (const key of ['leftOpen', 'rightOpen', 'smile', 'roundness', 'laugh', 'blush', 'sleepy', 'cheeky']) assert.ok(result[key] >= 0 && result[key] <= 1, key);
    assert.ok(result.mouthWidth >= .07 && result.mouthWidth <= .26);
    assert.ok(result.mouthHeight >= .02 && result.mouthHeight <= .20);
  }
});

test('transitions have no step jumps, including the cycle seam', () => {
  const keys = ['leftOpen', 'rightOpen', 'gazeX', 'gazeY', 'leftBrowLift', 'rightBrowLift', 'mouthWidth', 'mouthHeight', 'smile', 'roundness', 'laugh', 'blush', 'sleepy'];
  let before = sampleSphereFace(0);
  for (let t = 1; t <= 28000; t++) {
    const after = sampleSphereFace(t);
    for (const key of keys) assert.ok(Math.abs(after[key] - before[key]) < .025, key + ' at ' + t);
    before = after;
  }
});

test('reduced motion is a friendly static face regardless of live or replay clock', () => {
  const baseline = sampleSphereFace(0, { reducedMotion: true });
  for (const t of [950, 6200, 17200, 20600, 24200, 999999]) {
    assert.deepEqual(sampleSphereFace(t, { reducedMotion: true, bubbleExpression: sampleSphereBubbleCue(t) }), baseline);
  }
  assert.equal(baseline.leftOpen, 1); assert.equal(baseline.rightOpen, 1);
  assert.ok(baseline.smile > .6 && baseline.mouthHeight < .03);
});

test('four reused GPU vectors carry sampled acting without meshes, textures or extra draws', () => {
  const model = createSphereLandmark();
  const uniforms = model.group.getObjectByName('sphere-led-wall').material.uniforms;
  const refs = ['uFaceEyes', 'uFaceBrows', 'uFaceMouth', 'uFaceMood'].map(key => uniforms[key].value);
  assert.ok(refs.every(x => x.isVector4));
  for (const beat of SPHERE_FACE_BEATS) {
    const bubbleExpression = sampleSphereBubbleCue(beat.atMs);
    const pose = sampleSphereFace(beat.atMs, { bubbleExpression });
    model.update(999999, { mode: 'smile', bubbleExpression });
    assert.deepEqual(uniforms.uFaceEyes.value.toArray(), [pose.leftOpen, pose.rightOpen, pose.gazeX, pose.gazeY]);
    assert.deepEqual(uniforms.uFaceMouth.value.toArray(), [pose.mouthWidth, pose.mouthHeight, pose.smile, pose.roundness]);
    assert.ok(model.statistics.drawCalls <= SPHERE_RENDER_BUDGET.drawCalls);
    assert.ok(model.statistics.triangles <= SPHERE_RENDER_BUDGET.triangles);
  }
  assert.deepEqual(['uFaceEyes', 'uFaceBrows', 'uFaceMouth', 'uFaceMood'].map(key => uniforms[key].value), refs);
  assert.match(sphereWallFragmentShader, /thinSmile/);
  assert.match(sphereWallFragmentShader, /closedEye/);
  assert.match(sphereWallFragmentShader, /teeth/);
  assert.doesNotMatch(sphereWallFragmentShader, /sampler2D|samplerCube/);
  model.dispose();
});

