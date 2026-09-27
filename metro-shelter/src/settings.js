// Persisted player settings.
const KEY = 'metro-shelter-settings';
const defaults = { quality: 'high', scale: null, fov: 60, sens: 1, volume: 0.8, perf: false };
let stored = {};
try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { stored = {}; }
export const settings = { ...defaults, ...stored };
export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ } }
