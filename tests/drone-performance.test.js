import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFrameBudget, sampleFrameBudget, sceneRenderProfile, createFleetUpdateGate, getSceneRenderRatio, setSceneRenderRatio } from '../src/components/drone/dronePerformance.js';

function frames(state, fps, seconds) {
  const samples = [];
  for (let frame = 0; frame < fps * seconds; frame++) {
    const result = sampleFrameBudget(state, 1 / fps);
    if (result) samples.push(result);
  }
  return samples;
}

test('the show keeps HDR bloom and all identities, but avoids AO and half the MSAA samples', () => {
  const town = sceneRenderProfile({ pixelRatio: 2 });
  const show = sceneRenderProfile({ mode: 'drone', pixelRatio: 2 });
  assert.deepEqual(town, { pixelRatio: 1.5, samples: 4, ao: true, bloom: true, quality: 'high' });
  assert.deepEqual(show, { pixelRatio: 1.25, samples: 2, ao: false, bloom: true, quality: 'drone-cinematic' });
  assert.ok(show.pixelRatio ** 2 * show.samples / (town.pixelRatio ** 2 * town.samples) < .35, 'HDR multisample storage is under 35% of the original desktop budget');
  assert.equal(sceneRenderProfile({ width: 390, pixelRatio: 2 }).ao, false, 'normal mobile town policy is unchanged');
  assert.equal(sceneRenderProfile({ stage: 1, pixelRatio: 2 }).pixelRatio, 1.25);
});

test('persistent slow frames adapt only the offscreen render buffer, without toggling quality back and forth', () => {
  const state = createFrameBudget('drone');
  const initial = frames(state, 30, 5);
  assert.equal(state.stage, 0, 'warmup and one slow window are insufficient');
  assert.ok(initial.length <= 1);
  const samples = frames(state, 30, 10);
  assert.equal(state.stage, 2);
  assert.equal(samples.filter(sample => sample.changed).length, 2);
  const low = sceneRenderProfile({ mode: 'drone', stage: state.stage, pixelRatio: 2 });
  assert.ok(Math.abs(low.pixelRatio - .9) < 1e-12); assert.equal(low.bloom, true); assert.equal(low.ao, false);
  frames(state, 120, 30);
  assert.equal(state.stage, 2, 'hold the stable tier until the show session ends');
});

test('every drone quality step reduces actual render resolution on DPR 1 and high-DPR displays', () => {
  for (const [pixelRatio, expected] of [[1, [1, .85, .72]], [1.5, [1.25, 1.0625, .9]]]) {
    const actual = [0, 1, 2].map(stage => sceneRenderProfile({ mode: 'drone', pixelRatio, stage }).pixelRatio);
    actual.forEach((ratio, index) => assert.ok(Math.abs(ratio - expected[index]) < 1e-12));
    assert.ok(actual[0] > actual[1] && actual[1] > actual[2]);
    assert.ok(actual[2] >= .65);
  }
  const nearFloor = [0, 1, 2].map(stage => sceneRenderProfile({ mode: 'drone', pixelRatio: .7, stage }).pixelRatio);
  assert.ok(nearFloor[0] > nearFloor[1] && nearFloor[1] > nearFloor[2]);
  assert.equal(nearFloor[2], .65);
  assert.equal(sceneRenderProfile({ mode: 'town', pixelRatio: 1, stage: 1 }).pixelRatio, 1, 'normal town policy remains unchanged');
});

test('hidden tabs and long demand-mode pauses cannot trigger a quality downgrade', () => {
  const state = createFrameBudget('drone');
  for (let i = 0; i < 1000; i++) {
    assert.equal(sampleFrameBudget(state, 1 / 10, true), null);
    assert.equal(sampleFrameBudget(state, 20), null);
    assert.equal(sampleFrameBudget(state, NaN), null);
  }
  assert.equal(state.warmup, 0); assert.equal(state.stage, 0);
  frames(state, 60, 30);
  assert.equal(state.stage, 0);
});

test('the original town still uses its original six-second warmup and 28 FPS AO fallback', () => {
  const state = createFrameBudget('town');
  frames(state, 30, 20); assert.equal(state.stage, 0);
  frames(state, 20, 6); assert.equal(state.stage, 1);
  frames(state, 10, 20); assert.equal(state.stage, 1, 'town never receives the extra drone-only resolution tier');
});

test('paused fleet sampling is cached, while every seat, motion preference and seek change invalidates it', () => {
  const needs = createFleetUpdateGate();
  assert.equal(needs(82000, false, 'right-star'), true);
  for (let frame = 0; frame < 600; frame++) assert.equal(needs(82000, false, 'right-star'), false);
  assert.equal(needs(82000, false, 'left-star'), true, 'restore the old owned emitter and hide the new one');
  assert.equal(needs(82000, false, null), true, 'restore the owned emitter in director mode');
  assert.equal(needs(82000, true, null), true);
  assert.equal(needs(0, true, null), true, 'restart is not confused with a cached past sample');
  assert.equal(needs(82000, true, null), true);
  assert.equal(needs(82016, true, null), true);
});

test('drone sprite projection uses actual effect-buffer DPR and restores native DPR on teardown', () => {
  const gl = { getPixelRatio: () => 1.5 };
  assert.equal(getSceneRenderRatio(gl), 1.5);
  setSceneRenderRatio(gl, .85); assert.equal(getSceneRenderRatio(gl), .85);
  setSceneRenderRatio(gl, NaN); assert.equal(getSceneRenderRatio(gl), .85);
  setSceneRenderRatio(gl, null); assert.equal(getSceneRenderRatio(gl), 1.5);
});

test('the actual renderer wires cache, seek-safe trails, FPV seats, telemetry and mode-scoped effects', () => {
  const drone = fs.readFileSync(new URL('../src/components/drone/DroneShow.jsx', import.meta.url), 'utf8');
  const effects = fs.readFileSync(new URL('../src/components/town/SceneEffects.jsx', import.meta.url), 'utf8');
  assert.match(drone, /if \(!needsFleetUpdate\(safeTime, reducedMotion, firstPersonSeatId, aiRuntime\?\.layoutRevision \?\? 0\)\)\s*\{\s*trails.visible = false;\s*return false;/);
  assert.match(drone, /getSceneRenderRatio\(state\.gl\)/);
  assert.match(drone, /elapsed > 0 && elapsed < 220/);
  assert.match(drone, /if \(hiddenIndex>=0\) fleet.sizes\[hiddenIndex\]=0/);
  assert.match(drone, /dataset\.droneCpuMs/);
  assert.match(effects, /performanceMode === 'drone' \? null : new HalfResolutionAO/);
  assert.match(effects, /gl.shadowMap.autoUpdate = previousAutoUpdate/);
  assert.match(effects, /gl.info.autoReset = previousInfoAutoReset/);
  assert.match(effects, /dataset\.renderCalls/);
  assert.match(effects, /dataset\.renderTriangles/);
  assert.match(effects, /dataset\.effectsDpr/);
});
