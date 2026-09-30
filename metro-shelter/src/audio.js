// Procedural WebAudio soundscape: tunnel drone, generator hum, fire crackle, drips, footsteps, gunshots, rats.
export class Audio {
  constructor() {
    this.ctx = null;
    this.vol = 0.8;
  }

  start(volume) {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = volume ?? this.vol; this.master.connect(ctx.destination);
    // shared reverb: long, dark tail of a concrete vault
    this.verb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 900 ? i / 900 : 1);
    }
    this.verb.buffer = ir;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.35;
    this.verb.connect(this.wet).connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.listener = ctx.listener;
    // tunnel drone
    const drone = this.loopNoise(90, 0.06, 'lowpass');
    drone.connect(this.master);
    // generator hum (positional)
    this.gen = this.positional(new DOMPoint(7.4, 0.5, -21));
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 50;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 100.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    this.genGain = ctx.createGain(); this.genGain.gain.value = 0.16;
    o1.connect(lp); o2.connect(lp); lp.connect(this.genGain).connect(this.gen);
    o1.start(); o2.start();
    // fire crackle (positional)
    this.fire = this.positional(new DOMPoint(0.2, 1, 1.5));
    const fn = this.loopNoise(900, 0.05, 'bandpass'); fn.connect(this.fire);
    this.crackleT = 0; this.dripT = 2;
  }

  loopNoise(freq, gain, type) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g); src.start();
    return g;
  }

  positional(p) {
    const pan = this.ctx.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 1.5; pan.rolloffFactor = 1.2;
    pan.positionX.value = p.x; pan.positionY.value = p.y; pan.positionZ.value = p.z;
    pan.connect(this.master); pan.connect(this.verb);
    return pan;
  }

  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }

  update(dt, camera, power01) {
    if (!this.ctx) return;
    const l = this.listener, p = camera.position;
    const f = camera.getWorldDirection(camera.userData.tmpDir || (camera.userData.tmpDir = camera.position.clone()));
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02); l.positionY.setTargetAtTime(p.y, t, 0.02); l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
    this.genGain.gain.setTargetAtTime(power01 > 0 || true ? 0.16 : 0, t, 0.3);
    // fire pops
    this.crackleT -= dt;
    if (this.crackleT < 0) { this.click(this.fire, 1800 + Math.random() * 2500, 0.25 * Math.random(), 0.02); this.crackleT = Math.random() * 0.25; }
    // water drips at random spots in the station
    this.dripT -= dt;
    if (this.dripT < 0) {
      this.dripT = 1 + Math.random() * 4;
      const pos = new DOMPoint((Math.random() - 0.5) * 26, 0, (Math.random() - 0.5) * 50);
      const pan = this.positional(pos);
      const o = this.ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(1400 + Math.random() * 900, t);
      o.frequency.exponentialRampToValueAtTime(500, t + 0.09);
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g).connect(pan); o.start(t); o.stop(t + 0.15);
      setTimeout(() => pan.disconnect(), 3000);
    }
  }

  click(dest, freq, gain, dur) {
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 1 + Math.random();
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 2;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(f).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  step(surface, speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const hard = surface === 'stone';
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = hard ? 'bandpass' : 'lowpass'; f.frequency.value = hard ? 700 + Math.random() * 300 : 1800; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    const v = Math.min(0.08 + speed * 0.04, 0.22);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + (hard ? 0.09 : 0.16));
    s.connect(f).connect(g); g.connect(this.master); g.connect(this.verb);
    s.start(t, Math.random() * 1.5); s.stop(t + 0.2);
  }

  shot() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(f).connect(g); g.connect(this.master); g.connect(this.verb);
    s.start(t); s.stop(t + 0.4);
    const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const og = this.ctx.createGain(); og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.2);
  }

  dry() { if (this.ctx) this.click(this.master, 3000, 0.15, 0.03); }
  reload() {
    if (!this.ctx) return;
    [0, 0.55, 1.3].forEach((d, i) => setTimeout(() => this.click(this.master, 2200 - i * 400, 0.25, 0.05), d * 1000));
  }
  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(520, t); o.frequency.setValueAtTime(780, t + 0.07);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.22);
    this.click(this.master, 1200, 0.2, 0.08);
  }
  squeak(pos, loud = false) {
    if (!this.ctx) return;
    const pan = this.positional(new DOMPoint(pos.x, pos.y + 0.1, pos.z));
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    const base = 2600 + Math.random() * 1600;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 1.25, t + 0.04);
    o.frequency.linearRampToValueAtTime(base * 0.9, t + 0.1);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(loud ? 0.25 : 0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(g).connect(pan); o.start(t); o.stop(t + 0.15);
    setTimeout(() => pan.disconnect(), 3000);
  }
  hurt() { if (this.ctx) this.click(this.master, 400, 0.5, 0.15); }
}
