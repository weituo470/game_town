// The architect can select a surveyed site, never provide world coordinates.
// This module deliberately does not import world.js (collision uses it too).
export const ARCHITECT_PLAN_VERSION = 1;
export const ARCHITECT_BUILDING_BOUNDS = Object.freeze({ halfWidth: 2, halfDepth: 2, height: 7.5 });
export const ARCHITECT_KINDS = Object.freeze(['pavilion', 'greenhouse', 'reading_room', 'art_gallery', 'observatory', 'clocktower']);
export const ARCHITECT_PALETTES = Object.freeze({
  coastal: Object.freeze({ wall: '#E7EEE8', roof: '#507F91', trim: '#E6B35F', glass: '#90CED6' }),
  sage: Object.freeze({ wall: '#E7E5D4', roof: '#627C63', trim: '#CBA46A', glass: '#A7D3C0' }),
  sand: Object.freeze({ wall: '#EBDCC0', roof: '#9D7055', trim: '#D6AE68', glass: '#9DC8CB' }),
  rose: Object.freeze({ wall: '#EEDDD8', roof: '#A2717C', trim: '#D7B477', glass: '#B2CEDD' }),
  midnight: Object.freeze({ wall: '#B7C6D1', roof: '#435D78', trim: '#E1BF75', glass: '#8EC7D9' }),
});
// These sites were checked against all original streets, landmarks, trees,
// lamp posts, the hop course and each resident's complete route, not just homes.
export const ARCHITECT_PLOTS = Object.freeze([
  ['plot-1-1', -31.25, -33, '西北角'], ['plot-1-4', 31.25, -33, '东北角'],
  ['plot-2-4', 31.25, -18.5, '东林北侧'], ['plot-3-1', -31.25, -7, '西园北侧'],
  ['plot-3-4', 31.25, -7, '东林中段'], ['plot-4-1', -31.25, 9.5, '西园中段'],
  ['plot-5-2', -13.5, 21.5, '南环西侧'], ['plot-5-4', 31.25, 21.5, '东林南侧'],
  ['plot-6-1', -31.25, 35.75, '南岸西角'], ['plot-6-2', -13.5, 35.75, '南岸西段'],
  ['plot-6-3', 13.5, 35.75, '南岸东段'], ['plot-6-4', 31.25, 35.75, '南岸东角'],
].map(([id, x, z, label]) => Object.freeze({ id, x, z, label })));
const KEYS = ['version', 'name', 'description', 'plotId', 'kind', 'palette', 'orientation'];
const UNSAFE = /[\p{Cc}\p{Cf}<>`]|(?:https?:|data:|javascript:|www\.)/iu;
const exactObject = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max) => typeof value === 'string' && value === value.trim() &&
  Array.from(value).length >= 1 && Array.from(value).length <= max && !UNSAFE.test(value);
export class ArchitectPlanError extends Error {
  constructor() { super('建筑方案未通过安全校验，未进行建设。'); this.name = 'ArchitectPlanError'; this.code = 'ARCHITECT_INVALID_PLAN'; }
}
export function validateArchitectPlan(value, { availablePlotIds } = {}) {
  if (!exactObject(value, KEYS) || value.version !== ARCHITECT_PLAN_VERSION ||
      !text(value.name, 24) || !text(value.description, 180) ||
      !ARCHITECT_KINDS.includes(value.kind) || !Object.hasOwn(ARCHITECT_PALETTES, value.palette) ||
      ![0, 90, 180, 270].includes(value.orientation) || Object.is(value.orientation, -0) ||
      !ARCHITECT_PLOTS.some(plot => plot.id === value.plotId) ||
      (availablePlotIds && !availablePlotIds.includes(value.plotId))) throw new ArchitectPlanError();
  return Object.freeze(Object.fromEntries(KEYS.map(key => [key, value[key]])));
}
export function architectPlot(id) { return ARCHITECT_PLOTS.find(plot => plot.id === id) || null; }

