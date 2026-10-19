// Read WebGL pixels only while the compositor's drawing buffer is still valid.
// No global renderer, polling, preserved drawing buffer, or permanent listener.
const subscribers = new WeakMap();

export function subscribeDroneVideoFrame(canvas, callback) {
  if (!canvas || typeof callback !== 'function') throw new TypeError('A canvas and frame callback are required.');
  let listeners = subscribers.get(canvas);
  if (!listeners) { listeners = new Set(); subscribers.set(canvas, listeners); }
  listeners.add(callback);
  return () => { listeners.delete(callback); if (!listeners.size) subscribers.delete(canvas); };
}

export function notifyDroneVideoFrame(canvas) {
  const listeners = subscribers.get(canvas);
  if (!listeners) return;
  for (const callback of [...listeners]) callback();
}
