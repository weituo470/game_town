import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { LOOK_SENSITIVITY, clampLookPitch } from './firstPerson.js';

const finite = value => Number.isFinite(value) ? value : 0;

// Kept separate from React so every browser lifecycle can be regression-tested
// without creating a renderer or asking a browser to capture the user's mouse.
export function bindFirstPersonLook(canvas, getOptions, invalidate = () => {}) {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const originalTouchAction = canvas.style.touchAction;
  let disposed = false;
  let focused = true;
  let wasAvailable = false;
  let stopped = true;
  let lastStatus;
  let pending = false;
  let requestCancelled = false;
  let ownedLock = doc.pointerLockElement === canvas;
  let drag = null;
  let suppressClick = false;
  let lastPointerType = 'mouse';
  let touchStyleApplied = false;
  let previousOrbitOnly = !!getOptions().orbitOnly;

  const available = () => {
    const options = getOptions();
    return !disposed && options.enabled && options.active && !options.blockedRef?.current && !doc.hidden && focused;
  };
  const status = value => {
    if (disposed || value === lastStatus) return;
    lastStatus = value;
    getOptions().onStatus?.(value);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    getOptions().onStop?.();
  };
  const exitOwnLock = () => {
    // Never release a pointer lock belonging to another canvas or document UI.
    if (doc.pointerLockElement !== canvas) return;
    try { doc.exitPointerLock?.(); } catch { /* The document may already be gone. */ }
  };
  const finishDrag = () => {
    const previous = drag;
    drag = null;
    if (!previous) return;
    suppressClick = previous.moved || previous.type !== 'mouse';
    try {
      if (canvas.hasPointerCapture?.(previous.id)) canvas.releasePointerCapture(previous.id);
    } catch { /* Pointer cancellation can release capture before its event. */ }
  };
  const restoreTouchAction = () => {
    if (touchStyleApplied && canvas.style.touchAction === 'none') canvas.style.touchAction = originalTouchAction;
    touchStyleApplied = false;
  };
  const rotate = (dx, dy) => {
    if (!available()) return;
    const lookRef = getOptions().lookRef;
    if (!lookRef) return;
    const previous = lookRef.current || {};
    const yaw = finite(previous.yaw) + finite(dx) * LOOK_SENSITIVITY;
    lookRef.current = {
      yaw: Number.isFinite(yaw) ? yaw : finite(previous.yaw),
      pitch: clampLookPitch(finite(previous.pitch) - finite(dy) * LOOK_SENSITIVITY),
    };
    stopped = false;
    invalidate();
  };

  const sync = () => {
    if (disposed) return;
    const orbitOnly = !!getOptions().orbitOnly;
    if (orbitOnly !== previousOrbitOnly) {
      finishDrag();
      if (orbitOnly) exitOwnLock();
      previousOrbitOnly = orbitOnly;
    }
    const enabled = available();
    if (enabled) {
      if (!wasAvailable) stopped = false;
      canvas.style.touchAction = 'none';
      touchStyleApplied = true;
      status(doc.pointerLockElement === canvas ? 'locked' : 'ready');
    } else {
      if (pending) requestCancelled = true;
      finishDrag();
      restoreTouchAction();
      exitOwnLock();
      stop();
      status('ready');
    }
    wasAvailable = enabled;
  };
  const onLockChange = () => {
    if (doc.pointerLockElement === canvas) {
      pending = false;
      if (!available() || requestCancelled) {
        exitOwnLock();
        stop();
        status('ready');
        return;
      }
      ownedLock = true;
      finishDrag();
      suppressClick = false;
      stopped = false;
      status('locked');
    } else if (ownedLock) {
      ownedLock = false;
      pending = false;
      stop();
      status('ready');
    }
  };
  const onLockError = () => {
    if (!pending) return;
    pending = false;
    if (available()) status('drag');
  };
  const onClick = event => {
    if (!available() || getOptions().orbitOnly || doc.pointerLockElement || pending || event.isTrusted === false) return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (event.pointerType === 'touch' || event.pointerType === 'pen' || lastPointerType !== 'mouse') return;
    if (typeof canvas.requestPointerLock !== 'function') {
      status('drag');
      return;
    }
    pending = true;
    requestCancelled = false;
    try {
      // Only this explicit canvas click handler may request pointer lock. Older
      // browsers return void; current browsers may return a rejecting Promise.
      const request = canvas.requestPointerLock();
      if (request && typeof request.then === 'function') {
        Promise.resolve(request).then(() => {
          pending = false;
          if (!available() || requestCancelled) exitOwnLock();
          else if (doc.pointerLockElement === canvas) onLockChange();
        }).catch(() => {
          pending = false;
          if (available()) status('drag');
        });
      }
    } catch {
      pending = false;
      if (available()) status('drag');
    }
  };
  const onPointerDown = event => {
    const pointerType = event.pointerType || 'mouse';
    // The movement pad may already own the primary touch. A second finger can
    // still look around, but no later finger may replace this canvas's drag.
    const button = getOptions().orbitOnly && pointerType === 'mouse' ? 2 : 0;
    if (!available() || doc.pointerLockElement || drag || (pointerType === 'mouse' && event.isPrimary === false) || (event.button !== undefined && event.button !== button)) return;
    if (button === 2) event.preventDefault?.();
    lastPointerType = pointerType;
    suppressClick = false;
    const x = finite(event.clientX), y = finite(event.clientY);
    drag = { id: event.pointerId, type: lastPointerType, x, y, startX: x, startY: y, moved: false };
    stopped = false;
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* Drag still works inside the canvas. */ }
    if (lastPointerType !== 'mouse') status('drag');
  };
  const onPointerMove = event => {
    if (!available() || doc.pointerLockElement || !drag || drag.id !== event.pointerId) return;
    if (getOptions().orbitOnly && drag.type === 'mouse' && Number.isFinite(event.buttons) && !(event.buttons & 2)) { finishDrag(); return; }
    const x = finite(event.clientX), y = finite(event.clientY);
    const dx = x - drag.x, dy = y - drag.y;
    drag.x = x;
    drag.y = y;
    if (Math.hypot(x - drag.startX, y - drag.startY) > 4) drag.moved = true;
    if (dx || dy) rotate(dx, dy);
    if (drag.moved) status('drag');
  };
  const onPointerEnd = event => {
    if (drag?.id === event.pointerId) {
      finishDrag();
      if (event.type !== 'pointerup') { suppressClick = true; stop(); }
    }
  };
  const onMouseMove = event => {
    if (available() && !getOptions().orbitOnly && doc.pointerLockElement === canvas) rotate(event.movementX, event.movementY);
  };
  const onContextMenu = event => { if (available() && getOptions().orbitOnly) event.preventDefault?.(); };
  const onBlur = () => { focused = false; sync(); };
  const onFocus = () => { focused = true; sync(); };
  const onVisibility = () => sync();
  const listeners = [
    [canvas, 'click', onClick],
    [canvas, 'pointerdown', onPointerDown],
    [canvas, 'pointermove', onPointerMove],
    [canvas, 'pointerup', onPointerEnd],
    [canvas, 'pointercancel', onPointerEnd],
    [canvas, 'lostpointercapture', onPointerEnd],
    [canvas, 'contextmenu', onContextMenu],
    [doc, 'mousemove', onMouseMove],
    [doc, 'pointerlockchange', onLockChange],
    [doc, 'pointerlockerror', onLockError],
    [doc, 'visibilitychange', onVisibility],
    [win, 'blur', onBlur],
    [win, 'focus', onFocus],
  ];
  for (const [target, type, listener] of listeners) target?.addEventListener(type, listener);
  sync();

  return {
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      requestCancelled = true;
      for (const [target, type, listener] of listeners) target?.removeEventListener(type, listener);
      finishDrag();
      restoreTouchAction();
      exitOwnLock();
      stop();
    },
  };
}

export default function FirstPersonLook({ enabled, active, lookRef, onStatus, onStop, orbitOnly = false, blockedRef }) {
  const { gl, invalidate } = useThree();
  const optionsRef = useRef(null);
  const controlsRef = useRef(null);
  const statusRef = useRef(null);
  optionsRef.current = {
    enabled, active, lookRef, onStop, orbitOnly, blockedRef,
    onStatus(status) {
      if (statusRef.current === status) return;
      statusRef.current = status;
      onStatus?.(status);
    },
  };

  useEffect(() => {
    const controls = bindFirstPersonLook(gl.domElement, () => optionsRef.current, invalidate);
    controlsRef.current = controls;
    return () => {
      if (controlsRef.current === controls) controlsRef.current = null;
      controls.dispose();
    };
  }, [gl.domElement, invalidate]);

  useEffect(() => { controlsRef.current?.sync(); }, [enabled, active, orbitOnly]);
  return null;
}
