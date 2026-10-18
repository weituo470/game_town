// Original, deterministic map. # is a solid wall; doors are ordinary walkable
// cells. The garden gate only settles a round after all three letters are found.
export const MAP = [
  '#############',
  '#...#.......#',
  '#.#.#.###.#.#',
  '#.#...#...#.#',
  '#.#####.###.#',
  '#.....#.....#',
  '###.#.#####.#',
  '#...#.......#',
  '#.#######.#.#',
  '#.........#.#',
  '#############',
];
export const START = { x: 1, y: 1 };
export const EXIT = { x: 11, y: 9 };
export const CLUES = [
  { id: 'letter', x: 3, y: 5, name: '玄关的来信', room: '藤蔓玄关', symbol: 'letter', text: '“今晚不必赶路。把灯留给最后一位回家的人。”信封里夹着一片金色银杏叶。原来，窗边的光一直有人照看。' },
  { id: 'photo', x: 9, y: 1, name: '书房的合照', room: '月光书房', symbol: 'photo', text: '照片背面写着：“我们约好，在花园里再见。”三位老朋友举着同样的月灯。你轻轻拂去灰尘，远处传来一声木屋的轻响。' },
  { id: 'key', x: 7, y: 9, name: '温室的铜钥匙', room: '晚香温室', symbol: 'key', text: '铜钥匙挂着月牙吊牌：“给愿意为朋友留灯的人。”吊牌背面画着一封信、一张合照。凑齐三件旧物，就能带着这个约定打开花园门。' },
];
export const OPTIONAL = [
  { id: 'cat', x: 1, y: 7, name: '窗边的猫', text: '一只纸做的小猫坐在窗台。它的尾巴被风轻轻拨动。窗外没有追赶你的东西，只有晚风。' },
  { id: 'clock', x: 9, y: 3, name: '停摆的旧钟', text: '旧钟停在九点十五分。钟旁的小纸条说：“故事没有截止时间。”你可以按自己的步子走。' },
];
export const DIRECTIONS = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] };
export const pointKey = ({ x, y }) => `${x},${y}`;
export const walkable = (x, y) => MAP[y]?.[x] !== undefined && MAP[y][x] !== '#';
export function initialState() {
  return { position: { ...START }, facing: [0, 1], collected: [], explored: [], visited: [pointKey(START)], steps: 0, completed: false };
}
export function movePlayer(state, dx, dy) {
  if (state.completed || Math.abs(dx) + Math.abs(dy) !== 1) return state;
  const x = state.position.x + dx, y = state.position.y + dy;
  if (!walkable(x, y)) return { ...state, facing: [dx, dy] };
  const visited = new Set([...state.visited, `${x},${y}`]);
  return { ...state, position: { x, y }, facing: [dx, dy], steps: state.steps + 1, visited: [...visited] };
}
export function nearbyItem(state) {
  return [...CLUES, ...OPTIONAL].find(item => item.x === state.position.x && item.y === state.position.y && ![...state.collected, ...state.explored].includes(item.id));
}
export function inspectItem(state) {
  const item = nearbyItem(state);
  if (!item) return { state, item: null };
  const key = CLUES.some(clue => clue.id === item.id) ? 'collected' : 'explored';
  return { state: { ...state, [key]: [...state[key], item.id] }, item };
}
export const atExit = state => pointKey(state.position) === pointKey(EXIT);
export const canFinish = state => atExit(state) && state.collected.length === CLUES.length && !state.completed;
export function shortestPath(start, goal) {
  const queue = [{ ...start, path: [] }], seen = new Set([pointKey(start)]);
  for (let n = 0; n < queue.length; n++) {
    const current = queue[n];
    if (pointKey(current) === pointKey(goal)) return current.path;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const x = current.x + dx, y = current.y + dy, key = `${x},${y}`;
      if (walkable(x, y) && !seen.has(key)) { seen.add(key); queue.push({ x, y, path: [...current.path, [dx, dy]] }); }
    }
  }
  return null;
}
export function nextGoal(state) {
  const remaining = CLUES.filter(item => !state.collected.includes(item.id));
  return remaining.sort((a, b) => shortestPath(state.position, a).length - shortestPath(state.position, b).length)[0] || { ...EXIT, name: '花园出口', id: 'exit' };
}
export function resultFor(state, seconds, device) {
  if (!canFinish(state)) return null;
  return { gameId: 'haunted', completed: true, score: 100, difficulty: 'standard', inputDevice: device === 'touch' ? 'touch' : 'keyboard-mouse', durationSeconds: Math.max(0.1, Math.round(seconds * 10) / 10), metrics: {
    cluesFound: state.collected.length, cluesTotal: CLUES.length, validSteps: state.steps,
    uniqueTiles: state.visited.length, optionalExplored: state.explored.length, optionalTotal: OPTIONAL.length,
    exitReached: true, gentleMode: true, summary: `找到 3 件线索，走出月灯旧宅；探索了 ${state.explored.length} 处可选小故事。`,
  } };
}
// Clock used by the UI and unit tests. Only explicitly running time accumulates.
export function createActiveClock(now = () => performance.now()) {
  let total = 0, since = null;
  return {
    start() { if (since === null) since = now(); },
    stop() { if (since !== null) { total += Math.max(0, now() - since); since = null; } },
    seconds() { return (total + (since === null ? 0 : Math.max(0, now() - since))) / 1000; },
    reset() { total = 0; since = null; },
  };
}
