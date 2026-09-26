// Renderer + restrained post-processing (MSAA or SMAA, subtle GTAO, gentle bloom, filmic tonemap).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { q, settings } from './settings.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;
  return renderer;
}

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.build();
  }

  build() {
    const Q = q();
    const r = this.renderer;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, Q.maxDpr) * settings.renderScale;
    r.setPixelRatio(this.pixelRatio);
    r.setSize(window.innerWidth, window.innerHeight, false);
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.msaa });
    this.composer?.dispose();
    this.composer = new EffectComposer(r, rt);
    this.composer.setPixelRatio(1);
    this.composer.setSize(size.x, size.y);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (Q.gtao) {
      const g = new GTAOPass(this.scene, this.camera, size.x, size.y);
      g.output = GTAOPass.OUTPUT.Default;
      g.blendIntensity = 0.55;
      g.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
      g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.gtao = g;
      this.composer.addPass(g);
    } else this.gtao = null;
    if (Q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.4, 2.2);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    if (Q.smaa) this.composer.addPass(new SMAAPass());
  }

  resize() {
    const Q = q();
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, Q.maxDpr) * settings.renderScale;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setSize(size.x, size.y);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    this.renderer.info.reset();
    this.composer.render(dt);
  }
}
