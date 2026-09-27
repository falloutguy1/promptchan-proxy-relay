// Quality presets, device detection, persistence and URL overrides.

const STORE_KEY = 'rustwater.settings.v1';

export const PRESETS = {
  low: {
    renderScale: 0.65, dprCap: 1, shadowSize: 1024, shadowRadius: 1.5, shadowDistance: 70, ao: 'off', bloom: false, aa: 'fxaa',
    grassDensity: 0.3, grassDistance: 34, treeDetail: 0.5, drawDistance: 520, anisotropy: 2, texTier: 'lo', maxPointLights: 2, envRes: 128,
  },
  medium: {
    renderScale: 0.85, dprCap: 1.5, shadowSize: 2048, shadowRadius: 2, shadowDistance: 100, ao: 'half', bloom: true, aa: 'smaa',
    grassDensity: 0.55, grassDistance: 48, treeDetail: 0.75, drawDistance: 750, anisotropy: 4, texTier: 'lo', maxPointLights: 4, envRes: 256,
  },
  high: {
    renderScale: 1, dprCap: 2, shadowSize: 4096, shadowRadius: 2.5, shadowDistance: 140, ao: 'full', bloom: true, aa: 'smaa',
    grassDensity: 1, grassDistance: 64, treeDetail: 1, drawDistance: 1000, anisotropy: 8, texTier: 'hi', maxPointLights: 6, envRes: 256,
  },
  ultra: {
    renderScale: 1, dprCap: 2.5, shadowSize: 4096, shadowRadius: 3, shadowDistance: 190, ao: 'full', bloom: true, aa: 'msaa',
    grassDensity: 1.35, grassDistance: 86, treeDetail: 1, drawDistance: 1400, anisotropy: 16, texTier: 'hi', maxPointLights: 8, envRes: 512,
  },
};

export function detectDevice() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  const ua = navigator.userAgent || '';
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = mobileUA || (coarse && small);
  return { mobile, touch: coarse || navigator.maxTouchPoints > 0, mem, cores };
}

export function defaultPreset(device) {
  if (device.mobile) return device.mem >= 6 ? 'medium' : 'low';
  if (device.mem <= 4 || device.cores <= 2) return 'medium';
  return 'high';
}

export class Settings {
  constructor() {
    this.device = detectDevice();
    const saved = this.#load();
    this.preset = saved?.preset || defaultPreset(this.device);
    this.values = { ...PRESETS[this.preset] || PRESETS.high, ...(saved?.overrides || {}) };
    this.overrides = saved?.overrides || {};
    this.ui = saved?.ui || 'auto'; // auto | desktop | mobile
    this.dynamicRes = saved?.dynamicRes ?? true;
    this.showFps = saved?.showFps ?? false;
    this.volume = saved?.volume ?? 0.7;
    this.edgeScroll = saved?.edgeScroll ?? false;
    this.url = new URLSearchParams(location.search);
    this.#applyUrl();
  }
  #load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { return null; }
  }
  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ preset: this.preset, overrides: this.overrides, ui: this.ui, dynamicRes: this.dynamicRes, showFps: this.showFps, volume: this.volume, edgeScroll: this.edgeScroll }));
    } catch { /* storage unavailable: settings last for this session only */ }
  }
  #applyUrl() {
    const q = this.url;
    if (q.has('quality') && PRESETS[q.get('quality')]) { this.preset = q.get('quality'); this.overrides = {}; this.values = { ...PRESETS[this.preset] }; }
    if (q.has('tex')) this.values.texTier = q.get('tex') === 'lo' ? 'lo' : 'hi';
    if (q.has('scale')) this.values.renderScale = Math.min(1, Math.max(0.3, parseFloat(q.get('scale'))));
    if (q.has('ui')) this.ui = q.get('ui');
    if (q.has('fps')) this.showFps = q.get('fps') !== '0';
    if (q.has('review')) this.dynamicRes = false;
  }
  setPreset(name) {
    if (!PRESETS[name]) return;
    this.preset = name; this.overrides = {}; this.values = { ...PRESETS[name] };
    this.save();
  }
  set(key, value) {
    this.values[key] = value;
    this.overrides[key] = value;
    this.save();
  }
  get isTouchUI() {
    if (this.ui === 'mobile') return true;
    if (this.ui === 'desktop') return false;
    return this.device.mobile;
  }
  get review() { return this.url.has('review'); }
}
