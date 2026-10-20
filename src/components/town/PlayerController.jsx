import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GAMES } from '../../lib/catalog';
import { FOUNTAIN, getDestination, isWalkable, movePlayer, SPAWN } from '../../../shared/world.js';
import { SERVER_TICK_MS } from '../../../shared/protocol.js';
import { startJump, stepJump } from '../../../shared/jump.js';
import { JETPACK, startAvatarJump, stepAvatar, stoppedVertical, safeLanding, stepFlightVertical, flightFloor } from '../../../shared/jetpack.js';
import { FISHING_SPOT } from '../../../shared/river.js';
import { CAMERA_OFFSETS, FOLLOW_LOOK, cameraTarget as getCameraTarget, cameraZoom, townWonderCamera, followCameraLens, followOrbitCamera, flightCameraFar } from './camera.js';
import { sequencedInput } from './inputSequence.js';
import FirstPersonLook from './FirstPersonLook.jsx';
import { closeThirdPersonLens, closeThirdPersonCamera, firstPersonInput } from './firstPerson.js';
import { nearestOutdoorGame } from '../../minigames/outdoor.js';
import { OFFSHORE_ARRIVAL, sampleOffshorePassenger } from '../../../shared/offshore-island.js';

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const ZERO_INPUT = Object.freeze({ x: 0, z: 0 });

function angleTowards(current, target, factor) {
  return current + Math.atan2(Math.sin(target - current), Math.cos(target - current)) * factor;
}

function worldInput(held, touch, lookYaw = null) {
  const forward = Number(!!(held.KeyW || held.ArrowUp || touch.forward)) - Number(!!(held.KeyS || held.ArrowDown || touch.backward));
  const right = Number(!!(held.KeyD || held.ArrowRight || touch.right)) - Number(!!(held.KeyA || held.ArrowLeft || touch.left));
  if (lookYaw !== null) return firstPersonInput(forward, right, lookYaw);
  const length = Math.hypot(forward, right);
  return length ? { x: (right * 0.817 - forward * 0.577) / length, z: (-right * 0.577 - forward * 0.817) / length } : ZERO_INPUT;
}

function RemotePlayer({ player, snapshotRef, Model, reducedMotion, offshoreRef }) {
  const pose = useRef({ x: player.x, y: player.y || 0, z: player.z, vy: player.vy || 0, yaw: player.yaw, moving: false, jetpack: player.jetpack, thrusting: player.thrusting, hovering: player.hovering });
  const latest = useRef({ ...player, receivedAt: performance.now() });
  const lastSnapshot = useRef(null);

  useEffect(() => {
    latest.current = { ...player, receivedAt: performance.now() };
  }, [player]);

  useFrame((_, frameDelta) => {
    const snapshot = snapshotRef?.current;
    if (snapshot && snapshot !== lastSnapshot.current) {
      const authoritative = snapshot.players?.find(item => item.id === player.id);
      if (authoritative) latest.current = { ...authoritative, receivedAt: performance.now() };
      lastSnapshot.current = snapshot;
    }
    const next = latest.current;
    const current = pose.current;
    const voyage = offshoreRef?.current;
    if (next.aboard && voyage) {
      Object.assign(current, sampleOffshorePassenger(voyage.plan, voyage.now, next.offshoreSeat));
      return;
    }
    if (current.aboard) Object.assign(current, next, { aboard: false });
    const distance = Math.hypot(current.x - next.x, current.z - next.z);
    const factor = distance > 3 || reducedMotion ? 1 : 1 - Math.exp(-Math.min(frameDelta, 0.05) * 16);
    current.x += (next.x - current.x) * factor;
    current.z += (next.z - current.z) * factor;
    // Small extrapolation keeps 10 Hz patches smooth; gravity also brings a
    // briefly stalled remote snapshot safely back to the ground.
    const vertical = { y: next.y || 0, vy: next.vy || 0, jetpack: next.jetpack, thrusting: next.thrusting, hovering: next.hovering };
    let elapsed = Math.min(1, Math.max(0, (performance.now() - next.receivedAt) / 1000));
    let simulated = 0;
    while (elapsed > 0) {
      const dt = Math.min(0.1, elapsed);
      Object.assign(vertical, next.jetpack ? stepFlightVertical(vertical, next.thrusting && simulated < 0.2, dt, flightFloor(next.x, next.z), next.hovering && simulated < 0.2) : stepJump(vertical, dt));
      elapsed -= dt; simulated += dt;
    }
    current.y += (vertical.y - current.y) * factor;
    current.vy = vertical.vy;
    current.jetpack = vertical.jetpack === true; current.thrusting = vertical.thrusting === true; current.hovering = vertical.hovering === true;
    if (vertical.y === 0 && current.y < 0.005) current.y = 0;
    current.yaw = angleTowards(current.yaw, next.yaw, factor);
    // A stalled connection never leaves a remote avatar walking in place indefinitely.
    current.moving = next.connected !== false && !!next.moving && distance > 0.015 && performance.now() - next.receivedAt < 400;
  });

  return <Model poseRef={pose} name={player.connected === false ? `${player.name} · 重连中` : player.name} color={player.color} reducedMotion={reducedMotion} />;
}

export default function PlayerController({ Model, active, inputRef, destination, onNearest, reducedMotion, network, viewMode = 'overview', onStartExploring, onLookStatus, playerPoseRef, outdoorRef, onNearestOutdoor, npcTimeRef, flightRef, onFlyingChange, offshoreRef }) {
  const pose = useRef({ ...SPAWN, y: 0, vy: 0, moving: false, jetpack: false, thrusting: false, hovering: false });
  const heldSince = useRef(null);
  const hoverRequested = useRef(false);
  const hoverEnabled = useRef(false);
  const suppressHeldThrust = useRef(false);
  const publishedFlight = useRef(false);
  const outdoorReturn = useRef(null);
  const nearestOutdoor = useRef(null);
  const outdoorOffset = useRef(new THREE.Vector3(18, 24, 28));
  // Share the rendered/predicted pose with ambient NPC proximity only. This
  // never feeds NPC data back into player or server movement authority.
  useEffect(() => { if (playerPoseRef) playerPoseRef.current = pose.current; }, [playerPoseRef]);
  const keys = useRef({});
  const jumpRequested = useRef(false);
  const verticalSequence = useRef(-1);
  const focused = useRef(true);
  const nearest = useRef(null);
  const callbacks = useRef({ onNearest, network, viewMode, onStartExploring });
  callbacks.current = { onNearest, network, viewMode, onStartExploring };
  const explorationRequested = useRef(false);
  const seq = useRef(0);
  const lastSent = useRef({ x: 0, z: 0, at: -Infinity });
  const lastInput = useRef(ZERO_INPUT);
  const authority = useRef({ session: null, tick: -1, correctionX: 0, correctionZ: 0, correctionY: 0 });
  const cameraTarget = useRef(new THREE.Vector3(0, 0, 3));
  const desiredTarget = useRef(new THREE.Vector3());
  const cameraPosition = useRef(new THREE.Vector3());
  const cameraOffset = useRef(new THREE.Vector3(...CAMERA_OFFSETS.overview));
  const cameraInitialized = useRef(false);
  const orbitCameraCache = useRef(null);
  const look = useRef({ yaw: 0, pitch: 0.12 });
  const firstPerson = viewMode === 'first-person';
  const follow = viewMode === 'follow';
  const previousView = useRef(null);
  const { camera, size, invalidate } = useThree();
  const connected = network?.status === 'connected';
  const waitingForServer = ['connecting', 'reconnecting'].includes(network?.status);
  const players = connected ? network.players || [] : [];
  const self = players.find(player => player.id === network.selfId);

  function startExploring() {
    if (!['overview', 'wonder'].includes(callbacks.current.viewMode) || explorationRequested.current) return;
    explorationRequested.current = true;
    callbacks.current.onStartExploring?.();
    invalidate();
  }

  useEffect(() => {
    explorationRequested.current = false;
    cameraInitialized.current = false;
    if (!pose.current.jetpack) stopInput();
    if (pose.current.aboard && ['follow', 'first-person'].includes(viewMode)) {
      // Start outside the port-side viewing corridor, not behind a solid cabin.
      // This heading is ship-local while aboard; right-drag can still orbit it.
      look.current = { yaw: Math.PI / 2, pitch: .12 };
    } else if (viewMode === 'first-person') {
      // Start behind the avatar, on foot or airborne. The close camera and a
      // held W key retain its heading instead of turning towards a landmark.
      look.current.yaw = Math.atan2(Math.sin(pose.current.yaw), -Math.cos(pose.current.yaw));
      look.current.pitch = 0.12;
    } else if (viewMode === 'follow' && previousView.current !== 'first-person') {
      look.current = { ...FOLLOW_LOOK };
    }
    previousView.current = viewMode;
  }, [viewMode]);

  function sendInput(input) {
    const currentNetwork = callbacks.current.network;
    if (currentNetwork?.status !== 'connected' || typeof currentNetwork.sendInput !== 'function') return;
    const packet = sequencedInput(input, seq.current, currentNetwork.snapshotRef?.current, currentNetwork.selfId);
    if (!packet || currentNetwork.sendInput(packet) === false) return;
    seq.current = packet.seq;
    lastSent.current = { ...input, at: performance.now() };
    return packet.seq;
  }

  function stopInput() {
    keys.current = {};
    heldSince.current = null;
    hoverRequested.current = false;
    hoverEnabled.current = false;
    suppressHeldThrust.current = false;
    jumpRequested.current = false;
    if (inputRef) inputRef.current = {};
    lastInput.current = ZERO_INPUT;
    Object.assign(pose.current, stoppedVertical(pose.current));
    authority.current.correctionY = 0;
    const stopSeq = sendInput({ ...ZERO_INPUT, stop: true });
    if (Number.isSafeInteger(stopSeq)) verticalSequence.current = stopSeq;
    invalidate();
  }

  useEffect(() => {
    const editable = element => element?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName);
    // Space belongs to the focused UI control (including icons inside it).
    // The dedicated jump button queues through its own native keyboard click.
    const interactive = element => ['BUTTON', 'A', 'SUMMARY'].includes(element?.tagName)
      || !!element?.closest?.('button,a[href],summary,[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="menuitem"],[role="option"],[role="slider"]');
    const keydown = event => {
      if (!active || outdoorRef?.current || offshoreRef?.current?.aboard || event.ctrlKey || event.metaKey || event.altKey || editable(event.target)) return;
      if (event.code === 'KeyH') {
        if (interactive(event.target) || event.repeat || keys.current.KeyH) return;
        keys.current.KeyH = true;
        hoverRequested.current = true;
        event.preventDefault();
        invalidate();
      }
      if (event.code === 'Space') {
        if (interactive(event.target)) return;
        event.preventDefault();
        focused.current = true;
        // Jumping in the overview must not switch cameras and erase the same
        // event through the mode-change stop effect. Holding never auto-jumps.
        if (!event.repeat && !keys.current.Space) jumpRequested.current = true;
        keys.current.Space = true;
        invalidate();
      }
      if (MOVEMENT_KEYS.has(event.code)) {
        focused.current = true;
        startExploring();
        keys.current[event.code] = true;
        event.preventDefault();
        invalidate();
      }
    };
    const keyup = event => { delete keys.current[event.code]; };
    const blur = () => { focused.current = false; stopInput(); };
    const focus = () => { focused.current = true; };
    const visibility = () => { focused.current = !document.hidden; stopInput(); };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
      stopInput();
    };
  }, [active]);

  useEffect(() => { if (!active) stopInput(); }, [active]);

  useEffect(() => {
    if (!connected) {
      authority.current.session = null;
      authority.current.signature = null;
      authority.current.correctionX = 0;
      authority.current.correctionZ = 0;
      authority.current.correctionY = 0;
      verticalSequence.current = -1;
      jumpRequested.current = false;
      hoverRequested.current = false;
      hoverEnabled.current = false;
      suppressHeldThrust.current = false;
      if (inputRef) inputRef.current = {};
      lastSent.current.at = -Infinity;
      keys.current = {};
      pose.current.moving = false;
      pose.current.y = 0;
      pose.current.vy = 0;
      pose.current.hovering = false;
    }
  }, [connected]);

  function reconcileSelf(snapshotPlayer, snapshotTick) {
    if (!snapshotPlayer) return;
    const current = pose.current;
    const state = authority.current;
    const signature = `${snapshotPlayer.id}:${snapshotTick ?? snapshotPlayer.serverTick}:${snapshotPlayer.seq}:${snapshotPlayer.x}:${snapshotPlayer.z}:${snapshotPlayer.y}:${snapshotPlayer.vy}:${snapshotPlayer.yaw}:${snapshotPlayer.moving}:${snapshotPlayer.jetpack}:${snapshotPlayer.thrusting}:${snapshotPlayer.hovering}`;
    if (state.signature === signature) return;
    state.signature = signature;
    seq.current = Math.max(seq.current, Number(snapshotPlayer.seq) || 0);
    const firstSnapshot = state.session !== snapshotPlayer.id;
    const distance = Math.hypot(current.x - snapshotPlayer.x, current.z - snapshotPlayer.z);
    if (firstSnapshot || distance > 3) {
      Object.assign(current, { x: snapshotPlayer.x, z: snapshotPlayer.z, yaw: snapshotPlayer.yaw, moving: false });
      state.correctionX = 0;
      state.correctionZ = 0;
      // Room transitions and server-authorized travel must not replay held input.
      stopInput();
      Object.assign(current, { y: snapshotPlayer.y || 0, vy: snapshotPlayer.vy || 0, jetpack: snapshotPlayer.jetpack === true, thrusting: snapshotPlayer.thrusting === true, hovering: snapshotPlayer.hovering === true });
    } else {
      // Input is predicted locally; a small server correction is spread over frames.
      // At most one server tick is extrapolated, never a client-supplied position.
      const lead = snapshotPlayer.moving && active ? SERVER_TICK_MS / 1000 : 0;
      const target = stepAvatar(snapshotPlayer, lastInput.current, lead);
      state.correctionX = target.x - current.x;
      state.correctionZ = target.z - current.z;
      if (!current.moving) current.yaw = snapshotPlayer.yaw;
      // A patch from before our jump/stop must not erase a predicted jump or
      // resurrect a canceled one. The server sequence remains the authority.
      if (snapshotPlayer.seq >= verticalSequence.current) {
        const vertical = stepAvatar(snapshotPlayer, lastInput.current, active && focused.current ? SERVER_TICK_MS / 1000 : 0);
        state.correctionY = vertical.y - current.y;
        current.vy = vertical.vy;
        current.jetpack = snapshotPlayer.jetpack === true; current.thrusting = snapshotPlayer.thrusting === true; current.hovering = snapshotPlayer.hovering === true;
      }
    }
    state.session = snapshotPlayer.id;
    state.tick = snapshotTick ?? snapshotPlayer.serverTick;
  }

  useEffect(() => {
    if (!destination) return;
    if (['connecting', 'reconnecting'].includes(callbacks.current.network?.status)) return;
    if (callbacks.current.network?.status === 'connected') {
      stopInput();
      callbacks.current.network.travel?.(destination.id);
      return;
    }
    const next = getDestination(destination.id);
    if (next) {
      Object.assign(pose.current, next, { moving: false });
      if (viewMode === 'first-person') { look.current.yaw = Math.atan2(Math.sin(next.yaw), -Math.cos(next.yaw)); look.current.pitch = .12; }
      stopInput();
      invalidate();
    }
  }, [destination]);

  useEffect(() => {
    // DroneCamera owns its full lens/rail; never overwrite its far plane after
    // the declarative camera's layout effects (especially on portrait screens).
    if (viewMode === 'drone' || viewMode === 'sphere' || viewMode === 'offshore') { invalidate(); return; }
    if (firstPerson || follow || viewMode === 'wonder') {
      // The declarative PerspectiveCamera becomes default after its layout
      // effect. Do not accidentally turn the preserved orthographic camera
      // into the first-person lens during that transition.
      if (camera.isPerspectiveCamera) {
        camera.zoom = 1;
        camera.fov = firstPerson ? closeThirdPersonLens(camera.aspect).fov : follow ? followCameraLens(camera.aspect).fov : 50;
        camera.near = 0.08;
        camera.far = firstPerson || follow ? flightCameraFar(pose.current.y) : 420;
        camera.updateProjectionMatrix();
      }
      invalidate();
      return;
    }
    if (!camera.isOrthographicCamera) return;
    // R3F only resizes its current default camera. The preserved orthographic
    // camera can retain an old aspect while first person owns the canvas.
    // Restore the default automatic frustum before applying the town zoom.
    if (!camera.manual) {
      camera.left = -size.width / 2;
      camera.right = size.width / 2;
      camera.top = size.height / 2;
      camera.bottom = -size.height / 2;
    }
    camera.zoom = cameraZoom(viewMode, size.width, size.height);
    cameraOffset.current.fromArray(CAMERA_OFFSETS[viewMode] || CAMERA_OFFSETS.follow);
    camera.far = 420;
    camera.updateProjectionMatrix();
    if (!cameraInitialized.current || reducedMotion) {
      const target = getCameraTarget(viewMode, pose.current, size.width, reducedMotion ? 0 : npcTimeRef?.current);
      cameraTarget.current.set(target.x, target.y, target.z);
      camera.position.copy(cameraTarget.current).add(cameraOffset.current);
      camera.lookAt(cameraTarget.current);
      cameraInitialized.current = true;
    }
    // View switches and resizing must also draw while a solo modal uses demand.
    invalidate();
  }, [camera, size.width, size.height, viewMode, firstPerson, reducedMotion, invalidate]);

  useFrame((_, frameDelta) => {
    const delta = Math.min(frameDelta, 0.1);
    const current = pose.current;
    const voyage = offshoreRef?.current;
    if (voyage?.aboard) {
      if (!current.aboard) {
        stopInput(); nearest.current = null; nearestOutdoor.current = null;
        outdoorReturn.current = null;
        if (camera.isOrthographicCamera) camera.clearViewOffset();
        callbacks.current.onNearest?.(null); onNearestOutdoor?.(null);
        authority.current.correctionX = 0; authority.current.correctionY = 0; authority.current.correctionZ = 0;
        if (publishedFlight.current) { publishedFlight.current = false; onFlyingChange?.(false); }
      }
      // Fixed viewing stations share the exact server route and deck transform.
      // Neither prediction nor gravity may pull passengers off the moving ship.
      Object.assign(current, sampleOffshorePassenger(voyage.plan, voyage.now, voyage.seat), { activity: null });
      if (flightRef) Object.assign(flightRef.current, { height: 0, flying: false, thrusting: false, hovering: false, speed: 0 });
      if ((firstPerson || follow) && camera.isPerspectiveCamera) {
        const shot = (firstPerson ? closeThirdPersonCamera : followOrbitCamera)(current, look.current.yaw - voyage.sample.yaw, look.current.pitch, { aspect: camera.aspect });
        camera.position.set(shot.position.x, shot.position.y, shot.position.z);
        desiredTarget.current.set(shot.target.x, shot.target.y, shot.target.z);
        camera.lookAt(desiredTarget.current);
      } else if (camera.isOrthographicCamera) {
        const target = getCameraTarget(viewMode, current, size.width, npcTimeRef?.current);
        cameraTarget.current.set(target.x, target.y, target.z);
        camera.position.copy(cameraTarget.current).add(cameraOffset.current);
        camera.lookAt(cameraTarget.current);
      }
      return;
    }
    if (current.aboard) {
      Object.assign(current, OFFSHORE_ARRIVAL, { y: 0, vy: 0, aboard: false, offshoreSeat: -1, moving: false, jetpack: false, thrusting: false, hovering: false });
      look.current = firstPerson ? { yaw: Math.PI, pitch: .12 } : { ...FOLLOW_LOOK };
      authority.current.session = null; authority.current.tick = -1;
      authority.current.correctionX = 0; authority.current.correctionY = 0; authority.current.correctionZ = 0;
      cameraInitialized.current = false; stopInput();
    }
    const outdoor = outdoorRef?.current;
    if (outdoor) {
      if (!outdoorReturn.current) {
        outdoorReturn.current = { ...current };
        stopInput();
        callbacks.current.onNearest?.(null);
        onNearestOutdoor?.(null);
        if (publishedFlight.current) { publishedFlight.current = false; onFlyingChange?.(false); }
      }
      // Never send practice positions to the room. Peers keep the stationary
      // authoritative avatar; exiting reconciles against the latest snapshot.
      // OutdoorPlay owns the render-independent clock and blur/visibility pause.
      Object.assign(current, outdoor.pose, { vy: 0, jetpack: false, thrusting: false, hovering: false, activity: outdoor.id, fishingPhase: outdoor.phase, fishingTime: outdoor.timer || 0 });
      if (camera.isOrthographicCamera) {
        let x = current.x, z = current.z, y = current.y + 1;
        if (outdoor.id === 'fishing') { x = FISHING_SPOT.x - 1.4; z = FISHING_SPOT.z; y = 0.6; }
        if (outdoor.id === 'hop') { x += 1.8; z -= 0.2; y = 1.6; }
        if (outdoor.id === 'jetpack') { z -= size.width < 700 ? 1.7 : 3.5; y = size.width < 700 ? current.y + 1.2 : 3.5; }
        camera.zoom = Math.min(size.width / (size.width < 700 ? 18 : 34), size.height / (size.width < 700 ? 27 : 22));
        desiredTarget.current.set(x, y, z);
        cameraTarget.current.lerp(desiredTarget.current, reducedMotion ? 1 : 1 - Math.exp(-delta * 7));
        camera.position.copy(cameraTarget.current).add(outdoorOffset.current);
        camera.lookAt(cameraTarget.current);
        camera.setViewOffset(size.width, size.height, size.width < 700 ? 0 : -size.width * 0.16, size.width < 700 ? size.height * 0.25 : 0, size.width, size.height);
        camera.updateProjectionMatrix();
      }
      return;
    }
    if (outdoorReturn.current) {
      const back = outdoorReturn.current;
      Object.assign(current, back, safeLanding(back.x, back.z), { y: 0, vy: 0, moving: false, jetpack: false, thrusting: false, activity: null });
      outdoorReturn.current = null;
      authority.current.signature = null;
      authority.current.correctionX = 0; authority.current.correctionZ = 0; authority.current.correctionY = 0;
      if (camera.isOrthographicCamera) { camera.clearViewOffset(); camera.zoom = cameraZoom(viewMode, size.width, size.height); camera.updateProjectionMatrix(); }
      cameraTarget.current.set(current.x, 1.2, current.z);
      nearest.current = null; nearestOutdoor.current = null;
      stopInput();
    }
    const snapshot = network?.snapshotRef?.current;
    const frameSelf = connected ? (snapshot?.players || players).find(player => player.id === (snapshot?.selfId || network.selfId)) : null;
    if (frameSelf) reconcileSelf(frameSelf, snapshot?.tick);
    const canControl = active && !waitingForServer && focused.current && !document.hidden && (!connected || !!frameSelf);
    const direction = canControl ? worldInput(keys.current, inputRef?.current || {}, firstPerson || follow ? look.current.yaw : null) : ZERO_INPUT;
    const rawSpaceHeld = canControl && !!(keys.current.Space || inputRef?.current?.jetHeld);
    const touchHover = Number.isFinite(inputRef?.current?.hoverToggle) && inputRef.current.hoverToggle > 0;
    if (touchHover) inputRef.current.hoverToggle = 0;
    if (canControl && (hoverRequested.current || touchHover) && current.y > flightFloor(current.x, current.z) + .001) {
      hoverEnabled.current = !hoverEnabled.current;
      // H must work while the engine button is still held. Suppress that hold
      // until release; the next fresh Space/touch hold resumes the engine.
      suppressHeldThrust.current = rawSpaceHeld;
      heldSince.current = null;
      jumpRequested.current = false;
      authority.current.correctionY = 0;
    }
    hoverRequested.current = false;
    if (!rawSpaceHeld) suppressHeldThrust.current = false;
    const spaceHeld = rawSpaceHeld && !suppressHeldThrust.current;
    const resumingHover = spaceHeld && hoverEnabled.current;
    if (spaceHeld) hoverEnabled.current = false;
    if (spaceHeld && heldSince.current === null) heldSince.current = performance.now() - (resumingHover ? JETPACK.holdSeconds * 1000 + 1 : 0);
    if (!spaceHeld) heldSince.current = null;
    const thrust = spaceHeld && (performance.now() - heldSince.current) / 1000 >= JETPACK.holdSeconds;
    const input = { ...direction, thrust, hover: canControl && hoverEnabled.current };
    const touchJump = Number.isFinite(inputRef?.current?.jumpRequested) && inputRef.current.jumpRequested > 0;
    if (touchJump) inputRef.current.jumpRequested = 0;
    const wantsJump = canControl && (jumpRequested.current || touchJump);
    jumpRequested.current = false;
    if (wantsJump) {
      const jump = thrust ? null : startAvatarJump(current);
      if (jump) {
        Object.assign(current, jump);
        authority.current.correctionY = 0;
        const jumpSeq = sendInput({ ...input, jump: true });
        if (Number.isSafeInteger(jumpSeq)) verticalSequence.current = jumpSeq;
      }
    }
    if (input.x || input.z || thrust) startExploring();
    lastInput.current = input;
    if (connected && !document.hidden) {
      const changed = input.x !== lastSent.current.x || input.z !== lastSent.current.z || input.thrust !== lastSent.current.thrust || input.hover !== lastSent.current.hover;
      if (changed || performance.now() - lastSent.current.at >= SERVER_TICK_MS) {
        const sent = sendInput(input);
        if (Number.isSafeInteger(sent) && (input.thrust !== current.thrusting || input.hover !== current.hovering)) verticalSequence.current = sent;
      }
    }
    const predicted = stepAvatar(current, input, delta);
    current.x = predicted.x;
    current.z = predicted.z;
    current.yaw = angleTowards(current.yaw, predicted.yaw, Math.min(1, delta * 14));
    current.moving = predicted.moving;
    Object.assign(current, { y: predicted.y, vy: predicted.vy, jetpack: predicted.jetpack, thrusting: predicted.thrusting, hovering: predicted.hovering });
    if (current.y <= flightFloor(current.x, current.z) + .001) hoverEnabled.current = false;

    if (connected) {
      const state = authority.current;
      const factor = 1 - Math.exp(-delta * 10);
      const dx = state.correctionX * factor;
      const dz = state.correctionZ * factor;
      if (current.jetpack || isWalkable(current.x + dx, current.z)) current.x += dx;
      if (current.jetpack || isWalkable(current.x, current.z + dz)) current.z += dz;
      state.correctionX -= dx;
      state.correctionZ -= dz;
      const dy = state.correctionY * factor;
      current.y = Math.max(0, current.y + dy);
      state.correctionY -= dy;
      if (current.y < 0.005 && current.vy <= 0 && Math.abs(state.correctionY) < 0.005) {
        current.y = 0; current.vy = 0; state.correctionY = 0;
      }
    }

    if (flightRef) Object.assign(flightRef.current, { height: current.y, flying: current.jetpack, thrusting: current.thrusting, hovering: current.hovering, speed: current.vy, rescued: predicted.rescued });
    if (publishedFlight.current !== current.jetpack) { publishedFlight.current = current.jetpack; onFlyingChange?.(current.jetpack); }

    if (viewMode === 'wonder' && camera.isPerspectiveCamera) {
      const shot=townWonderCamera(current,npcTimeRef?.current,camera.aspect,reducedMotion);
      cameraPosition.current.set(...shot.position);desiredTarget.current.set(...shot.target);
      const alpha=!cameraInitialized.current||reducedMotion?1:1-Math.exp(-delta*4);
      camera.position.lerp(cameraPosition.current,alpha);cameraTarget.current.lerp(desiredTarget.current,alpha);
      camera.fov=shot.fov;camera.updateProjectionMatrix();camera.lookAt(cameraTarget.current);cameraInitialized.current=true;
    } else if ((firstPerson || follow) && camera.isPerspectiveCamera) {
      // Collision geometry is static. Standing still or hovering to watch a
      // show should not sweep a long camera boom against every building 60 Hz.
      const signature = [viewMode, current.x, current.y, current.z, look.current.yaw, look.current.pitch, camera.aspect];
      if (!orbitCameraCache.current || signature.some((value, i) => value !== orbitCameraCache.current.signature[i])) {
        orbitCameraCache.current = { signature, shot: (firstPerson ? closeThirdPersonCamera : followOrbitCamera)(current, look.current.yaw, look.current.pitch, { aspect: camera.aspect }) };
      }
      const close = orbitCameraCache.current.shot;
      camera.position.set(close.position.x, close.position.y, close.position.z);
      desiredTarget.current.set(close.target.x, close.target.y, close.target.z);
      camera.lookAt(desiredTarget.current);
      const far = flightCameraFar(current.y);
      if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
    } else if (!firstPerson && camera.isOrthographicCamera) {
      const target = getCameraTarget(viewMode, current, size.width, reducedMotion ? 0 : npcTimeRef?.current);
      desiredTarget.current.set(target.x, target.y, target.z);
      cameraTarget.current.lerp(desiredTarget.current, reducedMotion ? 1 : 1 - Math.exp(-delta * (current.jetpack ? 7 : 2)));
      const cameraSettling = cameraTarget.current.distanceToSquared(desiredTarget.current) > 0.000001;
      if (!cameraSettling) cameraTarget.current.copy(desiredTarget.current);
      cameraPosition.current.copy(cameraTarget.current).add(cameraOffset.current);
      camera.position.copy(cameraPosition.current);
      camera.lookAt(cameraTarget.current);
      // Continue only while settling; otherwise demand mode remains truly idle.
      if (cameraSettling) invalidate();
    }

    let nextNearest = null;
    let distance = 3.2;
    for (const game of GAMES) {
      const currentDistance = Math.hypot(current.x - game.door[0], current.z - game.door[2]);
      if (currentDistance < distance) { nextNearest = game.id; distance = currentDistance; }
    }
    if (nextNearest !== nearest.current) {
      nearest.current = nextNearest;
      callbacks.current.onNearest?.(nextNearest);
    }
    const nearbyOutdoor = nearestOutdoorGame(current);
    if (nearbyOutdoor !== nearestOutdoor.current) { nearestOutdoor.current = nearbyOutdoor; onNearestOutdoor?.(nearbyOutdoor); }
  });

  return <>
    <FirstPersonLook enabled={firstPerson || follow} active={active} orbitOnly={follow} blockedRef={outdoorRef} lookRef={look} onStatus={onLookStatus} onStop={stopInput} />
    <Model poseRef={pose} self name={self?.name || ''} color={self?.color} reducedMotion={reducedMotion} />
    {players.filter(player => player.id !== network.selfId).map(player => <RemotePlayer key={player.id} player={player} snapshotRef={network.snapshotRef} Model={Model} reducedMotion={reducedMotion} offshoreRef={offshoreRef} />)}
  </>;
}
