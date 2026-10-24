import {FARM_SITE} from '../../orbit/shared/farmLayout.js';
import {createPortal} from 'react-dom';
import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {canAscend,canDescend,SPACE_ELEVATOR as E} from '../../../shared/space-elevator.js';
import {canBoardRail,nearRailStation} from '../../../shared/space-rail.js';
import './space.css';
const FarmPanel=lazy(()=>import('../../orbit/client/components/station/FarmPanel.jsx'));
export default function SpaceHUD({runtime,onEnter,onExit,onStatus}){
 const [open,setOpen]=useState(false),[snapshot,setSnapshot]=useState({mode:'ground',loaded:false}),[farmOpen,setFarmOpen]=useState(null);
 useEffect(()=>{const timer=setInterval(()=>{const s=runtime.current;setSnapshot({mode:s.mode,loaded:s.loaded,progress:s.progress||0,pose:s.pose,railView:s.railView,elevatorView:s.elevatorView,autoBoard:s.autoBoard,train:s.train,now:s.now,groundPose:s.groundPose,message:s.message,waypoint:s.waypoint,farm:!!s.farm});if(s.farmOpen){setFarmOpen(s.farmOpen);s.farmOpen=null;}},250);return()=>clearInterval(timer);},[runtime]);
 useEffect(()=>{if(snapshot.mode!=='ground')onStatus?.(true);},[snapshot.mode,onStatus]);
 const farmDialog=useRef(null);
 useEffect(()=>{
  runtime.current.uiBlocked=!!farmOpen;if(!farmOpen)return;
  const previous=document.activeElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';
  farmDialog.current?.querySelector('button')?.focus();
  const key=event=>{if(event.key==='Escape'){event.preventDefault();setFarmOpen(null);}if(event.key==='Tab'){
   const nodes=Array.from(farmDialog.current?.querySelectorAll('button:not(:disabled),select,input,a[href],[tabindex="0"]')||[]).filter(n=>n.getClientRects().length);
   const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }};
  window.addEventListener('keydown',key);return()=>{runtime.current.uiBlocked=false;document.body.style.overflow=overflow;window.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();};
 },[farmOpen,runtime]);
 const riding=['ascent','descent'].includes(snapshot.mode);
 const near=snapshot.mode==='ground'?canAscend(snapshot.groundPose||{}):canDescend(snapshot.pose||{});
 const train=snapshot.train,rail=snapshot.mode==='rail',pose=snapshot.groundPose||{},port=Math.hypot(pose.x-E.port.x,pose.z-E.port.z)<40;
 const board=!!train&&canBoardRail(pose,train);
 const action=()=>{runtime.current.action=snapshot.mode==='orbit'?'descend':'ascend';};
 return <div className="space-ui">
  {!open&&snapshot.mode==='ground'&&<button className="space-entry" onClick={()=>setOpen(true)}>太空航线 · 高铁 / 电梯 ↗</button>}
  {(open||snapshot.mode!=='ground')&&<section className="space-panel" aria-label="太空电梯控制台">
   <header><span>游戏小镇 / 星环航线</span><button aria-label="收起太空电梯面板" onClick={()=>setOpen(false)} disabled={snapshot.mode!=='ground'}>×</button></header>
   <h2>{snapshot.mode==='orbit'?'月亮背后，是一座城':riding?(snapshot.mode==='ascent'?'向太空攀升':'重返蓝色星球'):rail?'星环快线 · 跨海行进':port?'远海枢纽 · 重型太空电梯':'从小镇出发，向星环城进发'}</h2>
   <p>{snapshot.mode==='orbit'?'已抵达星环城。WASD 行走，长按空格喷气，按住右键环视。':riding?'你已进入实体运输厢。沿缆索连续升空，右键环视舷窗外的海洋与地球，全程不切换场景。':rail?'列车自动往返，停站 18 秒。到远海站后请下车，再步行进入电梯舱；车内可行走、右键环视。':port?'你已到远海电梯岛。出站后步行约 25 米进入黄色运输厢，登舱后开始升空。':'小镇站 → 约 1.5 公里跨海管道 → 远海电梯岛 → 星环城。列车持续往返，全程同一三维空间。'}</p>
   {riding&&<div className="space-actions"><button onClick={()=>{runtime.current.elevatorView=snapshot.elevatorView==='exterior'?'interior':'exterior';}}>{snapshot.elevatorView==='exterior'?'进入舱内乘坐视角':'切换舱外追踪视角'}</button></div>}
   {riding?<><progress aria-label="电梯行程" max="1" value={snapshot.mode==='ascent'?snapshot.progress:1-snapshot.progress}/><p className="space-meta">高度 {Math.round((snapshot.pose?.y||0)/1000)} km · 约 140 秒行程（游戏时间压缩）</p></>:<div className="space-actions">
    {snapshot.mode==='ground'&&!port&&<button onClick={()=>{if(onEnter?.()!==false){setOpen(true);runtime.current.message='';}}}>前往小镇高铁站</button>}
    {snapshot.mode==='ground'&&<button disabled={!board} onClick={()=>{runtime.current.action='rail-board';}}>列车停稳 · 从车门登乘</button>}
    {snapshot.mode==='ground'&&!board&&nearRailStation(pose)>=0&&<button onClick={()=>{runtime.current.autoBoard=!snapshot.autoBoard;runtime.current.message=snapshot.autoBoard?'已取消候车。':'已候车：请留在车门处，列车到站后自动登乘。';}}>{snapshot.autoBoard?'取消自动登乘':'候车并自动登乘'}</button>}
    {rail&&<button onClick={()=>{runtime.current.railView=snapshot.railView==='interior'?'exterior':'interior';}}>{snapshot.railView==='interior'?'切换车外追随':'切换车内视角'}</button>}
    {rail&&<button disabled={!train?.docked} onClick={()=>{runtime.current.action='rail-depart';}}>关门发车 · {train?.station===1?'返回小镇':'前往远海岛'}</button>}
    {snapshot.mode==='ground'&&train?.docked&&train.station!==(port?1:0)&&!board&&<button onClick={()=>{runtime.current.action='rail-call';}}>呼叫空车到本站</button>}
    {rail&&<button onClick={()=>{if(train?.docked)runtime.current.action='rail-exit';else{runtime.current.autoExitStation=train.direction===1?1:0;runtime.current.message='已预约到站下车，请欣赏沿途海景。';}}}>{train?.docked?'到站下车':'到站后自动下车'}</button>}
    {port&&snapshot.mode==='ground'&&!near&&<button onClick={()=>{runtime.current.walkTo={x:E.port.x,z:E.port.z};runtime.current.walkToCabin=true;runtime.current.message='正在步行进入运输厢；抵达后关门升空。WASD 可取消引导。';}}>步行登舱 · 抵达后升空</button>}
    {((port&&snapshot.mode==='ground')||snapshot.mode==='orbit')&&<button disabled={!near||!snapshot.loaded} onClick={action}>{snapshot.mode==='orbit'?'进入返程运输厢':'登上电梯 · 前往星环城'}</button>}
    {snapshot.mode==='orbit'&&<button disabled={!snapshot.farm} onClick={()=>setFarmOpen('overview')}>查看星环农业园</button>}
   </div>}
   {!riding&&train&&snapshot.mode!=='orbit'&&<p className="space-meta" aria-live="polite">{train.docked?`${train.station===0?'小镇站':'远海站'}开门停靠 · ${train.dwellRemaining||0} 秒后自动发车`:`列车驶向${train.direction===1?'远海站':'小镇站'} · ${train.remaining} 秒到站`}</p>}
   {snapshot.mode==='ground'&&port&&!near&&<p>电梯入口：向 {E.port.x>pose.x?'东':'西'}、{E.port.z>pose.z?'南':'北'}，约 {Math.round(Math.hypot(pose.x-E.port.x,pose.z-E.port.z))} 米。请步行进入运输厢中央。</p>}
   {snapshot.mode==='orbit'&&snapshot.waypoint&&<p role="status">蓝色导航标：{snapshot.waypoint.name} · 约 {Math.round(Math.hypot(snapshot.pose.orbitX-snapshot.waypoint.x,snapshot.pose.orbitZ-snapshot.waypoint.z))} 米</p>}
   {snapshot.message&&<p role="status">{snapshot.message}</p>}
  </section>}
  {farmOpen&&runtime.current.farm&&createPortal(<div className="space-farm-backdrop"><section ref={farmDialog} className="space-farm-dialog" role="dialog" aria-modal="true" aria-label="星环农业园"><header><h2>星环农业园</h2><button onClick={()=>setFarmOpen(null)}>返回城市</button></header><Suspense fallback={<p>正在打开农业园…</p>}><FarmPanel farm={runtime.current.farm} initialEquipmentId={farmOpen==='overview'?null:farmOpen} onVisit={()=>{runtime.current.waypoint={...FARM_SITE.arrival,name:'叶菜与香草舱入口'};setFarmOpen(null);}}/></Suspense></section></div>,document.body)}
 </div>;
}
