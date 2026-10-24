import { useEffect, useRef } from 'react';
import { advanceFarm, createFarmState, performFarmAction } from '../../shared/farmSimulation.js';
import { FARM_STORAGE_KEY, farmForegroundDelta, readFarm, writeFarm } from './farmStorage.js';

/** A local pilot, not a simulated claim of authoritative multiplayer city stock. */
export default function useVerticalFarm() {
  const engine = useRef(null);
  if (!engine.current) {
    engine.current = {
      stateRef: { current: createFarmState() },
      statusRef: { current: { writable: false, storageOk: true, isolated: false, paused: false, recovered: false } },
      dispatch: () => {}, reset: () => {}, setPaused: () => {},
    };
  }
  useEffect(() => {
    const farm = engine.current;
    const status = farm.statusRef.current;
    const locks = globalThis.navigator?.locks;
    let storage;
    try { storage = locks ? window.localStorage : window.sessionStorage; } catch { storage = null; }
    status.isolated = !locks;
    let stopped = false, requesting = false, release = null, previous = null, lastSave = 0;
    const load = () => {
      const loaded = readFarm(storage);
      farm.stateRef.current = loaded.state;
      status.storageOk = loaded.ok;
      status.recovered = loaded.recovered === true;
      if (status.recovered) status.paused = true;
    };
    const save = () => {
      if (status.recovered) return false; // preserve the damaged original until explicit reset
      status.storageOk = writeFarm(storage, farm.stateRef.current);
      return status.storageOk;
    };
    const acquire = () => {
      if (stopped || requesting || status.writable || document.hidden) return;
      if (!locks) { status.writable = true; previous = null; return; }
      requesting = true;
      // One writer across tabs. Other tabs display the saved state, never run
      // a second agricultural clock or overwrite the owner's inventory.
      locks.request(FARM_STORAGE_KEY, { ifAvailable: true }, async lock => {
        if (!lock || stopped || document.hidden) return;
        load(); status.writable = true; previous = null;
        await new Promise(resolve => { release = resolve; });
        status.writable = false;
      }).catch(() => { status.writable = false; status.storageOk = false; })
        .finally(() => { requesting = false; });
    };
    const relinquish = (force = false) => {
      // Never reload an old checkpoint over unsaved harvest on tab visibility
      // changes. Keep the lock + in-memory state until a save succeeds.
      if (status.writable && !save() && !force) { previous = null; return; }
      status.writable = false; previous = null;
      release?.(); release = null;
    };
    load();
    farm.dispatch = action => {
      if (!status.writable || status.recovered) return;
      farm.stateRef.current = performFarmAction(farm.stateRef.current, action); save();
    };
    farm.reset = () => {
      if (!status.writable) return;
      status.recovered = false; status.paused = false;
      farm.stateRef.current = createFarmState(); previous = null; save();
    };
    farm.setPaused = value => { if (status.recovered) return; status.paused = !!value; previous = null; };
    const visibility = () => { previous = null; if (document.hidden) relinquish(); else acquire(); };
    const storageChanged = event => {
      if (event.key === FARM_STORAGE_KEY && !status.writable) load();
    };
    const pageHidden = () => relinquish();
    const timer = setInterval(() => {
      if (document.hidden || stopped) { previous = null; return; }
      acquire();
      const now = performance.now();
      const dt = farmForegroundDelta(previous, now, status.writable && !status.paused);
      previous = now;
      if (dt > 0) farm.stateRef.current = advanceFarm(farm.stateRef.current, dt);
      if (status.writable && now - lastSave >= 2000) { save(); lastSave = now; }
    }, 200);
    acquire();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pageHidden);
    window.addEventListener('storage', storageChanged);
    return () => {
      stopped = true; clearInterval(timer); relinquish(true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pageHidden);
      window.removeEventListener('storage', storageChanged);
      farm.dispatch = () => {}; farm.reset = () => {}; farm.setPaused = () => {};
    };
  }, []);
  return engine.current;
}
