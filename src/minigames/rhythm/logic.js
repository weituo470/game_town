// Original, deterministic 120 BPM score. No remote music or generated randomness.
export const COUNT_IN_MS = 3000;
export const ROUND_MS = 39000;
export const TRAVEL_MS = 1800;
export const PERFECT_MS = 70;
export const GOOD_MS = 140;
export const HIT_MS = 200;
const phrases = [
  [0, 1, 2, 3, 0, 1, 2, -1],
  [3, 2, 1, 0, 3, 2, 1, -1],
  [0, 0, 1, 1, 2, 2, 3, -1],
  [0, 2, 1, 3, 0, 2, 1, -1],
  [3, 1, 2, 0, 3, 1, 2, -1],
  [0, 1, 0, 2, 1, 3, 2, -1],
  [3, 2, 3, 1, 2, 0, 1, -1],
  [0, 1, 2, 3, 2, 1, 0, -1],
  [0, 1, 2, 3],
];
export const NOTES = Object.freeze(phrases.flat().flatMap((lane, beat) => lane < 0 ? [] : [Object.freeze({ id: beat, lane, at: 4000 + beat * 500 })]));

export function judgement(errorMs) {
  const error = Math.abs(errorMs);
  if (error <= PERFECT_MS) return { label: '精准', points: 100 };
  if (error <= GOOD_MS) return { label: '合拍', points: 75 };
  if (error <= HIT_MS) return { label: '接住', points: 45 };
  return null;
}

export function createRound() {
  return { judged: {}, hits: 0, misses: 0, stray: 0, perfect: 0, combo: 0, maxCombo: 0, points: 0, errors: [], signedErrors: [], ended: false };
}

// Each note moves exactly once from unjudged to hit/missed. Expiry also runs
// before input, so a delayed render cannot resurrect an overdue note.
export function advanceRound(round, now, notes = NOTES) {
  if (round.ended) return;
  for (const note of notes) {
    if (round.judged[note.id] === undefined && now > note.at + HIT_MS) {
      round.judged[note.id] = 'miss'; round.misses++; round.combo = 0;
    }
  }
  if (now >= ROUND_MS) round.ended = true;
}

export function pressLane(round, lane, now, notes = NOTES) {
  if (round.ended || now < COUNT_IN_MS || now >= ROUND_MS || !Number.isInteger(lane) || lane < 0 || lane > 3) return null;
  advanceRound(round, now, notes);
  const note = notes.filter(n => n.lane === lane && round.judged[n.id] === undefined && Math.abs(n.at - now) <= HIT_MS)
    .sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now) || a.at - b.at)[0];
  if (!note) { round.stray++; round.combo = 0; return { label: '空按 · 等音符到线', kind: 'stray' }; }
  const error = now - note.at, result = judgement(error);
  round.judged[note.id] = result.points; round.hits++; round.points += result.points;
  round.perfect += result.points === 100 ? 1 : 0;
  round.combo++; round.maxCombo = Math.max(round.maxCombo, round.combo);
  round.errors.push(Math.abs(error)); round.signedErrors.push(error);
  return { ...result, kind: 'hit', error, noteId: note.id };
}

export function roundResult(round, durationMs, inputDevice, audioAvailable) {
  const mean = values => values.length ? Math.round(values.reduce((sum, n) => sum + n, 0) / values.length) : 0;
  const accuracy = round.hits / Math.max(1, round.hits + round.stray);
  return {
    gameId: 'rhythm', score: Math.max(0, Math.min(100, Math.round(round.points / NOTES.length * (0.7 + 0.3 * accuracy)))), completed: true,
    durationSeconds: Math.round(Math.min(ROUND_MS, Math.max(0, durationMs)) / 100) / 10,
    inputDevice, difficulty: 'standard',
    metrics: {
      notesTotal: NOTES.length, hits: round.hits, missedNotes: round.misses, strayPresses: round.stray,
      perfectHits: round.perfect, maxCombo: round.maxCombo, accuracy: Math.round(accuracy * 100),
      meanTimingErrorMs: mean(round.errors), meanSignedTimingErrorMs: mean(round.signedErrors),
      timingSamples: round.errors.length, audioAvailable, latencyCalibrated: false,
      summary: `命中 ${round.hits}/${NOTES.length} 拍，精准 ${round.perfect} 拍，最高连击 ${round.maxCombo}。设备与音画延迟可能影响本局表现。`,
    },
  };
}

// sourceNow is AudioContext.currentTime (ms), or performance.now when audio is
// unavailable. Pause never advances the accumulated timeline.
export function createTransport(sourceNow) {
  let accumulated = 0, origin = 0, running = false;
  return {
    now: () => accumulated + (running ? Math.max(0, sourceNow() - origin) : 0),
    start() { if (!running) { origin = sourceNow(); running = true; } },
    pause() { if (running) { accumulated += Math.max(0, sourceNow() - origin); running = false; } },
    get running() { return running; },
  };
}
