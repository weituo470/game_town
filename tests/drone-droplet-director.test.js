import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithEsbuild } from 'vite';
import { PerspectiveCamera, Vector3 } from 'three';
import { sampleDropletCamera } from '../src/components/drone/dropletCamera.js';
import { createDroneShowAudio, sampleDropletAudioCue, DROPLET_EXPLOSION_TIMES } from '../src/lib/droneShowAudio.js';
import { createDroneShowClock } from '../src/lib/droneShowClock.js';
import { createDroneFleet, DRONE_STUNT } from '../shared/droneShow.js';
import { DROPLET_SCORE, DROPLET_SHIPS, updateDropletFleet, sampleDropletHead } from '../shared/droneDroplet.js';
import { getDroneProgram } from '../shared/dronePrograms.js';

function project(camera, pose, aspect, point) {
  camera.aspect = aspect; camera.fov = pose.fov; camera.near = pose.near; camera.far = pose.far;
  camera.position.set(...pose.position); camera.lookAt(...pose.target);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  return point.project(camera);
}

for (const [name, aspect] of [['desktop', 1280 / 720], ['phone', 390 / 844]]) {
  test(`droplet director keeps visible launch and recovery lamps in frame: ${name}`, () => {
    const fleet = createDroneFleet(), camera = new PerspectiveCamera(), point = new Vector3();
    for (let time = 0; time <= 150000; time += 500) {
      // The independent solid vessels/probe are checked separately below.
      if (time > 34000 && time < 114000) continue;
      updateDropletFleet(fleet, time);
      const pose = sampleDropletCamera(time, aspect);
      project(camera, pose, aspect, point.set(0, 0, 0));
      for (let index = 0; index < fleet.count; index++) {
        if (fleet.sizes[index] < .01) continue;
        point.fromArray(fleet.positions, index * 3).project(camera);
        assert.ok(Math.abs(point.x) < .99 && Math.abs(point.y) < .99 && point.z > -1 && point.z < 1,
          `${name} crop at ${time}, drone ${index}: ${point.toArray()}`);
      }
    }
  });

  test(`droplet close-up frames the complete round head and pointed tail: ${name}`, () => {
    const camera = new PerspectiveCamera(), point = new Vector3();
    const head = sampleDropletHead(52000, new Float64Array(8));
    const pose = sampleDropletCamera(52000, aspect);
    project(camera, pose, aspect, point.set(0, 0, 0));
    let minX = Infinity, maxX = -Infinity;
    // Bound the real 3.5-unit mesh, not the old light-point approximation.
    for (const x of [-1.75, 1.75]) for (const y of [-.72, .72]) for (const z of [-.72, .72]) {
      point.set(head[0] + x * head[4], head[1] + y * head[4], head[2] + z * head[4]).project(camera);
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      assert.ok(Math.abs(point.x) < .75 && Math.abs(point.y) < .6, `${name}: ${point.toArray()}`);
    }
    assert.ok(maxX - minX > .34, `${name} close-up must show the reflective mesh, not a speck`);
    assert.deepEqual(sampleDropletCamera(50000, aspect), sampleDropletCamera(58000, aspect));
  });
}

test('droplet director has no hard cuts, holds the aftermath, and fixes reduced-motion camera', () => {
  for (const aspect of [1280 / 720, 390 / 844]) {
    let previous = sampleDropletCamera(0, aspect);
    for (let time = 50; time <= 180000; time += 50) {
      const pose = sampleDropletCamera(time, aspect);
      assert.ok(Math.hypot(...pose.position.map((value, axis) => value - previous.position[axis])) < 14, `cut at ${time}`);
      assert.ok(Math.abs(pose.fov - previous.fov) < .5, `lens cut at ${time}`);
      previous = pose;
      assert.deepEqual(sampleDropletCamera(time, aspect, true), sampleDropletCamera(0, aspect, true));
    }
    assert.deepEqual(sampleDropletCamera(104000, aspect), sampleDropletCamera(114000, aspect));
  }
  for (const time of [NaN, Infinity, -100, 9e9]) for (const aspect of [NaN, Infinity, 0, -1]) {
    const pose = sampleDropletCamera(time, aspect);
    assert.ok([...pose.position, ...pose.target, pose.fov, pose.far].every(Number.isFinite));
  }
});

test('waterdrop controls keep panorama-only viewing and the story chapters without an encore entry or promise', async () => {
  const path = new URL('../src/components/drone/DroneShowControls.jsx', import.meta.url);
  const require = createRequire(path), module = { exports: {} };
  const transformed = await transformWithEsbuild(fs.readFileSync(path, 'utf8'), 'DroneShowControls.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
  vm.runInNewContext(transformed.code, { module, exports: module.exports, require(id) {
    if (id === './DroneVideoExport.jsx') return { __esModule: true, default: () => null };
    return id.endsWith('.css') ? {} : require(id);
  } });
  const clock = createDroneShowClock({ now: () => 0 });
  clock.start({ elapsedMs: 107000, program: 'droplet' });
  const html = renderToStaticMarkup(require('react').createElement(module.exports.default, {
    controller: { ...clock, state: clock.snapshot() }, onClose() {},
  }));
  assert.match(html, /data-drone-program="droplet"/);
  assert.match(html, /<h1><span>水滴<\/span>.*?<span class="drone-title-subject">末日之战<\/span><\/h1>/);
  assert.match(html, /aria-label="选择无人机演出节目"/);
  assert.match(html, /role="group" aria-label="选择无人机演出节目"/);
  assert.match(html, /<button(?=[^>]*aria-label="水滴 · 末日之战")(?=[^>]*aria-pressed="true")[^>]*>水滴之战<\/button>/);
  assert.match(html, /<button[^>]*aria-pressed="false"[^>]*>法天象地<\/button>/);
  assert.doesNotMatch(html, /<select[^>]*aria-label="选择无人机演出节目"/);
  assert.doesNotMatch(html, /<button[^>]*>编队第一视角/);
  assert.match(html, /导演全景 · 暂不提供编队机位/);
  assert.doesNotMatch(html, /黑洞|片尾|彩蛋|自动接续/);
  assert.equal(clock.snapshot().view, 'cinematic');
  assert.match(html, /水滴现身/);
  assert.match(html, /直达首击/);
  assert.match(html, /战后寂静/);
  assert.match(html, /立方集结/);
  assert.match(html, /舰队幻化/);
  assert.match(html, /延迟连爆/);
  assert.match(html, /命中后的寂静/);
  assert.match(html, /水滴是独立的银色镜面实体/);
  assert.match(html, /并非原著舰数/);
  assert.match(html, /class="drone-story-note"/);
  assert.equal((html.match(/class="drone-chapter(?: drone-chapter-active)?"/g) || []).length, 12);
  assert.doesNotMatch(html, /直达法相|直达失重|贴海复燃|礼成/);
  assert.ok(html.indexOf('aria-label="选择无人机演出节目"') < html.indexOf('id="drone-show-details"'));
  assert.equal(getDroneProgram('droplet').supportsFpv, false);
});

test('the delayed-explosion shortcut seeks the derived score boundary and preserves a deliberate pause', async () => {
  const path = new URL('../src/components/drone/DroneShowControls.jsx', import.meta.url);
  const require = createRequire(path), module = { exports: {} };
  const react = require('react');
  const transformed = await transformWithEsbuild(fs.readFileSync(path, 'utf8'), 'DroneShowControls.jsx', { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
  vm.runInNewContext(transformed.code, { module, exports: module.exports, require(id) {
    if (id === './DroneVideoExport.jsx') return { __esModule: true, default: () => null };
    if (id === 'react') return { ...react, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: value => ({ current: value }), useEffect() {} };
    return id.endsWith('.css') ? {} : require(id);
  } });
  const clock = createDroneShowClock({ now: () => 0 });
  clock.start({ elapsedMs: DROPLET_SCORE.attackEnd, program: 'droplet' }); clock.togglePause();
  const tree = module.exports.default({ controller: { ...clock, state: clock.snapshot() }, onClose() {} });
  const buttons = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!react.isValidElement(node)) return;
    if (node.type === 'button') buttons.push(node);
    visit(node.props.children);
  }
  visit(tree);
  const shortcut = buttons.find(button => button.props.children === '延迟连爆');
  assert.ok(shortcut); shortcut.props.onClick();
  assert.equal(clock.snapshot().elapsedMs, DROPLET_SCORE.collapseStart);
  assert.equal(clock.snapshot().paused, true);
  assert.equal(clock.snapshot().program, 'droplet');
  assert.equal(clock.snapshot().view, 'cinematic');
  clock.seek(DROPLET_SCORE.lastHit - 1);
  assert.equal(clock.snapshot().paused, true);
  clock.start({ program: 'droplet' });
  assert.equal(clock.snapshot().elapsedMs, 0);
  assert.equal(clock.snapshot().paused, false);
});

test('the oblique fleet panorama reads as six separated depth layers, not a flat grid', () => {
  const camera = new PerspectiveCamera(), point = new Vector3();
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    for (const time of [32000, 34000, 74000, 82000, 98000]) {
      project(camera, sampleDropletCamera(time, width / height), width / height, point.set(0, 0, 0));
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      // Keep the entire original cube in view even when some vessels have
      // already exploded; this preserves the scale of the accumulating loss.
      for (const ship of DROPLET_SHIPS) {
        // Root's physical ship meshes are 1.55x the original hull geometry.
        for (const x of [-9.3, 9.3]) for (const y of [-3.1, 3.1]) for (const z of [-4.65, 4.65]) {
          point.set(ship.position[0] + x, ship.position[1] + y, ship.position[2] + z).project(camera);
          minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
          assert.ok(Math.abs(point.x) < .96 && Math.abs(point.y) < .85 && point.z > -1 && point.z < 1);
        }
      }
      const proportion = (maxX - minX) / 2;
      assert.ok(proportion >= (width > 600 ? .28 : .5) && proportion < .9, `${width}px cube should occupy the stage: ${proportion} at ${time}`);
      const top = (1 - maxY) * height / 2, bottom = (1 - minY) * height / 2;
      if (width === 1280) {
        assert.ok(top >= 175 && bottom <= 580, `desktop HUD safety at ${time}: ${top}–${bottom}`);
        assert.ok(bottom - top >= 290, 'six layers should be readable at desktop size');
        assert.ok(proportion * width > 470, 'the flatter diagonal panorama should be wider than the old 420px cube');
      } else {
        assert.ok(top >= 280 && bottom <= 660, `portrait stage must remain clear at ${time}: ${top}–${bottom}`);
      }
      const near = point.set(-75, 130, 25).project(camera).clone();
      const far = point.set(-75, 130, -125).project(camera).clone();
      assert.ok(Math.abs(near.x - far.x) > .12, 'the same column on different z layers must not overlap on screen');
    }
  }
});

test('fleet transformation pushes in to readable physical ships before the waterdrop close-up', () => {
  const camera = new PerspectiveCamera(), point = new Vector3();
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    const pose = sampleDropletCamera(43000, width / height);
    project(camera, pose, width / height, point.set(0, 0, 0));
    let minX = Infinity, maxX = -Infinity;
    for (const x of [-9.3, 9.3]) for (const y of [-3.1, 3.1]) for (const z of [-4.65, 4.65]) {
      point.set(15 + x, 145 + y, 25 + z).project(camera);
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      assert.ok(Math.abs(point.x) < .5 && Math.abs(point.y) < .5, 'featured vessel remains in the clear centre');
    }
    assert.ok((maxX - minX) * width / 2 > (width > 600 ? 90 : 35), 'foreground ship must show its physical hull');
    assert.deepEqual(sampleDropletCamera(42000, width / height), sampleDropletCamera(44000, width / height));
  }
});

test('first penetration gets a closer view without following impossible waterdrop turns', () => {
  const close = sampleDropletCamera(64000), wide = sampleDropletCamera(82000);
  const distance = pose => Math.hypot(...pose.position.map((value, axis) => value - pose.target[axis]));
  assert.ok(distance(close) < distance(wide) * .75);
  assert.deepEqual(sampleDropletCamera(DROPLET_SCORE.strikeStart), sampleDropletCamera(DROPLET_SCORE.firstTurn));
  assert.deepEqual(sampleDropletCamera(DROPLET_SCORE.attackEnd), sampleDropletCamera(DROPLET_SCORE.collapseStart), 'all vessels remain framed during the silent beat');
});

test('the enlarged sharp-turn route and continuous aftermath stay visible on desktop and portrait', () => {
  const camera = new PerspectiveCamera(), point = new Vector3();
  for (const aspect of [1280 / 720, 390 / 844]) {
    for (let time = 64000; time <= 108000; time += 10) {
      const head = sampleDropletHead(time);
      const pose = sampleDropletCamera(time, aspect);
      project(camera, pose, aspect, point.set(0, 0, 0));
      // Conservative cube around the moving 3.5-unit mesh, not merely its
      // centre. Includes every +/-190 corner and the post-battle exit path.
      const radius = 1.85 * head[4];
      for (const x of [-radius, radius]) for (const y of [-radius, radius]) for (const z of [-radius, radius]) {
        point.set(head[0] + x, head[1] + y, head[2] + z).project(camera);
        assert.ok(Math.abs(point.x) < .96 && Math.abs(point.y) < .9 && point.z > -1 && point.z < 1,
          `fast probe cropped at ${time}, aspect ${aspect}: ${point.toArray()}`);
      }
    }
  }
});

function audioHarness() {
  const instances = [];
  const parameter = () => ({ value: 0, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; }, cancelScheduledValues() {} });
  const node = () => ({ connect(target) { return target; }, disconnect() {}, start() {}, stop() { this.stopped = true; }, gain: parameter(), frequency: parameter() });
  class AudioContextClass {
    constructor() { this.gains = []; this.oscillators = []; this.currentTime = 0; this.sampleRate = 100; this.state = 'suspended'; this.destination = node(); instances.push(this); }
    createGain() { const gain = node(); this.gains.push(gain); return gain; }
    createOscillator() { const oscillator = node(); this.oscillators.push(oscillator); return oscillator; }
    createDynamicsCompressor() { return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter() }; }
    createBufferSource() { return node(); }
    createBuffer(_, length) { const values = new Float32Array(length); return { getChannelData: () => values }; }
    createBiquadFilter() { return node(); }
    async resume() { this.state = 'running'; }
    async close() { this.closed = true; this.state = 'closed'; }
  }
  return { instances, AudioContextClass };
}

test('droplet score waits for delayed explosions and never restores a triumph after the battle', () => {
  const firstHit = Math.min(...DROPLET_SHIPS.map(ship => ship.hitTime)) * 1000;
  const firstImpact = Math.min(...DROPLET_SHIPS.map(ship => ship.explodeTime)) * 1000;
  assert.equal(sampleDropletAudioCue(64000).impact, false);
  assert.equal(sampleDropletAudioCue(firstHit + 1).impact, false, 'penetration itself is silent');
  assert.equal(sampleDropletAudioCue(firstImpact - 1).impact, false);
  assert.equal(sampleDropletAudioCue(firstImpact + 1).impact, true);
  assert.equal(firstImpact / 1000 - firstHit / 1000, DROPLET_SCORE.explosionDelay / 1000);
  assert.ok(firstImpact > DROPLET_SCORE.lastHit + 1200);
  assert.ok(DROPLET_EXPLOSION_TIMES.length >= 12 && DROPLET_EXPLOSION_TIMES.length <= 15);
  for (let index = 0; index < DROPLET_EXPLOSION_TIMES.length; index++) {
    const time = DROPLET_EXPLOSION_TIMES[index];
    assert.ok(DROPLET_SHIPS.some(ship => Math.abs(ship.explodeTime * 1000 - time) < .001));
    if (index) assert.ok(time - DROPLET_EXPLOSION_TIMES[index - 1] >= 900);
  }
  for (let time = 60000; time < 64000; time += 100) assert.equal(sampleDropletAudioCue(time).level, 0);
  for (let time = DROPLET_SCORE.strikeStart; time < DROPLET_SCORE.collapseStart; time += 10) assert.equal(sampleDropletAudioCue(time).impact, false, 'the complete attack has no premature explosion cue');
  for (let time = DROPLET_SCORE.attackEnd; time < DROPLET_SCORE.collapseStart; time += 10) assert.equal(sampleDropletAudioCue(time).level, 0, 'hold the post-hit silence');
  for (let time = DROPLET_SCORE.silenceStart; time <= 150000; time += 100) {
    assert.deepEqual(sampleDropletAudioCue(time), sampleDropletAudioCue(110000));
    assert.equal(sampleDropletAudioCue(time).level, 0);
  }
  for (let time = 0; time <= 150000; time += 100) {
    const cue = sampleDropletAudioCue(time);
    assert.ok(cue.level >= 0 && cue.level <= .65);
    assert.equal(sampleDropletAudioCue(time, true).impact, false);
  }
});

test('droplet audio has bounded single impacts, no chapter bells, and stops avatar tails on switching', async () => {
  const { instances, AudioContextClass } = audioHarness();
  const audio = createDroneShowAudio({ AudioContextClass }), context = instances[0];
  assert.equal(context.gains[0].gain.value, 0);
  await audio.start();
  audio.update({ elapsedMs: DRONE_STUNT.brakeStart, chapter: 5 });
  const oldVoices = context.oscillators.slice(4);
  assert.equal(oldVoices.length, 3);
  audio.update({ program: 'droplet', elapsedMs: 52000, chapter: 3 });
  assert.ok(oldVoices.every(voice => voice.stopped));
  assert.equal(context.oscillators.length, 7, 'new programme must not add an ordinary chapter bell');
  audio.update({ program: 'droplet', elapsedMs: DROPLET_EXPLOSION_TIMES[0] + 1, chapter: 5 });
  assert.equal(context.oscillators.length, 8, 'one restrained impact, no phoenix chord');
  audio.update({ program: 'droplet', elapsedMs: DROPLET_EXPLOSION_TIMES[0] + 200, chapter: 5 });
  assert.equal(context.oscillators.length, 8, 'same impact cannot retrigger');
  for (const elapsedMs of [104000, 107000, 114000, 134000, 148000, 150000]) {
    audio.update({ program: 'droplet', elapsedMs, chapter: Math.floor(elapsedMs / 10000) });
    assert.equal(context.gains[0].gain.value, 0);
    assert.equal(context.oscillators.length, 8, 'the aftermath and recovery are silent');
  }
  audio.dispose();
  assert.ok(context.closed);
});
