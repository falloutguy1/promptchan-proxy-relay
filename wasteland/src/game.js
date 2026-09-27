// Top-level game object: renderer, world, camera rigs, simulation, UI, loop.
import * as THREE from 'three';
import { Assets } from './core/assets.js';
import { patchGlobalChunks, G } from './core/shaderlib.js';
import { CameraRig } from './core/camera.js';
import { Input } from './core/input.js';
import { Post } from './gfx/post.js';
import { World } from './world/world.js';
import { Loading } from './ui/overlays.js';
import { installReviewApi } from './review.js';

export class Game {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.lastT = 0;
    this.time = 0;
    this.frame = 0;
    this.perf = { fps: 0, ms: 0, acc: 0, n: 0, cpu: 0, gpuCalls: 0, tris: 0 };
    this.dynScale = 1;
    this.paused = false;
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
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.onContextLost?.(); });

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x808080, 0.001); // enables USE_FOG; colours come from G
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.3, 4200);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    const loading = new Loading();
    loading.setStages(8);
    this.loading = loading;
    this.assets = new Assets(renderer, s);
    this.assets.onProgress = (d, t, l) => loading.progress(d, t, l);

    this.world = new World(this);
    await this.world.build(loading);

    loading.stageStart(7, 'Compiling shaders');
    this.rig = new CameraRig(this.camera, this.world.terrain);
    this.rig.colliders = this.world.colliders;
    this.rig.snap();
    this.input = new Input(this.canvas);
    this.post = new Post(renderer, this.scene, this.camera, s);
    this.#bindCamera();
    await renderer.compileAsync(this.scene, this.camera);
    installReviewApi(this);
    this.ready = true;
    loading.hide();
    if (!s.review) this.start();
  }

  #bindCamera() {
    const rig = this.rig, input = this.input;
    input.on('pan', (dx, dy) => {
      const k = rig.cur.dist / (this.canvas.clientHeight * 0.9);
      rig.pan(-dx * k, -dy * k * 1.35);
    });
    input.on('rotate', (dyaw, dpitch) => { rig.rotate(-dyaw); rig.tilt(dpitch); });
    input.on('tilt', (d) => rig.tilt(d));
    input.on('zoom', (f, x, y) => rig.zoom(f, this.pickGround(x, y)));
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
  }

  step(dt) {
    const t0 = performance.now();
    this.time += dt;
    this.frame++;
    G.uTime.value = this.time;
    this.input && this.rig.update(dt, this.input);
    const sky = this.world.sky;
    const focus = this.rig.mode === 'free' && this.reviewFocus ? this.reviewFocus : this.rig.focus;
    sky.update(dt, focus, this.rig.mode === 'free' ? 60 : this.rig.viewDistance);
    this.world.update(dt, this.camera, this.rig.mode === 'free' && this.reviewFocus ? this.reviewFocus : this.rig.focus);
    this.renderer.info.reset();
    this.post.render(dt, sky.exposure, this.time);
    const cpu = performance.now() - t0;
    this.#perf(dt, cpu);
  }

  #perf(dt, cpu) {
    const p = this.perf;
    p.acc += dt; p.n++; p.cpu += cpu;
    if (p.acc >= 0.5) {
      p.fps = p.n / p.acc; p.ms = (p.acc / p.n) * 1000; p.cpuMs = p.cpu / p.n;
      p.calls = this.renderer.info.render.calls; p.tris = this.renderer.info.render.triangles;
      p.acc = 0; p.n = 0; p.cpu = 0;
      this.onPerf?.(p);
    }
  }
}
