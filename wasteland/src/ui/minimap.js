// Minimap: a shaded relief of the valley (terrain layers, water, forest, roads,
// buildings) rendered once, then structures, scavenging sites, survivors, the
// infected they can see and the camera's view drawn on top a few times a second.
// Click or drag to move the camera.
import { WATER_LEVEL, LOTS } from '../world/layout.js';

const M = 232; // half extent in metres

export class Minimap {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    this.bg = null;
    const move = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 * M - M, z = ((e.clientY - r.top) / r.height) * 2 * M - M;
      if (game.rig.mode === 'rts') { game.rig.follow = null; game.rig.focusOn(x, z); }
    };
    let down = false;
    canvas.addEventListener('pointerdown', (e) => { down = true; canvas.setPointerCapture(e.pointerId); move(e); e.stopPropagation(); });
    canvas.addEventListener('pointermove', (e) => { if (down) move(e); });
    canvas.addEventListener('pointerup', () => { down = false; });
  }

  /** Shaded relief; built once (during loading, see HUD). */
  prepare() { if (!this.bg) this.#background(); }

  #background() {
    const t = this.game.world.terrain;
    const N = 256;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const A = t.splatDataA, B = t.splatDataB, S = t.n - 1;
    const cols = [[88, 102, 60], [112, 94, 70], [66, 70, 50], [130, 126, 116], [80, 68, 54], [112, 112, 106]];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / N) * 2 * M - M, z = (j / N) * 2 * M - M;
      const h = t.height(x, z);
      const o = (j * N + i) * 4;
      if (h < WATER_LEVEL + 0.05) { img.data.set([52, 72, 82, 255], o); continue; }
      const gx = Math.min(S - 1, Math.max(0, Math.round(t.toGrid(x)))), gz = Math.min(S - 1, Math.max(0, Math.round(t.toGrid(z))));
      const k = (gz * S + gx) * 4;
      const w = [A[k], A[k + 1], A[k + 2], A[k + 3], B[k], B[k + 1]];
      const tot = w.reduce((a, b) => a + b, 0) || 1;
      let r = 0, gg = 0, b = 0;
      for (let q = 0; q < 6; q++) { r += cols[q][0] * w[q]; gg += cols[q][1] * w[q]; b += cols[q][2] * w[q]; }
      r /= tot; gg /= tot; b /= tot;
      const f = t.sample(t.forest, x, z);
      r *= 1 - f * 0.45; gg *= 1 - f * 0.3; b *= 1 - f * 0.45;
      // hillshade from the NW
      const dx = t.height(x + 1.5, z) - t.height(x - 1.5, z), dz = t.height(x, z + 1.5) - t.height(x, z - 1.5);
      const shade = Math.max(0.55, Math.min(1.3, 1 + (-dx * 0.7 - dz * 0.7) * 0.35));
      img.data.set([Math.min(255, r * shade), Math.min(255, gg * shade), Math.min(255, b * shade), 255], o);
    }
    g.putImageData(img, 0, 0);
    const P = (x) => ((x + M) / (2 * M)) * N;
    // roads
    for (const road of t.roads) {
      g.strokeStyle = road.kind === 'asphalt' ? '#6d6b66' : road.kind === 'gravel' ? '#9a917e' : '#86745a';
      g.lineWidth = road.kind === 'asphalt' ? 2.2 : 1.4;
      g.beginPath();
      road.samples.forEach((p, i) => (i ? g.lineTo(P(p.x), P(p.z)) : g.moveTo(P(p.x), P(p.z))));
      g.stroke();
    }
    // buildings
    for (const lot of LOTS) {
      g.save();
      g.translate(P(lot.x), P(lot.z));
      g.rotate(-lot.rot);
      g.fillStyle = lot.type === 'house' ? '#3b3530' : '#433d36';
      const w = (lot.w / (2 * M)) * N, d = (lot.d / (2 * M)) * N;
      g.fillRect(-w / 2, -d / 2, w, d);
      g.restore();
    }
    this.bg = c;
  }

  draw() {
    const game = this.game, sim = game.sim;
    if (!this.bg) this.#background();
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const P = (x) => ((x + M) / (2 * M)) * W;
    g.drawImage(this.bg, 0, 0, W, H);
    // scavenging sites
    for (const L of sim.lootSites || []) {
      g.fillStyle = L.remaining > 0 ? '#e0c080' : '#6a6458';
      const x = P(L.door.x), y = P(L.door.z);
      g.beginPath(); g.moveTo(x, y - 3.5); g.lineTo(x + 3.5, y); g.lineTo(x, y + 3.5); g.lineTo(x - 3.5, y); g.closePath(); g.fill();
    }
    // structures
    for (const s of sim.structures?.list || []) {
      g.save();
      g.translate(P(s.x), P(s.z));
      g.rotate(-s.rot);
      g.fillStyle = s.built ? (s.def.cat === 'defense' ? '#c9b48a' : '#d9a24a') : 'rgba(217,162,74,0.45)';
      const w = Math.max(2, (s.def.w / (2 * M)) * W), d = Math.max(2, (s.def.d / (2 * M)) * H);
      g.fillRect(-w / 2, -d / 2, w, d);
      g.restore();
    }
    // infected: only those someone can see (or near the camp)
    const seen = (z) => {
      if (Math.hypot(z.pos.x - sim.center.x, z.pos.z - sim.center.z) < sim.colonyRadius + 30) return true;
      for (const s of sim.survivors) if (s.alive && (s.pos.x - z.pos.x) ** 2 + (s.pos.z - z.pos.z) ** 2 < 38 * 38) return true;
      return false;
    };
    g.fillStyle = '#e0503c';
    for (const z of sim.infected || []) if (z.alive && seen(z)) { g.beginPath(); g.arc(P(z.pos.x), P(z.pos.z), 2.1, 0, 7); g.fill(); }
    for (const v of sim.visitors || []) if (v.alive) { g.fillStyle = '#e8e8e8'; g.beginPath(); g.arc(P(v.pos.x), P(v.pos.z), 2.4, 0, 7); g.fill(); }
    for (const s of sim.survivors || []) {
      if (!s.alive) continue;
      const sel = game.hud?.sel?.ref === s;
      g.fillStyle = sel ? '#ffffff' : '#f2c14e';
      g.beginPath(); g.arc(P(s.pos.x), P(s.pos.z), sel ? 3.4 : 2.6, 0, 7); g.fill();
    }
    // camera view
    const c = game.camera.position;
    const dir = game.camera.getWorldDirection(game._tmpDir || (game._tmpDir = c.clone()));
    const yaw = Math.atan2(dir.x, dir.z), half = 0.55, len = game.rig.mode === 'walk' ? 28 : Math.max(24, game.rig.cur.dist * 1.1);
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(P(c.x), P(c.z));
    g.lineTo(P(c.x + Math.sin(yaw - half) * len), P(c.z + Math.cos(yaw - half) * len));
    g.moveTo(P(c.x), P(c.z));
    g.lineTo(P(c.x + Math.sin(yaw + half) * len), P(c.z + Math.cos(yaw + half) * len));
    g.stroke();
  }
}
