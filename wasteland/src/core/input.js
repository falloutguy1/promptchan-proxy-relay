// Unified mouse / touch / keyboard input. Emits high level intents (tap, pan,
// rotate, zoom, look, long-press) that the game maps to camera and commands.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pointers = new Map();
    this.h = {};              // handlers
    this.joy = { x: 0, y: 0 };
    this.mode = 'rts';        // rts | walk
    this.hover = { x: -1, y: -1, inside: false };
    this.pinch = null;
    this.longTimer = null;
    this.lastTap = 0;
    this.enabled = true;

    const opts = { passive: false };
    canvas.addEventListener('pointerdown', (e) => this.#down(e), opts);
    window.addEventListener('pointermove', (e) => this.#move(e), opts);
    window.addEventListener('pointerup', (e) => this.#up(e), opts);
    window.addEventListener('pointercancel', (e) => this.#up(e, true), opts);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (this.enabled) this.h.zoom?.(Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0012)), e.clientX, e.clientY); }, opts);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerleave', () => { this.hover.inside = false; });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!this.keys.has(k)) this.h.key?.(k, e);
      this.keys.add(k);
      if (['Tab', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); });
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
  }

  on(name, fn) { this.h[name] = fn; return this; }

  #down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.canvas.focus({ preventScroll: true });
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, type: e.pointerType, t0: performance.now(), moved: false };
    this.pointers.set(e.pointerId, p);
    if (this.mode === 'walk' && e.pointerType === 'mouse' && !this.locked && this.h.requestLock) this.h.requestLock();
    if (e.pointerType === 'touch') {
      clearTimeout(this.longTimer);
      if (this.pointers.size === 1) {
        this.longTimer = setTimeout(() => { if (!p.moved && this.pointers.size === 1) { p.long = true; this.h.longPress?.(p.x, p.y); } }, 520);
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), my: (a.y + b.y) / 2, mx: (a.x + b.x) / 2 };
        for (const q of this.pointers.values()) q.moved = true; // a two-finger gesture is never a tap
      }
    }
  }

  #move(e) {
    const p = this.pointers.get(e.pointerId);
    if (e.pointerType === 'mouse' || !p) {
      const r = this.canvas.getBoundingClientRect();
      this.hover.x = e.clientX; this.hover.y = e.clientY;
      this.hover.inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }
    if (this.mode === 'walk' && this.locked && e.pointerType === 'mouse') { this.h.look?.(e.movementX * 0.0022, e.movementY * 0.0022); return; }
    if (!p || !this.enabled) { if (!p) this.h.hover?.(e.clientX, e.clientY); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!p.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > (p.type === 'touch' ? 10 : 5)) { p.moved = true; clearTimeout(this.longTimer); }
    if (!p.moved) return;
    if (this.mode === 'walk') { this.h.look?.(dx * 0.0042, dy * 0.0042); return; }
    if (p.type === 'touch') {
      if (this.pointers.size === 1) this.h.pan?.(dx, dy, p.x, p.y);
      else if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (this.pinch.d > 0 && d > 0) this.h.zoom?.(this.pinch.d / d, mx, my);
        let da = ang - this.pinch.ang;
        if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
        this.h.rotate?.(-da, 0);
        const dyMid = my - this.pinch.my;
        if (Math.abs(dyMid) > 0.5 && Math.abs(d - this.pinch.d) < 6) this.h.tilt?.(dyMid * 0.004);
        else this.h.pan?.((mx - this.pinch.mx) * 0.5, (my - this.pinch.my) * 0.5, mx, my);
        Object.assign(this.pinch, { d, ang, mx, my });
      }
      return;
    }
    if (p.button === 0) this.h.pan?.(dx, dy, p.x, p.y);
    else if (p.button === 1) this.h.pan?.(dx, dy, p.x, p.y);
    else if (p.button === 2) this.h.rotate?.(dx * 0.006, dy * 0.004);
  }

  #up(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    clearTimeout(this.longTimer);
    if (this.pointers.size < 2) this.pinch = null;
    if (cancelled || p.moved || p.long || !this.enabled) { if (p.moved) this.h.dragEnd?.(); return; }
    const now = performance.now();
    const dbl = now - this.lastTap < 320;
    this.lastTap = now;
    this.h.tap?.(p.x, p.y, p.button, dbl, p.type);
  }

  moveVector() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('w') || k.has('ArrowUp')) y += 1;
    if (k.has('s') || k.has('ArrowDown')) y -= 1;
    if (k.has('d') || k.has('ArrowRight')) x += 1;
    if (k.has('a') || k.has('ArrowLeft')) x -= 1;
    x += this.joy.x; y += this.joy.y;
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }
  get running() { return this.keys.has('Shift') || Math.hypot(this.joy.x, this.joy.y) > 0.92; }

  /** Virtual joystick bound to a DOM element (mobile walk mode). */
  bindStick(el) {
    const knob = el.querySelector('.knob');
    let id = null, cx = 0, cy = 0;
    const R = 50;
    const set = (x, y) => {
      const dx = x - cx, dy = y - cy, l = Math.min(R, Math.hypot(dx, dy)), a = Math.atan2(dy, dx);
      const kx = Math.cos(a) * l, ky = Math.sin(a) * l;
      knob.style.transform = `translate(${kx}px, ${ky}px)`;
      this.joy.x = kx / R; this.joy.y = -ky / R;
    };
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); id = e.pointerId; const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; el.setPointerCapture(id); set(e.clientX, e.clientY); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e.clientX, e.clientY); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; this.joy.x = 0; this.joy.y = 0; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
}
