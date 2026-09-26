// Quality presets. Every knob that costs GPU time lives here so the settings
// menu (and ?quality=… / ?scale=… URL params) can drive them.
export const PRESETS = {
  low: {
    renderScale: 0.67, shadowMapSize: 1024, shadowRadius: 45, ao: false, aa: 'fxaa',
    grassRadius: 22, grassDensity: 0.45, treeFullDist: 45, treeImpostorDist: 420, propDist: 70,
    anisotropy: 2, terrainDetail: 0,
  },
  medium: {
    renderScale: 0.85, shadowMapSize: 2048, shadowRadius: 60, ao: true, aa: 'fxaa',
    grassRadius: 32, grassDensity: 0.7, treeFullDist: 70, treeImpostorDist: 600, propDist: 110,
    anisotropy: 4, terrainDetail: 1,
  },
  high: {
    renderScale: 1.0, shadowMapSize: 4096, shadowRadius: 70, ao: true, aa: 'smaa',
    grassRadius: 42, grassDensity: 1.0, treeFullDist: 95, treeImpostorDist: 800, propDist: 160,
    anisotropy: 8, terrainDetail: 1,
  },
  ultra: {
    renderScale: 1.0, shadowMapSize: 4096, shadowRadius: 85, ao: true, aa: 'smaa',
    grassRadius: 55, grassDensity: 1.3, treeFullDist: 130, treeImpostorDist: 900, propDist: 220,
    anisotropy: 16, terrainDetail: 1,
  },
};

const params = new URLSearchParams(location.search);

function loadSaved() {
  try { return JSON.parse(localStorage.getItem('dayz-settings') || '{}'); } catch { return {}; }
}

export const settings = {
  quality: 'high',
  renderScale: null, // null = preset value
  fov: 55,           // vertical degrees; ~85° horizontal at 16:9, avoids wide-angle stretch
  sensitivity: 1.0,
  showPerf: false,
  ...loadSaved(),
};
if (params.has('quality') && PRESETS[params.get('quality')]) settings.quality = params.get('quality');
if (params.has('scale')) settings.renderScale = parseFloat(params.get('scale'));
if (params.has('perf')) settings.showPerf = true;

export function saveSettings() {
  try { localStorage.setItem('dayz-settings', JSON.stringify(settings)); } catch { /* private mode */ }
}

export function Q() {
  const p = PRESETS[settings.quality] || PRESETS.high;
  return { ...p, renderScale: settings.renderScale ?? p.renderScale };
}

export const URLP = params;
