import * as THREE from 'three';

const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Lofted hull surface. Local frame: +x bow, +y up (0 = waterline), +z starboard.
 * Half-breadth = plan taper(s) * section shape(s, y); stem/stern profiles shift the ends with height.
 */
export class HullShape {
  constructor(d, a) {
    this.d = d; this.L = d.length; this.B = d.beam; this.T = a.draft; this.F = d.freeboard;
  }

  deckY(s) {
    const d = this.d;
    return this.F + d.sheer * Math.pow(sstep(0.5, 1.0, s), 1.6) + d.sheer * 0.18 * Math.pow(sstep(0.35, 0.0, s), 2);
  }

  xEnd(y) {
    const { L, T, d } = this;
    const h = (y + T) / (T + this.F + d.sheer);
    let x = L / 2;
    if (d.bow === 'clipper') x += 0.034 * L * Math.pow(Math.max(h, 0), 1.7) - 0.012 * L * Math.pow(1 - Math.min(h * 2.2, 1), 2);
    else x += 0.012 * L * h - 0.01 * L * Math.pow(1 - Math.min(h * 2.5, 1), 2);
    if (d.bow === 'bulbous') x += 0.022 * L * Math.exp(-Math.pow((y + 0.58 * T) / (0.24 * T), 2));
    return x;
  }

  xStart(y) {
    const { L, T, d } = this;
    if (d.stern === 'transom') return -L / 2 + (y < -0.35 * T ? 0.05 * L * sstep(-0.35 * T, -T, y) : 0);
    // cruiser stern: cut up below the waterline, slight overhang above
    return -L / 2 + 0.045 * L * Math.pow(sstep(0.0, -T, y), 1.3) - 0.008 * L * sstep(0, this.F, y);
  }

  plan(s) {
    const fore = Math.pow(Math.cos(Math.min(1, Math.max(0, (s - 0.56) / 0.44)) * Math.PI / 2), 1.05);
    const v = Math.min(1, Math.max(0, (0.38 - s) / 0.38));
    let aft = 1 - (this.d.stern === 'transom' ? 0.42 : 0.5) * Math.pow(v, 1.8);
    if (this.d.stern !== 'transom' && s < 0.05) aft *= Math.sqrt(Math.max(0, 1 - Math.pow((0.05 - s) / 0.05, 2)));
    return Math.min(fore, aft);
  }

  halfBreadth(s, y) {
    const { B, T } = this;
    const full = sstep(0.0, 0.32, s) * sstep(1.0, 0.62, s);
    let sec;
    if (y < 0) {
      const n = 2.0 + 6.5 * full;
      const f = Math.min(1, -y / T);
      sec = Math.pow(Math.max(0, 1 - Math.pow(f, n)), 1 / n);
      // bottom rises toward the ends
      const rise = (1 - full) * 0.35;
      if (-y / T > 1 - rise) sec *= Math.max(0, (1 + y / T) / rise) ** 0.7;
    } else {
      const flare = 0.13 * sstep(0.62, 0.97, s) - 0.015 * full;
      sec = 1 + flare * (y / this.F);
    }
    return Math.min(B / 2, (B / 2) * this.plan(s) * sec); // flare never exceeds the moulded beam
  }

  xAt(s, y) { const a = this.xStart(y), b = this.xEnd(y); return a + (b - a) * s; }

  /** Builds hull side mesh (both sides), deck mesh and transom. */
  build(ns = 140, ny = 30) {
    const ss = [];
    for (let i = 0; i <= ns; i++) {
      const t = i / ns;
      ss.push(0.5 - 0.5 * Math.cos(t * Math.PI) * 0.55 + (t - 0.5) * 0.45); // denser at ends
    }
    ss[0] = 0; ss[ns] = 1;
    const pos = [], uv = [], idx = [];
    const rows = ny + 1;
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= ns; i++) {
        const s = ss[i], top = this.deckY(s);
        let girth = 0, prev = null;
        // y distribution: dense near keel turn and waterline
        for (let j = 0; j <= ny; j++) {
          const t = j / ny;
          const y = t < 0.55 ? -this.T + (this.T) * Math.pow(t / 0.55, 0.75) : (top) * Math.pow((t - 0.55) / 0.45, 1.1);
          const x = this.xAt(s, y), b = this.halfBreadth(s, y) * side;
          if (prev) girth += Math.hypot(x - prev[0], y - prev[1], b - prev[2]);
          prev = [x, y, b];
          pos.push(x, y, b);
          uv.push(x, girth);
        }
        // shift v so the waterline sits at v=0 (keeps plate seams level)
        const j0 = Math.round(0.55 * ny);
        const off = uv[(base + i * rows + j0) * 2 + 1];
        for (let j = 0; j <= ny; j++) uv[(base + i * rows + j) * 2 + 1] -= off;
      }
      for (let i = 0; i < ns; i++) for (let j = 0; j < ny; j++) {
        const a = base + i * rows + j, b = a + rows, c = a + 1, e = b + 1;
        if (side > 0) idx.push(a, b, c, b, e, c); else idx.push(a, c, b, b, c, e); // outward-facing
      }
    }
    const hull = new THREE.BufferGeometry();
    hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    hull.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    hull.setIndex(idx);
    hull.computeVertexNormals();
    // fix seam normals at keel/stem where both sides meet: average across sides
    this._weldSides(hull, ns, rows);

    // deck: 7 points across with camber
    const dp = [], duv = [], di = [], across = 6;
    for (let i = 0; i <= ns; i++) {
      const s = ss[i], y = this.deckY(s), b = this.halfBreadth(s, y), x = this.xAt(s, y);
      for (let k = 0; k <= across; k++) {
        const t = (k / across) * 2 - 1;
        const z = t * b, camber = (1 - t * t) * this.B * 0.012;
        dp.push(x, y + camber, z);
        duv.push(x, z);
      }
    }
    for (let i = 0; i < ns; i++) for (let k = 0; k < across; k++) {
      const a = i * (across + 1) + k, b = a + across + 1;
      di.push(a, a + 1, b, a + 1, b + 1, b); // counter-clockwise seen from above (+y normal)
    }
    const deck = new THREE.BufferGeometry();
    deck.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
    deck.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
    deck.setIndex(di);
    deck.computeVertexNormals();

    let transom = null;
    if (this.d.stern === 'transom') {
      const tp = [], ti = [];
      const yTop = this.deckY(0), yBot = -0.35 * this.T;
      const n = 12;
      for (let j = 0; j <= n; j++) {
        const y = yBot + (yTop - yBot) * (j / n), x = this.xAt(0.0005, y), b = this.halfBreadth(0.0005, y);
        tp.push(x, y, -b, x, y, b);
      }
      for (let j = 0; j < n; j++) { const a = j * 2; ti.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      transom = new THREE.BufferGeometry();
      transom.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      transom.setIndex(ti);
      transom.computeVertexNormals();
      const tuv = []; for (let k = 0; k < tp.length; k += 3) tuv.push(tp[k + 2], tp[k + 1]);
      transom.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
    }
    this.sections = ss;
    return { hull, deck, transom };
  }

  _weldSides(g, ns, rows) {
    const n = g.attributes.normal, p = g.attributes.position;
    const half = (ns + 1) * rows;
    for (let i = 0; i < half; i++) {
      if (Math.abs(p.getZ(i)) > 0.05) continue;
      const k = i + half;
      const x = (n.getX(i) + n.getX(k)) / 2, y = (n.getY(i) + n.getY(k)) / 2;
      const l = Math.hypot(x, y) || 1;
      n.setXYZ(i, x / l, y / l, 0); n.setXYZ(k, x / l, y / l, 0);
    }
  }

  /** Deck-edge sample (for railings / fittings): returns {x, y, b} at parameter s. */
  edge(s) { const y = this.deckY(s); return { x: this.xAt(s, y), y, b: this.halfBreadth(s, y) }; }

  /** Inverse lookup: parameter s for a local x on deck. */
  sAtX(x) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (this.xAt(m, this.deckY(m)) < x) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
}
