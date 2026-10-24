import { FARM_RACKS, FARM_SITES, FARM_TOTAL_AREA_M2 } from './farmLayout.js';
import { FARM_CROPS, FARM_CROP_LIST } from './farmCrops.js';
import { sanitizeFarmState as sanitizeLegacy } from './farmLegacySimulation.js';
import { FARM_ENGINEERING, FARM_PROCESS_CONTROLS, farmProcessDefaults, farmProcessState, farmHydraulics, farmLighting } from './farmEngineering.js';

// Local engineering demonstrator. Recipes, yield, crop chemistry and control
// coefficients are DESIGN ASSUMPTIONS, not measured agronomic predictions.
// One wet-biomass approximation closes the mass book; grain drying, respiration,
// pollination biology, edible fractions and real image recognition are NOT solved.
const DAY=86400, WF=.92, MF=.015, CH=1-WF-MF, RW=CH*18/30, CO2=CH*44/30, O2=CH*32/30;
const INITIAL = Object.freeze({waterL:60000,nutrientsKg:400,co2Kg:600,seeds:240,importedFoodKg:24});
const initialRack = (layout,index) => {
  const c=FARM_CROPS[layout.cropId], empty=index%6===5, fraction=index===1 ? 1 : index===7 ? .82 : .35+(index%5)*.12;
  const targetKg=layout.areaM2*c.kgPerM2;
  return {id:layout.id,cropId:c.id,areaM2:layout.areaM2,targetKg,batchId:0,harvestedTrays:0,dailyLightMol:0,status:empty?'empty':index===1?'ready':'growing',ageSeconds:empty?0:c.durationSeconds*fraction,health:1,biomassKg:empty?0:targetKg*fraction};
};
const INITIAL_RACKS=FARM_RACKS.map(initialRack), INITIAL_MASS=INITIAL_RACKS.reduce((s,r)=>s+r.biomassKg,0);
export const FARM_SIM=Object.freeze({version:2,timeScale:3600,fixedStepSeconds:.1,maxAdvanceSeconds:600,
  rackIds:Object.freeze(FARM_RACKS.map(r=>r.id)),circulationLPerM2Hour:FARM_ENGINEERING.circulationLPerM2Hour,
  transpirationLPerM2Day:2.4,recoveryFraction:.95,supplyCapacityKw:1500,coolingCapacityKw:1100,coolingCop:3,
  thermalCapacityKWhPerC:6000,targetTemperatureC:24,waterFraction:WF,nutrientKgPerKg:MF,reactionWaterLPerKg:RW,
  co2KgPerKg:CO2,oxygenKgPerKg:O2,initialWaterL:INITIAL.waterL,initialNutrientsKg:INITIAL.nutrientsKg,
  initialCo2Kg:INITIAL.co2Kg,initialSeeds:INITIAL.seeds,initialImportedFoodKg:INITIAL.importedFoodKg,initialBiomassKg:INITIAL_MASS});
const FIELDS=['energyKWh','heatGeneratedKWh','heatRejectedKWh','grownBiomassKg','harvestedKg','wasteBiomassKg','waterCirculatedL','waterTranspiredL','waterRecoveredL','waterLostL','waterConvertedL','nutrientsUsedKg','co2UsedKg','oxygenProducedKg','seedPacketsUsed'];
const finite=(v,d=0)=>Number.isFinite(v)?v:d, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-6*Math.max(1,Math.abs(a),Math.abs(b));
const mass=s=>s.racks.reduce((sum,r)=>sum+r.biomassKg,0);
const cargo=s=>s.automation.jobs.reduce((sum,j)=>sum+(j?.loadKg||0),0);
const clone=s=>({...s,manifest:{...s.manifest},controls:{...farmProcessDefaults(),...s.controls},ledger:{...s.ledger},inventory:{...s.inventory},receipts:(s.receipts||[]).map(r=>({...r})),receiptSequence:s.receiptSequence||0,racks:s.racks.map(r=>({...r})),automation:{...s.automation,jobs:s.automation.jobs.map(j=>j?{...j}:null)}});
export function createFarmState(){return {version:2,tick:0,remainderSeconds:0,simSeconds:0,controls:{power:true,water:true,cooling:true,...farmProcessDefaults()},
 ...INITIAL,foodKg:0,waterL:INITIAL.waterL,nutrientsKg:INITIAL.nutrientsKg,co2Kg:INITIAL.co2Kg,temperatureC:24,
 manifest:{...INITIAL,biomassKg:INITIAL_MASS},racks:INITIAL_RACKS.map(r=>({...r})),ledger:Object.fromEntries(FIELDS.map(k=>[k,0])),
 inventory:Object.fromEntries(FARM_CROP_LIST.map(c=>[c.id,0])),receipts:[],receiptSequence:0,automation:{enabled:true,jobs:[null,null,null],completed:0,inspections:0,scanIndex:0},
 lastEvent:'扩建物资已登记；三座生产舱启用，自动调度等待运行。'};}
function migrate(data,onInvalid){
 let invalid=false;const old=sanitizeLegacy(data,{onInvalid:()=>{invalid=true;}});if(invalid){onInvalid?.();return createFarmState();}
 const s=createFarmState(), added=s.racks.slice(6).reduce((a,r)=>a+r.biomassKg,0);
 for(let i=0;i<6;i++){const r=old.racks[i];s.racks[i]={...s.racks[i],...r,cropId:FARM_RACKS[i].cropId,ageSeconds:r.ageSeconds/(24*DAY)*FARM_CROPS[FARM_RACKS[i].cropId].durationSeconds,areaM2:12,targetKg:12,batchId:0};}
 for(const key of ['tick','remainderSeconds','simSeconds','foodKg','controls','ledger'])s[key]=typeof old[key]==='object'?{...old[key]}:old[key];
 s.manifest={waterL:old.waterL+old.ledger.waterLostL+old.ledger.waterConvertedL+(12+old.ledger.grownBiomassKg)*WF+INITIAL.waterL-12*WF,
 nutrientsKg:6+INITIAL.nutrientsKg,co2Kg:20+INITIAL.co2Kg,seeds:48+INITIAL.seeds,importedFoodKg:24,biomassKg:12+added};
 s.waterL=old.waterL+INITIAL.waterL;s.nutrientsKg=old.nutrientsKg+INITIAL.nutrientsKg;s.co2Kg=old.co2Kg+INITIAL.co2Kg;s.seeds=old.seeds+INITIAL.seeds;
 s.controls={...farmProcessDefaults(),...s.controls};
 s.inventory.lettuce=old.foodKg;s.temperatureC=24+(s.ledger.heatGeneratedKWh-s.ledger.heatRejectedKWh)/FARM_SIM.thermalCapacityKWhPerC;
 s.lastEvent='旧试验存档已保留；扩建水肥、种子和新舱作物作为一次性物资入账，原批次仍按原12㎡规模采收。';
 return s;
}
export function sanitizeFarmState(data,{onInvalid}={}){
 const bad=()=>{onInvalid?.();return createFarmState();};
 if(data?.version===1)return migrate(data,onInvalid);
 if(!data||data.version!==2||!data.manifest||!data.ledger||!data.controls||!data.inventory||!data.automation||!Array.isArray(data.racks)||data.racks.length!==18)return bad();
 if(!Number.isSafeInteger(data.tick)||data.tick<0||data.tick>1e8||!Number.isFinite(data.remainderSeconds)||data.remainderSeconds<0||data.remainderSeconds>=.1||!close(data.simSeconds,data.tick*360))return bad();
 for(const key of ['power','water','cooling'])if(typeof data.controls[key]!=='boolean')return bad();
 for(const {key} of FARM_PROCESS_CONTROLS)if(data.controls[key]!==undefined&&typeof data.controls[key]!=='boolean')return bad();
 if(data.receipts!==undefined){
  if(!Array.isArray(data.receipts)||data.receipts.length>40||!Number.isSafeInteger(data.receiptSequence)||data.receiptSequence<0)return bad();
  if(data.receipts.length!==Math.min(40,data.receiptSequence))return bad();
  let previous=data.receiptSequence-data.receipts.length,total=0;for(const r of data.receipts){
   const layout=FARM_RACKS.find(l=>l.id===r?.rackId&&l.cropId===r?.cropId);
   if(!r||!Number.isSafeInteger(r.sequence)||r.sequence!==previous+1||r.sequence>data.receiptSequence||!layout||!Number.isSafeInteger(r.batchId)||r.batchId<0||!Number.isFinite(r.kg)||r.kg<=0||!Number.isFinite(r.simSeconds)||r.simSeconds<0||r.simSeconds>data.simSeconds||!['automatic','manual'].includes(r.method)||!(r.trayIndex===null||Number.isInteger(r.trayIndex)&&r.trayIndex>=0&&r.trayIndex<layout.layers*2))return bad();previous=r.sequence;total+=r.kg;
  }
  if(total>data.foodKg+1e-6)return bad();
 }
 else if(data.receiptSequence!==undefined)return bad();
 for(const key of ['waterL','nutrientsKg','co2Kg','seeds','importedFoodKg','biomassKg'])if(!Number.isFinite(data.manifest[key])||data.manifest[key]<0||data.manifest[key]>1e9)return bad();
 for(const key of ['waterL','nutrientsKg','co2Kg','foodKg','importedFoodKg','seeds'])if(!Number.isFinite(data[key])||data[key]<0||data[key]>1e9)return bad();
 if(!Number.isInteger(data.seeds)||!Number.isFinite(data.temperatureC))return bad();
 for(const key of FIELDS)if(!Number.isFinite(data.ledger[key])||data.ledger[key]<0||data.ledger[key]>1e12)return bad();
 const a=data.automation;
 if(typeof a.enabled!=='boolean'||!Array.isArray(a.jobs)||a.jobs.length!==3||![a.completed,a.inspections,a.scanIndex].every(n=>Number.isSafeInteger(n)&&n>=0))return bad();
 const occupied=new Set();
 for(let i=0;i<18;i++){const r=data.racks[i],layout=FARM_RACKS[i],c=FARM_CROPS[r?.cropId];
  if(!r||r.id!==layout.id||!c||!Number.isSafeInteger(r.batchId)||r.batchId<0||!['empty','growing','ready','failed'].includes(r.status)||!Number.isFinite(r.areaM2)||r.areaM2<=0||r.areaM2>layout.areaM2+.001||!Number.isFinite(r.targetKg)||r.targetKg<=0||r.targetKg>layout.areaM2*5+.001||!Number.isFinite(r.ageSeconds)||r.ageSeconds<0||r.ageSeconds>c.durationSeconds||!Number.isFinite(r.health)||r.health<0||r.health>1||!Number.isInteger(r.harvestedTrays)||r.harvestedTrays<0||r.harvestedTrays>=layout.layers*2||!close(r.biomassKg,r.targetKg*r.ageSeconds/c.durationSeconds*(1-r.harvestedTrays/(layout.layers*2))))return bad();
  if(!Number.isFinite(r.dailyLightMol)||r.dailyLightMol<0||r.dailyLightMol>1000)return bad();
  if(r.status==='empty'&&(r.ageSeconds!==0||r.biomassKg!==0||r.health!==1)||r.status==='ready'&&(r.ageSeconds!==c.durationSeconds||r.health<=0)||r.status==='growing'&&(r.ageSeconds>=c.durationSeconds||r.health<=0)||r.status==='failed'&&r.health!==0)return bad();
 }
 for(let i=0;i<3;i++){const j=a.jobs[i];if(!j)continue;
  if(!['harvest','sow','inspect'].includes(j.type)||!FARM_CROPS[j.cropId]||!FARM_RACKS.some(r=>r.id===j.rackId&&r.hallIndex===i)||occupied.has(j.rackId)||!Number.isSafeInteger(j.batchId)||j.batchId<0||!Number.isFinite(j.elapsed)||j.elapsed<0||j.elapsed>120||!Number.isSafeInteger(j.tier)||j.tier<0||j.tier>=FARM_RACKS.find(r=>r.id===j.rackId).layers||!Number.isFinite(j.loadKg)||j.loadKg<0||j.loadKg>2000||typeof j.picked!=='boolean'||typeof j.delivered!=='boolean'||!Number.isInteger(j.trayIndex)||j.trayIndex<0||j.trayIndex>=24||j.type!=='harvest'&&j.loadKg!==0)return bad();occupied.add(j.rackId);
 }
 const l=data.ledger,total=mass(data)+cargo(data)+data.foodKg+l.wasteBiomassKg;
 if(!close(total,data.manifest.biomassKg+l.grownBiomassKg)||!close(data.foodKg,l.harvestedKg)||!close(data.nutrientsKg+l.nutrientsUsedKg,data.manifest.nutrientsKg)||!close(data.co2Kg+l.co2UsedKg,data.manifest.co2Kg)||!close(data.seeds+l.seedPacketsUsed,data.manifest.seeds)||!close(data.importedFoodKg,data.manifest.importedFoodKg)||!close(l.nutrientsUsedKg,l.grownBiomassKg*MF)||!close(l.co2UsedKg,l.grownBiomassKg*CO2)||!close(l.oxygenProducedKg,l.grownBiomassKg*O2)||!close(l.waterConvertedL,l.grownBiomassKg*RW)||!close(l.waterTranspiredL,l.waterRecoveredL+l.waterLostL)||!close(data.waterL+total*WF+l.waterLostL+l.waterConvertedL,data.manifest.waterL+data.manifest.biomassKg*WF)||!close(l.energyKWh,l.heatGeneratedKWh)||l.heatRejectedKWh>l.heatGeneratedKWh+1e-5||!close(data.temperatureC,24+(l.heatGeneratedKWh-l.heatRejectedKWh)/FARM_SIM.thermalCapacityKWhPerC))return bad();
 let stock=0;for(const c of FARM_CROP_LIST){if(!Number.isFinite(data.inventory[c.id])||data.inventory[c.id]<0)return bad();stock+=data.inventory[c.id];}if(!close(stock,data.foodKg))return bad();
 return clone(data);
}
export function farmLightOn(state,rack=null){return state?.controls?.power===true&&(state.simSeconds%DAY)/3600<(FARM_CROPS[rack?.cropId]?.lightHours??16);}
export function farmLightFactor(s){return !s?.controls?.power?0:!s.automation?.enabled?1:s.temperatureC>=36?0:s.temperatureC>=32?.2:s.temperatureC>=28?.6:1;}
function operatingState(s){
 const dim=farmLightFactor(s);
 const process=farmProcessState(s),active=s.racks.filter(r=>['growing','ready'].includes(r.status)),pump=process.irrigation;
 const ledKw=s.controls.power?s.racks.reduce((sum,r)=>sum+(r.status==='growing'&&farmLightOn(s,r)?farmLighting(FARM_RACKS.find(l=>l.id===r.id),FARM_CROPS[r.cropId],r.areaM2).installedKw*dim:0),0):0;
 const pumpKw=pump?active.reduce((sum,r)=>sum+farmHydraulics(FARM_RACKS.find(l=>l.id===r.id)).pumpKw*r.areaM2/FARM_RACKS.find(l=>l.id===r.id).areaM2,0):0;
 const robotKw=process.receiving&&s.automation.enabled?s.automation.jobs.filter(Boolean).length*25:0;
 // Lumped 8kW allowance for fans, treatment, dosing and controls; not final sizing.
 const baseKw=s.controls.power?8+ledKw+pumpKw+robotKw:0;
 const stored=Math.max(0,s.ledger.heatGeneratedKWh-s.ledger.heatRejectedKWh),hours=.1;
 const capacity=s.controls.power&&s.controls.cooling?Math.min(1100,Math.max(0,1500-baseKw)*3):0;
 const coolingKw=Math.min(capacity,baseKw+stored/hours),compressorKw=coolingKw/3;
 return {dim,active,pump,process,pumpKw,baseKw,ledKw,robotKw,coolingKw,compressorKw,powerKw:baseKw+compressorKw};
}
function clear(r){r.harvestedTrays=0;r.status='empty';r.ageSeconds=0;r.biomassKg=0;r.health=1;}
function sow(s,r){if(r.status!=='empty'||s.seeds<1||!farmProcessState(s).irrigation||s.co2Kg<=0)return false;const l=FARM_RACKS.find(l=>l.id===r.id);r.cropId=l.cropId;r.areaM2=l.areaM2;r.targetKg=r.areaM2*FARM_CROPS[r.cropId].kgPerM2;r.batchId++;r.status='growing';s.seeds--;s.ledger.seedPacketsUsed++;return true;}
function deliver(s,cropId,kg,metadata){
 s.foodKg+=kg;s.inventory[cropId]+=kg;s.ledger.harvestedKg+=kg;
 s.receiptSequence++;s.receipts.push({sequence:s.receiptSequence,simSeconds:s.simSeconds,cropId,kg,...metadata});
 if(s.receipts.length>40)s.receipts.shift();
}
export function farmJobTiming(job){
 const rack=FARM_RACKS.find(r=>r.id===job.rackId),site=FARM_SITES[rack.hallIndex];
 const homeX=-69.6,homeZ=site.z+9.5,targetX=rack.x+(job.trayIndex%2?1.8:-1.8),targetY=rack.tierHeights[job.tier]+.8;
 const travel=Math.hypot(targetX-homeX,rack.z-homeZ)/2,lift=(30-targetY)/1.5,dropLift=(30-3.6)/1.5;
 const pickAt=travel+lift+3,returnAt=pickAt+lift,dropAt=returnAt+travel,deliverAt=dropAt+dropLift+3;
 return {travel,lift,pickAt,returnAt,dropAt,deliverAt,dropLift,duration:deliverAt+dropLift,targetX,targetY,targetZ:rack.z,homeX,homeZ};
}
function automate(s){
 if(!farmProcessState(s).receiving||!s.automation.enabled)return;
 for(let h=0;h<3;h++){
  let j=s.automation.jobs[h];
  if(!j){const racks=s.racks.filter((r,i)=>FARM_RACKS[i].hallIndex===h),r=racks.find(r=>r.status==='ready')||racks.find(r=>r.status==='empty'&&s.seeds>0&&farmProcessState(s).irrigation)||racks.filter(r=>r.status==='growing')[s.automation.scanIndex%Math.max(1,racks.filter(r=>r.status==='growing').length)];if(!r)continue;
    j={rackId:r.id,cropId:r.cropId,batchId:r.batchId,type:r.status==='ready'?'harvest':r.status==='empty'?'sow':'inspect',elapsed:0,loadKg:0,picked:false,delivered:false,trayIndex:r.harvestedTrays,tier:r.status==='ready'?Math.floor(r.harvestedTrays/2):s.automation.completed%FARM_RACKS.find(l=>l.id===r.id).layers};s.automation.jobs[h]=j;s.automation.scanIndex++;
  }
  const r=s.racks.find(r=>r.id===j.rackId);const timing=farmJobTiming(j);j.elapsed=Math.min(timing.duration,j.elapsed+.1);
  if(j.type==='harvest'&&!j.picked&&j.elapsed>=timing.pickAt){
    if(r.status!=='ready'||r.batchId!==j.batchId){s.automation.jobs[h]=null;continue;}
    const layout=FARM_RACKS.find(l=>l.id===r.id);j.loadKg=r.targetKg/(layout.layers*2);j.picked=true;r.harvestedTrays++;r.biomassKg=Math.max(0,r.targetKg*(1-r.harvestedTrays/(layout.layers*2)));if(r.harvestedTrays>=layout.layers*2)clear(r);
  }
  if(j.type==='harvest'&&j.picked&&!j.delivered&&j.elapsed>=timing.deliverAt){const kg=j.loadKg;deliver(s,j.cropId,kg,{rackId:j.rackId,batchId:j.batchId,trayIndex:j.trayIndex,method:'automatic'});j.loadKg=0;j.delivered=true;s.lastEvent=`${FARM_CROPS[j.cropId].name} ${kg.toFixed(1)} kg 已完成模拟称重和批次交接，进入食品接收库存。`;}
  if(j.elapsed>=timing.duration){
    if(j.type==='harvest'&&j.delivered){s.lastEvent=`自动托盘作业完成：${FARM_CROPS[j.cropId].name} 已入库，升降机返回待命。`;}
    else if(j.type==='sow'&&r.batchId===j.batchId)sow(s,r);
    else if(j.type==='inspect')s.automation.inspections++;
    s.automation.completed++;s.automation.jobs[h]=null;
  }
 }
}
function step(s){
 if(s.simSeconds%DAY===0)for(const r of s.racks)r.dailyLightMol=0;
 const op=operatingState(s),l=s.ledger,days=360/DAY;
 const wants=op.active.map(r=>{const c=FARM_CROPS[r.cropId],lit=farmLightOn(s,r),factor=clamp((40-s.temperatureC)/12,0,1);
  const age=r.status==='growing'&&op.pump&&lit&&s.nutrientsKg>0&&s.co2Kg>0?Math.min(c.durationSeconds-r.ageSeconds,360*24/c.lightHours*factor*r.health*op.dim):0;
  const biomass=age/c.durationSeconds*r.targetKg,transpired=op.pump?r.areaM2*(1-r.harvestedTrays/(FARM_RACKS.find(l=>l.id===r.id).layers*2))*2.4*days*(lit?1:.25):0,recovered=op.coolingKw>0?transpired*.95:0;
  return {r,age,biomass,transpired,recovered,water:biomass*(WF+RW)+transpired-recovered};});
 const water=wants.reduce((a,w)=>a+w.water,0),b=wants.reduce((a,w)=>a+w.biomass,0),allocation=clamp(Math.min(water?s.waterL/water:1,b?s.nutrientsKg/(b*MF):1,b?s.co2Kg/(b*CO2):1),0,1);
 for(const w of wants){const r=w.r,kg=w.biomass*allocation,trans=w.transpired*allocation,rec=w.recovered*allocation;
  if(r.status==='growing'&&farmLightOn(s,r))r.dailyLightMol+=FARM_CROPS[r.cropId].ppfd*op.dim*360/1e6;
  r.ageSeconds=Math.min(FARM_CROPS[r.cropId].durationSeconds,r.ageSeconds+w.age*allocation);r.biomassKg=r.targetKg*r.ageSeconds/FARM_CROPS[r.cropId].durationSeconds*(1-r.harvestedTrays/(FARM_RACKS.find(l=>l.id===r.id).layers*2));
  s.waterL=Math.max(0,s.waterL-w.water*allocation);s.nutrientsKg=Math.max(0,s.nutrientsKg-kg*MF);s.co2Kg=Math.max(0,s.co2Kg-kg*CO2);
  l.grownBiomassKg+=kg;l.waterTranspiredL+=trans;l.waterRecoveredL+=rec;l.waterLostL+=trans-rec;l.waterConvertedL+=kg*RW;l.nutrientsUsedKg+=kg*MF;l.co2UsedKg+=kg*CO2;l.oxygenProducedKg+=kg*O2;
  if(op.pump)l.waterCirculatedL+=r.areaM2*FARM_SIM.circulationLPerM2Hour*.1*allocation;
  const stress=(!s.controls.power?.09:0)+(!op.pump||allocation<.999?.12:0)+((s.nutrientsKg<1e-9||s.co2Kg<1e-9)&&r.status==='growing'?.04:0)+Math.max(0,s.temperatureC-30)/10*.08;
  r.health=clamp(r.health-stress*days,0,1);
  if(r.health<=1e-9){r.health=0;r.status='failed';}else if(r.ageSeconds>=FARM_CROPS[r.cropId].durationSeconds-1e-6){r.ageSeconds=FARM_CROPS[r.cropId].durationSeconds;r.biomassKg=r.targetKg*(1-r.harvestedTrays/(FARM_RACKS.find(l=>l.id===r.id).layers*2));r.status='ready';}
 }
 l.energyKWh+=op.powerKw*.1;l.heatGeneratedKWh+=op.powerKw*.1;l.heatRejectedKWh+=(op.coolingKw+op.compressorKw)*.1;
 s.temperatureC=24+(l.heatGeneratedKWh-l.heatRejectedKWh)/6000;
 automate(s);s.tick++;s.simSeconds=s.tick*360;
}
export function advanceFarm(input,realSeconds){const s=sanitizeFarmState(input),micros=Math.round(s.remainderSeconds*1e6)+Math.round(clamp(finite(realSeconds),0,600)*1e6),count=Math.floor(micros/100000);s.remainderSeconds=micros%100000/1e6;for(let i=0;i<count;i++)step(s);return s;}
export function performFarmAction(input,action){const s=sanitizeFarmState(input);if(!action||typeof action!=='object')return s;
 if(['power','water','cooling'].includes(action.type)&&typeof action.enabled==='boolean'){s.controls[action.type]=action.enabled;s.lastEvent=`${{power:'供电',water:'循环供液',cooling:'外部冷却'}[action.type]}已${action.enabled?'接通':'断开'}。`;return s;}
 const processControl=FARM_PROCESS_CONTROLS.find(c=>c.key===action.type);
 if(processControl&&typeof action.enabled==='boolean'){s.controls[action.type]=action.enabled;s.lastEvent=`${processControl.name}已${action.enabled?'接通':'关闭'}。${action.enabled?'按联锁条件恢复运行。':processControl.consequence}`;return s;}
 if(action.type==='automation'&&typeof action.enabled==='boolean'){s.automation.enabled=action.enabled;s.lastEvent=`自动调度已${action.enabled?'开启':'暂停'}；暂停不丢弃运输中的作物。`;return s;}
 const r=s.racks.find(r=>r.id===action.rackId);if(!r)return s;
 if(s.automation.jobs.some(j=>j?.rackId===r.id)){s.lastEvent='该栽培架已有自动作业，请等待卸货完成；可暂停观察，但不会重复采收。';return s;}
 if(action.type==='sow')sow(s,r);
 else if(action.type==='harvest'&&r.status==='ready'){if(!farmProcessState(s).receiving){s.lastEvent='接收线未许可，禁止人工绕过联锁入库。';return s;}const kg=r.biomassKg;deliver(s,r.cropId,kg,{rackId:r.id,batchId:r.batchId,trayIndex:null,method:'manual'});clear(r);s.lastEvent=`${FARM_CROPS[r.cropId].name} ${kg.toFixed(1)} kg 已人工确认入库。`;}
 else if(action.type==='clearFailed'&&r.status==='failed'){s.ledger.wasteBiomassKg+=r.biomassKg;clear(r);s.lastEvent='失败批次已隔离封存，不返还水肥。';}
 return s;}
export function farmTelemetry(input){const s=sanitizeFarmState(input),op=operatingState(s),l=s.ledger,alerts=[];
 if(!s.controls.power)alerts.push('停电：照明、泵与自动设备停止，作物逐步受损。');
 if(!s.controls.water)alerts.push('循环供液中断，生长暂停。');if(!s.controls.cooling)alerts.push('冷却关闭，废热和湿气不再外送回收。');
 if(!op.process.irrigation)alerts.push(`供液联锁：${op.process.reason}；供液泵和投加停止。`);
 if(!op.process.receiving)alerts.push('接收线未许可：自动机械与人工入库暂停，在途作物保留。');
 if(s.waterL<5000)alerts.push('水储备低；没有无限自动补给。');if(s.co2Kg<20||s.nutrientsKg<20)alerts.push('CO₂ 或营养盐储备低。');if(s.temperatureC>30)alerts.push('环境过热，作物减产并受损。');if(s.racks.some(r=>r.status==='failed'))alerts.push('有失败批次待隔离清理。');
 return {...Object.fromEntries(['waterL','nutrientsKg','co2Kg','seeds','foodKg','importedFoodKg','temperatureC'].map(k=>[k,s[k]])),
 ...Object.fromEntries(FIELDS.map(k=>[k,l[k]])),timeScale:3600,simDays:s.simSeconds/DAY,lightOn:farmLightOn(s),powerKw:op.powerKw,coolingKw:op.coolingKw,robotKw:op.robotKw,lightFactor:op.dim,
 ledKw:op.ledKw,pumpKw:op.pumpKw,flowLPerHour:op.pump?op.active.reduce((a,r)=>a+r.areaM2*FARM_SIM.circulationLPerM2Hour,0):0,process:op.process,receipts:s.receipts.map(r=>({...r})),receiptSequence:s.receiptSequence,
 heatStoredKWh:Math.max(0,l.heatGeneratedKWh-l.heatRejectedKWh),waterInCropsL:mass(s)*WF,waterInFoodL:s.foodKg*WF,waterInWasteL:l.wasteBiomassKg*WF,
 commissionedAreaM2:FARM_TOTAL_AREA_M2,occupiedAreaM2:s.racks.filter(r=>r.status!=='empty').reduce((a,r)=>a+r.areaM2*(1-r.harvestedTrays/(FARM_RACKS.find(l=>l.id===r.id).layers*2)),0),inventory:{...s.inventory},cargoKg:cargo(s),automation:s.automation,controls:{...s.controls},
 racks:s.racks.map((r,i)=>({...r,hallIndex:FARM_RACKS[i].hallIndex,layers:FARM_RACKS[i].layers,name:FARM_CROPS[r.cropId].name,progress:r.ageSeconds/FARM_CROPS[r.cropId].durationSeconds,
 canSow:r.status==='empty'&&s.seeds>0&&op.process.irrigation&&s.co2Kg>0,canHarvest:r.status==='ready'&&op.process.receiving,canClear:r.status==='failed',busy:s.automation.jobs.some(j=>j?.rackId===r.id)})),
 alerts,summary:'本机农业园 · 分作物配方与真实资源台账 · 规则控制与机械作业仿真，不是实测农业或AI识别',lastEvent:s.lastEvent};}
