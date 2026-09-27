// Renderer, post-processing chain and quality presets.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const PRESETS = {
  low:    { scale: 0.7,  shadows: false, shadowSize: 512,  maxShadowLights: 0, ao: false, bloom: false, msaa: 0, textures: '1k' },
  medium: { scale: 0.85, shadows: true,  shadowSize: 1024, maxShadowLights: 3, ao: false, bloom: true,  msaa: 0, textures: '2k' },
  high:   { scale: 1.0,  shadows: true,  shadowSize: 1024, maxShadowLights: 6, ao: true,  bloom: true,  msaa: 4, textures: '2k' },
  ultra:  { scale: 1.0,  shadows: true,  shadowSize: 2048, maxShadowLights: 9, ao: true,  bloom: true,  msaa: 4, textures: '2k' },
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
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.r.shadowMap.enabled = p.shadows;
    this.setScale(this.scale || p.scale);
  }

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
    }
  }

  render(t) {
    this.grade.uniforms.uTime.value = t % 100;
    this.composer.render();
  }
}
