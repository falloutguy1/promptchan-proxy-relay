// Captures screenshots from the running game for visual review.
// Usage: node tools/capture.mjs <url> <outDir> [shot,shot...] [--w=1280 --h=720]
import { chromium } from 'playwright';
import fs from 'fs';

const [url, out, list] = process.argv.slice(2);
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const W = +arg('w', 1280), H = +arg('h', 720);
fs.mkdirSync(out, { recursive: true });

// Each shot: a function evaluated in the page that positions the camera (and optionally the game state).
const SHOTS = {
  wide: `g.setMode('design'); g.frameShip(); g.rig.goal.yaw = 0.55; g.rig.goal.pitch = 0.22;`,
  bow: `g.setMode('design'); g.frameShip('bow');`,
  stern: `g.setMode('design'); g.frameShip('stern');`,
  bridge: `g.setMode('design'); g.frameShip('mid'); g.rig.goal.dist = 70;`,
  yard: `g.setMode('walk'); g.rig.walk.pos.set(-20, 4.7, -14); g.rig.walk.yaw = 2.6; g.rig.walk.pitch = 0.08;`,
  quay: `g.setMode('walk'); g.rig.walk.pos.set(60, 4.7, -3); g.rig.walk.yaw = -1.75; g.rig.walk.pitch = 0.05;`,
  shed: `g.setMode('walk'); g.rig.walk.pos.set(78, 4.7, -16); g.rig.walk.yaw = Math.PI * 0.97; g.rig.walk.pitch = 0.12;`,
  office: `g.setMode('walk'); g.rig.walk.pos.set(-50, 4.7, -30); g.rig.walk.yaw = Math.PI + 0.5; g.rig.walk.pitch = 0.05;`,
  hills: `g.setMode('design'); g.rig.goalTarget.set(0, 30, -250); g.rig.goal.dist = 520; g.rig.goal.yaw = 0.15; g.rig.goal.pitch = 0.16;`,
  forest: `g.setMode('walk'); g.rig.walk.pos.set(-150, 30, -205); g.rig.walk.yaw = 1.2; g.rig.walk.pitch = 0.05;`,
  aerial: `g.setMode('design'); g.rig.goalTarget.set(0, 0, -100); g.rig.goal.dist = 1300; g.rig.goal.yaw = 0.3; g.rig.goal.pitch = 0.5;`,
  turret: `g.setMode('design'); const t = g.ship.turrets[0]; const p = t.group.getWorldPosition(new g.THREE.Vector3()); g.rig.goalTarget.copy(p); g.rig.goal.dist = 32; g.rig.goal.yaw = 1.2; g.rig.goal.pitch = 0.25;`,
  trials: `g.setMode('trials'); g.ship.throttle = 1; g.ship.position.set(0, 0, 900); g.ship.heading = 0.2; g.ship.speed = g.ship.analysis.speedMs * 0.9;`,
  gunnery: `g.setMode('trials'); g.ship.position.set(-100, 0, 700); g.ship.heading = 0.4; g.ship.syncTransform(); g.gunnery.aim.set(-350, 0, 1500); g.gunnery.aimValid = true; g.gunnery.manualAim = true; for (const t of g.ship.turrets) { const sol = g.gunnery.solution(t, t.group.getWorldPosition(new g.THREE.Vector3()), g.gunnery.aim); let rel = Math.atan2(Math.sin(sol.bearing - g.ship.heading), Math.cos(sol.bearing - g.ship.heading)); t.group.rotation.y = rel; t.pivot.rotation.z = sol.elev; t.reload = 0; t.inArc = true; t.ready = true; } g.ship.root.updateMatrixWorld(true); g.gunnery.fire(); g.rig.goal.yaw = g.ship.heading + 2.4; g.rig.goal.dist = 330; g.rig.goal.pitch = 0.12; g.rig.goalTarget.copy(g.ship.position).setY(15); for (let i = 0; i < 6; i++) { g.gunnery.update(0.05, g.time); }`,
  splash: `g.setMode('trials'); g.ship.position.set(-100, 0, 700); g.ship.syncTransform(); g.gunnery.splashFX(new g.THREE.Vector3(-300, 0, 1300), 0.381, false); g.gunnery.splashFX(new g.THREE.Vector3(-330, 0, 1340), 0.381, false); for (let i = 0; i < 30; i++) g.gunnery.update(0.05, g.time); g.rig.setMode('chase'); g.rig.goalTarget.set(-310, 25, 1320); g.rig.goal.dist = 260; g.rig.goal.yaw = 0.9; g.rig.goal.pitch = 0.08;`,
  sea: `g.setMode('trials'); g.ship.position.set(-200, 0, 1100); g.ship.heading = 0.3; g.rig.goal.yaw = 2.2; g.rig.goal.dist = 300; g.rig.goal.pitch = 0.12;`,
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
try {
  await page.waitForFunction(() => window.__ready || document.querySelector('#ld-error:not([hidden])'), null, { timeout: 600000, polling: 1000 });
} catch (e) { logs.push('timeout waiting for ready'); }
console.log('ready after', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.evaluate(() => { window.__pause = true; });
const err = await page.$eval('#ld-error', (e) => (e.hidden ? '' : e.textContent));
if (err) console.log('LOAD ERROR:', err);
for (const name of (list || Object.keys(SHOTS).join(',')).split(',')) {
  await page.evaluate((code) => { const g = window.__game; new Function('g', code)(g); g.rig.yaw = g.rig.goal.yaw; g.rig.pitch = g.rig.goal.pitch; g.rig.dist = g.rig.goal.dist; g.rig.target.copy(g.rig.goalTarget); }, SHOTS[name]);
  // step frames manually so streaming (terrain LODs, grass, vegetation buckets) settles
  const ts = Date.now();
  const frames = +arg('frames', 4);
  for (let k = 0; k < frames; k++) {
    const ms = await page.evaluate(() => { const g = window.__game; g.clock.getDelta(); const t = performance.now(); g.update(); g.R.renderer.getContext().finish(); return performance.now() - t; });
    if (k === frames - 1) console.log('  frame ms', ms.toFixed(0));
  }
  const perf = await page.evaluate(() => { const i = window.__game.R.renderer.info; return `${i.render.calls} draws, ${(i.render.triangles / 1e6).toFixed(2)}M tris`; });
  await page.screenshot({ path: `${out}/${name}.jpg`, quality: 88, type: 'jpeg', timeout: 180000 });
  console.log('shot', name, ((Date.now() - ts) / 1000).toFixed(1) + 's', perf);
}
fs.writeFileSync(`${out}/console.log`, logs.join('\n'));
console.log(logs.filter((l) => /error|warn/i.test(l)).slice(0, 30).join('\n'));
await browser.close();
