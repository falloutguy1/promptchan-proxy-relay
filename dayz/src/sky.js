import * as THREE from 'three';

// HDR image-based lighting + matching sun, sky backdrop and aerial haze.
//
// The HDRI's sun disc is clamped out of the environment before PMREM
// filtering and re-introduced as a shadow-casting DirectionalLight whose
// direction and irradiance were measured from the 4k source by the pipeline,
// so the sun is neither double-counted nor inconsistent with the sky.

export class Sky {
  constructor(renderer, scene, hdrTex, backdropTex, info) {
    this.scene = scene;
    this.info = info;
    this.sunDir = new THREE.Vector3().fromArray(info.sun_dir).normalize();

    // --- environment ---
    const img = hdrTex.image;
    const d = img.data, w = img.width, h = img.height, ch = d.length / (w * h);
    const lum = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const skyL = [];
    for (let y = 0; y < h / 2; y += 4) for (let x = 0; x < w; x += 4) skyL.push(lum((y * w + x) * ch));
    skyL.sort((a, b) => a - b);
    const cap = skyL[Math.floor(skyL.length * 0.995)] * 1.5;
    for (let i = 0; i < w * h; i++) {
      const k = i * ch, l = lum(k);
      if (l > cap) { const s = cap / l; d[k] *= s; d[k + 1] *= s; d[k + 2] *= s; }
    }
    // horizon colour for haze: average of the band just above the horizon
    const hz = new THREE.Color(0, 0, 0);
    let n = 0;
    for (let y = Math.floor(h * 0.44); y < Math.floor(h * 0.49); y++) for (let x = 0; x < w; x += 2) {
      const k = (y * w + x) * ch; hz.r += d[k]; hz.g += d[k + 1]; hz.b += d[k + 2]; n++;
    }
    hz.multiplyScalar(1 / n);
    this.horizon = hz;
    hdrTex.needsUpdate = true;
    hdrTex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = pmrem.fromEquirectangular(hdrTex);
    pmrem.dispose();
    scene.environment = this.envRT.texture;
    scene.environmentIntensity = 0.9;

    // --- sun ---
    const E = info.sun_irradiance;
    const sunLum = 0.2126 * E[0] + 0.7152 * E[1] + 0.0722 * E[2];
    this.sun = new THREE.DirectionalLight(new THREE.Color(E[0], E[1], E[2]).multiplyScalar(1 / Math.max(...E)), sunLum * 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 400;
    scene.add(this.sun, this.sun.target);

    // --- aerial perspective: exponential haze tinted by the sky's horizon colour ---
    scene.fog = new THREE.FogExp2(hz.clone(), 0.0016);

    // --- backdrop dome ---
    backdropTex.colorSpace = THREE.SRGBColorSpace;
    backdropTex.wrapS = THREE.RepeatWrapping;
    backdropTex.minFilter = THREE.LinearMipmapLinearFilter;
    backdropTex.anisotropy = 4;
    const mat = new THREE.ShaderMaterial({
      name: 'skyBackdrop',
      uniforms: {
        tSky: { value: backdropTex },
        uExtent: { value: info.backdrop_v_extent },
        uExposure: { value: info.backdrop_exposure },
        uHorizon: { value: hz },
        uHaze: { value: 0.5 },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // on the far plane
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tSky; uniform float uExtent, uExposure, uHaze; uniform vec3 uHorizon;
        varying vec3 vDir;
        #include <common>
        void main() {
          vec3 d = normalize(vDir);
          float u = atan(d.z, d.x) * RECIPROCAL_PI2 + 0.5;
          float v = asin(clamp(d.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5;   // 1 = zenith
          float vt = 1.0 - (1.0 - v) / uExtent;                          // texture only stores the top part
          vec3 c = texture2D(tSky, vec2(u, max(vt, 0.002))).rgb;         // decoded to linear by colorSpace
          c /= uExposure;
          // below the stored band (hidden by terrain anyway) and at the horizon: fade into haze
          float haze = uHaze * (1.0 - smoothstep(0.0, 0.08, d.y));
          c = mix(c, uHorizon, clamp(haze + step(d.y, -0.05), 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    this.dome.userData.noAO = true;
    scene.add(this.dome);
  }

  setShadowQuality(size, radius) {
    const s = this.sun.shadow;
    if (s.mapSize.x !== size) {
      s.mapSize.set(size, size);
      s.map?.dispose(); s.map = null;
    }
    this.shadowRadius = radius;
    const c = s.camera;
    c.left = c.bottom = -radius; c.right = c.top = radius;
    c.updateProjectionMatrix();
  }

  update(camera, focus) {
    this.dome.position.copy(camera.position);
    // Shadow frustum centred ahead of the viewer, snapped to texels to avoid shimmering.
    const r = this.shadowRadius;
    const texel = (2 * r) / this.sun.shadow.mapSize.x;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const center = focus.clone().addScaledVector(fwd, r * 0.35);
    // snap in light space
    const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    center.applyMatrix4(inv);
    center.x = Math.round(center.x / texel) * texel;
    center.y = Math.round(center.y / texel) * texel;
    center.applyMatrix4(lightRot);
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(this.sunDir, 200);
    this.sun.target.updateMatrixWorld();
  }
}
