import { createDroneShortRuntime } from './droneShortShow.js';
import { createDroneShortCamera } from './droneSampleCamera.js';
import { createDroneSpectacleVisual } from '../src/components/drone/droneSpectacleVisual.js';

// Direct session-authored 3D choreography; this lazy module never calls an AI
// provider and does not widen the public generated-score schema.
const DEFINITIONS = [
  { id: 'phoenix-rebirth', title: '焰羽 · 重生', subtitle: '火种苏醒 · 凤凰振翅 · 贴海复燃', duration: 108000,
    description: '一粒火种织成有冠羽、喙、双翼与五束长尾的立体凤凰。折翼俯冲后，在海面上方复燃；金焰展翅与分层烟花完成谢幕。',
    palette: '#FFAA52', heroTime: 37000, highlightTime: 81000, heroLabel: '凤凰振翅', highlightLabel: '复燃高光',
    scenes: [
      ['ember', '火种苏醒', 8000, 18000, '火种沿双螺旋上升，红金星屑聚拢成炽热的生命。'],
      ['emergence', '凤凰初现', 18000, 30000, '胸腹、头冠、长喙与十四排主羽依次舒展。'],
      ['wings', '巨翼呼吸', 30000, 48000, '双翼缓慢振动，长尾在空间里摆动；每一颗灯仍独立可见。'],
      ['dive', '折翼入海', 48000, 60000, '凤凰收拢双翼，翻身俯冲，在海面上方收束成火种。'],
      ['silence', '最后一粒火', 60000, 64000, '机群压低到海面上方，留出短暂的屏息。'],
      ['rebirth', '逆火重生', 64000, 74000, '金焰向上反卷，凤凰重新展开双翼与五束尾羽。'],
      ['coronation', '焰羽加冕', 74000, 94000, '凤凰悬停振翅，三重焰火从两翼外侧向上绽放。'],
    ] },
  { id: 'tidal-whale', title: '鲸落 · 潮生', subtitle: '立体海潮 · 巨鲸跃空 · 星雨鲸群', duration: 112000,
    description: '三层潮汐托起一头有胸鳍、背鳍、尾鳍与腹部纹理的巨鲸。它抬头跃空、化为星雨，再与两头小鲸一起游向海天深处。',
    palette: '#64DFFF', heroTime: 45000, highlightTime: 57000, heroLabel: '巨鲸巡游', highlightLabel: '跃空高光',
    scenes: [
      ['tide', '海在呼吸', 8000, 22000, '三层弧形海潮起伏，蓝色水光打开演出的纵深。'],
      ['surfacing', '深蓝来客', 22000, 38000, '潮水汇成立体巨鲸，圆钝的头、胸鳍与分叉尾鳍逐渐清晰。'],
      ['whalesong', '鲸歌掠过', 38000, 50000, '巨鲸摆尾巡游，腹部亮纹与鳍尖形成层次。'],
      ['breach', '跃出海天', 50000, 62000, '鲸首抬起，身体越过海平线；冷白水花向两侧扬起。'],
      ['starrain', '鲸落成星', 62000, 76000, '巨鲸解体为满天星雨，光点沿着下落轨迹回到潮汐。'],
      ['pod', '潮生鲸群', 76000, 98000, '三头鲸在不同深度错落游动，水色尾波与暖白焰火送行。'],
    ] },
  { id: 'gravity-gate', title: '天门 · 逆重力', subtitle: '三轴星门 · 全机失重 · 反重力重启', duration: 100000,
    description: '三轴星门围绕一颗能量核心运行。收束、熄暗、全机群自由下坠，在贴近海面的一刻反升；破空焰火见证星门重启。',
    palette: '#8C9AFF', heroTime: 32000, highlightTime: 76000, heroLabel: '星门运转', highlightLabel: '重启高光',
    scenes: [
      ['gate', '星门展开', 8000, 24000, '三轴环带在不同纵深展开，核心保持稳定。'],
      ['core', '天穹引擎', 24000, 40000, '环带与辐条缓慢运行，白金核心向外输送能量。'],
      ['collapse', '重力失效', 40000, 50000, '所有环带收束，天空骤然安静。'],
      ['freefall', '全机失重', 50000, 60000, '整座星门加速下坠，在海面上方保留安全间距。'],
      ['reversal', '反重力跃迁', 60000, 70000, '机群由下坠反转为上升，星门在反升中重新展开。'],
      ['reboot', '天门重启', 70000, 86000, '三个环带恢复完整形态，紫金焰火层层点亮天穹。'],
    ] },
];
for (const definition of DEFINITIONS) {
  definition.scenes = Object.freeze(definition.scenes.map(Object.freeze)); Object.freeze(definition);
}
Object.freeze(DEFINITIONS);
export const DRONE_SAMPLE_PROGRAMS = Object.freeze(DEFINITIONS.map(({ scenes, ...definition }) => Object.freeze({
  ...definition, sceneCount: scenes.length, authoredBy: '本会话 AI 直接编排', cinematic: true, supportsAudio: false,
  note: '两分钟内原创短秀 · 立体编舞与烟花 · 无需生成额度 · 可运镜回放与导出',
})));
const runtimes = new Map();
export function createDroneSampleRuntime(id) {
  if (runtimes.has(id)) return runtimes.get(id);
  const definition = DEFINITIONS.find(item => item.id === id);
  if (!definition) throw new RangeError('未找到这个样板节目。');
  const runtime = createDroneShortRuntime(definition);
  const result = Object.freeze({ ...runtime, camera: createDroneShortCamera(runtime.program), visualFactory: count => createDroneSpectacleVisual(id, count) });
  runtimes.set(id, result); return result;
}
