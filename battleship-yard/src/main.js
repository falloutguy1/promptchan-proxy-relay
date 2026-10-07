import { Renderer, PRESETS } from './engine/Renderer.js';
import { Game } from './game/Game.js';
import { UI } from './ui/ui.js';

const fill = document.getElementById('ld-fill');
const text = document.getElementById('ld-text');
const errBox = document.getElementById('ld-error');

function showError(title, detail) {
  errBox.hidden = false;
  errBox.innerHTML = '';
  const h = document.createElement('b'); h.textContent = title;
  const p = document.createElement('p'); p.textContent = detail;
  const retry = document.createElement('button'); retry.textContent = 'Retry'; retry.onclick = () => location.reload();
  errBox.append(h, p, retry);
  text.textContent = 'Stopped.';
}

function detectQuality() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  const mem = navigator.deviceMemory || 8;
  if (coarse && (small || mem <= 4)) return 'low';
  if (coarse || mem <= 4) return 'medium';
  return 'high';
}

const settings = {
  quality: detectQuality(), scale: null, showPerf: false,
  load() {
    try { Object.assign(this, JSON.parse(localStorage.getItem('bsy.settings') || '{}')); } catch { /* ignore */ }
    const q = new URLSearchParams(location.search).get('quality');
    if (q && PRESETS[q]) this.quality = q;
    if (new URLSearchParams(location.search).has('perf')) this.showPerf = true;
    if (!PRESETS[this.quality]) this.quality = 'medium';
    if (!this.scale) this.scale = PRESETS[this.quality].scale;
  },
  save() { try { localStorage.setItem('bsy.settings', JSON.stringify({ quality: this.quality, scale: this.scale, showPerf: this.showPerf })); } catch { /* ignore */ } },
};

async function start() {
  settings.load();
  let R;
  try {
    R = new Renderer(document.getElementById('view'));
  } catch (e) {
    showError('WebGL 2 is required', `${e.message} Try an up-to-date Chrome, Edge, Firefox or Safari 15+, and make sure hardware acceleration is enabled.`);
    return;
  }
  const quality = R.applyQuality ? { ...PRESETS[settings.quality], key: settings.quality } : null;
  const game = new Game(R, quality);
  window.__game = game; // handy for debugging and automated captures
  let failed;
  try {
    failed = await game.init((p, label) => {
      fill.style.width = `${Math.round(p * 100)}%`;
      if (label) text.textContent = label;
    });
  } catch (e) {
    console.error(e);
    showError('Could not build the scene', String(e?.message || e));
    return;
  }
  R.renderScale = settings.scale;
  R.resize();
  const ui = new UI(game, settings);
  if (failed?.length) ui.toast(`${failed.length} asset(s) failed to load — shown with fallback materials.`);
  window.addEventListener('resize', () => R.resize());
  document.getElementById('loading').classList.add('done');
  setTimeout(() => (document.getElementById('loading').hidden = true), 700);
  R.renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); showError('Graphics context lost', 'The GPU reset or ran out of memory. Reload, and consider a lower quality preset.'); document.getElementById('loading').hidden = false; });
  const loop = () => {
    if (!window.__pause) { game.update(); ui.tick(); } // __pause: automated captures step frames manually
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__ready = true;
}

start();
