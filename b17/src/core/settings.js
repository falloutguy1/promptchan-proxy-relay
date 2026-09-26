// Quality presets + persisted user settings.

export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const IS_MOBILE = IS_TOUCH && Math.min(screen.width, screen.height) < 900;

export const PRESETS = {
  low: {
    label: 'Low', renderScale: 0.65, maxDpr: 1, texRes: '1k', shadows: 1, shadowSize: 1024, cascades: 2,
    maskRes: 2048, treeRadius: 900, treeDensity: 0.45, treeNear: 90, buildingLod: 160, gtao: false, bloom: false,
    msaa: 0, smaa: false, anisotropy: 2, terrainDetail: 0, particles: 0.5, chunkRes: 33,
  },
  medium: {
    label: 'Medium', renderScale: 0.85, maxDpr: 1.5, texRes: '1k', shadows: 1, shadowSize: 2048, cascades: 3,
    maskRes: 2048, treeRadius: 1500, treeDensity: 0.7, treeNear: 160, buildingLod: 280, gtao: false, bloom: true,
    msaa: 0, smaa: true, anisotropy: 4, terrainDetail: 1, particles: 0.8, chunkRes: 65,
  },
  high: {
    label: 'High', renderScale: 1.0, maxDpr: 2, texRes: '2k', shadows: 1, shadowSize: 2048, cascades: 3,
    maskRes: 4096, treeRadius: 2200, treeDensity: 1.0, treeNear: 260, buildingLod: 420, gtao: true, bloom: true,
    msaa: 4, smaa: false, anisotropy: 8, terrainDetail: 2, particles: 1, chunkRes: 65,
  },
  ultra: {
    label: 'Ultra', renderScale: 1.0, maxDpr: 2.5, texRes: '2k', shadows: 1, shadowSize: 4096, cascades: 4,
    maskRes: 4096, treeRadius: 3000, treeDensity: 1.0, treeNear: 400, buildingLod: 650, gtao: true, bloom: true,
    msaa: 4, smaa: false, anisotropy: 16, terrainDetail: 2, particles: 1, chunkRes: 129,
  },
};

const KEY = 'b17-settings-v1';

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && PRESETS[s.preset]) return s;
  } catch (e) { /* storage unavailable */ }
  return null;
}

export const settings = (() => {
  const saved = load();
  const preset = saved?.preset || (IS_MOBILE ? 'low' : 'medium');
  return {
    preset,
    renderScale: saved?.renderScale ?? PRESETS[preset].renderScale,
    volume: saved?.volume ?? 0.7,
    invertY: saved?.invertY ?? false,
    showFps: saved?.showFps ?? false,
    mouseSens: saved?.mouseSens ?? 1,
  };
})();

export function q() { return PRESETS[settings.preset]; }

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}
