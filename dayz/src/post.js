import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// HDR pipeline: scene -> (GTAO) -> filmic tone map + restrained grade -> AA.
// No bloom/DOF/motion blur: gameplay readability first.

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 0.94 }, uLift: { value: new THREE.Vector3(0.006, 0.007, 0.008) },
    uVignette: { value: 0.18 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uSat, uVignette; uniform vec3 uLift; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);             // slightly muted, overcast-Europe palette
      c.rgb = c.rgb + uLift * (1.0 - c.rgb);          // tiny cool lift in the blacks
      vec2 q = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * dot(q, q) * 1.6;     // subtle lens falloff
      gl_FragColor = c;
    }`,
};

export class Post {
  constructor(renderer, scene, camera, q, hideForAO) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.aa === 'msaa' ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    if (q.ao) {
      const ao = new GTAOPass(scene, camera, size.x, size.y, undefined, { radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
      ao.blendIntensity = 0.85;
      // GTAO renders its own normal/depth pass with an override material that ignores alpha
      // testing; cut-out foliage would become solid cards, so it is hidden for that pass.
      const orig = ao._renderOverride.bind(ao);
      ao._renderOverride = (...args) => { const r = hideForAO(true); orig(...args); hideForAO(false, r); };
      this.composer.addPass(ao);
      this.ao = ao;
    }
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GradeShader));
    if (q.aa === 'smaa') this.composer.addPass(new SMAAPass(size.x, size.y));
    else if (q.aa === 'fxaa') {
      const f = new ShaderPass(FXAAShader);
      f.material.uniforms.resolution.value.set(1 / size.x, 1 / size.y);
      this.fxaa = f;
      this.composer.addPass(f);
    }
  }
  setSize(w, h) {
    this.composer.setSize(w, h);
    if (this.fxaa) {
      const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.fxaa.material.uniforms.resolution.value.set(1 / s.x, 1 / s.y);
    }
  }
  render(dt) { this.composer.render(dt); }
  dispose() { this.composer.dispose(); }
}
