import { useCallback, useEffect, useRef, useState } from 'react';
import { OFFSHORE_ACTIONS, OFFSHORE_ARRIVAL, offshorePlan, offshoreTime, sampleOffshoreVoyage } from '../../shared/offshore-island.js';

const clockNow = () => globalThis.performance?.now?.() ?? 0;

// Pure runtime adapter also exercised without React in integration tests.
export function createOffshoreRuntime({ getNetwork = () => null, now = clockNow, wallNow = Date.now } = {}) {
  const anchorPerf = now(), anchorEpoch = wallNow();
  const local = { plan: { startAt: 0, returnAt: 0 }, aboard: false, seat: 0 };
  let wasOnline = false;
  return {
    local,
    get current() {
      const network = getNetwork(), snapshot = network?.snapshotRef?.current;
      const online = ['connected', 'reconnecting', 'connecting'].includes(network?.status) && !!snapshot?.selfId;
      const self = online ? snapshot.players?.find(p => p.id === snapshot.selfId) : null;
      if (online) wasOnline = true;
      else if (wasOnline) { local.aboard = false; local.plan = { startAt: 0, returnAt: 0 }; wasOnline = false; }
      const time = offshoreTime(online ? snapshot : null, now(), anchorEpoch, anchorPerf);
      const plan = online ? offshorePlan(snapshot) : local.plan;
      return { now: time, plan, sample: sampleOffshoreVoyage(plan, time), aboard: online ? self?.aboard === true : local.aboard,
        seat: online ? self?.offshoreSeat ?? -1 : local.aboard ? local.seat : -1, online, self };
    },
  };
}

export default function useOffshoreCruise({ network } = {}) {
  const networkRef = useRef(network); networkRef.current = network;
  const runtime = useRef(null);
  if (!runtime.current) runtime.current = createOffshoreRuntime({ getNetwork: () => networkRef.current });
  const runtimeRef = runtime.current;
  const pendingRef = useRef(null), errorRef = useRef(''), seenNotice = useRef(null);
  const [state, setState] = useState(() => ({ phase: 'docked', label: '靠港待命', aboard: false, seat: -1, error: '', pending: '', online: false }));
  const publish = useCallback(() => {
    const r = runtimeRef.current, net = networkRef.current;
    const notice = net?.offshoreNoticeRef?.current;
    if (notice && notice !== seenNotice.current) {
      seenNotice.current = notice;
      if (pendingRef.current && notice.receivedAtPerf >= pendingRef.current.at) { errorRef.current = notice.message; pendingRef.current = null; }
    }
    const pending = pendingRef.current;
    if (pending) {
      const done = pending.action === 'board' ? r.aboard : pending.action === 'disembark' ? !r.aboard : pending.action === 'depart' ? !r.sample.docked : r.sample.docked || r.plan.returnAt > 0;
      if (done) pendingRef.current = null;
      else if (clockNow() - pending.at > 5000) { pendingRef.current = null; errorRef.current = '暂未收到航行确认，请检查连接后重试。'; }
    }
    const next = { phase: r.sample.phase, label: r.sample.label, aboard: r.aboard, seat: r.seat, error: errorRef.current, pending: pendingRef.current?.action || '', online: r.online };
    setState(previous => Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
  }, [runtimeRef]);

  useEffect(() => { publish(); const timer = setInterval(publish, 150); return () => clearInterval(timer); }, [publish]);
  const act = useCallback((action, { fromAnywhere = true } = {}) => {
    if (!OFFSHORE_ACTIONS.includes(action) || pendingRef.current) return false;
    const net = networkRef.current, r = runtimeRef.current;
    errorRef.current = '';
    if (['connecting', 'reconnecting'].includes(net?.status)) { errorRef.current = '正在恢复联机，请稍候再操作。'; publish(); return false; }
    if (action === 'board' && !r.sample.docked) errorRef.current = '船只正在海上，请等待靠港后登船。';
    else if (action !== 'board' && !r.aboard) errorRef.current = '请先登船。';
    else if (action === 'disembark' && !r.sample.docked) errorRef.current = '请先返航靠港，再安全离船。';
    else if (action === 'depart' && !r.sample.docked) errorRef.current = '船只已经在航行中。';
    if (errorRef.current) { publish(); return false; }
    if (net?.status === 'connected') {
      if (action === 'board' && !r.aboard && fromAnywhere) {
        const p = r.self;
        if (!p || p.y > 1.5 || Math.hypot(p.x - OFFSHORE_ARRIVAL.x, p.z - OFFSHORE_ARRIVAL.z) > 5) {
          if (!net.travel?.('offshore')) { errorRef.current = '未能前往码头，请重试。'; publish(); return false; }
        }
      }
      if (!net.sendOffshore?.(action)) { errorRef.current = '联机连接不可用，请重试。'; publish(); return false; }
      pendingRef.current = { action, at: clockNow() };
    } else {
      const local = runtimeRef.local;
      if (action === 'board') local.aboard = true;
      else if (action === 'depart') local.plan = { startAt: Math.max(1, r.now), returnAt: 0 };
      else if (action === 'return' && !r.sample.docked && !local.plan.returnAt) local.plan = { ...local.plan, returnAt: r.now };
      else if (action === 'disembark') local.aboard = false;
    }
    publish(); return true;
  }, [publish, runtimeRef]);
  return { runtimeRef, state, board: useCallback(options => act('board', options), [act]), depart: useCallback(() => act('depart'), [act]),
    returnToPort: useCallback(() => act('return'), [act]), disembark: useCallback(() => act('disembark'), [act]) };
}
