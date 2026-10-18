export const CINEMA_DURATION = 60;
export const CINEMA_SCENES = Object.freeze([
  { id: 'orca', chapter: '01 / OCEAN', title: '与巨鲸相遇', subtitle: '掠过水面，等待巨鲸破浪而起。', cue: 7, cueLabel: '跃水时刻', marks: [[0, '入湾'], [4, '跃水'], [12, '巡游'], [27, '双鲸'], [38, '巡游'], [44, '尾拍']] },
  { id: 'carrier', chapter: '02 / HORIZON', title: '驶向天际线', subtitle: '从钢铁甲板到海天之间，见证舰载机腾空。', cue: 8, cueLabel: '弹射起飞', marks: [[0, '全舰'], [8, '起飞'], [22, '飞越'], [40, '甲板']] },
  { id: 'rocket', chapter: '03 / BEYOND', title: '挣脱地心引力', subtitle: '点火，离台。抬头看一束火焰划开天空。', cue: 12, cueLabel: '点火升空', marks: [[0, '待发'], [8, '点火'], [12, '离台'], [30, '升空']] },
]);
export function safeCinemaTime(value) { return Number.isFinite(value) ? Math.min(CINEMA_DURATION, Math.max(0, value)) : 0; }
export function cinemaPhase(id, time) {
  const scene = CINEMA_SCENES.find(s => s.id === id) || CINEMA_SCENES[0];
  const t = safeCinemaTime(time);
  return [...scene.marks].reverse().find(([at]) => t >= at)?.[1] || scene.marks[0][1];
}
export function advanceCinema(time, delta, paused, hidden = false) {
  if (paused || hidden) return safeCinemaTime(time);
  return safeCinemaTime(time + Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, .15)));
}
