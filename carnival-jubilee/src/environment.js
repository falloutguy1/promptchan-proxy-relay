import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import * as TX from './textures.js';
import { halfW, sternX, tipX } from './ship.js';
import { rng, isMobile, smooth } from './util.js';

export const PRESETS = {
  day: {
    elev: 34, azim: 205, turbidity: 2.6, rayleigh: 1.1, mie: 0.004, mieG: 0.82, clouds: 0.38,
    sun: 0xfff1de, sunI: 3.4, hemiSky: 0xbcd8ff, hemiGround: 0x2a4b66, hemiI: 0.65, exposure: 0.5,
    fog: 0xaec7dc, fogD: 0.00011, water: 0x00304a, night: 0, stars: 0, envI: 1.0,
  },
  sunset: {
    elev: 2.2, azim: 262, turbidity: 10, rayleigh: 3, mie: 0.005, mieG: 0.7, clouds: 0.45,
    sun: 0xffa060, sunI: 2.6, hemiSky: 0xffb690, hemiGround: 0x2a2440, hemiI: 0.5, exposure: 0.42,
    fog: 0xd49a7c, fogD: 0.00014, water: 0x0e2233, night: 0.55, stars: 0.05, envI: 1.0,
  },
  night: {
    elev: -4.5, azim: 150, turbidity: 2, rayleigh: 2, mie: 0.003, mieG: 0.7, clouds: 0.15,
    sun: 0xa8c4ff, sunI: 1.3, hemiSky: 0x4a64a0, hemiGround: 0x0c1020, hemiI: 1.7, exposure: 1.0,
    fog: 0x0b1628, fogD: 0.00014, water: 0x030a16, night: 1, stars: 1, envI: 1.1,
  },
};

export function buildEnvironment(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const sky = new Sky();
  sky.scale.setScalar(45000);
  scene.add(sky);

  const sunDir = new THREE.Vector3();
  const lightDirV = new THREE.Vector3(0, 1, 0);
  const shadowCenter = new THREE.Vector3();
  const sunLight = new THREE.DirectionalLight(0xffffff, 3);
  sunLight.castShadow = true;
  const sm = isMobile ? 2048 : 4096;
  sunLight.shadow.mapSize.set(sm, sm);
  sunLight.shadow.bias = -0.00025;
  sunLight.shadow.normalBias = 0.04;
  scene.add(sunLight, sunLight.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.6);
  scene.add(hemi);

  // ocean
  const waterNormals = TX.waterNormals();
  const water = new Water(new THREE.PlaneGeometry(60000, 60000), {
    textureWidth: isMobile ? 512 : 1024, textureHeight: isMobile ? 512 : 1024,
    waterNormals, sunDirection: new THREE.Vector3(), sunColor: 0xffffff, waterColor: 0x00304a,
    distortionScale: 14, fog: true,
  });
  // soften the mirror: real swell breaks and dims the reflection
  water.material.fragmentShader = water.material.fragmentShader.replace('reflectionSample + specularLight', 'reflectionSample * 0.62 + specularLight');
  water.rotation.x = -Math.PI / 2;
  water.material.uniforms.size.value = 0.55;
  water.receiveShadow = false;
  scene.add(water);

  // foam collar along the hull & wake
  const foam = TX.foamTexture();
  const foamMat = new THREE.MeshBasicMaterial({ map: foam, transparent: true, vertexColors: true, depthWrite: false, opacity: 0.9, fog: true });
  const foamGroup = new THREE.Group();
  {
    const pos = [], col = [], uv = [], idx = [];
    const N = 180;
    let row = 0;
    for (const s of [1, -1]) {
      for (let i = 0; i <= N; i++) {
        const x = sternX(0.2) + (tipX(0.2) - sternX(0.2)) * (i / N);
        const w = halfW(x, 0.2);
        const bowF = smooth(90, 160, x);
        const widthOut = 2.2 + bowF * 5.5;
        for (let k = 0; k < 3; k++) {
          const off = [0, widthOut * 0.45, widthOut][k];
          pos.push(x + (k === 2 ? -bowF * 6 : 0), 0.12, s * (w + off));
          const a = [0.95, 0.55 + bowF * 0.3, 0][k];
          col.push(1, 1, 1, a);
          uv.push(x / 14, off / 14 + s * 0.3);
        }
      }
      for (let i = 0; i < N; i++) for (let k = 0; k < 2; k++) {
        const a = row + i * 3 + k, b = row + (i + 1) * 3 + k;
        if (s > 0) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
      row += (N + 1) * 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, foamMat);
    m.renderOrder = 1;
    foamGroup.add(m);
  }
  // wake trail behind the stern
  const wakeTex = foam.clone(); wakeTex.needsUpdate = true;
  wakeTex.wrapS = wakeTex.wrapT = THREE.RepeatWrapping;
  const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, vertexColors: true, depthWrite: false, fog: true });
  {
    const pos = [], col = [], uv = [], idx = [];
    const N = 60, M = 9;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = sternX(0) + 2 - t * 900;
      const w = 14 + t * 160;
      for (let j = 0; j <= M; j++) {
        const v = j / M * 2 - 1;
        pos.push(x, 0.1, v * w);
        const core = Math.exp(-v * v * 5) * 0.85 + Math.exp(-((Math.abs(v) - 0.85) ** 2) * 60) * 0.7;
        col.push(1, 1, 1, core * Math.pow(1 - t, 1.6) * smooth(0, 0.02, t + 0.004));
        uv.push(v * w / 26, x / 26);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j, b = a + M + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, wakeMat);
    m.renderOrder = 1;
    foamGroup.add(m);
  }
  scene.add(foamGroup);

  // stars + moon
  const R = rng(5);
  const sp = [], sc = [];
  for (let i = 0; i < 4000; i++) {
    const u = R() * 2 - 1, a = R() * Math.PI * 2;
    const y = Math.abs(u) * 0.95 + 0.03;
    const r = Math.sqrt(1 - y * y);
    sp.push(Math.cos(a) * r * 20000, y * 20000, Math.sin(a) * r * 20000);
    const b = 0.4 + R() * 0.6;
    sc.push(b, b, b * (0.9 + R() * 0.2));
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  const starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(sg, starMat);
  stars.renderOrder = -1;
  scene.add(stars);
  const glow = TX.glowTexture();
  // soft sun sprite (the analytic sky's disc is far too hot for bloom)
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(0xfff2d8).multiplyScalar(2.6), transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  sunSprite.scale.setScalar(2600);
  scene.add(sunSprite);
  sky.material.uniforms.showSunDisc.value = 0;
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xdfe8ff, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  moon.scale.setScalar(1400);
  scene.add(moon);

  // distant islands for scale and composition
  const islandMat = new THREE.MeshStandardMaterial({ color: 0x3d5a45, roughness: 1, flatShading: true });
  for (const [x, z, s] of [[-9000, -11500, 1], [12500, -8000, 1.4], [-13500, 7000, 1.2]]) {
    const g = new THREE.IcosahedronGeometry(1, 4);
    const p = g.getAttribute('position');
    const nr = rng(Math.abs(x));
    const bumps = Array.from({ length: 6 }, () => [nr() * 2 - 1, nr() * 2 - 1, 0.3 + nr() * 0.4]);
    for (let i = 0; i < p.count; i++) {
      let vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      let h = 0;
      for (const [bx, bz, bh] of bumps) h += bh * Math.exp(-((vx - bx) ** 2 + (vz - bz) ** 2) * 3);
      const n = 0.75 + 0.25 * Math.sin(vx * 13 + vz * 7) * Math.sin(vz * 11 - vx * 5);
      p.setXYZ(i, vx * 2200 * s, Math.max(-0.05, vy) * (60 + h * 150) * n * s, vz * 900 * s);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, islandMat);
    m.position.set(x, -10, z);
    scene.add(m);
  }

  // seagulls
  const birds = [];
  {
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.3, 0, 0.7, 0.35, 0, 0.1, 0, 0, 0, 0.35, 0, 0.1, -0.3, 0, -0.7].map((v) => v * 1.4), 3));
    wing.computeVertexNormals();
    const bm = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide, roughness: 0.8 });
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(wing.clone(), bm);
      b.userData = { r: 60 + R() * 120, h: 55 + R() * 40, sp: 0.08 + R() * 0.06, ph: R() * 6.28, cx: -40 + R() * 80 };
      scene.add(b);
      birds.push(b);
    }
  }

  const envCache = {};
  const skyScene = new THREE.Scene();
  const skyClone = new Sky();
  skyClone.scale.setScalar(1000);
  skyScene.add(skyClone);
  function envFor(name, P) {
    if (envCache[name]) return envCache[name];
    const u = skyClone.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'sunPosition', 'cloudCoverage']) u[k].value = sky.material.uniforms[k].value;
    u.showSunDisc.value = 0;
    skyScene.background = null;
    if (name === 'night') {
      // Sky model goes black below the horizon; paint a moonlit gradient dome for reflections instead.
      const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `varying vec3 vP; void main(){ float h=vP.y; vec3 c=mix(vec3(0.05,0.08,0.16),vec3(0.012,0.02,0.05),smoothstep(0.0,0.6,h)); c=mix(vec3(0.01,0.012,0.02),c,smoothstep(-0.3,0.02,h));
          float m=pow(max(dot(vP,normalize(vec3(-0.5,0.45,-0.6))),0.0),60.0); c+=vec3(0.7,0.8,1.0)*m*1.5; gl_FragColor=vec4(c*1.6,1.0);} `,
      }));
      const s2 = new THREE.Scene(); s2.add(dome);
      envCache[name] = pmrem.fromScene(s2, 0.02).texture;
    } else {
      envCache[name] = pmrem.fromScene(skyScene, 0.0).texture;
    }
    return envCache[name];
  }

  const state = { name: 'day', t: 1, from: null, to: null };
  const cur = { ...PRESETS.day };
  const fogObj = new THREE.FogExp2(PRESETS.day.fog, PRESETS.day.fogD);
  scene.fog = fogObj;

  function applyValues(P) {
    const phi = THREE.MathUtils.degToRad(90 - P.elev), theta = THREE.MathUtils.degToRad(P.azim);
    sunDir.setFromSphericalCoords(1, phi, theta);
    const u = sky.material.uniforms;
    u.turbidity.value = P.turbidity; u.rayleigh.value = P.rayleigh; u.mieCoefficient.value = P.mie; u.mieDirectionalG.value = P.mieG;
    u.cloudCoverage.value = P.clouds;
    u.sunPosition.value.copy(sunDir);
    // light comes from the sun by day, from the moon at night
    const lightDir = P.elev > -2 ? sunDir.clone() : new THREE.Vector3(-0.5, 0.45, -0.6).normalize();
    // keep the key light above the horizon so decks never go fully black at dusk
    lightDirV.copy(lightDir); if (lightDirV.y < 0.12) { lightDirV.y = 0.12; lightDirV.normalize(); }
    sunLight.position.copy(shadowCenter).addScaledVector(lightDirV, 500);
    sunLight.color.set(P.sun); sunLight.intensity = P.sunI;
    hemi.color.set(P.hemiSky); hemi.groundColor.set(P.hemiGround); hemi.intensity = P.hemiI;
    water.material.uniforms.sunDirection.value.copy(lightDir);
    water.material.uniforms.sunColor.value.set(P.sun).multiplyScalar(P.elev > -2 ? 1 : 0.5);
    water.material.uniforms.waterColor.value.set(P.water);
    fogObj.color.set(P.fog); fogObj.density = P.fogD;
    starMat.opacity = P.stars;
    sunSprite.visible = P.elev > -2;
    sunSprite.position.copy(sunDir).multiplyScalar(30000);
    sunSprite.material.color.set(P.sun).multiplyScalar(P.elev < 10 ? 3.2 : 2.4);
    moon.material.opacity = P.stars * 0.9;
    moon.position.copy(new THREE.Vector3(-0.5, 0.45, -0.6).normalize().multiplyScalar(15000));
    foamMat.color.setScalar(P.elev > -2 ? 1 : 0.35);
    wakeMat.color.setScalar(P.elev > -2 ? 0.9 : 0.3);
  }

  function setPreset(name, onEnv) {
    const P = PRESETS[name];
    state.name = name;
    Object.assign(cur, P);
    applyValues(P);
    const env = envFor(name, P);
    scene.environment = env;
    scene.environmentIntensity = P.envI;
    if (onEnv) onEnv(P);
  }

  // Shadow frustum follows the region the camera is looking at.
  function focusShadow(center, radius) {
    const cam = sunLight.shadow.camera;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = 1; cam.far = 1200;
    cam.updateProjectionMatrix();
    shadowCenter.copy(center);
    sunLight.target.position.copy(center);
    sunLight.position.copy(center).addScaledVector(lightDirV, 500);
  }

  function update(t, dt) {
    water.material.uniforms.time.value = t * 0.55;
    sky.material.uniforms.time.value = t;
    wakeTex.offset.y = -t * 0.18;
    foam.offset.x = -t * 0.35;
    for (const b of birds) {
      const d = b.userData;
      const a = t * d.sp + d.ph;
      b.position.set(d.cx + Math.cos(a) * d.r, d.h + Math.sin(t * 0.7 + d.ph) * 3, Math.sin(a) * d.r * 0.6);
      b.rotation.y = -a;
      const flap = Math.sin(t * 7 + d.ph) * 0.5;
      const p = b.geometry.getAttribute('position');
      p.setY(1, flap * 1.4); p.setY(5, flap * 1.4); p.needsUpdate = true;
    }
  }

  return { sky, water, sunLight, hemi, setPreset, focusShadow, update, state, PRESETS, birds };
}
