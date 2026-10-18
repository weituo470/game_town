export const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));

export function balloonScore(hits, shots) {
  if (!shots) return 0;
  return clampScore((hits / shots) * 50 + Math.min(1, hits / 36) * 50);
}

export function rhythmJudgement(errorMs) {
  const error = Math.abs(errorMs);
  if (error <= 65) return { label: '完美', points: 100 };
  if (error <= 120) return { label: '很好', points: 75 };
  if (error <= 180) return { label: '命中', points: 45 };
  return null;
}

// Directions clockwise: north, east, south, west.
export const PIPE_TYPES = ['straight', 'elbow', 'elbow', 'elbow', 'elbow', 'elbow', 'elbow', 'straight', 'elbow'];
export const PIPE_START = [0, 0, 1, 2, 1, 3, 2, 0, 1];
export const PIPE_SOLUTION = [1, 2, 1, 1, 3, 1, 0, 1, 3];
export const PIPE_ROUTE = [0, 1, 4, 3, 6, 7, 8, 5];

export function pipeConnections(type, rotation) {
  return (type === 'straight' ? [0, 2] : [0, 1]).map((n) => (n + rotation) % 4);
}

export function pipeFlow(rotations) {
  if (!pipeConnections(PIPE_TYPES[0], rotations[0]).includes(3)) return { lit: [], complete: false };
  const lit = [], queue = [0], seen = new Set();
  while (queue.length) {
    const tile = queue.shift();
    if (seen.has(tile)) continue;
    seen.add(tile); lit.push(tile);
    const x = tile % 3, y = Math.floor(tile / 3);
    for (const direction of pipeConnections(PIPE_TYPES[tile], rotations[tile])) {
      const nx = x + [0, 1, 0, -1][direction], ny = y + [-1, 0, 1, 0][direction];
      if (nx < 0 || nx > 2 || ny < 0 || ny > 2) continue;
      const neighbour = ny * 3 + nx;
      if (pipeConnections(PIPE_TYPES[neighbour], rotations[neighbour]).includes((direction + 2) % 4)) queue.push(neighbour);
    }
  }
  return { lit, complete: seen.has(5) && pipeConnections(PIPE_TYPES[5], rotations[5]).includes(1) };
}

export function nextPipeHint(rotations) {
  for (const index of PIPE_ROUTE) {
    const target = pipeConnections(PIPE_TYPES[index], PIPE_SOLUTION[index]);
    if (!target.every((d) => pipeConnections(PIPE_TYPES[index], rotations[index]).includes(d))) {
      let turns = 1;
      while (turns < 4 && !target.every((d) => pipeConnections(PIPE_TYPES[index], rotations[index] + turns).includes(d))) turns++;
      return { index, turns };
    }
  }
  return null;
}

export const HAUNTED_MAP = ['#########', '#...#...#', '#.#.#.#.#', '#.#...#.#', '#...#...#', '#.....#.#', '#########'];
export const HAUNTED_CLUES = [{ x: 7, y: 1 }, { x: 5, y: 3 }, { x: 1, y: 5 }];
export const HAUNTED_EXIT = { x: 7, y: 5 };
export const RHYTHM_NOTES = Array.from({ length: 28 }, (_, id) => ({ id, lane: [0, 1, 2, 3, 1, 0, 3, 2, 0, 2, 1, 3, 2, 1][id % 14], at: 2000 + id * 650 }));
