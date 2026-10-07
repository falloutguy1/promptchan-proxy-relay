// Gerstner wave model shared by the water shader (GPU) and ship buoyancy (CPU).
// Sea state roughly Beaufort 3 inside the bay: long swell + wind waves.

export class Waves {
  constructor() {
    this.windDir = 0.35; // radians, waves travel roughly toward +z (into the bay)
    this.setSeaState(1.0);
  }

  setSeaState(s) {
    this.state = s;
    const base = [
      // wavelength m, amplitude m, direction offset rad, steepness
      [92, 0.42, 0.0, 0.35], [53, 0.26, 0.38, 0.45], [31, 0.15, -0.52, 0.5],
      [17, 0.085, 0.9, 0.55], [9.5, 0.045, -1.2, 0.55], [5.3, 0.022, 0.25, 0.5],
    ];
    this.list = base.map(([L, A, d, q]) => {
      const k = (2 * Math.PI) / L;
      const c = Math.sqrt(9.81 / k); // deep-water dispersion
      const a = this.windDir + d;
      return { L, A: A * s, k, c, dx: Math.sin(a), dz: Math.cos(a), q };
    });
    this.uniform = new Float32Array(this.list.length * 4);
    this.uniform2 = new Float32Array(this.list.length * 4);
    this.list.forEach((w, i) => {
      this.uniform.set([w.dx, w.dz, w.k, w.c], i * 4);
      this.uniform2.set([w.A, w.q, w.L, 0], i * 4);
    });
  }

  /** Displacement of the surface point whose rest position is (x, z). */
  displace(x, z, t, out) {
    let dx = 0, dy = 0, dz = 0;
    for (const w of this.list) {
      const f = w.k * (w.dx * x + w.dz * z - w.c * t);
      const qa = (w.q / (w.k * w.A * this.list.length + 1e-6)) * w.A;
      const cf = Math.cos(f);
      dx += qa * w.dx * cf; dz += qa * w.dz * cf; dy += w.A * Math.sin(f);
    }
    out.x = dx; out.y = dy; out.z = dz;
    return out;
  }

  /** Surface height at world (x, z), inverting the horizontal displacement with two fixed-point steps. */
  heightAt(x, z, t) {
    const o = this._o || (this._o = { x: 0, y: 0, z: 0 });
    let px = x, pz = z;
    for (let i = 0; i < 2; i++) { this.displace(px, pz, t, o); px = x - o.x; pz = z - o.z; }
    this.displace(px, pz, t, o);
    return o.y;
  }
}

export const GLSL_WAVES = /* glsl */ `
#define NWAVES 6
uniform vec4 uWaveA[NWAVES]; // dir.xz, k, c
uniform vec4 uWaveB[NWAVES]; // amp, steepness, wavelength
uniform float uTime;
// Gerstner displacement; 'lodSpacing' fades waves that the mesh cannot resolve (prevents swimming)
vec3 gerstner(vec2 p, float lodSpacing, out float crest) {
  vec3 d = vec3(0.0); crest = 0.0;
  for (int i = 0; i < NWAVES; i++) {
    vec4 a = uWaveA[i], b = uWaveB[i];
    float fade = 1.0 - smoothstep(b.z * 0.18, b.z * 0.35, lodSpacing);
    float f = a.z * (dot(a.xy, p) - a.w * uTime);
    float qa = b.y / (a.z * b.x * float(NWAVES) + 1e-6) * b.x;
    float cf = cos(f), sf = sin(f);
    d.xz += qa * a.xy * cf * fade; d.y += b.x * sf * fade;
    crest += b.y * sf * fade * b.x * a.z;
  }
  return d;
}
// analytic surface normal (per-pixel), with distance-dependent band limiting
vec3 gerstnerNormal(vec2 p, float pixelFoot) {
  vec3 n = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < NWAVES; i++) {
    vec4 a = uWaveA[i], b = uWaveB[i];
    float fade = 1.0 - smoothstep(b.z * 0.25, b.z * 0.6, pixelFoot);
    float f = a.z * (dot(a.xy, p) - a.w * uTime);
    float wa = a.z * b.x * fade;
    float qa = b.y / (a.z * b.x * float(NWAVES) + 1e-6);
    n.xz -= a.xy * wa * cos(f);
    n.y -= qa * wa * sin(f);
  }
  return normalize(n);
}
`;
