// Original synthesised soundscape; no recordings, network requests, or TTS.
// The AudioContext is created only by an explicit user click on the HUD.
import { DRONE_STUNT } from '../../shared/droneShow.js';
import { DROPLET_SCORE, DROPLET_SHIPS } from '../../shared/droneDroplet.js';
import { CARRIER_BATTLE_SCORE } from '../../shared/carrierBattle.js';

// Accent real delayed explosions, never the instant of penetration. A sparse
// score (at most one accent per 900ms of show time) avoids 216 overlapping
// voices. These are authored sounds, not a claim that sound travels in space.
export const DROPLET_EXPLOSION_TIMES = Object.freeze(DROPLET_SHIPS
  .map(ship => ship.explodeTime * 1000).sort((a, b) => a - b)
  .reduce((times, time) => {
    if (time < DROPLET_SCORE.silenceStart && (!times.length || time - times.at(-1) >= 900)) times.push(time);
    return times;
  }, []));

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

/** Absolute-time cues stay aligned when seeking, pausing, or running at 2x. */
export function sampleDroneAudioCue(elapsedMs, reducedMotion = false) {
  const time = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const cue = { id: 'ambient', level: 1, hum: 1, wind: 1, pitch: 1, impact: false };
  if (reducedMotion) return cue;
  if (time >= DRONE_STUNT.gatherStart && time < DRONE_STUNT.fallStart) {
    const t = smooth((time - DRONE_STUNT.gatherStart) / (DRONE_STUNT.fallStart - DRONE_STUNT.gatherStart));
    return { id: 'convergence', level: 1 - t * 0.75, hum: 1 - t * 0.6, wind: 1 - t, pitch: 1 - t * 0.45, impact: false };
  }
  if (time >= DRONE_STUNT.fallStart && time < DRONE_STUNT.brakeStart) {
    // Four staggered losses of motor sound, not silence while three groups
    // are still hovering. One shared absolute clock drives light and sound.
    const powered = DRONE_STUNT.batchStarts.reduce((sum, start) =>
      sum + 1 - smooth((time - start) / 140), 0) / DRONE_STUNT.batchCount;
    const air = smooth((time - DRONE_STUNT.fallStart - 600) / 2400);
    return { id: 'freefall', level: 0.25 * powered + air * 0.3, hum: 0.4 * powered,
      wind: air * 0.6, pitch: 0.55, impact: false };
  }
  if (time >= DRONE_STUNT.brakeStart && time < DRONE_STUNT.wingEnd) {
    const t = smooth((time - DRONE_STUNT.brakeStart) / (DRONE_STUNT.wingEnd - DRONE_STUNT.brakeStart));
    // Reignition happens when thrust returns, one second BEFORE descent stops.
    // Keep a single cue across braking/unfolding so there is no second impact.
    return { id: 'phoenix', level: 1, hum: 1.1, wind: 0.5 + t * 0.8, pitch: 0.7 + t * 0.3, impact: time < DRONE_STUNT.brakeStart + 1200 };
  }
  if (time >= DRONE_STUNT.wingEnd && time < DRONE_STUNT.reformEnd) return { ...cue, id: 'rebirth', wind: 1.2 };
  if (time >= DRONE_STUNT.reformEnd && time < DRONE_STUNT.end) return { ...cue, id: 'apotheosis', hum: 1.15 };
  return cue;
}

/** The story's silence is deliberate: no victory chord or revival after 104s. */
export function sampleDropletAudioCue(elapsedMs, reducedMotion = false) {
  const time = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const silent = { id: 'droplet-silence', level: 0, hum: 0, wind: 0, pitch: 0.55, impact: false, pulse: -1 };
  if (time >= DROPLET_SCORE.silenceStart || (time >= DROPLET_SCORE.warningStart && time < DROPLET_SCORE.strikeStart)) return silent;
  if (time >= DROPLET_SCORE.attackEnd && time < DROPLET_SCORE.collapseStart) return silent;
  if (time >= DROPLET_SCORE.strikeStart) {
    // The pulses are an original rhythmic score, not a physical sound-in-space
    // claim. No pulse is emitted twice for a repeated frame or a paused seek.
    const collapse = time >= DROPLET_SCORE.collapseStart;
    const pulse = DROPLET_EXPLOSION_TIMES.findIndex(explodeTime => time >= explodeTime && time < explodeTime + 650);
    return { id: collapse ? 'droplet-collapse' : 'droplet-strike', level: reducedMotion ? 0.35 : 0.65,
      hum: 0.38, wind: 0.1, pitch: 0.58, impact: !reducedMotion && pulse >= 0, pulse };
  }
  if (time >= 44000) {
    const fade = smooth((time - 44000) / 14000);
    return { id: 'droplet-beauty', level: 0.55 - fade * 0.45, hum: 0.45, wind: 0, pitch: 1.25, impact: false, pulse: -1 };
  }
  return { id: 'droplet-order', level: 0.65, hum: 0.7, wind: 0.15, pitch: 0.9, impact: false, pulse: -1 };
}

/** Restrained fictional score, not a recording or physical weapon simulation. */
export function sampleCarrierBattleAudioCue(elapsedMs, reducedMotion = false) {
  const t = Number.isFinite(elapsedMs) ? elapsedMs : 0, score = CARRIER_BATTLE_SCORE;
  const base = { id: 'carrier-watch', level: 0.35, hum: 0.45, wind: 0.2, pitch: 0.75, impact: false, pulse: -1 };
  if (t >= score.end) return { ...base, level: 0 };
  if (reducedMotion) return base;
  if (t >= score.duelStart && t < score.returnStart) {
    const beat = (t - score.duelStart) / 1800;
    return { ...base, id: 'carrier-duel', level: 0.75, hum: 0.6, wind: 0.8, pulse: 100 + Math.floor(beat), impact: beat % 1 < 0.16 };
  }
  if (t >= score.returnStart) return { ...base, id: 'carrier-return', level: 0.45 * (1 - smooth((t - score.returnStart) / (score.end - score.returnStart))) };
  if (t >= score.liftStart) return { ...base, id: 'carrier-lift', level: 0.8, hum: 1.1, wind: 0.7, pitch: 0.7 + 0.3 * smooth((t - score.liftStart) / 20000) };
  if (t >= score.transformStart) return { ...base, id: 'carrier-transform', level: 0.65, hum: 0.9, pitch: 0.6 };
  if (t >= score.interceptStart) {
    const beat = (t - score.interceptStart) / 2300;
    return { ...base, id: 'carrier-intercept', level: 0.65, wind: 0.5, pulse: Math.floor(beat), impact: beat % 1 < 0.15 };
  }
  return base;
}

export function createDroneShowAudio({ AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
  if (!AudioContextClass) throw new Error('当前浏览器暂不支持演出音效。');
  const context = new AudioContextClass();
  const voices = new Set();
  const continuous = [];
  let disposed = false;
  let lastChapter = -1;
  let lastCue = '';
  let lastElapsed = 0;
  let lastProgram = 'avatar';
  let lastPulse = -1;
  const harmonicOscillators = [];
  const master = context.createGain();
  master.gain.value = 0;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -18;
  limiter.knee.value = 12;
  limiter.ratio.value = 5;
  master.connect(limiter).connect(context.destination);

  const hum = context.createGain();
  hum.gain.value = 0;
  hum.connect(master);
  [55, 82.4069, 110, 164.8138].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = index === 0 ? 'sine' : 'triangle';
    oscillator.frequency.value = frequency;
    gain.gain.value = [0.4, 0.13, 0.1, 0.035][index];
    oscillator.connect(gain).connect(hum);
    oscillator.start();
    continuous.push(oscillator);
    harmonicOscillators.push({ oscillator, frequency });
  });

  const wind = context.createBufferSource();
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const values = buffer.getChannelData(0);
  let seed = 1729;
  for (let index = 0; index < values.length; index += 1) {
    seed = (seed * 16807) % 2147483647;
    values[index] = (seed / 2147483647 * 2 - 1) * 0.3;
  }
  wind.buffer = buffer;
  wind.loop = true;
  const windFilter = context.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 340;
  const windGain = context.createGain();
  windGain.gain.value = 0;
  wind.connect(windFilter).connect(windGain).connect(master);
  wind.start();
  continuous.push(wind);

  function bell(frequency) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
    oscillator.connect(gain).connect(master);
    voices.add(oscillator);
    oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(now);
    oscillator.stop(now + 2.5);
  }

  function ignition() {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(76, now);
    oscillator.frequency.exponentialRampToValueAtTime(32, now + 1.45);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.42, now + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    oscillator.connect(gain).connect(master);
    voices.add(oscillator);
    oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(now);
    oscillator.stop(now + 1.9);
    bell(440);
    bell(659.2551);
  }

  function impact() {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(92, now);
    oscillator.frequency.exponentialRampToValueAtTime(34, now + 0.3);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.26, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    oscillator.connect(gain).connect(master);
    voices.add(oscillator);
    oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(now); oscillator.stop(now + 0.6);
  }

  return {
    async start() {
      if (disposed) return false;
      await context.resume();
      return !disposed && context.state === 'running';
    },
    update({ elapsedMs = 0, active = true, paused = false, chapter = 0, energy = 0.5, reducedMotion = false, program = 'avatar' } = {}) {
      if (disposed) return;
      const now = context.currentTime;
      const audible = active && !paused && elapsedMs < 150000;
      const progress = Math.max(0, Math.min(1, elapsedMs / 150000));
      const attack = Math.min(1, elapsedMs / 6500);
      const release = Math.min(1, (150000 - elapsedMs) / 11000);
      const envelope = Math.max(0, attack * release);
      const isDroplet = program === 'droplet';
      const isBattle = program === 'carrier-battle';
      const programmeChanged = program !== lastProgram;
      const cue = isBattle ? sampleCarrierBattleAudioCue(elapsedMs, reducedMotion) : isDroplet ? sampleDropletAudioCue(elapsedMs, reducedMotion) : sampleDroneAudioCue(elapsedMs, reducedMotion);
      master.gain.setTargetAtTime(audible ? 0.18 * envelope * cue.level : 0, now, cue.level === 0 ? 0.045 : audible ? 0.18 : 0.12);
      hum.gain.setTargetAtTime((0.13 + Math.max(0, Math.min(1, energy)) * 0.38) * cue.hum, now, 0.3);
      for (const { oscillator, frequency } of harmonicOscillators) oscillator.frequency.setTargetAtTime(frequency * cue.pitch, now, 0.35);
      windGain.gain.setTargetAtTime((0.08 + Math.sin(progress * Math.PI) * 0.16) * cue.wind, now, 0.3);
      windFilter.frequency.setTargetAtTime(220 + Math.sin(progress * Math.PI) * 750, now, 1.5);
      if (!audible || cue.level === 0 || programmeChanged || Math.abs(elapsedMs - lastElapsed) > 1800) {
        // Seeking never leaves an old bell sounding over the new chapter.
        for (const voice of voices) { try { voice.stop(now + 0.08); } catch { /* Already ended. */ } }
      }
      if (isDroplet || isBattle) {
        if (audible && cue.level > 0 && cue.impact && (cue.pulse !== lastPulse || programmeChanged)) impact();
        if (audible) lastPulse = cue.pulse;
      } else {
        if (audible && cue.id !== lastCue && cue.impact) ignition();
        else if (audible && cue.id === 'apotheosis' && cue.id !== lastCue) bell(880);
        else if (audible && chapter !== lastChapter && cue.id !== 'freefall') bell([220, 293.6648, 329.6276, 440, 659.2551, 440, 293.6648, 220][Math.abs(chapter) % 8]);
      }
      lastChapter = chapter;
      if (audible) lastCue = cue.id;
      lastElapsed = elapsedMs;
      lastProgram = program;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(0, context.currentTime);
      for (const voice of [...continuous, ...voices]) { try { voice.stop(); } catch { /* Already ended. */ } }
      voices.clear();
      void context.close().catch(() => {});
    },
  };
}
