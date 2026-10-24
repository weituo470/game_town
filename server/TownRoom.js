import {advanceRailSchedule,nearRailStation,sampleRail,canBoardRail,railLocal,railPassenger,stepRail,railExit} from '../shared/space-rail.js';
import { canAscend, canDescend, validSpaceAction, advanceElevator, orbitState, placeInOrbit } from '../shared/space-elevator.js';
import { stepAvatar as stepOrbitAvatar, startAvatarJump as startOrbitJump, stoppedVertical as stopOrbit } from '../src/orbit/shared/jetpack.js';
import { Room, ServerError } from '@colyseus/core';
import { schema, t } from '@colyseus/schema';
import { cleanName } from './identity.js';
import { createReconnectDiagnostics } from './reconnectDiagnostics.js';
import { SPAWN, movePlayer, getDestination, groundHeight } from '../shared/world.js';
import { startAvatarJump, stepAvatar, stoppedVertical, safeLanding } from '../shared/jetpack.js';
import { OFFSHORE_ACTIONS, OFFSHORE_ARRIVAL, OFFSHORE_SEATS, offshorePlan, sampleOffshoreVoyage, sampleOffshorePassenger, canBoardOffshore } from '../shared/offshore-island.js';
import { stepOffshoreDeck } from '../shared/offshore-deck.js';
import { PROTOCOL_VERSION, MAX_PLAYERS, SERVER_TICK_MS, STATE_PATCH_MS, RECONNECT_SECONDS, INPUT_TIMEOUT_MS, MESSAGE, PLAYER_COLORS } from '../shared/protocol.js';

export const PlayerState = schema({
  id: t.string(), guestId: t.string(), name: t.string(),
  x: t.number(), y: t.number(), z: t.number(), vy: t.number(), yaw: t.number(), moving: t.boolean(), jetpack: t.boolean(), thrusting: t.boolean(), hovering: t.boolean(),
  color: t.string(), connected: t.boolean(), seq: t.number(), aboard: t.boolean(), offshoreSeat: t.number(), offshoreSeq: t.number(),
  deckX: t.number(), deckZ: t.number(), deckYaw: t.number(),
  railX:t.number(),railZ:t.number(),railYaw:t.number(),
  spaceMode:t.string(), spaceStartAt:t.number(), spaceSeq:t.number(), orbitX:t.number(), orbitY:t.number(), orbitZ:t.number(),
}, 'PlayerState');

export const TownState = schema({
  code: t.string(), protocolVersion: t.number(), tick: t.number(), serverTime: t.number(),
  offshoreStartAt: t.number(), offshoreReturnAt: t.number(), railEpoch:t.number(),railFrom:t.number(),
  players: t.map(PlayerState),
}, 'TownState');

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validOffshore(value, previousSeq = -1) {
  return isRecord(value) && Object.keys(value).every(key => ['action', 'seq'].includes(key))
    && OFFSHORE_ACTIONS.includes(value.action) && Number.isSafeInteger(value.seq) && value.seq >= 0 && value.seq > previousSeq;
}
export function validInput(value, previousSeq = -1) {
  return isRecord(value) && Object.keys(value).every(key => ['x', 'z', 'seq', 'jump', 'stop', 'thrust', 'hover'].includes(key))
    && Number.isFinite(value.x) && Number.isFinite(value.z)
    && Math.abs(value.x) <= 1 && Math.abs(value.z) <= 1
    && (value.jump === undefined || typeof value.jump === 'boolean')
    && (value.stop === undefined || typeof value.stop === 'boolean')
    && (value.thrust === undefined || typeof value.thrust === 'boolean')
    && (value.hover === undefined || typeof value.hover === 'boolean')
    && !(value.jump && value.thrust)
    && !(value.hover && (value.jump || value.thrust))
    && (!value.stop || (value.x === 0 && value.z === 0 && !value.jump && !value.thrust && !value.hover))
    && Number.isSafeInteger(value.seq) && value.seq >= 0 && value.seq > previousSeq;
}

export function makeTownRoom({ identity, roomCodes, reconnectSeconds = RECONNECT_SECONDS, now = Date.now }) {
  const diagnostic = createReconnectDiagnostics();
  return class TownRoom extends Room {
    maxClients = MAX_PLAYERS;
    patchRate = STATE_PATCH_MS;
    maxMessagesPerSecond = 65;
    state = new TownState();
    inputs = new Map();
    controls = new Map();

    trace(event, client, fields = {}) {
      diagnostic(event, {
        roomId: this.roomId, sessionId: client?.sessionId,
        hasPlayer: client ? this.state.players.has(client.sessionId) : undefined,
        hasReservedSeat: client ? this.hasReservedSeat(client.sessionId) : undefined,
        connectedClients: this.clients.length, players: this.state.players.size, ...fields,
      });
    }

    onAuth(_client, options) {
      if (options?.protocolVersion !== PROTOCOL_VERSION) throw new ServerError(400, '协议版本不同，请刷新页面。');
      const guest = identity.verify(options?.token);
      if (!guest) throw new ServerError(401, '游客凭据已失效，请重新连接。');
      return { ...guest, name: cleanName(options?.name) };
    }

    onCreate(options) {
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(options.code || '')) throw new ServerError(400, '无效房间邀请码。');
      this.state.code = options.code;
      this.state.protocolVersion = PROTOCOL_VERSION;
      this.state.tick = 0;
      this.state.serverTime = now();
      Object.assign(this.state,advanceRailSchedule(0,now()));
      this.state.offshoreStartAt = 0;
      this.state.offshoreReturnAt = 0;
      this.seatReservationTimeout = 10;
      roomCodes.set(options.code, this.roomId);
      this.onMessage(MESSAGE.INPUT, (client, input) => this.receiveInput(client, input));
      this.onMessage(MESSAGE.TRAVEL, (client, payload) => this.receiveTravel(client, payload));
      this.onMessage(MESSAGE.SPACE, (client,payload)=>this.receiveSpace(client,payload));
      this.onMessage(MESSAGE.OFFSHORE, (client, payload) => this.receiveOffshore(client, payload));
      this.onMessage('*', client => this.rejectMessage(client, 'UNKNOWN_MESSAGE', '不支持的操作。'));
      this.setSimulationInterval(delta => this.step(Math.min(delta, 100)), SERVER_TICK_MS);
    }

    onJoin(client, _options, auth) {
      for (const player of this.state.players.values()) {
        if (player.guestId === auth.guestId) throw new ServerError(409, '该游客已在房间内，请返回原标签页或等待重连结束。');
      }
      const usedColors = new Set([...this.state.players.values()].map(player => player.color));
      const color = PLAYER_COLORS.find(item => !usedColors.has(item)) || PLAYER_COLORS[0];
      const offset = this.state.players.size * 0.75 - 2.625;
      this.state.players.set(client.sessionId, new PlayerState({
        id: client.sessionId, guestId: auth.guestId, name: auth.name,
        railX:0,railZ:0,railYaw:0,spaceMode:"ground", spaceStartAt:0, spaceSeq:-1, orbitX:0, orbitY:0, orbitZ:0,
        ...SPAWN, x: offset, y: 0, vy: 0, moving: false, jetpack: false, thrusting: false, hovering: false, color, connected: true, seq: -1, aboard: false, offshoreSeat: -1, offshoreSeq: -1, deckX: 0, deckZ: 0, deckYaw: 0,
      }));
      this.controls.set(client.sessionId, { seq: -1, travelAt: -Infinity, noticesAt: -Infinity, invalid: 0, offshoreSeq: -1, offshoreAt: -Infinity });
      this.trace('onJoin', client);
    }

    rejectMessage(client, code, message) {
      const controls = this.controls.get(client.sessionId);
      if (!controls) return;
      controls.invalid += 1;
      if (now() - controls.noticesAt > 500) {
        client.send(MESSAGE.NOTICE, { code, message });
        controls.noticesAt = now();
      }
      if (controls.invalid >= 30) client.leave(4000);
    }

    receiveInput(client, input) {
      const controls = this.controls.get(client.sessionId);
      if (!controls || !validInput(input, controls.seq)) {
        this.rejectMessage(client, 'INVALID_INPUT', '移动输入无效或已过期。');
        return;
      }
      controls.seq = input.seq;
      const player = this.state.players.get(client.sessionId);
      player.seq = input.seq;
      if (player.spaceMode && player.spaceMode !== 'ground') {
        if (player.spaceMode === 'rail') {this.inputs.set(client.sessionId,{x:input.x,z:input.z,at:now()});return;}
        if (player.spaceMode === 'orbit') {
          if(input.stop) Object.assign(player,placeInOrbit(player,{...orbitState(player),...stopOrbit(orbitState(player))}));
          else if(input.jump){const jump=startOrbitJump(orbitState(player));if(jump)Object.assign(player,placeInOrbit(player,{...orbitState(player),...jump}));}
          this.inputs.set(client.sessionId,{x:input.x,z:input.z,thrust:input.thrust===true,hover:input.hover===true,at:now()});
        }
        return;
      }
      if (player.aboard) {
        // The same bounded direction packet is ship-local while aboard. Flight
        // flags never permit jumping, hovering, changing height or leaving deck.
        this.inputs.set(client.sessionId, { x: input.x, z: input.z, at: now() });
        if (input.stop) player.moving = false;
        return;
      }
      if (input.stop) Object.assign(player, stoppedVertical(player));
      else if (input.jump) {
        const jump = startAvatarJump(player);
        if (jump) Object.assign(player, jump);
      }
      this.inputs.set(client.sessionId, { x: input.x, z: input.z, thrust: input.thrust === true, hover: input.hover === true, at: now() });
    }

    receiveTravel(client, payload) {
      const controls = this.controls.get(client.sessionId);
      const hasSequence = isRecord(payload) && payload.seq !== undefined;
      if (!controls || !isRecord(payload) || Object.keys(payload).some(key => !['id', 'seq'].includes(key))
        || typeof payload.id !== 'string' || (payload.id.length > 24 && !/^architect-project:[a-zA-Z0-9:_-]{1,100}$/.test(payload.id))
        || (hasSequence && (!Number.isSafeInteger(payload.seq) || payload.seq < 0 || payload.seq <= controls.seq))) {
        this.rejectMessage(client, 'INVALID_TRAVEL', '前往地点无效。'); return;
      }
      const destination = getDestination(payload.id);
      if (!destination) { this.rejectMessage(client, 'INVALID_TRAVEL', '没有这个地点。'); return; }
      if (now() - controls.travelAt < 500) { this.rejectMessage(client, 'TRAVEL_COOLDOWN', '请稍后再前往。'); return; }
      controls.travelAt = now();
      const player = this.state.players.get(client.sessionId);
      if (player.spaceMode && player.spaceMode !== 'ground') { this.rejectMessage(client,'SPACE_TRAVEL','请乘电梯返回地面后再前往其他地点。');return;}
      if (player.aboard) { this.rejectMessage(client, 'OFFSHORE_ABOARD', '请先靠港离船，再前往其他地点。'); return; }
      if (hasSequence) { controls.seq = payload.seq; player.seq = payload.seq; }
      Object.assign(player, destination, { y: groundHeight(destination.x, destination.z), vy: 0, moving: false, jetpack: false, thrusting: false, hovering: false });
      this.inputs.delete(client.sessionId);
    }

    receiveOffshore(client, payload) {
      const controls = this.controls.get(client.sessionId), player = this.state.players.get(client.sessionId);
      if (!controls || !player || !validOffshore(payload, controls.offshoreSeq)) {
        this.rejectMessage(client, 'OFFSHORE_INVALID', '航行操作无效或已经处理，请重试。'); return;
      }
      controls.offshoreSeq = payload.seq; player.offshoreSeq = payload.seq;
      const time = now(), plan = offshorePlan(this.state), ship = sampleOffshoreVoyage(plan, time);
      if (!player.connected) return;
      if (time - controls.offshoreAt < 300) { this.rejectMessage(client, 'OFFSHORE_COOLDOWN', '请稍候再操作船只。'); return; }
      controls.offshoreAt = time;
      if (player.spaceMode && player.spaceMode !== 'ground') { this.rejectMessage(client,'SPACE_TRAVEL','请先返回地面。');return;}
      if (payload.action === 'board') {
        if (player.aboard) return;
        if (!canBoardOffshore(player, plan, time)) { this.rejectMessage(client, 'OFFSHORE_BOARD', ship.docked ? '请先来到南岸码头的登船点。' : '船只正在海上，请等待靠港后登船。'); return; }
        const occupied = new Set([...this.state.players.values()].filter(p => p.aboard).map(p => p.offshoreSeat));
        const seat = Array.from({ length: OFFSHORE_SEATS }, (_, i) => i).find(i => !occupied.has(i));
        if (seat === undefined) { this.rejectMessage(client, 'OFFSHORE_FULL', '本船 8 个观景位已满。'); return; }
        Object.assign(player, sampleOffshorePassenger(plan, time, seat));
      } else {
        if (!player.aboard) { this.rejectMessage(client, 'OFFSHORE_NOT_ABOARD', '请先登船，再操作航行。'); return; }
        if (payload.action === 'depart') {
          if (!ship.docked) { this.rejectMessage(client, 'OFFSHORE_SAILING', '船只已在航行，请稍候。'); return; }
          this.state.offshoreStartAt = Math.max(1, time); this.state.offshoreReturnAt = 0;
        } else if (payload.action === 'return') {
          if (!ship.docked && !plan.returnAt) this.state.offshoreReturnAt = time;
        } else if (payload.action === 'disembark') {
          if (!ship.docked) { this.rejectMessage(client, 'OFFSHORE_AT_SEA', '航行中不能离船，请先返航靠港。'); return; }
          Object.assign(player, OFFSHORE_ARRIVAL, { y: 0, vy: 0, moving: false, jetpack: false, thrusting: false, hovering: false, aboard: false, offshoreSeat: -1, deckX: 0, deckZ: 0, deckYaw: 0 });
        }
      }
      this.inputs.delete(client.sessionId);
    }

    receiveSpace(client,payload) {
      const player=this.state.players.get(client.sessionId);
      if(!player||!validSpaceAction(payload,player.spaceSeq)){this.rejectMessage(client,'SPACE_INVALID','电梯操作无效或已过期。');return;}
      player.spaceSeq=payload.seq;
      if(payload.action.startsWith('rail-')){
        const train=sampleRail(this.state.railEpoch,now(),this.state.railFrom);
        if(!player.connected)return;
        if(payload.action==='rail-board'&&canBoardRail(player,train))Object.assign(player,railPassenger({...player,...railLocal(player,train),railYaw:player.yaw-train.yaw},train));
        else if(payload.action==='rail-exit'&&player.spaceMode==='rail'&&train.docked)Object.assign(player,railExit(player,train));
        else if(payload.action==='rail-depart'&&player.spaceMode==='rail'&&train.docked){this.state.railFrom=train.station;this.state.railEpoch=now();}
        else if(payload.action==='rail-call'&&player.spaceMode==='ground'&&!player.aboard&&train.docked&&train.station!==nearRailStation(player)&&![...this.state.players.values()].some(p=>p.spaceMode==='rail')&&nearRailStation(player)>=0){this.state.railFrom=train.station;this.state.railEpoch=now();}
        else {this.rejectMessage(client,'RAIL_STATION','列车停稳后，请从站台车门处登乘或下车。');return;}
        this.inputs.delete(client.sessionId);return;
      }
      if(!player.connected||(payload.action==='ascend'?!canAscend(player):!canDescend(player))){this.rejectMessage(client,'SPACE_TERMINAL','请先走到实体电梯站内，再登梯。');return;}
      Object.assign(player,{spaceMode:payload.action==='ascend'?'ascent':'descent',spaceStartAt:now(),moving:false,jetpack:false,thrusting:false,hovering:false,vy:0});
      Object.assign(player,advanceElevator(player,now())); this.inputs.delete(client.sessionId);
    }

    step(deltaMs) {
      this.state.tick += 1;
      const time = now();
      this.state.serverTime = time;
      Object.assign(this.state,advanceRailSchedule(this.state.railEpoch,time,this.state.railFrom));
      for (const [sessionId, player] of this.state.players) {
        const input = this.inputs.get(sessionId);
        const direction = player.connected && input && time - input.at <= INPUT_TIMEOUT_MS ? input : { x: 0, z: 0 };
        if(player.spaceMode==='rail'){Object.assign(player,railPassenger(stepRail(player,direction,deltaMs/1000),sampleRail(this.state.railEpoch,time,this.state.railFrom)));continue;}
        if (player.spaceMode === 'ascent' || player.spaceMode === 'descent') { Object.assign(player,advanceElevator(player,time));continue; }
        if (player.spaceMode === 'orbit') { Object.assign(player,placeInOrbit(player,stepOrbitAvatar(orbitState(player),direction,deltaMs/1000)));continue; }
        if (player.aboard) {
          const local = stepOffshoreDeck(player, direction, deltaMs / 1000);
          Object.assign(player, sampleOffshorePassenger(offshorePlan(this.state), time, player.offshoreSeat, local));
          continue;
        }
        const { rescued, ...next } = stepAvatar(player, direction, deltaMs / 1000);
        Object.assign(player, next);
      }
    }

    onDrop(client, code) {
      this.trace('onDrop', client, { closeCode: code });
      const player = this.state.players.get(client.sessionId);
      if(player?.spaceMode && player.spaceMode!=='ground'){player.connected=false;player.moving=false;player.thrusting=false;player.hovering=false;}
      else if (player?.aboard) { player.connected = false; player.moving = false; }
      else if (player) { const landing = safeLanding(player.x, player.z); Object.assign(player, landing, { connected: false, moving: false, y: groundHeight(landing.x, landing.z), vy: 0, jetpack: false, thrusting: false, hovering: false }); }
      this.inputs.delete(client.sessionId);
      // Oversized payloads and policy violations do not reserve a reusable seat.
      if (player && ![1008, 1009].includes(code)) {
        const reconnection = this.allowReconnection(client, reconnectSeconds);
        this.trace('allowReconnection.registered', client, { registered: this.hasReservedSeat(client.sessionId), reconnectSeconds });
        reconnection.then(
          () => this.trace('allowReconnection.resolved', client),
          () => this.trace('allowReconnection.ended', client),
        );
      } else this.trace('allowReconnection.skipped', client, { closeCode: code, registered: false });
    }

    onReconnect(client) {
      this.trace('onReconnect', client);
      const player = this.state.players.get(client.sessionId);
      if(player?.spaceMode && player.spaceMode!=='ground'){player.connected=true;player.moving=false;}
      else if (player?.aboard) { Object.assign(player, sampleOffshorePassenger(offshorePlan(this.state), now(), player.offshoreSeat, { deckX: player.deckX, deckZ: player.deckZ, deckYaw: player.deckYaw, moving: false }), { connected: true }); }
      else if (player) { const landing = safeLanding(player.x, player.z); Object.assign(player, landing, { connected: true, moving: false, y: groundHeight(landing.x, landing.z), vy: 0, jetpack: false, thrusting: false, hovering: false }); }
      this.inputs.delete(client.sessionId);
    }

    onLeave(client, code) {
      this.trace('onLeave', client, { closeCode: code });
      this.inputs.delete(client.sessionId);
      this.controls.delete(client.sessionId);
      this.state.players.delete(client.sessionId);
      this.trace('onLeave.cleaned', client, { closeCode: code });
    }

    onDispose() {
      this.trace('onDispose');
      if (roomCodes.get(this.state.code) === this.roomId) roomCodes.delete(this.state.code);
      this.inputs.clear();
      this.controls.clear();
    }
  };
}
