import test from 'node:test';
import assert from 'node:assert/strict';
import { createDroneShowClock } from '../src/lib/droneShowClock.js';
import { createDroneFleet, updateDroneFleet } from '../shared/droneShow.js';
import { getDroneProgram, sampleDroneProgram, updateDroneProgram } from '../shared/dronePrograms.js';
import { sampleCarrierBattle, CARRIER_BATTLE_SCORE } from '../shared/carrierBattle.js';
import { sampleCarrierBattleAudioCue } from '../src/lib/droneShowAudio.js';

test('carrier battle has explicit independent chapter shortcuts and cannot enable incompatible FPV', () => {
  const program = getDroneProgram('carrier-battle');
  assert.equal(program.id, 'carrier-battle');
  assert.equal(program.supportsFpv, false);
  assert.equal(program.duration, 150000);
  for (const time of [0, program.heroTime, program.highlightTime, program.recoveryTime, 150000]) {
    assert.deepEqual(sampleDroneProgram(time, program.id), sampleCarrierBattle(time));
  }
  let now = 0;
  const clock = createDroneShowClock({ now: () => now });
  clock.start({ program: program.id, view: 'fpv', speed: 2 });
  assert.equal(clock.snapshot().view, 'cinematic');
  now = 1000;
  clock.togglePause();
  assert.equal(clock.timeRef.current, 2000);
  const paused = clock.snapshot();
  assert.deepEqual(clock.setProgram(program.id), paused);
  assert.deepEqual(clock.setView('fpv'), paused);
  clock.seek(88000);
  assert.equal(clock.snapshot().paused, true);
  clock.setProgram('avatar');
  clock.setView('fpv');
  assert.equal(clock.snapshot().view, 'fpv');
});

test('battle programme clears cached lamps and returning to avatar exactly restores the real formation', () => {
  const fleet = createDroneFleet(2048), reference = createDroneFleet(2048);
  updateDroneFleet(fleet, 48000);
  updateDroneProgram(fleet, 120000, { program: 'carrier-battle' });
  assert.ok(fleet.sizes.every(value => value === 0));
  assert.ok(fleet.colors.every(value => value === 0));
  updateDroneProgram(fleet, 48000, { program: 'avatar' });
  updateDroneFleet(reference, 48000);
  assert.deepEqual(fleet.positions, reference.positions);
  assert.deepEqual(fleet.colors, reference.colors);
  assert.deepEqual(fleet.sizes, reference.sizes);
});

test('battle sound is its own bounded fictional score, silent when ended and without impacts in reduced motion', () => {
  for (let t = 0; t <= 150000; t += 100) {
    const cue = sampleCarrierBattleAudioCue(t);
    assert.ok(cue.id.startsWith('carrier-'));
    assert.ok(cue.level >= 0 && cue.level <= 0.8);
    assert.equal(sampleCarrierBattleAudioCue(t, true).impact, false);
  }
  assert.equal(sampleCarrierBattleAudioCue(CARRIER_BATTLE_SCORE.liftStart).id, 'carrier-lift');
  assert.equal(sampleCarrierBattleAudioCue(CARRIER_BATTLE_SCORE.duelStart).id, 'carrier-duel');
  assert.equal(sampleCarrierBattleAudioCue(150000).level, 0);
});
