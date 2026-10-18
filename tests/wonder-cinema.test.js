import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CINEMA_SCENES, advanceCinema, safeCinemaTime, cinemaPhase } from '../src/components/wonders/cinemaTimeline.js';
import { auditSources } from '../scripts/check-readability.mjs';
const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('cinema timeline clamps malformed input and never drives the shared room clock', () => {
  for (const value of [NaN, Infinity, undefined, -30]) assert.equal(safeCinemaTime(value), 0);
  assert.equal(safeCinemaTime(1000), 60);
  assert.equal(advanceCinema(10, 1 / 60, true), 10);
  assert.equal(advanceCinema(10, 1 / 60, false, true), 10);
  assert.equal(advanceCinema(59.95, .1, false), 60);
  assert.equal(advanceCinema(10, 3000, false), 10.15);
  assert.equal(advanceCinema(10, NaN, false), 10);
  assert.equal(advanceCinema(10, -.1, false), 10);
});
test('all three chapters have valid independent climax markers and deterministic phases', () => {
  assert.deepEqual(CINEMA_SCENES.map(s => s.id), ['orca', 'carrier', 'rocket']);
  for (const scene of CINEMA_SCENES) {
    assert.ok(scene.cue > 0 && scene.cue < 60);
    assert.ok(scene.marks.every(([t]) => t >= 0 && t <= 60));
    for (let t = 0; t <= 60; t += .5) assert.equal(cinemaPhase(scene.id, t), cinemaPhase(scene.id, t));
  }
  assert.equal(cinemaPhase('rocket', 12), '离台');
  assert.equal(cinemaPhase('carrier', 8), '起飞');
});
test('cinema controls, headings and mobile overrides respect readable sizes', () => {
  const paths = ['src/styles.css', 'src/components/wonders/wonder-cinema.css', 'src/components/wonders/WonderCinema.jsx'];
  assert.deepEqual(auditSources(paths.map(path => ({ path, content: read(path) }))).issues, []);
  const ui = read(paths[2]);
  assert.match(ui, /aria-modal="true"/);
  assert.match(ui, /event.key === 'Escape'/);
  assert.match(ui, /event.key !== 'Tab'/);
  assert.match(ui, /previous\?\.focus/);
  assert.match(ui, /aria-label="演出时间"/);
  assert.match(ui, /独立观赏 · 不改变同房演出/);
  assert.doesNotMatch(ui, /fetch\(|npcTimeRef\.current\s*=/);
});
test('cinema keeps one active chapter, loads locally, and disposes render resources', () => {
  const ui = read('src/components/wonders/WonderCinema.jsx');
  assert.match(ui, /World key=\{id\}/);
  assert.match(ui, /React.lazy/);
  assert.match(ui, /frameloop=\{paused \? 'demand' : 'always'\}/);
  assert.match(ui, /\[uiTime, paused, reducedMotion, cameraMode, quality, invalidate\]/, 'paused scrubbing and quality changes must redraw the scene');
  assert.match(ui, /files=\{appUrl\('\/wonders\/coastal-sky.hdr'\)\}/);
  const renderer = read('src/components/wonders/WonderPrimitives.jsx');
  assert.match(renderer, /water.dispose\(\)/);
  assert.match(renderer, /composer.dispose\(\)/);
  assert.match(renderer, /EXT_color_buffer_float/);
  const hdr = fs.readFileSync(new URL('../public/wonders/coastal-sky.hdr', import.meta.url));
  assert.ok(hdr.length > 100000 && hdr.length < 3000000);
  assert.match(hdr.subarray(0, 128).toString(), /RADIANCE|RGBE/);
});
