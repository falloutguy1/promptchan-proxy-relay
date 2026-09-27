// Captures screenshots from the running game with headless Chromium.
// usage: node tools/screenshots.mjs <shotName...>   (shot names are defined in src/debug.js)
// env: QUALITY=high|medium|low  W=1600 H=900  GPU=1 (use host GPU instead of SwiftShader)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { server } from './serve.mjs';

const shots = process.argv.slice(2);
const W = Number(process.env.W || 1600), H = Number(process.env.H || 900);
const q = process.env.QUALITY || 'high';
fs.mkdirSync('tools/out', { recursive: true });
const args = process.env.GPU ? ['--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:8080/index.html?debug=1&quality=${q}`);
await page.waitForFunction(() => window.__ready === true || window.__failed, null, { timeout: 600000 });
const failed = await page.evaluate(() => window.__failed);
if (failed) { console.log('FAILED:', failed); console.log(logs.join('\n')); await page.screenshot({ path: 'tools/out/_failed.png' }); await browser.close(); server.close(); process.exit(1); }
if (process.env.PRE) console.log('pre:', await page.evaluate(process.env.PRE));
for (const name of shots) {
  const t0 = Date.now();
  const info = await page.evaluate(async (n) => window.__shot(n), name);
  if (info.img) fs.writeFileSync(`tools/out/${name}.png`, Buffer.from(info.img.split(',')[1], 'base64'));
  delete info.img;
  if (process.env.UI) await page.screenshot({ path: `tools/out/${name}_ui.png`, timeout: 300000 });
  console.log('shot', name, JSON.stringify(info), `${Date.now() - t0}ms`);
}
const perf = await page.evaluate(() => window.__perf && window.__perf());
if (perf) console.log('perf', JSON.stringify(perf));
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(-40).join('\n'));
await browser.close();
server.close();
