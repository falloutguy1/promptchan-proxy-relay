// Character review: plays an AI colony in the running game and frames close-ups
// of individual survivors (whatever they are doing) and of the infected at night.
// usage: node char_shots.mjs [--out dir] [--q high] [--hours 30] [--n 6]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = opt('out', join(here, '.cache', 'chars_review'));
const q = opt('q', 'high'), hours = Number(opt('hours', 30)), n = Number(opt('n', 6));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT/.test(m.text())) logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:8080/wasteland/?review=1&quality=${q}`);
await page.waitForFunction(() => window.__wl && window.__wl.ready, null, { timeout: 600000, polling: 1000 });
await page.evaluate((h) => { window.__wl.newGame('ai', 'normal'); window.__game.hud.setSpeed(1); window.__wl.simulate(h); }, hours);

const shot = async (name, fn, frames = 6) => {
  const t = Date.now();
  const info = await page.evaluate(fn);
  if (!info) return;
  await page.evaluate((f) => window.__wl.frames(f), frames);
  await page.evaluate(() => { window.__game.hud.acc = 1; window.__game.hud.update(0.01); });
  await page.screenshot({ path: join(out, `${name}.png`), timeout: 300000 });
  console.log(`${name}: ${((Date.now() - t) / 1000).toFixed(1)}s ${JSON.stringify(info)}`);
};
// close-up of survivor i: camera 3.4 m in front, slightly to the side, at chest height
const closeUp = (i) => () => {
  const g = window.__game, s = g.sim.alive().filter((q) => !q.c.hidden)[window.__i];
  if (!s) return null;
  const c = s.c, a = c.yaw + 0.45;
  window.__wl.view({ pos: [c.pos.x + Math.sin(a) * 3.4, 1.45 + (c.lift || 0), c.pos.z + Math.cos(a) * 3.4], target: [c.pos.x, 1.0 + (c.lift || 0), c.pos.z], fov: 42 });
  return { who: s.first, job: s.job, act: s.activity, anim: c.anim.state, work: c.anim.work, speed: +c.speed.toFixed(2) };
};
for (let i = 0; i < n; i++) {
  await page.evaluate((k) => { window.__i = k; }, i);
  await shot(`s${i}`, closeUp(i));
}
// a group view of the camp
await shot('camp', () => { const g = window.__game, c = g.sim.center; window.__wl.view({ pos: [c.x + 8, 2.2, c.z + 6], target: [c.x, 0.9, c.z], fov: 50 }); return { hour: window.__wl.state().hour }; });
// night: the infected nearest the camp
await page.evaluate(() => { const s = window.__game.sim; const h = s.hour; window.__wl.simulate(((24 + 1.5 - h) % 24) || 24); });
await shot('z_night', () => {
  const g = window.__game, sim = g.sim, c = sim.center;
  const z = sim.infected.filter((q) => q.alive).sort((a, b) => Math.hypot(a.pos.x - c.x, a.pos.z - c.z) - Math.hypot(b.pos.x - c.x, b.pos.z - c.z))[0];
  if (!z) return { none: true };
  const a = z.c.yaw + 0.3;
  window.__wl.view({ pos: [z.pos.x + Math.sin(a) * 3.2, 1.5, z.pos.z + Math.cos(a) * 3.2], target: [z.pos.x, 1.0, z.pos.z], fov: 45 });
  return { state: z.state, anim: z.c.anim.state, hour: +sim.hour.toFixed(2) };
});
writeFileSync(join(out, 'report.json'), JSON.stringify({ logs }, null, 1));
console.log(logs.length ? logs.slice(0, 10).join('\n') : 'no errors');
await browser.close();
