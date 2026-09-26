// DOM HUD: gauges, target list, damage diagram, minimap, aim markers, bombsight overlay.
import * as THREE from 'three';
import { TARGETS, riverZ, TOWN, FLAK_SITES } from '../world/layout.js';

const $ = (id) => document.getElementById(id);
const _p = new THREE.Vector3();

export class HUD {
  constructor() {
    this.el = $('hud');
    this.msgT = 0;
    this.map = $('minimap');
    this.mctx = this.map.getContext('2d');
    this.targetsEl = $('hud-targets');
    this._lastTargets = '';
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  message(text, dur = 3.5) {
    const m = $('hud-msg');
    m.textContent = text;
    m.style.opacity = 1;
    this.msgT = dur;
  }

  project(worldPos, camera, el) {
    _p.copy(worldPos).project(camera);
    const vis = _p.z < 1 && Math.abs(_p.x) < 1.2 && Math.abs(_p.y) < 1.2;
    el.style.display = vis ? 'block' : 'none';
    if (vis) {
      el.style.left = ((_p.x * 0.5 + 0.5) * innerWidth) + 'px';
      el.style.top = ((-_p.y * 0.5 + 0.5) * innerHeight) + 'px';
    }
  }

  update(dt, g) {
    const b = g.player, fl = b.fl;
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) $('hud-msg').style.opacity = 0; }
    $('g-ias').textContent = Math.round(fl.ias * 2.237);
    $('g-alt').textContent = Math.round(fl.pos.y * 3.281 / 10) * 10;
    $('g-hdg').textContent = String(Math.round(fl.heading())).padStart(3, '0');
    $('g-thr').textContent = Math.round(fl.throttle * 100);
    $('g-bombs').textContent = b.bombs;
    $('g-mode').textContent = g.releaseMode;
    // aim & nose markers
    const inSight = g.camMode === 'sight';
    this.project(g.aimWorld, g.camera, $('aim'));
    if (inSight) $('aim').style.display = 'none';
    this.project(_p.copy(fl.forward()).multiplyScalar(1500).add(fl.pos), g.camera, $('nose'));
    // targets
    const rows = TARGETS.map(t => {
      const s = g.targetState[t.id];
      const pct = Math.min(1, s.frac / s.need);
      return `<div class="tg ${s.done ? 'dead' : ''}"><span class="nm">${t.name}${t.primary ? ' <span class="pri">PRIMARY</span>' : ''}</span><span class="hp"><i style="width:${(pct * 100).toFixed(0)}%"></i></span></div>`;
    }).join('');
    if (rows !== this._lastTargets) { this.targetsEl.innerHTML = rows; this._lastTargets = rows; }
    // damage
    const cls = (v) => v > 0.75 ? '' : v > 0.4 ? 'd1' : v > 0 ? 'd2' : 'd3';
    const P = b.parts;
    $('d-fus').setAttribute('class', cls(P.fus));
    $('d-wl').setAttribute('class', cls(P.wingL));
    $('d-wr').setAttribute('class', cls(P.wingR));
    $('d-tail').setAttribute('class', cls(P.tail));
    // engines #1..#4 left to right from the pilot's seat: idx 1,0,2,3
    [['d-e1', 1], ['d-e2', 0], ['d-e3', 2], ['d-e4', 3]].forEach(([id, i]) => {
      const e = fl.engines[i];
      $(id).setAttribute('class', e.fire ? 'fire' : (e.running && e.hp > 0 ? cls(e.hp) : 'd3'));
    });
    // bombsight
    $('sight').classList.toggle('hidden', !inSight);
    if (inSight) {
      const t = g.bombFall;
      $('sight-info').textContent = `Bomb bay ${b.doorOpen > 0.95 ? 'OPEN' : 'opening…'}  ·  time of fall ${t.toFixed(1)} s  ·  release: ${g.releaseMode}  ·  ${b.bombs} left`;
    }
    this.drawMap(g);
    if (g.statsOn) { $('stats').classList.remove('hidden'); $('stats').textContent = g.statsText(); } else $('stats').classList.add('hidden');
  }

  drawMap(g) {
    const c = this.mctx, W = this.map.width, R = W / 2;
    const fl = g.player.fl;
    const range = 7000, s = R / range;
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath(); c.arc(R, R, R - 1, 0, 7); c.clip();
    c.fillStyle = 'rgba(28,34,26,0.75)'; c.fillRect(0, 0, W, W);
    const X = (x) => R + (x - fl.pos.x) * s, Z = (z) => R + (z - fl.pos.z) * s;
    // river
    c.strokeStyle = 'rgba(90,120,140,0.9)'; c.lineWidth = 3; c.beginPath();
    for (let x = fl.pos.x - range; x <= fl.pos.x + range; x += 150) { const px = X(x), pz = Z(riverZ(x)); x === fl.pos.x - range ? c.moveTo(px, pz) : c.lineTo(px, pz); }
    c.stroke();
    // town
    c.fillStyle = 'rgba(170,150,120,0.35)'; c.beginPath(); c.arc(X(TOWN.x), Z(TOWN.z), TOWN.r * s, 0, 7); c.fill();
    // flak
    c.fillStyle = 'rgba(200,80,60,0.8)';
    for (const f of FLAK_SITES) { c.beginPath(); c.arc(X(f.x), Z(f.z), 2.5, 0, 7); c.fill(); }
    // targets
    for (const t of TARGETS) {
      const st = g.targetState[t.id];
      c.strokeStyle = st.done ? 'rgba(140,140,140,0.8)' : (t.primary ? '#e8c060' : '#e8e0c8');
      c.lineWidth = 2;
      const x = X(t.x), z = Z(t.z);
      c.strokeRect(x - 5, z - 5, 10, 10);
      if (st.done) { c.beginPath(); c.moveTo(x - 5, z - 5); c.lineTo(x + 5, z + 5); c.moveTo(x + 5, z - 5); c.lineTo(x - 5, z + 5); c.stroke(); }
    }
    // fighters
    c.fillStyle = '#ff6a4a';
    for (const f of g.fighters) if (f.alive && !f.dying) { c.beginPath(); c.arc(X(f.pos.x), Z(f.pos.z), 2.5, 0, 7); c.fill(); }
    // wingmen
    c.fillStyle = '#9fc4ff';
    for (const w of g.wingmen) if (w.alive) { c.beginPath(); c.arc(X(w.pos.x), Z(w.pos.z), 2.2, 0, 7); c.fill(); }
    // player arrow
    const f = fl.forward();
    const a = Math.atan2(f.x, -f.z);
    c.translate(R, R); c.rotate(a);
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath(); c.fill();
    c.restore();
    c.fillStyle = 'rgba(233,228,214,0.7)'; c.font = '11px sans-serif'; c.textAlign = 'center'; c.fillText('N', R, 12);
  }
}
