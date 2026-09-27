// Short-lived world effects: billboard particles (fire, smoke, muzzle flash,
// dust, blood, sparks) from a procedural sprite atlas, rain streaks wrapped
// around the camera, bullet tracers, a fixed pool of point lights assigned to
// the most important light sources each frame (the light count never changes,
// so shaders never recompile), and felled trees that topple and are cut up.
import * as THREE from 'three';
import { G } from '../core/shaderlib.js';

const MAX = 1600;
const TILE = { flame: 0, smoke: 1, dot: 2, streak: 3 };

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 2x2 atlas, canvas quadrants: flame top-left, smoke top-right, dot bottom-left,
// streak bottom-right (the texture is flipped on upload, see the vertex shader)
function atlasTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d');
  // flame: a tongue, rounded at the base, widest low down, licking to a point,
  // with a little turbulence so overlapping sprites do not read as discs
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = 1 - (y + 0.5) / S, u = ((x + 0.5) / S) * 2 - 1;
    const t = Math.min(1, Math.max(0, (v - 0.03) / 0.95));
    const w = 0.64 * Math.pow(Math.sin(Math.PI * t), 0.6) * Math.pow(1 - v * 0.97, 0.55) + 1e-4;
    const bend = 0.09 * Math.sin(v * 5.2 + 0.4) * v;
    const d = Math.abs(u - bend) / w;
    let a = (1 - smooth(0.4, 1, d)) * smooth(0, 0.1, v) * (1 - 0.4 * v);
    a *= 0.86 + 0.14 * Math.sin(u * 13 + v * 7) * Math.sin(v * 19 - u * 5);
    const o = (y * S + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
    img.data[o + 3] = Math.max(0, Math.min(255, a * 255));
  }
  g.putImageData(img, 0, 0);
  let gr;
  // smoke: lumpy puff
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 26; i++) {
    const x = S + S / 2 + (rnd() - 0.5) * S * 0.45, y = S / 2 + (rnd() - 0.5) * S * 0.45, r = S * (0.12 + rnd() * 0.2);
    gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.12 + rnd() * 0.16;
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  // soft dot
  gr = g.createRadialGradient(S / 2, S * 1.5, 0, S / 2, S * 1.5, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, S, S, S);
  // streak
  gr = g.createLinearGradient(S * 1.5 - 6, 0, S * 1.5 + 6, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(S * 1.5 - 6, S + 4, 12, S - 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const VS = /* glsl */`
attribute vec3 iPos; attribute vec2 iSize; attribute vec4 iCol; attribute float iTile;
uniform float uFogDensity;
varying vec2 vUv; varying vec4 vCol; varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4( iPos, 1.0 );
  float c = cos( iSize.y ), s = sin( iSize.y );
  mv.xy += vec2( position.x * c - position.y * s, position.x * s + position.y * c ) * iSize.x;
  gl_Position = projectionMatrix * mv;
  // the canvas is flipped on upload: tile row 0 (flame, smoke) is the top half
  vUv = ( uv + vec2( mod( iTile, 2.0 ), 1.0 - floor( iTile / 2.0 ) ) ) * 0.5;
  vCol = iCol;
  vFog = 1.0 - exp( -uFogDensity * max( 0.0, -mv.z ) );
}`;
// additive particles (flames, embers, flashes) emit light; the others (smoke,
// dust, chips, blood) are lit by the sky and sun like any surface
const FS = /* glsl */`
uniform sampler2D tAtlas; uniform vec3 uFogColor; uniform vec3 uLight; uniform float uGain;
varying vec2 vUv; varying vec4 vCol; varying float vFog;
void main() {
  vec4 t = texture2D( tAtlas, vUv );
  float a = t.a * vCol.a;
  if ( a < 0.004 ) discard;
  #ifdef ADDITIVE
    gl_FragColor = vec4( vCol.rgb * uGain * a * ( 1.0 - vFog ), 0.0 );
  #else
    gl_FragColor = vec4( mix( vCol.rgb * uLight, uFogColor, vFog ) * a, a );
  #endif
}`;

class ParticleSystem {
  constructor(atlas, additive, shared) {
    this.n = 0;
    this.px = new Float32Array(MAX * 3); this.pv = new Float32Array(MAX * 3);
    this.age = new Float32Array(MAX); this.life = new Float32Array(MAX);
    this.size = new Float32Array(MAX * 2); this.rot = new Float32Array(MAX * 2);
    this.col = new Float32Array(MAX * 4); this.col1 = new Float32Array(MAX * 4);
    this.tile = new Float32Array(MAX); this.drag = new Float32Array(MAX); this.grav = new Float32Array(MAX);
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aTile = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iSize', this.aSize); g.setAttribute('iCol', this.aCol); g.setAttribute('iTile', this.aTile);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      uniforms: { tAtlas: { value: atlas }, uFogColor: G.uFogColor, uFogDensity: G.uFogDensity, uLight: shared.uLight, uGain: shared.uGain },
      defines: additive ? { ADDITIVE: '' } : {},
      blending: THREE.CustomBlending,
    });
    // premultiplied output: additive = One/One, smoke = One/OneMinusSrcAlpha
    mat.blendSrc = THREE.OneFactor; mat.blendDst = additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 9 : 8;
  }

  emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, tile, { drag = 0, grav = 0, rot = Math.random() * 6.28, spin = 0 } = {}) {
    if (this.n >= MAX) return;
    const i = this.n++;
    this.px[i * 3] = x; this.px[i * 3 + 1] = y; this.px[i * 3 + 2] = z;
    this.pv[i * 3] = vx; this.pv[i * 3 + 1] = vy; this.pv[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life;
    this.size[i * 2] = s0; this.size[i * 2 + 1] = s1;
    this.rot[i * 2] = rot; this.rot[i * 2 + 1] = spin;
    this.col.set(c0, i * 4); this.col1.set(c1, i * 4);
    this.tile[i] = tile; this.drag[i] = drag; this.grav[i] = grav;
  }

  update(dt, wind) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) continue;
      // compact in place
      if (w !== i) {
        for (let k = 0; k < 3; k++) { this.px[w * 3 + k] = this.px[i * 3 + k]; this.pv[w * 3 + k] = this.pv[i * 3 + k]; }
        for (let k = 0; k < 2; k++) { this.size[w * 2 + k] = this.size[i * 2 + k]; this.rot[w * 2 + k] = this.rot[i * 2 + k]; }
        for (let k = 0; k < 4; k++) { this.col[w * 4 + k] = this.col[i * 4 + k]; this.col1[w * 4 + k] = this.col1[i * 4 + k]; }
        this.life[w] = this.life[i]; this.tile[w] = this.tile[i]; this.drag[w] = this.drag[i]; this.grav[w] = this.grav[i];
      }
      this.age[w] = age;
      const dr = Math.exp(-this.drag[w] * dt);
      this.pv[w * 3] = this.pv[w * 3] * dr + wind.x * this.drag[w] * dt * 0.6;
      this.pv[w * 3 + 1] = this.pv[w * 3 + 1] * dr - this.grav[w] * dt;
      this.pv[w * 3 + 2] = this.pv[w * 3 + 2] * dr + wind.y * this.drag[w] * dt * 0.6;
      for (let k = 0; k < 3; k++) this.px[w * 3 + k] += this.pv[w * 3 + k] * dt;
      this.rot[w * 2] += this.rot[w * 2 + 1] * dt;
      const t = age / this.life[w];
      this.aPos.array[w * 3] = this.px[w * 3]; this.aPos.array[w * 3 + 1] = this.px[w * 3 + 1]; this.aPos.array[w * 3 + 2] = this.px[w * 3 + 2];
      this.aSize.array[w * 2] = this.size[w * 2] + (this.size[w * 2 + 1] - this.size[w * 2]) * t;
      this.aSize.array[w * 2 + 1] = this.rot[w * 2];
      // fade in quickly, out smoothly
      const fade = Math.min(1, t * 8) * (1 - t * t);
      for (let k = 0; k < 3; k++) this.aCol.array[w * 4 + k] = this.col[w * 4 + k] + (this.col1[w * 4 + k] - this.col[w * 4 + k]) * t;
      this.aCol.array[w * 4 + 3] = (this.col[w * 4 + 3] + (this.col1[w * 4 + 3] - this.col[w * 4 + 3]) * t) * fade;
      this.aTile.array[w] = this.tile[w];
      w++;
    }
    this.n = w;
    const g = this.mesh.geometry;
    g.instanceCount = w;
    for (const a of [this.aPos, this.aSize, this.aCol, this.aTile]) { a.clearUpdateRanges(); a.addUpdateRange(0, w * a.itemSize); a.needsUpdate = true; }
    this.mesh.visible = w > 0;
  }
}

const RAIN_VS = /* glsl */`
attribute vec3 iPos;
uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec2 uWind; uniform float uFogDensity;
varying float vA; varying vec2 vUv;
void main() {
  vec3 base = iPos * uBox;
  float fall = 9.0 + iPos.x * 2.0;
  vec3 w;
  w.y = uCam.y + mod( base.y - uTime * fall - uCam.y, uBox.y ) - uBox.y * 0.5;
  vec2 drift = uWind * ( uTime + iPos.z * 3.0 );
  w.x = uCam.x + mod( base.x + drift.x - uCam.x, uBox.x ) - uBox.x * 0.5;
  w.z = uCam.z + mod( base.z + drift.y - uCam.z, uBox.z ) - uBox.z * 0.5;
  // cylindrical billboard, tilted with the wind
  vec3 toCam = normalize( vec3( uCam.x - w.x, 0.0, uCam.z - w.z ) );
  vec3 side = vec3( toCam.z, 0.0, -toCam.x );
  vec3 up = normalize( vec3( -uWind.x * 0.06, 1.0, -uWind.y * 0.06 ) );
  vec3 p = w + side * position.x * 0.012 + up * position.y * 0.55;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mv;
  float d = length( mv.xyz );
  vA = smoothstep( 0.5, 2.0, d ) * ( 1.0 - smoothstep( uBox.x * 0.3, uBox.x * 0.5, d ) ) * exp( -uFogDensity * d * 0.5 );
  vUv = uv;
}`;
const RAIN_FS = /* glsl */`
uniform vec3 uFogColor; uniform float uAmount;
varying float vA; varying vec2 vUv;
void main() {
  // streaks only catch as much light as the sky gives them: faint at night
  float lum = dot( uFogColor, vec3( 0.2126, 0.7152, 0.0722 ) );
  float a = ( 1.0 - abs( vUv.x * 2.0 - 1.0 ) ) * vA * uAmount * 0.22 * clamp( lum * 3.0, 0.08, 1.0 );
  gl_FragColor = vec4( uFogColor * 1.25 * a, a );
}`;

export class FX {
  constructor(scene, settings) {
    this.scene = scene;
    this.settings = settings;
    this.group = new THREE.Group();
    this.group.name = 'fx';
    scene.add(this.group);
    const atlas = atlasTexture();
    this.shared = { uLight: { value: new THREE.Color(1, 1, 1) }, uGain: { value: 1 } };
    this.add = new ParticleSystem(atlas, true, this.shared);
    this.alpha = new ParticleSystem(atlas, false, this.shared);
    this.group.add(this.alpha.mesh, this.add.mesh);
    this.acc = new Map();
    this.wind = new THREE.Vector2(0.6, 0.25);
    this.#rain();
    this.#tracers();
    this.#lights();
    this.falling = [];
  }

  // ---------------------------------------------------------- emitters
  /** Continuous emitter with a rate (per second); key identifies the source. */
  rate(key, r, dt) {
    const a = (this.acc.get(key) || Math.random()) + r * dt;
    const n = Math.floor(a);
    this.acc.set(key, a - n);
    return n;
  }
  fire(key, x, y, z, dt, strength = 1) {
    // flame colour of a wood fire: saturated orange (AgX mutes anything paler),
    // yellow-white where tongues overlap, red at the tips
    for (let i = this.rate(key + 'f', 30 * strength, dt); i > 0; i--) {
      const a = Math.random() * 6.283, r = Math.random() * 0.2 * strength;
      const h = 0.8 + Math.random() * 0.45;
      this.add.emit(x + Math.cos(a) * r, y + 0.05, z + Math.sin(a) * r, (Math.random() - 0.5) * 0.15, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.15, 0.5 + Math.random() * 0.4,
        0.44 * strength, 0.12, [2.4 * h, 0.52 * h, 0, 0.9], [1.5 * h, 0.12 * h, 0, 0], TILE.flame, { drag: 0.6, rot: (Math.random() - 0.5) * 0.4, spin: (Math.random() - 0.5) * 0.8 });
    }
    for (let i = this.rate(key + 'e', 4 * strength, dt); i > 0; i--) {
      this.add.emit(x + (Math.random() - 0.5) * 0.3, y + 0.2, z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6, 1.4 + Math.random() * 1.4, (Math.random() - 0.5) * 0.6, 1.2 + Math.random(),
        0.035, 0.015, [6, 2.6, 0.6, 1], [3, 0.6, 0.1, 0], TILE.dot, { drag: 0.8 });
    }
    this.smoke(key + 's', x, y + 0.7, z, dt, 3 * strength, 0.5);
  }
  smoke(key, x, y, z, dt, r = 3, grey = 0.45, size = 1) {
    for (let i = this.rate(key, r, dt); i > 0; i--) {
      const v = grey * (0.85 + Math.random() * 0.3);
      this.alpha.emit(x + (Math.random() - 0.5) * 0.2, y, z + (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, 0.55 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2, 5 + Math.random() * 3,
        0.35 * size, 2.6 * size, [v, v, v * 0.98, 0.32], [v * 1.1, v * 1.1, v * 1.1, 0], TILE.smoke, { drag: 0.35, spin: (Math.random() - 0.5) * 0.3 });
    }
  }
  flash(x, y, z) {
    this.add.emit(x, y, z, 0, 0, 0, 0.06, 0.55, 0.3, [30, 22, 10, 1], [20, 10, 3, 0], TILE.dot);
    this.add.emit(x, y, z, 0, 0, 0, 0.05, 0.3, 0.2, [40, 34, 22, 1], [30, 20, 10, 0], TILE.flame, { rot: Math.random() * 6.28 });
    for (let i = 0; i < 3; i++) this.alpha.emit(x, y, z, (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.6, 1.2, 0.12, 0.7, [0.55, 0.55, 0.55, 0.22], [0.6, 0.6, 0.6, 0], TILE.smoke, { drag: 1.2 });
    this.transient.push({ x, y, z, color: 0xffc070, intensity: 9, t: 0.07 });
  }
  dust(x, y, z, n = 4, color = [0.42, 0.37, 0.3], size = 0.35) {
    for (let i = 0; i < n; i++) this.alpha.emit(x + (Math.random() - 0.5) * 0.4, y + 0.05, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.9, 0.25 + Math.random() * 0.5, (Math.random() - 0.5) * 0.9, 1.3 + Math.random(),
      size * 0.5, size * 2.2, [...color, 0.3], [color[0] * 1.1, color[1] * 1.1, color[2] * 1.1, 0], TILE.smoke, { drag: 1.5 });
  }
  blood(x, y, z) {
    for (let i = 0; i < 7; i++) this.alpha.emit(x, y, z, (Math.random() - 0.5) * 1.6, Math.random() * 1.4, (Math.random() - 0.5) * 1.6, 0.5 + Math.random() * 0.3, 0.07, 0.04, [0.16, 0.02, 0.015, 0.9], [0.1, 0.01, 0.01, 0.5], TILE.dot, { grav: 7 });
  }
  sparks(x, y, z, n = 5) {
    for (let i = 0; i < n; i++) this.add.emit(x, y, z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3, 0.3 + Math.random() * 0.3, 0.03, 0.01, [8, 5, 2, 1], [4, 1, 0.2, 0], TILE.dot, { grav: 9 });
  }
  chips(x, y, z, n = 4) {
    for (let i = 0; i < n; i++) this.alpha.emit(x, y, z, (Math.random() - 0.5) * 2.2, 0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 2.2, 0.6 + Math.random() * 0.4, 0.05, 0.04, [0.42, 0.33, 0.22, 1], [0.38, 0.3, 0.2, 0.8], TILE.dot, { grav: 9, spin: 8 });
  }

  // ---------------------------------------------------------- tracers
  #tracers() {
    this.trPos = new Float32Array(64 * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.tracerMesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(6, 4.2, 2.2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracerMesh.frustumCulled = false;
    this.group.add(this.tracerMesh);
    this.tracers = [];
  }
  tracer(a, b) { if (this.tracers.length < 64) this.tracers.push({ a: a.clone(), b: b.clone(), t: 0.05 }); }

  // ---------------------------------------------------------- rain
  #rain() {
    const n = Math.round(4200 * Math.min(1.2, this.settings.values.grassDensity));
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
    const p = new Float32Array(n * 3);
    for (let i = 0; i < p.length; i++) p[i] = Math.random();
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(p, 3));
    g.instanceCount = n;
    this.rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(36, 22, 36) }, uWind: { value: new THREE.Vector2(0.8, 0.3) }, uAmount: { value: 0 }, uFogColor: G.uFogColor, uFogDensity: G.uFogDensity };
    const m = new THREE.ShaderMaterial({ vertexShader: RAIN_VS, fragmentShader: RAIN_FS, uniforms: this.rainU, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    this.rainMesh = new THREE.Mesh(g, m);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 10;
    this.group.add(this.rainMesh);
  }

  // ---------------------------------------------------------- lights
  #lights() {
    this.lightPool = [];
    this.transient = [];
    const n = this.settings.values.maxPointLights | 0;
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffa860, 0, 22, 2);
      l.castShadow = false;
      this.group.add(l);
      this.lightPool.push(l);
    }
  }

  /** sources: [{x,y,z,color,intensity,flicker,key}] for this frame. */
  updateLights(sources, focus, time) {
    const all = sources.concat(this.transient);
    for (const s of all) s.score = s.intensity / (1 + ((s.x - focus.x) ** 2 + (s.z - focus.z) ** 2) / 900);
    all.sort((a, b) => b.score - a.score);
    for (let i = 0; i < this.lightPool.length; i++) {
      const l = this.lightPool[i], s = all[i];
      if (!s || s.intensity <= 0) { l.intensity = 0; continue; }
      l.position.set(s.x, s.y, s.z);
      l.color.set(s.color);
      let k = 1;
      if (s.flicker) k = 0.82 + 0.1 * Math.sin(time * 11.3 + s.x) + 0.08 * Math.sin(time * 23.7 + s.z * 1.3);
      l.intensity = s.intensity * k;
      l.distance = s.range || 22;
    }
  }

  // ---------------------------------------------------------- felled trees
  /** Topple a felled tree instance away from the woodcutter. */
  fallTree(trees, it, awayX, awayZ) {
    const lods = trees.byKey.get(`${it.kind}:${it.vi}`);
    if (!lods) return;
    const grp = new THREE.Group();
    const meshes = lods[0].map((part, pi) => {
      const m = new THREE.InstancedMesh(part.geometry, part.material, 1);
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      m.customDepthMaterial = part.customDepthMaterial;
      m.setColorAt(0, pi === 0 ? new THREE.Color(1, 1, 1) : it.tint);
      grp.add(m);
      return m;
    });
    this.group.add(grp);
    const dir = Math.atan2(it.x - awayX, it.z - awayZ);
    this.falling.push({ grp, meshes, it, dir, t: 0, dur: 2.4 + it.s * 0.4 });
  }

  #updateFalling(dt) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      // accelerating topple, small bounce at the end, then it sinks away once cut up
      let ang = (Math.PI / 2 - 0.08) * k * k;
      if (k >= 1) ang = Math.PI / 2 - 0.08 + Math.max(0, 0.06 * Math.sin((f.t - f.dur) * 9) * Math.exp(-(f.t - f.dur) * 4));
      const sink = Math.max(0, f.t - f.dur - 16) * 0.35;
      const axis = new THREE.Vector3(Math.cos(f.dir), 0, -Math.sin(f.dir));
      q.setFromAxisAngle(axis, ang).multiply(q2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.it.rot));
      m.compose(p.set(f.it.x, f.it.y - sink, f.it.z), q, s.setScalar(f.it.s));
      for (const mesh of f.meshes) { mesh.setMatrixAt(0, m); mesh.instanceMatrix.needsUpdate = true; }
      if (sink > 3) { this.group.remove(f.grp); for (const mesh of f.meshes) mesh.dispose(); this.falling.splice(i, 1); }
    }
  }

  update(dt, camera, sky) {
    this.wind.set(G.uWind.value.x * G.uWind.value.z * 1.5, G.uWind.value.y * G.uWind.value.z * 1.5);
    // lit particles: sky (horizon radiance) plus a sphere-averaged share of the sun
    const F = G.uFogColor.value, L = G.uSunLight.value;
    this.shared.uLight.value.setRGB(F.r + L.r * 0.16, F.g + L.g * 0.16, F.b + L.b * 0.16);
    // emissive particles do not follow the night exposure boost (the eye adapts to
    // the fire, not to the moonlight around it), so flames keep their colour
    // instead of clipping to white
    if (sky) this.shared.uGain.value = Math.min(1.2, Math.max(0.12, 0.62 / sky.exposure));
    this.add.update(dt, this.wind);
    this.alpha.update(dt, this.wind);
    // tracers
    let n = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t -= dt;
      if (t.t <= 0) { this.tracers.splice(i, 1); continue; }
    }
    for (const t of this.tracers) { this.trPos.set([t.a.x, t.a.y, t.a.z, t.b.x, t.b.y, t.b.z], n * 6); n++; }
    this.tracerMesh.geometry.setDrawRange(0, n * 2);
    this.tracerMesh.geometry.attributes.position.needsUpdate = true;
    this.tracerMesh.visible = n > 0;
    for (let i = this.transient.length - 1; i >= 0; i--) { this.transient[i].t -= dt; if (this.transient[i].t <= 0) this.transient.splice(i, 1); }
    // rain
    const amt = sky ? sky.rain : 0;
    this.rainU.uAmount.value = amt;
    this.rainMesh.visible = amt > 0.02;
    this.rainU.uTime.value += dt;
    this.rainU.uCam.value.copy(camera.position);
    this.rainU.uWind.value.set(this.wind.x * 1.4, this.wind.y * 1.4);
    this.#updateFalling(dt);
  }
}
