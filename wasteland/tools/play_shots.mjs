// Gameplay review: plays a colony (AI Overseer) in the running game and captures
// screenshots at milestones — strategy view with HUD, construction sites,
// finished structures up close, night with fires, first-person view.
// usage: node play_shots.mjs [--out dir] [--q high] [--w 1280 --h 720] [--mobile] [--only a,b] [--seed n]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const out = opt('out', join(here, '.cache', 'play'));
const q = opt('q', 'high'), W = Number(opt('w', 1280)), H = Number(opt('h', 720));
const only = (opt('only', '') || '').split(',').filter(Boolean);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext(flag('mobile')
  ? { viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: W, height: H } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:8080/wasteland/?review=1&quality=${q}${flag('mobile') ? '&ui=mobile' : ''}`);
await page.waitForFunction(() => window.__wl && window.__wl.ready, null, { timeout: 600000, polling: 1000 });

const shot = async (name, fn, frames = 3) => {
  if (only.length && !only.includes(name)) return;
  const t = Date.now();
  const info = await page.evaluate(fn);
  await page.evaluate((n) => window.__wl.frames(n), frames);
  await page.evaluate(() => { window.__game.hud.acc = 1; window.__game.hud.accSlow = 2; window.__game.hud.update(0.01); });
  await page.screenshot({ path: join(out, `${name}.png`), timeout: 240000 });
  console.log(`${name}: ${((Date.now() - t) / 1000).toFixed(1)}s ${info ? JSON.stringify(info) : ''}`);
};

await page.evaluate(() => { window.__wl.newGame('ai', 'normal'); window.__game.hud.setSpeed(1); });
await shot('p1_start', () => { const g = window.__game, c = g.sim.center; window.__wl.rts(c.x, c.z, 38, 0.75, 0); return window.__wl.state().structures; });
await page.evaluate(() => window.__wl.simulate(3.5));
await shot('p2_sites', () => { const g = window.__game, c = g.sim.center; window.__wl.rts(c.x + 2, c.z + 3, 30, 2.2, 0.05); const s = window.__wl.state(); return s.structures; });
await page.evaluate(() => window.__wl.simulate(28));
await shot('p3_day2', () => { const g = window.__game, c = g.sim.center; window.__wl.rts(c.x, c.z, 62, 0.4, -0.05); return window.__wl.state().structures; });
await shot('p4_close', () => {
  const g = window.__game, sim = g.sim;
  const t = sim.structures.list.find((s) => s.type === 'watchtower' && s.built) || sim.structures.list.find((s) => s.type === 'tent');
  const a = 0.9;
  window.__wl.view({ pos: [t.x + Math.sin(a) * 11, 1.7, t.z + Math.cos(a) * 11], target: [t.x, 2.2, t.z], fov: 50 });
  return t.type;
});
await shot('p5_camp_eye', () => {
  const g = window.__game, c = g.sim.center;
  window.__wl.view({ pos: [c.x + 9, 1.65, c.z + 7], target: [c.x - 2, 0.8, c.z - 1], fov: 55 });
  return null;
});
await page.evaluate(() => window.__wl.simulate(13.5));
await shot('p6_night', () => { const g = window.__game, c = g.sim.center; window.__wl.rts(c.x, c.z, 34, 1.3, 0.05); return { hour: window.__wl.state().hour }; }, 4);
await shot('p7_night_eye', () => {
  const g = window.__game, sim = g.sim, f = sim.structures.list.find((s) => s.type === 'campfire');
  window.__wl.view({ pos: [f.x + 5.5, 1.6, f.z + 3.5], target: [f.x, 0.6, f.z], fov: 55 });
  return null;
}, 24); // enough frames for the fire's particles to reach a steady state
await page.evaluate(() => window.__wl.simulate(10));
await shot('p8_walk', () => {
  const g = window.__game, s = g.sim.alive().find((q) => q.armed) || g.sim.alive()[0];
  g.enterWalk(s);
  return { who: s.first, hour: window.__wl.state().hour };
});
writeFileSync(join(out, 'report.json'), JSON.stringify({ logs }, null, 1));
console.log(logs.length ? logs.slice(0, 20).join('\n') : 'no errors');
await browser.close();
