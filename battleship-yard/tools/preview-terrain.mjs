// Renders top-down previews of the generated terrain (height shading + splat colours) for layout review.
import sharp from 'sharp';
import { generateTerrain } from '../src/world/terrainGen.js';
const t0 = Date.now();
const g = generateTerrain();
console.log('generated', g.nx, g.nz, Date.now() - t0, 'ms');
const { nx, nz, heights, splatA, splatB } = g;
const img = Buffer.alloc(nx * nz * 3);
const cols = [[70, 110, 40], [150, 140, 80], [140, 130, 115], [90, 70, 50], [110, 105, 100], [200, 185, 150]];
for (let k = 0; k < nx * nz; k++) {
  const h = heights[k];
  const w = [splatA[k * 4], splatA[k * 4 + 1], splatA[k * 4 + 2], splatA[k * 4 + 3], splatB[k * 4], splatB[k * 4 + 1]];
  let c = [0, 0, 0];
  for (let l = 0; l < 6; l++) for (let q = 0; q < 3; q++) c[q] += cols[l][q] * w[l] / 255;
  const ao = splatB[k * 4 + 3] / 255;
  if (h < 0) c = [20 + 60 * Math.max(0, 1 + h / 30), 60 + 80 * Math.max(0, 1 + h / 30), 100 + 60 * Math.max(0, 1 + h / 30)];
  const i = k; // row j = z index; z0 at top (north = land)
  for (let q = 0; q < 3; q++) img[i * 3 + q] = Math.min(255, c[q] * (0.5 + 0.5 * ao) * (h < 0 ? 1 : 1));
}
await sharp(img, { raw: { width: nx, height: nz, channels: 3 } }).resize(1200).jpeg().toFile(process.argv[2]);
let mn = 1e9, mx = -1e9; for (const h of heights) { mn = Math.min(mn, h); mx = Math.max(mx, h); }
console.log('height range', mn.toFixed(1), mx.toFixed(1));
