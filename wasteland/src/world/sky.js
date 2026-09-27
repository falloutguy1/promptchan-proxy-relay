// Sky, sun/moon, time of day, weather and image-based lighting.
// Photographed Poly Haven skies (sun removed at build time, stored as sRGB + scale)
// are cross-faded through the day and yaw-aligned so their sun glow always sits
// where the directional light is. The same sky (without the analytic sun disc) is
// rendered into a cube map and PMREM-filtered for PBR ambient + reflections.
import * as THREE from 'three';
import { G } from '../core/shaderlib.js';
import { clamp, lerp, smoothstep } from '../core/rng.js';

// Keyframes: hour -> sky image + exposure gain (normalises the photos' absolute
// levels so the day reads consistently) + haze density multiplier.
const KEYS = [
  { t: 0.0, sky: 'night', gain: 0.085, haze: 0.9 },
  { t: 4.2, sky: 'night', gain: 0.085, haze: 1.1 },
  { t: 5.6, sky: 'dawn', gain: 0.45, haze: 2.4 },
  { t: 7.2, sky: 'dawn', gain: 0.62, haze: 1.8 },
  { t: 9.2, sky: 'day', gain: 1.0, haze: 1.0 },
  { t: 16.4, sky: 'day', gain: 1.0, haze: 1.0 },
  { t: 18.4, sky: 'dusk', gain: 0.42, haze: 1.3 },
  { t: 19.8, sky: 'dusk', gain: 0.24, haze: 1.4 },
  { t: 21.2, sky: 'night', gain: 0.085, haze: 0.9 },
  { t: 24.0, sky: 'night', gain: 0.085, haze: 0.9 },
];
const SKY_NAMES = ['dawn', 'day', 'dusk', 'night', 'overcast'];
const SUNRISE = 5.35, SUNSET = 19.65, MAX_ELEV = 52 * Math.PI / 180;

// approximate atmospheric transmittance for the sun colour / intensity
function airmass(el) {
  const deg = Math.max(el * 180 / Math.PI, -1.5);
  return 1 / (Math.sin(Math.max(el, -0.02) + 1e-3) + 0.50572 * Math.pow(deg + 6.07995, -1.6364));
}
const TAU = [0.10, 0.19, 0.38];
function sunTransmittance(el, out) {
  const m = airmass(el);
  out.setRGB(Math.exp(-TAU[0] * m), Math.exp(-TAU[1] * m), Math.exp(-TAU[2] * m));
  return out;
}

const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
	vDir = normalize( position );
	vec4 p = projectionMatrix * vec4( ( viewMatrix * vec4( position, 0.0 ) ).xyz, 1.0 );
	gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform sampler2D tSkyA;
uniform sampler2D tSkyB;
uniform sampler2D tSkyC;
uniform vec3 uGainA; // x = scale*gain, y = yaw, z = unused
uniform vec3 uGainB;
uniform vec3 uGainC;
uniform float uMixAB;
uniform float uMixC;
uniform vec3 uSunDir;
uniform vec3 uSunRadiance;
uniform float uSunSize;
uniform float uShowSun;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uHorizonHaze;
uniform vec3 uGroundColor;
#define PI 3.141592653589793
vec3 sampleSky( sampler2D t, vec3 d, vec3 g ) {
	float c = cos( g.y ), s = sin( g.y );
	vec3 r = vec3( c * d.x + s * d.z, d.y, - s * d.x + c * d.z );
	vec2 uv = vec2( atan( r.z, r.x ) * ( 0.5 / PI ) + 0.5, asin( clamp( r.y, - 1.0, 1.0 ) ) / PI + 0.5 );
	return texture2D( t, uv ).rgb * g.x;
}
void main() {
	vec3 d = normalize( vDir );
	vec3 col = mix( sampleSky( tSkyA, d, uGainA ), sampleSky( tSkyB, d, uGainB ), uMixAB );
	if ( uMixC > 0.001 ) col = mix( col, sampleSky( tSkyC, d, uGainC ), uMixC );
	// aerial haze toward the horizon matches the scene fog so distant land melts in
	float s = max( dot( d, uSunDir ), 0.0 );
	vec3 fc = mix( uFogColor, uFogSunColor, s * s * s * s * s * s );
	float hz = exp( - max( d.y, 0.0 ) * 9.0 ) * uHorizonHaze;
	col = mix( col, fc, clamp( hz, 0.0, 1.0 ) );
	if ( d.y < 0.0 ) col = mix( col, uGroundColor, smoothstep( 0.0, - 0.08, d.y ) );
	if ( uShowSun > 0.5 ) {
		float cosA = dot( d, uSunDir );
		float disc = smoothstep( cos( uSunSize ), cos( uSunSize * 0.85 ), cosA );
		float mu = clamp( ( cosA - cos( uSunSize ) ) / ( 1.0 - cos( uSunSize ) ), 0.0, 1.0 );
		float limb = 0.55 + 0.45 * sqrt( mu );
		col += uSunRadiance * disc * limb * ( 1.0 - uMixC * 0.9 );
	}
	gl_FragColor = vec4( col, 1.0 );
}`;

export class Sky {
  constructor(renderer, scene, assets, settings) {
    this.renderer = renderer;
    this.scene = scene;
    this.assets = assets;
    this.settings = settings;
    this.time = 9.0;          // hours
    this.day = 1;
    this.cloudiness = 0;      // 0 clear .. 1 overcast
    this.rain = 0;            // 0..1
    this.fogBoost = 0;        // 0..1 extra ground fog (weather)
    this.weather = 'clear';
    this.weatherTarget = { cloudiness: 0, rain: 0, fog: 0 };
    this.envDirty = true;
    this.lastEnvKey = '';
    this.lastEnvTime = -1e9;
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
    this.lightColor = new THREE.Color();
    this.exposure = 1;
    this.isNight = false;
  }

  async load() {
    const tier = this.assets.tier;
    this.meta = await this.assets.json('sky/skies.json');
    this.tex = {};
    await Promise.all(SKY_NAMES.map(async (n) => {
      try {
        const t = await this.assets.image(`sky/${n}_${tier}.jpg`);
        t.colorSpace = THREE.SRGBColorSpace;
        t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
        t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
        this.tex[n] = t;
      } catch (e) {
        this.assets.fail(`sky ${n}`, e);
        const d = new THREE.DataTexture(new Uint8Array([150, 160, 170, 255]), 1, 1); d.needsUpdate = true;
        this.tex[n] = d;
      }
    }));

    this.uniforms = {
      tSkyA: { value: this.tex.day }, tSkyB: { value: this.tex.day }, tSkyC: { value: this.tex.overcast },
      uGainA: { value: new THREE.Vector3(1, 0, 0) }, uGainB: { value: new THREE.Vector3(1, 0, 0) }, uGainC: { value: new THREE.Vector3(1, 0, 0) },
      uMixAB: { value: 0 }, uMixC: { value: 0 },
      uSunDir: G.uSunDir, uSunRadiance: { value: new THREE.Color() }, uSunSize: { value: 0.0085 }, uShowSun: { value: 1 },
      uFogColor: G.uFogColor, uFogSunColor: G.uFogSunColor, uHorizonHaze: { value: 0.35 },
      uGroundColor: { value: new THREE.Color(0.05, 0.05, 0.04) },
    };
    const geo = new THREE.SphereGeometry(1, 64, 32);
    this.material = new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: true });
    this.dome = new THREE.Mesh(geo, this.material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.name = 'sky';
    this.scene.add(this.dome);

    // environment capture: same sky without the sun disc
    const envUniforms = { ...this.uniforms, uShowSun: { value: 0 } };
    this.envMaterial = new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: envUniforms, side: THREE.BackSide, depthWrite: false });
    this.envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(geo, this.envMaterial);
    envDome.frustumCulled = false;
    this.envScene.add(envDome);
    const envRes = this.settings.values.envRes || 256;
    this.cubeRT = new THREE.WebGLCubeRenderTarget(envRes, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(0.1, 10, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmremRT = null;

    // sun + moon light
    this.light = new THREE.DirectionalLight(0xffffff, 3);
    this.light.name = 'sun';
    this.light.castShadow = true;
    const ss = this.settings.values.shadowSize;
    this.light.shadow.mapSize.set(ss, ss);
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.035;
    this.light.shadow.radius = this.settings.values.shadowRadius;
    this.light.shadow.camera.near = 1;
    this.light.shadow.camera.far = 900;
    this.scene.add(this.light);
    this.scene.add(this.light.target);
    this.update(0, new THREE.Vector3(), 60, true);
  }

  // --- time / weather control
  setTime(h) { this.time = ((h % 24) + 24) % 24; this.envDirty = true; }
  setWeather(kind, instant = false) {
    this.weather = kind;
    const t = { clear: { cloudiness: 0, rain: 0, fog: 0 }, cloudy: { cloudiness: 0.65, rain: 0, fog: 0.1 }, rain: { cloudiness: 1, rain: 1, fog: 0.35 }, fog: { cloudiness: 0.45, rain: 0, fog: 1 } }[kind] || { cloudiness: 0, rain: 0, fog: 0 };
    this.weatherTarget = t;
    if (instant) { this.cloudiness = t.cloudiness; this.rain = t.rain; this.fogBoost = t.fog; this.envDirty = true; }
  }

  #keys(t) {
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    return { a, b, f: f * f * (3 - 2 * f) };
  }

  sunDirection(t, out) {
    // daytime arc: east (az 90) at sunrise -> south -> west at sunset; night: moon arc
    let az, el;
    if (t >= SUNRISE - 0.6 && t <= SUNSET + 0.6) {
      const p = (t - SUNRISE) / (SUNSET - SUNRISE);
      az = lerp(75, 285, p) * Math.PI / 180;
      el = Math.sin(clamp(p, -0.06, 1.06) * Math.PI) * MAX_ELEV;
      this.isNight = false;
    } else {
      const nt = t > 12 ? t - SUNSET : t + 24 - SUNSET; // hours since sunset
      const p = nt / (24 - (SUNSET - SUNRISE));
      az = lerp(110, 250, p) * Math.PI / 180;
      el = (18 + 22 * Math.sin(clamp(p, 0, 1) * Math.PI)) * Math.PI / 180;
      this.isNight = true;
    }
    return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  }

  #yawFor(name, dir) {
    // rotate the photo so its measured sun azimuth matches the current one
    const m = this.meta[name];
    if (!m) return 0;
    const imgAz = Math.atan2(m.sun.dir[2], m.sun.dir[0]);
    const curAz = Math.atan2(dir.z, dir.x);
    return curAz - imgAz; // shader looks up angle (theta - yaw), so the glow lands at curAz
  }

  update(dt, focus, viewDist, force = false) {
    // weather easing (minutes of game time -> seconds real time handled by caller dt)
    const k = 1 - Math.exp(-dt * 0.08);
    this.cloudiness = lerp(this.cloudiness, this.weatherTarget.cloudiness, k);
    this.rain = lerp(this.rain, this.weatherTarget.rain, k);
    this.fogBoost = lerp(this.fogBoost, this.weatherTarget.fog, k);
    G.uWetness.value = lerp(G.uWetness.value, this.rain > 0.3 ? 1 : 0, 1 - Math.exp(-dt * (this.rain > 0.3 ? 0.05 : 0.012)));

    const t = this.time;
    const { a, b, f } = this.#keys(t);
    const dir = this.sunDirection(t, this.sunDir);
    const u = this.uniforms;
    const mA = this.meta[a.sky], mB = this.meta[b.sky], mC = this.meta.overcast;
    u.tSkyA.value = this.tex[a.sky]; u.tSkyB.value = this.tex[b.sky];
    const lightDir = dir.clone();
    u.uGainA.value.set(mA.scale * a.gain, this.#yawFor(a.sky, lightDir), 0);
    u.uGainB.value.set(mB.scale * b.gain, this.#yawFor(b.sky, lightDir), 0);
    u.uMixAB.value = f;
    const gain = lerp(a.gain, b.gain, f);
    const overcastGain = gain * 0.62;
    u.uGainC.value.set(mC.scale * overcastGain, 0.4, 0);
    u.uMixC.value = this.cloudiness;
    G.uSunDir.value.copy(dir);

    // direct light: sun or moon
    const cloudDim = 1 - 0.88 * this.cloudiness;
    let illum, color = this.lightColor;
    if (!this.isNight) {
      sunTransmittance(dir.y > 0 ? Math.asin(dir.y) : -0.02, color);
      const ref = sunTransmittance(43 * Math.PI / 180, _c2);
      const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      illum = this.meta.day.sun.illuminance * lum(color) / lum(ref);
      color.multiplyScalar(1 / Math.max(color.r, color.g, color.b));
      const horizonFade = smoothstep(-0.03, 0.06, dir.y);
      illum *= horizonFade;
    } else {
      color.setRGB(0.62, 0.72, 1.0);
      illum = this.meta.night.sun.illuminance * 0.085 * 0.55;
    }
    illum *= cloudDim;
    this.light.color.copy(color);
    this.light.intensity = illum;
    G.uSunLight.value.copy(color).multiplyScalar(illum);
    this.light.shadow.radius = this.settings.values.shadowRadius * (1 + this.cloudiness * 3);
    u.uSunRadiance.value.copy(color).multiplyScalar(this.isNight ? 0 : Math.min(illum, 6) * 55);

    // fog / haze colours from the photos' measured horizon radiance
    const hA = mA.horizon, hB = mB.horizon, hC = mC.horizon;
    const hz = new THREE.Color(lerp(hA[0] * a.gain, hB[0] * b.gain, f), lerp(hA[1] * a.gain, hB[1] * b.gain, f), lerp(hA[2] * a.gain, hB[2] * b.gain, f));
    const hzC = new THREE.Color(hC[0], hC[1], hC[2]).multiplyScalar(overcastGain);
    hz.lerp(hzC, this.cloudiness);
    G.uFogColor.value.copy(hz).multiplyScalar(0.92);
    G.uFogSunColor.value.copy(hz).multiplyScalar(1.35).lerp(_c3.copy(color).multiplyScalar(hz.r * 1.6 + 0.02), this.isNight ? 0 : 0.35 * (1 - this.cloudiness));
    const haze = lerp(a.haze, b.haze, f);
    G.uFogDensity.value = 0.00055 * haze * (1 + this.cloudiness * 0.8 + this.rain * 2.0) + 0.006 * this.fogBoost;
    G.uFogFalloff.value = 0.018 + 0.03 * this.fogBoost;
    G.uFogHeight.value = focus.y - 4;
    u.uHorizonHaze.value = 0.3 + 0.3 * this.cloudiness + 0.4 * this.fogBoost;
    const gr = (mA.ground[0] * a.gain * (1 - f) + mB.ground[0] * b.gain * f);
    u.uGroundColor.value.setRGB(gr, gr * 1.02, gr * 0.8);

    // exposure: partial "eye adaptation" so nights are dark but playable
    const skyLevel = gain * (1 - this.cloudiness * 0.35);
    this.exposure = clamp(0.62 / Math.pow(Math.max(skyLevel, 0.01), 0.72), 0.55, 4.6);

    // shadow frustum fitted to the view, snapped to texels to avoid shimmering
    const half = clamp(viewDist * 0.75 + 18, 24, this.settings.values.shadowDistance);
    const cam = this.light.shadow.camera;
    if (cam.right !== half) { cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix(); }
    const texel = (2 * half) / this.light.shadow.mapSize.x;
    _m.lookAt(_o.set(0, 0, 0), _v.copy(dir).negate(), _up.set(0, 1, 0));
    _q.setFromRotationMatrix(_m);
    const ls = _v2.copy(focus).applyQuaternion(_q.clone().invert());
    ls.x = Math.round(ls.x / texel) * texel; ls.y = Math.round(ls.y / texel) * texel;
    const snapped = ls.applyQuaternion(_q);
    this.light.target.position.copy(snapped);
    this.light.position.copy(snapped).addScaledVector(dir, 420);
    this.light.target.updateMatrixWorld();

    // refresh image-based lighting when the sky changed noticeably
    const envKey = `${a.sky}${b.sky}${(f * 40) | 0}${(this.cloudiness * 20) | 0}${(dir.x * 20) | 0}${(dir.z * 20) | 0}`;
    const now = performance.now();
    if (force || this.envDirty || (envKey !== this.lastEnvKey && now - this.lastEnvTime > 700)) {
      this.#renderEnv();
      this.lastEnvKey = envKey; this.lastEnvTime = now; this.envDirty = false;
    }
  }

  #renderEnv() {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevTone = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    this.cubeCam.update(r, this.envScene);
    this.pmremRT = this.pmrem.fromCubemap(this.cubeRT.texture, this.pmremRT);
    r.toneMapping = prevTone;
    r.setRenderTarget(prevTarget);
    this.scene.environment = this.pmremRT.texture;
    this.scene.environmentIntensity = 1.0;
  }

  get hourString() {
    const h = Math.floor(this.time), m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

const _c2 = new THREE.Color(), _c3 = new THREE.Color();
const _m = new THREE.Matrix4(), _o = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(), _q = new THREE.Quaternion();
