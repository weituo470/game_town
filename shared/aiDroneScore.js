import { validateAiDroneScoreV2 } from './aiDroneScoreV2.js';

/** Versioned data only: model output never becomes JavaScript or a remote URL. */
export const AI_DRONE_SHAPES = Object.freeze(['ring', 'sphere', 'heart', 'star', 'galaxy', 'helix', 'flower', 'bird', 'whale', 'mountain', 'city', 'outline']);
export const AI_DRONE_MOTIONS = Object.freeze(['still', 'turn', 'breathe', 'wave']);
export const AI_DRONE_TRANSITIONS = Object.freeze(['morph', 'sweep', 'burst']);
export const AI_DRONE_CHOICE_FIELDS = Object.freeze(['shape', 'motion', 'transition']);
export const AI_DRONE_LIMITS = Object.freeze({ bytes: 32768, title: 48, synopsis: 240, sceneName: 32, description: 160, minScenes: 4, maxScenes: 7, minDuration: 8, maxDuration: 18, maxPaths: 6, maxPathPoints: 24, maxPoints: 120, maxSeed: 2147483647 });
const accepted = new WeakSet();
const ROOT_KEYS = ['version', 'title', 'synopsis', 'seed', 'scenes'];
const SCENE_KEYS = ['name', 'description', 'shape', 'color', 'accent', 'duration', 'motion', 'transition', 'paths'];
const CONTROL = /[\u0000-\u001f\u007f]/u;
const encoder = new TextEncoder();

export class AiDroneScoreError extends Error {
  constructor(code, message) { super(message); this.name = 'AiDroneScoreError'; this.code = code; this.status = 422; }
}
const fail = (code, message) => { throw new AiDroneScoreError(code, message); };
function object(value, allowed, required) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('AI_SCORE_FORMAT', '演出数据格式不正确，请重新生成。');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail('AI_SCORE_FIELDS', '演出包含未支持的字段或缺少必要内容。');
  if (keys.some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail('AI_SCORE_FORMAT', '演出数据必须是纯 JSON。');
}
function text(value, maximum, label) {
  if (typeof value !== 'string' || CONTROL.test(value)) fail('AI_SCORE_TEXT', `${label}需要使用普通文字。`);
  const result = value.trim();
  if (!result || Array.from(result).length > maximum) fail('AI_SCORE_TEXT', `${label}为空或超过长度限制。`);
  return result;
}
function choice(value, choices, label, field, sceneIndex) {
  if (!choices.includes(value)) {
    const error = new AiDroneScoreError('AI_SCORE_CHOICE', `${label}不在当前支持范围内。`);
    // These identifiers come only from the fixed validation call sites, never
    // from model values, paths or error text.
    error.field = field;
    error.sceneIndex = sceneIndex;
    throw error;
  }
  return value;
}
function color(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('AI_SCORE_COLOR', '灯光颜色必须使用六位十六进制色值。');
  return value.toUpperCase();
}
function dense(value) { return Array.isArray(value) && Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean); }
function outline(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > AI_DRONE_LIMITS.maxPaths || !dense(paths)) fail('AI_SCORE_OUTLINE', '轮廓需要包含 1–6 条折线。');
  let total = 0, length = 0;
  const result = paths.map(path => {
    if (!Array.isArray(path) || path.length < 2 || path.length > AI_DRONE_LIMITS.maxPathPoints || !dense(path)) fail('AI_SCORE_OUTLINE', '每条轮廓需要包含 2–24 个点。');
    total += path.length;
    if (total > AI_DRONE_LIMITS.maxPoints) fail('AI_SCORE_OUTLINE', '轮廓点总数不能超过 120 个。');
    const points = path.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || !dense(point) || point.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < -1 || n > 1)) fail('AI_SCORE_OUTLINE', '轮廓坐标必须是 -1 到 1 之间的二维数值。');
      return Object.freeze([...point]);
    });
    let pathLength = 0;
    for (let i = 1; i < points.length; i++) pathLength += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (pathLength < 0.02) fail('AI_SCORE_OUTLINE', '轮廓不能退化为单个亮点。');
    length += pathLength;
    return Object.freeze(points);
  });
  if (length < 0.06) fail('AI_SCORE_OUTLINE', '轮廓太小，请使用清晰可见的线条。');
  return Object.freeze(result);
}

/** Accept a JSON string or plain JSON object, return an owned, deeply frozen copy. */
export function validateAiDroneScore(raw) {
  if (raw && typeof raw === 'object' && accepted.has(raw)) return raw;
  let value = raw;
  if (typeof value === 'string') {
    if (encoder.encode(value).byteLength > AI_DRONE_LIMITS.bytes) fail('AI_SCORE_TOO_LARGE', '演出数据超过 32 KiB，请精简内容。');
    try { value = JSON.parse(value); } catch { fail('AI_SCORE_JSON', '演出不是有效 JSON，请重新生成。'); }
  }
  // Inspect the data descriptor without executing an untrusted version getter.
  const versionField = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'version') : null;
  if (versionField && !Object.hasOwn(versionField, 'value')) fail('AI_SCORE_FORMAT', '演出数据必须是纯 JSON。');
  if (versionField?.value === 2) return validateAiDroneScoreV2(value);
  object(value, ROOT_KEYS, ROOT_KEYS);
  if (value.version !== 1) fail('AI_SCORE_VERSION', '暂不支持这个演出版本。');
  if (!Number.isInteger(value.seed) || value.seed < 1 || value.seed > AI_DRONE_LIMITS.maxSeed) fail('AI_SCORE_SEED', '演出随机种子无效。');
  if (!Array.isArray(value.scenes) || value.scenes.length < AI_DRONE_LIMITS.minScenes || value.scenes.length > AI_DRONE_LIMITS.maxScenes || !dense(value.scenes)) fail('AI_SCORE_SCENES', '演出需要包含 4–7 个章节。');
  const scenes = value.scenes.map((scene, sceneIndex) => {
    object(scene, SCENE_KEYS, SCENE_KEYS.filter(key => key !== 'paths'));
    if (!Number.isInteger(scene.duration) || scene.duration < AI_DRONE_LIMITS.minDuration || scene.duration > AI_DRONE_LIMITS.maxDuration) fail('AI_SCORE_DURATION', '每个章节时长需要为 8–18 秒的整数。');
    const shape = choice(scene.shape, AI_DRONE_SHAPES, '编队形状', 'shape', sceneIndex);
    if (shape !== 'outline' && Object.hasOwn(scene, 'paths')) fail('AI_SCORE_OUTLINE', '只有自定义轮廓可以包含折线。');
    return Object.freeze({ name: text(scene.name, AI_DRONE_LIMITS.sceneName, '章节名称'), description: text(scene.description, AI_DRONE_LIMITS.description, '章节说明'), shape, color: color(scene.color), accent: color(scene.accent), duration: scene.duration, motion: choice(scene.motion, AI_DRONE_MOTIONS, '运动方式', 'motion', sceneIndex), transition: choice(scene.transition, AI_DRONE_TRANSITIONS, '转场方式', 'transition', sceneIndex), ...(shape === 'outline' ? { paths: outline(scene.paths) } : {}) });
  });
  const score = Object.freeze({ version: 1, title: text(value.title, AI_DRONE_LIMITS.title, '演出名称'), synopsis: text(value.synopsis, AI_DRONE_LIMITS.synopsis, '演出简介'), seed: value.seed, scenes: Object.freeze(scenes) });
  if (encoder.encode(JSON.stringify(score)).byteLength > AI_DRONE_LIMITS.bytes) fail('AI_SCORE_TOO_LARGE', '演出数据超过 32 KiB，请精简内容。');
  accepted.add(score);
  return score;
}
