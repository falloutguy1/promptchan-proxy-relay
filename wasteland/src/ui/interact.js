// Maps pointer, touch and keyboard input to game actions: selecting survivors,
// structures, the infected and scavenging sites; context commands for the
// selected survivor (move, chop, scavenge, build, attack); structure placement
// with a validity ghost, rotation and wall snapping (mouse: click to place,
// shift to keep placing; touch: tap to position, confirm/rotate buttons);
// keyboard camera panning and shortcuts; first-person actions in walk mode.
import * as THREE from 'three';
import { STRUCTURES, BUILD_CATS } from '../sim/defs.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

export class Interaction {
  constructor(game) {
    this.game = game;
    this.sim = game.sim;
    this.hud = game.hud;
    this.input = game.input;
    this.placing = null;
    this.touch = document.body.classList.contains('touch');
    this.marker = this.#makeMarker();
    game.scene.add(this.marker);
    const inp = this.input;
    inp.on('tap', (x, y, button, dbl, type) => this.#tap(x, y, button, dbl, type));
    inp.on('hover', (x, y) => this.#hover(x, y));
    inp.on('key', (k, e) => this.#key(k, e));
    inp.on('longPress', (x, y) => this.#longPress(x, y));
    inp.on('requestLock', () => { if (!this.touch) game.canvas.requestPointerLock?.(); });
    $('place-ok').addEventListener('click', () => this.#confirmPlace());
    $('place-rotate').addEventListener('click', () => this.rotate());
    $('place-cancel').addEventListener('click', () => this.cancelPlace());
    this.useHeld = false;
    this.fireHeld = false;
    $('walk-exit').addEventListener('click', () => game.exitWalk());
    const hold = (id, key) => {
      const b = $(id);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this[key] = true; if (key === 'fireHeld') this.#fire(); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { this[key] = false; });
    };
    hold('walk-fire', 'fireHeld');
    hold('walk-use', 'useHeld');
    game.canvas.addEventListener('mousedown', (e) => { if (game.rig.mode === 'walk' && this.input.locked && e.button === 0) this.#fire(); });
    window.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 'e') this.useHeld = false; });
  }

  #makeMarker() {
    const g = new THREE.RingGeometry(0.35, 0.55, 28).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0, depthWrite: false }));
    m.renderOrder = 6;
    m.userData.t = 0;
    return m;
  }
  #mark(x, z, color = 0xf2c14e) {
    const m = this.marker;
    m.position.set(x, this.game.world.terrain.height(x, z) + 0.08, z);
    m.material.color.setHex(color);
    m.userData.t = 0.9;
  }

  // ------------------------------------------------------------ picking
  #screen(p, y = 1.1) {
    const r = this.game.canvas.getBoundingClientRect();
    _v.set(p.x, p.y + y, p.z).project(this.game.camera);
    if (_v.z > 1) return null;
    return { x: r.left + ((_v.x + 1) / 2) * r.width, y: r.top + ((1 - _v.y) / 2) * r.height };
  }
  /** Nearest agent to a screen point within a pixel radius. */
  #pickAgent(list, x, y, rad) {
    let best = null, bd = rad * rad;
    for (const a of list) {
      if (!a.alive || a.c.hidden) continue;
      const s = this.#screen(a.pos, 1.0 + (a.c.lift || 0));
      if (!s) continue;
      const d = (s.x - x) ** 2 + ((s.y - y) * 0.7) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  pick(x, y) {
    const sim = this.sim, rad = this.touch ? 34 : 24;
    const sv = this.#pickAgent(sim.survivors, x, y, rad);
    if (sv) return { kind: 'survivor', ref: sv };
    const vis = this.#pickAgent(sim.visitors, x, y, rad);
    if (vis) return { kind: 'visitor', ref: vis };
    const z = this.#pickAgent(sim.infected, x, y, rad);
    if (z) return { kind: 'infected', ref: z };
    const g = this.game.pickGround(x, y);
    if (!g) return null;
    const s = sim.structures.at(g.x, g.z);
    if (s) return { kind: 'structure', ref: s, ground: g };
    for (const L of sim.lootSites) {
      const b = this.game.world.town.buildings.find((q) => q.lot.id === L.id);
      if (b) {
        const lot = b.lot, cs = Math.cos(lot.rot), sn = Math.sin(lot.rot), dx = g.x - lot.x, dz = g.z - lot.z;
        const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        if (Math.abs(lx) < lot.w / 2 + 1 && Math.abs(lz) < lot.d / 2 + 1.5) return { kind: 'loot', ref: L, ground: g };
      } else if (Math.hypot(g.x - L.x, g.z - L.z) < 9) return { kind: 'loot', ref: L, ground: g };
    }
    const tree = this.game.world.trees.nearestWithin(g.x, g.z, 2.5);
    if (tree && Math.hypot(tree.x - g.x, tree.z - g.z) < 2.2) return { kind: 'tree', ref: tree, ground: g };
    return { kind: 'ground', ground: g };
  }

  // ------------------------------------------------------------ taps / clicks
  #tap(x, y, button, dbl, type) {
    const game = this.game;
    if (!this.sim.started || game.rig.mode === 'walk') return;
    if (this.placing) {
      if (button === 2) { this.cancelPlace(); return; }
      this.#movePlace(x, y);
      if (type !== 'touch') this.#confirmPlace(game.input.keys.has('Shift'));
      return;
    }
    const hit = this.pick(x, y);
    const sel = this.hud.sel;
    const commander = sel?.kind === 'survivor' && sel.ref.alive;
    if (button === 2) { if (commander) this.#command(sel.ref, hit, dbl); return; }
    if (hit?.kind === 'survivor') { this.hud.select(hit); return; }
    if (type === 'touch' && commander && hit && hit.kind !== 'visitor') { this.#command(sel.ref, hit, dbl); return; }
    if (!hit || hit.kind === 'ground' || hit.kind === 'tree') { this.hud.select(null); game.rig.follow = null; return; }
    this.hud.select(hit);
  }

  #longPress(x, y) {
    if (this.placing) { this.rotate(); return; }
    const sel = this.hud.sel;
    if (sel?.kind === 'survivor') this.#command(sel.ref, this.pick(x, y), false);
  }

  #command(s, hit, run) {
    const sim = this.sim;
    if (!hit) return;
    if (sim.ai.enabled && !s.locked) { s.locked = true; this.hud.toast({ title: `${s.first} locked to your orders`, kind: 'ai', detail: 'The Overseer will leave them alone. Unlock in their panel.' }); }
    const g = hit.ground;
    switch (hit.kind) {
      case 'infected': sim.order(s, { kind: 'fight', target: hit.ref, t: 0 }); this.#mark(hit.ref.pos.x, hit.ref.pos.z, 0xe0503c); break;
      case 'tree': if (!sim.treeReserved.has(hit.ref) && !hit.ref.removed) { hit.ref.trunk = 0.3; sim.order(s, { kind: 'chop', tree: hit.ref }); this.#mark(hit.ref.x, hit.ref.z, 0x93a45e); } break;
      case 'loot': sim.order(s, { kind: 'scavenge', loot: hit.ref }); this.#mark(hit.ref.door.x, hit.ref.door.z, 0xe0c080); break;
      case 'structure': {
        const t = hit.ref;
        if (!t.built || t.hp < t.maxHp * 0.8) sim.order(s, { kind: 'build', site: t, repair: t.built });
        else sim.order(s, { kind: 'goto', x: g.x, z: g.z, run });
        this.#mark(t.x, t.z);
        break;
      }
      default: sim.order(s, { kind: 'goto', x: g.x, z: g.z, run }); this.#mark(g.x, g.z);
    }
    this.game.audio?.ui('order');
  }

  #hover(x, y) {
    if (this.placing && !this.touch) this.#movePlace(x, y);
  }

  // ------------------------------------------------------------ placement
  startPlace(type) {
    const def = STRUCTURES[type];
    if (!def || !this.sim.started) return;
    this.placing = { type, rot: this.placing?.rot ?? 0, x: this.game.rig.target.x, z: this.game.rig.target.z, ok: false, reason: '' };
    this.sim.structures.ghost(type);
    $('place-confirm').classList.toggle('hidden', !this.touch);
    document.body.classList.add('placing');
    this.hud.select(null);
    this.#updateGhost();
    this.hud.toast({ title: `Place: ${def.name}`, kind: 'info', detail: this.touch ? 'Tap the ground to position, then confirm. Long-press or ↻ to rotate.' : 'Click to place, R or Q/E to rotate, Shift+click to keep placing, right-click to cancel.' });
  }
  cancelPlace() {
    if (!this.placing) return;
    this.placing = null;
    this.sim.structures.clearGhost();
    $('place-confirm').classList.add('hidden');
    document.body.classList.remove('placing');
    $('tooltip').classList.add('hidden');
  }
  rotate(d = Math.PI / 8) { if (!this.placing) return; this.placing.rot += d; this.#updateGhost(); }
  #movePlace(x, y) {
    const g = this.game.pickGround(x, y);
    if (!g || !this.placing) return;
    this.placing.x = g.x; this.placing.z = g.z;
    this.placing.sx = x; this.placing.sy = y;
    this.#updateGhost();
  }
  #updateGhost() {
    const p = this.placing;
    if (!p) return;
    const def = STRUCTURES[p.type];
    let x = p.x, z = p.z, rot = p.rot;
    if (def.snap) { const s = this.sim.structures.snapWall(x, z, rot); if (s) { x = s.x; z = s.z; rot = s.rot; } }
    p.px = x; p.pz = z; p.prot = rot;
    const chk = this.sim.structures.check(p.type, x, z, rot);
    const afford = this.sim.canAfford(def.cost);
    p.ok = chk.ok && afford;
    p.reason = !afford ? 'Not enough materials' : chk.reason || '';
    this.sim.structures.updateGhost(x, z, rot, p.ok);
    const tip = $('tooltip');
    if (!this.touch && p.sx !== undefined) {
      tip.innerHTML = `<b>${def.name}</b>${p.ok ? 'Click to place' : `<span class="req">${p.reason}</span>`}`;
      tip.classList.remove('hidden');
      tip.style.left = `${p.sx + 18}px`; tip.style.top = `${p.sy + 14}px`;
    }
    $('place-ok').disabled = !p.ok;
  }
  #confirmPlace(keep = false) {
    const p = this.placing;
    if (!p) return;
    this.#updateGhost();
    if (!p.ok) { this.hud.toast({ title: `Cannot place ${STRUCTURES[p.type].name.toLowerCase()}`, kind: 'warn', detail: p.reason }); return; }
    const r = this.sim.place(p.type, p.px, p.pz, p.prot, 'human');
    if (!r.ok) { this.hud.toast({ title: 'Cannot place', kind: 'warn', detail: r.reason }); return; }
    this.game.audio?.ui('place');
    const def = STRUCTURES[p.type];
    const builders = this.sim.alive().filter((s) => s.job === 'builder').length;
    if (!builders && !this.sim.ai.enabled && !this.warnedBuilders) { this.warnedBuilders = true; this.hud.toast({ title: 'No builders', kind: 'warn', detail: 'Assign someone the Builder job so the site gets built.' }); }
    if (keep || def.snap) { this.#updateGhost(); return; }
    this.cancelPlace();
  }

  // ------------------------------------------------------------ keyboard
  #key(k, e) {
    const game = this.game, hud = this.hud;
    if (!this.sim.started) return;
    if (game.rig.mode === 'walk') {
      if (k === 'Escape' || k === 'v') game.exitWalk();
      if (k === 'e') this.useHeld = true;
      return;
    }
    if (game.menu.open) { if (k === 'Escape' && !game.sim.ended) game.menu.resume(); return; }
    if (k === 'Escape') {
      if (this.placing) this.cancelPlace();
      else if (hud.sel) hud.select(null);
      else game.menu.pause();
      return;
    }
    if (k === ' ') { hud.setSpeed(this.sim.speed ? 0 : this.lastSpeed || 1); if (this.sim.speed) this.lastSpeed = this.sim.speed; return; }
    if (this.placing) {
      if (k === 'r' || k === 'e') this.rotate(Math.PI / 8);
      if (k === 'q') this.rotate(-Math.PI / 8);
      return;
    }
    if (['1', '2', '3'].includes(k) && !e.ctrlKey) {
      // number keys: build item in the open category when the bar is focused with B, else speed
      if (this.buildKeys) { const items = Object.entries(STRUCTURES).filter(([, d]) => d.cat === hud.buildCat); const it = items[+k - 1]; if (it) this.startPlace(it[0]); return; }
      hud.setSpeed({ 1: 1, 2: 2, 3: 4 }[k]); this.lastSpeed = this.sim.speed; return;
    }
    if (k === 'Tab') { hud.toggleAI(); return; }
    if (k === 'b') { const i = BUILD_CATS.findIndex((c) => c.id === hud.buildCat); document.querySelector(`#build-cats [data-c="${BUILD_CATS[(i + (this.buildKeys ? 1 : 0)) % BUILD_CATS.length].id}"]`)?.click(); this.buildKeys = true; clearTimeout(this.bkT); this.bkT = setTimeout(() => { this.buildKeys = false; }, 4000); return; }
    if (k === 'c') { hud.select(hud.sel?.kind === 'colony' ? null : { kind: 'colony' }); return; }
    if (k === 'h') { game.rig.follow = null; game.rig.focusOn(this.sim.center.x, this.sim.center.z, 50); return; }
    if (k === 'v' && hud.sel?.kind === 'survivor') { game.enterWalk(hud.sel.ref); return; }
    if (k === 'f' && hud.sel?.ref?.c) { game.rig.follow = hud.sel.ref.c.root; return; }
    if (k === 'Delete' && hud.sel?.kind === 'structure') { this.sim.cancel(hud.sel.ref); hud.select(null); return; }
    if (k === 'l') { $('ai-log').classList.toggle('collapsed'); return; }
    if (k === 'F3' || k === '`') { const p = $('perf'); p.classList.toggle('hidden'); game.settings.showFps = !p.classList.contains('hidden'); game.settings.save(); }
  }

  // ------------------------------------------------------------ walk mode actions
  #fire() {
    const s = this.game.possessed;
    if (!s || !s.alive) return;
    if ((this.fireCool || 0) > 0) return;
    this.fireCool = s.armed ? 0.45 : 0.9;
    const cam = this.game.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    this.sim.playerAttack(s, cam.position.clone(), dir);
  }

  /** Per-frame: keyboard panning, placement follow, walk-mode interaction prompt. */
  update(dt) {
    const game = this.game, sim = this.sim, inp = this.input;
    const m = this.marker;
    if (m.userData.t > 0) { m.userData.t -= dt; m.material.opacity = Math.min(1, m.userData.t * 1.6); m.scale.setScalar(1 + (0.9 - m.userData.t) * 0.6); }
    else m.material.opacity = 0;
    this.fireCool = (this.fireCool || 0) - dt;
    if (!sim.started) return;
    if (game.rig.mode === 'rts' && !inp.keys.has('Control')) {
      const k = inp.keys;
      let dx = 0, dz = 0;
      if (k.has('w') || k.has('ArrowUp')) dz -= 1;
      if (k.has('s') || k.has('ArrowDown')) dz += 1;
      if (k.has('a') || k.has('ArrowLeft')) dx -= 1;
      if (k.has('d') || k.has('ArrowRight')) dx += 1;
      if (dx || dz) { const sp = game.rig.cur.dist * 0.9 * dt * (k.has('Shift') ? 2.2 : 1); game.rig.pan(dx * sp, dz * sp); }
      if (!this.placing) { if (k.has('q')) game.rig.rotate(dt * 1.4); if (k.has('e')) game.rig.rotate(-dt * 1.4); }
    }
    if (game.rig.mode === 'walk') this.#walkInteract(dt);
  }

  #walkInteract(dt) {
    const s = this.game.possessed, sim = this.sim, hud = this.hud;
    if (!s) return;
    if (this.fireHeld && s.armed) this.#fire();
    const p = s.pos;
    // what is in reach?
    let target = null;
    const site = sim.structures.list.find((q) => (!q.built || q.hp < q.maxHp * 0.8) && Math.hypot(q.x - p.x, q.z - p.z) < Math.max(q.def.w, q.def.d) / 2 + 2);
    if (site) target = { kind: 'build', site, label: `${site.built ? 'Repair' : 'Build'} ${site.def.name.toLowerCase()} (${Math.floor(site.progress * 100)}%)` };
    if (!target) {
      const L = sim.lootSites.find((q) => q.remaining > 0 && Math.hypot(q.door.x - p.x, q.door.z - p.z) < 3.2);
      if (L) target = { kind: 'loot', L, label: `Search ${L.name}` };
    }
    if (!target) {
      const tree = this.game.world.trees.nearestWithin(p.x, p.z, 3, (it) => !sim.treeReserved.has(it) && it.kind !== 'dead');
      if (tree && Math.hypot(tree.x - p.x, tree.z - p.z) < 2.4) target = { kind: 'chop', tree, label: `Chop ${tree.kind === 'conifer' ? 'pine' : tree.kind}` };
    }
    if (!target) { this.useT = 0; this.useTarget = null; hud.walkPrompt(''); return; }
    if (this.useTarget?.kind !== target.kind || this.useTarget?.site !== target.site || this.useTarget?.tree !== target.tree || this.useTarget?.L !== target.L) this.useT = 0;
    this.useTarget = target;
    const need = target.kind === 'chop' ? 3.5 : target.kind === 'loot' ? 4 : 0;
    const key = this.touch ? 'Hold ✋' : 'Hold E';
    if (this.useHeld) {
      if (target.kind === 'build') {
        if (target.site.built) sim.structures.repair(target.site, dt * 12); else sim.addWork(target.site, (dt / 30) * 2.2);
        hud.walkPrompt(`${target.label}`, target.site.built ? target.site.hp / target.site.maxHp : target.site.progress);
        return;
      }
      this.useT += dt;
      hud.walkPrompt(target.label, Math.min(1, this.useT / need));
      if (this.useT >= need) {
        this.useT = 0;
        if (target.kind === 'chop') { const n = sim.fellTree(target.tree, s); sim.give('wood', n); hud.toast({ title: `+${n} wood`, kind: 'good' }); }
        if (target.kind === 'loot') { const got = sim.loot(target.L, s); const parts = []; for (const [r, n] of Object.entries(got.bag)) { sim.give(r, n); parts.push(`+${n} ${r}`); } hud.toast({ title: parts.join(', ') || 'Nothing useful', kind: 'good', detail: `From ${target.L.name}` }); }
      }
    } else hud.walkPrompt(`${key} · ${target.label}`);
  }
}
