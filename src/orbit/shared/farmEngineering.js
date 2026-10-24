import { FARM_RACKS, FARM_SITES, FARM_TOTAL_AREA_M2 } from './farmLayout.js';
import { FARM_CROPS } from './farmCrops.js';
import { RING_STATION } from './ringStation.js';

// Design basis, NOT equipment procurement specifications or validated recipes.
// Values are deliberately shared by the energy model, geometry and export.
export const FARM_ENGINEERING = Object.freeze({
  revision: 'concept-process-1', status: 'NOT FOR CONSTRUCTION',
  photonEfficacyUmolPerJ: 2.8, canopyUtilization: .85,
  circulationLPerM2Hour: 2, pumpWireToWaterEfficiency: .5,
  filterAndPipeLossKPa: 35, outletPressureKPa: 20,
  solutionDensityKgM3: 1000, deckGravityMps2: 9.81,
  circuitBufferL: 180, latentHeatKWhPerL: .68,
  ledBarsPerLayer: 4,
});
export const FARM_PROCESS_CONTROLS = Object.freeze([
  Object.freeze({ key: 'dosing', name: '配肥许可', consequence: '关闭后供液阀联锁关闭，停止生长，不再消耗营养盐。' }),
  Object.freeze({ key: 'treatment', name: '回液处理许可', consequence: '关闭后隔离回用回路，停止供液；不旁路回收未处理营养液。' }),
  Object.freeze({ key: 'receiving', name: '采收接收线', consequence: '关闭后暂停自动机械和人工入库，在途作物保留。' }),
]);
export const farmProcessDefaults = () => Object.fromEntries(FARM_PROCESS_CONTROLS.map(c => [c.key, true]));
export function farmProcessState(state) {
  const c = state?.controls || {}, power = c.power === true;
  const dosing = power && c.dosing !== false && state?.nutrientsKg > 0;
  const treatment = power && c.treatment !== false;
  const irrigation = power && c.water === true && state?.waterL > 0 && dosing && treatment;
  return { power, dosing: dosing && irrigation, treatment, irrigation,
    receiving: power && c.receiving !== false,
    reason: !power ? '供电中断' : !c.water ? '循环供液关闭' : !(state.waterL > 0) ? '水储备耗尽' : !treatment ? '回液隔离' : !dosing ? '配肥未许可或储备耗尽' : '允许供液' };
}

// In a spinning habitat g decreases with height. Integrate g(h)dh rather than
// assuming a constant 1g at the highest tray. No Coriolis/pipe CFD is claimed.
export function farmHydraulics(rack) {
  const e = FARM_ENGINEERING, heightM = rack.tierHeights.at(-1) + .3;
  const specificEnergyJPerKg = e.deckGravityMps2 * (heightM - heightM ** 2 / (2 * RING_STATION.radius));
  const staticPressureKPa = e.solutionDensityKgM3 * specificEnergyJPerKg / 1000;
  const differentialPressureKPa = staticPressureKPa + e.filterAndPipeLossKPa + e.outletPressureKPa;
  const flowLPerHour = rack.areaM2 * e.circulationLPerM2Hour;
  const pumpKw = flowLPerHour / 3600000 * differentialPressureKPa / e.pumpWireToWaterEfficiency;
  return { heightM, staticPressureKPa, differentialPressureKPa, flowLPerHour, pumpKw,
    equivalentEarthHeadM: differentialPressureKPa * 1000 / (e.solutionDensityKgM3 * e.deckGravityMps2) };
}
export function farmLighting(rack, crop = FARM_CROPS[rack.cropId], areaM2 = rack.areaM2) {
  const e = FARM_ENGINEERING;
  return { targetPpfd: crop.ppfd, targetDliMolM2Day: crop.ppfd * crop.lightHours * .0036,
    fixturePpfUmolPerSecond: crop.ppfd * areaM2 / e.canopyUtilization,
    installedKw: crop.ppfd * areaM2 / (e.photonEfficacyUmolPerJ * e.canopyUtilization * 1000),
    bars: rack.layers * e.ledBarsPerLayer };
}

const common = [
  ['TK', '净水缓冲与空气间隙补水', '水质报告、液位高低限、溢流围堰；不能直接接未经检测的运河水', 1, 'water'],
  ['F', '源水预处理与取样口', '按水质选择过滤/软化/RO；浓水另行处置，不默认需要RO', 1, 'water'],
  ['HX', '除湿、空气循环与冷却接口', '风管送回风、冷凝水隔离检测；热量交给外部散热服务', 1, 'cooling'],
  ['RC', '托盘接收、称重与批次登记', '接收许可联锁，按批次入库；重量来自仿真账本，不冒充秤读数', 1, 'packing'],
  ['QC', '食品接收冷链与隔离接口', '显示接收缓冲柜，不等于已定容冷库；逐作物确定温度/清洗/干燥工艺', 1, 'packing'],
];
const circuit = [
  ['MX', '独立混液/回液缓冲箱', '每架独立180L设计缓冲；源水与回液不跨作物混用', 1],
  ['DA', 'A液储罐与计量泵', '浓缩钙盐与不相容磷/硫盐分开；先稀释混匀，禁止浓液直接相混', 1],
  ['DB', 'B液储罐与计量泵', '配比须由水质、盐纯度、品种和生长阶段复核；无通用配肥克数', 1],
  ['PH', '独立酸碱加药与锁闭围堰', 'EC稳定后调pH；无流量/低液位停药，酸碱分区，不同时投加', 1],
  ['P', '变频供液泵/止回/压力表', '按流量—扬程曲线、NPSH及支管最不利点选型；此处只做初算', 1],
  ['UV', '回液过滤、消毒与取样旁路', '处理失效隔离整架回路；UV剂量/透光率/病原验证待完成，绿灯不代表无菌', 1],
  ['SN', 'EC/pH/温度/溶氧/液位/流量传感组', '设计I/O位，不伪造现场测量；电极校准与实验室离子分析必需', 1],
  ['AIR', '根区增氧/回液曝气', '需验证各层根区溶氧；不同介质选择滴灌/液膜，不把全部作物当同一水培', 1],
  ['SV', '层间供液阀、调压与回液接头', '支路调流、排气、防虹吸、可拆洗；果菜与块茎采用介质滴灌示意', 'layers'],
  ['LED', '四条式补光灯及驱动', '每层四灯条；光子效率及冠层利用率是假设，需光谱/均匀度实测', 'bars'],
  ['PAR', '冠层PAR与温湿度测点', '每层预留测点；控制按模拟光周期/DLI和温度，不是联网实测', 'layers'],
  ['FAN', '层间循环风机', '每层预留混风设备；叶面风速、风量和风道需实测，当前没有CFD', 'layers'],
];
export const FARM_EQUIPMENT = Object.freeze([
  ...FARM_SITES.flatMap(s => common.map(([code,name,basis,quantity,role]) => Object.freeze({ id:`H${s.index+1}-${code}`, hallIndex:s.index, name,basis,quantity,role }))),
  ...FARM_RACKS.flatMap(r => circuit.map(([code,name,basis,qty]) => Object.freeze({ id:`${r.id.toUpperCase()}-${code}`, hallIndex:r.hallIndex, rackId:r.id, name,basis,
    quantity:qty==='layers'?r.layers:qty==='bars'?r.layers*4:qty,role:'rack' }))),
]);
export const FARM_PROCESS_STEPS = Object.freeze([
  { id:'source', title:'01 水源与预处理', text:'服务水接口 → 空气间隙补水 → 过滤/取样 → 净水缓冲。运河水不是饮用水或灌溉水的自动来源。', code:'TK / F', color:'water' },
  { id:'dose', title:'02 分架配肥', text:'净水 → A/B分罐计量 → 混液 → EC稳定后调pH。每架独立配方与回液，设止回、防虹吸和加药围堰。', code:'MX / DA / DB / PH', color:'nutrient' },
  { id:'root', title:'03 逐层灌溉与回液', text:'泵/过滤/压力监测 → 立管 → 每层调流阀与滴头/液膜槽 → 回液立管 → 本架过滤消毒 → 混液箱。根区设曝气。', code:'P / SV / AIR / UV / SN', color:'return' },
  { id:'light', title:'04 光、风与热', text:'每层四灯条、驱动与PAR测点；分作物光周期、调光和累计DLI。风机/除湿冷凝水经检测后回用，废热接外部散热。', code:'LED / PAR / HX', color:'light' },
  { id:'harvest', title:'05 采收与食品接收', text:'分盘吊运 → 接收辊台 → 模拟称重和批次交接 → 食品接收缓冲；异常残体隔离。果实精摘、清洗/干燥及合规冷库仍待设计。', code:'RC / QC', color:'harvest' },
]);
export function farmEquipmentFocus(id) {
  const equipment = typeof id === 'string' ? FARM_EQUIPMENT.find(e => e.id === id) : null;
  return equipment ? { id:equipment.id, hallIndex:equipment.hallIndex, rackId:equipment.rackId || `r${equipment.hallIndex*6}` } : null;
}
export const FARM_VALIDATION_GATES = Object.freeze([
  '地面先建2—3层、单一叶菜的可维护试验架；确认品种、介质和可食率，完成连续多批产量/品质/水电实测后再扩层。',
  '检测源水离子、碱度、病原；由农艺师计算各期元素配方和A/B母液，不以EC替代离子检测；校准pH/EC/DO/PAR测点。',
  '逐层测流量、压力、溶氧、漏水和排空；做断电、缺液、传感失效、消毒失效和恢复试验；设人工确认及独立安全回路。',
  '用灯具光谱/PPF/效率实测及冠层网格PAR验收DLI与均匀度；联测温湿度、蒸腾、除湿量、冷却负荷和备电时长。',
  '结构、满水荷载、抗震/旋转载荷、消防疏散、防坠、机电、食品卫生与废液处置由当地合格专业人员复核；32m并非可直接照建。',
  '完成可追溯播种、批次、清洁消毒、称量校准、食品取样和储运试验；当前鲜重库存不是可销售产量或合格食品证明。',
]);
export const FARM_ENGINEERING_SOURCES = Object.freeze([
  { title:'OSU：水质、EC与pH管理', url:'https://extension.okstate.edu/fact-sheets/electrical-conductivity-and-ph-guide-for-hydroponics' },
  { title:'Penn State：营养液程序与配方', url:'https://extension.psu.edu/hydroponics-systems-nutrient-solution-programs-and-recipes' },
  { title:'Cornell：CEA生菜栽培手册', url:'https://cea.cals.cornell.edu/files/2019/06/Cornell-CEA-Lettuce-Handbook-.pdf' },
  { title:'DOE：光照与温湿度系统联控', url:'https://integratedlightingcampaign.energy.gov/node/278' },
]);

export function farmEngineeringReport(state) {
  const circuits = FARM_RACKS.map(r => ({ id:r.id, hallIndex:r.hallIndex, crop:FARM_CROPS[r.cropId].name,
    layers:r.layers, areaM2:r.areaM2, hydraulics:farmHydraulics(r), lighting:farmLighting(r), bufferL:FARM_ENGINEERING.circuitBufferL,
    ecSetpointMsCm:FARM_CROPS[r.cropId].ec, phSetpoint:FARM_CROPS[r.cropId].ph,
    measuredEc:null, measuredPh:null, measuredDoMgL:null, measuredPpfd:null }));
  return { revision:FARM_ENGINEERING.revision,status:FARM_ENGINEERING.status,
    scope:'工艺概念与设备占位清单，非施工图、非采购规格、非现场测量，不含真实配肥操作剂量。',
    areaM2:FARM_TOTAL_AREA_M2, assumptions:{...FARM_ENGINEERING},
    missing:['管径/管材及水力平衡','A/B盐种、浓度、剂量和源水化验','消毒剂量及食品安全验证','风量、湿负荷和冷库容量','备电/独立安全回路','完整储库容量与结构机电施工图'],
    designLightingKw:circuits.reduce((a,r)=>a+r.lighting.installedKw,0),
    designPumpKw:circuits.reduce((a,r)=>a+r.hydraulics.pumpKw,0),
    designCirculationLPerHour:circuits.reduce((a,r)=>a+r.hydraulics.flowLPerHour,0),
    allocatedCircuitBufferL:circuits.length*FARM_ENGINEERING.circuitBufferL,
    inventoryWaterL:state?.waterL??null, receiptSequence:state?.receiptSequence??null,
    recentSimulatedReceipts:state?.receipts?.map(r=>({...r}))??[],
    waterAccounting:'缓冲箱/管道工作液是现有总水库存的分配，不是额外物资；舱底储库仍未完成工程设计。',
    process:FARM_PROCESS_STEPS, circuits,equipment:FARM_EQUIPMENT,validationGates:FARM_VALIDATION_GATES,sources:FARM_ENGINEERING_SOURCES };
}

// Deterministic spreadsheet-safe CSV; cells begin with controlled design data.
export function farmEquipmentCsv() {
  const cell = value => `"${String(value??'').replace(/"/g,'""')}"`;
  return '\uFEFF'+[['设备位号','生产舱','栽培架','设备名称','概念数量','选型与待验证边界'],...FARM_EQUIPMENT.map(e=>[e.id,e.hallIndex+1,e.rackId||'',e.name,e.quantity,e.basis])].map(row=>row.map(cell).join(',')).join('\r\n');
}
