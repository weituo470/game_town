import { useEffect, useRef, useState } from 'react';
import { DAY_NIGHT_CYCLE_MS, sampleDayNight } from '../../shared/dayNight.js';

const validTime = value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const performanceNow = () => globalThis.performance?.now?.() ?? 0;

export function cycleTime(value) {
  if (!Number.isFinite(value)) return 0;
  return ((value % DAY_NIGHT_CYCLE_MS) + DAY_NIGHT_CYCLE_MS) % DAY_NIGHT_CYCLE_MS;
}

// Snapshot timestamps live in two distinct domains: epoch milliseconds from
// the server and a monotonic local receipt time. Never subtract client wall
// time from server wall time: players' operating-system clocks may differ.
export function sampleWorldTime({ snapshot, mode = 'auto', nowPerf, fallbackEpoch = 0, fallbackPerf = 0 } = {}) {
  if (mode === 'day') return 0;
  if (mode === 'night') return DAY_NIGHT_CYCLE_MS / 2;
  const perf = validTime(nowPerf) ? nowPerf : null;
  const received = snapshot?.receivedAtPerf;
  const serverTime = snapshot?.serverTime;
  if (validTime(serverTime) && serverTime > 0 && validTime(received) && perf !== null && received <= perf) {
    return cycleTime(cycleTime(serverTime) + cycleTime(perf - received));
  }
  const elapsed = perf !== null && validTime(fallbackPerf) && fallbackPerf <= perf ? perf - fallbackPerf : 0;
  return cycleTime(cycleTime(validTime(fallbackEpoch) ? fallbackEpoch : 0) + cycleTime(elapsed));
}

// Consumers can read .current from useFrame without a React update or RAF
// loop. The full elapsed duration is retained across hidden-tab throttling.
export function createWorldClock({
  now = performanceNow,
  wallNow = Date.now,
  getSnapshot = () => null,
  getMode = () => 'auto',
} = {}) {
  const fallbackEpoch = wallNow();
  const fallbackPerf = now();
  return Object.freeze({
    get current() {
      return sampleWorldTime({ snapshot: getSnapshot(), mode: getMode(), nowPerf: now(), fallbackEpoch, fallbackPerf });
    },
  });
}

export default function useWorldClock({ network, mode = 'auto' } = {}) {
  const optionsRef = useRef({ network, mode });
  optionsRef.current = { network, mode };
  const clockRef = useRef(null);
  if (clockRef.current === null) {
    clockRef.current = createWorldClock({
      getSnapshot: () => optionsRef.current.network?.snapshotRef?.current,
      getMode: () => optionsRef.current.mode,
    });
  }
  const timeRef = clockRef.current;
  const [label, setLabel] = useState(() => sampleDayNight(timeRef.current).label);
  useEffect(() => {
    const updateLabel = () => setLabel(sampleDayNight(timeRef.current).label);
    updateLabel();
    const timer = setInterval(updateLabel, 1000);
    document.addEventListener('visibilitychange', updateLabel);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', updateLabel);
    };
  }, [timeRef, mode]);
  return { timeRef, label };
}
