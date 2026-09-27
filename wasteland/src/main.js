// Entry point: capability checks, global error handling, boot.
import { Settings } from './core/settings.js';
import { showError, webgl2Support } from './ui/overlays.js';

const settings = new Settings();
window.__settings = settings;
document.body.classList.toggle('touch', settings.isTouchUI);

let booted = false;
window.addEventListener('error', (e) => {
  if (!booted) showError('Rustwater failed to start', e.error || e.message);
  console.error(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  if (!booted) showError('Rustwater failed to start', e.reason);
  console.error(e.reason);
});

const support = webgl2Support();
if (!support.ok) {
  showError('WebGL2 unavailable', new Error(`WebGL2 is required. ${support.reason}`), { allowLow: false });
} else {
  const { Game } = await import('./game.js');
  const game = new Game(document.getElementById('view'), settings);
  window.__game = game;
  game.onContextLost = () => showError('Graphics context lost', new Error('WebGL context lost'));
  try {
    await game.boot();
    booted = true;
  } catch (e) {
    console.error(e);
    showError('Rustwater failed to start', e);
  }
}
