import { COUNT_IN_MS, NOTES, ROUND_MS } from './logic.js';

// A small original bell-and-bass arrangement, all synthesized locally.
export class TownAudio {
  constructor(Context) {
    this.context = new Context();
    this.master = this.context.createGain(); this.master.gain.value = 0.65;
    this.master.connect(this.context.destination);
    this.nodes = new Set(); this.cursor = -1; this.closed = false;
    this.events = [];
    for (let at = 0; at < ROUND_MS; at += 500) {
      this.events.push({ at, frequency: at < COUNT_IN_MS ? 880 : 120, type: 'sine', volume: at < COUNT_IN_MS ? 0.065 : 0.05, duration: 0.08 });
      if (at >= COUNT_IN_MS && (at - COUNT_IN_MS) % 2000 === 0) this.events.push({ at, frequency: 130.81, type: 'triangle', volume: 0.055, duration: 0.35 });
    }
    for (const n of NOTES) this.events.push({ at: n.at, frequency: [261.63, 329.63, 392, 523.25][n.lane], type: 'sine', volume: 0.1, duration: 0.23 });
    this.events.sort((a, b) => a.at - b.at);
  }
  resume() { return this.context.resume(); }
  mute(muted) { if (!this.closed) this.master.gain.setValueAtTime(muted ? 0 : 0.65, this.context.currentTime); }
  schedule(now) {
    if (this.closed || this.context.state !== 'running') return;
    const until = Math.min(ROUND_MS, now + 140);
    for (const event of this.events) {
      if (event.at <= this.cursor || event.at > until || event.at < now - 20) continue;
      const at = this.context.currentTime + Math.max(0, event.at - now) / 1000;
      const oscillator = this.context.createOscillator(), gain = this.context.createGain();
      const node = { oscillator, gain }; this.nodes.add(node);
      oscillator.type = event.type; oscillator.frequency.value = event.frequency;
      gain.gain.setValueAtTime(0.001, at); gain.gain.linearRampToValueAtTime(event.volume, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, at + event.duration);
      oscillator.connect(gain); gain.connect(this.master); oscillator.start(at); oscillator.stop(at + event.duration + 0.02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.nodes.delete(node); };
    }
    this.cursor = until;
  }
  pause(now) {
    for (const { oscillator, gain } of this.nodes) { oscillator.onended = null; try { oscillator.stop(); } catch { /* already ended */ } oscillator.disconnect(); gain.disconnect(); }
    this.nodes.clear(); this.cursor = now;
  }
  close() {
    if (this.closed) return;
    this.pause(0); this.closed = true; this.master.disconnect(); this.context.onstatechange = null;
    this.context.close().catch(() => {});
  }
}
