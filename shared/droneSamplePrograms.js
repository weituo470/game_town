import { createCuratedAiDroneRuntime } from './aiDroneShow.js';
import { createDroneSampleCamera } from './droneSampleCamera.js';

// Directly authored in this Codex conversation: original editorial sample
// programmes, not fetched/generated through DeepSeek or any provider API.
// No remote assets, music, scripts or executable content are embedded here.
// Paths describe constellations; the existing separated-light compiler and
// compact particle shader remain the only renderer (never luminous tubes).
const PALETTES = Object.freeze({
  ice: ['#63CFFF', '#E3F8FF'], ocean: ['#2475E6', '#66F2DC'], dawn: ['#FF9273', '#FFE2A1'],
  leaf: ['#70DCAF', '#D9F898'], gold: ['#FFD073', '#FFF1C8'], violet: ['#AD8DFF', '#F4ACDE'],
  rose: ['#FF85B5', '#FFE2D6'], ember: ['#FF8D52', '#FFD18B'], night: ['#5C8DFF', '#D7C7FF'],
});
const OUTLINES = Object.freeze({
  boat: [[[-.95,-.38],[-.59,-.76],[.64,-.76],[.96,-.38],[-.95,-.38]], [[-.12,-.37],[-.12,.88],[.7,-.26],[-.12,-.26]], [[-.25,.58],[-.79,-.28],[-.25,-.28]], [[-.96,-.91],[-.52,-.84],[-.1,-.93],[.35,-.84],[.93,-.91]]],
  rocket: [[[0,.97],[-.27,.5],[-.27,-.35],[.27,-.35],[.27,.5],[0,.97]], [[-.27,.05],[-.58,-.48],[-.26,-.36]], [[.27,.05],[.58,-.48],[.26,-.36]], [[-.18,-.45],[0,-.95],[.18,-.45]], [[-.12,.29],[-.12,.1],[.12,.1],[.12,.29],[-.12,.29]]],
  bridge: [[[-.99,-.55],[-.65,-.55],[-.49,-.24],[-.24,.03],[0,.14],[.24,.03],[.49,-.24],[.65,-.55],[.99,-.55]], [[-.99,-.73],[.99,-.73]], [[-.75,-.55],[-.75,.55]], [[.75,-.55],[.75,.55]], [[-.98,.3],[-.75,.55],[-.48,.28],[0,.12],[.48,.28],[.75,.55],[.98,.3]]],
  tree: [[[0,.92],[-.39,.44],[-.19,.44],[-.65,-.07],[-.37,-.07],[-.89,-.62],[.89,-.62],[.37,-.07],[.65,-.07],[.19,.44],[.39,.44],[0,.92]], [[-.13,-.62],[-.13,-.94],[.13,-.94],[.13,-.62]]],
  moon: [[[.32,.93],[-.15,.88],[-.57,.57],[-.72,.12],[-.64,-.38],[-.31,-.73],[.19,-.88],[.65,-.69],[.86,-.39],[.4,-.53],[.04,-.4],[-.13,-.04],[-.05,.36],[.32,.93]], [[.58,.63],[.64,.48],[.8,.46],[.67,.35],[.68,.18],[.55,.29],[.4,.23],[.47,.39],[.37,.51],[.54,.49],[.58,.63]]],
  lantern: [[[-.58,.55],[-.77,.15],[-.68,-.35],[-.43,-.61],[.43,-.61],[.68,-.35],[.77,.15],[.58,.55],[-.58,.55]], [[-.47,.55],[-.47,.73],[.47,.73],[.47,.55]], [[-.43,-.61],[-.43,-.73],[.43,-.73],[.43,-.61]], [[-.22,.55],[-.29,.1],[-.22,-.61]], [[.22,.55],[.29,.1],[.22,-.61]], [[0,-.73],[0,-.98]]],
  hourglass: [[[-.6,.9],[.6,.9],[.5,.67],[.16,.18],[.1,0],[.16,-.18],[.5,-.67],[.6,-.9],[-.6,-.9],[-.5,-.67],[-.16,-.18],[-.1,0],[-.16,.18],[-.5,.67],[-.6,.9]], [[-.37,.5],[.37,.5],[0,.08],[-.37,.5]], [[-.39,-.69],[0,-.29],[.39,-.69],[-.39,-.69]]],
  comet: [[[-.87,-.48],[-.53,-.68],[-.2,-.53],[-.09,-.19],[-.28,.11],[-.62,.18],[-.88,-.1],[-.87,-.48]], [[-.2,.02],[.86,.89]], [[-.06,-.23],[.94,.52]], [[-.12,-.48],[.84,.12]]],
  crown: [[[-.92,.47],[-.61,-.56],[.61,-.56],[.92,.47],[.47,.06],[0,.85],[-.47,.06],[-.92,.47]], [[-.64,-.72],[.64,-.72]], [[-.38,-.29],[0,.08],[.38,-.29]]],
  sunrise: [[[-.99,-.55],[.99,-.55]], [[-.69,-.55],[-.61,-.1],[-.32,.2],[0,.3],[.32,.2],[.61,-.1],[.69,-.55]], [[0,.5],[0,.93]], [[-.52,.31],[-.79,.64]], [[.52,.31],[.79,.64]], [[-.95,-.76],[-.52,-.7],[0,-.78],[.52,-.7],[.95,-.76]]],
});
const scene = (name, shape, palette, description, motion = 'breathe', transition = 'morph', duration = 18) => ({ name, description,
  shape: OUTLINES[shape] ? 'outline' : shape, color: PALETTES[palette][0], accent: PALETTES[palette][1], duration, motion, transition,
  ...(OUTLINES[shape] ? { paths: OUTLINES[shape] } : {}) });

const LONG = [
  scene('序 · 海面收到一封信','ring','ice','三层涟漪从海面展开，像一封迟到的宇宙来信。','turn'),
  scene('一粒光的愿望','star','gold','第一颗星不是终点，它是整段旅程的出发信号。'),
  scene('纸舟启航','boat','ocean','纸舟沿着星光波纹离岸，带走小镇的梦想。','wave','sweep'),
  scene('深蓝的回答','whale','ocean','巨鲸浮出深海，用一口星光回应纸舟。','wave'),
  scene('鲸背上的花园','flower','leaf','海的呼吸化为一朵花，生命在陌生的地方生长。','breathe','burst'),
  scene('风替我们展开双翼','bird','ice','花瓣舒展成双翼，视线第一次离开海平线。','wave','sweep'),
  scene('越过群山','mountain','dawn','鸟越过晨曦中的山脉，旅程从海走向陆地。','still'),
  scene('月亮的渡口','moon','night','一弯月亮成为最后的岸，天空开始安静。','still'),
  scene('二 · 点火前的心跳','heart','ember','远行需要勇气，也需要一个想回来的地方。'),
  scene('向无垠出发','rocket','ember','星光拼成一枚向上的火箭，梦想有了方向。','still','sweep'),
  scene('穿过星门','ring','violet','三道旋转星门依次展开，让平面变成有深度的空间。','turn','burst'),
  scene('蓝色星球','sphere','ice','绕行的光环托起一颗蓝色星球，镜头缓慢侧移。','turn'),
  scene('时间的种子','helix','leaf','双螺旋在星海中生长，生命与时间彼此缠绕。','turn'),
  scene('银河第一次呼吸','galaxy','violet','旋臂铺满天空，最远的光也保持一颗颗可见。','breathe','burst'),
  scene('追赶一颗彗星','comet','ice','一颗彗星划出方向，光点不拉成长长的灯管。','still','sweep'),
  scene('星海回声','star','gold','绚烂退去后留下一颗安静的星，作为全场的停顿。','still'),
  scene('三 · 时间从指间经过','hourglass','dawn','沙漏倒映远行的时间，问题变成我们为什么出发。','still'),
  scene('故乡有一座桥','bridge','gold','跨越两岸的桥，连接出发的人和等待的人。','still','sweep'),
  scene('桥那边的万家灯火','city','dawn','一扇扇窗被星灯点亮，城市不是抽象的目的地。','still'),
  scene('窗前的树长大了','tree','leaf','故乡的树长高，归来的心也开始靠岸。'),
  scene('一盏灯为你留着','lantern','ember','一盏暖灯停在夜空，给这段旅程一个温柔的重心。','still'),
  scene('所有道路开出花','flower','rose','城市与自然交汇成繁花，灯光由暖金走向粉白。','breathe','burst'),
  scene('群山不再遥远','mountain','leaf','相同的山脉换上春色，归途与去路已经不同。','still','sweep'),
  scene('飞鸟带回消息','bird','gold','飞鸟再次出现，把新的目光带回小镇。','wave'),
  scene('四 · 世界因相遇而完整','heart','rose','一颗心不是结尾，而是让所有生命再次相遇。','breathe','burst'),
  scene('鲸与星海的约定','whale','violet','海里的鲸再次抬头，像还记得最初那封信。','wave'),
  scene('共同生长的轨迹','helix','ice','两条光路各自独立，却始终围绕共同的方向。','turn','sweep'),
  scene('把未来交给想象','crown','gold','属于每个造梦者的星冠在空中完成，不借用现成角色。','still'),
  scene('小镇成为一座星城','city','ice','城市从暖灯变成蓝白星城，把远方的未来带回脚下。','still','burst'),
  scene('归来仍有新的黎明','sunrise','dawn','海平线托起晨光，为十分钟旅程打开下一页。','still','sweep'),
  scene('终 · 群星属于每个人','galaxy','gold','整片银河以暖金色展开，最后一次让观众仰望。','breathe','burst'),
  scene('把一颗星留在心里','star','gold','一颗清晰的星缓缓呼吸，随后每架飞机完整归航。','breathe','morph',16),
];
const FESTIVAL = [
  scene('灯火醒来','lantern','ember','开场的红金灯笼点亮小镇，节日从第一盏灯开始。','still'),
  scene('花开迎客','flower','rose','花朵向四周舒展，把祝福送给每个抬头的人。','breathe','burst'),
  scene('鹊羽传喜','bird','gold','双翼掠过天空，把喜讯带过街巷。','wave','sweep'),
  scene('月圆时的想念','moon','gold','热闹中的片刻安静，给想念的人留一轮月亮。','still'),
  scene('桥上有人归来','bridge','ember','一座桥把远方和家连起来，归人终于走到灯下。','still','sweep'),
  scene('万家灯火','city','gold','所有窗户都是不同的故事，一起汇成相同的温暖。','still'),
  scene('心愿同频','heart','rose','粉金色心形像一次共同心跳，热闹里也有温柔。'),
  scene('金环共舞','ring','gold','立体金环展开，镜头慢慢环绕，让星灯层次清楚可见。','turn','burst'),
  scene('繁花似锦','flower','ember','暖色繁花再次绽放，比开场更加热烈。','breathe','burst'),
  scene('向着新日出','sunrise','dawn','地平线上迎来新的日出，祝福从此刻延伸。','still','sweep'),
  scene('把祝福写成星河','galaxy','gold','金色旋臂是最后一次盛放，不使用高频闪烁。','breathe','burst'),
  scene('灯火常在','lantern','gold','留一盏明亮的灯，再让星灯依次回家。','still','morph',16),
];
const COSMOS = [
  scene('宇宙尚未命名','ring','night','空中的第一圈涟漪，是未知世界发出的信号。','turn','morph',17),
  scene('一颗恒星诞生','star','gold','从黑暗中出现的星，引导接下来的星际航程。','breathe','burst',17),
  scene('启航者','rocket','ice','火箭以蓝白轮廓直指天空，探索从一个决定开始。','still','sweep',17),
  scene('穿越边界','ring','violet','立体星门打开，从熟悉的方向进入陌生的空间。','turn','burst',17),
  scene('蓝色档案','sphere','ice','一颗有光环的蓝色星球，提醒旅人记住来处。','turn','morph',17),
  scene('生命的暗号','helix','leaf','双螺旋在宇宙中缓慢旋转，生命不只是一个坐标。','turn','sweep',17),
  scene('恒星之海','galaxy','violet','群星围绕无形的中心舒展，镜头从侧面读出空间。','breathe','burst',17),
  scene('来自遥远过去的光','comet','ice','彗星轮廓保持静止，给眼睛一个完整读图的时刻。','still','sweep',17),
  scene('星际的花','flower','violet','无机的宇宙忽然开出花，让想象短暂战胜距离。','breathe','burst',17),
  scene('深空中听见鲸歌','whale','ocean','鲸不是宇宙事实，而是旅人带到深空的地球记忆。','wave','morph',17),
  scene('时间留下的形状','hourglass','gold','沙漏提醒我们，远行有尽头，记忆却能留下。','still','sweep',17),
  scene('返航坐标','mountain','dawn','山峦再次出现，熟悉的轮廓胜过所有遥远风景。','still','morph',17),
  scene('看见故乡','city','ice','星际航程里的蓝色城市逐窗亮起，仿佛在回应归来。','still','sweep',17),
  scene('引力以外的牵挂','heart','rose','把人带回家的不只有引力，也有无法写成公式的牵挂。','breathe','morph',17),
  scene('我们也是星尘','galaxy','gold','所有颜色汇成一片暖金星海，完成探索的答案。','breathe','burst',18),
  scene('下一次仰望','bird','ice','飞鸟朝向新的天空，机群随后归航，等待下一次出发。','wave','morph',18),
];

const DEFINITIONS = [
  { id: 'voyage-of-light', title: '光的远行 · 致每一个造梦者', subtitle: '海洋来信 · 星际远航 · 万家灯火', description: '32 幕原创十分钟长秀：从海面的一圈涟漪，到穿越银河，再把远方的光带回小镇。', duration: 600000, seed: 19601019, palette: '#63CFFF', scenes: LONG, heroScene: 13, highlightScene: 30 },
  { id: 'lanterns-home', title: '灯火归人 · 小镇庆典', subtitle: '一盏灯 · 一座桥 · 一个家', description: '12 幕四分钟暖色庆典：灯笼、繁花、归桥与万家灯火，适合节日与团聚主题。', duration: 240000, seed: 19601020, palette: '#FFD073', scenes: FESTIVAL, heroScene: 5, highlightScene: 10 },
  { id: 'stardust-return', title: '星尘归航 · 宇宙来信', subtitle: '点火启航 · 生命暗号 · 返航坐标', description: '16 幕五分钟科幻诗篇：探索星门、蓝色星球与生命螺旋，最后重新看见故乡。', duration: 300000, seed: 19601021, palette: '#AD8DFF', scenes: COSMOS, heroScene: 6, highlightScene: 14 },
];
export const DRONE_SAMPLE_PROGRAMS = Object.freeze(DEFINITIONS.map(({ scenes, seed, heroScene, highlightScene, ...item }) => Object.freeze({ ...item, sceneCount: scenes.length, authoredBy: '本会话 AI 直接编排', cinematic: true, supportsAudio: false, note: '原创样板 · 无需生成额度 · 纯视觉无配乐 · 可运镜回放与导出' })));
const runtimes = new Map();

/** The public selection API only accepts a fixed bundled identifier. */
export function createDroneSampleRuntime(id) {
  if (runtimes.has(id)) return runtimes.get(id);
  const definition = DEFINITIONS.find(item => item.id === id);
  if (!definition) throw new RangeError('未找到这个样板节目。');
  const runtime = createCuratedAiDroneRuntime({ version: 1, title: definition.title, synopsis: definition.description, seed: definition.seed, scenes: definition.scenes });
  if (runtime.program.duration !== definition.duration) throw new RangeError('样板节目时长与目录不一致。');
  const chapterMiddle = index => { const chapter = runtime.program.chapters[index + 2]; return Math.round((chapter.start + chapter.end) / 2); };
  const program = Object.freeze({ ...runtime.program, sampleId: id, shortTitle: definition.title.split(' · ')[0], subtitle: definition.subtitle,
    cinematic: true, supportsAudio: false, heroTime: chapterMiddle(definition.heroScene), highlightTime: chapterMiddle(definition.highlightScene),
    heroLabel: '观看主章', highlightLabel: '直达终章', recoveryLabel: '完整归航',
    note: '本会话 AI 直接编排的原创样板；不调用线上生成模型。纯视觉、无配乐；仅供虚拟观演，不是真实无人机飞行指令。' });
  const result = Object.freeze({ ...runtime, program, camera: createDroneSampleCamera(program, runtime.score.scenes) });
  runtimes.set(id, result);
  return result;
}
