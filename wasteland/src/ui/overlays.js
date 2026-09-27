// Loading screen and fatal-error overlay.
const $ = (id) => document.getElementById(id);

const TIPS = [
  'Water runs out faster than food. Build rain collectors before the first dry spell.',
  'The dead are drawn to light and noise. Walls and watchtowers buy your people time at night.',
  'Scavengers find more in unlooted ruins, but every run carries risk.',
  'Morale falls when survivors go hungry, sleep rough or lose friends. Campfires help.',
  'Switch the AI Overseer on at any time with Tab and read its reasoning in the log.',
  'Press V (or the eye button on a survivor) to walk the settlement at eye level.',
  'Rain fills collectors and turns the tracks to mud. Fog hides the dead until they are close.',
];

export class Loading {
  constructor() {
    this.el = $('loading');
    this.fill = $('load-fill');
    this.label = $('load-label');
    this.detail = $('load-detail');
    this.tip = $('load-tip');
    this.tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    this.stage = 0; this.stages = 1; this.sub = 0;
  }
  setStages(n) { this.stages = n; }
  stageStart(i, text) { this.stage = i; this.sub = 0; this.label.textContent = text; this.#draw(); }
  progress(done, total, label) {
    this.sub = total ? done / total : 0;
    this.detail.textContent = label ? `${done}/${total} · ${label}` : '';
    this.#draw();
  }
  #draw() {
    const p = Math.min(1, (this.stage + this.sub) / this.stages);
    this.fill.style.width = `${(p * 100).toFixed(1)}%`;
  }
  hide() { this.el.classList.add('hidden'); }
  show() { this.el.classList.remove('hidden'); }
}

export function showError(title, err, { allowLow = true } = {}) {
  const box = $('error');
  $('err-title').textContent = title || 'Something went wrong';
  const msg = err?.message || String(err || '');
  $('err-msg').textContent = friendly(msg);
  $('err-detail').textContent = (err && err.stack) ? err.stack : msg;
  $('err-low').classList.toggle('hidden', !allowLow);
  box.classList.remove('hidden');
  $('err-reload').onclick = () => location.reload();
  $('err-low').onclick = () => {
    try {
      const s = JSON.parse(localStorage.getItem('rustwater.settings.v1') || '{}');
      s.preset = 'low'; s.overrides = {};
      localStorage.setItem('rustwater.settings.v1', JSON.stringify(s));
    } catch { /* ignore */ }
    const u = new URL(location.href); u.searchParams.set('quality', 'low'); location.href = u.href;
  };
}

function friendly(msg) {
  if (/webgl2|WebGL 2/i.test(msg)) return 'Your browser or GPU does not provide WebGL2. Try an up-to-date Chrome, Edge, Firefox or Safari 15+, and make sure hardware acceleration is enabled.';
  if (/context lost/i.test(msg)) return 'The graphics context was lost (the GPU reset or ran out of memory). Reloading on a lower quality preset usually fixes this.';
  if (/fetch|404|NetworkError|Failed to load/i.test(msg)) return `A required file could not be downloaded: ${msg}. Check your connection and reload.`;
  if (/memory|allocation/i.test(msg)) return 'The device ran out of graphics memory. Try the Low preset.';
  return msg;
}

export function webgl2Support() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { ok: false, reason: 'WebGL2 context could not be created' };
    const r = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = r ? gl.getParameter(r.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, renderer };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
