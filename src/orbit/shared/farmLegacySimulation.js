/**
 * Local-only commissioning experiment, not the multiplayer city's economy.
 * All rates below are declared DESIGN ASSUMPTIONS, not measured crop yields.
 * The six commissioned trays total 72 m²; spare building capacity is not counted.
 *
 * Biomass approximation: 92% tissue water, 1.5% minerals, 6.5% CH2O.
 * CO2 + H2O -> CH2O + O2 supplies the organic fraction. This closes the
 * demonstrator's mass ledger, but omits respiration, trace elements and biology.
 * Electricity arrives through a temporary service connection, NOT computed solar
 * output. Cooling includes compressor electricity and rejects heat externally.
 * Conservatively all electricity becomes heat; chemical energy storage is omitted.
 * Unrecovered vapour and generated oxygen are OUTPUTS across the FARM boundary,
 * not disappearance into vacuum or a completed station air-recovery system.
 * Seed-packet trace mass, food spoilage and municipal gas handling are not modeled.
 */
const DAY = 86400;
const INITIAL_BIOMASS = 12;
const WATER_FRACTION = .92;
const MINERAL_FRACTION = .015;
const CARBOHYDRATE_FRACTION = 1 - WATER_FRACTION - MINERAL_FRACTION;
const REACTION_WATER = CARBOHYDRATE_FRACTION * 18 / 30;
const CO2_PER_KG = CARBOHYDRATE_FRACTION * 44 / 30;
const OXYGEN_PER_KG = CARBOHYDRATE_FRACTION * 32 / 30;
const STEP_MICROSECONDS = 100000;

export const FARM_SIM = Object.freeze({
  version: 1,
  timeScale: 3600,
  fixedStepSeconds: .1,
  maxAdvanceSeconds: 600,
  cropDurationSeconds: 24 * DAY,
  rackIds: Object.freeze(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']),
  cropAreaM2: 12,
  yieldKg: 12,
  lightHoursPerDay: 16,
  ledKwPerRack: 2.4,
  pumpKwPerRack: .1,
  circulationLPerHour: 20,
  transpirationLPerM2Day: 2.4,
  recoveryFraction: .85,
  supplyCapacityKw: 24,
  coolingCapacityKw: 18,
  coolingCop: 3,
  thermalCapacityKWhPerC: 100,
  targetTemperatureC: 24,
  waterFraction: WATER_FRACTION,
  nutrientKgPerKg: MINERAL_FRACTION,
  reactionWaterLPerKg: REACTION_WATER,
  co2KgPerKg: CO2_PER_KG,
  oxygenKgPerKg: OXYGEN_PER_KG,
  initialWaterL: 1800,
  initialNutrientsKg: 6,
  initialCo2Kg: 20,
  initialSeeds: 48,
  initialImportedFoodKg: 24,
  initialBiomassKg: INITIAL_BIOMASS,
});

const LEDGER_FIELDS = [
  'energyKWh', 'heatGeneratedKWh', 'heatRejectedKWh', 'grownBiomassKg',
  'harvestedKg', 'wasteBiomassKg', 'waterCirculatedL', 'waterTranspiredL',
  'waterRecoveredL', 'waterLostL', 'waterConvertedL', 'nutrientsUsedKg',
  'co2UsedKg', 'oxygenProducedKg', 'seedPacketsUsed',
];
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const close = (a, b) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b));
const mass = racks => racks.reduce((sum, rack) => sum + rack.biomassKg, 0);
const clone = state => ({
  ...state, controls: { ...state.controls },
  racks: state.racks.map(rack => ({ ...rack })), ledger: { ...state.ledger },
});
const emptyRack = id => ({ id, status: 'empty', ageSeconds: 0, health: 1, biomassKg: 0 });

export function createFarmState() {
  return {
    version: FARM_SIM.version, tick: 0, remainderSeconds: 0, simSeconds: 0,
    controls: { power: true, water: true, cooling: true },
    waterL: FARM_SIM.initialWaterL, nutrientsKg: FARM_SIM.initialNutrientsKg,
    co2Kg: FARM_SIM.initialCo2Kg, seeds: FARM_SIM.initialSeeds,
    importedFoodKg: FARM_SIM.initialImportedFoodKg, foodKg: 0,
    temperatureC: FARM_SIM.targetTemperatureC,
    racks: FARM_SIM.rackIds.map((id, index) => index < 2
      ? { id, status: 'growing', ageSeconds: (index + 1) * 8 * DAY, health: 1, biomassKg: (index + 1) * 4 }
      : emptyRack(id)),
    ledger: Object.fromEntries(LEDGER_FIELDS.map(key => [key, 0])),
    lastEvent: '调试物资已登记：两批在育苗，另四组种植架待播种。',
  };
}

/**
 * Reject corrupt/inconsistent snapshots rather than repairing them into crops.
 * This protects local persistence, not against an owner deliberately forging a
 * coherent save. No localStorage state is trusted by a multiplayer server.
 */
export function sanitizeFarmState(data, { onInvalid } = {}) {
  const invalid = () => {
    if (typeof onInvalid === 'function') onInvalid();
    return createFarmState();
  };
  if (!data || data.version !== FARM_SIM.version || !data.controls || !data.ledger
    || !Array.isArray(data.racks) || data.racks.length !== 6) return invalid();
  if (!Number.isSafeInteger(data.tick) || data.tick < 0 || data.tick > 1e8
    || !Number.isFinite(data.remainderSeconds) || data.remainderSeconds < 0
    || data.remainderSeconds >= FARM_SIM.fixedStepSeconds
    || !close(data.simSeconds, data.tick * FARM_SIM.fixedStepSeconds * FARM_SIM.timeScale)) return invalid();
  for (const key of ['power', 'water', 'cooling']) if (typeof data.controls[key] !== 'boolean') return invalid();
  for (const key of ['waterL', 'nutrientsKg', 'co2Kg', 'foodKg', 'importedFoodKg']) {
    if (!Number.isFinite(data[key]) || data[key] < 0 || data[key] > 1e9) return invalid();
  }
  if (!Number.isInteger(data.seeds) || data.seeds < 0 || data.seeds > FARM_SIM.initialSeeds
    || !Number.isFinite(data.temperatureC)) return invalid();
  for (const key of LEDGER_FIELDS) {
    if (!Number.isFinite(data.ledger[key]) || data.ledger[key] < 0 || data.ledger[key] > 1e12) return invalid();
  }
  if (!Number.isInteger(data.ledger.seedPacketsUsed)
    || data.seeds + data.ledger.seedPacketsUsed !== FARM_SIM.initialSeeds) return invalid();
  for (let index = 0; index < 6; index += 1) {
    const rack = data.racks[index];
    if (!rack || rack.id !== FARM_SIM.rackIds[index]
      || !['empty', 'growing', 'ready', 'failed'].includes(rack.status)
      || !Number.isFinite(rack.health) || rack.health < 0 || rack.health > 1
      || !Number.isFinite(rack.ageSeconds) || rack.ageSeconds < 0 || rack.ageSeconds > FARM_SIM.cropDurationSeconds
      || !Number.isFinite(rack.biomassKg) || rack.biomassKg < 0 || rack.biomassKg > FARM_SIM.yieldKg
      || !close(rack.biomassKg, rack.ageSeconds / FARM_SIM.cropDurationSeconds * FARM_SIM.yieldKg)) return invalid();
    if (rack.status === 'empty' && (rack.ageSeconds !== 0 || rack.biomassKg !== 0 || rack.health !== 1)) return invalid();
    if (rack.status === 'ready' && (rack.ageSeconds !== FARM_SIM.cropDurationSeconds || rack.health <= 0)) return invalid();
    if (rack.status === 'growing' && (rack.ageSeconds >= FARM_SIM.cropDurationSeconds || rack.health <= 0)) return invalid();
    if (rack.status === 'failed' && rack.health !== 0) return invalid();
    // Neither initial plants nor subsequent sowings can age faster than the clock.
    const initialAge = index < 2 ? (index + 1) * 8 * DAY : 0;
    if (rack.ageSeconds > initialAge + data.simSeconds * 24 / FARM_SIM.lightHoursPerDay + 1e-5) return invalid();
  }
  const ledger = data.ledger, cropMass = mass(data.racks);
  const totalBiomass = cropMass + data.foodKg + ledger.wasteBiomassKg;
  if (!close(totalBiomass, INITIAL_BIOMASS + ledger.grownBiomassKg)
    || !close(data.foodKg, ledger.harvestedKg)
    || !close(data.importedFoodKg, FARM_SIM.initialImportedFoodKg)
    || !close(data.nutrientsKg + ledger.nutrientsUsedKg, FARM_SIM.initialNutrientsKg)
    || !close(ledger.nutrientsUsedKg, ledger.grownBiomassKg * MINERAL_FRACTION)
    || !close(data.co2Kg + ledger.co2UsedKg, FARM_SIM.initialCo2Kg)
    || !close(ledger.co2UsedKg, ledger.grownBiomassKg * CO2_PER_KG)
    || !close(ledger.oxygenProducedKg, ledger.grownBiomassKg * OXYGEN_PER_KG)
    || !close(ledger.waterConvertedL, ledger.grownBiomassKg * REACTION_WATER)
    || !close(ledger.waterTranspiredL, ledger.waterRecoveredL + ledger.waterLostL)
    || !close(data.waterL + totalBiomass * WATER_FRACTION + ledger.waterLostL + ledger.waterConvertedL,
      FARM_SIM.initialWaterL + INITIAL_BIOMASS * WATER_FRACTION)
    || !close(ledger.energyKWh, ledger.heatGeneratedKWh)
    || ledger.heatRejectedKWh > ledger.heatGeneratedKWh + 1e-5
    || !close(data.temperatureC, FARM_SIM.targetTemperatureC
      + (ledger.heatGeneratedKWh - ledger.heatRejectedKWh) / FARM_SIM.thermalCapacityKWhPerC)) return invalid();
  const state = clone(data);
  state.lastEvent = typeof data.lastEvent === 'string' ? data.lastEvent.slice(0, 160) : '';
  return state;
}

/** Fast visual predicate; state must already come from this simulation. */
export function farmLightOn(state) {
  return state.controls.power && (state.simSeconds % DAY) / 3600 < FARM_SIM.lightHoursPerDay;
}

function operatingState(state) {
  const lit = farmLightOn(state);
  const active = state.racks.filter(rack => rack.status === 'growing' || rack.status === 'ready');
  const growing = active.filter(rack => rack.status === 'growing');
  const pump = state.controls.power && state.controls.water && state.waterL > 1e-9;
  const baseKw = state.controls.power
    ? .8 + (lit ? growing.length * FARM_SIM.ledKwPerRack : 0)
      + (pump ? active.length * FARM_SIM.pumpKwPerRack : 0) : 0;
  const coolingCapacity = state.controls.power && state.controls.cooling
    ? Math.min(FARM_SIM.coolingCapacityKw, Math.max(0, FARM_SIM.supplyCapacityKw - baseKw) * FARM_SIM.coolingCop) : 0;
  const storedHeat = Math.max(0, state.ledger.heatGeneratedKWh - state.ledger.heatRejectedKWh);
  const hours = FARM_SIM.fixedStepSeconds * FARM_SIM.timeScale / 3600;
  const coolingKw = Math.min(coolingCapacity, baseKw + storedHeat / hours);
  const compressorKw = coolingKw / FARM_SIM.coolingCop;
  return { lit, active, growing, pump, baseKw, coolingKw, compressorKw, powerKw: baseKw + compressorKw };
}

function step(state) {
  const seconds = FARM_SIM.fixedStepSeconds * FARM_SIM.timeScale, days = seconds / DAY, hours = seconds / 3600;
  const operations = operatingState(state), ledger = state.ledger;
  const temperatureFactor = clamp((40 - state.temperatureC) / 12, 0, 1);
  const growthAllowed = operations.pump && operations.lit && state.nutrientsKg > 1e-10 && state.co2Kg > 1e-10;
  const desired = operations.active.map(rack => {
    const age = growthAllowed && rack.status === 'growing'
      ? Math.min(FARM_SIM.cropDurationSeconds - rack.ageSeconds,
        seconds * 24 / FARM_SIM.lightHoursPerDay * temperatureFactor * rack.health) : 0;
    const biomass = age / FARM_SIM.cropDurationSeconds * FARM_SIM.yieldKg;
    const transpired = operations.pump
      ? FARM_SIM.cropAreaM2 * FARM_SIM.transpirationLPerM2Day * days * (operations.lit ? 1 : .25) : 0;
    const recovered = operations.coolingKw > 0 ? transpired * FARM_SIM.recoveryFraction : 0;
    return { rack, age, biomass, transpired, recovered,
      water: biomass * (WATER_FRACTION + REACTION_WATER) + transpired - recovered };
  });
  const wantedWater = desired.reduce((sum, item) => sum + item.water, 0);
  const wantedBiomass = desired.reduce((sum, item) => sum + item.biomass, 0);
  const allocation = clamp(Math.min(
    wantedWater > 0 ? state.waterL / wantedWater : 1,
    wantedBiomass > 0 ? state.nutrientsKg / (wantedBiomass * MINERAL_FRACTION) : 1,
    wantedBiomass > 0 ? state.co2Kg / (wantedBiomass * CO2_PER_KG) : 1,
  ), 0, 1);
  for (const item of desired) {
    const { rack } = item;
    const biomass = item.biomass * allocation, transpired = item.transpired * allocation;
    const recovered = item.recovered * allocation;
    rack.ageSeconds = Math.min(FARM_SIM.cropDurationSeconds, rack.ageSeconds + item.age * allocation);
    rack.biomassKg = rack.ageSeconds / FARM_SIM.cropDurationSeconds * FARM_SIM.yieldKg;
    state.waterL = Math.max(0, state.waterL - item.water * allocation);
    state.nutrientsKg = Math.max(0, state.nutrientsKg - biomass * MINERAL_FRACTION);
    state.co2Kg = Math.max(0, state.co2Kg - biomass * CO2_PER_KG);
    ledger.grownBiomassKg += biomass;
    ledger.waterTranspiredL += transpired;
    ledger.waterRecoveredL += recovered;
    ledger.waterLostL += transpired - recovered;
    ledger.waterConvertedL += biomass * REACTION_WATER;
    ledger.nutrientsUsedKg += biomass * MINERAL_FRACTION;
    ledger.co2UsedKg += biomass * CO2_PER_KG;
    ledger.oxygenProducedKg += biomass * OXYGEN_PER_KG;
    if (operations.pump) ledger.waterCirculatedL += FARM_SIM.circulationLPerHour * hours * allocation;
    const drought = !operations.pump || allocation < .999;
    const nutrientStarvation = rack.status === 'growing'
      && (state.nutrientsKg < 1e-9 || state.co2Kg < 1e-9);
    const thermalStress = Math.max(0, state.temperatureC - 30) / 10;
    const stressPerDay = (!state.controls.power ? .09 : 0) + (drought ? .12 : 0)
      + (nutrientStarvation ? .04 : 0) + thermalStress * .08;
    rack.health = clamp(rack.health - stressPerDay * days, 0, 1);
    if (rack.health <= 1e-9) {
      rack.health = 0;
      rack.status = 'failed';
    } else if (rack.ageSeconds >= FARM_SIM.cropDurationSeconds - 1e-6) {
      rack.status = 'ready';
      // Exact maturity avoids save/load ambiguity from floating point accumulation.
      rack.ageSeconds = FARM_SIM.cropDurationSeconds;
      rack.biomassKg = FARM_SIM.yieldKg;
    }
  }
  const energy = operations.powerKw * hours;
  ledger.energyKWh += energy;
  ledger.heatGeneratedKWh += energy;
  ledger.heatRejectedKWh += (operations.coolingKw + operations.compressorKw) * hours;
  state.temperatureC = FARM_SIM.targetTemperatureC
    + (ledger.heatGeneratedKWh - ledger.heatRejectedKWh) / FARM_SIM.thermalCapacityKWhPerC;
  state.tick += 1;
  state.simSeconds = state.tick * seconds;
}

/** Advance visible foreground time only; callers must NOT replay offline time. */
export function advanceFarm(input, realSeconds) {
  const state = sanitizeFarmState(input);
  const elapsed = clamp(finite(realSeconds), 0, FARM_SIM.maxAdvanceSeconds);
  const micros = Math.round(state.remainderSeconds * 1e6) + Math.round(elapsed * 1e6);
  const count = Math.floor(micros / STEP_MICROSECONDS);
  state.remainderSeconds = (micros % STEP_MICROSECONDS) / 1e6;
  for (let index = 0; index < count; index += 1) step(state);
  return state;
}

export function performFarmAction(input, action) {
  const state = sanitizeFarmState(input);
  if (!action || typeof action !== 'object') return state;
  if (['power', 'water', 'cooling'].includes(action.type) && typeof action.enabled === 'boolean') {
    state.controls[action.type] = action.enabled;
    const label = { power: '临时供电', water: '灌溉供水', cooling: '外部冷却回路' }[action.type];
    state.lastEvent = `${label}已${action.enabled ? '接通' : '断开'}。`;
    return state;
  }
  const rack = state.racks.find(item => item.id === action.rackId);
  if (!rack) return state;
  if (action.type === 'sow' && rack.status === 'empty') {
    if (state.seeds < 1 || state.waterL <= 0 || state.nutrientsKg <= 0 || state.co2Kg <= 0) {
      state.lastEvent = '调试物资不足，无法播种；需真实补给，或明确重开调试实验。';
      return state;
    }
    state.seeds -= 1;
    state.ledger.seedPacketsUsed += 1;
    rack.status = 'growing';
    state.lastEvent = `${rack.id.toUpperCase()} 已播种，消耗 1 包种子；成熟后才能采收。`;
  } else if (action.type === 'harvest' && rack.status === 'ready') {
    const harvested = rack.biomassKg;
    state.foodKg += harvested;
    state.ledger.harvestedKg += harvested;
    Object.assign(rack, emptyRack(rack.id));
    state.lastEvent = `${rack.id.toUpperCase()} 采收 ${harvested.toFixed(1)} kg，已转入本地冷库台账。`;
  } else if (action.type === 'clearFailed' && rack.status === 'failed') {
    state.ledger.wasteBiomassKg += rack.biomassKg;
    Object.assign(rack, emptyRack(rack.id));
    state.lastEvent = `${rack.id.toUpperCase()} 失败批次已隔离封存；尚未实现回收处理，不返还水肥。`;
  }
  return state;
}

export function farmTelemetry(input) {
  const state = sanitizeFarmState(input), operations = operatingState(state), ledger = state.ledger;
  const alerts = [];
  if (!state.controls.power) alerts.push('停电：照明、泵、冷却停止，作物逐步受损。');
  if (!state.controls.water) alerts.push('灌溉阀已关闭：停止生长，出现缺水胁迫。');
  if (!state.controls.cooling) alerts.push('冷却回路已关闭：废热累积，蒸腾水不再回收。');
  if (state.waterL < 100) alerts.push('净水储量低，尚无自动补给。');
  if (state.nutrientsKg < .2) alerts.push('营养盐储量低。');
  if (state.co2Kg < .2) alerts.push('临时二氧化碳气瓶储量低。');
  if (state.temperatureC > 30) alerts.push('环境过热：生长减慢，持续高温会损伤作物。');
  if (state.racks.some(rack => rack.status === 'failed')) alerts.push('有失败批次待隔离清理。');
  if (!operations.lit && state.controls.power) alerts.push('作物处于每日 8 小时暗期，照明按计划关闭。');
  return {
    timeScale: FARM_SIM.timeScale, simDays: state.simSeconds / DAY,
    lightOn: farmLightOn(state),
    waterL: state.waterL, nutrientsKg: state.nutrientsKg, co2Kg: state.co2Kg,
    seeds: state.seeds, foodKg: state.foodKg, importedFoodKg: state.importedFoodKg,
    temperatureC: state.temperatureC, powerKw: operations.powerKw, coolingKw: operations.coolingKw,
    energyKWh: ledger.energyKWh, heatGeneratedKWh: ledger.heatGeneratedKWh,
    heatRejectedKWh: ledger.heatRejectedKWh,
    heatStoredKWh: Math.max(0, ledger.heatGeneratedKWh - ledger.heatRejectedKWh),
    waterRecoveredL: ledger.waterRecoveredL, waterLostL: ledger.waterLostL,
    waterCirculatedL: ledger.waterCirculatedL, waterTranspiredL: ledger.waterTranspiredL,
    waterConvertedL: ledger.waterConvertedL, waterInCropsL: mass(state.racks) * WATER_FRACTION,
    waterInFoodL: state.foodKg * WATER_FRACTION,
    waterInWasteL: ledger.wasteBiomassKg * WATER_FRACTION,
    oxygenProducedKg: ledger.oxygenProducedKg, wasteBiomassKg: ledger.wasteBiomassKg,
    commissionedAreaM2: 6 * FARM_SIM.cropAreaM2, controls: { ...state.controls },
    racks: state.racks.map(rack => ({
      ...rack, progress: rack.ageSeconds / FARM_SIM.cropDurationSeconds,
      canSow: rack.status === 'empty' && state.seeds > 0 && state.waterL > 0 && state.nutrientsKg > 0 && state.co2Kg > 0,
      canHarvest: rack.status === 'ready', canClear: rack.status === 'failed',
    })),
    alerts,
    summary: '本机独立调试 · 有限水肥种子与气瓶 · 临时外接电力和冷却 · 非全城生命保障',
    lastEvent: state.lastEvent,
  };
}
