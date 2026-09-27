// Draw-call / triangle budget per scene group for a preset and three views.
// usage: node drawstats.mjs [--q low]
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const q = args[args.indexOf('--q') + 1] || 'low';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:8080/wasteland/?review=1&quality=${q}`);
await page.waitForFunction(() => window.__wl && window.__wl.ready, null, { timeout: 900000, polling: 1000 });
await page.evaluate(() => { window.__wl.newGame('ai', 'normal'); window.__wl.simulate(30); });
const views = {
  rts_close: () => { const c = window.__game.sim.center; window.__wl.rts(c.x, c.z, 35, 0.8, 0); },
  rts_wide: () => { const c = window.__game.sim.center; window.__wl.rts(c.x, c.z, 140, 0.3, 0); },
  first_person: () => { const g = window.__game; g.enterWalk(g.sim.alive()[0]); },
};
for (const [name, fn] of Object.entries(views)) {
  await page.evaluate(fn);
  await page.evaluate(() => window.__wl.frames(2));
  const r = await page.evaluate(() => ({ stats: window.__wl.drawStats(), info: window.__wl.stats() }));
  const rows = Object.entries(r.stats).sort((a, b) => (b[1].calls + b[1].shadowCalls) - (a[1].calls + a[1].shadowCalls));
  console.log(`\n== ${q} ${name}: renderer calls ${r.info.calls}, tris ${(r.info.triangles / 1e6).toFixed(2)}M`);
  for (const [k, v] of rows) console.log(`  ${k.padEnd(16)} calls ${String(v.calls).padStart(4)}  shadow ${String(v.shadowCalls).padStart(4)}  tris ${(v.tris / 1e3).toFixed(0).padStart(6)}k`);
  if (name === 'first_person') await page.evaluate(() => window.__game.exitWalk());
}
await browser.close();
