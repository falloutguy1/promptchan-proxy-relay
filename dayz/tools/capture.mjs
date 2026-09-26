// Runs the actual game in headless Chromium and captures screenshots / timings.
//   node tools/capture.mjs <outDir> [quality] [views.json] [--size=1280x720] [--bench]
// Views: [{name, set: [x,y,z,yaw,pitch]} | {name, cam:[px,py,pz,tx,ty,tz]}]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const pos = args.filter((a) => !a.startsWith('--'));
const outDir = pos[0] || 'shots';
const quality = pos[1] || 'high';
const views = pos[2] ? JSON.parse(fs.readFileSync(pos[2], 'utf8')) : [{ name: 'spawn' }];
const [W, H] = (flags.size || '1280x720').split('x').map(Number);
fs.mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    const idx = path.join(p, 'index.html');
    if (fs.existsSync(idx)) { res.writeHead(200, { 'Content-Type': 'text/html' }); return fs.createReadStream(idx).pipe(res); }
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const log = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(`http://localhost:${port}/index.html?capture&quality=${quality}${flags.hud ? '&hud' : ''}${flags.perf ? '&perf' : ''}`);
try {
  await page.waitForFunction(() => window.__dayz?.ready || window.__dayz?.fatal, null, { timeout: 600000, polling: 500 });
} catch (e) { log.push('timeout waiting for ready'); }
const loadErr = await page.evaluate(() => document.getElementById('load-error')?.textContent);
console.log('ready in', ((Date.now() - t0) / 1000).toFixed(1), 's', loadErr ? 'ERRORS:\n' + loadErr : '');
const stats = await page.evaluate(() => window.__dayz?.stats);
console.log('stats', JSON.stringify(stats));

for (const v of views) {
  await page.evaluate((v) => {
    const g = window.__dayz;
    if (!g?.ready) return;
    if (v.quality) { /* handled by reload */ }
    if (v.set) g.setView(...v.set);
    if (v.cam) g.setCamera(...v.cam);
    if (v.camRel) { const c = v.camRel; const h = (x, z) => g.hf.height(x, z); g.setCamera(c[0], h(c[0], c[2]) + c[1], c[2], c[3], h(c[3], c[5]) + c[4], c[5]); }
    g.freeze(true);
  }, v);
  // render a few frames (LOD selection, shadow update), then read the canvas back
  const t1 = Date.now();
  const data = await page.evaluate((n) => { window.__dayz.step(n); return window.__dayz.grab(); }, v.frames || 2);
  fs.writeFileSync(path.join(outDir, `${v.name}.png`), Buffer.from(data.split(',')[1], 'base64'));
  console.log('  frame time (software GL):', ((Date.now() - t1) / (v.frames || 2)).toFixed(0), 'ms');
  console.log('shot', v.name);
}

if (flags.bench) {
  // steady-state timing at the current view: average frame interval over N frames
  const r = await page.evaluate(async (n) => {
    const g = window.__dayz;
    const t = [];
    for (let i = 0; i < n; i++) { const a = performance.now(); g.step(1); g.renderer.getContext().finish(); t.push(performance.now() - a); }
    t.sort((a, b) => a - b);
    const i = g.renderer.info;
    return { avgMs: t.reduce((a, b) => a + b) / t.length, p50: t[Math.floor(t.length / 2)], p95: t[Math.floor(t.length * 0.95)],
      draws: i.render.calls, tris: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries,
      canvas: [g.renderer.domElement.width, g.renderer.domElement.height] };
  }, Number(flags.bench === true ? 20 : flags.bench));
  console.log('bench', JSON.stringify(r));
}
fs.writeFileSync(path.join(outDir, 'console.log'), log.join('\n'));
if (log.length) console.log(log.slice(0, 30).join('\n'));
await browser.close();
server.close();
