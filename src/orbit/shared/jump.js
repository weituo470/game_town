// Shared, deterministic vertical motion. Clients send a jump intent, never height.
export const JUMP_SPEED = 7.2;
export const JUMP_GRAVITY = 16.2;
export const JUMP_MAX_HEIGHT = JUMP_SPEED * JUMP_SPEED / (2 * JUMP_GRAVITY);
export const JUMP_DURATION = 2 * JUMP_SPEED / JUMP_GRAVITY;

export function grounded(state) {
  return !(Number.isFinite(state?.y) && state.y > 0.0001)
    && !(Number.isFinite(state?.vy) && state.vy > 0);
}

export function startJump(state) {
  return grounded(state) ? { y: 0, vy: JUMP_SPEED } : null;
}

export function stepJump(state, deltaSeconds) {
  const y = Math.max(0, Number.isFinite(state?.y) ? state.y : 0);
  const vy = Number.isFinite(state?.vy) ? state.vy : 0;
  const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(0.1, deltaSeconds)) : 0;
  if (y === 0 && vy <= 0) return { y: 0, vy: 0 };
  if (dt === 0) return { y, vy };
  const nextY = y + vy * dt - JUMP_GRAVITY * dt * dt / 2;
  if (nextY <= 0 || (nextY <= 0.0001 && vy - JUMP_GRAVITY * dt <= 0)) return { y: 0, vy: 0 };
  return { y: nextY, vy: vy - JUMP_GRAVITY * dt };
}
