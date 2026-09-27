// Performance measurement in the running game. For each quality preset: start an
// AI colony, simulate a day and a half, then time frames from three camera
// set-ups (strategy close, strategy wide, first person). Reports CPU time of the
// frame (JS: simulation, culling, command submission) and wall time including a
// GPU sync. NB: in this container WebGL runs on SwiftShader (CPU rasteriser), so
// wall times are far slower than any real GPU; they are only comparable relative
// to each other. CPU/JS times are more representative.
// usage: node bench.mjs [--presets low,medium,high] [--w 1280 --h 720] [--frames 8] [--mobile] [--gpu]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const presets = opt('presets', 'low,medium,high').split(',');
const W = Number(opt('w', 1280)), H = Number(opt('h', 720)), N = Number(opt('frames', 8));
const mobile = args.includes('--mobile');
const out = opt('out', '');
const rows = [];
// --gpu: use the machine's GPU (headed browser) instead of SwiftShader
const gpu = args.includes('--gpu');
const browser = await chromium.launch(gpu
  ? { headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] }
  : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
for (const q of presets) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  await page.goto(`http://localhost:8080/wasteland/?review=1&quality=${q}`);
  await page.waitForFunction(() => window.__wl && window.__wl.ready, null, { timeout: 900000, polling: 1000 });
  const load = (Date.now() - t0) / 1000;
  const sim = await page.evaluate(() => { window.__wl.newGame('ai', 'normal'); const r = window.__wl.simulate(30); return { ms: r.ms, pop: r.pop, structures: r.structures.length }; });
  const views = {
    rts_close: () => { const c = window.__game.sim.center; window.__wl.rts(c.x, c.z, 35, 0.8, 0); },
    rts_wide: () => { const c = window.__game.sim.center; window.__wl.rts(c.x, c.z, 140, 0.3, 0); },
    first_person: () => { const g = window.__game; g.enterWalk(g.sim.alive()[0]); },
  };
  for (const [name, fn] of Object.entries(views)) {
    await page.evaluate(fn);
    await page.evaluate(() => window.__wl.frames(2));
    const r = await page.evaluate((n) => window.__wl.timedFrames(n), N);
    rows.push({ preset: q, view: name, ...r, load: +load.toFixed(1), simDay: sim.ms });
    console.log(q, name, JSON.stringify(r));
    if (name === 'first_person') await page.evaluate(() => window.__game.exitWalk());
  }
  if (errors.length) console.log('errors', errors);
  await ctx.close();
}
await browser.close();
const md = ['| preset | view | CPU ms/frame | wall ms/frame (SwiftShader) | worst | draw calls | triangles | resolution |', '|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.preset} | ${r.view} | ${r.cpu} | ${r.wall} | ${r.wallMax} | ${r.calls} | ${(r.tris / 1e6).toFixed(2)}M | ${r.px.join('×')} |`)].join('\n');
console.log('\n' + md);
if (out) writeFileSync(out, md + '\n');
