/**
 * Procedural WebAudio soundscape (no audio files): surf/harbour ambience, engine rumble tied
 * to throttle, gun reports with distance delay, shell splashes. Starts on the first user gesture.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    const start = () => { this.init(); window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', start); };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = 0.7; this.master.connect(c.destination);
    // shared noise buffer
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; } // brown-ish noise
    // ambience: low surf swell
    const amb = this.loop(); const af = c.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 520;
    this.ambGain = c.createGain(); this.ambGain.gain.value = 0.22;
    amb.connect(af).connect(this.ambGain).connect(this.master);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.11; const lg = c.createGain(); lg.gain.value = 0.09;
    lfo.connect(lg).connect(this.ambGain.gain); lfo.start();
    // engine
    const eng = this.loop(); const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 140;
    this.engGain = c.createGain(); this.engGain.gain.value = 0;
    eng.connect(ef).connect(this.engGain).connect(this.master);
    this.engFilter = ef;
  }

  loop() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true; s.start(0, Math.random() * 1.5);
    return s;
  }

  burst({ delay = 0, dur = 1.5, freq = 300, gain = 1, thump = 0 }) {
    const c = this.ctx;
    if (!c || !this.enabled) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq * 4, t); f.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.5);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.1);
    if (thump) {
      const o = c.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
      const og = c.createGain(); og.gain.setValueAtTime(thump, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(og).connect(this.master); o.start(t); o.stop(t + 1);
    }
  }

  gun(distance, cal) {
    const k = Math.min(1, 300 / Math.max(50, distance));
    this.burst({ delay: distance / 343, dur: 1.6 + cal * 2, freq: 180, gain: 0.9 * k, thump: 0.8 * k * (cal / 0.4) });
  }

  splash(distance, cal) {
    const k = Math.min(1, 400 / Math.max(80, distance));
    this.burst({ delay: distance / 343, dur: 2.4, freq: 900, gain: 0.35 * k * (0.5 + cal) });
  }

  update(throttle, speedFrac, mode) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const target = mode === 'trials' ? 0.05 + Math.abs(throttle) * 0.22 : 0.02;
    this.engGain.gain.setTargetAtTime(this.enabled ? target : 0, t, 0.8);
    this.engFilter.frequency.setTargetAtTime(110 + speedFrac * 160, t, 1);
    this.ambGain.gain.setTargetAtTime(this.enabled ? 0.2 : 0, t, 0.5);
  }
}
