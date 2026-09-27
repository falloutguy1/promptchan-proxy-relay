// Fences: wooden picket fences with posts, two rails and pickets, with gaps,
// leaning or missing sections - built into a Geo along a closed or open polyline.
import * as THREE from 'three';

export function picketFence(g, pts, rng, { gate = -1, height = 1.15, decay = 0.3, key = 'wood_weathered', post = 'wood_weathered:#80776b' } = {}) {
  for (let s = 0; s < pts.length - 1; s++) {
    if (s === gate) continue;
    const a = pts[s], b = pts[s + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    const nPost = Math.max(1, Math.round(L / 2.2));
    for (let i = 0; i < nPost; i++) {
      const f0 = i / nPost, f1 = (i + 1) / nPost;
      const x0 = a[0] + (b[0] - a[0]) * f0, z0 = a[1] + (b[1] - a[1]) * f0;
      const x1 = a[0] + (b[0] - a[0]) * f1, z1 = a[1] + (b[1] - a[1]) * f1;
      const gone = rng.next() < decay * 0.25;
      const lean = rng.next() < decay * 0.4 ? rng.float(-0.35, 0.35) : 0;
      g.box(post, x0, height / 2 - 0.25, z0, 0.09, height + 0.5, 0.09, 0.012);
      if (gone) continue;
      const segL = L / nPost;
      g.pushTRS((x0 + x1) / 2, 0, (z0 + z1) / 2, ang, lean, 0);
      for (const ry of [0.3, height - 0.25]) g.box(key, 0, ry, 0.06, segL, 0.07, 0.035, 0.006);
      const nP = Math.floor(segL / 0.15);
      for (let k = 0; k < nP; k++) {
        if (rng.next() < decay * 0.3) continue;
        const x = -segL / 2 + (k + 0.5) * (segL / nP);
        const h = height * rng.float(0.92, 1.0);
        g.pushTRS(x, h / 2 + 0.02, 0.09, 0, 0, rng.float(-0.03, 0.03));
        g.box(key, 0, 0, 0, 0.085, h, 0.018, 0.004);
        g.pop();
      }
      g.pop();
    }
  }
  const last = pts[pts.length - 1];
  g.box(post, last[0], height / 2 - 0.25, last[1], 0.09, height + 0.5, 0.09, 0.012);
}
