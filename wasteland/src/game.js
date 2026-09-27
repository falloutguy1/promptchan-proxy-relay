// Top-level game object: renderer, world, camera rig, colony simulation, AI
// Overseer, effects, audio, UI, and the frame loop (with dynamic resolution).
import * as THREE from 'three';
import { Assets } from './core/assets.js';
import { patchGlobalChunks, G } from './core/shaderlib.js';
import { CameraRig } from './core/camera.js';
import { Input } from './core/input.js';
import { Post } from './gfx/post.js';
import { FX } from './gfx/fx.js';
import { World } from './world/world.js';
import { START } from './world/layout.js';
import { Colony } from './sim/sim.js';
import { Overseer } from './sim/ai.js';
import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { Interaction } from './ui/interact.js';
import { Audio } from './audio.js';
import { Loading } from './ui/overlays.js';
import { installReviewApi } from './review.js';

const $ = (id) => document.getElementById(id);

export class Game {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.lastT = 0;
    this.time = 0;
    this.frame = 0;
    this.perf = { fps: 0, ms: 0, acc: 0, n: 0, cpu: 0, gpuCalls: 0, tris: 0, worst: 0 };
    this.dynScale = 1;
    this.dynCool = 0;
    this.possessed = null;
  }

  async boot() {
    patchGlobalChunks();
    const s = this.settings;
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true,
      preserveDrawingBuffer: s.review,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.sim?.save(); this.onContextLost?.(); });

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x808080, 0.001); // enables USE_FOG; colours come from G
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.3, 4200);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    const loading = new Loading();
    loading.setStages(9);
    this.loading = loading;
    this.assets = new Assets(renderer, s);
    this.assets.onProgress = (d, t, l) => loading.progress(d, t, l);

    this.world = new World(this);
    await this.world.build(loading);

    loading.stageStart(7, 'Preparing the colony');
    this.fx = new FX(this.scene, s);
    this.rig = new CameraRig(this.camera, this.world.terrain);
    this.sim = new Colony(this);
    await this.sim.init(this.assets);
    this.sim.ai = new Overseer(this.sim);
    this.rig.colliders = this.world.colliders;
    this.rig.hash = this.sim.colliders;
    this.rig.snap();
    this.input = new Input(this.canvas);
    this.input.bindStick($('stick'));
    this.post = new Post(renderer, this.scene, this.camera, s);
    this.#bindCamera();
    this.audio = new Audio(this);
    this.hud = new HUD(this);
    this.menu = new Menu(this);
    this.interact = new Interaction(this);
    this.sim.on('sound', (k, p) => this.audio.play(k, p));
    this.sim.on('end', (r) => { this.hud.setSpeed(0); if (this.possessed) this.exitWalk(); setTimeout(() => this.menu.showEnd(r), 1200); });

    loading.stageStart(8, 'Compiling shaders');
    await renderer.compileAsync(this.scene, this.camera);
    installReviewApi(this);
    $('perf').classList.toggle('hidden', !s.showFps);
    this.ready = true;
    loading.hide();
    if (!s.review) {
      this.#menuScene();
      this.menu.show('main');
      this.start();
    }
  }

  // ------------------------------------------------------------ flows
  #menuScene() {
    this.world.sky.setTime(18.3);
    this.world.sky.setWeather('cloudy', true);
    this.rig.mode = 'cinematic';
    this.hud.hide();
  }

  newGame({ mode = 'human', difficulty = 'normal' } = {}) {
    this.menu.hide();
    if (this.possessed) this.exitWalk();
    this.sim.newGame({ mode, difficulty });
    this.sim.ai.setEnabled(mode === 'ai');
    this.#toColony();
  }
  loadGame() {
    if (!this.sim.load()) return false;
    this.menu.hide();
    this.sim.ai.setEnabled(this.sim.mode === 'ai');
    this.#toColony();
    return true;
  }
  #toColony() {
    this.hud.show();
    this.hud.setSpeed(1);
    this.rig.mode = 'rts';
    this.rig.follow = null;
    this.rig.focusOn(this.sim.center.x ?? START.x, this.sim.center.z ?? START.z, 46);
    this.rig.goal.yaw = 0.7;
    this.rig.pitchOffset = 0;
    this.rig.snap();
  }
  toMenu() {
    if (this.possessed) this.exitWalk();
    this.interact.cancelPlace();
    this.hud.select(null);
    this.sim.started = false;
    this.sim.ai.setEnabled(false);
    this.#menuScene();
    this.menu.show('main');
  }

  // ------------------------------------------------------------ first person
  enterWalk(s) {
    if (!s?.alive || this.rig.mode === 'walk') return;
    this.interact.cancelPlace();
    this.hud.select(null);
    this.possessed = s;
    s.possessed = true;
    s.reset();
    s.c.fp = true;
    this.rig.enterWalk(s.pos.x, s.pos.z, s.c.yaw + Math.PI);
    this.input.mode = 'walk';
    document.body.classList.add('walking');
    $('walk-ui').classList.remove('hidden');
    if (!document.body.classList.contains('touch')) this.canvas.requestPointerLock?.();
    this.sim.log('info', `You took control of ${s.name}.`);
  }
  exitWalk() {
    const s = this.possessed;
    if (s) { s.possessed = false; s.c.fp = false; s.c.anim.set('idle'); }
    this.possessed = null;
    if (this.rig.mode === 'walk') this.rig.exitWalk();
    this.input.mode = 'rts';
    document.body.classList.remove('walking');
    $('walk-ui').classList.add('hidden');
    this.hud.walkPrompt('');
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (s?.alive) this.hud.select({ kind: 'survivor', ref: s });
  }
  #syncPossessed() {
    const s = this.possessed;
    if (!s.alive) { this.exitWalk(); return; }
    const w = this.rig.walk;
    s.pos.x = w.pos.x; s.pos.z = w.pos.z;
    s.c.yaw = s.c.targetYaw = w.yaw + Math.PI;
    s.c.speed = w.speed;
    s.c.anim.set(w.speed > 2.4 ? 'run' : w.speed > 0.2 ? 'walk' : 'idle');
  }

  // ------------------------------------------------------------ camera input
  #bindCamera() {
    const rig = this.rig, input = this.input;
    input.on('pan', (dx, dy) => {
      if (rig.mode !== 'rts') return;
      rig.follow = null;
      const k = rig.cur.dist / (this.canvas.clientHeight * 0.9);
      rig.pan(-dx * k, -dy * k * 1.35);
    });
    input.on('rotate', (dyaw, dpitch) => { if (rig.mode !== 'rts') return; rig.rotate(-dyaw); rig.tilt(dpitch); });
    input.on('tilt', (d) => { if (rig.mode === 'rts') rig.tilt(d); });
    input.on('zoom', (f, x, y) => { if (rig.mode === 'rts') rig.zoom(f, rig.follow ? null : this.pickGround(x, y)); });
    input.on('look', (dx, dy) => rig.look(dx, dy));
  }

  pickGround(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // march the heightfield (fast, no mesh raycast)
    const o = ray.ray.origin, d = ray.ray.direction, t = this.world.terrain;
    let prev = 0;
    for (let s = 1; s < 1500; s *= 1.04) {
      const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
      if (y < t.height(x, z)) {
        let a = prev, b = s;
        for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (o.y + d.y * m < t.height(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
        return new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
      }
      prev = s;
    }
    return null;
  }

  resize() {
    const s = this.settings.values;
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, s.dprCap) * s.renderScale * this.dynScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min((now - this.lastT) / 1000, 0.1);
      this.lastT = now;
      if (dt > 0) this.step(dt);
    };
    requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.sim.started) this.sim.save(); });
  }

  step(dt) {
    const t0 = performance.now();
    if (this.pendingResize) { this.pendingResize = false; this.resize(); }
    this.time += dt;
    this.frame++;
    G.uTime.value = this.time;
    if (this.input) this.rig.update(dt, this.input);
    if (this.possessed) this.#syncPossessed();
    this.interact?.update(dt);
    // simulation first so the sky follows the colony clock
    this.sim?.update(dt);
    const sky = this.world.sky;
    const free = this.rig.mode === 'free' && this.reviewFocus;
    const focus = free ? this.reviewFocus : this.rig.focus;
    sky.update(dt, focus, free ? 60 : this.rig.viewDistance);
    this.fx?.update(this.sim?.started && this.sim.speed === 0 ? 0 : dt, this.camera, sky);
    this.world.update(dt, this.camera, focus);
    this.hud?.update(dt);
    this.audio?.update(dt);
    this.renderer.info.reset();
    this.post.render(dt, sky.exposure, this.time);
    const cpu = performance.now() - t0;
    this.#perf(dt, cpu);
  }

  #perf(dt, cpu) {
    const p = this.perf;
    p.acc += dt; p.n++; p.cpu += cpu; p.worst = Math.max(p.worst, dt);
    if (p.acc >= 0.5) {
      p.fps = p.n / p.acc; p.ms = (p.acc / p.n) * 1000; p.cpuMs = p.cpu / p.n;
      p.calls = this.renderer.info.render.calls; p.tris = this.renderer.info.render.triangles;
      p.worstMs = p.worst * 1000;
      p.acc = 0; p.n = 0; p.cpu = 0; p.worst = 0;
      this.#dynamicResolution(p);
      if (this.settings.showFps) {
        const sim = this.sim;
        $('perf').textContent = `${p.fps.toFixed(0)} fps  ${p.ms.toFixed(1)} ms (worst ${p.worstMs.toFixed(0)})  cpu ${p.cpuMs.toFixed(1)} ms\n`
          + `${p.calls} calls  ${(p.tris / 1e6).toFixed(2)}M tris  res ${Math.round(this.renderer.getPixelRatio() * 100)}%  ${this.settings.preset}\n`
          + (sim?.started ? `${sim.alive().length} survivors  ${sim.infected.filter((z) => z.alive).length} infected  paths ${sim.nav.stats.searches}` : '');
      }
      this.onPerf?.(p);
    }
  }

  #dynamicResolution(p) {
    if (!this.settings.dynamicRes || this.settings.review) return;
    this.dynCool -= 0.5;
    if (this.dynCool > 0) return;
    // resizing clears the canvas, so it is applied at the start of the next frame (no blank frame is presented)
    if (p.fps < 40 && this.dynScale > 0.55) { this.dynScale = Math.max(0.55, this.dynScale - 0.1); this.dynCool = 2; this.pendingResize = true; }
    else if (p.fps > 56 && this.dynScale < 1) { this.dynScale = Math.min(1, this.dynScale + 0.05); this.dynCool = 3; this.pendingResize = true; }
  }
}
