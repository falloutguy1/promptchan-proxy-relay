// Loads the game headless and prints asset failures, 404s and texture/format diagnostics.
import { chromium } from 'playwright';
const url = process.argv[2];
const code = process.argv[3] || '';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 300)); });
await page.goto(url);
await page.waitForFunction(() => window.__ready || document.querySelector('#ld-error:not([hidden])'), null, { timeout: 600000 });
await page.evaluate(() => { window.__pause = true; });
console.log(await page.evaluate((c) => {
  const g = window.__game;
  const out = { failed: g.assets.failed };
  const m = g.lib.get('apron');
  out.apron = m && m.map ? { fmt: m.map.format, w: m.map.image?.width, mips: m.map.mipmaps?.length, type: m.map.constructor.name, repeat: m.map.repeat.toArray() } : 'none';
  const tm = g.terrain.material;
  out.ktx = { config: g.assets.ktx2.workerConfig };
  if (c) out.custom = new Function('g', c)(g);
  return JSON.stringify(out, null, 1);
}, code));
await browser.close();
