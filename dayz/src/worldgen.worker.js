// Generates the heightfield and surface (splat) maps off the main thread.
import { WORLD, Heightfield, sculpt, surface, forestMask, L } from './layout.js';

function splat(size, res, hf) {
  const A = new Uint8Array(res * res * 4), B = new Uint8Array(res * res * 4);
  const w = new Float32Array(6), feat = {};
  const half = size / 2, step = size / res;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = -half + (i + 0.5) * step, z = -half + (j + 0.5) * step;
      const h = sculpt(x, z, feat);
      const slope = hf.slope(x, z);
      surface(x, z, h, slope, feat, w);
      const k = (j * res + i) * 4;
      A[k] = w[0] * 255 + 0.5; A[k + 1] = w[1] * 255 + 0.5; A[k + 2] = w[2] * 255 + 0.5; A[k + 3] = w[3] * 255 + 0.5;
      B[k] = w[4] * 255 + 0.5; B[k + 1] = w[5] * 255 + 0.5;
      // Baked sky occlusion: forest canopy + the house footprint shadowing surrounding ground.
      const fm = forestMask(x, z);
      const dh = Math.max(Math.abs(x - WORLD.house.x) - WORLD.house.w / 2, Math.abs(z - WORLD.house.z) - WORLD.house.d / 2);
      const houseOcc = dh < 0 ? 0.45 : 1 - 0.35 * Math.exp(-dh / 0.9);
      B[k + 2] = Math.min(1, (1 - 0.45 * fm) * houseOcc) * 255;
      B[k + 3] = fm * 255; // forest density, used for tint and grass suppression
    }
  }
  return { A, B };
}

self.onmessage = () => {
  const t0 = performance.now();
  const hf = new Heightfield();
  const t1 = performance.now();
  const fine = splat(WORLD.splatSize, WORLD.splatRes, hf);
  const coarse = splat(WORLD.size, 256, hf);
  const t2 = performance.now();
  self.postMessage({ heights: hf.data, N: hf.N, fine, coarse, ms: { heights: t1 - t0, splat: t2 - t1 } },
    [hf.data.buffer, fine.A.buffer, fine.B.buffer, coarse.A.buffer, coarse.B.buffer]);
};
