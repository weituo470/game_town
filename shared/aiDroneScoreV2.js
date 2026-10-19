import { AiDroneScoreError } from './aiDroneScore.js';

export const AI_DRONE_V2_IDS = Object.freeze(['hero', 'companion', 'world', 'spark']);
export const AI_DRONE_V2_KINDS = Object.freeze(['whale', 'phoenix', 'dragon', 'lantern', 'lotus', 'butterfly', 'city', 'planet', 'portal', 'comet', 'tree']);
export const AI_DRONE_V2_LAYOUTS = Object.freeze(['hero', 'duet', 'trio', 'procession', 'orbit']);
export const AI_DRONE_V2_CAMERAS = Object.freeze(['wide', 'push', 'orbit', 'rise']);
export const AI_DRONE_V2_EFFECTS = Object.freeze(['none', 'peony', 'willow', 'crown']);
export const AI_DRONE_V2_MOTIONS = Object.freeze(['float', 'swim', 'flap', 'orbit', 'ascend', 'dive']);
export const AI_DRONE_V2_TRANSITIONS = Object.freeze(['morph', 'sweep', 'burst']);
export const AI_DRONE_V2_CHOICE_FIELDS = Object.freeze(['id', 'kind', 'layout', 'camera', 'effect', 'motion', 'transition']);
export const AI_DRONE_V2_LIMITS = Object.freeze({ bytes: 32768, title: 48, synopsis: 240, sceneName: 32, description: 160,
  minCast: 2, maxCast: 4, minScenes: 4, maxScenes: 6, minDuration: 10, maxDuration: 18, maxBodyDuration: 92,
  minScale: .55, maxScale: 1.15, maxSeed: 2147483647 });
const ROOT = ['version', 'title', 'synopsis', 'seed', 'cast', 'scenes'];
const CAST = ['id', 'kind', 'color', 'accent'];
const SCENE = ['name', 'description', 'duration', 'layout', 'camera', 'effect', 'transition', 'actors'];
const ACTOR = ['id', 'motion', 'scale'];
const CONTROL = /[\u0000-\u001f\u007f]/u;
const encoder = new TextEncoder(), accepted = new WeakSet();
const fail = (code, message) => { throw new AiDroneScoreError(code, message); };
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('AI_SCORE_FORMAT', '演出数据必须是纯 JSON 对象。');
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) fail('AI_SCORE_FIELDS', '演出包含未支持的字段或缺少必要内容。');
  if (actual.some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail('AI_SCORE_FORMAT', '演出数据不能包含访问器。');
}
function array(value, min, max, code) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) fail(code, '演出数组数量超出允许范围。');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) fail('AI_SCORE_FORMAT', '演出数组必须是连续的纯 JSON 数组。');
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(index)) || {}, 'value')) fail('AI_SCORE_FORMAT', '演出数组不能包含空位或访问器。');
}
function text(value, max) {
  if (typeof value !== 'string' || CONTROL.test(value) || !value.trim() || Array.from(value.trim()).length > max) fail('AI_SCORE_TEXT', '演出文字须为长度合规的非空单行普通文字。');
  return value.trim();
}
function choice(value, options, field, sceneIndex) {
  if (!options.includes(value)) {
    const error = new AiDroneScoreError('AI_SCORE_CHOICE', '编排选项不在当前支持范围内。');
    error.field = field;
    if (Number.isInteger(sceneIndex)) error.sceneIndex = sceneIndex;
    throw error;
  }
  return value;
}
function color(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('AI_SCORE_COLOR', '灯光颜色必须使用六位十六进制色值。');
  return value.toUpperCase();
}

/** Data-only V2: no arbitrary transforms, paths, point clouds, resources or code. */
export function validateAiDroneScoreV2(raw) {
  if (raw && typeof raw === 'object' && accepted.has(raw)) return raw;
  let value = raw;
  if (typeof value === 'string') {
    if (encoder.encode(value).byteLength > AI_DRONE_V2_LIMITS.bytes) fail('AI_SCORE_TOO_LARGE', '演出数据超过 32 KiB。');
    try { value = JSON.parse(value); } catch { fail('AI_SCORE_JSON', '演出不是有效 JSON。'); }
  }
  object(value, ROOT);
  if (value.version !== 2) fail('AI_SCORE_VERSION', '暂不支持这个演出版本。');
  if (!Number.isSafeInteger(value.seed) || value.seed < 1 || value.seed > AI_DRONE_V2_LIMITS.maxSeed) fail('AI_SCORE_SEED', '演出随机种子无效。');
  array(value.cast, 2, 4, 'AI_SCORE_CAST');
  const castIds = new Set();
  const cast = value.cast.map(item => {
    object(item, CAST);
    const id = choice(item.id, AI_DRONE_V2_IDS, 'id');
    if (castIds.has(id)) fail('AI_SCORE_CAST', '角色编号不能重复。');
    castIds.add(id);
    return Object.freeze({ id, kind: choice(item.kind, AI_DRONE_V2_KINDS, 'kind'), color: color(item.color), accent: color(item.accent) });
  });
  if (!castIds.has('hero')) fail('AI_SCORE_CAST', '演出必须有主角 hero。');
  array(value.scenes, 4, 6, 'AI_SCORE_SCENES');
  const used = new Set(), motions = new Set();
  let total = 0, ensemble = 0, fireworks = 0, heroRun = 0, maxHeroRun = 0;
  const scenes = value.scenes.map((scene, index) => {
    object(scene, SCENE);
    if (!Number.isInteger(scene.duration) || scene.duration < 10 || scene.duration > 18) fail('AI_SCORE_DURATION', '每幕时长需要为 10–18 秒的整数。');
    total += scene.duration;
    const layout = choice(scene.layout, AI_DRONE_V2_LAYOUTS, 'layout', index);
    array(scene.actors, 1, 4, 'AI_SCORE_ACTORS');
    const length = scene.actors.length;
    if ((layout === 'hero' && length !== 1) || (layout === 'duet' && length !== 2) || (layout === 'trio' && length !== 3) || (['procession', 'orbit'].includes(layout) && length < 2)) fail('AI_SCORE_LAYOUT', '构图与场内角色数量不匹配。');
    const ids = new Set();
    const actors = scene.actors.map(actor => {
      object(actor, ACTOR);
      const id = choice(actor.id, AI_DRONE_V2_IDS, 'id', index);
      if (!castIds.has(id) || ids.has(id)) fail('AI_SCORE_ACTORS', '场内角色必须已定义，且每幕不能重复。');
      ids.add(id); used.add(id);
      const motion = choice(actor.motion, AI_DRONE_V2_MOTIONS, 'motion', index); motions.add(motion);
      if (typeof actor.scale !== 'number' || !Number.isFinite(actor.scale) || actor.scale < .55 || actor.scale > 1.15) fail('AI_SCORE_SCALE', '角色比例必须是 0.55–1.15 之间的有限数值。');
      return Object.freeze({ id, motion, scale: actor.scale });
    });
    if (length > 1) ensemble++;
    heroRun = ids.has('hero') ? heroRun + 1 : 0; maxHeroRun = Math.max(maxHeroRun, heroRun);
    const effect = choice(scene.effect, AI_DRONE_V2_EFFECTS, 'effect', index);
    if (effect !== 'none') fireworks++;
    return Object.freeze({ name: text(scene.name, 32), description: text(scene.description, 160), duration: scene.duration, layout,
      camera: choice(scene.camera, AI_DRONE_V2_CAMERAS, 'camera', index), effect,
      transition: choice(scene.transition, AI_DRONE_V2_TRANSITIONS, 'transition', index), actors: Object.freeze(actors) });
  });
  if (total > 92) fail('AI_SCORE_DURATION', '正文总时长不能超过 92 秒，请为起飞与归航留出时间。');
  const brightEnough = cast.every(actor => [actor.color, actor.accent].some(value => [1, 3, 5].some(offset => parseInt(value.slice(offset, offset + 2), 16) >= 112)));
  if (!brightEnough || new Set(scenes.map(scene => scene.layout)).size < 2 || new Set(scenes.map(scene => scene.camera)).size < 2 || motions.size < 2 || ensemble < 2 || fireworks < 1 || fireworks > 3 || maxHeroRun < 2 || used.size !== cast.length) {
    fail('AI_SCORE_QUALITY', '编排需要多层构图、镜头与动作变化、两幕以上群像、1–3 幕烟花，并让主角连续出场和全部角色参与故事。');
  }
  const result = Object.freeze({ version: 2, title: text(value.title, 48), synopsis: text(value.synopsis, 240), seed: value.seed, cast: Object.freeze(cast), scenes: Object.freeze(scenes) });
  // All descriptors and leaf types are now verified; serialization cannot invoke
  // a user toJSON/getter. Count input whitespace too, not just the trimmed copy.
  if (encoder.encode(JSON.stringify(value)).byteLength > AI_DRONE_V2_LIMITS.bytes) fail('AI_SCORE_TOO_LARGE', '演出数据超过 32 KiB。');
  accepted.add(result); return result;
}
