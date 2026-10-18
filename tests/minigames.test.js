import test from 'node:test';
import assert from 'node:assert/strict';
import { balloonScore, rhythmJudgement, pipeConnections, pipeFlow, nextPipeHint, PIPE_START, PIPE_SOLUTION, HAUNTED_MAP, HAUNTED_CLUES, HAUNTED_EXIT, RHYTHM_NOTES } from '../src/lib/minigameLogic.js';

test('balloon scoring requires real hits, caps output and penalizes misses', () => {
  assert.equal(balloonScore(0, 0), 0);
  assert.equal(balloonScore(36, 36), 100);
  assert.ok(balloonScore(12, 12) > balloonScore(12, 24));
  assert.equal(balloonScore(100, 100), 100);
});
test('rhythm boundaries are precise and symmetric', () => {
  assert.equal(rhythmJudgement(-65).points, 100);
  assert.equal(rhythmJudgement(66).points, 75);
  assert.equal(rhythmJudgement(121).points, 45);
  assert.equal(rhythmJudgement(180).points, 45);
  assert.equal(rhythmJudgement(181), null);
});
test('pipe board is initially unsolved and has deterministic valid solution', () => {
  assert.equal(pipeFlow(PIPE_START).complete, false);
  assert.equal(pipeFlow(PIPE_SOLUTION).complete, true);
  assert.equal(pipeFlow(PIPE_SOLUTION).lit.length, 8);
  assert.deepEqual(pipeConnections('straight', 1), [1, 3]);
});
test('pipe hints always advance to a valid solution', () => {
  const rotations = [...PIPE_START];
  for (let count = 0; count < 9 && !pipeFlow(rotations).complete; count++) {
    const hint = nextPipeHint(rotations);
    assert.ok(hint);
    rotations[hint.index] = (rotations[hint.index] + hint.turns) % 4;
  }
  assert.equal(pipeFlow(rotations).complete, true);
});
test('all haunted clues and exit are reachable from spawn', () => {
  const seen = new Set(['1,1']), queue = [[1, 1]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const key = `${x + dx},${y + dy}`;
      if (HAUNTED_MAP[y + dy]?.[x + dx] === '.' && !seen.has(key)) { seen.add(key); queue.push([x + dx, y + dy]); }
    }
  }
  for (const point of [...HAUNTED_CLUES, HAUNTED_EXIT]) assert.ok(seen.has(`${point.x},${point.y}`));
});
test('rhythm chart uses four lanes, unique ids and ends before round timeout', () => {
  assert.equal(new Set(RHYTHM_NOTES.map((n) => n.id)).size, 28);
  assert.equal(new Set(RHYTHM_NOTES.map((n) => n.lane)).size, 4);
  assert.ok(RHYTHM_NOTES.at(-1).at + 180 < 22000);
});
