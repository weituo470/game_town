import { createFarmState, sanitizeFarmState } from '../../shared/farmSimulation.js';

// Separate writer lock/storage namespace: a still-open V1 tab must never
// sanitize a V2 save back into its old six-rack manifest and overwrite it.
export const FARM_STORAGE_KEY = 'playtown.connected-orbit-farm.v2';
export const FARM_LEGACY_STORAGE_KEY = 'playtown.vertical-farm.v1';

export function readFarm(storage) {
  let raw;
  try { raw = storage?.getItem(FARM_STORAGE_KEY) ?? storage?.getItem(FARM_LEGACY_STORAGE_KEY); }
  // A failed read may conceal an existing save. Do not auto-overwrite it with
  // a fresh manifest just because a later write happens to succeed.
  catch { return { state: createFarmState(), ok: false, recovered: true }; }
  try {
    let recovered = false;
    const state = raw ? sanitizeFarmState(JSON.parse(raw), { onInvalid: () => { recovered = true; } }) : createFarmState();
    return recovered ? { state, ok: false, recovered: true } : { state, ok: !!storage };
  } catch {
    return { state: createFarmState(), ok: false, recovered: true };
  }
}

export function writeFarm(storage, state) {
  try {
    if (!storage) return false;
    storage.setItem(FARM_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Only visible foreground time counts. Wall-clock/offline jumps never grow food. */
export function farmForegroundDelta(previous, now, visible) {
  if (!visible || previous === null || !Number.isFinite(previous) || !Number.isFinite(now)) return 0;
  return Math.min(1, Math.max(0, (now - previous) / 1000));
}
