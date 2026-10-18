import { WORLD_LOCATIONS } from '../../shared/world.js';

export const GAMES = [
  { id: 'balloons', name: '气球靶场', subtitle: '瞄准你的快乐', category: '瞄准与反应', color: '#e87958', icon: 'target', duration: '30 秒', description: '击破漂浮的气球，试试你的瞄准与反应。' },
  { id: 'haunted', name: '鬼屋探险', subtitle: '好奇心，往前一步', category: '探索与刺激', color: '#8e80bb', icon: 'ghost', duration: '约 1 分钟', description: '提起手电，寻找藏在老宅里的三枚星星。' },
  { id: 'rhythm', name: '节奏舞台', subtitle: '找到你的节拍', category: '节奏与协调', color: '#5e9d9b', icon: 'music', duration: '约 25 秒', description: '跟上光点与节拍，把小镇变成你的舞台。' },
  { id: 'puzzle', name: '机关工坊', subtitle: '让灵感接通', category: '解谜与策略', color: '#cf9b39', icon: 'puzzle', duration: '约 1 分钟', description: '转动管道，给工坊接通一条完整的能量路线。' },
].map(game => {
  const location = WORLD_LOCATIONS.find(place => place.id === game.id);
  return { ...game, position: [location.x, 0, location.z], door: [location.doorX, 0, location.doorZ] };
});
export const GAME_MAP = Object.fromEntries(GAMES.map(game => [game.id, game]));
