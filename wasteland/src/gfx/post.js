// Post-processing chain (pmndrs/postprocessing + N8AO):
// HDR scene -> ambient occlusion -> restrained bloom -> AgX filmic tone mapping
// -> gentle colour grade + vignette -> SMAA/FXAA. MSAA on Ultra.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  SMAAEffect, SMAAPreset, FXAAEffect, Effect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

const gradeFrag = /* glsl */`
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
	vec3 c = inputColor.rgb;
	float l = luma( c );
	c = mix( vec3( l ), c, uSaturation );
	// split toning: cool-green shadows, warm highlights (very light touch)
	float sh = 1.0 - smoothstep( 0.0, 0.45, l );
	float hi = smoothstep( 0.45, 1.0, l );
	c += uShadowTint * sh + uHighTint * hi;
	// soft S-curve around mid grey
	c = mix( c, c * c * ( 3.0 - 2.0 * c ), uContrast );
	// vignette
	vec2 d = uv - 0.5;
	c *= 1.0 - uVignette * smoothstep( 0.18, 0.75, dot( d, d ) * 1.6 );
	// fine film grain to hide banding in dark skies
	float n = fract( sin( dot( uv * 1731.0 + uTime, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	c += ( n - 0.5 ) * uGrain;
	outputColor = vec4( clamp( c, 0.0, 1.0 ), inputColor.a );
}`;

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFrag, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uSaturation', new THREE.Uniform(0.9)],
        ['uContrast', new THREE.Uniform(0.12)],
        ['uShadowTint', new THREE.Uniform(new THREE.Vector3(-0.006, 0.004, 0.008))],
        ['uHighTint', new THREE.Uniform(new THREE.Vector3(0.012, 0.006, -0.01))],
        ['uVignette', new THREE.Uniform(0.28)],
        ['uGrain', new THREE.Uniform(0.012)],
        ['uTime', new THREE.Uniform(0)],
      ]),
    });
  }
}

export class Post {
  constructor(renderer, scene, camera, settings) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.settings = settings;
    this.build();
  }

  build() {
    const v = this.settings.values;
    if (this.composer) this.composer.dispose();
    const msaa = v.aa === 'msaa' && this.renderer.capabilities.isWebGL2 ? 4 : 0;
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: msaa });
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.ao = null;
    if (v.ao !== 'off') {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const ao = new N8AOPostPass(this.scene, this.camera, size.x, size.y);
      Object.assign(ao.configuration, {
        aoRadius: 1.6, distanceFalloff: 0.8, intensity: 2.2, aoSamples: v.ao === 'full' ? 16 : 8,
        denoiseSamples: v.ao === 'full' ? 8 : 4, denoiseRadius: 10, halfRes: v.ao !== 'full',
        gammaCorrection: false, color: new THREE.Color(0, 0, 0),
      });
      this.ao = ao;
      this.composer.addPass(ao);
    }

    this.bloom = v.bloom ? new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.25, luminanceSmoothing: 0.35, intensity: 0.32, radius: 0.72 }) : null;
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    const fx = [this.bloom, this.tone, this.grade].filter(Boolean);
    this.mainPass = new EffectPass(this.camera, ...fx);
    this.composer.addPass(this.mainPass);
    if (v.aa === 'smaa') this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
    else if (v.aa === 'fxaa') this.composer.addPass(new EffectPass(this.camera, new FXAAEffect()));
    const s = this.renderer.getSize(new THREE.Vector2());
    this.composer.setSize(s.x, s.y);
  }

  setCamera(camera) {
    this.camera = camera;
    this.renderPass.mainCamera = camera;
    for (const p of this.composer.passes) if ('mainCamera' in p) p.mainCamera = camera;
    if (this.ao) this.ao.camera = camera;
  }

  setSize(w, h) { this.composer.setSize(w, h); }

  render(dt, exposure, time) {
    this.renderer.toneMappingExposure = exposure; // used by ToneMappingEffect
    this.grade.uniforms.get('uTime').value = time % 100;
    this.composer.render(dt);
  }
}
