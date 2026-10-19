import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformWithEsbuild } from 'vite';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import { BLACK_HOLE_DURATION, BLACK_HOLE_CHAPTERS, sampleBlackHoleShow, updateBlackHoleFleet } from '../shared/droneBlackHole.js';
import { createDroneFleet, updateDroneFleet } from '../shared/droneShow.js';
import { getDroneProgram, sampleDroneProgram, updateDroneProgram } from '../shared/dronePrograms.js';
import { createDroneShowClock } from '../src/lib/droneShowClock.js';
import { sampleBlackHoleCamera } from '../src/components/drone/blackHoleCamera.js';

test('black hole is an independent 90 second score with five complete acts and no looping', () => {
  assert.equal(BLACK_HOLE_DURATION, 90000);
  assert.deepEqual(BLACK_HOLE_CHAPTERS.slice(0, -1).map(c => [c.start, c.end]), [[0, 12000], [12000, 35000], [35000, 65000], [65000, 80000], [80000, 90000]]);
  assert.equal(getDroneProgram('blackhole').duration, 90000);
  assert.equal(getDroneProgram('blackhole').supportsFpv, false);
  assert.equal(getDroneProgram('blackhole').supportsAudio, false);
  for (const time of [0, 12000, 35000, 50000, 65000, 80000, 90000]) {
    assert.deepEqual(sampleDroneProgram(time, 'blackhole'), sampleBlackHoleShow(time));
    assert.equal(sampleBlackHoleShow(time).program, 'blackhole');
  }
  for (const time of [90000, 150000, 1000000]) {
    assert.equal(sampleBlackHoleShow(time).phase, 'ended');
    assert.equal(sampleBlackHoleShow(time).active, false);
    assert.equal(sampleBlackHoleShow(time).opacity, 0);
  }
});

test('black hole fades continuously, supports exact seeking and freezes reduced-motion flow', () => {
  let previous = sampleBlackHoleShow(0);
  for (let time = 100; time <= 90000; time += 100) {
    const state = sampleBlackHoleShow(time);
    assert.ok(state.opacity >= 0 && state.opacity <= 1);
    assert.ok(Math.abs(state.opacity - previous.opacity) < .02, 'no opacity cuts or strobes');
    assert.equal(sampleBlackHoleShow(time, { reducedMotion: true }).animationTime, 45);
    previous = state;
  }
  assert.equal(sampleBlackHoleShow(35000).formation, 1);
  assert.equal(sampleBlackHoleShow(70000).opacity, 1);
  assert.equal(sampleBlackHoleShow(-1).elapsed, 0);
  assert.equal(sampleBlackHoleShow(NaN).elapsed, 0);
  const mark = sampleBlackHoleShow(47000);
  sampleBlackHoleShow(89000); assert.deepEqual(sampleBlackHoleShow(47000), mark);
});

test('entity score parks and hides aircraft without changing identities, then restores the other scores', () => {
  for (const count of [2048, 4096]) {
    const fleet = createDroneFleet(count), baseline = createDroneFleet(count);
    const identities = fleet.identities.slice();
    updateDroneFleet(fleet, 76000);
    const positions = fleet.positions, sizes = fleet.sizes, colors = fleet.colors;
    updateBlackHoleFleet(fleet, 35000);
    assert.deepEqual(fleet.positions, fleet.bases);
    assert.ok(fleet.colors.every(value => value === 0));
    assert.ok(fleet.sizes.every(value => value === 0));
    updateDroneProgram(fleet, 70000, { program: 'blackhole', reducedMotion: true });
    assert.equal(fleet.state.animationTime, 45);
    assert.equal(fleet.positions, positions); assert.equal(fleet.sizes, sizes); assert.equal(fleet.colors, colors);
    assert.deepEqual(fleet.identities, identities);
    updateDroneProgram(fleet, 76000, { program: 'avatar' }); updateDroneFleet(baseline, 76000);
    assert.deepEqual(fleet.positions, baseline.positions); assert.deepEqual(fleet.colors, baseline.colors);
    updateDroneProgram(fleet, 50000, { program: 'blackhole' });
    assert.ok(fleet.sizes.every(value => value === 0), 'returning to entity mode hides restored lights again');
  }
});

test('shared clock uses the selected duration and clears incompatible view on start and switch', () => {
  let now = 0;
  const clock = createDroneShowClock({ now: () => now });
  clock.start({ program: 'blackhole', view: 'fpv', speed: 2 });
  assert.equal(clock.snapshot().view, 'cinematic');
  now = 44999; assert.equal(clock.snapshot().ended, false);
  now = 45000; assert.equal(clock.timeRef.current, 90000); assert.equal(clock.snapshot().ended, true);
  clock.togglePause(); now = 50000; assert.equal(clock.timeRef.current, 90000);
  clock.setProgram('droplet'); assert.equal(clock.snapshot().elapsedMs, 0); assert.equal(clock.snapshot().speed, 2);
  clock.seek(120000); assert.equal(clock.snapshot().ended, false);
  clock.seek(150000); assert.equal(clock.snapshot().ended, true);
  clock.setProgram('blackhole'); assert.equal(clock.snapshot().elapsedMs, 0);
  clock.setView('fpv'); assert.equal(clock.snapshot().view, 'cinematic');
  clock.seek(90000); clock.seek(35000); now += 1000; assert.equal(clock.timeRef.current, 37000);
  clock.setProgram('avatar'); clock.setView('fpv'); assert.equal(clock.snapshot().view, 'fpv');
  const custom = createDroneShowClock({ now: () => 0, duration: 1000 });
  custom.start({ program: 'blackhole' }); custom.seek(1200); assert.equal(custom.timeRef.current, 1000);
});

test('black hole camera frames the luminous core and glow at desktop and portrait widths', () => {
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    for (const time of [0, 12000, 35000, 50000, 70000, 85000, 90000]) {
      const pose = sampleBlackHoleCamera(time, width / height);
      const camera = new THREE.PerspectiveCamera(pose.fov, width / height, pose.near, pose.far);
      camera.position.set(...pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld();
      for (const x of [-120, 120]) for (const y of [50, 210]) {
        const p = new THREE.Vector3(x, y, -50).project(camera);
          assert.ok(Math.abs(p.x) < .9 && Math.abs(p.y) < .9, 'luminous disc and glow remain in viewport');
      }
      assert.ok(pose.position[2] > -50); assert.equal(pose.position[0], 0, 'front-facing shader is never seen edge-on');
    }
    assert.deepEqual(sampleBlackHoleCamera(0, width / height, true), sampleBlackHoleCamera(89000, width / height, true));
  }
});

test('black hole controls have their own labels, 90 second timeline, silent mode and no battle shortcuts', async () => {
  const file = new URL('../src/components/drone/DroneShowControls.jsx', import.meta.url);
  const { code } = await transformWithEsbuild(fs.readFileSync(file, 'utf8'), 'DroneShowControls.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
  const require = createRequire(file), module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: id => id.endsWith('.css') ? {} : require(id) });
  const clock = createDroneShowClock({ now: () => 0 }); clock.start({ program: 'blackhole', elapsedMs: 50000 });
  const render = () => renderToStaticMarkup(require('react').createElement(module.exports.default, { controller: { ...clock, state: clock.snapshot() }, onClose() {} }));
  const html = render();
  assert.match(html, /data-drone-program="blackhole"/); assert.match(html, /max="90000"/);
  for (const text of ['黑洞降临', '黑洞成形', '光环盛景', '凝望深空', '静默观演']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /直达首击|战后寂静|舰队幻化|立方集结|开启演出音效|无人机已归航|万灯归航/);
  clock.seek(90000); assert.match(render(), /演出结束 · 星光归寂/);
});

test('black hole host uses the existing canvas, hides aircraft and disposes the independent visual', () => {
  const scene = fs.readFileSync(new URL('../src/components/drone/DroneShow.jsx', import.meta.url), 'utf8');
  assert.match(scene, /program === 'blackhole' \? createBlackHoleVisual\(\) : null/);
  assert.match(scene, /points\.visible = trails\.visible = bases\.visible = pads\.visible = false/);
  assert.match(scene, /blackHole\.update\(safeTime, reducedMotion\)/);
  assert.match(scene, /blackHole\?\.dispose\(\)/);
  assert.match(scene, /getDroneProgram\(program,aiRuntime\)\.supportsFpv/);
  assert.doesNotMatch(scene, /<Canvas\b|new THREE\.WebGLRenderer/);
});
