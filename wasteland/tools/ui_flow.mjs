// UI flow test in the live game loop (not review mode): main menu -> new colony ->
// HUD -> colony/survivor panels -> pause -> settings. --mobile uses a touch phone profile.
// usage: node ui_flow.mjs <outdir> [--mobile]
import { chromium } from 'playwright';
const out = process.argv[2];
const mobile = process.argv.includes('--mobile');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext(mobile
  ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/CERT/.test(m.text())) logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto('http://localhost:8080/wasteland/?quality=low');
await page.waitForSelector('#menu:not(.hidden)', { timeout: 600000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/m1_menu.png`, timeout: 300000 });
await page.click('text=New colony', { timeout: 300000 });
await page.click('.mode-card[data-mode="human"]', { timeout: 300000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/m2_new.png`, timeout: 300000 });
await page.click('#btn-start', { timeout: 300000 });
await page.waitForFunction(() => window.__game?.sim?.started, null, { timeout: 60000 });
await page.waitForTimeout(12000);
await page.screenshot({ path: `${out}/m3_game.png`, timeout: 300000 });
const st = await page.evaluate(() => ({ started: window.__game.sim.started, hudHidden: document.getElementById('hud').classList.contains('hidden'), fps: window.__game.perf.fps, speed: window.__game.sim.speed }));
console.log(JSON.stringify(st));
if (mobile) {
  await page.tap('#mobilebar [data-m="build"]', { timeout: 300000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/m4_build.png`, timeout: 300000 });
  await page.tap('#mobilebar [data-m="colony"]', { timeout: 300000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/m5_colony.png`, timeout: 300000 });
} else {
  // select a survivor through the colony panel, then open the pause menu
  await page.keyboard.press('c');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/m4_colony.png`, timeout: 300000 });
  await page.click('#side-panel .roster .nm', { timeout: 300000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/m5_survivor.png`, timeout: 300000 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/m6_pause.png`, timeout: 300000 });
  await page.click('#menu-pause [data-go="settings"]', { timeout: 300000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/m7_settings.png`, timeout: 300000 });
}
console.log(logs.length ? logs.join('\n') : 'no errors');
await browser.close();
