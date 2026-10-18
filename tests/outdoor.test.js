import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTDOOR_GAMES, FISH, HOP_PLATFORMS, createOutdoorGame, beginOutdoorGame, pressOutdoorAction, releaseOutdoorAction, stepOutdoorGame, setOutdoorPaused, cancelOutdoorInput, hopChargeWindow, sanitizeOutdoorRecords, nearestOutdoorGame } from '../src/minigames/outdoor.js';
import { isWalkable } from '../shared/world.js';

function run(state, seconds, fps = 60) { for (let t = 0; t < seconds - 1e-9; t += 1 / fps) stepOutdoorGame(state, Math.min(1 / fps, seconds - t)); return state; }
function started(id) { const state = createOutdoorGame(id); beginOutdoorGame(state); return state; }
function tap(state, random) { pressOutdoorAction(state, random); releaseOutdoorAction(state); }

test('outdoor: only known ids start, entrances are walkable and discoverable', () => {
  assert.equal(createOutdoorGame('unknown'), null);
  assert.equal(createOutdoorGame('toString'), null);
  assert.equal(createOutdoorGame('__proto__'), null);
  for (const game of OUTDOOR_GAMES.filter(game => !game.global)) { assert.ok(isWalkable(game.x, game.z), game.id); assert.equal(nearestOutdoorGame(game), game.id); }
  assert.equal(createOutdoorGame('jetpack'), null, 'global jetpack never opens a confined practice game');
  assert.equal(nearestOutdoorGame({ x: 0, z: 10 }), null);
});
test('outdoor: ready, paused and invalid time never advance a practice', () => {
  for (const game of OUTDOOR_GAMES.filter(game => !game.global)) {
    const state = createOutdoorGame(game.id); run(state, 2); assert.equal(state.elapsed, 0);
    beginOutdoorGame(state); setOutdoorPaused(state, true); run(state, 2); assert.equal(state.elapsed, 0);
    setOutdoorPaused(state, false);
    for (const dt of [NaN, Infinity, -1, 0]) stepOutdoorGame(state, dt);
    assert.equal(state.elapsed, 0); run(state, 0.1); assert.ok(state.elapsed > 0);
  }
});
test('fishing: early, correct and late strikes have distinct outcomes; holding does not recast', () => {
  const s = started('fishing'); tap(s, () => 0); run(s, 1); tap(s); assert.equal(s.phase, 'missed'); assert.equal(s.score, 0);
  pressOutdoorAction(s, () => 0); pressOutdoorAction(s, () => 0); assert.equal(s.phase, 'casting'); releaseOutdoorAction(s);
  run(s, 3.2); assert.equal(s.phase, 'bite'); tap(s, () => 0.95); assert.equal(s.phase, 'lifting'); assert.equal(s.score, 50); assert.equal(s.catches[0], FISH[2].id);
  run(s, 1); assert.equal(s.phase, 'caught'); assert.ok(s.fish.lengthCm > 0 && s.fish.weightKg > 0);
  tap(s, () => 0); run(s, 5); assert.equal(s.phase, 'missed'); assert.equal(s.catches.length, 1);
});
test('fishing: all species have tested rarity paths and consecutive catches accumulate', () => {
  const s = started('fishing');
  for (const roll of [0, 0.7, 0.95]) { tap(s, () => 0); run(s, 3.2); tap(s, () => roll); run(s, 1); }
  assert.deepEqual(s.catches, FISH.map(f => f.id)); assert.equal(s.score, 85);
});
test('fishing: pausing during bite freezes the strike window', () => {
  const s = started('fishing'); tap(s, () => 0); run(s, 3.2); setOutdoorPaused(s, true); run(s, 10); tap(s); assert.equal(s.phase, 'bite');
  setOutdoorPaused(s, false); tap(s, () => 0); assert.equal(s.catches.length, 1);
});
test('hop: ideal charges traverse all eight platforms and earn center combos', () => {
  const s = started('hop');
  for (let i = 0; i < 8; i++) {
    const ideal = hopChargeWindow(s).ideal;
    pressOutdoorAction(s); run(s, ideal * 1.1, 120); releaseOutdoorAction(s); run(s, 1.2);
    assert.equal(s.platform, i + 1); assert.ok(s.score > 0);
  }
  assert.equal(s.status, 'finished'); assert.equal(s.won, true); assert.equal(s.combo, 8); assert.equal(s.score, 340);
  const score = s.score; run(s, 5); tap(s); assert.equal(s.score, score);
});
test('hop: undercharge and overcharge fail; cancel/blur never launches', () => {
  for (const seconds of [0.02, 2]) {
    const s = started('hop'); pressOutdoorAction(s); run(s, seconds); releaseOutdoorAction(s); run(s, 2);
    assert.equal(s.status, 'finished'); assert.equal(s.platform, 0); assert.equal(s.pose.y, 0);
  }
  const s = started('hop'); pressOutdoorAction(s); run(s, 0.4); cancelOutdoorInput(s); releaseOutdoorAction(s); run(s, 1);
  assert.equal(s.phase, 'grounded'); assert.equal(s.platform, 0); assert.equal(s.charge, 0);
});
test('hop: charge window adapts to an off-center landing', () => {
  const s = started('hop'); s.pose.x += 0.5;
  const w = hopChargeWindow(s); assert.ok(w.min < w.ideal && w.ideal < w.max);
  assert.ok(w.ideal < (Math.hypot(3.8, 0.7) - 1) / 5.5);
  assert.equal(HOP_PLATFORMS.length, 9);
});
test('outdoor records: malformed storage is bounded and only known species/ids survive', () => {
  assert.deepEqual(sanitizeOutdoorRecords(null), { best: { fishing: 0, hop: 0, jetpack: 0 }, fish: {} });
  assert.deepEqual(sanitizeOutdoorRecords({ best: { fishing: Infinity, hop: -1, jetpack: 8000000 }, fish: { crucian: 3, carp: 1.5, gold: -1, fake: 9 } }), { best: { fishing: 0, hop: 0, jetpack: 1000000 }, fish: { crucian: 3 } });
});
