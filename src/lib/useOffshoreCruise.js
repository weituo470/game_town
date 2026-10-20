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

// The server retains its 300ms command cooldown. Start the extra margin only
// after the authoritative boarding snapshot, never after an optimistic click.
const DEPART_AFTER_ACK_MS = 350;
const CONFIRM_TIMEOUT_MS = 5000;
const pendingLabels = {
  board: '正在确认登船，请稍候…',
  cooldown: '已登船，正在准备离港，无需再次点击。',
  depart: '正在确认启航，即将驶离码头…',
  return: '正在请求返航，请稍候…',
  disembark: '正在确认安全下船，请稍候…',
};

// Timer-free coordinator: the hook polls it, and tests exercise the exact same
// command/ack state machine with a deterministic clock and real server logic.
export function createOffshoreController({ getNetwork = () => null, now = clockNow, wallNow = Date.now, runtimeRef = createOffshoreRuntime({ getNetwork, now, wallNow }) } = {}) {
  let pending = null, error = '', seenNotice = null;
  const cancelPending = (message = '') => { pending = null; error = message; };
  const connection = net => ({ snapshotRef: net?.snapshotRef, selfId: net?.snapshotRef?.current?.selfId, code: net?.code });
  const sameConnection = (net, expected) => net?.status === 'connected' && net.snapshotRef === expected.snapshotRef
    && net.snapshotRef?.current?.selfId === expected.selfId && net.code === expected.code;
  const state = () => {
    const r = runtimeRef.current;
    return { phase: r.sample.phase, label: r.sample.label, aboard: r.aboard, seat: r.seat, error,
      pending: pending?.action || '', pendingStage: pending?.stage || '', pendingLabel: pendingLabels[pending?.stage] || '', online: r.online };
  };
  const tick = () => {
    const r = runtimeRef.current, net = getNetwork(), notice = net?.offshoreNoticeRef?.current;
    const newNotice = notice && notice !== seenNotice; seenNotice = notice;
    if (pending && (!sameConnection(net, pending.connection) || !r.self || r.self.connected === false)) {
      cancelPending('连接或房间已变化，已取消自动操作；重新连接后请手动启航。');
    }
    if (pending && newNotice && notice.receivedAtPerf >= pending.at) {
      // Another passenger can win the depart race. This authoritative notice is
      // a successful voyage, not a reason to retry or launch a later voyage.
      if (pending.action === 'board-and-depart' && pending.stage === 'depart' && notice.code === 'OFFSHORE_SAILING') cancelPending();
      else cancelPending(notice.message || '航行操作未完成，请重试。');
    }
    if (pending && now() - pending.stageAt > CONFIRM_TIMEOUT_MS) {
      cancelPending('暂未收到航行确认，已取消自动操作；请检查连接后重试。');
    }
    if (pending?.action === 'board-and-depart') {
      if (r.aboard && !r.sample.docked) cancelPending();
      else if (pending.stage === 'board' && r.aboard) {
        pending.stage = 'cooldown'; pending.stageAt = now(); pending.readyAt = now() + DEPART_AFTER_ACK_MS;
      } else if (pending.stage !== 'board' && !r.aboard) cancelPending('登船状态已变化，已取消自动启航。');
      else if (pending.stage === 'cooldown' && now() >= pending.readyAt) {
        pending.stage = 'depart'; pending.stageAt = now();
        if (!net.sendOffshore?.('depart')) cancelPending('联机连接不可用，已取消自动启航，请重试。');
      }
    } else if (pending) {
      const done = pending.action === 'board' ? r.aboard : pending.action === 'disembark' ? !r.aboard
        : pending.action === 'depart' ? !r.sample.docked : r.sample.docked || r.plan.returnAt > 0;
      if (done) cancelPending();
    }
    return state();
  };
  const act = (action, { fromAnywhere = true } = {}) => {
    if ((!OFFSHORE_ACTIONS.includes(action) && action !== 'board-and-depart') || pending) return false;
    const net = getNetwork(), r = runtimeRef.current, combined = action === 'board-and-depart', boarding = action === 'board' || combined;
    error = '';
    if (['connecting', 'reconnecting'].includes(net?.status)) error = '正在恢复联机，请稍候再操作。';
    else if (net?.status === 'connected' && (!r.self || r.self.connected === false)) error = '正在同步联机状态，请稍候再操作。';
    else if (combined && r.aboard && !r.sample.docked) return true;
    else if (boarding && !r.sample.docked) error = '船只正在海上，请等待靠港后登船。';
    else if (!boarding && !r.aboard) error = '请先登船。';
    else if (action === 'disembark' && !r.sample.docked) error = '请先返航靠港，再安全离船。';
    else if (action === 'depart' && !r.sample.docked) error = '船只已经在航行中。';
    if (error) return false;
    if (net?.status === 'connected') {
      seenNotice = net.offshoreNoticeRef?.current;
      if (boarding && !r.aboard && fromAnywhere) {
        const p = r.self;
        if (p.y > 1.5 || Math.hypot(p.x - OFFSHORE_ARRIVAL.x, p.z - OFFSHORE_ARRIVAL.z) > 5) {
          if (!net.travel?.('offshore')) { error = '未能前往码头，请重试。'; return false; }
        }
      }
      const stage = combined ? r.aboard ? 'cooldown' : 'board' : action;
      pending = { action, stage, at: now(), stageAt: now(), readyAt: now() + DEPART_AFTER_ACK_MS, connection: connection(net) };
      if (stage !== 'cooldown' && !net.sendOffshore?.(stage)) { cancelPending('联机连接不可用，请重试。'); return false; }
    } else {
      const local = runtimeRef.local;
      if (boarding) local.aboard = true;
      if (action === 'depart' || combined) local.plan = { startAt: Math.max(1, r.now), returnAt: 0 };
      else if (action === 'return' && !r.sample.docked && !local.plan.returnAt) local.plan = { ...local.plan, returnAt: r.now };
      else if (action === 'disembark') local.aboard = false;
    }
    return true;
  };
  return { runtimeRef, get state() { return state(); }, tick, act, cancelPending };
}

export default function useOffshoreCruise({ network } = {}) {
  const networkRef = useRef(network); networkRef.current = network;
  const coordinator = useRef(null);
  if (!coordinator.current) coordinator.current = createOffshoreController({ getNetwork: () => networkRef.current });
  const controller = coordinator.current;
  const [state, setState] = useState(() => controller.state);
  const publish = useCallback(() => {
    const next = controller.tick();
    setState(previous => Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
  }, [controller]);
  useEffect(() => { publish(); const timer = setInterval(publish, 150); return () => { clearInterval(timer); controller.cancelPending(); }; }, [publish, controller]);
  // Do not let a short disconnect or room switch wait for the next timer tick.
  useEffect(publish, [publish, network?.status, network?.code, network?.selfId, network?.snapshotRef]);
  const act = useCallback((action, options) => { const accepted = controller.act(action, options); publish(); return accepted; }, [controller, publish]);
  return { runtimeRef: controller.runtimeRef, state, board: useCallback(options => act('board', options), [act]),
    boardAndDepart: useCallback(options => act('board-and-depart', options), [act]), depart: useCallback(() => act('depart'), [act]),
    returnToPort: useCallback(() => act('return'), [act]), disembark: useCallback(() => act('disembark'), [act]) };
}
