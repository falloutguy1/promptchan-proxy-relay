// Simulation smoke test: boots the game headless (review mode), starts a colony
// and fast-forwards the simulation without rendering, printing the colony state
// every few game hours and any console errors.
// usage: node smoke.mjs [--mode ai|human] [--diff normal] [--hours 48] [--step 6] [--q low]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const mode = opt('mode', 'ai'), diff = opt('diff', 'normal'), hours = Number(opt('hours', 48)), stepH = Number(opt('step', 6)), q = opt('q', 'low');

async function ensureServer() {
  try { await fetch('http://localhost:8080/wasteland/index.html'); return null; } catch { /* start */ }
  const p = spawn(process.execPath, [join(here, 'serve.mjs')], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { await new Promise((r) => setTimeout(r, 100)); try { await fetch('http://localhost:8080/wasteland/index.html'); return p; } catch { /* retry */ } }
  throw new Error('server did not start');
}
const server = await ensureServer();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
const t0 = Date.now();
await page.goto(`http://localhost:8080/wasteland/?review=1&quality=${q}`);
await page.waitForFunction(() => window.__wl && window.__wl.ready, null, { timeout: 600000, polling: 1000 }).catch((e) => { console.log('LOAD FAILED', e.message, logs.join('\n')); process.exit(1); });
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(JSON.stringify(await page.evaluate(({ mode, diff }) => window.__wl.newGame(mode, diff), { mode, diff })));
for (let h = 0; h < hours; h += stepH) {
  const st = await page.evaluate((n) => window.__wl.simulate(n), stepH);
  console.log(`\n=== +${h + stepH}h  (${st.ms} ms)  day ${st.day} ${st.hour}  pop ${st.pop}/${st.beds} beds  morale ${st.morale}  infected ${st.infected}  obj: ${st.objective}`);
  console.log('res', JSON.stringify(st.res), 'stats', JSON.stringify(st.stats));
  console.log('structures', st.structures.join(' '));
  console.log('jobs', st.jobs.join(' | '));
  console.log('log\n  ' + st.log.join('\n  '));
  if (st.ended) { console.log('ENDED', st.ended); break; }
}
if (logs.length) console.log('\nconsole:\n' + logs.slice(0, 30).join('\n'));
await browser.close();
server?.kill();
