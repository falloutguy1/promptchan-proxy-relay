// Procedural WebAudio: four radial engines, wind, .50 cal bursts, flak, bomb blasts.
import { settings } from './settings.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this._lastGun = 0;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
    } catch (e) { return; }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = settings.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 3; }
    // engines: each a pulse-ish oscillator pair at firing frequency, lowpassed
    this.eng = [];
    const eLP = ctx.createBiquadFilter(); eLP.type = 'lowpass'; eLP.frequency.value = 420; eLP.Q.value = 0.7;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0.0;
    eLP.connect(this.engGain).connect(this.master);
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'square';
      const g = ctx.createGain(); g.gain.value = 0.16;
      o.connect(g); o2.connect(g); g.connect(eLP);
      o.start(); o2.start();
      this.eng.push({ o, o2, g, det: 1 + (i - 1.5) * 0.013 });
    }
    // rumble noise
    const rn = ctx.createBufferSource(); rn.buffer = this.noise; rn.loop = true;
    const rLP = ctx.createBiquadFilter(); rLP.type = 'lowpass'; rLP.frequency.value = 160;
    this.rumble = ctx.createGain(); this.rumble.gain.value = 0;
    rn.connect(rLP).connect(this.rumble).connect(this.master); rn.start();
    // wind
    const wn = ctx.createBufferSource(); wn.buffer = this.noise; wn.loop = true; wn.playbackRate.value = 0.7;
    const wBP = ctx.createBiquadFilter(); wBP.type = 'bandpass'; wBP.frequency.value = 900; wBP.Q.value = 0.4;
    this.wind = ctx.createGain(); this.wind.gain.value = 0;
    wn.connect(wBP).connect(this.wind).connect(this.master); wn.start();
    this.ready = true;
  }

  setVolume(v) { if (this.master) this.master.gain.value = v; }

  update(bomber, inside) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const fl = bomber.fl;
    fl.engines.forEach((e, i) => {
      const en = this.eng[i];
      const rpm = 900 + e.rpm * 1400;
      const f = rpm / 60 * 4.5 * en.det;     // 9-cyl 4-stroke firing frequency
      en.o.frequency.setTargetAtTime(f, t, 0.1);
      en.o2.frequency.setTargetAtTime(f * 0.5, t, 0.1);
      en.g.gain.setTargetAtTime(e.running && e.hp > 0 ? 0.16 : 0.0, t, 0.3);
    });
    this.engGain.gain.setTargetAtTime(inside ? 0.33 : 0.22, t, 0.2);
    this.rumble.gain.setTargetAtTime(0.25 + fl.throttle * 0.2, t, 0.3);
    this.wind.gain.setTargetAtTime(Math.min(0.25, fl.ias / 500), t, 0.3);
  }

  _burst({ dur = 0.3, freq = 800, q = 0.8, gain = 0.5, delay = 0, type = 'lowpass', decay = 4 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.6 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  gun() {
    const now = performance.now();
    if (now - this._lastGun < 70) return;
    this._lastGun = now;
    this._burst({ dur: 0.09, freq: 2200, q: 0.5, gain: 0.35, type: 'bandpass' });
    this._burst({ dur: 0.12, freq: 300, gain: 0.3 });
  }
  enemyGun(d) { this._burst({ dur: 0.08, freq: 1500, gain: Math.min(0.25, 120 / d), type: 'bandpass', delay: d / 343 * 0.3 }); }
  flak(d) {
    const g = Math.min(1.2, 180 / Math.max(20, d));
    if (g < 0.03) return;
    this._burst({ dur: 0.7 + Math.min(1, d / 400), freq: d < 80 ? 1200 : 380, gain: g, delay: Math.min(1.5, d / 343) });
    if (d < 60) this._burst({ dur: 0.25, freq: 4000, gain: 0.3, type: 'highpass' });   // shrapnel rattle
  }
  explosion(d) {
    const g = Math.min(1.2, 900 / Math.max(50, d));
    this._burst({ dur: 2.2, freq: 140, gain: g, delay: Math.min(8, d / 343), q: 0.5 });
  }
  bombRelease() { this._burst({ dur: 0.18, freq: 500, gain: 0.35 }); }
  hit() { this._burst({ dur: 0.1, freq: 3000, gain: 0.25, type: 'bandpass' }); }
}
