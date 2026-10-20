import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformWithEsbuild } from 'vite';
import { createOffshoreController } from '../src/lib/useOffshoreCruise.js';
import * as offshore from '../shared/offshore-island.js';
import { makeTownRoom } from '../server/TownRoom.js';
import { snapshotFromState } from '../src/lib/useMultiplayer.js';

function harness({ online = true, near = false } = {}) {
  let now = 100, network;
  const calls = [], snapshotRef = { current: { selfId: 'self', serverTime: 100000, receivedAtPerf: now,
    offshoreStartAt: 0, offshoreReturnAt: 0, players: [{ id: 'self', connected: true, aboard: false, offshoreSeat: -1, x: near ? 16 : 0, y: 0, z: near ? 61 : 0 }] } };
  network = { status: online ? 'connected' : 'offline', code: 'ROOM01', snapshotRef, offshoreNoticeRef: { current: null },
    travel(id) { calls.push(['travel', id, now]); return true; },
    sendOffshore(action) { calls.push([action, now]); return true; } };
  const controller = createOffshoreController({ getNetwork: () => network, now: () => now, wallNow: () => 100000 });
  const self = () => snapshotRef.current.players[0];
  return { controller, calls, self, snapshotRef, get network() { return network; }, set network(value) { network = value; }, time: () => now,
    advance(ms, tick = true) { now += ms; return tick ? controller.tick() : controller.state; },
    ackBoard() { self().aboard = true; self().offshoreSeat = 0; return controller.tick(); },
    ackDepart() { snapshotRef.current.offshoreStartAt = snapshotRef.current.serverTime + now - snapshotRef.current.receivedAtPerf; return controller.tick(); },
    reject(code = 'OFFSHORE_BOARD', message = '请先到码头。') { network.offshoreNoticeRef.current = { code, message, receivedAtPerf: now }; return controller.tick(); },
  };
}

test('offline board-and-depart immediately starts a real 150-second voyage; plain board still stays in port', () => {
  const h = harness({ online: false });
  assert.equal(h.controller.act('board'), true);
  assert.equal(h.controller.state.aboard, true); assert.equal(h.controller.state.phase, 'docked');
  assert.equal(h.controller.act('board-and-depart'), true);
  assert.equal(h.controller.state.phase, 'departing'); assert.equal(h.controller.state.pending, '');
  assert.equal(h.controller.runtimeRef.current.sample.remainingMs, 150000);
  h.advance(70000); assert.equal(h.controller.state.phase, 'cruising');
  const start = h.controller.runtimeRef.current.plan.startAt;
  assert.equal(h.controller.act('board-and-depart'), true);
  assert.equal(h.controller.runtimeRef.current.plan.startAt, start, 'already sailing must not restart voyage');
  assert.equal(h.controller.act('disembark'), false);
  assert.equal(h.controller.act('return'), true);
  h.advance(25001); assert.equal(h.controller.state.phase, 'docked');
  assert.equal(h.controller.act('disembark'), true);
  assert.equal(h.controller.state.aboard, false); assert.deepEqual(h.calls, []);
});

test('online one-click orders travel/board, awaits authoritative boarding then the full cooldown, and sends exactly one depart', () => {
  const h = harness();
  assert.equal(h.controller.act('board-and-depart'), true);
  assert.deepEqual(h.calls.map(c => c[0]), ['travel', 'board']);
  assert.equal(h.controller.state.pending, 'board-and-depart');
  assert.equal(h.controller.state.pendingStage, 'board');
  assert.equal(h.controller.act('board-and-depart'), false);
  assert.equal(h.controller.act('depart'), false);
  h.advance(1000); assert.equal(h.calls.length, 2, 'elapsed time alone is never an ack');
  h.ackBoard(); assert.equal(h.controller.state.pendingStage, 'cooldown');
  h.advance(349); assert.equal(h.calls.length, 2);
  h.advance(1); assert.equal(h.controller.state.pendingStage, 'depart');
  assert.deepEqual(h.calls.map(c => c[0]), ['travel', 'board', 'depart']);
  h.advance(1000); assert.equal(h.calls.length, 3, 'no automatic command retry');
  h.ackDepart(); assert.equal(h.controller.state.pending, ''); assert.equal(h.controller.state.error, '');
  assert.equal(h.controller.state.phase, 'departing');
});

test('near dock avoids travel, already-aboard invocation avoids a second board, and fromAnywhere false never teleports', () => {
  const near = harness({ near: true }); near.controller.act('board-and-depart');
  assert.deepEqual(near.calls.map(c => c[0]), ['board']);
  const aboard = harness(); aboard.self().aboard = true; aboard.controller.act('board-and-depart');
  assert.deepEqual(aboard.calls, []); aboard.advance(350);
  assert.deepEqual(aboard.calls.map(c => c[0]), ['depart']);
  const explicit = harness(); explicit.controller.act('board-and-depart', { fromAnywhere: false });
  assert.deepEqual(explicit.calls.map(c => c[0]), ['board']);
  explicit.reject(); explicit.advance(10000); assert.equal(explicit.calls.length, 1);
});

test('disconnect, room switch, missing self and server-disconnected self cancel the intent at boarding or cooldown', () => {
  for (const stage of ['board', 'cooldown', 'depart']) {
    for (const mutate of [
      h => { h.network.status = 'reconnecting'; },
      h => { h.network.status = 'offline'; },
      h => { h.network.status = 'error'; },
      h => { h.network.code = 'ROOM02'; },
      h => { h.snapshotRef.current.selfId = 'other'; },
      h => { h.network.snapshotRef = { current: { ...h.snapshotRef.current } }; },
      h => { h.snapshotRef.current.players = []; },
      h => { h.self().connected = false; },
    ]) {
      const h = harness({ near: true }); h.controller.act('board-and-depart');
      if (stage !== 'board') h.ackBoard();
      if (stage === 'depart') h.advance(350);
      const before = h.calls.length;
      mutate(h); h.controller.tick();
      assert.equal(h.controller.state.pending, ''); assert.match(h.controller.state.error, /已取消/);
      h.network.status = 'connected'; h.network.code = 'ROOM01'; h.advance(10000);
      assert.equal(h.calls.length, before, 'reconnection cannot resurrect auto-depart');
    }
  }
});

test('rejection, timeout, cleanup and failed transport cancel one-click departure without retries or rollback of a real seat', () => {
  for (const stage of ['board', 'cooldown', 'depart']) for (const cancel of ['reject', 'timeout', 'cleanup']) {
    const h = harness({ near: true }); h.controller.act('board-and-depart');
    if (stage !== 'board') h.ackBoard();
    if (stage === 'depart') h.advance(350);
    const before = h.calls.length;
    if (cancel === 'reject') h.reject('OFFSHORE_COOLDOWN', '请稍候再操作船只。');
    else if (cancel === 'timeout') h.advance(5001);
    else h.controller.cancelPending();
    assert.equal(h.controller.state.pending, '');
    if (stage !== 'board') assert.equal(h.controller.state.aboard, true, 'canceling intent must not eject the passenger');
    h.ackBoard(); h.advance(20000);
    assert.equal(h.calls.length, before);
  }
  const travelFail = harness(); travelFail.network.travel = () => false;
  assert.equal(travelFail.controller.act('board-and-depart'), false);
  assert.equal(travelFail.calls.length, 0); assert.match(travelFail.controller.state.error, /未能前往码头/);
  const boardFail = harness({ near: true }); boardFail.network.sendOffshore = () => false;
  assert.equal(boardFail.controller.act('board-and-depart'), false); assert.equal(boardFail.controller.state.pending, '');
  const departFail = harness({ near: true }); departFail.controller.act('board-and-depart'); departFail.ackBoard();
  departFail.network.sendOffshore = () => false; departFail.advance(350);
  assert.equal(departFail.controller.state.pending, ''); assert.match(departFail.controller.state.error, /已取消自动启航/);
});

test('another passenger starting ends the composite operation; it never launches a later voyage or boards a ship at sea', () => {
  for (const stage of ['board', 'cooldown', 'depart']) {
    const h = harness({ near: true }); h.controller.act('board-and-depart');
    if (stage !== 'board') h.ackBoard();
    if (stage === 'depart') h.advance(350);
    h.self().aboard = true; const before = h.calls.length; h.ackDepart();
    assert.equal(h.controller.state.pending, ''); assert.equal(h.controller.state.error, '');
    h.advance(160000); assert.equal(h.calls.length, before);
  }
  const race = harness({ near: true }); race.controller.act('board-and-depart'); race.ackBoard(); race.advance(350);
  race.reject('OFFSHORE_SAILING', '船只已在航行，请稍候。');
  assert.equal(race.controller.state.pending, ''); assert.equal(race.controller.state.error, '');
  const sea = harness(); sea.ackDepart();
  assert.equal(sea.controller.act('board-and-depart'), false); assert.match(sea.controller.state.error, /正在海上/);
  assert.deepEqual(sea.calls, []);
});

test('old notices do not poison a new attempt, while late boarding confirmation cannot revive a timed-out intent', () => {
  const h = harness({ near: true }); h.reject('OFFSHORE_FULL', '满员');
  assert.equal(h.controller.act('board-and-depart'), true); h.controller.tick();
  assert.equal(h.controller.state.error, ''); h.advance(5001);
  h.ackBoard(); h.advance(10000);
  assert.deepEqual(h.calls.map(c => c[0]), ['board']); assert.equal(h.controller.state.pending, '');
  assert.equal(h.controller.state.aboard, true); assert.match(h.controller.state.error, /已取消/);
});

test('coordinator interoperates with the real TownRoom 300ms authority cooldown and ordered travel/board commands', () => {
  let time = 100000, perf = 10;
  const Room = makeTownRoom({ identity: {}, roomCodes: new Map(), now: () => time });
  const room = Object.create(Room.prototype);
  Object.defineProperty(room, 'state', { value: { tick: 0, serverTime: time, offshoreStartAt: 0, offshoreReturnAt: 0, players: new Map() } });
  room.inputs = new Map(); room.controls = new Map(); room.trace = () => {};
  const player = { id: 'self', x: 0, z: 0, y: 0, yaw: 0, vy: 0, connected: true, seq: -1, aboard: false, offshoreSeat: -1, offshoreSeq: -1 };
  room.state.players.set('self', player);
  room.controls.set('self', { seq: -1, travelAt: -Infinity, noticesAt: -Infinity, invalid: 0, offshoreSeq: -1, offshoreAt: -Infinity });
  const notices = [], calls = [];
  const net = { status: 'connected', code: 'REAL01', snapshotRef: { current: null }, offshoreNoticeRef: { current: null } };
  const client = { sessionId: 'self', send(_type, notice) { notices.push(notice); net.offshoreNoticeRef.current = { ...notice, receivedAtPerf: perf }; } };
  let seq = 0;
  net.travel = id => { calls.push('travel'); room.receiveTravel(client, { id }); return true; };
  net.sendOffshore = action => { calls.push(action); room.receiveOffshore(client, { action, seq: seq++ }); return true; };
  const snapshot = () => { net.snapshotRef.current = { ...snapshotFromState(room.state, 'self'), receivedAtPerf: perf }; };
  snapshot();
  const controller = createOffshoreController({ getNetwork: () => net, now: () => perf, wallNow: () => time });
  assert.equal(controller.act('board-and-depart'), true);
  assert.equal(player.aboard, true); assert.equal(controller.runtimeRef.current.aboard, false, 'do not treat sent command as ack');
  time += 50; perf += 50; room.step(50); snapshot(); controller.tick();
  time += 349; perf += 349; room.step(349); snapshot(); controller.tick();
  assert.equal(room.state.offshoreStartAt, 0);
  time++; perf++; room.step(1); snapshot(); controller.tick();
  assert.equal(room.state.offshoreStartAt, time); assert.deepEqual(calls, ['travel', 'board', 'depart']);
  snapshot(); controller.tick(); assert.equal(controller.state.pending, ''); assert.deepEqual(notices, []);
});

test('React hook exposes the one-click contract, cancels on status changes, and clears intent/timer on unmount', async () => {
  const source = fs.readFileSync(new URL('../src/lib/useOffshoreCruise.js', import.meta.url), 'utf8');
  const code = (await transformWithEsbuild(source, 'useOffshoreCruise.js', { loader: 'js', format: 'cjs' })).code;
  let cursor = 0, now = 100, interval, cleared = 0;
  const slots = [], effectSlots = [], pendingEffects = [];
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useCallback(fn) { cursor++; return fn; },
    useEffect(fn, deps) { const i = cursor++, old = effectSlots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) {
      // useCallback stubs change identity; React's memoized callbacks do not.
      if (old && deps.every((value, index) => typeof value === 'function' || value === old.deps[index])) return;
      pendingEffects.push(() => { old?.cleanup?.(); effectSlots[i] = { deps, cleanup: fn() }; });
    } },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, performance: { now: () => now }, Date,
    setInterval(fn) { interval = fn; return 4; }, clearInterval(id) { assert.equal(id, 4); cleared++; },
    require(id) { if (id === 'react') return react; if (id.includes('shared/offshore-island')) return offshore; throw new Error(id); } });
  const h = harness({ near: true });
  const render = () => { cursor = 0; const value = module.exports.default({ network: { ...h.network } }); pendingEffects.splice(0).forEach(fn => fn()); return value; };
  let hook = render(); assert.equal(typeof hook.boardAndDepart, 'function');
  hook.boardAndDepart(); hook = render(); assert.equal(hook.state.pending, 'board-and-depart');
  h.network.status = 'reconnecting'; render(); hook = render();
  assert.equal(hook.state.pending, ''); assert.match(hook.state.error, /已取消/);
  h.network.status = 'connected'; render(); hook = render(); hook.boardAndDepart();
  effectSlots.forEach(effect => effect?.cleanup?.());
  assert.equal(cleared, 1);
  h.self().aboard = true; now += 1000; interval();
  assert.deepEqual(h.calls.map(c => c[0]), ['board', 'board']);
});
