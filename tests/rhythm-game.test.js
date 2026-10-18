import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COUNT_IN_MS, ROUND_MS, NOTES, judgement, createRound, advanceRound, pressLane, roundResult, createTransport } from '../src/minigames/rhythm/logic.js';
import { TownAudio } from '../src/minigames/rhythm/audio.js';
import { auditSources } from '../scripts/check-readability.mjs';

test('authored chart is sorted, finite, single-note and has a safe tail', () => {
  assert.equal(NOTES.length, 60);
  const ids = new Set();
  NOTES.forEach((note, i) => {
    assert.ok(Number.isFinite(note.at) && note.at > COUNT_IN_MS && note.at + 200 < ROUND_MS);
    assert.ok(Number.isInteger(note.lane) && note.lane >= 0 && note.lane < 4);
    assert.ok(!ids.has(note.id)); ids.add(note.id);
    if (i) assert.ok(note.at - NOTES[i - 1].at >= 500);
  });
});

test('symmetric inclusive timing window boundaries', () => {
  for (const sign of [-1, 1]) {
    for (const [error, points] of [[0, 100], [70, 100], [70.001, 75], [140, 75], [140.001, 45], [200, 45]]) assert.equal(judgement(sign * error)?.points, points);
    assert.equal(judgement(sign * 200.001), null);
  }
});

test('a note can be hit only once, even with multiple input sources', () => {
  const round = createRound(), note = NOTES[0];
  assert.equal(pressLane(round, note.lane, note.at).kind, 'hit');
  assert.equal(pressLane(round, note.lane, note.at).kind, 'stray');
  assert.equal(round.hits, 1); assert.equal(round.points, 100); assert.equal(round.stray, 1);
  advanceRound(round, note.at + 201); assert.equal(round.misses, 0);
});

test('misses expire once, boundary at +200 is still hittable', () => {
  const round = createRound(), note = NOTES[0];
  advanceRound(round, note.at + 200); assert.equal(round.misses, 0);
  advanceRound(round, note.at + 201); advanceRound(round, note.at + 250);
  assert.equal(round.misses, 1); assert.equal(pressLane(round, note.lane, note.at + 250).kind, 'stray');
  assert.equal(round.hits, 0);
});

test('empty presses and wrong lanes cannot farm score', () => {
  const round = createRound();
  for (let i = 0; i < 100; i++) pressLane(round, 3, NOTES[0].at);
  const result = roundResult(round, ROUND_MS, 'touch', true);
  assert.equal(result.score, 0); assert.equal(round.stray, 100); assert.equal(round.combo, 0);
});

test('countdown and end input are ignored; invalid lanes ignored', () => {
  const round = createRound();
  assert.equal(pressLane(round, 0, COUNT_IN_MS - 1), null);
  assert.equal(pressLane(round, 0, ROUND_MS), null);
  assert.equal(pressLane(round, -1, 4000), null);
  assert.equal(pressLane(round, 1.2, 4000), null);
  assert.equal(round.stray, 0);
});

test('perfect replay scores 100, captures signed timing and max combo', () => {
  const round = createRound();
  for (const note of NOTES) pressLane(round, note.lane, note.at - 25);
  advanceRound(round, ROUND_MS);
  const result = roundResult(round, ROUND_MS, 'keyboard-mouse', true);
  assert.equal(result.score, 100); assert.equal(result.metrics.maxCombo, NOTES.length);
  assert.equal(result.metrics.meanTimingErrorMs, 25); assert.equal(result.metrics.meanSignedTimingErrorMs, -25);
  assert.equal(result.metrics.perfectHits, NOTES.length); assert.equal(result.metrics.missedNotes, 0);
});

test('late render catches all misses and end is idempotent', () => {
  const round = createRound(); advanceRound(round, ROUND_MS + 999); advanceRound(round, ROUND_MS + 1999);
  assert.equal(round.misses, NOTES.length); assert.equal(round.ended, true);
  assert.equal(pressLane(round, 0, 4000), null);
  const result = roundResult(round, ROUND_MS + 999, 'touch', false);
  assert.equal(result.durationSeconds, 39); assert.equal(result.score, 0);
  assert.equal(result.gameId, 'rhythm'); assert.equal(result.completed, true); assert.equal(result.difficulty, 'standard');
  assert.ok(Object.values(result.metrics).every(v => ['number', 'string', 'boolean'].includes(typeof v)));
  assert.ok(Object.keys(result.metrics).length <= 30); assert.equal(result.metrics.timingSamples, 0);
});

test('stray press breaks combo and penalizes score, never increases it', () => {
  const round = createRound();
  pressLane(round, NOTES[0].lane, NOTES[0].at);
  pressLane(round, NOTES[1].lane, NOTES[1].at);
  const before = roundResult(round, 5000, 'touch', true).score;
  pressLane(round, 3, 4600);
  assert.equal(round.combo, 0); assert.equal(round.maxCombo, 2);
  assert.ok(roundResult(round, 5000, 'touch', true).score <= before);
});

test('transport excludes pauses, duplicate starts and long page absence', () => {
  let now = 100; const transport = createTransport(() => now);
  transport.start(); now += 4000; transport.start(); assert.equal(transport.now(), 4000);
  transport.pause(); now += 50000; transport.pause(); assert.equal(transport.now(), 4000);
  transport.start(); now += 35000; assert.equal(transport.now(), ROUND_MS);
  transport.pause(); assert.equal(transport.now(), ROUND_MS);
});

class FakeAudio {
  currentTime = 0; state = 'running'; destination = {}; closed = 0; oscillators = [];
  createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  createOscillator() { const o = { frequency: { value: 0 }, connect() {}, disconnect() { this.disconnected = true; }, start() {}, stop() { this.stopped = true; }, onended: null }; this.oscillators.push(o); return o; }
  resume() { return Promise.resolve(); }
  close() { this.closed++; this.state = 'closed'; return Promise.resolve(); }
}

test('audio lookahead does not double schedule, pause cancels nodes and close is idempotent', () => {
  const audio = new TownAudio(FakeAudio); audio.schedule(0);
  const count = audio.context.oscillators.length; assert.ok(count > 0);
  audio.schedule(0); assert.equal(audio.context.oscillators.length, count);
  audio.pause(100); assert.equal(audio.nodes.size, 0);
  assert.ok(audio.context.oscillators.every(o => o.stopped && o.disconnected));
  audio.schedule(450); const after = audio.context.oscillators.length; assert.ok(after > count);
  audio.close(); audio.close(); audio.schedule(1000);
  assert.equal(audio.context.closed, 1); assert.equal(audio.nodes.size, 0); assert.equal(audio.context.oscillators.length, after);
});

test('local readability regression includes variables, shorthand, overrides and media queries', () => {
  const root = new URL('../', import.meta.url);
  const paths = ['src/styles.css', 'src/minigames/rhythm/rhythm.css', 'src/minigames/rhythm/Game.jsx'];
  const sources = paths.map(path => ({ path, content: fs.readFileSync(new URL(path, root), 'utf8') }));
  const audit = auditSources(sources);
  assert.deepEqual(audit.issues.filter(issue => issue.file.includes('/rhythm/')), []);
  for (const rule of ['font-size: 12px', 'font: 12px Arial', '--rt-body: .5rem; font-size: var(--rt-body)', '@media (max-width: 500px) { .rt-game p { font-size: 12px; } }']) {
    const bad = auditSources([...sources, { path: 'src/minigames/rhythm/regression.css', content: rule.startsWith('@') ? rule : `.rt-game p { ${rule}; }` }]);
    assert.ok(bad.issues.some(issue => issue.file.includes('/rhythm/')), rule);
  }
});

test('component guards completion and cleans native listeners; no persistence or external assets', () => {
  const source = fs.readFileSync(new URL('../src/minigames/rhythm/Game.jsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!result \|\| state.current.sent\) return/);
  assert.match(source, /state.current.sent = true/);
  assert.match(source, /removeEventListener\('keydown'/);
  assert.match(source, /removeEventListener\('visibilitychange'/);
  assert.match(source, /cancelAnimationFrame/);
  assert.doesNotMatch(source, /localStorage|fetch\(|https?:/);
});

test('text palette keeps at least 4.5:1 contrast in paper, stage and buttons', () => {
  const luminance = hex => {
    const channels = hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  for (const [foreground, background] of [['344b40', 'fbf4e5'], ['665c47', 'fbf4e5'], ['fff9e9', '395b45'], ['fff3d6', '243d34'], ['dbe5c6', '375144'], ['283f32', 'f4d089']]) {
    const a = luminance(foreground), b = luminance(background);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${foreground} on ${background}`);
  }
});
