// Local, artistic park viewpoints. These do not call a model or emulate AI services.
export const GPT_VIEWS = Object.freeze([
  { id: 'heart', number: '01', name: '灵感之环', en: 'THE INFINITY GARDEN', description: '六道灵感，交织成一个无限可能的世界。', position: [23, 12, 29], target: [0, 4.3, -1] },
  { id: 'create', number: '02', name: '创作花园', en: 'IMAGINATION IN BLOOM', description: '让想象开花。沿着旋转的花瓣，发现新的视角。', position: [-21, 11, 19], target: [-10, 2.8, 6] },
  { id: 'code', number: '03', name: '代码之门', en: 'BUILD SOMETHING NEW', description: '穿过秩序与几何构成的门，下一种可能由你创造。', position: [22, 11, 18], target: [10, 3, 6] },
  { id: 'voice', number: '04', name: '共鸣剧场', en: 'EVERY VOICE MATTERS', description: '把声音想象成光，看节奏在空中生长。', position: [-22, 11, -18], target: [-10, 3, -8] },
  { id: 'explore', number: '05', name: '探索星台', en: 'BEYOND THE HORIZON', description: '环绕一颗小小星球，把好奇心投向更远处。', position: [23, 13, -20], target: [10, 3, -8] },
  { id: 'aerial', number: '06', name: '全园鸟瞰', en: 'A WORLD OF POSSIBILITIES', description: '一座岛，四个灵感分区。每条路都通往新的发现。', position: [1, 43, 33], target: [0, 0, -1] },
]);
export function nextGptView(id) { return GPT_VIEWS[(GPT_VIEWS.findIndex(v => v.id === id) + 1) % GPT_VIEWS.length].id; }
export function gptView(id) { return GPT_VIEWS.find(v => v.id === id) || GPT_VIEWS[0]; }
