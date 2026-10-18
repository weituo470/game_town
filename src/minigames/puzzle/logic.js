// Directions are clockwise: north, east, south, west. No browser dependencies.
export const HINT_LIMIT = 3;
export const LEVELS = Object.freeze([
  Object.freeze({
    id: 'garden-bend', title: '第一站 · 花园小径',
    guide: '先转动左上角，让进水口朝左；沿蓝色水路，把水送到右下角。',
    types: Object.freeze(['straight', 'elbow', 'straight', 'elbow', 'elbow', 'elbow', 'straight', 'elbow', 'elbow']),
    initial: Object.freeze([0, 1, 0, 1, 3, 1, 0, 2, 3]),
    solution: Object.freeze([1, 2, 0, 1, 0, 2, 0, 2, 0]),
    route: Object.freeze([0, 1, 4, 5, 8]),
  }),
  Object.freeze({
    id: 'garden-detour', title: '第二站 · 绕过花坛',
    guide: '这次先向下，再绕回上方。只要接通进水与花园，不必用上所有管道。',
    types: Object.freeze(['elbow', 'elbow', 'elbow', 'elbow', 'elbow', 'straight', 'straight', 'elbow', 'elbow']),
    initial: Object.freeze([1, 0, 1, 3, 2, 1, 0, 2, 3]),
    solution: Object.freeze([2, 1, 2, 0, 3, 0, 0, 2, 0]),
    route: Object.freeze([0, 3, 4, 1, 2, 5, 8]),
  }),
]);

export function connections(type, rotation) {
  return (type === 'straight' ? [0, 2] : [0, 1]).map(d => (d + rotation) % 4);
}

export function waterFlow(level, rotations) {
  const lit = [], seen = new Set(), queue = [];
  if (connections(level.types[0], rotations[0]).includes(3)) queue.push(0);
  while (queue.length) {
    const index = queue.shift();
    if (seen.has(index)) continue;
    seen.add(index); lit.push(index);
    for (const d of connections(level.types[index], rotations[index])) {
      const x = index % 3 + [0, 1, 0, -1][d];
      const y = Math.floor(index / 3) + [-1, 0, 1, 0][d];
      if (x < 0 || x > 2 || y < 0 || y > 2) continue;
      const next = y * 3 + x;
      if (connections(level.types[next], rotations[next]).includes((d + 2) % 4)) queue.push(next);
    }
  }
  return { lit, complete: seen.has(8) && connections(level.types[8], rotations[8]).includes(1) };
}

export function nextHint(level, rotations) {
  if (waterFlow(level, rotations).complete) return null;
  for (const index of level.route) {
    const target = connections(level.types[index], level.solution[index]);
    for (let turns = 0; turns < 4; turns++) {
      if (target.every(d => connections(level.types[index], rotations[index] + turns).includes(d))) {
        if (turns) return { index, turns };
        break;
      }
    }
  }
  return null;
}

export function initialRound() {
  return { phase: 'intro', level: 0, board: [...LEVELS[0].initial], history: [],
    rotations: 0, hintsUsed: 0, levelHints: 0, undos: 0, resets: 0,
    levelsSolved: 0, highlight: null, message: LEVELS[0].guide };
}

// All game mutations pass here so rapid input, undo and hints share one truth.
export function roundReducer(state, action) {
  const level = LEVELS[state.level];
  if (action.type === 'replay') return { ...initialRound(), phase: 'playing' };
  if (action.type === 'start' && state.phase === 'intro') return { ...state, phase: 'playing' };
  if (action.type === 'next' && state.phase === 'solved' && state.level < LEVELS.length - 1) {
    const next = LEVELS[state.level + 1];
    return { ...state, phase: 'playing', level: state.level + 1, board: [...next.initial], history: [], levelHints: 0, highlight: null, message: next.guide };
  }
  if (state.phase !== 'playing') return state;
  if (action.type === 'rotate') {
    const index = action.index;
    if (!Number.isInteger(index) || index < 0 || index > 8) return state;
    const board = state.board.map((r, i) => i === index ? (r + 1) % 4 : r);
    const flow = waterFlow(level, board);
    return { ...state, board, history: [...state.history, state.board], rotations: state.rotations + 1,
      highlight: null, phase: flow.complete ? 'solved' : 'playing', levelsSolved: state.levelsSolved + Number(flow.complete),
      message: flow.complete ? '水到花园了！这条水路已经接通。' : flow.lit.length ? `水已流过 ${flow.lit.length} 块管道。沿着蓝色水路继续接。` : '还没接上进水口：左上角的管道需要有一个开口朝左。' };
  }
  if (action.type === 'undo' && state.history.length) {
    return { ...state, board: state.history.at(-1), history: state.history.slice(0, -1), undos: state.undos + 1, highlight: null, message: '已撤销上一次旋转。可以换个方向试试。' };
  }
  if (action.type === 'reset') {
    return { ...state, board: [...level.initial], history: [], resets: state.resets + 1, highlight: null, message: '本关已重置，提示次数保留。慢慢来，没有倒计时。' };
  }
  if (action.type === 'hint' && state.levelHints < HINT_LIMIT && !state.highlight) {
    const hint = nextHint(level, state.board);
    if (!hint) return state;
    return { ...state, hintsUsed: state.hintsUsed + 1, levelHints: state.levelHints + 1, highlight: hint,
      message: `提示：第 ${Math.floor(hint.index / 3) + 1} 行第 ${hint.index % 3 + 1} 列，顺时针转 ${hint.turns} 次。虚线框已标出。` };
  }
  return state;
}

export function buildResult(state, durationSeconds, inputDevice) {
  if (state.phase !== 'solved' || state.levelsSolved !== LEVELS.length) return null;
  // No time penalty: this is a record of this puzzle, never a general ability score.
  const score = Math.max(70, 100 - state.hintsUsed * 3 - Math.min(18, Math.max(0, state.rotations - 28)));
  return { gameId: 'puzzle', score, completed: true,
    metrics: { puzzleSolved: true, levelsSolved: state.levelsSolved, levelsTotal: LEVELS.length,
      rotations: state.rotations, hintsUsed: state.hintsUsed, undos: state.undos, resets: state.resets,
      connectedTiles: waterFlow(LEVELS[state.level], state.board).lit.length,
      summary: `接通 ${state.levelsSolved} 条花园水路，旋转 ${state.rotations} 次，使用 ${state.hintsUsed} 次提示。` },
    durationSeconds: Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds * 10) / 10) : 0,
    inputDevice: inputDevice === 'touch' ? 'touch' : 'keyboard-mouse', difficulty: 'standard' };
}

export function completionGate() {
  let sent = false;
  return (result, callback) => {
    if (!result || sent) return false;
    sent = true; callback?.(result); return true;
  };
}

// Injected monotonic time makes pause/blur/unmount behavior independently testable.
export function activeClock(now = () => performance.now()) {
  let total = 0, since = null;
  return {
    resume() { if (since === null) since = now(); },
    pause() { if (since !== null) { total += Math.max(0, now() - since); since = null; } },
    seconds() { return (total + (since === null ? 0 : Math.max(0, now() - since))) / 1000; },
    reset() { total = 0; since = null; },
  };
}
