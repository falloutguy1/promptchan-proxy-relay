import * as THREE from 'three';

/**
 * HDRI image-based lighting + a matching directional sun.
 * The sun direction and colour are extracted from the HDRI itself so direct shadows line up
 * with the bright spot in the sky and the reflections on the water.
 */
export class Sky {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.sunDir = new THREE.Vector3(0.5, 0.75, 0.3).normalize();
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.camera.layers.enableAll();
    scene.add(this.sun, this.sun.target);
    this.horizon = new THREE.Color(0.62, 0.7, 0.78);
    this.focus = new THREE.Vector3();
    this.radius = 120;
  }

  setHDRI(tex) {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    this.analyse(tex);
    this.clampSun(tex, 24);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.env = pm.fromEquirectangular(tex).texture;
    pm.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.85;
    this.scene.background = tex;
    this.scene.backgroundIntensity = 0.9;
    this.scene.backgroundRotation.set(0, 0, 0);
  }

  /**
   * The HDRI contains the sun at full radiance. Left in, it floods the diffuse IBL and doubles
   * up with the directional light; clamp it so the sky provides fill and the light provides sun.
   */
  clampSun(tex, max) {
    const d = tex.image.data;
    const half = d instanceof Uint16Array;
    const lim = half ? THREE.DataUtils.toHalfFloat(max) : max;
    for (let i = 0; i < d.length; i++) {
      if ((i & 3) === 3 && d.length % 4 === 0) continue;
      if (half ? THREE.DataUtils.fromHalfFloat(d[i]) > max : d[i] > max) d[i] = lim;
    }
    tex.needsUpdate = true;
  }

  /** Locate the sun (brightest region) and the average horizon colour in the equirect HDR. */
  analyse(tex) {
    const { data, width: w, height: h } = tex.image;
    const half = (v) => (data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat(v) : v);
    const ch = data.length / (w * h);
    let best = -1, bx = 0, by = 0;
    const hz = [0, 0, 0]; let hn = 0;
    for (let y = 0; y < h / 2; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * ch;
        const r = half(data[i]), g = half(data[i + 1]), b = half(data[i + 2]);
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (L > best) { best = L; bx = x; by = y; }
        if (y > h * 0.44) { hz[0] += r; hz[1] += g; hz[2] += b; hn++; }
      }
    }
    // equirect -> direction (three.js convention: u=0.5 looks down -Z)
    const u = (bx + 0.5) / w, v = (by + 0.5) / h;
    const phi = (u - 0.5) * Math.PI * 2, theta = v * Math.PI;
    this.sunDir.set(Math.sin(theta) * Math.sin(phi), Math.cos(theta), -Math.sin(theta) * Math.cos(phi)).normalize();
    // keep a sensible elevation even if the brightest pixel is a cloud edge
    if (this.sunDir.y < 0.25) { this.sunDir.y = 0.25; this.sunDir.normalize(); }
    this.horizon.setRGB(hz[0] / hn, hz[1] / hn, hz[2] / hn).multiplyScalar(0.9);
    const m = Math.max(this.horizon.r, this.horizon.g, this.horizon.b);
    if (m > 1) this.horizon.multiplyScalar(1 / m);
    this.peak = best;
  }

  setShadowQuality(size) {
    const s = this.sun.shadow;
    if (s.mapSize.x !== size) {
      s.mapSize.set(size, size);
      s.map?.dispose();
      s.map = null;
    }
  }

  /** Fit the shadow frustum around the current point of interest. */
  update(focus, radius) {
    this.focus.copy(focus);
    this.radius = radius;
    const s = this.sun;
    const texel = (radius * 2) / s.shadow.mapSize.x;
    // snap to texels to avoid shimmering when the camera moves
    const f = focus.clone();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.sunDir);
    const inv = q.clone().invert();
    f.applyQuaternion(inv);
    f.x = Math.round(f.x / texel) * texel;
    f.y = Math.round(f.y / texel) * texel;
    f.applyQuaternion(q);
    s.position.copy(f).addScaledVector(this.sunDir, 600);
    s.target.position.copy(f);
    const c = s.shadow.camera;
    c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius;
    c.near = 50; c.far = 1400;
    c.updateProjectionMatrix();
    s.target.updateMatrixWorld();
  }
}
