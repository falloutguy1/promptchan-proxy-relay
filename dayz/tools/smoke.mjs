// Functional smoke test in headless Chromium: loads the game, walks the player,
// checks collision against the house wall, opens the front door, picks up loot.
//   node tools/smoke.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  const t = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm' }[path.extname(p)];
  res.writeHead(200, t ? { 'Content-Type': t } : {}); fs.createReadStream(p).pipe(res);
}).listen(0);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${server.address().port}/index.html?capture&hud&quality=low`);
await page.waitForFunction(() => window.__dayz?.ready || window.__dayz?.fatal, null, { timeout: 600000, polling: 500 });
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name} ${detail}`); };

const r = await page.evaluate(async () => {
  const g = window.__dayz, p = g.player, out = {};
  p.enabled = true; g.freeze(false);
  const key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
  // 1) walk north from the yard into the front wall (left of the door): must stop at the wall
  g.setView(-3.8, null, 8, 0, 0);
  key('KeyW', true); g.step(90, 1 / 30); key('KeyW', false);
  out.wallZ = p.pos.z;
  // 2) face the front door from the porch and open it
  g.setView(-1.6, null, 5.2, 0, -0.15); g.step(2, 1 / 30);
  out.prompt = document.getElementById('prompt').textContent;
  key('KeyE', true); key('KeyE', false); g.step(40, 1 / 30);
  out.doorOpen = g.ctx.doors.find((d) => d.name === 'front').open;
  // 3) walk through the door into the kitchen
  key('KeyW', true); g.step(60, 1 / 30); key('KeyW', false);
  out.inside = p.pos.z < 3.4 && p.pos.y > g.hf.height(p.pos.x, p.pos.z) + 0.3;
  out.pos = [p.pos.x, p.pos.y, p.pos.z].map((v) => +v.toFixed(2));
  // 4) look at the water bottle on the kitchen table and take it
  const table = new g.ctx.THREE.Vector3(-3.45 + 0, 0, 1.3);
  g.setView(-2.3, null, 1.3, Math.PI / 2, -0.55); g.step(2, 1 / 30);
  out.lootPrompt = document.getElementById('prompt').textContent;
  const water0 = g.ctx.state.water;
  key('KeyE', true); key('KeyE', false); g.step(1, 1 / 30);
  out.waterGain = g.ctx.state.water - water0;
  return out;
});
check('player stops at exterior wall', r.wallZ > 4.0 && r.wallZ < 4.6, `(z=${r.wallZ.toFixed(2)})`);
check('door interaction prompt', /door/i.test(r.prompt), `("${r.prompt}")`);
check('front door opens', r.doorOpen === true);
check('player can enter house on floor level', r.inside, JSON.stringify(r.pos));
check('loot prompt', /Take/.test(r.lootPrompt), `("${r.lootPrompt}")`);
check('using water bottle raises water', r.waterGain > 20, `(+${r.waterGain.toFixed(1)})`);
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close(); server.close();
