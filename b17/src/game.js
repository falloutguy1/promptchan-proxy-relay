import * as THREE from 'three';
import { createRenderer, Post } from './core/render.js';
import { Assets } from './core/assets.js';
import { Environment } from './core/env.js';
import { Audio } from './core/audio.js';
import { settings, saveSettings, IS_TOUCH } from './core/settings.js';
import { Heightfield, nextFrame, TARGETS, HALF } from './world/layout.js';
import { Terrain, buildMask, createTerrainMaterial, makeNoiseTexture } from './world/terrain.js';
import { River } from './world/water.js';
import { Roads } from './world/roads.js';
import { Buildings, buildingMaterials } from './world/buildings.js';
import { Settlement } from './world/settlement.js';
import { Vegetation } from './world/vegetation.js';
import { Props } from './world/props.js';
import { buildB17 } from './aircraft/b17.js';
import { Aircraft, B17_SPEC } from './aircraft/flight.js';
import { Effects } from './fx/effects.js';
import { Bombs, Guns, Bomber, Gunnery, Flak, Fighter } from './combat/combat.js';
import { Input } from './ui/input.js';
import { HUD } from './ui/hud.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const START = { x: -7400, y: 2250, z: -520 };
const FORMATION = [new THREE.Vector3(48, 14, 60), new THREE.Vector3(-48, -12, 66), new THREE.Vector3(0, -26, -70)];
const NEED = { works: 0.5, yard: 0.42, bridge: 0.99, depot: 0.5 };

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.started = false;
    this.params = new URLSearchParams(location.search);
    this.state = 'loading';
    this.statsOn = settings.showFps || this.params.has('stats');
    this.releaseMode = 'single';
    this.camMode = 'chase';
    this.frames = 0;
    this.fpsAcc = { t: 0, n: 0, fps: 0, ms: 0 };
  }

  setLoad(frac, label) {
    $('load-fill').style.width = (frac * 100).toFixed(1) + '%';
    if (label) $('load-label').textContent = label;
  }

  async boot() {
    const t0 = performance.now();
    this.renderer = createRenderer(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1.5, 70000);
    this.scene.add(this.camera);

    this.assets = new Assets(this.renderer);
    this.assets.onProgress = (f, l) => this.setLoad(f * 0.4, `Loading assets… ${l}`);
    await this.assets.loadAll();
    this.env = new Environment(this.renderer, this.scene, this.camera, this.assets);

    this.hf = new Heightfield();
    await this.hf.generate(f => this.setLoad(0.4 + f * 0.12, 'Generating terrain…'));
    this.mask = await buildMask(this.hf, f => this.setLoad(0.52 + f * 0.08, 'Surveying land use…'));
    this.noiseTex = makeNoiseTexture();
    this.terrainMat = createTerrainMaterial(this.env, this.assets, this.mask, this.noiseTex);
    this.terrain = new Terrain(this.scene, this.hf, this.terrainMat);
    this.river = new River(this.scene, this.env);
    this.roads = new Roads(this.scene, this.env, this.assets, this.hf);

    this.setLoad(0.62, 'Building the town…'); await nextFrame();
    this.bmats = buildingMaterials(this.env, this.assets, this.noiseTex);
    this.buildings = new Buildings(this.scene, this.env, this.bmats);
    this.settlement = new Settlement(this.buildings, this.roads, this.hf);
    this.settlement.defineTypes();
    this.setLoad(0.66, 'Building targets…'); await nextFrame();
    this.settlement.buildTargets();
    this.setLoad(0.7, 'Building the town…'); await nextFrame();
    this.settlement.buildTown();
    this.setLoad(0.74, 'Building villages…'); await nextFrame();
    this.settlement.buildVillages();
    this.roads.finalize();
    this.buildings.finalize();

    this.setLoad(0.78, 'Growing trees…'); await nextFrame();
    this.veg = new Vegetation(this.scene, this.env, this.assets, this.hf, this.mask, this.settlement, this.renderer);
    await this.veg.init(f => this.setLoad(0.78 + f * 0.08, 'Growing trees…'));
    this.props = new Props(this.scene, this.env, this.assets, this.hf, this.settlement);

    this.setLoad(0.87, 'Preparing aircraft…'); await nextFrame();
    this.fx = new Effects(this.scene, this.hf, this.env);
    this.audio = new Audio();
    this.guns = new Guns(this.fx, this.audio);
    this.gunnery = new Gunnery(this.guns, this.fx, this.audio);
    this._makeBombers();
    this.bombs = new Bombs(this.scene, this.playerModel.bombGeom, this.playerModel.bombMat, this.hf, this.buildings, this.fx, this.audio);
    this.bombs.onImpact = (b, destroyed) => this._onImpact(b, destroyed);
    this.buildings.onDestroyed = (r) => this._onDestroyed(r);
    this.flak = new Flak(this.scene, this.env, this.bmats, this.settlement.flakGuns, this.fx, this.audio);
    this.fighters = [];
    this.input = new Input(this.canvas);
    this.input.bindTouchButtons();
    this.hud = new HUD();
    if (IS_TOUCH) { document.body.classList.add('touch'); $('touch').classList.remove('hidden'); }

    this.post = new Post(this.renderer, this.scene, this.camera);
    addEventListener('resize', () => this.post.resize());
    this._resetMission();
    if (this.params.has('cam')) this._debugCam();
    this._updateCamera(0.016, true);
    this.terrain.warm(this.camera.position);
    this.buildings.update(this.camera.position, true);
    this.veg.update(this.camera.position, 0, true);

    this.setLoad(0.93, 'Compiling shaders…'); await nextFrame();
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch (e) { /* not fatal */ }
    this.loadSeconds = (performance.now() - t0) / 1000;
    this.setLoad(1, `Ready (${this.loadSeconds.toFixed(1)} s)`);
    this.started = true;
    this._wireUI();
    $('loading').classList.add('hidden');
    if (this.assets.failed.length) {
      const w = $('asset-warn');
      w.textContent = `Some assets could not be loaded and use fallbacks: ${this.assets.failed.join(', ')}`;
      w.classList.remove('hidden');
    }
    if (this.params.has('autostart') || this.params.has('cam')) this.startMission(); else this._showScreen('menu');
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  _debugCam() {
    const [x, y, z, yaw, pitch] = (this.params.get('cam')).split(',').map(Number);
    this.debugCam = { x, y: y + (this.params.has('agl') ? this.hf.height(x, z) : 0), z, yaw, pitch };
    if (this.params.get('fov')) { this.camera.fov = +this.params.get('fov'); this.camera.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------------ setup
  _makeBombers() {
    this.playerModel = buildB17(this.env);
    this.scene.add(this.playerModel.root);
    this.player = new Bomber(this.playerModel, new Aircraft(B17_SPEC), { player: true, name: 'Franconia Belle' });
    this.wingmen = [];
    const names = ['Lucky Lady II', 'Sack Time Sally', 'Hell\'s Bells'];
    for (let i = 0; i < 3; i++) {
      const m = buildB17(this.env);
      this.scene.add(m.root);
      const w = new Bomber(m, new Aircraft(B17_SPEC), { name: names[i] });
      w.slot = FORMATION[i];
      this.wingmen.push(w);
    }
    this.bombers = [this.player, ...this.wingmen];
  }

  _resetMission() {
    const place = (b, off) => {
      const fl = b.fl;
      fl.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);   // heading east
      fl.pos.set(START.x, START.y, START.z).add(off.clone().applyQuaternion(fl.quat));
      fl.vel.set(80, 0, 0);
      fl.rate.set(0, 0, 0);
      fl.throttle = 0.72;
      fl.mass = B17_SPEC.mass;
      fl.engines.forEach(e => Object.assign(e, { hp: 1, fire: 0, running: true, rpm: 0.8, feathered: false, smokeFx: null }));
      fl.crashed = false;
      Object.assign(b, { alive: true, exploded: false, bombs: 12, parts: { wingL: 1, wingR: 1, tail: 1, fus: 1 }, extinguishers: 2, doorOpen: 0, doorTarget: 0, kills: 0, hitsTaken: 0 });
      b.model.root.visible = true;
      b.fireFx?.forEach(e => e && (e.dead = true));
      b.fireFx = [null, null, null, null];
    };
    place(this.player, new THREE.Vector3());
    this.wingmen.forEach(w => place(w, w.slot));
    for (const f of this.fighters) f.dispose(this.scene);
    this.fighters = [];
    this.bombs.list.length = 0;
    this.guns.list.length = 0;
    this.flak.pending.length = 0;
    for (const r of this.buildings.records) { r.alive = true; r.hp = r.maxHp; }
    this.buildings.update(this.player.pos, true);
    this.fx.emitters.length = 0; this.fx.smoke.p.length = 0; this.fx.fire.p.length = 0; this.fx.craters.count = 0; this.fx.debris.length = 0;
    this.targetState = {};
    for (const t of TARGETS) this.targetState[t.id] = { frac: 0, need: NEED[t.id], done: false };
    this.stats = { t: 0, dropped: 0, onTarget: 0, fighterKills: 0, wingmenLost: 0 };
    this.waves = [{ t: 38, n: 4 }, { t: 95, n: 5 }, { t: 160, n: 5 }, { t: 240, n: 4 }];
    this.input.aimYaw = Math.PI / 2; this.input.aimPitch = 0.0;
    this.camMode = 'chase';
    this.mission = { success: false, over: false, endT: 0 };
    this.time = 0;
    this.bombFall = 0;
    this.impactPoint = new THREE.Vector3();
    this.aimWorld = new THREE.Vector3();
  }

  _wireUI() {
    const bt = $('brief-targets');
    bt.innerHTML = TARGETS.map(t => `<li>${t.name}${t.primary ? ' — <b>primary</b>' : ''}</li>`).join('');
    $('btn-start').onclick = () => this.startMission();
    $('btn-settings').onclick = () => this._openSettings('menu');
    $('btn-help').onclick = () => { this._back = 'menu'; this._showScreen('help'); };
    $('btn-help-back').onclick = () => this._showScreen(this._back || 'menu');
    $('btn-resume').onclick = () => this.resume();
    $('btn-p-settings').onclick = () => this._openSettings('pause');
    $('btn-p-help').onclick = () => { this._back = 'pause'; this._showScreen('help'); };
    $('btn-restart').onclick = () => { this._resetMission(); this.startMission(); };
    $('btn-again').onclick = () => { this._resetMission(); this.startMission(); };
    $('btn-set-back').onclick = () => this._showScreen(this._setBack);
    $('btn-apply').onclick = () => { this._applySettings(false); this._showScreen(this._setBack); };
    $('btn-reload').onclick = () => { this._applySettings(true); };
  }

  _openSettings(back) {
    this._setBack = back;
    $('set-preset').value = settings.preset;
    $('set-scale').value = settings.renderScale;
    $('rs-val').textContent = Math.round(settings.renderScale * 100) + '%';
    $('set-scale').oninput = () => { $('rs-val').textContent = Math.round($('set-scale').value * 100) + '%'; };
    $('set-vol').value = settings.volume;
    $('set-sens').value = settings.mouseSens;
    $('set-inv').checked = settings.invertY;
    $('set-fps').checked = this.statsOn;
    this._showScreen('settings');
  }

  _applySettings(reload) {
    settings.preset = $('set-preset').value;
    settings.renderScale = +$('set-scale').value;
    settings.volume = +$('set-vol').value;
    settings.mouseSens = +$('set-sens').value;
    settings.invertY = $('set-inv').checked;
    settings.showFps = this.statsOn = $('set-fps').checked;
    saveSettings();
    this.audio.setVolume(settings.volume);
    if (reload) { location.reload(); return; }
    this.post.build();
    this.post.resize();
  }

  _showScreen(id) {
    for (const s of ['menu', 'settings', 'help', 'pause', 'end']) $(s).classList.toggle('hidden', s !== id);
  }

  startMission() {
    this._showScreen(null);
    this.hud.show(true);
    this.input.enabled = true;
    this.state = 'play';
    this.audio.start();
    if (!IS_TOUCH && !this.debugCam) this.canvas.requestPointerLock?.();
    this.hud.message(IS_TOUCH ? 'Target: Schweinfurt. Drag to aim, SIGHT to bomb.' : 'Target: Schweinfurt. Mouse to aim, B for bombsight.', 5);
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.input.enabled = false;
    this.input.fire = false;
    document.exitPointerLock?.();
    this.audio.ctx?.suspend();
    this._showScreen('pause');
  }

  resume() {
    this._showScreen(null);
    this.state = 'play';
    this.input.enabled = true;
    this.audio.ctx?.resume();
    if (!IS_TOUCH) this.canvas.requestPointerLock?.();
  }

  // ------------------------------------------------------------------ events
  _onImpact(b, destroyed) {
    this.audio.explosion(b.pos.distanceTo(this.camera.position));
    for (const t of TARGETS) if (Math.hypot(b.pos.x - t.x, b.pos.z - t.z) < t.r) { if (b.owner === this.player) this.stats.onTarget++; break; }
    if (destroyed.length) this._updateTargets();
  }

  _onDestroyed(r) {
    const t = r.type;
    const big = t.radius > 25;
    if (t.name.startsWith('tank_')) {
      this.fx.explosion(new THREE.Vector3(r.x, r.y + 8, r.z), 3.2, false);
      this.fx.emitter({ kind: 'burn', pos: new THREE.Vector3(r.x, r.y + 5, r.z), scale: 3.2, rate: 7, life: 400 });
    } else if (big || Math.random() < 0.55) {
      this.fx.emitter({ kind: 'fire', pos: new THREE.Vector3(r.x, r.y + 2, r.z), scale: big ? 2.4 : 1.1, rate: big ? 6 : 3, life: 120 + Math.random() * 200 });
    }
  }

  _updateTargets() {
    for (const t of TARGETS) {
      const T = this.settlement.targets[t.id];
      const st = this.targetState[t.id];
      let dead = 0;
      for (const r of T.records) if (!r.alive) dead += r.weight;
      st.frac = T.total ? dead / T.total : 0;
      if (!st.done && st.frac >= st.need) {
        st.done = true;
        this.hud.message(`${t.name} destroyed!`, 4);
      }
    }
    const S = this.targetState;
    const n = Object.values(S).filter(s => s.done).length;
    if (!this.mission.success && S.works.done && n >= 3) {
      this.mission.success = true;
      this.hud.message('Primary objectives complete — turn for home (fly out of the area).', 7);
    }
  }

  releaseBombs(bomber, count) {
    const n = Math.min(count, bomber.bombs);
    if (n <= 0 || bomber.doorOpen < 0.9) return 0;
    const fl = bomber.fl;
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        if (!bomber.alive) return;
        const p = new THREE.Vector3((i % 2 ? 0.4 : -0.4), -1.3, 0.5).applyQuaternion(fl.quat).add(fl.pos);
        this.bombs.drop(p, fl.vel.clone().add(new THREE.Vector3(0, -2, 0)), bomber);
        fl.mass -= B17_SPEC.bombMass;
      }, i * 140);
    }
    bomber.bombs -= n;
    return n;
  }

  _spawnWave(n) {
    const p = this.player;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const pos = p.pos.clone().add(new THREE.Vector3(Math.cos(a) * 3800, 500 + Math.random() * 600, Math.sin(a) * 3800));
      const vel = p.pos.clone().sub(pos).normalize().multiplyScalar(150);
      const f = new Fighter(this.scene, this.env, pos, vel);
      f.id = this.fighters.length + Math.floor(Math.random() * 100);
      const alive = this.bombers.filter(b => b.alive);
      f.target = Math.random() < 0.55 ? p : alive[Math.floor(Math.random() * alive.length)];
      f.onKilled = (ff, from) => {
        this.fx.emitter({ kind: 'trail', obj: ff.root, flame: true, scale: 1.2, rate: 14, life: 30 });
        if (from?.side === 'allied') this.stats.fighterKills++;
        if (from === this.player) this.hud.message('Fw 190 shot down!', 2.5);
      };
      f.onSmoke = (ff) => this.fx.emitter({ kind: 'trail', obj: ff.root, scale: 0.8, rate: 8, life: 40, color: [0.18, 0.18, 0.18] });
      this.fighters.push(f);
    }
    this.hud.message(`Bandits! ${n} Fw 190s inbound`, 3);
  }

  // ------------------------------------------------------------------ simulation
  _handleInput(dt) {
    const I = this.input, p = this.player, fl = p.fl;
    if (I.consume('pause')) { if (this.state === 'play') this.pause(); else if (this.state === 'pause') this.resume(); }
    if (this.state !== 'play') return;
    if (I.consume('stats')) this.statsOn = !this.statsOn;
    if (I.consume('camera')) {
      const order = ['chase', 'close', 'gunner'];
      this.camMode = this.camMode === 'sight' ? 'chase' : order[(order.indexOf(this.camMode) + 1) % order.length];
    }
    if (I.consume('gunner')) this.camMode = this.camMode === 'gunner' ? 'chase' : 'gunner';
    if (I.consume('sight')) {
      this.camMode = this.camMode === 'sight' ? 'chase' : 'sight';
      if (this.camMode === 'sight') { p.doorTarget = 1; this.hud.message('Bomb bay doors open', 2); }
      else if (p.bombs === 0) p.doorTarget = 0;
    }
    if (I.consume('mode')) {
      this.releaseMode = { single: 'pair', pair: 'salvo', salvo: 'single' }[this.releaseMode];
      this.hud.message(`Release: ${this.releaseMode}`, 1.5);
    }
    if (I.consume('bomb')) {
      if (p.bombs <= 0) this.hud.message('No bombs left', 1.5);
      else if (p.doorOpen < 0.9) { p.doorTarget = 1; this.hud.message('Opening bomb bay…', 1.5); }
      else {
        const n = this.releaseBombs(p, { single: 1, pair: 2, salvo: 12 }[this.releaseMode]);
        this.stats.dropped += n;
        this.hud.message(n > 1 ? `Bombs away! (${n})` : 'Bomb away!', 1.5);
        // the formation drops on the leader
        for (const w of this.wingmen) {
          if (!w.alive || w.pos.distanceTo(_v.copy(w.slot).applyQuaternion(fl.quat).add(fl.pos)) > 250) continue;
          w.doorTarget = 1;
          setTimeout(() => { w.doorOpen = 1; this.releaseBombs(w, n); }, 250 + Math.random() * 500);
        }
      }
    }
    if (I.consume('extinguish')) this.hud.message(p.extinguish() ? `Fire extinguishers used (${p.extinguishers} left)` : (p.extinguishers ? 'No engine fire' : 'Extinguishers empty'), 2);
    const thr = I.axis('KeyS', 'KeyW') + I.throttleDelta;
    fl.throttle = THREE.MathUtils.clamp(fl.throttle + thr * dt * 0.35, 0.2, 1);
  }

  _aimDir(out) {
    const I = this.input;
    const y = I.aimYaw, p = this.camMode === 'sight' ? -0.01 : I.aimPitch;
    return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
  }

  _simulate(dt) {
    const p = this.player, fl = p.fl;
    this.time += dt;
    this.stats.t += dt;
    const aim = this._aimDir(_v2);
    if (p.alive) {
      // gunner view: the pilot holds course while you man the guns
      if (this.camMode === 'gunner') { if (!this.holdDir) this.holdDir = fl.forward().setY(0).normalize(); fl.instruct(this.holdDir); }
      else {
        if (this.holdDir) { this.input.aimYaw = Math.atan2(this.holdDir.x, this.holdDir.z); this.input.aimPitch = 0; this.holdDir = null; this._aimDir(aim); }
        fl.instruct(aim);
      }
      const r = this.input.axis('KeyD', 'KeyA'), yw = this.input.axis('KeyE', 'KeyQ');
      if (r) fl.cmd.roll = r;
      if (yw) fl.cmd.yaw = yw;
    } else {
      fl.cmd.roll = 0.35; fl.cmd.pitch = -0.4; fl.cmd.yaw = 0; fl.throttle = 0.2;
    }
    // wingmen autopilot: hold formation slot relative to the leader
    for (const w of this.wingmen) {
      if (!w.alive) { w.fl.cmd.roll = -0.3; w.fl.cmd.pitch = -0.5; w.fl.cmd.yaw = 0; w.fl.throttle = 0.1; continue; }
      if (p.alive) {
        const lead = p.fl;
        const target = _v.copy(w.slot).applyQuaternion(lead.quat).add(lead.pos);
        const err = target.clone().sub(w.fl.pos);
        const dir = lead.forward().multiplyScalar(160).add(err.clone().multiplyScalar(1.2)).normalize();
        w.fl.instruct(dir);
        const along = err.dot(lead.forward());
        w.fl.throttle = THREE.MathUtils.clamp(lead.throttle + along * 0.006 + (lead.vel.length() - w.fl.vel.length()) * 0.03, 0.25, 1);
      } else w.fl.instruct(w.fl.forward());
      w.doorOpen += ((w.doorTarget || 0) - w.doorOpen) * Math.min(1, dt * 1.5);
    }
    const sub = 4;
    for (let i = 0; i < sub; i++) for (const b of this.bombers) if (!b.exploded) b.fl.step(dt / sub, this.hf);
    for (const b of this.bombers) {
      const was = b.alive;
      b.update(dt);
      if (b.fl.crashed && !b.exploded) {
        b.exploded = true; b.alive = false;
        this.fx.explosion(b.fl.pos, 2.5, true);
        b.model.root.visible = false;
        b.fireFx.forEach(e => e && (e.dead = true));
        this.audio.explosion(b.pos.distanceTo(this.camera.position));
      }
      if (was && !b.alive) {
        if (b === p) this.hud.message('We\'re going down — bail out!', 6);
        else { this.stats.wingmenLost++; this.hud.message(`${b.name} is going down!`, 3); }
      }
      if (b.exploded) continue;
      b.fl.engines.forEach((e, i) => {
        if (e.fire && !b.fireFx[i]) {
          const o = new THREE.Object3D(); o.position.copy(b.model.engines[i]); b.model.root.add(o);
          b.fireFx[i] = this.fx.emitter({ kind: 'trail', obj: o, flame: true, scale: 1.1, rate: 18, vel: b.fl.vel });
          if (b === p) this.hud.message(`Engine #${[2, 1, 3, 4][i]} on fire! Press F`, 3);
        } else if (!e.fire && b.fireFx[i]) { b.fireFx[i].dead = true; b.fireFx[i] = null; }
        else if (!e.running && e.hp <= 0 && !b.fireFx[i] && !e.smokeFx) {
          const o = new THREE.Object3D(); o.position.copy(b.model.engines[i]); b.model.root.add(o);
          e.smokeFx = this.fx.emitter({ kind: 'trail', obj: o, scale: 0.8, rate: 6, color: [0.12, 0.12, 0.12], life: 120 });
        }
      });
    }
    p.doorOpen += (p.doorTarget - p.doorOpen) * Math.min(1, dt * 1.5);
    // impact prediction for the bombsight
    this.bombFall = this.bombs.predict(_v.set(0, -1.3, 0).applyQuaternion(fl.quat).add(fl.pos), fl.vel, this.hf, this.impactPoint);
    // fighters
    for (const wv of this.waves) if (!wv.done && this.time > wv.t) { wv.done = true; if (p.alive) this._spawnWave(wv.n); }
    for (let i = this.fighters.length - 1; i >= 0; i--) {
      const f = this.fighters[i];
      if (f.target && !f.target.alive) { const al = this.bombers.filter(b => b.alive); f.target = al[Math.floor(Math.random() * al.length)] || null; }
      f.update(dt, f.target, this.guns, this.hf, this.audio);
      if (!f.alive) {
        if (f.crashed) { this.fx.explosion(f.pos, 1.2, true); this.audio.explosion(f.pos.distanceTo(this.camera.position)); }
        f.dispose(this.scene); this.fighters.splice(i, 1);
      }
    }
    // gunnery
    this.aimWorld.copy(this.camera.position).addScaledVector(aim, 650);
    const playerFiring = this.input.fire && this.camMode !== 'sight';
    for (const b of this.bombers) this.gunnery.update(dt, b, this.fighters, this.aimWorld, playerFiring, b === p);
    this.guns.update(dt, [...this.bombers, ...this.fighters]);
    this.flak.update(dt, this.bombers, this.time);
    this.bombs.update(dt);
    // mission end conditions
    const M = this.mission;
    const out = Math.abs(fl.pos.x) > HALF + 600 || Math.abs(fl.pos.z) > HALF + 600;
    if (!M.over) {
      if (!p.alive) { M.endT += dt; if (M.endT > 7 || p.exploded) this._end(false); }
      else if (out && this.time > 30) this._end(M.success);
      else if (M.success && Math.hypot(fl.pos.x, fl.pos.z) > 6500 && this.time > 30) this._end(true);
      else if (p.bombs === 0 && !M.success && !M.bombsMsg) { M.bombsMsg = true; setTimeout(() => this.hud.message('Bombs expended — turn for home or keep the gunners busy', 5), 20000); }
    }
  }

  _end(success) {
    const M = this.mission;
    M.over = true;
    this.state = 'end';
    this.input.enabled = false;
    this.input.fire = false;
    document.exitPointerLock?.();
    const S = this.stats;
    const done = TARGETS.filter(t => this.targetState[t.id].done).map(t => t.name);
    $('end-kicker').textContent = success ? 'MISSION COMPLETE' : (this.player.alive ? 'MISSION ABORTED' : 'AIRCRAFT LOST');
    $('end-title').textContent = success ? 'Bombs on target' : (this.player.alive ? 'Returned without destroying the primary' : `${this.player.name} went down`);
    const mm = Math.floor(S.t / 60), ss = Math.floor(S.t % 60);
    $('end-stats').innerHTML = `<table>
      <tr><td>Flight time</td><td>${mm}:${String(ss).padStart(2, '0')}</td></tr>
      <tr><td>Targets destroyed</td><td>${done.length ? done.join(', ') : 'none'}</td></tr>
      <tr><td>Bombs dropped (you)</td><td>${S.dropped} — ${S.onTarget} in target areas</td></tr>
      <tr><td>Fighters shot down (formation)</td><td>${S.fighterKills}</td></tr>
      <tr><td>Wingmen lost</td><td>${S.wingmenLost} of 3</td></tr>
      <tr><td>Your aircraft integrity</td><td>${Math.round(this.player.integrity() * 100)}%, ${4 - (this.player.deadEngines || 0)} engines running</td></tr></table>`;
    setTimeout(() => this._showScreen('end'), 1500);
  }

  // ------------------------------------------------------------------ camera
  _updateCamera(dt, snap = false) {
    const cam = this.camera, p = this.player, fl = p.fl;
    if (this.debugCam) {
      const d = this.debugCam;
      cam.position.set(d.x, d.y, d.z);
      cam.rotation.set(THREE.MathUtils.degToRad(d.pitch), THREE.MathUtils.degToRad(d.yaw), 0, 'YXZ');
      cam.updateMatrixWorld();
      return;
    }
    const I = this.input;
    const look = this._aimDir(new THREE.Vector3());
    if (I.keys.has('KeyC') || Math.abs(I.lookYaw) + Math.abs(I.lookPitch) > 0.001) {
      look.applyEuler(new THREE.Euler(-I.lookPitch, I.lookYaw, 0, 'YXZ'));
      if (!I.keys.has('KeyC')) { I.lookYaw *= 0.9; I.lookPitch *= 0.9; }
    }
    let fov = 55, near = 1.5;
    if (this.camMode === 'chase' || this.camMode === 'close') {
      const dist = this.camMode === 'chase' ? 42 : 24;
      const target = fl.pos.clone().addScaledVector(look, -dist).add(_v.set(0, dist * 0.17, 0));
      if (snap) cam.position.copy(target); else cam.position.lerp(target, 1 - Math.exp(-dt * 14));
      cam.up.set(0, 1, 0);
      cam.lookAt(_v.copy(fl.pos).addScaledVector(look, 900).add(_v2.set(0, dist * 0.12, 0)));
    } else if (this.camMode === 'gunner') {
      const t = this._pickTurret(look);
      const pos = t.base.clone().applyQuaternion(fl.quat).add(fl.pos).add(_v.set(0, 0.55, 0).applyQuaternion(fl.quat));
      cam.position.copy(pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(_v.copy(pos).add(look));
      near = 0.3; fov = 50;
    } else if (this.camMode === 'sight') {
      const pos = _v.set(0, -1.2, 7.4).applyQuaternion(fl.quat).add(fl.pos);
      cam.position.copy(pos);
      cam.up.copy(fl.forward()).setY(0).normalize();
      cam.lookAt(this.impactPoint);
      fov = 16; near = 2;
    }
    if (cam.fov !== fov || cam.near !== near) { cam.fov = fov; cam.near = near; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  _pickTurret(dir) {
    const T = this.player.model.turrets;
    const l = dir.clone().applyQuaternion(_q.copy(this.player.fl.quat).invert());
    let name;
    if (l.z < -0.75) name = 'tail';
    else if (l.y > 0.2) name = 'top';
    else if (l.y < -0.3) name = l.z > 0.5 ? 'chin' : 'ball';
    else if (l.z > 0.7) name = 'chin';
    else name = l.x > 0 ? 'waistL' : 'waistR';
    return T[name];
  }

  // ------------------------------------------------------------------ frame
  frame() {
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    this._fps(rawDt);
    this._handleInput(dt);
    if (this.state === 'play') this._simulate(dt);
    else if (this.state === 'end') this.time += dt;
    this._updateCamera(dt);
    for (const b of this.bombers) {
      const m = b.model;
      m.root.position.copy(b.fl.pos);
      m.root.quaternion.copy(b.fl.quat);
      m.props.forEach((pr, i) => {
        const e = b.fl.engines[i];
        const w = e.running && e.hp > 0 ? 30 + 8 * e.rpm : (e.feathered ? 0 : 2);
        pr.angle += w * dt;
        pr.blades.rotation.z = pr.angle;
        pr.disc.visible = w > 8;
      });
      m.doors.forEach(d => { d.pivot.rotation.z = d.sgn * b.doorOpen * 1.45; });
      m.bombSlots.forEach((s, i) => { s.visible = i < b.bombs; });
    }
    const simDt = this.state === 'pause' ? 0 : dt;
    this.terrain.update(this.camera.position);
    this.buildings.update(this.camera.position);
    this.veg.update(this.camera.position, this.time);
    this.props.update(this.camera.position);
    this.fx.update(simDt, this.camera);
    this.river.update(this.time);
    this.env.update(this.camera);
    if (this.state === 'play' || this.state === 'end') { this.hud.update(dt, this); this.audio.update(this.player, this.camMode === 'gunner'); }
    this.input.endFrame();
    if (!this.__frameNoRender) this.post.render(dt);
    this.frames++;
  }

  _fps(dt) {
    const a = this.fpsAcc;
    a.t += dt; a.n++;
    if (a.t > 0.5) { a.fps = a.n / a.t; a.ms = a.t / a.n * 1000; a.t = 0; a.n = 0; }
  }

  statsText() {
    const i = this.renderer.info;
    return `${this.fpsAcc.fps.toFixed(0)} fps  ${this.fpsAcc.ms.toFixed(1)} ms\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1e6).toFixed(2)}M\ngeo ${i.memory.geometries}  tex ${i.memory.textures}\npreset ${settings.preset}  scale ${settings.renderScale}  px ${this.post.pixelRatio.toFixed(2)}`;
  }
}
