import * as THREE from 'three';
import { pfbm, pnoise, clamp, lerp, smooth } from './util.js';

function canvasTex(size, fill, srgb, aniso) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
  fill(img.data, size);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso || 8;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function normalFromHeight(h, size, strength) {
  return (d) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size, yu = (y - 1 + size) % size, yd = (y + 1) % size;
      const dx = (h[y * size + xr] - h[y * size + xl]) * strength;
      const dy = (h[yd * size + x] - h[yu * size + x]) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  };
}
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Rusted hull plating. One tile = 4m x 4m.
export function makeRust(size = 1024) {
  const N = size * size;
  const h = new Float32Array(N), col = new Float32Array(N * 3), rough = new Float32Array(N);
  const maroon = hex('#5c1822'), crimson = hex('#8e2a36'), orange = hex('#c0582f'), peach = hex('#e39a7e'),
    dark = hex('#35121a'), pink = hex('#b85766'), brown = hex('#5a2618');
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size, i = y * size + x;
      const big = pfbm(u, v, 3, 3, 5, 1);
      const mid = pfbm(u, v, 10, 3, 4, 7);
      const streak = pfbm(u, v, 22, 1, 5, 13);           // vertical run-off streaks
      const streak2 = pfbm(u, v, 60, 4, 4, 17);
      const fine = pnoise(u * 256, v * 256, 256, 256, 3) * 0.6 + pnoise(u * 512, v * 512, 512, 512, 5) * 0.4;
      const blister = smooth(0.5, 0.8, pfbm(u, v, 20, 20, 4, 21));
      const flake = smooth(0.46, 0.66, pfbm(u, v, 6, 5, 5, 31));
      const row = Math.floor(v * 2);
      const vs = Math.abs(v * 2 - Math.round(v * 2));
      const uOff = (u + (row % 2) * 0.5) % 1;
      const us = Math.min(uOff, 1 - uOff) * 4;
      const seamD = Math.min(vs, us / 2);
      let height = big * 0.25 + mid * 0.2 + fine * 0.06 + blister * 0.22 - flake * 0.1 + streak2 * 0.1;
      height -= (1 - smooth(0.0, 0.005, seamD)) * 0.35;
      height += smooth(0.0, 0.012, seamD) * 0.08;
      const rv = (d, along) => { const f = along * 40 % 1; const r = Math.hypot((f - 0.5) / 40 * 4, (d - 0.018) * 4); return Math.max(0, 1 - r / 0.035); };
      const rivH = Math.max(rv(vs / 2, u), rv(us / 4, v * 2));
      height += Math.sqrt(rivH) * 0.35;
      h[i] = height;
      let c = mix3(dark, maroon, smooth(0.15, 0.55, big));
      c = mix3(c, crimson, smooth(0.4, 0.8, big * 0.6 + mid * 0.5) * 0.85);
      c = mix3(c, pink, flake * 0.45);
      c = mix3(c, orange, smooth(0.45, 0.9, mid * 0.5 + streak2 * 0.6) * 0.3);
      c = mix3(c, dark, smooth(0.4, 0.8, streak) * 0.6);
      c = mix3(c, peach, smooth(0.6, 0.95, streak * 0.55 + streak2 * 0.55) * 0.35);
      c = mix3(c, brown, blister * 0.35);
      c = mix3(c, dark, (1 - smooth(0.0, 0.008, seamD)) * 0.35);
      c = mix3(c, peach, rivH * 0.25);
      const g = 0.96 + fine * 0.06;
      col[i * 3] = c[0] * g; col[i * 3 + 1] = c[1] * g; col[i * 3 + 2] = c[2] * g;
      rough[i] = clamp(0.62 + big * 0.2 + fine * 0.2 - flake * 0.1 + blister * 0.1 - smooth(0.5, 0.85, streak) * 0.15, 0.3, 1);
    }
  }
  const map = canvasTex(size, (d) => { for (let i = 0; i < N; i++) { d[i * 4] = col[i * 3]; d[i * 4 + 1] = col[i * 3 + 1]; d[i * 4 + 2] = col[i * 3 + 2]; d[i * 4 + 3] = 255; } }, true);
  const roughMap = canvasTex(size, (d) => { for (let i = 0; i < N; i++) { const r = rough[i] * 255; d[i * 4] = r; d[i * 4 + 1] = r; d[i * 4 + 2] = r; d[i * 4 + 3] = 255; } }, false);
  const normalMap = canvasTex(size, normalFromHeight(h, size, 6), false);
  return { map, roughMap, normalMap };
}

// Beach sand. One tile = 6m.
export function makeSand(size = 1024) {
  const N = size * size;
  const h = new Float32Array(N), col = new Float32Array(N * 3);
  const base = hex('#cdb294'), light = hex('#e2cdb2'), darkS = hex('#9c8066'), pinkish = hex('#c99c8a');
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size, i = y * size + x;
      const warp = pfbm(u, v, 4, 4, 3, 50) * 2.2;
      const rip = Math.sin((u * 18 + v * 6 + warp) * Math.PI * 2);
      const ripple = Math.pow(rip * 0.5 + 0.5, 1.6);
      const grain = pnoise(u * 512, v * 512, 512, 512, 61);
      const grain2 = pnoise(u * 1024, v * 1024, 1024, 1024, 67);
      const big = pfbm(u, v, 6, 6, 4, 70);
      h[i] = ripple * 0.7 * (0.5 + big) + grain * 0.25 + grain2 * 0.15;
      let c = mix3(base, light, smooth(0.35, 0.75, big) * 0.7);
      c = mix3(c, pinkish, smooth(0.55, 0.8, pfbm(u, v, 3, 3, 3, 80)) * 0.4);
      c = mix3(c, darkS, (grain2 > 0.86 ? 0.8 : 0) + (1 - ripple) * 0.18);
      if (grain > 0.93) c = mix3(c, [250, 245, 235], 0.6);
      const g = 0.92 + grain * 0.14;
      col[i * 3] = c[0] * g; col[i * 3 + 1] = c[1] * g; col[i * 3 + 2] = c[2] * g;
    }
  }
  const map = canvasTex(size, (d) => { for (let i = 0; i < N; i++) { d[i * 4] = col[i * 3]; d[i * 4 + 1] = col[i * 3 + 1]; d[i * 4 + 2] = col[i * 3 + 2]; d[i * 4 + 3] = 255; } }, true, 16);
  const normalMap = canvasTex(size, normalFromHeight(h, size, 5), false, 16);
  return { map, normalMap };
}

// Organic, wet carapace / flesh detail (generic bumpy)
export function makeBumps(size = 512) {
  const N = size * size, h = new Float32Array(N);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const cell = pfbm(u, v, 16, 16, 3, 90);
    h[y * size + x] = Math.pow(cell, 2) * 1.2 + pnoise(u * 128, v * 128, 128, 128, 95) * 0.2;
  }
  return canvasTex(size, normalFromHeight(h, size, 6), false);
}
