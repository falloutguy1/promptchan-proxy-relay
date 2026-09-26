import { Game } from './game.js';

const $ = (id) => document.getElementById(id);

function fatal(msg) {
  $('loading').classList.remove('hidden');
  const e = $('load-error');
  e.textContent = msg;
  e.classList.remove('hidden');
  $('load-label').textContent = 'Could not start.';
}

function webgl2Available() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch (e) { return false; }
}

window.addEventListener('error', (ev) => {
  if (!window.__game?.started) fatal('Error: ' + (ev.message || ev.error));
});
window.addEventListener('unhandledrejection', (ev) => {
  if (!window.__game?.started) fatal('Error: ' + (ev.reason?.message || ev.reason));
});

if (!webgl2Available()) {
  fatal('WebGL2 is not available in this browser.\nTry a current Chrome, Edge, Firefox or Safari (15+), and make sure hardware acceleration is enabled.');
} else {
  const game = new Game($('gl'));
  window.__game = game;
  game.boot().catch((e) => {
    console.error(e);
    fatal('Failed to build the world:\n' + (e?.stack || e));
  });
}
