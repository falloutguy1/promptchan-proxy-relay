// Renderer, post-processing chain and quality presets.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const PRESETS = {
  low:    { scale: 0.7,  shadows: false, shadowSize: 512,  maxShadowLights: 0, ao: false, bloom: false, msaa: 0, textures: '1k', paint: 2 },
  medium: { scale: 0.85, shadows: true,  shadowSize: 1024, maxShadowLights: 3, ao: false, bloom: true,  msaa: 0, textures: '2k', paint: 3 },
  high:   { scale: 1.0,  shadows: true,  shadowSize: 1024, maxShadowLights: 6, ao: true,  bloom: true,  msaa: 4, textures: '2k', paint: 4 },
  ultra:  { scale: 1.0,  shadows: true,  shadowSize: 2048, maxShadowLights: 9, ao: true,  bloom: true,  msaa: 4, textures: '2k', paint: 4 },
};

// Painterly look in the spirit of post-war concept paintings: a generalised Kuwahara filter flattens detail into
// brush-like patches (sample offsets wobble with low-frequency noise so strokes are irregular), a canvas tooth is
// pressed into the paint, and the grade pushes shadows toward a dusty teal and lit surfaces toward rust and cream.
const PaintShader = {
  uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uStrength: { value: 1 } },
  defines: { RADIUS: 4 },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uStrength; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
    void main(){
      vec2 px = 1.0 / uRes;
      // stroke direction wobble
      float a = vnoise(vUv * uRes / 90.0) * 6.2831;
      mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
      vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
      vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
      const float n = float((RADIUS + 1) * (RADIUS + 1));
      for (int j = 0; j <= RADIUS; j++) {
        for (int i = 0; i <= RADIUS; i++) {
          vec2 o = rot * vec2(float(i), float(j)) * px;
          vec3 c;
          c = texture2D(tDiffuse, vUv + vec2(-o.x, -o.y)).rgb; m0 += c; s0 += c * c;
          c = texture2D(tDiffuse, vUv + vec2( o.x, -o.y)).rgb; m1 += c; s1 += c * c;
          c = texture2D(tDiffuse, vUv + vec2( o.x,  o.y)).rgb; m2 += c; s2 += c * c;
          c = texture2D(tDiffuse, vUv + vec2(-o.x,  o.y)).rgb; m3 += c; s3 += c * c;
        }
      }
      m0 /= n; m1 /= n; m2 /= n; m3 /= n;
      vec3 v0 = abs(s0 / n - m0 * m0), v1 = abs(s1 / n - m1 * m1), v2 = abs(s2 / n - m2 * m2), v3 = abs(s3 / n - m3 * m3);
      float e0 = v0.r + v0.g + v0.b, e1 = v1.r + v1.g + v1.b, e2 = v2.r + v2.g + v2.b, e3 = v3.r + v3.g + v3.b;
      vec3 best = m0; float minV = e0;
      if (e1 < minV) { minV = e1; best = m1; }
      if (e2 < minV) { minV = e2; best = m2; }
      if (e3 < minV) { minV = e3; best = m3; }
      vec3 orig = texture2D(tDiffuse, vUv).rgb;
      vec3 c = mix(orig, best, uStrength);
      // canvas tooth: fine cross-weave plus blotchy pigment density
      vec2 q = vUv * uRes;
      float weave = (sin(q.x * 1.9) * sin(q.y * 1.9)) * 0.5 + 0.5;
      float blot = vnoise(q / 22.0) * 0.6 + vnoise(q / 7.0) * 0.4;
      c *= 1.0 + ((weave - 0.5) * 0.035 + (blot - 0.5) * 0.07) * uStrength;
      // concept-art grade: lifted, dusty teal shadows; rust-warm mids; cream highlights
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.19, 0.27, 0.30);
      vec3 hiTint = vec3(1.05, 0.98, 0.88);
      c = mix(c, c * 0.55 + shadowTint * 0.45 * (0.35 + l), (1.0 - smoothstep(0.0, 0.42, l)) * 0.72 * uStrength);
      c = mix(c, c * hiTint, smoothstep(0.35, 0.9, l) * uStrength);
      // warm hues (rust) keep their chroma, everything else is gently muted
      float warm = smoothstep(0.02, 0.15, c.r - c.b);
      c = mix(vec3(l), c, mix(0.78, 1.08, warm) * uStrength + (1.0 - uStrength));
      c = c * (1.0 - 0.06 * uStrength) + 0.025 * uStrength;   // matte black point like pigment on board
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// Restrained grade: slight warm/cool split, gentle vignette and film grain (no chromatic tricks).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uHurt; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      // shadows lean slightly cool, highlights slightly warm
      c.rgb = mix(c.rgb * vec3(0.96,1.0,1.05), c.rgb * vec3(1.04,1.0,0.95), smoothstep(0.05,0.6,l));
      c.rgb = mix(vec3(l), c.rgb, 0.92);                  // restrained saturation
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.25, length(d * vec2(1.1, 1.0)));
      c.rgb *= mix(0.72, 1.0, v);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.4,0.5,0.45), uHurt * (1.0 - v) );
      c.rgb += (h(vUv * 1024.0 + uTime) - 0.5) * 0.018;   // fine grain, dithers banding in dark gradients
      gl_FragColor = c;
    }`,
};

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.r = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 2.4;   // eye adapted to a dim underground space
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.r.shadowMap.autoUpdate = true;
    this.scale = 1;
    this.preset = PRESETS.high;
  }

  setup(scene, camera, quality) {
    this.scene = scene; this.camera = camera;
    this.preset = PRESETS[quality] || PRESETS.high;
    const p = this.preset;
    this.rt?.dispose();
    this.composer?.dispose();
    const size = this.r.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: p.msaa });
    this.composer = new EffectComposer(this.r, this.rt);
    this.composer.addPass(new RenderPass(scene, camera));
    if (p.ao) {
      this.ao = new GTAOPass(scene, camera, size.x, size.y);
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.85;
      this.ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(this.ao);
    } else this.ao = null;
    if (p.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.5, 0.92);
      this.composer.addPass(this.bloom);
    } else this.bloom = null;
    this.composer.addPass(new OutputPass());
    this.paint = new ShaderPass(PaintShader);
    this.paint.material.defines.RADIUS = p.paint;
    this.paint.enabled = this.painterly !== false;
    this.composer.addPass(this.paint);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.r.shadowMap.enabled = p.shadows;
    this.setScale(this.scale || p.scale);
  }

  setPainterly(on) { this.painterly = on; if (this.paint) this.paint.enabled = on; }

  setScale(s) {
    this.scale = s;
    this.r.setPixelRatio(Math.min(window.devicePixelRatio, 2) * s);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.r.getPixelRatio());
      this.composer.setSize(w, h);
      this.paint?.uniforms.uRes.value.set(w * this.r.getPixelRatio(), h * this.r.getPixelRatio());
    }
  }

  render(t) {
    this.grade.uniforms.uTime.value = t % 100;
    this.composer.render();
  }
}
