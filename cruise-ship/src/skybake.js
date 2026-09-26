import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { SKY_GLSL, CLOUD_GLSL, atmo } from './sky.js';

// Bakes the (expensive, sphere-traced) cloud layer for one lighting mood into a hemisphere texture,
// a few horizontal strips per frame so no single GPU submission is long. Two textures are kept so a
// mood change can bake in the background and then crossfade.
const FRAG = NOISE + SKY_GLSL + CLOUD_GLSL + /* glsl */`
uniform vec2 uRes;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float e = uv.y * uv.y * 1.5707963;
  float az = uv.x * 6.2831853;
  vec3 d = vec3(cos(az) * cos(e), sin(e), sin(az) * cos(e));
  vec4 cu = cumulus(d);
  vec4 ci = cirrus(d);
  float ciA = ci.a * uCloud;
  float T = (1.0 - ciA) * cu.a;
  vec3 C = ci.rgb * ciA * cu.a + cu.rgb;
  float dith = (hash12(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;
  gl_FragColor = vec4(sqrt(clamp(C * 0.25, 0.0, 1.0)) + dith, clamp(T + dith, 0.0, 1.0));
}`;

export function createSkyBaker(renderer, { width, height, cluster, noise3, tiles }) {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() }, uGlowPow: { value: 5 }, uCloud: { value: 0.3 },
    uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
    uNightAmt: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uSkyTime: { value: 40 }, uSunDisk: { value: 1 },
    tCloud: { value: cluster }, tNoise3: { value: noise3 },
    uCloudSun: { value: 1 }, uCloudTile: { value: 36000 }, uCloudP: { value: 0.3 }, uPA: { value: (2 * Math.PI) / width },
    uRes: { value: new THREE.Vector2(width, height) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FRAG,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.Camera();

  const makeRT = () => {
    const rt = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    renderer.initRenderTarget(rt);      // allocate the full mip chain now
    rt.texture.generateMipmaps = false; // regenerate only after the last strip
    return rt;
  };
  let front = makeRT(), back = null;
  atmo.tSkyA.value = front.texture;
  atmo.tSkyB.value = front.texture;
  atmo.uSkyMix.value = 0;

  let job = null;   // { rt, tile }
  let fading = 0;   // >0 while crossfading back -> front

  function setMood(m) {
    const u = uniforms;
    u.uSunDir.value.copy(m.sunDir); u.uSunCol.value.copy(m.sunCol);
    u.uZenith.value.copy(m.zenith); u.uHorizon.value.copy(m.horizon); u.uGround.value.copy(m.ground);
    u.uGlow.value.copy(m.glow); u.uGlowPow.value = m.glowPow; u.uCloud.value = m.cloud;
    u.uCloudLit.value.copy(m.cloudLit); u.uCloudShade.value.copy(m.cloudShade);
    u.uNightAmt.value = m.night; u.uMoonDir.value.copy(m.sunDir); u.uSunDisk.value = m.sunDisk;
    u.uCloudSun.value = m.cloudSun; u.uCloudP.value = m.cloud * 1.05;
  }

  function renderStrip(rt, i) {
    const y0 = Math.floor((height * i) / tiles), y1 = Math.floor((height * (i + 1)) / tiles);
    rt.scissor.set(0, y0, width, y1 - y0);
    rt.scissorTest = true;
    rt.texture.generateMipmaps = i === tiles - 1;
    const prevRT = renderer.getRenderTarget(), prevClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevRT);
    renderer.autoClear = prevClear;
    rt.texture.generateMipmaps = false;
    rt.scissorTest = false;
  }

  // Start baking mood `m`. initial=true bakes into the visible texture (used before the first frame).
  function start(m, initial = false) {
    setMood(m);
    if (initial) { job = { rt: front, tile: 0, initial: true }; return; }
    // settle any crossfade in progress so the new bake always goes to the hidden buffer
    if (fading > 0 && back) { [front, back] = [back, front]; }
    fading = 0;
    atmo.tSkyA.value = front.texture; atmo.tSkyB.value = front.texture; atmo.uSkyMix.value = 0;
    if (!back) back = makeRT();
    job = { rt: back, tile: 0, initial: false };
  }

  // Advance: bake up to n strips, then crossfade. Returns true while anything is still changing.
  function update(n, dt) {
    if (job) {
      for (let k = 0; k < n && job.tile < tiles; k++) renderStrip(job.rt, job.tile++);
      if (job.tile >= tiles) {
        if (!job.initial) { atmo.tSkyB.value = back.texture; fading = 1e-4; }
        job = null;
      }
      return true;
    }
    if (fading > 0) {
      fading = Math.min(1, fading + dt / 1.1);
      const e = fading * fading * (3 - 2 * fading);
      atmo.uSkyMix.value = e;
      if (fading >= 1) {
        [front, back] = [back, front];
        atmo.tSkyA.value = front.texture; atmo.tSkyB.value = front.texture; atmo.uSkyMix.value = 0;
        fading = 0;
      }
      return true;
    }
    return false;
  }

  // Synchronous bake (tests / instant mood set).
  function bakeNow(m) {
    start(m, true);
    while (job) update(tiles, 0);
    if (back) { atmo.tSkyA.value = front.texture; atmo.tSkyB.value = front.texture; atmo.uSkyMix.value = 0; fading = 0; }
  }

  return { start, update, bakeNow, get busy() { return !!job || fading > 0; }, get baking() { return !!job; } };
}
