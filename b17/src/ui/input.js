// Keyboard/mouse (pointer lock) and touch input -> aim angles + actions.
import { settings, IS_TOUCH } from '../core/settings.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.aimYaw = 0; this.aimPitch = 0;   // world aim direction (radians)
    this.lookYaw = 0; this.lookPitch = 0; // free-look offsets
    this.fire = false;
    this.pressed = new Set();              // one-shot actions this frame
    this.touch = IS_TOUCH;
    this.enabled = false;
    this.throttleDelta = 0;
    this._touchAim = null;

    addEventListener('keydown', (e) => {
      if (!this.enabled) { if (e.code === 'Escape' || e.code === 'KeyP') this.pressed.add('pause'); return; }
      if (e.repeat) return;
      this.keys.add(e.code);
      const map = { KeyB: 'sight', Space: 'bomb', KeyX: 'mode', KeyV: 'camera', KeyF: 'extinguish', Escape: 'pause', KeyP: 'pause', KeyM: 'map', KeyG: 'gunner', F3: 'stats', KeyH: 'help' };
      if (map[e.code]) { this.pressed.add(map[e.code]); e.preventDefault(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.fire = false; });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touch) return;
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
      if (e.button === 0) this.fire = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.fire = false; });
    addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== canvas) return;
      const s = 0.0022 * settings.mouseSens;
      if (this.keys.has('KeyC')) { this.lookYaw -= e.movementX * s; this.lookPitch -= e.movementY * s * (settings.invertY ? -1 : 1); }
      else { this.aimYaw -= e.movementX * s; this.aimPitch -= e.movementY * s * (settings.invertY ? -1 : 1); }
      this._clamp();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.enabled && !this.touch) this.pressed.add('pause');
    });
    canvas.addEventListener('wheel', (e) => { this.zoom = (this.zoom || 0) + Math.sign(e.deltaY); }, { passive: true });

    // touch: drag anywhere not on a button to aim
    canvas.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) if (this._touchAim === null) this._touchAim = { id: t.identifier, x: t.clientX, y: t.clientY };
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (!this.enabled || !this._touchAim) return;
      for (const t of e.changedTouches) if (t.identifier === this._touchAim.id) {
        const s = 0.0045 * settings.mouseSens;
        this.aimYaw -= (t.clientX - this._touchAim.x) * s;
        this.aimPitch -= (t.clientY - this._touchAim.y) * s * (settings.invertY ? -1 : 1);
        this._touchAim.x = t.clientX; this._touchAim.y = t.clientY;
        this._clamp();
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (this._touchAim && t.identifier === this._touchAim.id) this._touchAim = null; };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  }

  bindTouchButtons() {
    const hold = (id, on, off) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); el.classList.add('on'); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); off?.(); el.classList.remove('on'); }, { passive: false });
      el.addEventListener('mousedown', (e) => { e.preventDefault(); on(); });
      el.addEventListener('mouseup', () => off?.());
    };
    hold('t-fire', () => { this.fire = true; }, () => { this.fire = false; });
    hold('t-bomb', () => this.pressed.add('bomb'));
    hold('t-sight', () => this.pressed.add('sight'));
    hold('t-cam', () => this.pressed.add('camera'));
    hold('t-pause', () => this.pressed.add('pause'));
    hold('t-up', () => { this.throttleDelta = 1; }, () => { this.throttleDelta = 0; });
    hold('t-dn', () => { this.throttleDelta = -1; }, () => { this.throttleDelta = 0; });
  }

  _clamp() {
    this.aimPitch = Math.max(-1.45, Math.min(1.45, this.aimPitch));
    this.lookPitch = Math.max(-1.3, Math.min(1.3, this.lookPitch));
  }

  consume(a) { const had = this.pressed.has(a); this.pressed.delete(a); return had; }
  axis(neg, pos) { return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0); }
  endFrame() { this.pressed.clear(); }
}
