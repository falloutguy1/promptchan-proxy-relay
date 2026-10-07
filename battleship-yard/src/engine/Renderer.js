import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

export const LAYER_NO_AO = 2; // water, foliage cards, particles: excluded from the AO normal/depth pass

export const PRESETS = {
  low: { label: 'Low', scale: 0.75, maxDPR: 1, shadow: 1024, ao: false, bloom: false, msaa: 0, fxaa: true, reflection: false, grassRadius: 28, grassDensity: 0.45, treeLod: [70, 220], treeMax: 1100, water: 96, shadowDist: 0.7 },
  medium: { label: 'Medium', scale: 0.9, maxDPR: 1.5, shadow: 2048, ao: false, bloom: true, msaa: 2, fxaa: false, reflection: false, grassRadius: 42, grassDensity: 0.7, treeLod: [110, 320], treeMax: 1700, water: 160, shadowDist: 0.85 },
  high: { label: 'High', scale: 1.0, maxDPR: 2, shadow: 4096, ao: true, bloom: true, msaa: 4, fxaa: false, reflection: true, grassRadius: 60, grassDensity: 1.0, treeLod: [150, 450], treeMax: 2400, water: 220, shadowDist: 1 },
  ultra: { label: 'Ultra', scale: 1.0, maxDPR: 2.5, shadow: 4096, ao: true, bloom: true, msaa: 4, fxaa: false, reflection: true, grassRadius: 80, grassDensity: 1.3, treeLod: [200, 600], treeMax: 3000, water: 300, shadowDist: 1.2 },
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 0.96 }, uContrast: { value: 1.03 }, uVignette: { value: 0.22 }, uTint: { value: new THREE.Vector3(1.0, 0.995, 0.985) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      c.rgb *= uTint;
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - uVignette * dot(d, d) * 1.6;
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.info.autoReset = false;
    this.quality = null;
    this.renderScale = 1;
    this.aoCamera = new THREE.PerspectiveCamera();
    this.aoCamera.layers.disableAll();
    this.aoCamera.layers.enable(0);
  }

  setup(scene, camera, preset) {
    this.scene = scene;
    this.camera = camera;
    this.applyQuality(preset);
  }

  applyQuality(preset, renderScale) {
    const q = PRESETS[preset] ? { ...PRESETS[preset], key: preset } : { ...PRESETS.medium, key: 'medium' };
    this.quality = q;
    if (renderScale) q.scale = renderScale;
    this.renderScale = q.scale;
    this.buildComposer();
    this.resize();
    return q;
  }

  buildComposer() {
    const q = this.quality, r = this.renderer;
    this.composer?.dispose();
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q.msaa });
    const composer = new EffectComposer(r, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = null;
    if (q.ao) {
      this.gtao = new GTAOPass(this.scene, this.aoCamera, 1, 1);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      composer.addPass(this.gtao);
    }
    this.bloom = null;
    if (q.bloom) {
      // restrained: only sun glints and muzzle flashes exceed the threshold
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.18, 0.4, 2.2);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    if (q.fxaa) composer.addPass(new FXAAPass());
    this.composer = composer;
  }

  resize() {
    const r = this.renderer, c = r.domElement;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxDPR) * this.renderScale;
    r.setPixelRatio(dpr);
    r.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    if (this.gtao) {
      this.aoCamera.copy(this.camera, false);
      this.aoCamera.layers.disableAll();
      this.aoCamera.layers.enable(0);
    }
    this.renderer.info.reset();
    this.composer.render(dt);
  }
}
