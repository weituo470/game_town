// Original five camera compositions from the user-supplied DeepSeek park.
export const DEEPSEEK_VIEWS = Object.freeze([
  { id: 'gate', name: '入口牌楼', position: [0, 36, 118], target: [0, 7, 8] },
  { id: 'whale', name: '鲸园', position: [47, 27, 57], target: [0, 11, 0] },
  { id: 'towers', name: '六座专家塔', position: [-44, 30, -8], target: [0, 9, 0] },
  { id: 'layers', name: '层析塔', position: [24, 15, -56], target: [0, 7, -32] },
  { id: 'sky', name: '全园鸟瞰', position: [0, 112, 112], target: [0, 0, 4] },
].map(item => Object.freeze({ ...item, position: Object.freeze(item.position), target: Object.freeze(item.target) })));
export const deepSeekView = id => DEEPSEEK_VIEWS.find(item => item.id === id) || DEEPSEEK_VIEWS[1];
