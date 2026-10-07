import { LAYOUTS, PAINTS, CALIBERS, LIMITS, PRESETS, analyse } from '../ship/ShipDesign.js';
import { PRESETS as QUALITY } from '../engine/Renderer.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const fmt = (n, d = 0) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

export class UI {
  constructor(game, settings) {
    this.game = game;
    this.settings = settings;
    this.hud = $('#hud');
    this.hud.hidden = false;
    this.buildTopbar();
    this.buildDesigner();
    this.buildStats(game.design, game.ship.analysis);
    this.buildTrials();
    this.buildSettings();
    this.buildPerf();
    game.on('design', (d, a) => { this.buildStats(d, a); this.syncDesigner(); });
    game.on('mode', (m) => this.onMode(m));
    game.on('perf', (s) => this.updatePerf(s));
    this.onMode(game.mode);
    this.hint('Drag to orbit · right-drag/shift to pan · wheel or pinch to zoom');
  }

  hint(text, ms = 6000) {
    const h = $('#hint');
    h.textContent = text;
    h.classList.add('show');
    clearTimeout(this._h);
    this._h = setTimeout(() => h.classList.remove('show'), ms);
  }

  toast(text) {
    const t = $('#toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(this._t);
    this._t = setTimeout(() => (t.hidden = true), 2600);
  }

  buildTopbar() {
    for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => this.game.setMode(b.dataset.mode));
    $('#btn-settings').addEventListener('click', () => $('#settings').showModal());
    $('#btn-full').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => this.toast('Fullscreen not available'));
    });
  }

  onMode(m) {
    for (const b of document.querySelectorAll('.modes button')) b.classList.toggle('active', b.dataset.mode === m);
    $('#designer').hidden = m !== 'design';
    $('#stats').hidden = m === 'walk';
    $('#stats').classList.toggle('compact', m === 'trials');
    $('#trials-hud').hidden = m !== 'trials';
    $('#walk-pad')?.toggleAttribute('hidden', m !== 'walk');
    $('#crosshair').hidden = m !== 'trials';
    if (m === 'trials') { this.tel?.set(this.game.ship.throttle); this.rud && (this.rud.value = this.game.ship.rudder); }
    if (m === 'trials') this.hint(matchMedia('(pointer: coarse)').matches ? 'Throttle on the left, rudder at the bottom. Tap the sea to fire, binoculars to aim.' : 'W/S throttle · A/D rudder · drag to look · click the sea or Space to fire · Z binoculars');
    if (m === 'walk') this.hint(matchMedia('(pointer: coarse)').matches ? 'Use the pad to walk, drag to look around.' : 'WASD to walk · Shift to hurry · drag to look');
    if (m === 'design') this.hint('Drag to orbit · right-drag/shift to pan · wheel or pinch to zoom');
  }

  // ---------------- designer ----------------
  buildDesigner() {
    const g = this.game;
    const root = $('#designer');
    root.innerHTML = '';
    const d = () => g.design;
    const apply = (patch) => { clearTimeout(this._rb); this._pending = { ...(this._pending || d()), ...patch }; this._rb = setTimeout(() => { g.setDesign(this._pending); this._pending = null; }, 60); };
    const head = el('div', { class: 'ph' },
      el('input', { id: 'ship-name', value: d().name, maxlength: 32, 'aria-label': 'Ship name', onchange: (e) => apply({ name: e.target.value }) }),
      el('button', { class: 'collapse', title: 'Collapse', 'aria-label': 'Collapse designer', onclick: () => root.classList.toggle('collapsed') }, '▾'));
    root.append(head);
    const body = el('div', { class: 'pbody' });
    root.append(body);
    const presetSel = el('select', { 'aria-label': 'Preset', onchange: (e) => { if (PRESETS[e.target.value]) g.setDesign({ ...PRESETS[e.target.value] }); e.target.value = ''; } },
      el('option', { value: '' }, 'Load a preset…'), ...Object.keys(PRESETS).map((k) => el('option', { value: k }, k)));
    body.append(el('div', { class: 'row' }, presetSel));

    const section = (title, open = true) => { const s = el('details', open ? { open: '' } : {}, el('summary', {}, title)); body.append(s); return s; };
    const slider = (parent, key, label, unit, digits = 0, scale = 1) => {
      const [min, max, step] = LIMITS[key];
      const out = el('output', {}, '');
      const inp = el('input', { type: 'range', min, max, step, value: d()[key], 'aria-label': label, oninput: (e) => { out.textContent = fmt(e.target.value * scale, digits) + unit; apply({ [key]: Number(e.target.value) }); } });
      out.textContent = fmt(d()[key] * scale, digits) + unit;
      parent.append(el('label', { class: 'ctl' }, el('span', {}, label), out, inp));
      (this.ctl ||= {})[key] = { inp, out, unit, digits, scale };
    };
    const choice = (parent, key, label, options) => {
      const wrap = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
      for (const [val, text] of options) {
        const b = el('button', { 'data-v': val, class: String(d()[key]) === String(val) ? 'on' : '', onclick: () => { apply({ [key]: typeof d()[key] === 'number' ? Number(val) : val }); for (const x of wrap.children) x.classList.toggle('on', x === b); } }, text);
        wrap.append(b);
      }
      parent.append(el('div', { class: 'ctl' }, el('span', {}, label), wrap));
      (this.seg ||= {})[key] = wrap;
    };
    const hull = section('Hull');
    slider(hull, 'length', 'Length', ' m');
    slider(hull, 'beam', 'Beam', ' m', 1);
    slider(hull, 'freeboard', 'Freeboard', ' m', 1);
    slider(hull, 'sheer', 'Bow sheer', ' m', 1);
    choice(hull, 'bow', 'Bow', [['straight', 'Straight'], ['clipper', 'Clipper'], ['bulbous', 'Bulbous']]);
    choice(hull, 'stern', 'Stern', [['cruiser', 'Cruiser'], ['transom', 'Transom']]);
    const arm = section('Armament');
    const lay = el('select', { 'aria-label': 'Turret layout', onchange: (e) => apply({ layout: e.target.value }) }, ...Object.entries(LAYOUTS).map(([k, v]) => el('option', { value: k, ...(d().layout === k ? { selected: '' } : {}) }, v.label)));
    arm.append(el('label', { class: 'ctl' }, el('span', {}, 'Main battery'), lay));
    this.layoutSel = lay;
    choice(arm, 'caliber', 'Calibre (mm)', CALIBERS.map((c) => [c, String(c)]));
    choice(arm, 'guns', 'Guns per turret', [[2, 'Twin'], [3, 'Triple'], [4, 'Quad']]);
    slider(arm, 'secondary', 'Secondary mounts / side', '');
    slider(arm, 'aa', 'Anti-aircraft fit', '');
    const prot = section('Protection', false);
    slider(prot, 'belt', 'Belt armour', ' mm');
    slider(prot, 'deck', 'Deck armour', ' mm');
    const mach = section('Machinery', false);
    slider(mach, 'power', 'Shaft power', ' shp');
    slider(mach, 'funnels', 'Funnels', '');
    const sup = section('Superstructure & paint', false);
    choice(sup, 'tower', 'Bridge', [['tower', 'Tower'], ['tripod', 'Tripod'], ['pagoda', 'Pagoda']]);
    choice(sup, 'mast', 'Mainmast', [['pole', 'Pole'], ['tripod', 'Tripod']]);
    choice(sup, 'paint', 'Scheme', Object.entries(PAINTS).map(([k, v]) => [k, v.label]));
    const views = el('div', { class: 'row views' }, el('span', {}, 'View'),
      ...[['Whole', null], ['Bow', 'bow'], ['Bridge', 'mid'], ['Stern', 'stern']].map(([t, p]) => el('button', { onclick: () => g.frameShip(p) }, t)));
    body.append(views);
    body.append(el('button', { class: 'primary', onclick: () => g.setMode('trials') }, 'Cast off for sea trials ⟶'));
  }

  syncDesigner() {
    const d = this.game.design;
    for (const [k, c] of Object.entries(this.ctl || {})) { c.inp.value = d[k]; c.out.textContent = fmt(d[k] * c.scale, c.digits) + c.unit; }
    for (const [k, w] of Object.entries(this.seg || {})) for (const b of w.children) b.classList.toggle('on', b.dataset.v === String(d[k]));
    if (this.layoutSel) this.layoutSel.value = d.layout;
    const n = $('#ship-name'); if (n && document.activeElement !== n) n.value = d.name;
  }

  buildStats(d, a) {
    a = a || analyse(d);
    const s = $('#stats');
    const bar = (v, max) => el('i', { style: `--v:${Math.max(0, Math.min(1, v / max))}` });
    const row = (k, v, b) => el('div', { class: 'st' }, el('span', {}, k), el('b', {}, v), b || '');
    s.innerHTML = '';
    s.append(el('div', { class: 'sh' }, el('div', {}, d.name), el('small', {}, `${LAYOUTS[d.layout].label} · ${a.nGuns} × ${d.caliber} mm`)));
    s.append(
      row('Displacement', `${fmt(a.displacement)} t`, bar(a.displacement, 80000)),
      row('Draught', `${fmt(a.draft, 1)} m`),
      row('Top speed', `${fmt(a.speedKn, 1)} kn`, bar(a.speedKn, 36)),
      row('Metacentric height', `${fmt(a.GM, 2)} m`, bar(a.GM, 4)),
      row('Roll period', Number.isFinite(a.rollPeriod) ? `${fmt(a.rollPeriod, 1)} s` : '—'),
      row('Broadside', `${fmt(a.broadside / 1000, 1)} t`, bar(a.broadside, 18000)),
      row('Max range', `${fmt(a.rangeKm, 1)} km`),
      row('Belt / deck', `${d.belt} / ${d.deck} mm`),
      row('Turning circle', `${fmt(a.turningDiameter)} m`));
    const w = el('div', { class: 'warn' });
    for (const x of a.warnings) w.append(el('p', { class: x.level }, x.text));
    if (!a.warnings.length) w.append(el('p', { class: 'ok' }, 'Balanced design. No major issues found.'));
    s.append(w);
    const wt = a.weights;
    const tot = a.displacement;
    const parts = [['Hull', wt.hull, '#8aa0b0'], ['Armour', wt.belt + wt.deckArmour, '#c4a35a'], ['Guns', wt.turrets + wt.secondary + wt.aa, '#c06a4f'], ['Machinery', wt.machinery, '#6f9a7a'], ['Other', wt.superstructure + wt.loads, '#77808a']];
    s.append(el('div', { class: 'wbar', title: 'Weight breakdown' }, ...parts.map(([n, v, c]) => el('span', { style: `flex:${v / tot};background:${c}`, title: `${n}: ${fmt(v)} t` }))));
    s.append(el('div', { class: 'wleg' }, ...parts.map(([n, v, c]) => el('span', {}, el('i', { style: `background:${c}` }), `${n} ${Math.round((v / tot) * 100)}%`))));
  }

  // ---------------- trials HUD ----------------
  buildTrials() {
    const g = this.game;
    const r = $('#trials-hud');
    r.innerHTML = '';
    // engine telegraph: discrete orders, large touch targets
    const orders = [[1, 'Full ahead'], [0.75, 'Half ahead'], [0.5, 'Slow ahead'], [0.25, 'Dead slow'], [0, 'Stop'], [-0.25, 'Slow astern'], [-0.5, 'Full astern']];
    const tel = el('div', { class: 'telegraph', role: 'radiogroup', 'aria-label': 'Engine telegraph' });
    tel.set = (v) => { g.ship.throttle = v; for (const b of tel.children) b.classList.toggle('on', Number(b.dataset.v) === v); };
    for (const [v, label] of orders) tel.append(el('button', { 'data-v': v, class: v === 0 ? 'on' : '', onclick: () => tel.set(v) }, label));
    const rud = el('input', { type: 'range', min: -1, max: 1, step: 0.05, value: 0, class: 'rudder', 'aria-label': 'Rudder', oninput: (e) => { g.ship.rudder = Number(e.target.value); } });
    rud.addEventListener('dblclick', () => { rud.value = 0; g.ship.rudder = 0; });
    this.tel = tel; this.rud = rud;
    r.append(tel);
    r.append(el('div', { class: 'rudder-wrap' }, el('span', {}, 'Port'), rud, el('span', {}, 'Stbd')));
    this.readout = el('div', { class: 'readout' });
    r.append(this.readout);
    const fire = el('button', { class: 'fire', onclick: () => { g.gunnery.manualAim = false; if (!g.gunnery.fire()) this.toast('Guns not ready — training or reloading'); } }, 'FIRE');
    const sec = el('button', { class: 'fire small', onclick: () => g.gunnery.fire(true) }, 'Secondaries');
    const sight = el('button', { class: 'sight', onclick: () => { const on = g.rig.mode !== 'sight'; g.rig.setMode(on ? 'sight' : 'chase'); if (on) { g.rig.sight.yaw = 0; g.rig.sight.pitch = 0; } sight.classList.toggle('on', on); } }, '🔭 Binoculars');
    const ret = el('button', { onclick: () => g.setMode('design') }, '⟵ Return to berth');
    r.append(el('div', { class: 'gunctl' }, sight, sec, fire), el('div', { class: 'retbtn' }, ret));
    this.turretBars = el('div', { class: 'turrets' });
    r.append(this.turretBars);

    // walk pad for touch
    const pad = el('div', { id: 'walk-pad', hidden: '' }, el('div', { class: 'knob' }));
    this.hud.append(pad);
    const knob = pad.firstChild;
    const padMove = (e) => {
      const b = pad.getBoundingClientRect();
      const x = ((e.clientX - b.left) / b.width) * 2 - 1, y = ((e.clientY - b.top) / b.height) * 2 - 1;
      const l = Math.min(1, Math.hypot(x, y)), a = Math.atan2(y, x);
      g.rig.stick.x = Math.cos(a) * l; g.rig.stick.y = -Math.sin(a) * l;
      knob.style.transform = `translate(${Math.cos(a) * l * 34}px, ${Math.sin(a) * l * 34}px)`;
    };
    pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); padMove(e); e.stopPropagation(); });
    pad.addEventListener('pointermove', (e) => { if (pad.hasPointerCapture(e.pointerId)) padMove(e); });
    const stop = () => { g.rig.stick.x = 0; g.rig.stick.y = 0; knob.style.transform = ''; };
    pad.addEventListener('pointerup', stop); pad.addEventListener('pointercancel', stop);

    // keyboard
    window.addEventListener('keydown', (e) => {
      if (g.mode !== 'trials' || e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      const steps = [-0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
      if (e.code === 'KeyW' || e.code === 'KeyS') {
        const i = steps.indexOf(g.ship.throttle);
        const ni = Math.max(0, Math.min(steps.length - 1, (i < 0 ? 2 : i) + (e.code === 'KeyW' ? 1 : -1)));
        tel.set(steps[ni]);
      }
      if (e.code === 'Space') { e.preventDefault(); g.gunnery.manualAim = false; g.gunnery.fire(); }
      if (e.code === 'KeyF') g.gunnery.fire(true);
      if (e.code === 'KeyZ') sight.click();
    });
  }

  tick() {
    const g = this.game;
    if (g.mode === 'trials') {
      const k = g.rig.keys;
      if (k.has('KeyA') || k.has('KeyD')) {
        g.ship.rudder = Math.max(-1, Math.min(1, g.ship.rudder + ((k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0)) * 0.02));
        this.rud.value = g.ship.rudder;
      }
      const s = g.ship, a = s.analysis, gn = g.gunnery;
      const kn = s.speed / 0.514444;
      const hdg = ((((Math.PI / 2 - s.heading) * 180) / Math.PI) % 360 + 360) % 360; // compass: +x = east = 090
      const rng = gn.aimValid ? gn.aim.distanceTo(s.position) : 0;
      const roll = (s.roll * 180) / Math.PI;
      this.readout.innerHTML = `
        <div><span>Speed</span><b>${kn.toFixed(1)}</b><small>kn / ${a.speedKn.toFixed(1)}</small></div>
        <div><span>Heading</span><b>${hdg.toFixed(0).padStart(3, '0')}°</b></div>
        <div><span>Roll</span><b>${roll >= 0 ? 'S' : 'P'} ${Math.abs(roll).toFixed(1)}°</b><small>T ${Number.isFinite(a.rollPeriod) ? a.rollPeriod.toFixed(1) : '—'} s</small></div>
        <div><span>Range</span><b>${(rng / 1000).toFixed(2)}</b><small>km</small></div>
        <div><span>Hits</span><b>${gn.score.hits}/${gn.score.shots}</b><small>${gn.score.salvos} salvos</small></div>
        ${s.grounded ? '<div class="alert">AGROUND — back off!</div>' : ''}`;
      const bars = [...s.turrets].map((t) => `<span class="${t.ready ? 'rdy' : t.reload > 0 ? 'ld' : t.inArc ? 'tr' : 'na'}" style="--p:${t.reload > 0 ? 1 - t.reload / a.reload : 1}">${t.id}</span>`).join('');
      if (this._bars !== bars) { this.turretBars.innerHTML = bars; this._bars = bars; }
    }
  }

  // ---------------- settings ----------------
  buildSettings() {
    const g = this.game, st = this.settings;
    const dlg = $('#settings');
    dlg.innerHTML = '';
    const form = el('form', { method: 'dialog' });
    form.append(el('h2', {}, 'Graphics'));
    const q = el('div', { class: 'seg' }, ...Object.entries(QUALITY).map(([k, v]) => el('button', { type: 'button', class: st.quality === k ? 'on' : '', onclick: (e) => { st.quality = k; st.scale = QUALITY[k].scale; for (const b of q.children) b.classList.toggle('on', b === e.target); scale.value = st.scale; scaleOut.textContent = Math.round(st.scale * 100) + '%'; } }, v.label)));
    form.append(el('div', { class: 'ctl' }, el('span', {}, 'Quality preset'), q));
    const scaleOut = el('output', {}, Math.round(st.scale * 100) + '%');
    const scale = el('input', { type: 'range', min: 0.5, max: 1, step: 0.05, value: st.scale, oninput: (e) => { st.scale = Number(e.target.value); scaleOut.textContent = Math.round(st.scale * 100) + '%'; g.R.renderScale = st.scale; g.R.resize(); } });
    form.append(el('label', { class: 'ctl' }, el('span', {}, 'Render resolution'), scaleOut, scale));
    const perf = el('input', { type: 'checkbox', ...(st.showPerf ? { checked: '' } : {}), onchange: (e) => { st.showPerf = e.target.checked; $('#perf').hidden = !st.showPerf; } });
    form.append(el('label', { class: 'ctl check' }, perf, el('span', {}, 'Show frame rate and draw stats')));
    form.append(el('p', { class: 'note' }, 'Changing the preset reloads the scene so textures, shadows and vegetation budgets can be rebuilt.'));
    form.append(el('div', { class: 'btns' },
      el('button', { type: 'button', onclick: () => { st.save(); location.reload(); } }, 'Apply preset & reload'),
      el('button', { value: 'close', onclick: () => st.save() }, 'Close')));
    form.append(el('h2', {}, 'Credits'));
    form.append(el('p', { class: 'note' }, 'Scanned textures, HDRI and props: Poly Haven (CC0). Foliage cards are assembled from Poly Haven tree/grass scans. Ship, terrain, trees, crane and buildings are procedural. Engine: three.js.'));
    dlg.append(form);
  }

  buildPerf() { $('#perf').hidden = !this.settings.showPerf; }

  updatePerf(s) {
    if (!this.settings.showPerf) return;
    const i = this.game.R.renderer.info;
    $('#perf').textContent = `${s.fps.toFixed(0)} fps · ${s.frameMs.toFixed(1)} ms · ${i.render.calls} draws · ${(i.render.triangles / 1e6).toFixed(2)}M tris · ${this.game.R.quality.label} @ ${Math.round(this.game.R.renderer.getPixelRatio() * 100) / 100}x`;
  }
}
