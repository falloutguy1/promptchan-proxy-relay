// Lofting helpers for aircraft: fuselage from super-elliptic sections, wings/tails from NACA sections.
import * as THREE from 'three';

// NACA 4-digit symmetric half-thickness at x (0..1) for thickness t
export function nacaT(x, t) {
  return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

// Fuselage: sections = [{s, w, yT, yB, yc?}] along s (nose->tail). Body axis: z = z0 - s.
// Returns geometry with uv = (s / uLen, arcFromTop / vLen) in metres/normalised by given lengths.
export function loftBody(sections, opts) {
  const { z0 = 0, around = 48, along = 90, p = 0.85, uLen = 1, vLen = 1 } = opts;
  const S0 = sections[0].s, S1 = sections[sections.length - 1].s;
  const interp = (s) => {
    let i = 0;
    while (i < sections.length - 2 && sections[i + 1].s < s) i++;
    const a = sections[i], b = sections[i + 1];
    let t = (s - a.s) / (b.s - a.s);
    t = Math.min(1, Math.max(0, t));
    // monotone-ish smooth interpolation using neighbours (Catmull-Rom on each field)
    const a0 = sections[Math.max(0, i - 1)], b1 = sections[Math.min(sections.length - 1, i + 2)];
    const cr = (k) => {
      const p0 = a0[k] ?? 0, p1 = a[k] ?? 0, p2 = b[k] ?? 0, p3 = b1[k] ?? 0;
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    };
    return { w: Math.max(0.001, cr('w')), yT: cr('yT'), yB: cr('yB') };
  };
  const pos = [], uv = [], idx = [];
  const ring = (w, yT, yB, th) => {
    const sx = Math.sin(th), cy = Math.cos(th);
    const x = w * Math.sign(sx) * Math.abs(sx) ** p;
    const y = cy >= 0 ? yT * Math.abs(cy) ** p : yB * Math.abs(cy) ** p;
    return [x, y];
  };
  const sArr = [];
  for (let j = 0; j <= along; j++) {
    // denser near nose and tail
    const t = j / along;
    const u = 0.5 - 0.5 * Math.cos(t * Math.PI);
    sArr.push(S0 + (S1 - S0) * (0.35 * u + 0.65 * t));
  }
  for (const s of sArr) {
    const { w, yT, yB } = interp(s);
    let arc = 0;
    let prev = null;
    for (let i = 0; i <= around; i++) {
      const th = (i / around) * Math.PI * 2;
      const [x, y] = ring(w, yT, yB, th);
      if (prev) arc += Math.hypot(x - prev[0], y - prev[1]);
      prev = [x, y];
      pos.push(x, y, z0 - s);
      uv.push(s / uLen, arc / vLen);
    }
  }
  const R = around + 1;
  for (let j = 0; j < along; j++) for (let i = 0; i < around; i++) {
    const a = j * R + i, b = a + 1, c = a + R, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.interp = interp;
  g.userData.ring = ring;
  return g;
}

// Wing/tail surface. stations: [{x, le (s of leading edge), chord, y, t (thickness ratio)}] ordered along span.
// The section lies in the s-y plane, chord along -z. Top & bottom as separate groups (0 top, 1 bottom).
// uv: (x / uSpan + 0.5, (s - sRef) / vLen)
export function loftWing(stations, opts) {
  const { z0 = 0, n = 22, uSpan = 32, sRef = 0, vLen = 8, vertical = false, flipWinding = false } = opts;
  const pos = [], uv = [], idxTop = [], idxBot = [];
  const cols = [];
  for (let i = 0; i <= n; i++) { const b = i / n; cols.push(0.5 - 0.5 * Math.cos(b * Math.PI)); }
  const addSurface = (sign, list) => {
    const base = pos.length / 3;
    for (const st of stations) {
      for (const xc of cols) {
        const s = st.le + xc * st.chord;
        const th = nacaT(Math.max(0, xc), st.t) * st.chord * sign;
        const camber = (st.camber || 0) * st.chord * 4 * xc * (1 - xc);
        if (vertical) { pos.push(th, st.y, z0 - s); uv.push((s - sRef) / vLen, (opts.yTop - st.y) / uSpan); }   // fin: canvas x = s, y = down
        else { pos.push(st.x, st.y + th + camber, z0 - s); uv.push(st.x / uSpan + 0.5, (s - sRef) / vLen); }
      }
    }
    const R = cols.length;
    for (let j = 0; j < stations.length - 1; j++) for (let i = 0; i < R - 1; i++) {
      const a = base + j * R + i, b = a + 1, c = a + R, d = c + 1;
      const forward = (sign > 0) !== flipWinding;
      if (forward) list.push(a, c, b, b, c, d); else list.push(a, b, c, b, d, c);
    }
  };
  addSurface(1, idxTop);
  addSurface(-1, idxBot);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...idxTop, ...idxBot]);
  g.addGroup(0, idxTop.length, 0);
  g.addGroup(idxTop.length, idxBot.length, 1);
  g.computeVertexNormals();
  return g;
}

// simple lathe along z (for nacelles, spinners, bombs)
export function latheZ(profile, seg = 24, z0 = 0) {
  // profile: [[s, r]] with s along -z from z0
  const pts = profile.map(([s, r]) => new THREE.Vector2(Math.max(0.0001, r), s));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(-Math.PI / 2);    // lathe axis y -> z
  g.translate(0, 0, z0);
  return g;
}
