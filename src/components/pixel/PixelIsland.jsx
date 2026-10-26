import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BLOCK_BY_ID, HOTBAR } from '../../../shared/pixel-world.js';
import { PIXEL_ISLAND } from '../../../shared/pixel-island.js';
import { createPixelRuntime } from './pixelRuntime.js';
import { createPixelMaterial, createPixelChunkGeometry, createBlockParticles } from './pixelVisual.js';

const movement = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'jump', ShiftLeft: 'descend', ShiftRight: 'descend', ControlLeft: 'sprint', ControlRight: 'sprint' };
const formTarget = target => target instanceof Element && !!target.closest('button, input, textarea, select, [contenteditable="true"], [role="dialog"]');
const limit = (v, a, b) => Math.max(a, Math.min(b, v));

/** All meshes remain in the town Canvas; only this controller is local-only. */
export default function PixelIsland({ runtimeRef, onReady, active = false, reducedMotion = false }) {
  const ownRuntime = useRef(null), mount = useRef(), sceneData = useRef(null), callback = useRef(onReady);
  const activeRef = useRef(active), motionRef = useRef(reducedMotion), cameraMode = useRef('');
  const overviewProjection = useRef(false), projectionSize = useRef('');
  const orbit = useRef({ yaw: .76, pitch: .55, distance: 155, moved: false, dragging: false });
  const { camera, gl, size } = useThree(); callback.current = onReady; activeRef.current = active; motionRef.current = reducedMotion;
  if (!ownRuntime.current) ownRuntime.current = runtimeRef?.current ?? createPixelRuntime();
  if (runtimeRef && runtimeRef.current !== ownRuntime.current) runtimeRef.current = ownRuntime.current;
  const runtime = ownRuntime.current;

  useEffect(() => { callback.current?.(runtime); }, [runtime]);
  useEffect(() => {
    const assets = createPixelMaterial(), group = new THREE.Group(); group.name = 'original-pixel-island';
    const chunks = new Map();
    for (let cz = 0; cz < 4; cz += 1) for (let cx = 0; cx < 4; cx += 1) {
      const mesh = new THREE.Mesh(createPixelChunkGeometry(runtime.world, cx, cz), assets.material);
      mesh.name = `pixel-chunk-${cx}-${cz}`; mesh.receiveShadow = true; mesh.castShadow = false;
      group.add(mesh); chunks.set(`${cx},${cz}`, mesh);
    }
    const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(PIXEL_ISLAND.cell + .012, PIXEL_ISLAND.cell + .012, PIXEL_ISLAND.cell + .012));
    const outlineMaterial = new THREE.LineBasicMaterial({ color: '#fff0a8', transparent: true, opacity: .95, depthTest: true });
    const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial); outline.visible = false; outline.renderOrder = 4; group.add(outline);
    const particles = createBlockParticles(); group.add(particles.points);
    const clouds = new THREE.Group(); clouds.name = 'pixel-cumulus';
    const cloudGeometry = new THREE.BoxGeometry(1, 1, 1), cloudMaterial = new THREE.MeshStandardMaterial({ color: '#edf2ef', roughness: 1, transparent: true, opacity: .88, depthWrite: false });
    for (let n = 0; n < 4; n += 1) {
      const cloud = new THREE.Group(); cloud.position.set(90 + n * 19, 37 + (n % 2) * 9, 178 + n * 12);
      for (let part = 0; part < 3; part += 1) { const mesh = new THREE.Mesh(cloudGeometry, cloudMaterial); mesh.position.set(part * 3, part % 2, part % 2 * 2); mesh.scale.set(7 - part, 2.2, 4.3); cloud.add(mesh); }
      clouds.add(cloud);
    }
    group.add(clouds); mount.current.add(group);

    const hand = new THREE.Group(); hand.name = 'pixel-local-first-person-hand';
    const armGeometry = new THREE.BoxGeometry(.19, .33, .2), armMaterial = new THREE.MeshStandardMaterial({ color: '#dcae80', roughness: 1 });
    const arm = new THREE.Mesh(armGeometry, armMaterial); arm.position.set(.4, -.42, -.58); arm.rotation.z = -.28; hand.add(arm);
    const heldGeometry = new THREE.BoxGeometry(.22, .22, .22), heldMaterial = new THREE.MeshStandardMaterial({ color: '#7eaf4a', roughness: 1 });
    const held = new THREE.Mesh(heldGeometry, heldMaterial); held.position.set(.37, -.27, -.63); held.rotation.set(.2, .45, .08); hand.add(held);
    hand.visible = false; camera.add(hand);
    sceneData.current = { assets, group, chunks, outline, outlineMaterial, particles, clouds, world: runtime.world, worldRevision: runtime.world.revision, hand, heldMaterial, selected: -1 };
    return () => {
      sceneData.current = null; mount.current?.remove(group); camera.remove(hand);
      chunks.forEach(mesh => mesh.geometry.dispose()); assets.dispose(); outlineGeometry.dispose(); outlineMaterial.dispose();
      particles.dispose(); cloudGeometry.dispose(); cloudMaterial.dispose(); armGeometry.dispose(); armMaterial.dispose(); heldGeometry.dispose(); heldMaterial.dispose();
    };
  }, [camera, runtime]);

  useEffect(() => {
    if (!active) { runtime.deactivate(); cameraMode.current = ''; return; }
    const canvas = gl.domElement, previousTouchAction = canvas.style.touchAction;
    const previousFov = camera.fov, previousView = camera.view?.enabled ? { ...camera.view } : null;
    canvas.style.touchAction = 'none';
    let drag = null;
    const unbind = runtime.bindPointerLock(() => {
      if (document.pointerLockElement === canvas || !activeRef.current) return;
      canvas.tabIndex = 0; canvas.focus({ preventScroll: true });
      // A rejected request is not a lock-loss event: do not clear the fallback
      // mouse's held mining/drag input when it was never locked to begin with.
      try { canvas.requestPointerLock?.()?.catch?.(() => { if (runtime.locked) runtime.setLocked(false); }); }
      catch { if (runtime.locked) runtime.setLocked(false); }
    }, () => { if (document.pointerLockElement === canvas) document.exitPointerLock?.(); });
    const keydown = event => {
      if (formTarget(event.target) || !activeRef.current || event.metaKey || event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') return;
      if (event.code === 'Escape') { runtime.pause(); return; }
      if (event.repeat && ['KeyE', 'KeyF', 'KeyH'].includes(event.code)) return;
      if (event.code === 'KeyE') { event.preventDefault(); runtime.togglePanel('craft'); return; }
      if (event.code === 'KeyH') { event.preventDefault(); runtime.togglePanel('help'); return; }
      if (event.code === 'KeyF') { event.preventDefault(); runtime.action('fly'); return; }
      if (/^Digit[1-9]$/.test(event.code)) { event.preventDefault(); runtime.select(Number(event.code.slice(-1)) - 1); return; }
      if (runtime.phase !== 'playing' || runtime.panel) return;
      const key = movement[event.code]; if (key) { event.preventDefault(); if (!(event.code === 'Space' && event.repeat)) runtime.setInput(key, true); }
    };
    const keyup = event => { const key = movement[event.code]; if (key) runtime.setInput(key, false); };
    const pointerdown = event => {
      if (!activeRef.current) return;
      if (runtime.phase === 'overview') {
        orbit.current.dragging = true; orbit.current.moved = true;
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, mouseMining: false };
        try { canvas.setPointerCapture(event.pointerId); } catch { /* Capture is optional. */ } return;
      }
      if (runtime.phase !== 'playing' || runtime.panel) return;
      if (!runtime.locked) {
        if (event.button === 2) { event.preventDefault(); runtime.action('place'); return; }
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
          mouseMining: event.pointerType !== 'touch' && event.button === 0 };
        // Browsers that deny Pointer Lock still support stationary long-press
        // mining. A deliberate drag cancels mining before turning the camera.
        if (drag.mouseMining) runtime.setInput('mine', true);
        try { canvas.setPointerCapture(event.pointerId); } catch { /* Capture is optional. */ }
        // Touch and denied pointer-lock devices use drag-to-look, not a dead end.
        if (event.pointerType !== 'touch') runtime.requestLock(); return;
      }
      if (event.button === 0) runtime.setInput('mine', true);
      if (event.button === 2) { event.preventDefault(); runtime.action('place'); }
    };
    const pointerup = event => {
      if (drag && event?.pointerId != null && drag.id !== event.pointerId) return;
      if (drag) { try { if (canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id); } catch { /* Already released by the browser. */ } }
      drag = null; orbit.current.dragging = false; runtime.setInput('mine', false);
    };
    const pointermove = event => {
      if (runtime.locked) runtime.look(event.movementX, event.movementY);
      else if (drag && drag.id === event.pointerId) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y; drag.x = event.clientX; drag.y = event.clientY;
        if (runtime.phase === 'overview') { orbit.current.yaw -= dx * .006; orbit.current.pitch = limit(orbit.current.pitch + dy * .004, .18, 1.2); }
        else if (runtime.phase === 'playing' && !runtime.panel) {
          const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
          if (drag.mouseMining && moved > 5) { drag.mouseMining = false; runtime.setInput('mine', false); }
          if (!drag.mouseMining) runtime.look(dx, dy);
        }
        if (event.cancelable) event.preventDefault();
      }
    };
    const wheel = event => {
      if (runtime.phase === 'overview') { event.preventDefault(); orbit.current.distance = limit(orbit.current.distance + event.deltaY * .08, 70, 230); orbit.current.moved = true; }
      else if (runtime.locked) { event.preventDefault(); runtime.select(runtime.selected + Math.sign(event.deltaY)); }
    };
    const lockchange = () => runtime.setLocked(document.pointerLockElement === canvas);
    const blur = () => { pointerup(); runtime.pause(); };
    const visibility = () => { if (document.hidden) blur(); };
    const contextmenu = event => { if (activeRef.current) event.preventDefault(); };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('pointerup', pointerup);
    window.addEventListener('pointercancel', pointerup);
    window.addEventListener('pointermove', pointermove); window.addEventListener('blur', blur); window.addEventListener('pagehide', blur);
    document.addEventListener('visibilitychange', visibility); document.addEventListener('pointerlockchange', lockchange);
    canvas.addEventListener('pointerdown', pointerdown); canvas.addEventListener('contextmenu', contextmenu); canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('pointerup', pointerup);
      window.removeEventListener('pointercancel', pointerup);
      window.removeEventListener('pointermove', pointermove); window.removeEventListener('blur', blur); window.removeEventListener('pagehide', blur);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('pointerlockchange', lockchange);
      canvas.removeEventListener('pointerdown', pointerdown); canvas.removeEventListener('contextmenu', contextmenu); canvas.removeEventListener('wheel', wheel);
      pointerup(); canvas.style.touchAction = previousTouchAction; runtime.deactivate(); unbind();
      // Projection offsets belong only to this welcome composition, not Town's
      // camera, the drone spectator or the pixel first-person controller.
      if (overviewProjection.current) { camera.clearViewOffset(); overviewProjection.current = false; }
      if (previousView) camera.setViewOffset(previousView.fullWidth, previousView.fullHeight, previousView.offsetX, previousView.offsetY, previousView.width, previousView.height);
      camera.fov = previousFov; camera.updateProjectionMatrix(); projectionSize.current = '';
    };
  }, [active, camera, gl, runtime]);

  useEffect(() => () => { runtime.deactivate(); }, [runtime]);
  useFrame(({ clock }, dt) => {
    const data = sceneData.current; if (!data) return;
    if (data.world !== runtime.world || data.worldRevision !== runtime.world.revision) {
      const full = data.world !== runtime.world || runtime.dirtyChunks.has('*') || runtime.dirtyChunks.size === 0;
      const keys = full ? [...data.chunks.keys()] : [...runtime.dirtyChunks];
      for (const key of keys) { const mesh = data.chunks.get(key); if (!mesh) continue; const [cx, cz] = key.split(',').map(Number);
        const old = mesh.geometry; mesh.geometry = createPixelChunkGeometry(runtime.world, cx, cz); old.dispose(); }
      runtime.dirtyChunks.clear(); data.world = runtime.world; data.worldRevision = runtime.world.revision;
    }
    for (const event of runtime.takeEffects()) if (!motionRef.current) data.particles.burst(event);
    data.particles.update(Math.min(dt, .04));
    if (!motionRef.current) data.clouds.position.x = Math.sin(clock.elapsedTime * .014) * 4;
    const target = runtime.target;
    data.outline.visible = !!activeRef.current && runtime.phase === 'playing' && !runtime.panel && !!target;
    if (target) { const { origin, cell } = PIXEL_ISLAND; data.outline.position.set(origin.x + (target.x + .5) * cell, origin.y + (target.y + .5) * cell, origin.z + (target.z + .5) * cell); data.outlineMaterial.color.set(runtime.miningProgress > 0 ? '#ffcf79' : '#fff5c2'); }
    data.hand.visible = !!activeRef.current && runtime.phase === 'playing' && !runtime.panel;
    if (!activeRef.current) return;
    const currentPhase = runtime.phase;
    if (currentPhase === 'overview') {
      if (!orbit.current.moved && !motionRef.current) orbit.current.yaw += Math.min(dt, .04) * .025;
      const { yaw, pitch } = orbit.current, look = new THREE.Vector3(PIXEL_ISLAND.x, 8, PIXEL_ISLAND.z);
      const aspect = Math.max(.2, size.width / Math.max(1, size.height));
      // Fit the island's width on portrait screens rather than cutting off both
      // coasts. The lens offset raises its centre above the bottom welcome dock.
      const distance = orbit.current.distance * 1.18 * Math.max(1, .96 / aspect);
      camera.position.set(look.x + Math.sin(yaw) * Math.cos(pitch) * distance, look.y + Math.sin(pitch) * distance, look.z + Math.cos(yaw) * Math.cos(pitch) * distance);
      camera.lookAt(look);
      const sizeKey = `${size.width}:${size.height}`;
      if (cameraMode.current !== 'overview' || projectionSize.current !== sizeKey) {
        camera.fov = 48;
        camera.setViewOffset(size.width, size.height, 0, Math.round(size.height * (aspect < .85 ? .18 : .15)), size.width, size.height);
        overviewProjection.current = true; projectionSize.current = sizeKey;
      }
      camera.updateMatrixWorld();
      // Clouds stay part of the world, but never float behind the white title.
      for (const cloud of data.clouds.children) {
        const projected = cloud.position.clone().add(data.clouds.position).project(camera);
        const x = (projected.x + 1) * .5 * size.width, y = (1 - projected.y) * .5 * size.height;
        cloud.visible = !(x < (aspect < .85 ? size.width : 420) && y < (aspect < .85 ? 220 : 195));
      }
    } else {
      if (overviewProjection.current) { camera.clearViewOffset(); overviewProjection.current = false; projectionSize.current = ''; }
      for (const cloud of data.clouds.children) cloud.visible = true;
      runtime.frame(dt); const p = runtime.player;
      camera.position.set(p.x, p.y + 1.55, p.z); camera.rotation.set(p.pitch || 0, p.yaw || 0, 0, 'YXZ');
      if (cameraMode.current === 'overview' || !cameraMode.current) { camera.fov = 72; camera.updateProjectionMatrix(); }
      if (data.selected !== runtime.selected) { data.heldMaterial.color.set(BLOCK_BY_ID[HOTBAR[runtime.selected]]?.color ?? '#d8c18c'); data.selected = runtime.selected; }
      data.hand.position.y = runtime.miningProgress ? Math.sin(runtime.miningProgress * Math.PI * 3) * .025 : 0;
    }
    cameraMode.current = currentPhase;
    // Read-only diagnostics enable reproducible real-browser interaction tests.
    gl.domElement.dataset.pixelSandbox = JSON.stringify({ phase: currentPhase, mode: runtime.mode,
      x: +runtime.player.x.toFixed(2), y: +runtime.player.y.toFixed(2), z: +runtime.player.z.toFixed(2),
      locked: runtime.locked, edits: runtime.world.changes.size, chunks: data.chunks.size });
  });
  return <group ref={mount} name="pixel-island-world-mount" />;
}
