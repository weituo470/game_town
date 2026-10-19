import { DRONE_CHAPTERS, DRONE_DURATION, DRONE_STUNT, DRONE_DRAGON, sampleDroneShow, updateDroneFleet } from './droneShow.js';
import { DROPLET_CHAPTERS, sampleDropletShow, updateDropletFleet } from './droneDroplet.js';
import { CARRIER_BATTLE_CHAPTERS, sampleCarrierBattle } from './carrierBattle.js';
import { BLACK_HOLE_CHAPTERS, BLACK_HOLE_DURATION, sampleBlackHoleShow, updateBlackHoleFleet } from './droneBlackHole.js';

// Programmes share one WebGL scene. The waterdrop story adds instanced vessels
// and a reflective probe after the same 4096 lamps have formed a cube.
export const DRONE_PROGRAMS = Object.freeze([
  Object.freeze({ id: 'avatar', title: '法天象地', chapters: DRONE_CHAPTERS, duration: DRONE_DURATION,
    subtitle: '幼年悟空 · 如意凌空 · 四阶失重',
    description: '蓝焰翼龙化作幼年孙悟空：刺猬头、蓝色武道服与红色如意棒由星光织成。四批机群依次失重、同拍复燃，最后完整归航。支持编队第一视角。',
    heroTime: 76000, highlightTime: DRONE_STUNT.fallStart - 2000, recoveryTime: DRONE_STUNT.brakeStart,
    dragonTime: DRONE_DRAGON.formed + 4000, dragonLabel: '蓝焰翼龙',
    heroLabel: '直达法相', highlightLabel: '直达失重', recoveryLabel: '贴海复燃', supportsFpv: true,
    note: '四批依次失重，同刻恢复动力。以《龙珠》幼年孙悟空为形象的非官方无人机灯光演绎。音效默认关闭；这是虚拟编舞，减少动态模式不进行俯冲。' }),
  Object.freeze({ id: 'droplet', title: '水滴 · 末日之战', shortTitle: '水滴之战', chapters: DROPLET_CHAPTERS, duration: DRONE_DURATION,
    subtitle: '立方舰阵 · 镜面水滴',
    description: '4096 架无人机升成立方阵，幻化为 216 艘实体战舰。镜面水滴高速贯穿、锐角折返，战舰延迟爆炸，最后以无人机归航谢幕。',
    heroTime: 52000, highlightTime: 64000, recoveryTime: 107000,
    heroLabel: '水滴现身', highlightLabel: '直达首击', recoveryLabel: '战后寂静', supportsFpv: false,
    note: '致敬刘慈欣《黑暗森林》的非官方舞台演绎。水滴是独立的银色镜面实体，不是无人机灯点。216 艘战舰为代表性编队，并非原著舰数；空间、速度与时长为戏剧化压缩。音效为配乐，并非真空传声；归航是无人机谢幕，不是舰队复活。' }),
  Object.freeze({ id: 'carrier-battle', title: '空天母舰', chapters: CARRIER_BATTLE_CHAPTERS, duration: DRONE_DURATION,
    subtitle: '蜂群来袭 · 近防拦截 · 母舰升空',
    description: '红色无人机突袭航母，近防炮交织拦截；舰体展开升力舱、离水升空，释放青色机群迎战。',
    heroTime: 88000, highlightTime: 42000, recoveryTime: 120000,
    heroLabel: '母舰升空', highlightLabel: '近防拦截', recoveryLabel: '空中对战', supportsFpv: false,
    note: '科幻编排，非真实武器模拟。红色为来袭机群，青色为母舰编队。观演只改变本地画面，不改变同房玩家与港口碰撞；结束后舰体回港。' }),
  Object.freeze({ id: 'blackhole', title: '黑洞降临', chapters: BLACK_HOLE_CHAPTERS, duration: BLACK_HOLE_DURATION, ambientOnly: true,
    subtitle: '小镇天空 · 随机奇观',
    description: '日常漫游时偶尔浮现在小镇天际的黑洞与吸积盘，片刻后消散。不会进入专门观演或改变玩家操作。',
    heroTime: 35000, highlightTime: 50000, recoveryTime: 70000,
    heroLabel: '黑洞成形', highlightLabel: '光环盛景', recoveryLabel: '凝望深空', supportsFpv: false, supportsAudio: false,
    note: '环境天象，不由无人机组成。开源版采用原创暗核与光环效果，静默出现并消散；这是实时艺术化可视化，并非精确天体物理模拟。' }),
]);

// Internal score compatibility is separate from the public programme menu.
// Ambient sky events are never selectable shows and cannot take over a player.
export const DRONE_PROGRAM_MENU = Object.freeze(DRONE_PROGRAMS.filter(program => !program.ambientOnly));

// AI runtimes are created by the lazy studio from validated data. They are
// explicit per-viewer values, never an executable programme from the network.
export function isAiDroneRuntime(runtime) {
  return runtime?.program?.id === 'ai' && Number.isFinite(runtime.program.duration)
    && runtime.program.duration > 0 && ['sample', 'update', 'camera'].every(key => typeof runtime[key] === 'function');
}

export function getDroneProgram(id = 'avatar', aiRuntime) {
  if (id === 'ai' && isAiDroneRuntime(aiRuntime)) return aiRuntime.program;
  return DRONE_PROGRAMS.find(program => program.id === id) || DRONE_PROGRAMS[0];
}

export function sampleDroneProgram(timeMs, program = 'avatar', aiRuntime) {
  if (program === 'ai' && isAiDroneRuntime(aiRuntime)) return aiRuntime.sample(timeMs);
  if (program === 'blackhole') return sampleBlackHoleShow(timeMs);
  return program === 'carrier-battle' ? sampleCarrierBattle(timeMs)
    : program === 'droplet' ? sampleDropletShow(timeMs) : sampleDroneShow(timeMs);
}

export function updateDroneProgram(fleet, timeMs, options = {}) {
  if (options.program === 'ai' && isAiDroneRuntime(options.aiRuntime)) return options.aiRuntime.update(fleet, timeMs, options);
  if (options.program === 'carrier-battle') {
    // This score uses solid aircraft and the existing harbour ship, never a
    // second 4096-light formation. Clear any cached lamps before switching.
    fleet.sizes.fill(0); fleet.colors.fill(0);
    fleet.state = sampleCarrierBattle(timeMs, options);
    return fleet.state;
  }
  if (options.program === 'blackhole') return updateBlackHoleFleet(fleet, timeMs, options);
  return options.program === 'droplet'
    ? updateDropletFleet(fleet, timeMs, options)
    : updateDroneFleet(fleet, timeMs, options);
}
