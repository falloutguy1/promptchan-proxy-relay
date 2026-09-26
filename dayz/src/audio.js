// Procedural audio (no sample assets): surface-dependent footsteps and a wind bed.
export class Audio {
  constructor() { this.ctx = null; }

  start() {
    if (this.ctx) return;
    try { this.ctx = new AudioContext(); } catch { return; }
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    // wind bed: band-passed noise with slow gusting
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.03; lfo.connect(lg).connect(g.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
    const lg2 = ctx.createGain(); lg2.gain.value = 180; lfo2.connect(lg2).connect(bp.frequency);
    src.connect(bp).connect(g).connect(this.master);
    src.start(); lfo.start(); lfo2.start();
  }

  step(surface = 'grass', strength = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const P = {
      grass: { f: 1800, q: 0.7, dur: 0.16, gain: 0.22, type: 'highpass' },
      forest: { f: 1400, q: 0.8, dur: 0.2, gain: 0.26, type: 'bandpass' },
      gravel: { f: 2600, q: 0.9, dur: 0.14, gain: 0.35, type: 'bandpass' },
      mud: { f: 500, q: 1.2, dur: 0.18, gain: 0.3, type: 'lowpass' },
      wood: { f: 260, q: 2.5, dur: 0.12, gain: 0.55, type: 'bandpass' },
      concrete: { f: 1200, q: 1.5, dur: 0.08, gain: 0.35, type: 'bandpass' },
    }[surface] || { f: 1500, q: 0.8, dur: 0.15, gain: 0.25, type: 'bandpass' };
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = P.type; f.frequency.value = P.f * (0.85 + Math.random() * 0.3); f.Q.value = P.q;
    const g = ctx.createGain();
    const peak = P.gain * strength * (0.8 + Math.random() * 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + P.dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, P.dur + 0.05);
  }
}
