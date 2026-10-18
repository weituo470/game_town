import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDroneShowClock } from '../src/lib/droneShowClock.js';
import { createDroneFleet, updateDroneFleet, sampleDroneShow, DRONE_DRAGON, DRONE_STUNT } from '../shared/droneShow.js';
import { DRONE_PROGRAMS, DRONE_PROGRAM_MENU, getDroneProgram, sampleDroneProgram, updateDroneProgram } from '../shared/dronePrograms.js';

test('public menu preserves all three shows while the celestial score remains ambient-only internal compatibility', () => {
  assert.deepEqual(DRONE_PROGRAMS.map(item => item.id), ['avatar', 'droplet', 'carrier-battle', 'blackhole']);
  assert.deepEqual(DRONE_PROGRAMS.map(item => item.duration), [150000, 150000, 150000, 90000]);
  assert.deepEqual(DRONE_PROGRAM_MENU.map(item => item.id), ['avatar', 'droplet', 'carrier-battle']);
  assert.equal(getDroneProgram('blackhole').ambientOnly, true);
  assert.ok(Object.isFrozen(DRONE_PROGRAM_MENU));
  for (const item of DRONE_PROGRAM_MENU) assert.doesNotMatch(item.description, /黑洞|片尾|彩蛋|自动接续/);
  assert.equal(getDroneProgram('unknown').id, 'avatar');
  for (const time of [0, 8000, 76000, 86000, 91200, 93200, 98000, 150000]) {
    assert.deepEqual(sampleDroneProgram(time), sampleDroneShow(time));
  }
});

test('avatar shortcuts expose the held dragon and the shared reignition beat without changing droplet', () => {
  const avatar = getDroneProgram('avatar');
  assert.ok(avatar.dragonTime >= DRONE_DRAGON.formed && avatar.dragonTime < DRONE_DRAGON.holdEnd);
  assert.equal(sampleDroneProgram(avatar.dragonTime).phase, 'dragon');
  assert.equal(avatar.recoveryTime, DRONE_STUNT.brakeStart);
  assert.equal(getDroneProgram('droplet').dragonTime, undefined);
});

test('program switching restarts cleanly, preserves speed and never reuses an incompatible FPV', () => {
  let now = 0;
  const clock = createDroneShowClock({ now: () => now });
  clock.start({ program: 'avatar', view: 'fpv', speed: 2 });
  now = 1000;
  clock.togglePause();
  assert.equal(clock.timeRef.current, 2000);
  const state = clock.setProgram('droplet');
  assert.equal(state.program, 'droplet');
  assert.equal(state.elapsedMs, 0);
  assert.equal(state.speed, 2);
  assert.equal(state.paused, false);
  assert.equal(state.view, 'cinematic');
  clock.setView('fpv');
  assert.equal(clock.snapshot().view, 'cinematic');
  now += 500;
  assert.equal(clock.timeRef.current, 1000);
  clock.setProgram('droplet'); // Selecting the same item is not a restart.
  assert.equal(clock.timeRef.current, 1000);
  clock.setProgram('bogus');
  assert.equal(clock.snapshot().program, 'droplet');
  clock.setProgram('avatar');
  clock.setView('fpv');
  assert.equal(clock.snapshot().view, 'fpv');
});

test('inactive selection stays inactive and a droplet restart stays on the selected score', () => {
  const clock = createDroneShowClock({ now: () => 0 });
  clock.setProgram('droplet');
  assert.equal(clock.snapshot().active, false);
  assert.equal(clock.snapshot().paused, true);
  clock.start({ view: 'fpv' });
  assert.equal(clock.snapshot().program, 'droplet');
  assert.equal(clock.snapshot().view, 'cinematic');
  clock.seek(150000);
  assert.equal(clock.snapshot().ended, true);
  clock.start();
  assert.equal(clock.snapshot().elapsedMs, 0);
  assert.equal(clock.snapshot().program, 'droplet');
});

test('reselecting the active programme preserves paused, ended and closed states without resetting', () => {
  for (const program of DRONE_PROGRAMS) {
    const clock = createDroneShowClock({ now: () => 0 });
    clock.start({ program: program.id, elapsedMs: 52000, speed: 2 });
    clock.togglePause();
    clock.setReducedMotion(true);
    const paused = clock.snapshot();
    assert.deepEqual(clock.setProgram(program.id), paused);
    clock.seek(program.duration);
    const ended = clock.snapshot();
    assert.deepEqual(clock.setProgram(program.id), ended);
    clock.close();
    const closed = clock.snapshot();
    assert.deepEqual(clock.setProgram(program.id), closed);
  }
});

test('dispatcher can return the same aircraft to the original show without stale buffers', () => {
  const fleet = createDroneFleet(2048);
  const baseline = createDroneFleet(2048);
  for (const time of [0, 35000, 52000, 64000, 96000, 107000, 150000]) {
    updateDroneProgram(fleet, time, { program: 'droplet' });
    assert.equal(fleet.state.program, 'droplet');
    updateDroneProgram(fleet, 76000, { program: 'avatar' });
    updateDroneFleet(baseline, 76000);
    assert.deepEqual(fleet.positions, baseline.positions);
    assert.deepEqual(fleet.colors, baseline.colors);
    assert.deepEqual(fleet.sizes, baseline.sizes);
  }
});

test('explicit programme is threaded through the existing Town scene and reset outside observation', () => {
  const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
  const town = read('src/components/Town.jsx');
  assert.equal((town.match(/<Canvas\b/g) || []).length, 1);
  assert.match(town, /<DroneShow program=\{props\.viewMode === 'drone' \? props\.droneFpv\?\.program \|\| 'avatar' : 'avatar'\}/);
  const scene = read('src/components/drone/DroneShow.jsx');
  assert.match(scene, /\[count, gl, fleetRef, onSeatsReady, program\]/);
  assert.match(scene, /updateDroneProgram\(fleet, safeTime, \{ reducedMotion, program \}\)/);
  const app = read('src/App.jsx');
  assert.match(app, /\['drones', 'droplet', 'carrier-battle'\]\.includes/);
  assert.doesNotMatch(app, /\['drones', 'droplet', 'blackhole'\]\.includes/);
  assert.match(app, /getDroneProgram\(program\)\.ambientOnly \? 'avatar' : getDroneProgram\(program\)\.id/);
  assert.match(app, /program: droneWatching \? drone\.state\.program : 'avatar'/);
  assert.match(app, /new URLSearchParams\(window.location.search\)/);
});
