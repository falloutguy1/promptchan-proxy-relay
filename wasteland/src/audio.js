// Synthesised sound (WebAudio, no audio files): wind and rain beds that follow
// the weather and camera height, crickets at night, birds by day, campfire
// crackle near fires, and positional one-shots (gunshots, groans, falling
// trees, deaths) attenuated and panned relative to the camera. Starts on the
// first user gesture, as browsers require.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _r = new THREE.Vector3();

export class Audio {
  constructor(game) {
    this.game = game;
    this.volume = game.settings.volume ?? 0.7;
    this.ctx = null;
    const start = () => { this.#init(); window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', start); };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    this.t = 0;
  }

  #init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.connect(this.master);
    // shared noise buffer
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2) * 0.9 + w * 0.05; }
    this.noise = buf;
    const white = ctx.createBuffer(1, len, ctx.sampleRate), wd = white.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    this.white = white;
    this.wind = this.#loop(this.noise, 'lowpass', 520, 0);
    this.rain = this.#loop(this.white, 'highpass', 1600, 0);
    this.fire = this.#loop(this.white, 'bandpass', 2400, 0);
  }

  #loop(buffer, type, freq, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(this.comp);
    src.start();
    return { src, f, g };
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  /** Distance attenuation + stereo pan for a world position. */
  #place(pos, ref = 18) {
    const cam = this.game.camera;
    _v.set(pos.x, pos.y ?? cam.position.y, pos.z).sub(cam.position);
    const d = _v.length();
    _r.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const pan = d > 0.01 ? Math.max(-0.9, Math.min(0.9, _v.dot(_r) / d)) : 0;
    const gain = 1 / (1 + (d / ref) ** 2);
    return { gain, pan, d };
  }
  #out(gain, pan, lowpass = 20000) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gain;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass;
    if (p) { p.pan.value = pan; g.connect(p).connect(f).connect(this.comp); } else g.connect(f).connect(this.comp);
    return g;
  }
  #noiseBurst(dest, dur, type, freq, q = 1, attack = 0.002, buffer = this.white) {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = buffer;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return { f, g };
  }

  play(kind, pos) {
    if (!this.ctx || this.ctx.state !== 'running') { this.ctx?.resume?.(); if (!this.ctx) return; }
    const ctx = this.ctx, t = ctx.currentTime;
    if (kind === 'shot') {
      const { gain, pan, d } = this.#place(pos, 60);
      if (gain < 0.01) return;
      const out = this.#out(Math.min(1, gain * 1.4), pan, 18000 / (1 + d / 60));
      this.#noiseBurst(out, 0.35 + Math.min(0.8, d / 200), 'lowpass', 3200, 0.7, 0.001);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.3);
      // tail echo off the valley
      setTimeout(() => { if (this.ctx) this.#noiseBurst(this.#out(gain * 0.25, -pan, 1200), 0.9, 'lowpass', 900, 0.5, 0.02); }, 180 + d * 2);
    } else if (kind === 'groan') {
      const { gain, pan } = this.#place(pos, 9);
      if (gain < 0.02) return;
      const out = this.#out(gain * 0.5, pan, 2600);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const f0 = 70 + Math.random() * 40;
      o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 0.8, t + 0.9);
      const vib = ctx.createOscillator(); vib.frequency.value = 5 + Math.random() * 3; const vg = ctx.createGain(); vg.gain.value = 6; vib.connect(vg).connect(o.frequency);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420 + Math.random() * 200; f.Q.value = 3;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.7, t + 0.15); g.gain.linearRampToValueAtTime(0, t + 1.0);
      o.connect(f).connect(g).connect(out); o.start(t); vib.start(t); o.stop(t + 1.1); vib.stop(t + 1.1);
    } else if (kind === 'treefall') {
      const { gain, pan } = this.#place(pos, 40);
      if (gain < 0.02) return;
      const out = this.#out(gain, pan, 5000);
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(60, t + 1.6);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 8;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.5); g.gain.linearRampToValueAtTime(0, t + 1.8);
      o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 2);
      setTimeout(() => { if (!this.ctx) return; const o2 = this.#out(gain, pan, 900); this.#noiseBurst(o2, 1.2, 'lowpass', 300, 0.7, 0.005, this.noise); }, 2300);
    } else if (kind === 'zdeath') {
      const { gain, pan } = this.#place(pos, 12);
      if (gain < 0.02) return;
      this.#noiseBurst(this.#out(gain * 0.8, pan, 700), 0.4, 'lowpass', 250, 0.8, 0.005, this.noise);
    } else if (kind === 'chop') {
      const { gain, pan } = this.#place(pos, 25);
      if (gain < 0.02) return;
      this.#noiseBurst(this.#out(gain * 0.7, pan, 6000), 0.12, 'bandpass', 1400, 2, 0.001);
    }
  }

  ui(kind) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const tone = (f, dt, dur, vol = 0.12, type = 'sine') => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t + dt); g.gain.linearRampToValueAtTime(vol, t + dt + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dt + dur);
      o.connect(g).connect(this.comp); o.start(t + dt); o.stop(t + dt + dur + 0.02);
    };
    if (kind === 'danger') { tone(330, 0, 0.25, 0.12, 'triangle'); tone(247, 0.18, 0.35, 0.12, 'triangle'); }
    else if (kind === 'good') { tone(523, 0, 0.18); tone(784, 0.1, 0.25); }
    else if (kind === 'place') tone(392, 0, 0.12, 0.1, 'triangle');
    else if (kind === 'order') tone(660, 0, 0.07, 0.06);
    else if (kind === 'warn') tone(440, 0, 0.18, 0.08, 'triangle');
  }

  /** Ambience beds follow weather, time and the camera. */
  update(dt) {
    if (!this.ctx) return;
    const g = this.game, sky = g.world.sky, sim = g.sim, ctx = this.ctx, now = ctx.currentTime;
    const height = Math.max(0, g.camera.position.y - g.world.terrain.height(g.camera.position.x, g.camera.position.z));
    const windAmt = 0.05 + 0.1 * Math.min(1, height / 120) + 0.08 * sky.cloudiness + 0.12 * sky.rain;
    this.wind.g.gain.setTargetAtTime(windAmt * (0.75 + 0.25 * Math.sin(now * 0.23)), now, 0.4);
    this.wind.f.frequency.setTargetAtTime(380 + 260 * Math.sin(now * 0.11) ** 2, now, 0.6);
    this.rain.g.gain.setTargetAtTime(0.09 * sky.rain, now, 0.5);
    // campfire crackle near the camera
    let fireGain = 0;
    for (const s of sim.structures?.list || []) {
      if (s.type !== 'campfire' || !s.built || s.extra.out) continue;
      const { gain } = this.#place(s, 8);
      fireGain = Math.max(fireGain, gain);
    }
    this.fire.g.gain.setTargetAtTime(fireGain * 0.05 * (Math.random() < 0.3 ? 2.5 : 1), now, 0.03);
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.4 + Math.random() * 1.6;
      const night = sky.isNight || (sim.started && sim.night);
      const near = height < 40;
      if (near && night && sky.rain < 0.2 && Math.random() < 0.6) this.#cricket();
      if (near && !night && sky.rain < 0.3 && Math.random() < 0.18) this.#bird();
    }
  }
  #cricket() {
    const ctx = this.ctx, t = ctx.currentTime;
    const f = 4200 + Math.random() * 900, pan = Math.random() * 1.6 - 0.8, out = this.#out(0.018 + Math.random() * 0.02, pan);
    for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const g = ctx.createGain(); const s = t + i * 0.09;
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(1, s + 0.01); g.gain.linearRampToValueAtTime(0, s + 0.05);
      o.connect(g).connect(out); o.start(s); o.stop(s + 0.06);
    }
  }
  #bird() {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this.#out(0.02 + Math.random() * 0.03, Math.random() * 1.6 - 0.8);
    const n = 2 + Math.floor(Math.random() * 4), base = 2200 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); const s = t + i * (0.12 + Math.random() * 0.08);
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.2), s); o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.6), s + 0.09);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(1, s + 0.015); g.gain.exponentialRampToValueAtTime(0.001, s + 0.1);
      o.connect(g).connect(out); o.start(s); o.stop(s + 0.12);
    }
  }
}
