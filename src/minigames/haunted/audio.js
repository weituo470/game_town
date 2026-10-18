// Quiet, original synthesized sounds only. No downloads, sudden peaks or noise.
export function createHouseAudio() {
  let context = null, loop = null;
  const voices = new Set();
  const tone = (frequency, duration = .16, volume = .018) => {
    if (context?.state !== 'running') return;
    const oscillator = context.createOscillator(), gain = context.createGain(), t = context.currentTime;
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(volume, t + .04);
    gain.gain.exponentialRampToValueAtTime(.0001, t + duration);
    oscillator.connect(gain); gain.connect(context.destination); voices.add(oscillator);
    oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(); oscillator.stop(t + duration + .02);
  };
  return {
    async enable() {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return false;
      try { if (!context || context.state === 'closed') context = new Audio(); await context.resume(); return context.state === 'running'; } catch { return false; }
    },
    play() { if (!context || loop) return; context.resume().catch(() => {}); loop = setInterval(() => { tone(164.81, 2.4, .009); tone(246.94, 2.7, .006); }, 4500); },
    pause() { clearInterval(loop); loop = null; for (const voice of voices) { try { voice.stop(); } catch { /* already ended */ } } context?.suspend().catch(() => {}); },
    step() { tone(110, .12, .012); },
    discover() { tone(523.25, .7, .024); tone(659.25, .9, .014); },
    close() { clearInterval(loop); loop = null; context?.close().catch(() => {}); context = null; voices.clear(); },
  };
}
