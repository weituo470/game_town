import test from 'node:test';
import assert from 'node:assert/strict';
import { createDroneFireworkBuffersFromCues, sampleFireworkParticle } from '../shared/droneFireworks.js';
import { createAiDroneStageVisual } from '../src/components/drone/droneSpectacleVisual.js';
const programme = () => ({ end: 88, cues: [{ at: 70, origin: [-95, 120, -90], style: 'willow', color: [1, .6, .2], count: 240, life: 5, radius: 20, launch: 1.8 }, { at: 70.6, origin: [95, 120, -90], style: 'peony', color: [.2, .6, 1], count: 240, life: 4.4, radius: 20, launch: 1.8 }] });
test('generated stage cues share the existing bounded particle renderer and deterministic clock', () => {
  const program = programme(), high = createDroneFireworkBuffersFromCues(program), low = createDroneFireworkBuffersFromCues(program, 2048);
  assert.equal(high.count, 1440); assert.ok(low.count < high.count); assert.equal(high.rocketCount, 34);
  assert.deepEqual(high, createDroneFireworkBuffersFromCues(program));
  assert.ok(sampleFireworkParticle(high, 0, 71000)[3] > 0);
  assert.equal(sampleFireworkParticle(high, 0, 88000)[3], 0);
  const visual = createAiDroneStageVisual(program);
  assert.equal(visual.group.children.length, 2); assert.equal(visual.stats.drawCalls, 2);
  visual.update(71000); assert.equal(visual.group.visible, true);
  visual.update(71000, true); assert.equal(visual.group.visible, false);
  visual.dispose(); assert.equal(visual.group.children.length, 0);
});
test('stage cue renderer refuses unbounded coordinates, allocations and unsupported effects', () => {
  for (const patch of [{ count: 1e9 }, { count: 2.5 }, { radius: 31 }, { life: Infinity }, { launch: 0 }, { at: 90 }, { origin: [0, 4, 0] }, { origin: [0, 120, NaN] }, { color: [1, 2, 0] }, { style: 'script' }]) {
    const bad = programme(); Object.assign(bad.cues[0], patch);
    assert.throws(() => createDroneFireworkBuffersFromCues(bad), RangeError);
  }
  assert.throws(() => createDroneFireworkBuffersFromCues({ end: 90, cues: [] }), RangeError);
  const excess = programme(); excess.cues = Array.from({length: 12}, () => ({...excess.cues[0], count: 320}));
  assert.throws(() => createDroneFireworkBuffersFromCues(excess), /budget/);
});
