export const GPT_DESIGNS = Object.freeze([
  Object.freeze({ id: 'garden', code: 'A', name: '翡翠花园', en: 'EMERALD GARDEN', tagline: '六瓣灵感，在水光与花园之间交织。', accent: '#84f5cb', muted: '#c1dcd4', dark: '#071c24', dawn: '#91b9b7', sea: '#103c42', light: '#5af5c4', position: [23, 12, 29], target: [0, 4.3, -1] }),
  Object.freeze({ id: 'orbit', code: 'B', name: '星环圣殿', en: 'ORBITAL SANCTUM', tagline: '三重星环，拱卫一枚悬浮在宇宙中的思想印记。', accent: '#a6e7ff', muted: '#c4dbe8', dark: '#050e1b', dawn: '#728fa4', sea: '#0b1b30', light: '#9bdfff', position: [30, 18, 38], target: [0, 6, 0] }),
  Object.freeze({ id: 'citadel', code: 'C', name: '光之城', en: 'LUMINOUS CITADEL', tagline: '白金穹顶向天空展开，思想在光的城市里生长。', accent: '#f3d6a1', muted: '#e5dccb', dark: '#16232b', dawn: '#b2c7c7', sea: '#36616b', light: '#ffdaa5', position: [29, 17, 37], target: [0, 5.5, 0] }),
]);
export function gptDesign(id) { return GPT_DESIGNS.find(item => item.id === id) || GPT_DESIGNS[0]; }
export function designCamera(designId, view) {
  const design = gptDesign(designId);
  if (view.id === 'heart') return { position: design.position, target: design.target };
  if (design.id === 'garden') return { position: view.position, target: view.target };
  if (view.id === 'aerial') return { position: [1, 52, 39], target: [0, 3, 0] };
  return { position: [view.position[0] * 1.2, view.position[1] + 5, view.position[2] * 1.2], target: [view.target[0], view.target[1] + 3, view.target[2]] };
}
