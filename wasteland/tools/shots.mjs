// Visual review harness: loads the running game in headless Chromium (WebGL2 via
// SwiftShader when no GPU is present), places the camera for each named shot and
// saves screenshots captured from the game canvas.
// usage: node shots.mjs [shots.json] [--out dir] [--q high] [--w 1280 --h 720] [--mobile] [--only a,b]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const shotFile = args.find((a) => a.endsWith('.json')) || join(here, 'shots.json');
const out = opt('out', join(here, '.cache', 'shots'));
const quality = opt('q', 'high');
const W = Number(opt('w', 1280)), H = Number(opt('h', 720));
const only = opt('only', '');
const extra = opt('params', '');
mkdirSync(out, { recursive: true });

const shots = JSON.parse(readFileSync(shotFile, 'utf8')).filter((s) => !only || only.split(',').includes(s.name));

async function ensureServer() {
  try { await fetch('http://localhost:8080/wasteland/index.html'); return null; } catch { /* start it */ }
  const p = spawn(process.execPath, [join(here, 'serve.mjs')], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 50; i++) { await new Promise((r) => setTimeout(r, 100)); try { await fetch('http://localhost:8080/wasteland/index.html'); return p; } catch { /* retry */ } }
  throw new Error('server did not start');
}

const server = await ensureServer();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext(flag('mobile')
  ? { viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const url = `http://localhost:8080/wasteland/?review=1&quality=${quality}${extra ? '&' + extra : ''}`;
const t0 = Date.now();
await page.goto(url);
try {
  await page.waitForFunction(() => window.__wl && window.__wl.ready, null, { timeout: 600000, polling: 1000 });
} catch (e) {
  console.log('LOAD FAILED', e.message);
  console.log(logs.join('\n'));
  await page.screenshot({ path: join(out, '_failed.png') });
  await browser.close(); server?.kill(); process.exit(1);
}
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(JSON.stringify(await page.evaluate(() => window.__wl.info()), null, 1));

const report = [];
for (const s of shots) {
  const t1 = Date.now();
  await page.evaluate(async (s) => {
    const wl = window.__wl;
    if (s.time !== undefined) wl.time(s.time);
    if (s.weather) wl.weather(s.weather);
    if (s.eval) await eval(s.eval);
    if (s.rts) wl.rts(...s.rts); else if (s.view) wl.view(s.view);
    await wl.frames(s.frames || 4, s.dt || 1 / 30);
  }, s);
  const file = join(out, `${s.name}.png`);
  await page.screenshot({ path: file, timeout: 180000 });
  const st = await page.evaluate(() => window.__wl.stats());
  report.push({ name: s.name, ms: Date.now() - t1, ...st });
  console.log(`${s.name}: ${Date.now() - t1}ms calls=${st.calls} tris=${st.triangles}`);
}
writeFileSync(join(out, 'report.json'), JSON.stringify({ url, logs, report }, null, 1));
if (logs.length) console.log('console:\n' + logs.slice(0, 40).join('\n'));
await browser.close();
server?.kill();
