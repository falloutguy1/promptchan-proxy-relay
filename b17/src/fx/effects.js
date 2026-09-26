// GPU-instanced billboard particles: sun-lit smoke (alpha, sorted), fire/flash (additive),
// tracers, debris chunks and crater decals.
import * as THREE from 'three';
import { SUN_DIR, HAZE, FOG_DENSITY } from '../core/env.js';
import { q } from '../core/settings.js';

function puffAtlas() {
  // 4 smoke puff variants (2x2), built from layered noise blobs
  const S = 512, H = S / 2;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * H, oy = Math.floor(v / 2) * H;
    c.save(); c.beginPath(); c.rect(ox, oy, H, H); c.clip();
    for (let i = 0; i < 70; i++) {
      const a = rnd() * 6.28, r = Math.pow(rnd(), 0.7) * H * 0.3;
      const x = ox + H / 2 + Math.cos(a) * r, y = oy + H / 2 + Math.sin(a) * r;
      const rr = H * (0.08 + rnd() * 0.16);
      const g = c.createRadialGradient(x, y, 0, x, y, rr);
      const b = 190 + rnd() * 65;
      g.addColorStop(0, `rgba(${b},${b},${b},${0.22 + rnd() * 0.2})`);
      g.addColorStop(1, `rgba(${b},${b},${b},0)`);
      c.fillStyle = g; c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    c.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function craterTexture() {
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // scorched ring + ejecta (alpha = darkness)
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(10,8,6,0.95)'); g.addColorStop(0.3, 'rgba(25,20,15,0.9)'); g.addColorStop(0.42, 'rgba(70,58,44,0.8)');
  g.addColorStop(0.55, 'rgba(40,32,24,0.55)'); g.addColorStop(1, 'rgba(40,32,24,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const a = rnd() * 6.28, r = S * (0.2 + rnd() * 0.3);
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r, s = 1 + rnd() * 5;
    c.fillStyle = `rgba(${40 + rnd() * 40},${32 + rnd() * 30},${24 + rnd() * 20},${0.3 + rnd() * 0.5})`;
    c.fillRect(x, y, s, s);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VS = /* glsl */`
  attribute vec4 iPos;     // xyz, size
  attribute vec4 iCol;     // rgb, alpha
  attribute vec2 iRot;     // rotation, variant
  varying vec2 vUv; varying vec4 vCol; varying vec3 vN; varying float vFog; varying float vVar;
  uniform float fogDensity;
  void main(){
    vUv = uv; vCol = iCol; vVar = iRot.y;
    vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
    float c = cos(iRot.x), s = sin(iRot.x);
    vec2 p = position.xy;
    p = vec2(c*p.x - s*p.y, s*p.x + c*p.y) * iPos.w;
    mv.xy += p;
    // pseudo sphere normal in view space for lighting
    vN = normalize(vec3(position.xy * 1.4, 0.7));
    float d = length(mv.xyz);
    vFog = 1.0 - exp(-fogDensity*fogDensity*d*d);
    // fade when very close to camera
    vCol.a *= smoothstep(1.0, 8.0, d);
    gl_Position = projectionMatrix * mv;
  }`;

const FS_SMOKE = /* glsl */`
  uniform sampler2D tMap; uniform vec3 sunView; uniform vec3 sunCol; uniform vec3 ambCol; uniform vec3 fogColor;
  varying vec2 vUv; varying vec4 vCol; varying vec3 vN; varying float vFog; varying float vVar;
  void main(){
    float v = floor(vVar + 0.5);
    vec2 uv = (vUv + vec2(mod(v, 2.0), floor(v / 2.0))) * 0.5;
    vec4 t = texture2D(tMap, uv);
    float a = t.a * vCol.a;
    if(a < 0.004) discard;
    float lit = clamp(dot(normalize(vN), sunView) * 0.5 + 0.55, 0.0, 1.0);
    vec3 col = vCol.rgb * (ambCol + sunCol * lit) * (0.75 + 0.25 * t.r);
    col = mix(col, fogColor, vFog);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const FS_ADD = /* glsl */`
  uniform sampler2D tMap;
  varying vec2 vUv; varying vec4 vCol; varying vec3 vN; varying float vFog; varying float vVar;
  void main(){
    float v = floor(vVar + 0.5);
    vec2 uv = (vUv + vec2(mod(v, 2.0), floor(v / 2.0))) * 0.5;
    vec4 t = texture2D(tMap, uv);
    float a = t.a * vCol.a * (1.0 - vFog);
    gl_FragColor = vec4(vCol.rgb * a * (0.6 + 0.8 * t.r), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

class Pool {
  constructor(scene, max, additive, tex) {
    this.max = max;
    this.n = 0;
    this.p = [];
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iRot', this.aRot);
    g.instanceCount = 0;
    this.uniforms = {
      tMap: { value: tex }, sunView: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color(1.35, 1.27, 1.12) },
      ambCol: { value: new THREE.Color(0.32, 0.36, 0.44) }, fogColor: { value: HAZE }, fogDensity: { value: FOG_DENSITY },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VS, fragmentShader: additive ? FS_ADD : FS_SMOKE,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 11 : 10;
    this.geom = g;
    this.additive = additive;
    scene.add(this.mesh);
  }

  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push(o);
  }

  update(dt, cam, sort) {
    const P = this.p;
    for (let i = P.length - 1; i >= 0; i--) {
      const o = P[i];
      o.age += dt;
      if (o.age >= o.life) { P[i] = P[P.length - 1]; P.pop(); continue; }
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      const drag = Math.exp(-o.drag * dt);
      o.vx *= drag; o.vy = o.vy * drag + o.lift * dt; o.vz *= drag;
      o.rot += o.spin * dt;
    }
    if (sort) {
      const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
      for (const o of P) o.d = (o.x - cx) ** 2 + (o.y - cy) ** 2 + (o.z - cz) ** 2;
      P.sort((a, b) => b.d - a.d);
    }
    const ap = this.aPos.array, ac = this.aCol.array, ar = this.aRot.array;
    for (let i = 0; i < P.length; i++) {
      const o = P[i], t = o.age / o.life;
      ap[i * 4] = o.x; ap[i * 4 + 1] = o.y; ap[i * 4 + 2] = o.z;
      ap[i * 4 + 3] = o.s0 + (o.s1 - o.s0) * (1 - (1 - t) * (1 - t));
      const fadeIn = Math.min(1, o.age / (o.fadeIn || 0.08));
      const a = o.a * fadeIn * (t < o.hold ? 1 : 1 - (t - o.hold) / (1 - o.hold));
      const cr = o.c1 ? o.c0[0] + (o.c1[0] - o.c0[0]) * t : o.c0[0];
      const cg = o.c1 ? o.c0[1] + (o.c1[1] - o.c0[1]) * t : o.c0[1];
      const cb = o.c1 ? o.c0[2] + (o.c1[2] - o.c0[2]) * t : o.c0[2];
      ac[i * 4] = cr; ac[i * 4 + 1] = cg; ac[i * 4 + 2] = cb; ac[i * 4 + 3] = a;
      ar[i * 2] = o.rot; ar[i * 2 + 1] = o.v;
    }
    this.geom.instanceCount = P.length;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aRot.needsUpdate = true;
    this.aPos.clearUpdateRanges(); this.aCol.clearUpdateRanges(); this.aRot.clearUpdateRanges();
    this.aPos.addUpdateRange(0, P.length * 4); this.aCol.addUpdateRange(0, P.length * 4); this.aRot.addUpdateRange(0, P.length * 2);
  }
}

const rnd = Math.random;
function P(x, y, z, o) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, drag: 0.5, lift: 0, age: 0, life: 3, s0: 1, s1: 2, a: 1, hold: 0.3, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 0.4,
    v: Math.floor(rnd() * 4), c0: [1, 1, 1], ...o,
  };
}

export class Effects {
  constructor(scene, hf, env) {
    this.scene = scene;
    this.hf = hf;
    const tex = puffAtlas();
    const k = q().particles;
    this.smoke = new Pool(scene, Math.round(2600 * k), false, tex);
    this.fire = new Pool(scene, Math.round(1400 * k), true, tex);
    this.emitters = [];
    this.density = k;
    // tracers: stretched additive quads via line segments
    this.tracerGeom = new THREE.BufferGeometry();
    this.tracerMax = 600;
    this.tracerPos = new Float32Array(this.tracerMax * 6);
    this.tracerCol = new Float32Array(this.tracerMax * 6);
    this.tracerGeom.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeom.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(this.tracerGeom, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.tracers.frustumCulled = false;
    this.tracers.renderOrder = 12;
    scene.add(this.tracers);
    // craters (instanced decals) and debris
    const cg = new THREE.PlaneGeometry(1, 1, 6, 6); cg.rotateX(-Math.PI / 2);
    this.craterMat = new THREE.MeshStandardMaterial({ map: craterTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 });
    this.craters = new THREE.InstancedMesh(cg, this.craterMat, 400);
    this.craters.count = 0; this.craters.renderOrder = 3; this.craters.frustumCulled = false; this.craters.receiveShadow = true;
    scene.add(this.craters);
    const dg = new THREE.DodecahedronGeometry(0.5, 0);
    this.debrisMesh = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.9 }), 500);
    this.debrisMesh.count = 0; this.debrisMesh.frustumCulled = false; this.debrisMesh.castShadow = false;
    scene.add(this.debrisMesh);
    env?.material(this.craterMat); env?.material(this.debrisMesh.material);
    this.debris = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
  }

  // ------------------------------------------------------------ spawners
  explosion(pos, scale = 1, ground = true) {
    const k = this.density;
    // flash + fireball
    this.fire.spawn(P(pos.x, pos.y + 2 * scale, pos.z, { life: 0.3, s0: 12 * scale, s1: 26 * scale, a: 1.4, c0: [3, 2.1, 1.1], hold: 0.1, drag: 0 }));
    for (let i = 0; i < 14 * k; i++) {
      const a = rnd() * 6.28, sp = (8 + rnd() * 22) * scale;
      this.fire.spawn(P(pos.x, pos.y + 2, pos.z, { vx: Math.cos(a) * sp, vy: (10 + rnd() * 25) * scale, vz: Math.sin(a) * sp, drag: 2.5, life: 0.8 + rnd() * 0.8, s0: 8 * scale, s1: 18 * scale, a: 1.6, c0: [2.2, 1.1, 0.35], c1: [0.8, 0.2, 0.05], hold: 0.2 }));
    }
    // dark dust/smoke column
    for (let i = 0; i < 26 * k; i++) {
      const a = rnd() * 6.28, sp = (4 + rnd() * 16) * scale;
      const dark = ground ? 0.28 + rnd() * 0.2 : 0.12;
      this.smoke.spawn(P(pos.x + (rnd() - 0.5) * 6, pos.y + rnd() * 5, pos.z + (rnd() - 0.5) * 6, {
        vx: Math.cos(a) * sp, vy: (6 + rnd() * 26) * scale, vz: Math.sin(a) * sp, drag: 1.1, lift: 1.5, life: 7 + rnd() * 9, s0: 10 * scale, s1: (30 + rnd() * 30) * scale,
        a: 0.75, c0: ground ? [dark * 1.25, dark * 1.12, dark] : [dark, dark, dark], hold: 0.25, fadeIn: 0.2,
      }));
    }
    if (ground) {
      // ejecta debris
      for (let i = 0; i < 18 * k; i++) {
        const a = rnd() * 6.28, sp = 10 + rnd() * 30;
        this.debris.push({ x: pos.x, y: pos.y + 1, z: pos.z, vx: Math.cos(a) * sp, vy: 15 + rnd() * 35, vz: Math.sin(a) * sp, r: rnd() * 6, s: 0.3 + rnd() * 1.1, t: 0 });
      }
      this.crater(pos, 8 + scale * 6);
    }
  }

  crater(pos, size) {
    const i = this.craters.count < 400 ? this.craters.count++ : Math.floor(rnd() * 400);
    this._q.setFromEuler(this._e.set(0, rnd() * 6.28, 0));
    this._p.set(pos.x, this.hf.height(pos.x, pos.z) + 0.15, pos.z);
    this.craters.setMatrixAt(i, this._m.compose(this._p, this._q, this._s.set(size, 1, size)));
    this.craters.instanceMatrix.needsUpdate = true;
  }

  flak(pos) {
    const k = this.density;
    this.fire.spawn(P(pos.x, pos.y, pos.z, { life: 0.15, s0: 5, s1: 9, a: 1.5, c0: [3, 2.0, 1.0], drag: 0 }));
    for (let i = 0; i < 7 * k + 2; i++) {
      this.smoke.spawn(P(pos.x + (rnd() - 0.5) * 5, pos.y + (rnd() - 0.5) * 5, pos.z + (rnd() - 0.5) * 5, {
        vx: (rnd() - 0.5) * 10, vy: (rnd() - 0.5) * 10, vz: (rnd() - 0.5) * 10, drag: 1.6, life: 10 + rnd() * 8, s0: 6, s1: 22 + rnd() * 10, a: 0.9, c0: [0.07, 0.068, 0.065], hold: 0.35, fadeIn: 0.05,
      }));
    }
  }

  // persistent emitter (fires on the ground, burning engines)
  emitter(o) {
    const e = { t: 0, rate: 6, life: Infinity, age: 0, scale: 1, kind: 'fire', ...o };
    this.emitters.push(e);
    return e;
  }

  tracer(x0, y0, z0, x1, y1, z1, color) {
    this._tr = this._tr || [];
    this._tr.push([x0, y0, z0, x1, y1, z1, color]);
  }

  update(dt, cam) {
    const k = this.density;
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.age += dt;
      if (e.age > e.life || e.dead) { this.emitters.splice(i, 1); continue; }
      const p = e.obj ? e.obj.getWorldPosition(this._p) : e.pos;
      e.t += dt * e.rate * k;
      const fadeOut = e.life < Infinity ? Math.max(0, 1 - e.age / e.life) : 1;
      while (e.t >= 1) {
        e.t -= 1;
        const s = e.scale;
        if (e.kind === 'fire' || e.kind === 'burn') {
          this.fire.spawn(P(p.x + (rnd() - 0.5) * 4 * s, p.y + rnd() * s, p.z + (rnd() - 0.5) * 4 * s, { vy: 5 * s + rnd() * 4 * s, drag: 0.8, life: 0.7 + rnd() * 0.6, s0: 4 * s, s1: 7 * s, a: 1.3 * fadeOut, c0: [2.2, 1.0, 0.3], c1: [1.0, 0.25, 0.05], hold: 0.25 }));
          this.smoke.spawn(P(p.x + (rnd() - 0.5) * 3 * s, p.y + 4 * s, p.z + (rnd() - 0.5) * 3 * s, { vx: 3 + rnd() * 2, vy: 7 * s + rnd() * 5, vz: 1.5, drag: 0.25, lift: 0.8, life: 16 + rnd() * 10, s0: 6 * s, s1: 40 * s, a: 0.7 * fadeOut, c0: e.kind === 'burn' ? [0.04, 0.04, 0.04] : [0.1, 0.095, 0.09], hold: 0.2, fadeIn: 0.5 }));
        } else if (e.kind === 'trail') {
          const v = e.vel || { x: 0, y: 0, z: 0 };
          this.smoke.spawn(P(p.x, p.y, p.z, { vx: v.x * 0.05, vy: 1, vz: v.z * 0.05, drag: 0.6, life: 6 + rnd() * 4, s0: 1.5 * s, s1: 9 * s, a: 0.6, c0: e.color || [0.08, 0.08, 0.08], hold: 0.15 }));
          if (e.flame) this.fire.spawn(P(p.x, p.y, p.z, { life: 0.3, s0: 2.5 * s, s1: 1 * s, a: 1.5, c0: [2.2, 1.0, 0.3], drag: 0 }));
        } else if (e.kind === 'steam') {
          this.smoke.spawn(P(p.x, p.y, p.z, { vy: 3, drag: 0.4, lift: 0.5, life: 5, s0: 2 * s, s1: 8 * s, a: 0.35, c0: [0.9, 0.9, 0.9], hold: 0.2 }));
        }
      }
    }
    this.smoke.update(dt, cam, true);
    this.fire.update(dt, cam, false);
    // light direction in view space
    const sv = SUN_DIR.clone().transformDirection(cam.matrixWorldInverse);
    this.smoke.uniforms.sunView.value.copy(sv);
    // debris
    const D = this.debris;
    let n = 0;
    for (let i = D.length - 1; i >= 0; i--) {
      const d = D[i];
      d.t += dt; d.vy -= 9.81 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.r += dt * 5;
      const gy = this.hf.height(d.x, d.z);
      if (d.y < gy) { d.y = gy; d.vx *= 0.3; d.vz *= 0.3; d.vy = 0; }
      if (d.t > 12) { D.splice(i, 1); continue; }
    }
    for (const d of D) {
      if (n >= 500) break;
      this._q.setFromEuler(this._e.set(d.r, d.r * 0.7, 0));
      this.debrisMesh.setMatrixAt(n++, this._m.compose(this._p.set(d.x, d.y, d.z), this._q, this._s.setScalar(d.s)));
    }
    this.debrisMesh.count = n;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    // tracers
    const tr = this._tr || [];
    const m = Math.min(tr.length, this.tracerMax);
    for (let i = 0; i < m; i++) {
      const t = tr[i];
      this.tracerPos.set([t[0], t[1], t[2], t[3], t[4], t[5]], i * 6);
      const c = t[6];
      this.tracerCol.set([c[0] * 0.3, c[1] * 0.3, c[2] * 0.3, c[0], c[1], c[2]], i * 6);
    }
    this.tracerGeom.setDrawRange(0, m * 2);
    this.tracerGeom.attributes.position.needsUpdate = true;
    this.tracerGeom.attributes.color.needsUpdate = true;
    this._tr = [];
  }
}
