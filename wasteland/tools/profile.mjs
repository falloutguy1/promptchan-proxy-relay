// CPU profile of timed frames in the running game (Chrome DevTools protocol).
// Prints the top functions by self time. usage: node profile.mjs [--q high] [--view rts|walk]
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const q = opt('q', 'high'), view = opt('view', 'rts');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.goto(`http://localhost:8080/wasteland/?review=1&quality=${q}`);
await page.waitForFunction(() => window.__wl && window.__wl.ready, null, { timeout: 900000, polling: 1000 });
await page.evaluate(() => { window.__wl.newGame('ai', 'normal'); window.__wl.simulate(30); });
await page.evaluate((view) => { const g = window.__game, c = g.sim.center; if (view === 'walk') g.enterWalk(g.sim.alive()[0]); else window.__wl.rts(c.x, c.z, 45, 0.8, 0); }, view);
await page.evaluate(() => window.__wl.frames(3));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
// move the camera a little each frame so culling work is exercised
const t = await page.evaluate(async () => {
  const g = window.__game, out = [];
  for (let i = 0; i < 12; i++) { if (g.rig.mode === 'rts') g.rig.pan(1.5, 0); const t0 = performance.now(); g.step(1 / 60); out.push(performance.now() - t0); await new Promise((r) => setTimeout(r, 0)); }
  return out;
});
const { profile } = await cdp.send('Profiler.stop');
const self = new Map(), total = profile.samples.length;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const counts = new Map();
for (const s of profile.samples) counts.set(s, (counts.get(s) || 0) + 1);
for (const [id, c] of counts) {
  const n = byId.get(id); const f = n.callFrame;
  const key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) || 0) + c);
}
console.log('step ms per frame:', t.map((x) => x.toFixed(1)).join(' '));
const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [k, c] of rows) console.log(`${((c / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
await browser.close();
