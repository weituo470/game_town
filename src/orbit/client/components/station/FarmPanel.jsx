import { useEffect, useState } from 'react';
import { ArrowUpRight, Leaf, Droplets, PlugZap, Thermometer, PackageCheck } from 'lucide-react';
import { farmTelemetry, farmJobTiming } from '../../../shared/farmSimulation.js';
import { FARM_SITES } from '../../../shared/farmLayout.js';
import { FARM_CROPS, FARM_CROP_LIST } from '../../../shared/farmCrops.js';
import { FARM_ENGINEERING, FARM_PROCESS_STEPS, FARM_PROCESS_CONTROLS, FARM_VALIDATION_GATES, FARM_ENGINEERING_SOURCES, farmEngineeringReport, farmEquipmentCsv, farmEquipmentFocus } from '../../../shared/farmEngineering.js';
import './farm.css';

const JOBS = {harvest:'分层托盘采收 → 称重/食品接收',sow:'苗盘转运 → 栽培架',inspect:'相机平台巡检示意'};
const FORMS = {rosette:'圆叶莲座', 'white-stem':'白色叶柄与深绿叶片','paired-leaf':'成对香草叶','red-berry':'红色锥形浆果','truss-fruit':'支架上的串生圆果','lobed-fruit':'黄色多瓣果实','root-tuber':'根区块茎（剖视）','grain-ear':'金色麦穗','bean-pod':'三出叶与豆荚'};
const STAGES = { empty: '待播种', growing: '生长中', ready: '可采收', failed: '待隔离清理' };
const number = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';

export default function FarmPanel({ farm, onVisit, initialEquipmentId }) {
  const focus = farmEquipmentFocus(initialEquipmentId);
  const [snapshot, setSnapshot] = useState(() => farmTelemetry(farm.stateRef.current));
  const [runtime, setRuntime] = useState(() => ({ ...farm.statusRef.current }));
  const [hall, setHall] = useState(focus?.hallIndex || 0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [event, setEvent] = useState('');
  const [circuitId, setCircuitId] = useState(focus?.rackId || 'r0');
  const [design] = useState(() => farmEngineeringReport());
  const refresh = () => {
    setSnapshot(farmTelemetry(farm.stateRef.current));
    setRuntime({ ...farm.statusRef.current });
  };
  useEffect(() => { const timer = setInterval(refresh, 500); refresh(); return () => clearInterval(timer); }, [farm]);
  function act(action) {
    farm.dispatch(action); refresh();
    setEvent(farmTelemetry(farm.stateRef.current).lastEvent || '操作已提交。');
  }
  const controls = farm.stateRef.current.controls;
  const canOperate = runtime.writable && !runtime.recovered;
  const circuit = design.circuits.find(r => r.id === circuitId);
  function exportDesign(kind) {
    let url;
    try {
      const csv=kind==='csv', data=csv?farmEquipmentCsv():JSON.stringify(farmEngineeringReport(farm.stateRef.current),null,2);
      url=URL.createObjectURL(new Blob([data],{type:csv?'text/csv;charset=utf-8':'application/json;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=`farm-concept-process-1.${csv?'csv':'json'}`;
      document.body.appendChild(link);link.click();link.remove();
      setEvent('已导出工艺概念基线；文件标明待验证项，不可直接用于采购施工。');
    } catch { setEvent('导出失败，当前浏览器可能禁止下载；农场状态未更改。'); }
    finally { if(url)setTimeout(()=>URL.revokeObjectURL(url),1000); }
  }
  return <div className="farm-panel">
    <div className="farm-intro">
      <div><span className="farm-kicker">星环农业园 / 本机试运行</span><h3>三座高层生产舱，一条可追溯生产链。</h3></div>
      <button className="button-primary" onClick={() => onVisit(hall)}>在城市中标记入口 <ArrowUpRight size={18} aria-hidden="true"/></button>
    </div>
    <p>南侧三个独立街区 · 32 米高生产舱 · 18 组栽培模块、156 个种植层、9 种作物。叶菜 12 层、果蔬 6 层、主粮实验 8 层，不把所有植物塞进同一种货架。</p>
    <div className="farm-clock">
      <span>农业第 {number(snapshot.simDays, 2)} 天 · 时间倍率 ×{snapshot.timeScale}</span>
      <button className="button-secondary" disabled={!canOperate} aria-pressed={runtime.paused} onClick={() => { farm.setPaused(!runtime.paused); refresh(); }}>{runtime.paused ? '继续模拟' : '暂停模拟'}</button>
    </div>
    <p className="farm-boundary">模拟参数为首期设计假设，不是工程实测。只计算当前可见页面时间；离开页面暂停。库存保存在{runtime.isolated ? '本标签页' : '本浏览器'}，不与多人房间共享。</p>
    {!runtime.writable && <p className="farm-warning" role="status">当前只读：等待取得运行权；另一个可见标签页可能正在运行这座工厂。</p>}
    {!runtime.storageOk && <p className="farm-warning" role="status">本地保存不可用或存档损坏，当前数据可能只在本次会话保留。</p>}
    {runtime.recovered && <p className="farm-warning" role="alert">原存档无法安全读取或未通过校验，已暂停，没有自动覆盖。当前显示启动预案；请在下方“运行边界”中确认重开试验后再操作。</p>}
    <section aria-labelledby="farm-process-title">
      <span className="farm-kicker">工艺概念基线 / {FARM_ENGINEERING.revision}</span>
      <h3 id="farm-process-title">让每一滴水、每一束光和每盘收成都有去向。</h3>
      <p>水肥不是建筑旁的装饰箱：每架都有混液箱、A/B母液罐、计量泵、供回液立管、分层阀门、根区增氧和回液处理。供液为琥珀色、净水为蓝色、回液为青绿色、隔离为砖红色；编号与设备清单对应。公共净水管在步行甲板下，不在通道铺设绊人的软管。</p>
      <ol className="farm-process-route">{FARM_PROCESS_STEPS.map(step=><li key={step.id} data-service={step.color}><strong>{step.title}</strong><span className="farm-process-code">{step.code}</span><p>{step.text}</p></li>)}</ol>
      <div className="farm-process-permit"><strong>模拟供液状态：{snapshot.process.reason}</strong><span>采收接收线：{snapshot.process.receiving?'许可':'联锁停止'} · 以下均为模拟值，不是现场传感读数</span></div>
      <dl className="farm-readings">
        <div><dt>当前模拟循环量</dt><dd>{number(snapshot.flowLPerHour,0)} L/h</dd></div>
        <div><dt>当前模拟泵功率</dt><dd>{number(snapshot.pumpKw,2)} kW</dd></div>
        <div><dt>当前模拟补光负荷</dt><dd>{number(snapshot.ledKw)} kW</dd></div>
      </dl>
      <div className="farm-switches">{FARM_PROCESS_CONTROLS.map(control=><button key={control.key} className="button-secondary" disabled={!canOperate} aria-pressed={controls[control.key]!==false} onClick={()=>act({type:control.key,enabled:controls[control.key]===false})}>{control.name}：{controls[control.key]!==false?'已接通':'已关闭'}</button>)}</div>
      <p>试着关闭回液处理许可：供液泵、投加和生长一起停止，而不是把未经处理的回液继续灌给植物。关闭接收线会冻结自动吊运与人工入库；恢复许可不丢弃在途作物。许可开关只是联锁演示，不意味着消毒验证合格；正式系统还需要独立安全回路和受控复位。</p>
      <details className="farm-details" open={!!focus}>
        <summary>查看分架设计初算、传感器与设备位号</summary>
        {focus && <p>已定位设备：<strong>{focus.id}</strong>。下方展开对应回路与所属生产舱的设备清单。</p>}
        <label className="farm-circuit-select" htmlFor="farm-circuit">选择独立水肥回路<select id="farm-circuit" value={circuitId} onChange={e=>setCircuitId(e.target.value)}>{design.circuits.map(r=><option key={r.id} value={r.id}>{r.id.toUpperCase()} · {FARM_SITES[r.hallIndex].name} · {r.crop}</option>)}</select></label>
        <p><strong>{circuit.id.toUpperCase()} · {circuit.crop}</strong>：{circuit.layers} 层、{number(circuit.areaM2)} m²；{circuit.bufferL} L 本架工作液缓冲是总水库存的分配，不是额外补给。不同作物不共用未经隔离的营养液回路。</p>
        <dl className="farm-readings">
          <div><dt>最高供液点（初算）</dt><dd>{number(circuit.hydraulics.heightM)} m</dd></div>
          <div><dt>设计循环量（假设）</dt><dd>{number(circuit.hydraulics.flowLPerHour,0)} L/h</dd></div>
          <div><dt>泵压差需求（初算）</dt><dd>{number(circuit.hydraulics.differentialPressureKPa,0)} kPa</dd></div>
          <div><dt>冠层光量目标</dt><dd>{number(circuit.lighting.targetDliMolM2Day)} mol/m²/d</dd></div>
          <div><dt>灯具输入（初算）</dt><dd>{number(circuit.lighting.installedKw)} kW</dd></div>
          <div><dt>独立灯条</dt><dd>{circuit.lighting.bars} 条</dd></div>
        </dl>
        <p>供液压差 = ρ∫g(h)dh + 管路/过滤损失 {FARM_ENGINEERING.filterAndPipeLossKPa} kPa + 末端需求 {FARM_ENGINEERING.outletPressureKPa} kPa；旋转半径 150 m，积分考虑高处重力变小。泵效率暂取 {FARM_ENGINEERING.pumpWireToWaterEfficiency*100}%，管径、阀门、NPSH、流量分配与旋转管流尚未求解，不能据此直接买泵。</p>
        <p>补光：DLI = PPFD × 光周期 × 3600 / 10⁶。灯具暂按 {FARM_ENGINEERING.photonEfficacyUmolPerJ} μmol/J、冠层利用率 {FARM_ENGINEERING.canopyUtilization*100}% 计算输入电量；不把灯具出光全部当成植物收到的光。还需实测光谱、均匀度、遮挡和温湿度。风机、消毒、配肥和控制暂合并计入 8 kW 附属负荷，不是逐台选型结果。</p>
        <p className="farm-warning">EC / pH 为配方设定，不是检测结果；EC不能告诉我们每一种离子的浓度。温度、溶氧、PAR、湿度、流量和消毒强度测点均需校准与实机接入。没有真实水质报告时不输出母液克数或酸碱投加量。</p>
        <dl className="farm-equipment-list">{design.equipment.filter(e=>e.rackId===circuitId||e.hallIndex===circuit.hallIndex&&!e.rackId).map(e=><div key={e.id} className={e.id===focus?.id?'is-focused-equipment':undefined}><dt>{e.id} · {e.name} ×{e.quantity}</dt><dd>{e.basis}</dd></div>)}</dl>
      </details>
      <details className="farm-details">
        <summary>真正建成并产出作物前：试验与工程关口</summary>
        <p className="farm-warning">北极星是可建造、可测量、能产出合格作物。目前交付的是工艺概念基线（NOT FOR CONSTRUCTION），不是完整施工图或产量承诺。地面小试先验证，再扩到高层；太空城旋转、热排放与生命保障需另行验证。</p>
        <ol>{FARM_VALIDATION_GATES.map(gate=><li key={gate}>{gate}</li>)}</ol>
        <div className="farm-switches"><button className="button-secondary" onClick={()=>exportDesign('json')}>导出工艺基线 JSON</button><button className="button-secondary" onClick={()=>exportDesign('csv')}>导出设备占位清单 CSV</button></div>
        <p>包含18个回路的初算、设备位号/概念数量和待验证关口；不包含可直接下单的规格、施工配管或真实配肥剂量。</p>
        <ul>{FARM_ENGINEERING_SOURCES.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>
      </details>
    </section>
    <section aria-labelledby="farm-automation-title">
      <h3 id="farm-automation-title">自动化生产闭环</h3>
      <dl className="farm-readings"><div><dt>有效栽培面积</dt><dd>{number(snapshot.commissionedAreaM2,0)} m²</dd></div><div><dt>已种植批次面积</dt><dd>{number(snapshot.occupiedAreaM2,0)} m²</dd></div><div><dt>相对旧试验架</dt><dd>约 43.7 倍</dd></div></dl>
      <p>初始可见作物为预育成投产批次，已计入物资清单，不冒充刚播种就长成。三舱建筑占地共 2592 m²；栽培层按真实托盘面积逐层相加，不拿整座建筑的体积冒充种植面积。32 米高处约 0.79g，上方仍有重力，水肥必须靠泵送达。</p>
      <button className="button-primary" disabled={!canOperate} aria-pressed={snapshot.automation.enabled} onClick={() => act({type:'automation',enabled:!snapshot.automation.enabled})}>{snapshot.automation.enabled ? '暂停自动调度' : '开启自动调度'}</button>
      <p>自动控制根据模拟温度在 28 / 32 / 36°C 分级调暗、停灯，光照不足会真实降低生长速度。自动排队育苗转运、分层分盘采收和巡检；暂停或断电会冻结设备，运输中的作物不会凭空入库。机械按水平 2 m/s、升降 1.5 m/s 的设计速度运行，作业耗时随目标层高变化；机械动作用展示实秒，作物生长使用农业倍率。</p>
      <ol className="farm-job-list">{snapshot.automation.jobs.map((job,index)=><li key={index}><strong>{FARM_SITES[index].name}</strong><span>{job ? `${FARM_CROPS[job.cropId].name} · ${JOBS[job.type]} · ${job.elapsed.toFixed(1)} / ${farmJobTiming(job).duration.toFixed(1)} s` : '等待排程'}</span></li>)}</ol>
      <p>灯具输出上限 {number(snapshot.lightFactor*100,0)}% · 完成 {snapshot.automation.completed} 次作业 · 完成 {snapshot.automation.inspections} 次巡检 · 在途鲜重 {number(snapshot.cargoKg)} kg · 当前机械负载 {number(snapshot.robotKw)} kW</p>
      <p className="farm-boundary">当前是规则控制和机械作业仿真：相机平台的巡检结果来自模拟作物状态，不是假装运行真实 AI 图像识别；EC、pH、光量为分作物配方设定，不伪造传感器实测值。每次仅搬运一张半层托盘，不会取一盘就清空整架。机械是有速度、时序和库存约束的运动学示意，尚未求解抓取接触力；选择性果实采摘和机器人授粉尚未实现。</p>
    </section>
    <section aria-labelledby="farm-operations-title">
      <h3 id="farm-operations-title">栽培与采收</h3>
      <p>叶菜、浆果、果菜与主粮使用不同周期和光配方。种植架上的作物具有不同形态；走近可看见作物名称。小麦、大豆、马铃薯为主粮适配实验，不承诺经济性和营养自给。</p>
      <div className="farm-hall-tabs" role="tablist" aria-label="生产舱">{FARM_SITES.map((site,index)=><button key={site.id} type="button" role="tab" id={`farm-tab-${index}`} aria-selected={hall===index} aria-controls="farm-rack-panel" onClick={()=>setHall(index)}>{site.name}</button>)}</div>
      <div id="farm-rack-panel" className="farm-rack-list" role="tabpanel" aria-labelledby={`farm-tab-${hall}`}>
        {snapshot.racks.filter(rack => rack.hallIndex === hall).map((rack, index) => <div className="farm-rack" key={rack.id}>
          <div className="farm-rack-title"><Leaf size={20} aria-hidden="true"/><strong>{rack.name}</strong><span>{STAGES[rack.status]}</span></div>
          <progress max="1" value={rack.progress} aria-label={`${rack.name}生长进度`}/>
          <p className="farm-recipe">{FORMS[FARM_CROPS[rack.cropId].form]} · {rack.layers} 层 · 当前批次 {number(rack.areaM2,0)} m²<br/>配方：{FARM_CROPS[rack.cropId].ppfd} μmol/m²/s × {FARM_CROPS[rack.cropId].lightHours} h；EC {FARM_CROPS[rack.cropId].ec} mS/cm；pH {FARM_CROPS[rack.cropId].ph}（设定）<br/>今日模拟累计光量 {number(rack.dailyLightMol,1)} mol/m²</p>
          <div className="farm-rack-detail"><span>生长 {number(rack.progress * 100, 0)}% · 健康 {number(rack.health * 100, 0)}%</span><span>鲜重 {number(rack.biomassKg)} kg</span></div>
          <div className="farm-rack-action">
            {rack.status === 'failed' ? <button className="button-secondary" disabled={!canOperate} onClick={() => act({ type: 'clearFailed', rackId: rack.id })}>隔离残体，清空栽培架</button> : <button className={rack.canHarvest ? 'button-primary' : 'button-secondary'} disabled={!canOperate || rack.busy || !(rack.canSow || rack.canHarvest)} onClick={() => act({ type: rack.canHarvest ? 'harvest' : 'sow', rackId: rack.id })}>{rack.busy ? '自动作业中' : rack.canHarvest ? '采收并送入冷库' : rack.canSow ? '播种一批作物' : rack.status === 'empty' ? '播种物资不足' : '等待成熟'}</button>}
          </div>
        </div>)}
      </div>
      <p className="farm-action-message" role="status">{event}</p>
    </section>
    <section aria-labelledby="farm-supply-title">
      <h3 id="farm-supply-title">资源与食品库存</h3>
      <dl className="farm-readings">
        <div><dt><Droplets size={18} aria-hidden="true"/>可用水</dt><dd>{number(snapshot.waterL)} L</dd></div>
        <div><dt>营养盐</dt><dd>{number(snapshot.nutrientsKg, 2)} kg</dd></div>
        <div><dt>种子批次</dt><dd>{snapshot.seeds}</dd></div>
        <div><dt>CO₂ 储备</dt><dd>{number(snapshot.co2Kg, 2)} kg</dd></div>
        <div><dt><PackageCheck size={18} aria-hidden="true"/>收获鲜重入库</dt><dd>{number(snapshot.foodKg)} kg</dd></div>
        <div><dt>外补口粮储备</dt><dd>{number(snapshot.importedFoodKg)} kg</dd></div>
      </dl>
      <div className="farm-crop-stock">{FARM_CROP_LIST.map(crop=><div key={crop.id}><strong>{crop.name}</strong><span>{crop.group} · {FORMS[crop.form]}</span><output>{number(snapshot.inventory[crop.id])} kg</output></div>)}</div>
      <p>采收只是入库，尚未模拟居民消费、配送和食品保质期。主粮、种子、营养盐和初始 CO₂ 来自启动补给，不会自动无限补充。</p>
      <details className="farm-details"><summary>模拟称重与批次交接记录（保留最近40笔）</summary>
        <p>称量数值来自作物/运输台账，不是实体秤或食品合格检验。自动采收按一张半层托盘入库；人工确认的整批入库单独标记。旧存档的历史收获保留，但不会补造旧称重记录。</p>
        {snapshot.receipts.length===0?<p>尚无本版新增的交接记录，食品入库后自动登记。</p>:<ol className="farm-receipts">{snapshot.receipts.slice().reverse().map(r=><li key={r.sequence}><strong>#{r.sequence} · {FARM_CROPS[r.cropId].name} · {number(r.kg,2)} kg</strong><span>{r.rackId.toUpperCase()} / 批次 {r.batchId} / {r.trayIndex===null?'人工整批确认':`托盘 ${r.trayIndex+1}`} / 农业第 {number(r.simSeconds/86400,2)} 天</span></li>)}</ol>}
      </details>
    </section>
    <section aria-labelledby="farm-services-title">
      <h3 id="farm-services-title">水、电、热：可以切断，也会产生后果</h3>
      <div className="farm-switches">
        {[['power', '临时供电', PlugZap], ['water', '循环供液', Droplets], ['cooling', '冷却回路', Thermometer]].map(([key, label, Icon]) => <button className="button-secondary" key={key} disabled={!canOperate} aria-pressed={controls[key]} onClick={() => act({ type: key, enabled: !controls[key] })}><Icon size={20} aria-hidden="true"/>{label}：{controls[key] ? '已接通' : '已断开'}</button>)}
      </div>
      <dl className="farm-readings">
        <div><dt>当前用电</dt><dd>{number(snapshot.powerKw)} kW</dd></div>
        <div><dt>累计电量</dt><dd>{number(snapshot.energyKWh)} kWh</dd></div>
        <div><dt>种植区温度</dt><dd>{number(snapshot.temperatureC)} °C</dd></div>
        <div><dt>累计外排热量</dt><dd>{number(snapshot.heatRejectedKWh)} kWh</dd></div>
        <div><dt>累计回收水</dt><dd>{number(snapshot.waterRecoveredL)} L</dd></div>
        <div><dt>未回收水汽</dt><dd>{number(snapshot.waterLostL)} L</dd></div>
      </dl>
      <div className={`farm-system-status${snapshot.alerts.length ? ' has-alert' : ''}`} role="status">
        <strong>{snapshot.summary}</strong>
        {snapshot.alerts.length > 0 && <ul>{snapshot.alerts.map(alert => <li key={alert}>{alert}</li>)}</ul>}
      </div>
      <p>电力按临时外部电源接入计量记账，尚未与太阳翼发电联算。冷却把热量送入外部散热服务回路，不向居住舱凭空排掉热量；当前是容量受限的简化模型。未回收水汽离开农场核算边界，仍需要城市除湿系统处理，并非消失在太空中。</p>
    </section>
    <details className="farm-details">
      <summary>查看运行边界与物质去向</summary>
      <p>水箱 → 配肥与灌溉 → 回液处理；植物蒸腾水经除湿部分回收，仍有损失。采收后的作物水分随食品入库，病株进入隔离残体库存，不直接回到饮水系统。</p>
      <p>三座生产舱沿星环分段布置，地表约 1g，32 米处约 0.79g。只有首层开放行走，上方是种植设备，不是假楼层。显示的株形用于辨识作物，不按画面株数推算产量；马铃薯根区为剖视示意。所有批次按简化鲜重记账，尚未计算小麦干燥脱粒和作物可食率。</p>
      <p>旧试验存档可迁移，原有作物和收获保留；旧批次先按原面积采收，扩建投产物资单独登记一次。地表水箱是缓冲设备，台账储水还包括舱底服务储库，未完成储库工程。
      </p><p>本轮尚未完成整城气压、呼吸耗氧、结构承载、作物病原、营养配方及真实散热器面积求解。这里是可验证收支和故障的农业试验模块，不是已验证的封闭生态系统。</p>
      <dl className="farm-readings">
        <div><dt>作物体内水</dt><dd>{number(snapshot.waterInCropsL)} L</dd></div>
        <div><dt>产生热量</dt><dd>{number(snapshot.heatGeneratedKWh)} kWh</dd></div>
        <div><dt>暂存热量</dt><dd>{number(snapshot.heatStoredKWh)} kWh</dd></div>
        <div><dt>累计产氧</dt><dd>{number(snapshot.oxygenProducedKg, 2)} kg</dd></div>
        <div><dt>隔离植物残体</dt><dd>{number(snapshot.wasteBiomassKg)} kg</dd></div>
        <div><dt>食品携带水</dt><dd>{number(snapshot.waterInFoodL)} L</dd></div>
      </dl>
      {!confirmReset ? <button className="button-plain" onClick={() => setConfirmReset(true)}>重开本机农业试验…</button> : <div className="farm-reset"><p>这会清除本机农场的种植进度、收获和故障记录，重新载入启动物资，不是一次补给运输。其他小镇记录不受影响。</p><button className="button-danger" disabled={!runtime.writable} onClick={() => { farm.reset(); setConfirmReset(false); setEvent('农业试验已重开。'); refresh(); }}>确认重开</button><button className="button-secondary" onClick={() => setConfirmReset(false)}>取消</button></div>}
    </details>
  </div>;
}
