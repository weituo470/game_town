import { useEffect, useState } from 'react';
import { ArrowUpRight, Anchor, Rocket, Waves, CalendarClock } from 'lucide-react';
import { WONDERS, sampleWonder } from '../../shared/wonders.js';
import './wonders.css';
import DroneInvitation from './drone/DroneInvitation.jsx';

const ICONS = { orca: Waves, carrier: Anchor, rocket: Rocket };
function useWonderTime(timeRef) {
  const [time, setTime] = useState(() => timeRef?.current ?? 0);
  useEffect(() => { const tick = () => setTime(timeRef?.current ?? 0); tick(); const timer = setInterval(tick, 250); return () => clearInterval(timer); }, [timeRef]);
  return time;
}
export function nextShowText(state) {
  if (state.active) return state.label;
  const seconds = Math.ceil(state.nextIn / 1000);
  return `下一场 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export default function WonderSchedule({ timeRef, onTravel, onImmerse, onDroneShow, onAiDrone, onSphere, onOffshore, reducedMotion, onReducedMotion }) {
  const time = useWonderTime(timeRef);
  return <div className="wonder-schedule">
    {onDroneShow && <DroneInvitation onStart={onDroneShow} onAiDrone={onAiDrone}/>}
    {onOffshore && <section className="wonder-lead" aria-label="远海浮动岛入口"><span className="wonder-kicker">南岸科考港 / 自动巡航</span><h3>远海浮动岛</h3><p>登上半潜式科考平台，从小镇驶向远海。双浮筒、开放月池、格构塔与海上停机坪组成新的海岸地标；约 2 分 30 秒完成离港、巡航和返航，可提前回港。</p><button className="button-primary wonder-travel" onClick={onOffshore}>登船观景<ArrowUpRight size={20}/></button></section>}
    {onSphere && <section className="wonder-lead" aria-label="球幕剧场入口"><span className="wonder-kicker">西岸新地标 / 巨型外墙秀</span><h3>球幕剧场</h3><p>黄色表情会眨眼、侧目与挑眉。巨型眼球、蓝色星球和篮球接续登场；沿虎鲸湾西侧步桥可走到建筑脚下。</p><button className="button-primary wonder-travel" onClick={onSphere}>观看球幕外墙秀<ArrowUpRight size={20}/></button></section>}
    <div className="wonder-lead"><span className="wonder-kicker">海洋 / 航海 / 航天</span><h3>同一座小镇，三处奇观。</h3><p>沿街走到海湾、登上航母甲板，或飞向北岸发射场。奇观与小镇共用天空和昼夜；观景镜头也留在这张地图里。每三分钟一轮，错峰演出。</p></div>
    <div className="wonder-programme">
      {WONDERS.map((w, index) => {
        const state = sampleWonder(w.id, time), Icon = ICONS[w.id];
        return <section key={w.id} className={`wonder-programme-row wonder-${w.id}`}>
          <div className="wonder-emblem" aria-hidden="true"><span>0{index + 1}</span><Icon size={50} strokeWidth={1.2}/></div>
          <div className="wonder-programme-copy"><span className="wonder-kicker">{['西侧海湾', '东侧军港', '北侧星港'][index]}</span><h3>{w.name}</h3><p>{['两只虎鲸巡游、交错跃水与水花谢幕。沿海湾外圈寻找不同观赏角度。', '走上飞行甲板，近看停放的舰载机与舰桥外观，观看滑行、起飞和返航。', '从观景步道看完整十秒倒计时、点火烟雾和火箭升空。发射台区域设有安全边界。'][index]}</p><span className={`wonder-show-state ${state.active ? 'is-live' : ''}`}><span aria-hidden="true"/>{nextShowText(state)}</span></div>
          <div className="wonder-destination-actions"><button className="button-primary wonder-travel" onClick={() => onTravel(w.id)} aria-label={`前往${w.name}`}>前往现场<ArrowUpRight size={20}/></button><button className="wonder-travel" onClick={() => onImmerse?.(w.id)} aria-label={`观景${w.name}`}>看同地图全景</button></div>
        </section>;
      })}
    </div>
    <label className="wonder-motion-setting"><span>减少场景动态效果</span><input type="checkbox" checked={reducedMotion} onChange={event => onReducedMotion(event.target.checked)}/></label>
    <p className="wonder-boundary-note">同房演出采用服务器时间，昼夜预览不改变场次。减少动态时展示静态模型，进度照常；不自动切镜头或播放声音。当前开放甲板漫游，舰桥内舱、飞机驾驶与火箭操控尚未开放。</p>
  </div>;
}
export function WonderHud({ id, timeRef, onOpen, reducedMotion, observing, onObserve }) {
  const time = useWonderTime(timeRef), w = WONDERS.find(item => item.id === id);
  if (!w) return null;
  const state = sampleWonder(id, time);
  return <section className={`wonder-hud wonder-${id}`} aria-label={`${w.name}演出进度`}>
    <div><span className="wonder-kicker">{state.active ? '正在上演' : '奇观现场'}</span><strong>{w.name}</strong></div>
    <span className="wonder-hud-status">{nextShowText(state)}</span>
    {state.countdown !== null && !reducedMotion && <b className="wonder-countdown" aria-label={`发射倒计时${state.countdown}秒`}>{String(state.countdown).padStart(2, '0')}</b>}
    <button onClick={onObserve} aria-pressed={observing}><ArrowUpRight size={18}/>{observing ? '回到人物' : '同地图观景'}</button>
    <button onClick={onOpen} aria-haspopup="dialog"><CalendarClock size={18}/>演出时刻表</button>
    {reducedMotion && <span className="wonder-hud-meta">动态已减少，演出进度照常</span>}
  </section>;
}
