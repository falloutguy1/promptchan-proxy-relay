// In-game HUD: resource bar with daily trends, clock and weather, speed and AI
// controls, the build bar, alerts, objective tracker, Overseer log, selection
// panels (survivor, structure, infected, scavenging site, colony overview with
// trading and stranger decisions), floating labels over sites, the minimap and
// the walk-mode overlay. Panels are built once per selection and then updated
// in place so buttons stay clickable while values change.
import * as THREE from 'three';
import { RES, RES_NAME, STRUCTURES, BUILD_CATS, JOBS, TRAITS, HOUR, LOOT_TABLE } from '../sim/defs.js';
import { Minimap } from './minimap.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = (id, cls = '') => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const RES_ICON = { food: 'r-food', water: 'r-water', wood: 'r-wood', scrap: 'r-scrap', meds: 'r-meds', ammo: 'r-ammo', fuel: 'r-fuel' };
const WEATHER = { clear: ['w-sun', 'Clear'], cloudy: ['w-cloud', 'Overcast'], rain: ['w-rain', 'Rain'], fog: ['w-fog', 'Fog'] };
const pct = (v) => `${Math.round(Math.max(0, Math.min(100, v)))}`;
const cls = (v, lo = 25, mid = 50) => (v < lo ? 'bad' : v < mid ? 'mid' : '');
const _v = new THREE.Vector3();

export class HUD {
  constructor(game) {
    this.game = game;
    this.sim = game.sim;
    this.root = $('hud');
    this.touch = document.body.classList.contains('touch');
    this.acc = 0; this.accSlow = 0;
    this.history = [];
    this.sel = null;
    this.buildCat = 'shelter';
    this.labels = new Map();
    this.#resources();
    this.#controls();
    this.#buildBar();
    this.#logPanel();
    this.#mobile();
    this.minimap = new Minimap(game, $('minimap'));
    this.minimap.prepare();
    const sim = this.sim;
    sim.on('alert', (a) => this.toast(a));
    sim.on('log', (e) => this.#logEntry(e));
    sim.on('stranger', () => this.#decisionModal());
    sim.on('trader', () => { if (this.sel?.kind === 'colony') this.select({ kind: 'colony' }, true); });
    sim.on('start', () => { this.#rebuildLog(); this.select(null); this.history = []; });
    sim.on('death', (s) => { if (this.sel?.ref === s) this.select(null); });
    sim.on('destroyed', (s) => { if (this.sel?.ref === s) this.select(null); });
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  // ================================================================ top bar
  #resources() {
    const el = $('resources');
    const items = [...RES.map((r) => ({ id: r, icon: RES_ICON[r], name: RES_NAME[r] })), { id: 'pop', icon: 'r-pop', name: 'Survivors / beds' }, { id: 'morale', icon: 'r-morale', name: 'Morale' }, { id: 'power', icon: 'r-power', name: 'Power' }];
    el.innerHTML = items.map((it) => `<div class="res" data-r="${it.id}" data-tip="${esc(it.name)}">${icon(it.icon)}<span class="vd"><span class="v">0</span><span class="d"></span></span></div>`).join('');
    this.resEls = {};
    for (const it of items) { const n = el.querySelector(`[data-r="${it.id}"]`); this.resEls[it.id] = { el: n, v: n.querySelector('.v'), d: n.querySelector('.d') }; }
    this.#tooltips(el, '.res', (n) => this.#resTip(n.dataset.r));
  }

  #resTip(r) {
    const sim = this.sim;
    if (!sim.started) return '';
    const pop = sim.alive().length || 1;
    if (r === 'pop') return `<b>Survivors</b>${pop} alive, ${sim.housing} beds. Unhoused survivors sleep rough and lose morale.`;
    if (r === 'morale') return `<b>Morale ${Math.round(sim.morale)}%</b>Work speed ×${sim.workFactor.toFixed(2)}. Raised by beds, a fire, full stores, shacks, the radio. Lowered by hunger, deaths and damage.`;
    if (r === 'power') { const p = sim.power; return `<b>Power</b>${p.supply} supplied / ${p.demand} used. Generators burn 1 fuel every 5 hours under load.`; }
    const d = this.#delta(r);
    const use = r === 'food' ? `Eaten: ~${(pop * 1.1).toFixed(1)}/day. ` : r === 'water' ? `Drunk: ~${(pop * 1.5).toFixed(1)}/day. ` : '';
    return `<b>${RES_NAME[r]}: ${Math.floor(sim.res[r])} / ${sim.cap(r)}</b>${use}${d !== null ? `Change over the last day: ${d >= 0 ? '+' : ''}${Math.round(d)}.` : ''}`;
  }

  #delta(r) {
    const h = this.history;
    if (h.length < 3) return null;
    const old = h[0];
    const span = (this.sim.clock - old.t) / (24 * HOUR);
    return span > 0 ? (this.sim.res[r] - old.res[r]) / Math.max(span, 0.25) : null;
  }

  #updateResources() {
    const sim = this.sim;
    const pop = sim.alive().length;
    const low = { food: pop * 2, water: pop * 2, meds: 1, ammo: 10, fuel: 1, wood: 6, scrap: 4 };
    for (const r of RES) {
      const e = this.resEls[r];
      e.v.textContent = Math.floor(sim.res[r]);
      e.el.classList.toggle('low', sim.res[r] <= low[r]);
      const d = this.#delta(r);
      e.d.textContent = d === null || Math.abs(d) < 0.5 ? '' : `${d > 0 ? '+' : ''}${Math.round(d)}`;
      e.d.className = 'd ' + (d > 0.5 ? 'up' : d < -0.5 ? 'down' : '');
    }
    this.resEls.pop.v.textContent = `${pop}/${sim.housing}`;
    this.resEls.pop.el.classList.toggle('low', sim.housing < pop);
    this.resEls.morale.v.textContent = `${Math.round(sim.morale)}%`;
    this.resEls.morale.el.classList.toggle('low', sim.morale < 30);
    const p = sim.power;
    this.resEls.power.el.classList.toggle('hidden', !sim.structures.count('generator'));
    this.resEls.power.v.textContent = `${p.supply ? p.demand : 0}/${p.supply}`;
    this.resEls.power.el.classList.toggle('low', !sim.powered && p.demand > 0);
  }

  #controls() {
    for (const b of document.querySelectorAll('.speed button')) b.addEventListener('click', () => this.setSpeed(+b.dataset.speed));
    $('btn-ai').addEventListener('click', () => this.toggleAI());
    $('btn-menu').addEventListener('click', () => this.game.menu.pause());
  }
  setSpeed(v) {
    this.sim.speed = v;
    for (const b of document.querySelectorAll('.speed button')) b.classList.toggle('on', +b.dataset.speed === v);
    const mb = document.querySelector('#mobilebar [data-m="speed"]');
    if (mb) { mb.querySelector('span').textContent = v ? `${v}×` : 'Paused'; mb.querySelector('use').setAttribute('href', v ? (v === 1 ? '#i-play' : v === 2 ? '#i-ff' : '#i-fff') : '#i-pause'); }
  }
  toggleAI(on = !this.sim.ai.enabled) {
    this.sim.ai.setEnabled(on);
    this.#aiState();
    if (on) $('ai-log').classList.remove('collapsed');
  }
  #aiState() {
    const on = this.sim.ai.enabled;
    $('btn-ai').classList.toggle('on', on);
    $('btn-ai').querySelector('.state').textContent = on ? 'ON' : 'OFF';
    document.querySelector('#mobilebar [data-m="ai"]')?.classList.toggle('on', on);
    document.body.classList.toggle('ai-on', on);
  }

  // ================================================================ build bar
  #buildBar() {
    const cats = $('build-cats');
    cats.innerHTML = BUILD_CATS.map((c) => `<button data-c="${c.id}" class="${c.id === this.buildCat ? 'on' : ''}">${c.name}</button>`).join('');
    cats.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; this.buildCat = b.dataset.c; for (const x of cats.children) x.classList.toggle('on', x === b); this.#buildItems(); });
    $('build-items').addEventListener('click', (e) => {
      const b = e.target.closest('.bitem');
      if (!b) return;
      this.game.interact.startPlace(b.dataset.t);
      if (this.touch) $('buildbar').classList.remove('sheet-open');
    });
    this.#tooltips($('build-items'), '.bitem', (n) => this.#buildTip(n.dataset.t));
    this.#buildItems();
  }
  #buildItems() {
    const items = Object.entries(STRUCTURES).filter(([, d]) => d.cat === this.buildCat);
    $('build-items').innerHTML = items.map(([k, d], i) => `<button class="bitem" data-t="${k}"><span class="key">${i + 1}</span>${icon(d.icon, 'ic')}<span class="nm">${d.name}</span><span class="cost">${Object.entries(d.cost).map(([r, n]) => `<span data-r="${r}">${icon(RES_ICON[r])}${n}</span>`).join('')}</span></button>`).join('');
    this.#updateBuild();
  }
  #updateBuild() {
    const sim = this.sim;
    if (!sim.started) return;
    for (const b of $('build-items').children) {
      const d = STRUCTURES[b.dataset.t];
      let ok = true;
      for (const s of b.querySelectorAll('[data-r]')) { const short = sim.res[s.dataset.r] < d.cost[s.dataset.r]; s.classList.toggle('no', short); if (short) ok = false; }
      const capped = d.unique && sim.structures.count(b.dataset.t, true) >= d.unique;
      b.classList.toggle('locked', !ok || capped);
      b.classList.toggle('sel', this.game.interact?.placing?.type === b.dataset.t);
    }
  }
  #buildTip(t) {
    const d = STRUCTURES[t], sim = this.sim;
    const cost = Object.entries(d.cost).map(([r, n]) => `<span class="${sim.res[r] < n ? 'req' : ''}">${n} ${RES_NAME[r].toLowerCase()}</span>`).join(', ');
    const extra = [];
    if (d.housing) extra.push(`Beds: ${d.housing}`);
    if (d.job) extra.push(`Job: ${JOBS[d.job === 'water' ? 'water' : d.job === 'farm' ? 'farmer' : d.job === 'craft' ? 'crafter' : 'medic'].name}`);
    if (d.unique) extra.push(`Max ${d.unique}`);
    return `<b>${d.name}</b>${esc(d.desc)}<br><span class="dim">Cost: ${cost || 'free'} · ${d.work} worker-hours${extra.length ? ' · ' + extra.join(' · ') : ''}</span>`;
  }

  // ================================================================ alerts, objective, log
  toast(a) {
    if (a.quiet && this.sim.ai.enabled) return;
    const box = $('alerts');
    const n = document.createElement('div');
    n.className = `alert ${a.kind === 'danger' ? 'danger' : a.kind === 'good' ? 'good' : a.kind === 'warn' ? 'warn' : ''}`;
    n.innerHTML = `<b>${esc(a.title)}</b>${a.detail ? `<div>${esc(a.detail)}</div>` : ''}`;
    if (a.pos) { n.classList.add('go'); n.addEventListener('click', () => this.game.rig.focusOn(a.pos.x, a.pos.z, Math.min(this.game.rig.goal.dist, 45))); }
    box.prepend(n);
    while (box.children.length > (this.touch ? 3 : 5)) box.lastChild.remove();
    const life = a.kind === 'danger' ? 9000 : 6500;
    setTimeout(() => { n.classList.add('fade'); setTimeout(() => n.remove(), 700); }, life);
    this.game.audio?.ui(a.kind);
  }

  #updateObjective() {
    const o = this.sim.objectiveProgress();
    const el = $('objective');
    if (!o) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="obj-k">Objective ${o.index + 1}/${o.total}</div><b>${esc(o.title)}</b><div>${esc(o.text)}</div><div class="obj-p">${esc(o.progress)}</div>`;
  }

  #logPanel() {
    $('ai-log').querySelector('header').addEventListener('click', () => $('ai-log').classList.toggle('collapsed'));
  }
  #logEntry(e) {
    const ol = $('ai-log-list');
    const li = document.createElement('li');
    li.className = e.kind;
    const h = Math.floor(e.hour), m = Math.floor((e.hour - h) * 60);
    li.innerHTML = `<span class="t">D${e.day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}</span>${esc(e.text)}`;
    ol.appendChild(li);
    while (ol.children.length > 80) ol.firstChild.remove();
    ol.scrollTop = ol.scrollHeight;
    const hdr = $('ai-log').querySelector('header span');
    if (e.kind === 'ai') { hdr.textContent = 'Overseer log'; }
  }
  #rebuildLog() { $('ai-log-list').innerHTML = ''; for (const e of this.sim.logList) this.#logEntry(e); this.#aiState(); }

  // ================================================================ selection panels
  select(sel, force = false) {
    const prev = this.sel;
    if (!force && prev && sel && prev.kind === sel.kind && prev.ref === sel.ref) return;
    if (prev?.kind === 'survivor' && prev.ref?.c) this.game.world.characters.select(prev.ref.c, false);
    if (prev?.kind === 'infected' && prev.ref?.c) this.game.world.characters.select(prev.ref.c, false);
    this.sel = sel;
    const p = $('side-panel');
    document.body.classList.toggle('panel-open', !!sel);
    if (!sel) { p.classList.add('hidden'); p.innerHTML = ''; this.panel = null; return; }
    if (sel.kind === 'survivor') this.game.world.characters.select(sel.ref.c, true, this.sim.ai.enabled && !sel.ref.locked ? 'ai' : 'human');
    if (sel.kind === 'infected') this.game.world.characters.select(sel.ref.c, true, 'bad');
    p.classList.remove('hidden');
    const P = { survivor: this.#survivorPanel, structure: this.#structurePanel, infected: this.#infectedPanel, loot: this.#lootPanel, colony: this.#colonyPanel, visitor: this.#visitorPanel }[sel.kind];
    p.innerHTML = '';
    this.panel = P.call(this, p, sel.ref);
    const close = document.createElement('button');
    close.className = 'close'; close.innerHTML = icon('i-x'); close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.select(null));
    p.prepend(close);
    this.panel?.update?.();
  }

  #meter(label, key) { return `<div class="stat"><span>${label}</span><div class="meter" data-m="${key}"><i></i></div><span class="v" data-v="${key}"></span></div>`; }
  #setMeter(root, key, v, text, bad = null) {
    const m = root.querySelector(`[data-m="${key}"]`);
    if (!m) return;
    m.firstChild.style.width = `${pct(v)}%`;
    m.className = 'meter ' + (bad ?? cls(v));
    root.querySelector(`[data-v="${key}"]`).textContent = text ?? pct(v);
  }

  #survivorPanel(p, s) {
    const sim = this.sim;
    const traits = s.traits.map((t) => `<span class="chip ${TRAITS[t].good ? 'good' : 'bad'}" title="${esc(TRAITS[t].desc)}">${TRAITS[t].name}</span>`).join('');
    const skills = Object.entries(s.skills).map(([k, v]) => `<div class="sk"><span>${k}</span><b>${Math.round(v * 100)}</b></div>`).join('');
    const jobs = Object.entries(JOBS).map(([k, j]) => `<button class="jb" data-job="${k}" title="${esc(j.desc)}">${icon(j.icon)}<span>${j.name}</span></button>`).join('');
    p.innerHTML = `
      <h3>${esc(s.name)}</h3>
      <div class="sub">${esc(s.occupation)} · joined day ${s.joined}${s.armed ? ' · armed' : ''} · ${s.kills} kills</div>
      <div class="chips">${traits || '<span class="chip">No notable traits</span>'}</div>
      <div class="activity" data-k="act"></div>
      ${this.#meter('Health', 'hp')}${this.#meter('Food', 'food')}${this.#meter('Water', 'water')}${this.#meter('Rest', 'rest')}
      <div data-k="infw">${this.#meter('Infection', 'inf')}</div>
      <div class="skills">${skills}</div>
      <div class="jobs-h"><span>Job</span><label class="lock" title="The AI Overseer will not reassign a locked survivor"><input type="checkbox" data-k="lock"> Lock</label></div>
      <div class="jobs">${jobs}</div>
      <div class="actions">
        <button class="act" data-a="follow">${icon('i-eye')}Follow</button>
        <button class="act" data-a="walk">${icon('i-walk')}Take control</button>
        <button class="act" data-a="treat">${icon('r-meds')}Treat bite</button>
        <button class="act" data-a="home">${icon('i-home')}Back to camp</button>
      </div>
      <p class="hint">${this.touch ? 'With a survivor selected, tap the ground to move, a tree to chop, a building to scavenge, a site to build or an infected to attack.' : 'Right-click: move · tree: chop · building: scavenge · site: build · infected: attack. V: first-person.'}</p>`;
    p.querySelector('.jobs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-job]'); if (!b) return;
      sim.setJob(s, b.dataset.job, sim.ai.enabled ? true : null);
      this.panel.update();
    });
    p.querySelector('[data-k="lock"]').addEventListener('change', (e) => { s.locked = e.target.checked; this.game.world.characters.select(s.c, true, sim.ai.enabled && !s.locked ? 'ai' : 'human'); });
    p.querySelector('.actions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'follow') { this.game.rig.follow = s.c.root; this.game.rig.goal.dist = Math.min(this.game.rig.goal.dist, 30); }
      if (a === 'walk') this.game.enterWalk(s);
      if (a === 'treat') sim.treatNow(s);
      if (a === 'home') sim.order(s, { kind: 'goto', x: sim.center.x + (Math.random() - 0.5) * 6, z: sim.center.z + (Math.random() - 0.5) * 6 });
    });
    return {
      update: () => {
        if (!s.alive) { p.querySelector('[data-k="act"]').textContent = 'Dead'; return; }
        p.querySelector('[data-k="act"]').innerHTML = `${icon(JOBS[s.job].icon)}<span>${esc(s.activity)}${s.carry ? ' (carrying)' : ''}</span>`;
        this.#setMeter(p, 'hp', (s.hp / s.maxHp) * 100, `${Math.round(s.hp)}`);
        this.#setMeter(p, 'food', s.food); this.#setMeter(p, 'water', s.water); this.#setMeter(p, 'rest', s.rest);
        p.querySelector('[data-k="infw"]').classList.toggle('hidden', s.infection <= 0);
        this.#setMeter(p, 'inf', s.infection, pct(s.infection), 'bad');
        for (const b of p.querySelectorAll('[data-job]')) b.classList.toggle('on', b.dataset.job === s.job);
        p.querySelector('[data-k="lock"]').checked = s.locked;
        p.querySelector('.lock').classList.toggle('hidden', !sim.ai.enabled);
        const treat = p.querySelector('[data-a="treat"]');
        treat.classList.toggle('hidden', s.infection <= 0);
        treat.disabled = sim.res.meds <= 0;
      },
    };
  }

  #structurePanel(p, s) {
    const sim = this.sim, d = s.def;
    p.innerHTML = `
      <h3>${esc(d.name)}</h3>
      <div class="sub" data-k="state"></div>
      <div data-k="progw">${this.#meter('Built', 'prog')}</div>
      ${this.#meter('Condition', 'hp')}
      <p class="desc">${esc(d.desc)}</p>
      <div class="kvs" data-k="kv"></div>
      <div class="actions">
        <button class="act" data-a="prio">${icon('i-hammer')}Build first</button>
        <button class="act danger" data-a="cancel">${icon('i-x')}<span data-k="cancel">Cancel</span></button>
      </div>`;
    p.querySelector('.actions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'prio') { for (const q of sim.structures.list) q.priority = false; s.priority = true; sim.log('info', `${d.name} marked as the building priority.`); }
      if (b.dataset.a === 'cancel') {
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.querySelector('[data-k="cancel"]').textContent = s.built ? 'Confirm tear down' : 'Confirm cancel'; return; }
        sim.cancel(s); this.select(null);
      }
    });
    return {
      update: () => {
        if (s.dead) return;
        p.querySelector('[data-k="state"]').textContent = `${BUILD_CATS.find((c) => c.id === d.cat)?.name || 'Camp'} · ${s.built ? (s.hp < s.maxHp * 0.6 ? 'damaged' : 'standing') : `under construction, ${s.workers.size} builder${s.workers.size === 1 ? '' : 's'}`}`;
        p.querySelector('[data-k="progw"]').classList.toggle('hidden', s.built);
        this.#setMeter(p, 'prog', s.progress * 100, `${Math.floor(s.progress * 100)}%`, '');
        this.#setMeter(p, 'hp', (s.hp / s.maxHp) * 100, `${Math.round(s.hp)}`);
        const kv = [];
        if (d.housing) { const n = sim.survivors.filter((q) => q.alive && q.home === s.id).length; kv.push(['Beds', `${n}/${d.housing} used`]); }
        if (s.type === 'farm') kv.push(['Crop', s.extra.growth >= 1 ? 'ready to harvest' : `${Math.round(s.extra.growth * 100)}% grown`], ['Farmer', s.workers.size ? [...s.workers].map((q) => q.first).join(', ') : 'none']);
        if (s.type === 'rain_collector') kv.push(['Yield', sim.world.sky.rain > 0.3 ? '~2.6 water/h (raining)' : '~0.2 water/h (dew)']);
        if (s.type === 'generator') kv.push(['Status', sim.powered ? 'running' : sim.res.fuel <= 0 ? 'out of fuel' : 'idle'], ['Fuel', `${Math.floor(sim.res.fuel)}`]);
        if (s.type === 'radio') kv.push(['Broadcast', `${Math.floor(sim.broadcast)} / 48 h`], ['Power', sim.powered ? 'on' : 'off: build a generator and keep fuel']);
        if (s.type === 'watchtower') kv.push(['On watch', (s.extra.slots || []).filter((q) => q.taken && q.taken.alive).map((q) => q.taken.first).join(', ') || 'nobody']);
        if (s.type === 'infirmary') kv.push(['Patients', `${sim.patients(s)}`], ['Medic', sim.medicOnDuty(s)?.first || 'none on duty']);
        if (s.type === 'cache' || s.type === 'storage') kv.push(['Capacity', `${sim.cap('food')} per resource`]);
        if (s.type === 'gate') kv.push(['Gate', s.extra.open ? 'open' : 'shut']);
        p.querySelector('[data-k="kv"]').innerHTML = kv.map(([a, b]) => `<div class="kv"><span>${esc(a)}</span><span>${esc(b)}</span></div>`).join('');
        p.querySelector('[data-a="prio"]').classList.toggle('hidden', s.built);
        const c = p.querySelector('[data-a="cancel"]');
        c.classList.toggle('hidden', s.type === 'cache');
        if (c.dataset.confirm !== '1') p.querySelector('[data-k="cancel"]').textContent = s.built ? 'Tear down (30% back)' : 'Cancel (refund)';
      },
    };
  }

  #infectedPanel(p, z) {
    p.innerHTML = `<h3>Infected</h3><div class="sub" data-k="st"></div>${this.#meter('Health', 'hp')}
      <p class="desc">Slow while wandering, fast when they smell prey, faster at night. Drawn by gunfire, chopping and building. Bites infect.</p>`;
    const names = { wander: 'Wandering', investigate: 'Following a noise', march: 'Marching with the horde', chase: 'Hunting', attack: 'Attacking', break: 'Breaking through a barricade' };
    return { update: () => { p.querySelector('[data-k="st"]').textContent = z.alive ? `${names[z.state] || z.state}${z.horde ? ' · horde' : ''}` : 'Dead'; this.#setMeter(p, 'hp', (Math.max(0, z.hp) / z.maxHp) * 100, `${Math.max(0, Math.round(z.hp))}`, ''); } };
  }

  #lootPanel(p, L) {
    const sim = this.sim;
    const kinds = Object.entries(LOOT_TABLE[L.kind] || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r]) => RES_NAME[r].toLowerCase()).join(', ');
    p.innerHTML = `<h3>${esc(L.name[0].toUpperCase() + L.name.slice(1))}</h3><div class="sub">Scavenging site</div>${this.#meter('Left', 'rem')}
      <p class="desc">Likely finds: ${esc(kinds)}.</p><div class="kvs" data-k="kv"></div>
      <div class="actions"><button class="act" data-a="send">${icon('j-bag')}Send a scavenger</button></div>`;
    p.querySelector('[data-a="send"]').addEventListener('click', () => {
      const cands = sim.alive().filter((s) => !s.possessed && !['fight', 'flee'].includes(s.task?.kind));
      cands.sort((a, b) => (b.skills.scav + (b.armed ? 0.5 : 0) + (b.job === 'scavenger' ? 1 : 0) - (b.job === 'guard' ? 1 : 0)) - (a.skills.scav + (a.armed ? 0.5 : 0) + (a.job === 'scavenger' ? 1 : 0) - (a.job === 'guard' ? 1 : 0)));
      const s = cands[0];
      if (s) { sim.order(s, { kind: 'scavenge', loot: L }); this.toast({ title: `${s.first} is heading to ${L.name}`, kind: 'info', pos: L.door }); }
    });
    return {
      update: () => {
        this.#setMeter(p, 'rem', (L.remaining / Math.max(1, L.max)) * 100, L.remaining <= 0 ? 'empty' : `${Math.round((L.remaining / L.max) * 100)}%`, L.remaining <= 0 ? 'bad' : '');
        const danger = sim.infectedNear(L, 30);
        p.querySelector('[data-k="kv"]').innerHTML = `<div class="kv"><span>Infected nearby</span><span>${danger || 'none seen'}</span></div><div class="kv"><span>Distance</span><span>${Math.round(Math.hypot(L.x - sim.center.x, L.z - sim.center.z))} m from camp</span></div>`;
        p.querySelector('[data-a="send"]').disabled = L.remaining <= 0;
      },
    };
  }

  #visitorPanel(p, v) {
    const sim = this.sim;
    if (v.kind === 'trader') return this.#colonyPanel(p);
    const d = v.data;
    p.innerHTML = `<h3>${esc(d.name)}</h3><div class="sub">${esc(d.occupation)}${d.armed ? ' · armed' : ''} · stranger</div>
      <div class="chips">${d.traits.map((t) => `<span class="chip ${TRAITS[t].good ? 'good' : 'bad'}">${TRAITS[t].name}</span>`).join('')}</div>
      <div class="actions"><button class="act" data-a="yes">Take them in</button><button class="act danger" data-a="no">Turn away</button></div>`;
    p.querySelector('.actions').addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (!b) return; sim.answerStranger(b.dataset.a === 'yes'); this.closeModal(); this.select(null); });
    return { update: () => {} };
  }

  #colonyPanel(p) {
    const sim = this.sim;
    const t = sim.trader;
    const jobOpts = Object.entries(JOBS).map(([k, j]) => `<option value="${k}">${j.name}</option>`).join('');
    p.innerHTML = `
      <h3>Colony</h3><div class="sub" data-k="sub"></div>
      ${this.#meter('Morale', 'morale')}
      <div class="kvs" data-k="kv"></div>
      ${t && t.here ? `<h4>Trader (until 17:00)</h4><div class="trade">${t.offers.map((o, i) => `<div class="offer"><span>${o.giveN} ${RES_NAME[o.give].toLowerCase()} → ${o.getN} ${RES_NAME[o.get].toLowerCase()}</span><span class="stock" data-st="${i}"></span><button class="act" data-trade="${i}">Trade</button></div>`).join('')}</div>` : ''}
      ${sim.pendingStranger?.visitor.arrived ? `<h4>Stranger at the camp</h4><div class="actions"><button class="act" data-a="yes">Take ${esc(sim.pendingStranger.data.first)} in</button><button class="act danger" data-a="no">Turn away</button></div>` : ''}
      <h4>Survivors</h4><div class="roster" data-k="roster"></div>`;
    const roster = p.querySelector('[data-k="roster"]');
    const alive = sim.alive();
    roster.innerHTML = alive.map((s) => `<div class="row" data-id="${s.id}"><button class="nm">${esc(s.name)}</button><span class="st" data-st="${s.id}"></span><select data-job="${s.id}">${jobOpts}</select></div>`).join('');
    roster.addEventListener('click', (e) => { const b = e.target.closest('.nm'); if (!b) return; const s = alive.find((q) => q.id === +b.parentNode.dataset.id); if (s) { this.select({ kind: 'survivor', ref: s }); this.game.rig.focusOn(s.pos.x, s.pos.z); } });
    roster.addEventListener('change', (e) => { const sel = e.target.closest('select'); if (!sel) return; const s = alive.find((q) => q.id === +sel.dataset.job); if (s) sim.setJob(s, sel.value, sim.ai.enabled ? true : null); });
    p.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-trade]');
      if (tb) { if (!sim.trade(+tb.dataset.trade)) this.toast({ title: 'Not enough to trade', kind: 'warn' }); }
      const a = e.target.closest('[data-a]');
      if (a) { sim.answerStranger(a.dataset.a === 'yes'); this.closeModal(); this.select({ kind: 'colony' }, true); }
    });
    return {
      update: () => {
        const pop = sim.alive().length;
        p.querySelector('[data-k="sub"]').textContent = `Day ${sim.day} · ${pop} survivor${pop === 1 ? '' : 's'} · ${sim.stats.killed} infected killed`;
        this.#setMeter(p, 'morale', sim.morale, `${Math.round(sim.morale)}%`);
        const armed = alive.filter((s) => s.alive && s.armed).length, guards = alive.filter((s) => s.alive && s.job === 'guard').length;
        const kv = [
          ['Beds', `${sim.housing} for ${pop}`], ['Food / water', `${(sim.res.food / Math.max(1, pop * 1.1)).toFixed(1)} / ${(sim.res.water / Math.max(1, pop * 1.5)).toFixed(1)} days`],
          ['Defence', `${armed} armed, ${guards} on guard, ${sim.structures.count('watchtower')} tower${sim.structures.count('watchtower') === 1 ? '' : 's'}, ${sim.structures.count('barricade')} walls`],
          ['Next horde', sim.day >= sim.diff.hordeStart ? 'tonight after 22:00' : `from night ${sim.diff.hordeStart}`],
        ];
        if (sim.structures.count('radio')) kv.push(['Radio', `${Math.floor(sim.broadcast)}/48 h on air`]);
        p.querySelector('[data-k="kv"]').innerHTML = kv.map(([a, b]) => `<div class="kv"><span>${a}</span><span>${esc(b)}</span></div>`).join('');
        for (const s of alive) {
          const st = p.querySelector(`[data-st="${s.id}"]`), sel = p.querySelector(`[data-job="${s.id}"]`);
          if (!st) continue;
          st.textContent = s.alive ? s.activity : 'dead';
          st.className = 'st ' + (s.hp < 40 || s.infection > 0 ? 'bad' : '');
          if (document.activeElement !== sel) sel.value = s.job;
        }
        if (t && t.here) t.offers.forEach((o, i) => { const el = p.querySelector(`[data-st="${i}"]`); if (el) el.textContent = `×${o.stock}`; const b = p.querySelector(`[data-trade="${i}"]`); if (b) b.disabled = o.stock <= 0 || sim.res[o.give] < o.giveN; });
      },
    };
  }

  // ================================================================ modal (stranger)
  #decisionModal() {
    const sim = this.sim;
    const p = sim.pendingStranger;
    if (!p || sim.ai.enabled) return;
    const d = p.data;
    const m = $('modal');
    m.innerHTML = `<h3>A stranger at the camp</h3>
      <p><b>${esc(d.name)}</b>, ${esc(d.occupation.toLowerCase())}${d.armed ? ', carrying a rifle' : ''}, asks to join.</p>
      <div class="chips">${d.traits.map((t) => `<span class="chip ${TRAITS[t].good ? 'good' : 'bad'}" title="${esc(TRAITS[t].desc)}">${TRAITS[t].name}</span>`).join('')}</div>
      <p class="dim">Another mouth: about 1.1 food and 1.5 water a day, and a bed.</p>
      <div class="actions"><button class="act" data-a="yes">Take them in</button><button class="act danger" data-a="no">Turn away</button><button class="act" data-a="look">Look</button></div>`;
    m.classList.remove('hidden');
    m.onclick = (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'look') { this.game.rig.focusOn(p.visitor.pos.x, p.visitor.pos.z, 25); return; }
      sim.answerStranger(b.dataset.a === 'yes');
      this.closeModal();
    };
  }
  closeModal() { $('modal').classList.add('hidden'); }

  // ================================================================ labels over the world
  #updateLabels() {
    const sim = this.sim, cam = this.game.camera, box = $('labels');
    const W = window.innerWidth, H = window.innerHeight;
    const want = new Map();
    for (const s of sim.structures.list) if (!s.built) want.set('s' + s.id, { x: s.x, y: s.y + Math.min(3, s.height || 2) + 0.5, z: s.z, text: `${s.def.name} ${Math.floor(s.progress * 100)}%`, cls: 'site' });
    const sel = this.sel;
    if (sel?.kind === 'survivor' && sel.ref.alive && !sel.ref.c.hidden) want.set('sel', { x: sel.ref.pos.x, y: sel.ref.pos.y + 2.1 + (sel.ref.c.lift || 0), z: sel.ref.pos.z, text: sel.ref.first, cls: 'name' });
    for (const v of sim.visitors) if (v.alive && !v.leave) want.set('v' + v.data.id, { x: v.pos.x, y: v.pos.y + 2.1, z: v.pos.z, text: v.kind === 'trader' ? 'Trader' : 'Stranger', cls: 'visitor' });
    for (const [k, el] of this.labels) if (!want.has(k)) { el.remove(); this.labels.delete(k); }
    for (const [k, w] of want) {
      _v.set(w.x, w.y, w.z);
      const d = _v.distanceTo(cam.position);
      _v.project(cam);
      let el = this.labels.get(k);
      const vis = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 && d < 160;
      if (!el) { el = document.createElement('div'); el.className = 'wlabel ' + w.cls; box.appendChild(el); this.labels.set(k, el); }
      el.style.display = vis ? '' : 'none';
      if (!vis) continue;
      if (el.textContent !== w.text) { el.textContent = w.text; el._w = el.offsetWidth; }
      // keep the whole label on screen when its anchor is near an edge
      const hw = (el._w || 60) / 2 + 6;
      const px = Math.min(W - hw, Math.max(hw, ((_v.x + 1) / 2) * W)), py = Math.max(28, ((1 - _v.y) / 2) * H);
      el.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`;
    }
  }

  // ================================================================ walk overlay
  walkPrompt(text, progress = null) {
    const el = $('walk-prompt');
    el.classList.toggle('hidden', !text);
    if (!text) return;
    el.querySelector('span').textContent = text;
    el.querySelector('i').style.width = progress === null ? '0' : `${Math.round(progress * 100)}%`;
    el.querySelector('.bar').classList.toggle('hidden', progress === null);
  }
  #updateWalk() {
    const s = this.game.possessed;
    if (!s) return;
    $('walk-vitals').innerHTML = `<span>${esc(s.first)}</span><span>${icon('r-pop')}${Math.round(s.hp)}</span><span>${icon('r-ammo')}${s.armed ? Math.floor(this.sim.res.ammo) : '—'}</span>${s.infection > 0 ? `<span class="bad">bitten ${Math.round(s.infection)}%</span>` : ''}`;
  }

  // ================================================================ mobile
  #mobile() {
    const bar = $('mobilebar');
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const m = b.dataset.m;
      if (m === 'build') { $('buildbar').classList.toggle('sheet-open'); this.select(null); }
      if (m === 'colony') { $('buildbar').classList.remove('sheet-open'); this.select(this.sel?.kind === 'colony' ? null : { kind: 'colony' }); }
      if (m === 'ai') this.toggleAI();
      if (m === 'speed') { const order = [1, 2, 4, 0]; this.setSpeed(order[(order.indexOf(this.sim.speed) + 1) % order.length]); }
      if (m === 'map') $('minimap-wrap').classList.toggle('open');
      if (m === 'log') $('ai-log').classList.toggle('collapsed');
    });
  }

  // ================================================================ tooltips
  #tooltips(root, sel, fn) {
    const tip = $('tooltip');
    root.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const n = e.target.closest(sel); if (!n) return;
      const html = fn(n); if (!html) return;
      tip.innerHTML = html; tip.classList.remove('hidden');
      const r = n.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
      if (y < 8) y = r.bottom + 8;
      x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
    });
    root.addEventListener('pointerout', (e) => { if (!e.relatedTarget || !root.contains(e.relatedTarget) || !e.relatedTarget.closest(sel)) tip.classList.add('hidden'); });
  }

  // ================================================================ per frame
  update(dt) {
    const sim = this.sim;
    if (!sim.started) return;
    this.acc += dt; this.accSlow += dt;
    this.#updateLabels();
    if (this.acc < 0.25) return;
    this.acc = 0;
    $('hud-day').textContent = `Day ${sim.day}`;
    $('hud-time').textContent = sim.timeString;
    const w = WEATHER[sim.world.sky.weather] || WEATHER.clear;
    const wi = sim.night && sim.world.sky.weather === 'clear' ? 'w-moon' : w[0];
    const wEl = $('hud-weather');
    if (wEl.dataset.w !== wi + w[1]) { wEl.dataset.w = wi + w[1]; wEl.innerHTML = `${icon(wi)}<span>${w[1]}</span>`; }
    // resource history for daily trends
    if (!this.history.length || sim.clock - this.history[this.history.length - 1].t > HOUR) {
      this.history.push({ t: sim.clock, res: { ...sim.res } });
      while (this.history.length > 25) this.history.shift();
    }
    this.#updateResources();
    this.#updateBuild();
    this.panel?.update?.();
    if (this.sel?.kind === 'survivor' && !this.sel.ref.alive && this.accSlow > 3) this.select(null);
    if (this.accSlow > 1) { this.accSlow = 0; this.#updateObjective(); }
    this.minimap.draw();
    this.#updateWalk();
    this.#aiState();
  }
}
