import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DRONE_FIREWORKS_BUDGET, getDroneFireworkCues, createDroneFireworkBuffers, sampleFireworkParticle, sampleFireworkRocket } from '../shared/droneFireworks.js';
import { createDroneSpectacleVisual, FIREWORK_LIGHT_PROFILE, FIREWORK_VERTEX_SHADER, FIREWORK_FRAGMENT_SHADER, ROCKET_VERTEX_SHADER } from '../src/components/drone/droneSpectacleVisual.js';

const IDS = ['phoenix-rebirth', 'tidal-whale', 'gravity-gate'];

test('every short show has original balanced firework cues and an explicitly bounded fixed pool', () => {
  assert.deepEqual(DRONE_FIREWORKS_BUDGET, { sparks: 8000, rockets: 512, drawCalls: 2 });
  for (const id of IDS) {
    const program = getDroneFireworkCues(id), data = createDroneFireworkBuffers(id), low = createDroneFireworkBuffers(id, 2048);
    assert.ok(Object.isFrozen(program)); assert.ok(Object.isFrozen(program.cues)); assert.ok(Object.isFrozen(data));
    assert.ok(program.cues.length >= 8 && program.cues.length <= 12);
    assert.ok(new Set(program.cues.map(item => item.style)).size >= 3);
    assert.ok(data.count > 6000 && data.count <= 8000); assert.ok(data.rocketCount <= 512);
    assert.ok(low.count < data.count); assert.equal(low.rocketCount, data.rocketCount);
    for (const item of program.cues) {
      assert.ok(item.at > item.launch && item.at + item.life < program.end);
      assert.ok(item.origin.every(Number.isFinite)); assert.ok(item.color.every(channel => channel >= 0 && channel <= 1));
    }
    for (const name of ['origin', 'velocity', 'timing', 'motion', 'color', 'seed', 'rocketOrigin', 'rocketTiming', 'rocketColor']) {
      assert.ok(data[name] instanceof Float32Array); assert.ok(data[name].every(Number.isFinite));
    }
  }
  assert.throws(() => createDroneFireworkBuffers('untrusted-id'), RangeError);
});

test('spark and rocket positions can be sampled directly, in reverse, and repeatedly without accumulated state', () => {
  for (const id of IDS) {
    const data = createDroneFireworkBuffers(id), rebuilt = createDroneFireworkBuffers(id);
    assert.deepEqual(data, rebuilt);
    const out = new Float64Array(4);
    for (const index of [0, 1, 2, 129, data.count - 1]) {
      const at = data.timing[index * 3] * 1000 + 900;
      const snapshot = sampleFireworkParticle(data, index, at).slice();
      sampleFireworkParticle(data, index, 0, out); sampleFireworkParticle(data, index, 200000, out);
      assert.equal(sampleFireworkParticle(data, index, at, out), out); assert.deepEqual(out, snapshot);
      assert.ok(out.every(Number.isFinite));
    }
    for (const index of [0, 4, data.rocketCount - 1]) {
      const at = data.rocketTiming[index * 3] * 1000 + 1000;
      const snapshot = sampleFireworkRocket(data, index, at).slice();
      sampleFireworkRocket(data, index, 90000, out); sampleFireworkRocket(data, index, 0, out);
      assert.equal(sampleFireworkRocket(data, index, at, out), out); assert.deepEqual(out, snapshot);
    }
  }
});

test('rockets precede their own burst, then every point extinguishes before fleet recovery', () => {
  for (const id of IDS) {
    const data = createDroneFireworkBuffers(id), program = getDroneFireworkCues(id), scratch = new Float64Array(4);
    let firstParticle = 0;
    for (const [eventIndex, item] of program.cues.entries()) {
      const rocket = sampleFireworkRocket(data, eventIndex * 17, (item.at - .6) * 1000);
      assert.ok(rocket[3] > .9); assert.ok(rocket[1] > 5 && rocket[1] < item.origin[1]);
      assert.equal(sampleFireworkParticle(data, firstParticle, (item.at - .01) * 1000)[3], 0);
      assert.ok(sampleFireworkParticle(data, firstParticle, (item.at + .6) * 1000)[3] > .1);
      assert.equal(sampleFireworkRocket(data, eventIndex * 17, (item.at + .02) * 1000)[3], 0);
      firstParticle += item.count * 3;
    }
    for (let index = 0; index < data.count; index++) {
      for (const time of [0, data.end * 1000, data.end * 1000 + 14000, Number.POSITIVE_INFINITY]) {
        sampleFireworkParticle(data, index, time, scratch); assert.equal(scratch[3], 0); assert.ok(scratch.every(Number.isFinite));
      }
    }
    for (let index = 0; index < data.rocketCount; index++) assert.equal(sampleFireworkRocket(data, index, data.end * 1000, scratch)[3], 0);
  }
});

test('radial bodies use drag and gravity while three separate beads describe a short fading tail', () => {
  const data = createDroneFireworkBuffers('phoenix-rebirth'), at = data.timing[0] * 1000;
  const a = sampleFireworkParticle(data, 0, at + 700), b = sampleFireworkParticle(data, 0, at + 1400), c = sampleFireworkParticle(data, 0, at + 2100);
  assert.ok(b[1] - a[1] > c[1] - b[1], 'upward motion decelerates with drag and gravity');
  const head = sampleFireworkParticle(data, 0, at + 1500), mid = sampleFireworkParticle(data, 1, at + 1500), end = sampleFireworkParticle(data, 2, at + 1500);
  assert.ok(head[3] > mid[3]); assert.ok(Math.hypot(...head.slice(0, 3).map((value, axis) => value - mid[axis])) > .03);
  assert.notDeepEqual(mid.slice(0, 3), end.slice(0, 3));
  const antiGravity = createDroneFireworkBuffers('gravity-gate');
  assert.ok(antiGravity.motion[0] < 0); assert.ok(sampleFireworkParticle(antiGravity, 0, 63500)[1] > sampleFireworkParticle(antiGravity, 0, 61500)[1]);
});

test('all visible sparks remain in the camera-approved background envelope rather than obscuring the town', () => {
  const point = new Float64Array(4);
  for (const id of IDS) {
    const data = createDroneFireworkBuffers(id);
    for (let index = 0; index < data.count; index += 3) {
      const start = data.timing[index * 3], life = data.timing[index * 3 + 1];
      for (let age = .1; age < life; age += .2) {
        sampleFireworkParticle(data, index, (start + age) * 1000, point);
        if (point[3] < .07) continue;
        assert.ok(Math.abs(point[0]) <= 92, `${id} horizontal framing`);
        assert.ok(point[1] >= 35 && point[1] <= 150, `${id} sky-only spark framing`);
        assert.ok(point[2] >= -65 && point[2] <= 1, `${id} background depth framing`);
      }
    }
  }
});

test('the visual uses exactly two Points draws, never reallocates geometry per frame, and hides all motion in reduced mode', () => {
  for (const id of IDS) {
    const visual = createDroneSpectacleVisual(id), children = [...visual.group.children];
    assert.equal(children.length, 2); assert.ok(children.every(child => child.isPoints));
    assert.equal(visual.stats.drawCalls, 2); assert.equal(visual.group.visible, false);
    const attributes = children.map(child => Object.values(child.geometry.attributes).map(attribute => ({ attribute, array: attribute.array, version: attribute.version })));
    for (let step = 0; step <= 2000; step++) visual.update(step * 50, false, 1440);
    for (const records of attributes) for (const record of records) { assert.equal(record.attribute.array, record.array); assert.equal(record.attribute.version, record.version); }
    const time = getDroneFireworkCues(id).cues[0].at * 1000 + 1000;
    visual.update(time, false, 900); assert.equal(visual.group.visible, true);
    assert.equal(children[0].material.uniforms.uTime.value, time / 1000); assert.equal(children[0].material.uniforms.uViewportHeight.value, 900);
    visual.update(time, true); assert.equal(visual.group.visible, false);
    visual.update(time, false); assert.equal(visual.group.visible, true);
    visual.update(getDroneFireworkCues(id).end * 1000); assert.equal(visual.group.visible, false);
    visual.update(0); assert.equal(visual.group.visible, false);
    visual.dispose();
  }
});

test('dispose releases all four GPU resources exactly once and ignores late update calls', () => {
  const visual = createDroneSpectacleVisual('phoenix-rebirth');
  let disposed = 0;
  for (const child of visual.group.children) { child.geometry.addEventListener('dispose', () => disposed++); child.material.addEventListener('dispose', () => disposed++); }
  visual.dispose(); visual.dispose(); assert.equal(disposed, 4); assert.equal(visual.group.children.length, 0);
  assert.equal(visual.update(83000), false); assert.equal(visual.group.visible, false);
});

test('GPU shaders have compact sprites, no additive tube/flash, and the factory stays out of the startup import graph', () => {
  assert.match(FIREWORK_VERTEX_SHADER, /exp\(-aMotion\.y \* t\)/);
  assert.match(FIREWORK_VERTEX_SHADER, /world\.y -= \.5 \* aMotion\.x \* t \* t/);
  assert.match(ROCKET_VERTEX_SHADER, /aTiming\.y, age/);
  assert.match(FIREWORK_FRAGMENT_SHADER, /radius > \.83/);
  const source = fs.readFileSync(new URL('../src/components/drone/droneSpectacleVisual.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /new THREE\.(?:Line|Mesh|Light|WebGLRenderer)|AdditiveBlending|fetch\(|requestAnimationFrame\(/);
  assert.match(source, /blending: THREE\.NormalBlending/);
  const host = fs.readFileSync(new URL('../src/components/drone/DroneShow.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(host, /import.*droneSpectacleVisual/);
  assert.match(host, /sampleVisual === 'spectacle-v2'/); assert.match(host, /spectacle\?\.dispose\(\)/);
  assert.ok(host.indexOf('spectacle?.update(') < host.indexOf('if (!needsFleetUpdate('));
});

test('firework beads stay readable in a wide shot without a bloom pass or continuous ribbons', () => {
  assert.ok(FIREWORK_LIGHT_PROFILE.worldSize >= 1.15 && FIREWORK_LIGHT_PROFILE.worldSize <= 1.35);
  assert.ok(FIREWORK_LIGHT_PROFILE.minPixels >= 3 && FIREWORK_LIGHT_PROFILE.maxPixels <= 14);
  assert.ok(FIREWORK_LIGHT_PROFILE.alphaGain >= 1.2 && FIREWORK_LIGHT_PROFILE.alphaGain <= 1.4);
  assert.ok(FIREWORK_LIGHT_PROFILE.coreOuter >= .6 && FIREWORK_LIGHT_PROFILE.coreOuter < .7);
  assert.match(FIREWORK_VERTEX_SHADER, /1\.24 \* aMotion\.z/);
  assert.match(FIREWORK_FRAGMENT_SHADER, /smoothstep\(\.24, 0\.64, radius\)/);
  const data = createDroneFireworkBuffers('phoenix-rebirth');
  assert.ok(sampleFireworkParticle(data, 0, data.timing[0] * 1000 + 1100)[3] > .8);
});
