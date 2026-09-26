// Canvas-painted liveries: colour, height->normal and roughness/metalness maps.
// B-17G, 91st BG style markings (fictional airframe), Olive Drab 41 over Neutral Gray 43, Oct 1943.
import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';

export const OD = '#4f5134';        // faded olive drab 41
export const OD2 = '#5a5a3b';
export const NG = '#8c8f8a';        // neutral gray 43
const INS_BLUE = '#1f2d5a';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Paint target bundle: colour, height (grey), rough (R=unused, G=roughness, B=metalness)
export class Livery {
  constructor(w, h, pxm) {
    this.w = w; this.h = h; this.k = pxm;
    this.col = canvas(w, h); this.c = this.col.getContext('2d');
    this.hgt = canvas(w, h); this.hc = this.hgt.getContext('2d');
    this.arm = canvas(w, h); this.ac = this.arm.getContext('2d');
    this.hc.fillStyle = '#808080'; this.hc.fillRect(0, 0, w, h);
    this.ac.fillStyle = 'rgb(255,190,10)'; this.ac.fillRect(0, 0, w, h);    // rough 0.75, metal 0.04
    this.rnd = mulberry32(17);
  }

  mottle(alpha = 0.08, scale = 1) {
    // faded, sun-bleached patches and touched-up panels
    const { c, w, h, rnd, k } = this;
    for (let i = 0; i < (w * h) / (4000 * scale); i++) {
      const x = rnd() * w, y = rnd() * h, r = (0.2 + rnd() * 1.2) * k * scale;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      const l = rnd() < 0.5;
      g.addColorStop(0, l ? `rgba(200,200,170,${alpha * rnd()})` : `rgba(20,22,10,${alpha * rnd()})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  panelLines(xs, ys, x0 = 0, x1 = this.w, y0 = 0, y1 = this.h, rivets = true) {
    const { c, hc, k } = this;
    c.save(); hc.save();
    c.strokeStyle = 'rgba(15,15,8,0.35)'; c.lineWidth = Math.max(1, k * 0.012);
    hc.strokeStyle = '#4a4a4a'; hc.lineWidth = Math.max(1, k * 0.014);
    for (const x of xs) { c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke(); hc.beginPath(); hc.moveTo(x, y0); hc.lineTo(x, y1); hc.stroke(); }
    for (const y of ys) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); hc.beginPath(); hc.moveTo(x0, y); hc.lineTo(x1, y); hc.stroke(); }
    if (rivets && k > 60) {
      hc.fillStyle = '#9a9a9a';
      c.fillStyle = 'rgba(0,0,0,0.12)';
      const step = k * 0.05, off = k * 0.03, sz = Math.max(1, k * 0.008);
      for (const x of xs) for (let y = y0; y < y1; y += step) { hc.fillRect(x - off, y, sz, sz); hc.fillRect(x + off, y, sz, sz); }
      for (const y of ys) for (let x = x0; x < x1; x += step) { hc.fillRect(x, y - off, sz, sz); c.fillRect(x, y - off, sz, sz); }
    }
    c.restore(); hc.restore();
  }

  chips(x, y, rw, rh, n) {
    // paint worn through to bare aluminium: colour + metal/rough
    const { c, ac, rnd } = this;
    for (let i = 0; i < n; i++) {
      const px = x + (rnd() - 0.5) * rw, py = y + (rnd() - 0.5) * rh;
      const s = 1 + rnd() * this.k * 0.03;
      c.fillStyle = `rgba(165,168,165,${0.5 + rnd() * 0.5})`;
      c.beginPath(); c.ellipse(px, py, s, s * (0.4 + rnd()), rnd() * 3, 0, Math.PI * 2); c.fill();
      ac.fillStyle = 'rgb(255,90,230)';
      ac.beginPath(); ac.ellipse(px, py, s, s * 0.8, 0, 0, Math.PI * 2); ac.fill();
    }
  }

  star(cx, cy, R, rot = 0) {
    // US national insignia Sept 1943 on: white star on blue disc, white bars with blue outline
    const { c } = this;
    c.save(); c.translate(cx, cy); c.rotate(rot);
    const bw = R * 1.0, bh = R * 0.5, out = R * 0.12;
    c.fillStyle = INS_BLUE;
    c.fillRect(-R - bw - out, -bh / 2 - out, (R + bw + out) * 2, bh + out * 2);
    c.beginPath(); c.arc(0, 0, R + out, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#d9d6cc';
    c.fillRect(-R - bw, -bh / 2, (R + bw) * 2, bh);
    c.fillStyle = INS_BLUE;
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#d9d6cc';
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 ? R * 0.382 : R;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath(); c.fill();
    c.restore();
  }

  text(str, x, y, size, color, rot = 0, font = 'bold') {
    const { c } = this;
    c.save(); c.translate(x, y); c.rotate(rot);
    c.font = `${font} ${size}px "Arial Narrow", Arial, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(str, 0, 0);
    c.restore();
  }

  // Build three.js textures (normal from height via Sobel)
  textures(normalStrength = 2.0, aniso = 8) {
    const w = this.w, h = this.h;
    const hd = this.hc.getImageData(0, 0, w, h).data;
    const out = this.hc.createImageData(w, h);
    const o = out.data;
    const H = (x, y) => hd[((Math.min(h - 1, Math.max(0, y)) * w) + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * normalStrength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * normalStrength;
      const L = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      o[i] = (-dx / L * 0.5 + 0.5) * 255;
      o[i + 1] = (-dy / L * 0.5 + 0.5) * 255;   // canvas y down = +v (flipY false)
      o[i + 2] = (1 / L * 0.5 + 0.5) * 255;
      o[i + 3] = 255;
    }
    const nc = canvas(w, h); nc.getContext('2d').putImageData(out, 0, 0);
    const mk = (cv, srgb) => {
      const t = new THREE.CanvasTexture(cv);
      t.flipY = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = aniso;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    };
    return { map: mk(this.col, true), normalMap: mk(nc, false), roughnessMap: mk(this.arm, false) };
  }
}

// Simple tileable panel texture for smaller parts (nacelles, stabilisers, fighter skins).
export function panelTexture(base, pxm = 128, size = 512, opts = {}) {
  const L = new Livery(size, size, pxm);
  L.c.fillStyle = base; L.c.fillRect(0, 0, size, size);
  L.mottle(0.1, 0.5);
  const xs = [], ys = [];
  for (let x = 0; x < size; x += pxm * (opts.px ?? 0.9)) xs.push(Math.round(x) + 0.5);
  for (let y = 0; y < size; y += pxm * (opts.py ?? 0.6)) ys.push(Math.round(y) + 0.5);
  L.panelLines(xs, ys);
  if (opts.chips) L.chips(size / 2, size / 2, size, size, opts.chips);
  const t = L.textures(2.0);
  for (const k of Object.keys(t)) { t[k].wrapS = t[k].wrapT = THREE.RepeatWrapping; }
  return t;
}
