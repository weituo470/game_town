import { useEffect, useRef } from 'react';

export const PARTICLE_TRANSITION_TIMING = Object.freeze({
  gather: 1000,
  reveal: 1400,
  total: 2400,
  reduced: 200,
});

const TAU = Math.PI * 2;
const PARTICLE_COUNT = 900;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const easeOut = value => 1 - (1 - clamp(value)) ** 3;
const rgba = (rgb, alpha) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(alpha)})`;

function colorChannels(color, fallback) {
  // Resolve CSS colors once, outside the draw loop. No image/font/network resource is used.
  const sample = document.createElement('canvas');
  sample.width = sample.height = 1;
  const context = sample.getContext('2d');
  if (!context) return fallback;
  context.fillStyle = rgba(fallback, 1);
  if (typeof color === 'string') context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const pixels = context.getImageData(0, 0, 1, 1).data;
  return [pixels[0], pixels[1], pixels[2]];
}

function starSprite(color) {
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 64;
  const context = sprite.getContext('2d');
  if (!context) return sprite;
  const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, 'rgba(237,255,255,0.95)');
  glow.addColorStop(0.11, rgba(color, 0.94));
  glow.addColorStop(0.28, rgba(color, 0.38));
  glow.addColorStop(0.64, rgba(color, 0.07));
  glow.addColorStop(1, rgba(color, 0));
  context.fillStyle = glow;
  context.fillRect(0, 0, 64, 64);
  return sprite;
}

function seededParticles(token) {
  let seed = 2166136261;
  for (const char of String(token)) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  return Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
    angle: random() * TAU,
    distance: 0.3 + random() * 0.68,
    core: 8 + random() ** 0.6 * 82,
    winding: (index % 7 === 0 ? -1 : 1) * (1.15 + random() * 2.4),
    flatten: 0.72 + random() * 0.34,
    size: 0.7 + random() ** 2 * 2.8,
    depth: 0.28 + random() * 0.72,
    twinkle: random() * TAU,
    lastX: NaN,
    lastY: NaN,
  }));
}

/**
 * Mount as the last child of .gpt-stage, after its R3F Canvas. This is a Canvas2D
 * veil, not another WebGL renderer. z-index:0 keeps later HUD siblings above it.
 * Its clock is intentionally independent of the park's play/pause clock.
 */
export default function ParticleTransition({ transition = null, reducedMotion = false, onCommit, onComplete }) {
  const canvasRef = useRef(null);
  const callbacks = useRef({ onCommit, onComplete });
  const histories = useRef(new Map());
  const input = useRef(transition);
  const token = transition?.token ?? null;
  input.current = transition;

  useEffect(() => { callbacks.current = { onCommit, onComplete }; }, [onCommit, onComplete]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    if (token === null) {
      canvas.style.opacity = '0';
      canvas.dataset.phase = 'idle';
      canvas.dataset.progress = '0';
      canvas.dataset.phaseProgress = '0';
      canvas.dataset.active = 'false';
      canvas.dataset.committed = 'false';
      canvas.removeAttribute('data-token');
      return undefined;
    }

    let state = histories.current.get(token);
    if (!state) {
      state = { committed: false, completed: false };
      histories.current.set(token, state);
      // Keep token history for this component's lifetime so even an old token cannot emit twice.
    }
    canvas.dataset.token = String(token);
    canvas.dataset.motion = reducedMotion ? 'reduced' : 'full';
    canvas.dataset.committed = String(state.committed);
    if (state.completed) {
      canvas.style.opacity = '0';
      canvas.dataset.phase = 'complete';
      canvas.dataset.progress = '1';
      canvas.dataset.phaseProgress = '1';
      canvas.dataset.active = 'false';
      return undefined;
    }

    const context = canvas.getContext('2d', { alpha: true });
    let disposed = false;
    if (!context) {
      // A missing 2D context must not leave the application stuck between schemes.
      queueMicrotask(() => {
        if (disposed) return;
        if (!state.committed) { state.committed = true; callbacks.current.onCommit?.(token); }
        if (!state.completed) { state.completed = true; callbacks.current.onComplete?.(token); }
      });
      return () => { disposed = true; };
    }

    const duration = reducedMotion ? PARTICLE_TRANSITION_TIMING.reduced : PARTICLE_TRANSITION_TIMING.total;
    const midpoint = reducedMotion ? duration / 2 : PARTICLE_TRANSITION_TIMING.gather;
    const colors = {
      from: colorChannels(input.current?.fromColor, [107, 236, 192]),
      to: colorChannels(input.current?.toColor, [120, 220, 255]),
    };
    // Reduced-motion mode creates neither particles nor sprites.
    const particles = reducedMotion ? [] : seededParticles(token);
    const sprites = reducedMotion ? [] : [starSprite(colors.from), starSprite(colors.to)];
    let elapsed = state.committed ? midpoint : 0;
    let lastTime = null;
    let raf = 0;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let finished = false;
    let observer;
    canvas.style.opacity = '1';
    canvas.dataset.active = 'true';
    canvas.dataset.paused = String(document.hidden);

    function draw(time) {
      const revealing = time >= midpoint;
      const phaseProgress = clamp(revealing ? (time - midpoint) / (duration - midpoint) : time / midpoint);
      const progress = clamp(time / duration);
      canvas.dataset.phase = revealing ? 'reveal' : 'gather';
      canvas.dataset.progress = progress.toFixed(4);
      canvas.dataset.phaseProgress = phaseProgress.toFixed(4);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, width, height);

      // The canvas becomes fully dark at commit: the architectural cut is genuinely hidden.
      const veil = revealing ? 1 - smooth(phaseProgress / 0.86) : smooth((phaseProgress - 0.08) / 0.92);
      context.fillStyle = `rgba(3,10,16,${veil})`;
      context.fillRect(0, 0, width, height);
      if (reducedMotion) return;

      const cx = width * 0.6, cy = height * 0.45;
      const diagonal = Math.hypot(width, height);
      const expansion = revealing ? easeOut(phaseProgress) : 0;
      const gathering = revealing ? 1 : smooth(phaseProgress);
      const intensity = revealing ? 1 - smooth(phaseProgress) : smooth(phaseProgress * 2);
      const blend = revealing ? smooth(Math.min(1, phaseProgress * 3.5)) : 0;
      const color = colors.from.map((channel, i) => Math.round(channel + (colors.to[i] - channel) * blend));
      const cloudRadius = Math.max(110, diagonal * (revealing ? 0.15 + expansion * 0.42 : 0.58 - gathering * 0.42));

      // A restrained colored nebula, never a full-screen white flash.
      const cloud = context.createRadialGradient(cx, cy, 0, cx, cy, cloudRadius);
      cloud.addColorStop(0, rgba(color, 0.11 * intensity));
      cloud.addColorStop(0.28, rgba(color, 0.065 * intensity));
      cloud.addColorStop(0.7, rgba(color, 0.018 * intensity));
      cloud.addColorStop(1, rgba(color, 0));
      context.fillStyle = cloud;
      context.fillRect(0, 0, width, height);

      context.globalCompositeOperation = 'screen';
      // Three fine elliptical caustics help the hundreds of dust points read as one spatial event.
      if (intensity > 0.01) {
        context.save();
        context.translate(cx, cy);
        context.rotate(-0.24 + gathering * 0.17 + expansion * 0.28);
        for (let i = 0; i < 3; i++) {
          const radius = Math.max(18, (cloudRadius * 0.55 + i * 22) * (1 + i * 0.1));
          context.beginPath();
          context.ellipse(0, 0, radius, radius * (0.37 + i * 0.08), i * 0.18, 0.2 + i, 4.6 + i);
          context.strokeStyle = rgba(color, intensity * (0.12 - i * 0.025));
          context.lineWidth = 0.8;
          context.stroke();
        }
        context.restore();
      }

      const trailColor = rgba(color, 0.3 * intensity);
      context.strokeStyle = trailColor;
      context.lineWidth = 0.7;
      // One batched path for short motion trails; glow comes from cached sprites, not 900 gradients.
      context.beginPath();
      particles.forEach((particle, index) => {
        const outer = diagonal * particle.distance;
        const core = particle.core * Math.min(1, Math.max(0.62, width / 1100));
        const radius = revealing ? core + expansion * outer * 1.16 : outer * (1 - gathering) + core * gathering;
        const angle = particle.angle + particle.winding * gathering + (revealing ? expansion * particle.winding * 0.38 : 0);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * particle.flatten;
        const flicker = 0.72 + Math.sin(time * 0.004 + particle.twinkle) * 0.22;
        const alpha = intensity * particle.depth * flicker;
        if (index % 4 === 0 && Number.isFinite(particle.lastX)) {
          const dx = x - particle.lastX, dy = y - particle.lastY;
          // Cap streak length after a slow foreground frame or a resize.
          const cap = Math.min(1, 22 / (Math.hypot(dx, dy) || 1));
          context.moveTo(x - dx * cap, y - dy * cap);
          context.lineTo(x, y);
        }
        particle.lastX = x;
        particle.lastY = y;
        const size = particle.size * (4.0 + gathering * 1.5) * (1 - expansion * 0.32);
        if (x < -size || y < -size || x > width + size || y > height + size || alpha < 0.01) return;
        // At the cut the old color recedes into the new palette rather than flashing white.
        context.globalAlpha = alpha * (1 - blend);
        if (context.globalAlpha > 0.01) context.drawImage(sprites[0], x - size / 2, y - size / 2, size, size);
        context.globalAlpha = alpha * blend;
        if (context.globalAlpha > 0.01) context.drawImage(sprites[1], x - size / 2, y - size / 2, size, size);
      });
      context.globalAlpha = 1;
      context.stroke();
      context.globalCompositeOperation = 'source-over';
    }

    function resize() {
      if (disposed || finished) return;
      const rect = canvas.parentElement?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.dataset.dpr = String(dpr);
      particles.forEach(particle => { particle.lastX = NaN; particle.lastY = NaN; });
      draw(elapsed);
    }

    function detachListeners() {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibilityChanged);
    }

    function finish() {
      finished = true;
      canvas.style.opacity = '0';
      canvas.dataset.phase = 'complete';
      canvas.dataset.progress = '1';
      canvas.dataset.phaseProgress = '1';
      canvas.dataset.active = 'false';
      context.clearRect(0, 0, width, height);
      detachListeners();
      if (!state.completed) {
        state.completed = true;
        callbacks.current.onComplete?.(token);
      }
    }

    function frame(timestamp) {
      raf = 0;
      if (disposed || finished) return;
      if (document.hidden) { lastTime = null; return; }
      if (lastTime !== null) elapsed += Math.max(0, timestamp - lastTime);
      lastTime = timestamp;
      draw(Math.min(duration, elapsed));
      if (elapsed >= midpoint && !state.committed) {
        state.committed = true;
        canvas.dataset.committed = 'true';
        callbacks.current.onCommit?.(token);
      }
      if (disposed) return;
      if (elapsed >= duration) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }

    function visibilityChanged() {
      canvas.dataset.paused = String(document.hidden);
      // Hidden time never enters elapsed; no fast-forward or sudden reveal on return.
      lastTime = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (!document.hidden && !disposed && !finished) raf = requestAnimationFrame(frame);
    }

    resize();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resize);
      observer.observe(canvas.parentElement ?? canvas);
    }
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibilityChanged);
    if (!document.hidden) raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      detachListeners();
      context.clearRect(0, 0, width, height);
      canvas.style.opacity = '0';
      sprites.forEach(sprite => { sprite.width = sprite.height = 1; });
    };
  }, [token, reducedMotion]);

  return <canvas
    ref={canvasRef}
    className="gpt-particle-transition"
    aria-hidden="true"
    hidden={token === null}
    data-phase="idle"
    data-progress="0"
    data-phase-progress="0"
    data-active="false"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
  />;
}
