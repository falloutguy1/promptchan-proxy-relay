// Sky dome, HDR image-based lighting, sun + cascaded shadow maps, distance haze.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { q } from './settings.js';

// Sun position measured from the Poly Haven HDRI (kloofendal_48d_partly_cloudy_puresky):
// image u=0.595, v(top)=0.234 -> elevation ~48 deg.
const SUN_U = 0.595, SUN_V = 1 - 0.234;
export const SUN_DIR = (() => {
  const az = (SUN_U - 0.5) * Math.PI * 2;
  const el = (SUN_V - 0.5) * Math.PI;
  // match three.js equirect lookup: u = atan(z, x)/(2pi) + 0.5
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
})();

export const HAZE = new THREE.Color(0.40, 0.48, 0.61);
export const FOG_DENSITY = 0.000062;

export class Environment {
  constructor(renderer, scene, camera, assets) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.patched = new Set();

    scene.fog = new THREE.FogExp2(HAZE.clone(), FOG_DENSITY);

    // IBL
    if (assets.envHdr) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      this.envRT = pmrem.fromEquirectangular(assets.envHdr);
      scene.environment = this.envRT.texture;
      scene.environmentIntensity = 0.85;
      pmrem.dispose();
      assets.envHdr.dispose();
    }

    // Sky dome
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        tSky: { value: assets.skyBg || null },
        hasSky: { value: assets.skyBg ? 1 : 0 },
        scale: { value: 4.0 },
        sunDir: { value: SUN_DIR },
        haze: { value: HAZE },
        camY: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){
          vDir = normalize((modelMatrix * vec4(position,0.0)).xyz);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tSky; uniform float hasSky; uniform float scale; uniform vec3 sunDir; uniform vec3 haze; uniform float camY;
        varying vec3 vDir;
        #include <common>
        void main(){
          vec3 d = normalize(vDir);
          // horizon dips below 0 as we climb
          float dip = -sqrt(max(camY,1.0)*2.0/6371000.0);
          float el = asin(clamp(d.y,-1.0,1.0));
          vec2 uv = vec2(atan(d.z, d.x) * RECIPROCAL_PI2 + 0.5, 0.0);
          float v = (el / PI + 0.5);           // 1 at zenith
          float rows = 0.56;                    // stored fraction from top
          uv.y = 1.0 - (1.0 - v) / rows;
          uv.y = clamp(uv.y, 0.002, 0.998);
          vec3 sky = hasSky > 0.5 ? texture2D(tSky, uv).rgb * scale : mix(haze, vec3(0.18,0.3,0.6), clamp(d.y*2.0,0.0,1.0));
          // aerial haze towards (and below) the horizon, matches scene fog colour
          float h = smoothstep(0.075, dip - 0.03, el) * 0.92;
          sky = mix(sky, haze, h);
          // sun disc + glare (clamped in the texture)
          float cs = dot(d, sunDir);
          sky += vec3(1.0,0.95,0.85) * (smoothstep(0.99995, 0.99999, cs) * 60.0 + pow(max(cs,0.0), 900.0) * 3.0 + pow(max(cs,0.0),60.0)*0.25);
          gl_FragColor = vec4(sky, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    // Sun + cascaded shadows
    const Q = q();
    const lightDir = SUN_DIR.clone().negate();
    this.csm = new CSM({
      maxFar: 6000,
      cascades: Q.cascades,
      mode: 'practical',
      parent: scene,
      shadowMapSize: Q.shadowSize,
      lightDirection: lightDir,
      lightIntensity: 3.1,
      lightColor: new THREE.Color(1.0, 0.95, 0.86),
      camera,
      lightMargin: 400,
      lightNear: 1,
      lightFar: 12000,
      shadowBias: -0.00012,
    });
    this.csm.fade = true;
    for (const l of this.csm.lights) {
      l.shadow.normalBias = 0.6;
      l.shadow.radius = 2;
    }
    // near cascade needs a tighter bias
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // weak fill so deep shadows keep detail (sky already supplies most of it)
    this.hemi = new THREE.HemisphereLight(0x9fb7d8, 0x4a4a36, 0.15);
    scene.add(this.hemi);
  }

  // Register a material for CSM; `patch(shader)` is an optional extra onBeforeCompile.
  material(mat, patch, key) {
    this.csm.setupMaterial(mat);
    const csmHook = mat.onBeforeCompile;
    if (patch) {
      mat.onBeforeCompile = (s, r) => { csmHook.call(mat, s, r); patch(s, r); };
      mat.customProgramCacheKey = () => key || patch.toString().length + '';
    }
    return mat;
  }

  update(camera) {
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(camera.far * 0.95);
    this.sky.material.uniforms.camY.value = camera.position.y;
    this.csm.update();
  }
}
