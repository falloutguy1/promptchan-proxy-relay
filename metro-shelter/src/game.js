// Gameplay glue: player, shelter sim, rats, weapon, HUD, overview, pause/settings, perf overlay.
import * as THREE from 'three';
import { Player } from './player.js';
import { Shelter } from './shelter.js';
import { Rats } from './rats.js';
import { Weapon } from './weapon.js';
import { Audio } from './audio.js';
import { interactables, roomAnchors } from './props.js';
import { DwellerActors, makeViewArms } from './dwellers.js';
import { collision } from './collision.js';
import { settings, saveSettings } from './settings.js';
import { PRESETS } from './renderer.js';
import { configureShadows } from './lights.js';

const $ = (id) => document.getElementById(id);

export function startGame(game) {
  const { camera, scene, renderer } = game;
  const player = new Player(camera, renderer.r.domElement);
  const shelter = new Shelter();
  const rats = new Rats(scene, shelter);
  const weapon = new Weapon(camera, scene);
  weapon.setTorchShadow(renderer.preset.shadows);
  const audio = new Audio();
  const dwellers = new DwellerActors(scene, shelter);
  // seats around the fire barrel (stools placed in props.js), facing the fire
  const fire = new THREE.Vector3(0.2, 0, 1.5);
  const seats = [[-1.1, 1.0], [1.3, 0.6], [0.7, 2.8], [-0.7, 2.4]].map(([x, z]) => ({ pos: new THREE.Vector3(x, 0, z), face: Math.atan2(fire.x - x, fire.z - z) }));
  dwellers.init(roomAnchors, seats);
  if (game.hasDwellers) weapon.setArms(makeViewArms());
  Object.assign(game, { player, shelter, rats, weapon, audio, dwellers });
  const worldMeshes = [];
  scene.getObjectByName('station').traverse((o) => { if (o.isMesh) worldMeshes.push(o); });

  // ---------- HUD helpers ----------
  const toast = (msg, bad = false) => {
    const d = document.createElement('div'); d.textContent = msg; if (bad) d.className = 'bad';
    $('toast').appendChild(d); setTimeout(() => d.remove(), 5000);
    while ($('toast').children.length > 4) $('toast').firstChild.remove();
  };
  game.toast = toast;
  let hurtT = 0;
  const hurt = (n) => {
    player.hp -= n; hurtT = 0.6; audio.hurt();
    if (player.hp <= 0) end({ win: false, why: 'The Overseer was overrun by rats. Without you, Zarya falls silent.' });
  };

  shelter.onReady = (r) => { if (r.id === 'generator' || shelter.res[r.res] < 30) toast(`${r.name}: batch ready to collect`); };
  shelter.onDeath = (d) => toast(`${d.name} has died.`, true);
  rats.onWave = (n, side, zs) => toast(`Scratching in the ${zs > 0 ? 'south' : 'north'}-${side > 0 ? 'east' : 'west'} tunnel… rats (${n})`, true);
  rats.onBite = (n) => hurt(n);
  rats.onKill = () => {};

  player.onStep = (s, v) => audio.step(s, v);
  player.onLand = (v) => { audio.step('stone', v); if (v > 5.5) hurt((v - 5.5) * 8); };

  // ---------- flow: start / pause / overview ----------
  let paused = true, overview = false, over = false;
  const resume = () => { $('pause').classList.add('hidden'); player.lock(); };
  $('btn-start').onclick = () => {
    $('start').classList.add('hidden'); $('hud').classList.remove('hidden');
    audio.start(settings.volume);
    player.lock();
    paused = false;
    toast('Day 1. Keep the lights on, the water clean and the mushrooms growing.');
  };
  $('btn-resume').onclick = resume;
  // Test hook: start without pointer lock (headless browsers cannot lock the pointer).
  game.debugStart = () => {
    $('start').classList.add('hidden'); $('hud').classList.remove('hidden');
    paused = false; player.locked = true;
  };
  game.debugInteract = () => interact();
  game.debugFire = () => { const r = weapon.fire(rats, worldMeshes); if (r && r.rat) rats.damage(r.rat, 2); return r && r !== 'empty' ? { rat: !!r.rat } : r; };
  player.onLockChange = (locked) => {
    if (over) return;
    if (locked) { paused = false; $('pause').classList.add('hidden'); }
    else if (!overview && !$('start').offsetParent) { paused = true; openPause(); }
  };
  const openPause = () => {
    $('pause').classList.remove('hidden');
    $('s-quality').value = settings.quality;
    $('s-scale').value = renderer.scale; $('s-scale-v').textContent = `${Math.round(renderer.scale * 100)}%`;
    $('s-fov').value = settings.fov; $('s-fov-v').textContent = `${settings.fov}°`;
    $('s-sens').value = settings.sens; $('s-sens-v').textContent = settings.sens.toFixed(2);
    $('s-vol').value = settings.volume; $('s-vol-v').textContent = `${Math.round(settings.volume * 100)}%`;
    $('s-perf').checked = settings.perf;
    $('s-paint').checked = settings.painterly;
  };
  $('s-paint').onchange = (e) => { settings.painterly = e.target.checked; renderer.setPainterly(settings.painterly); saveSettings(); };
  $('s-quality').onchange = (e) => {
    settings.quality = e.target.value;
    const p = PRESETS[settings.quality];
    renderer.scale = p.scale;
    renderer.setup(scene, camera, settings.quality);
    configureShadows(renderer.preset);
    weapon.setTorchShadow(renderer.preset.shadows);
    saveSettings(); openPause();
    if ((p.textures === '1k') !== (game.textureRes === '1k')) toast('Texture resolution changes apply after reloading the page.');
  };
  $('s-scale').oninput = (e) => { settings.scale = +e.target.value; renderer.setScale(settings.scale); $('s-scale-v').textContent = `${Math.round(settings.scale * 100)}%`; saveSettings(); };
  $('s-fov').oninput = (e) => { settings.fov = +e.target.value; camera.fov = settings.fov; camera.updateProjectionMatrix(); $('s-fov-v').textContent = `${settings.fov}°`; saveSettings(); };
  $('s-sens').oninput = (e) => { settings.sens = +e.target.value; $('s-sens-v').textContent = settings.sens.toFixed(2); saveSettings(); };
  $('s-vol').oninput = (e) => { settings.volume = +e.target.value; audio.setVolume(settings.volume); $('s-vol-v').textContent = `${Math.round(settings.volume * 100)}%`; saveSettings(); };
  $('s-perf').onchange = (e) => { settings.perf = e.target.checked; $('perf').classList.toggle('hidden', !settings.perf); saveSettings(); };
  $('perf').classList.toggle('hidden', !settings.perf);

  let selDweller = null;
  const toggleOverview = () => {
    if (paused && !overview) return;
    overview = !overview;
    $('overview').classList.toggle('hidden', !overview);
    if (overview) { selDweller = null; renderOverview(); document.exitPointerLock?.(); paused = true; }
    else { player.lock(); }
  };
  const renderOverview = () => {
    const grid = $('ov-grid'); grid.innerHTML = '';
    for (const r of Object.values(shelter.rooms)) {
      const el = document.createElement('div'); el.className = 'room';
      const cost = shelter.upgradeCost(r);
      const rate = shelter.roomRate(r);
      el.innerHTML = `<h3>${r.name} · L${r.level}</h3>
        <div class="small">${r.icon} · uses ${r.stat} · ${rate ? `${Math.round(1 / rate)} s per batch` : 'idle — assign dwellers'}${r.cost ? ` · costs ${Object.entries(r.cost).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}</div>
        <div class="prog"><i style="width:${r.ready ? 100 : Math.round(r.progress * 100)}%"></i></div>
        <div class="small">${r.ready ? `<b style="color:var(--amber)">READY: ${r.ready} — collect it in person</b>` : ''}</div>
        <div class="slots"></div>`;
      const slots = el.querySelector('.slots');
      for (const d of r.assigned) {
        const c = document.createElement('span'); c.className = 'chip' + (d.hp < 50 ? ' hurt' : '');
        c.textContent = `${d.name} ${d[r.stat]}`; c.title = 'Click to unassign';
        c.onclick = (e) => { e.stopPropagation(); shelter.assign(d, null); renderOverview(); };
        slots.appendChild(c);
      }
      for (let i = r.assigned.length; i < r.slots; i++) { const c = document.createElement('span'); c.className = 'chip'; c.style.opacity = 0.35; c.textContent = 'empty'; slots.appendChild(c); }
      if (cost) {
        const b = document.createElement('button');
        b.textContent = `Upgrade (${cost.mgr} rounds, ${cost.scrap} scrap)`;
        b.disabled = !shelter.canUpgrade(r);
        b.onclick = (e) => { e.stopPropagation(); if (shelter.upgrade(r)) toast(`${r.name} upgraded to level ${r.level}`); renderOverview(); };
        el.appendChild(b);
      }
      el.onclick = () => {
        if (!selDweller) return;
        if (!shelter.assign(selDweller, r.id)) toast(`${r.name} is full`, true);
        selDweller = null; renderOverview();
      };
      grid.appendChild(el);
    }
    const list = $('ov-dwellers'); list.innerHTML = '<span class="lab" style="align-self:center">DWELLERS (S P E C I A L) — </span>';
    for (const d of shelter.dwellers.filter((x) => x.hp > 0)) {
      const c = document.createElement('span');
      c.className = 'chip' + (d === selDweller ? ' sel' : '') + (d.hp < 50 ? ' hurt' : '');
      c.textContent = `${d.name} · ${['S', 'P', 'E', 'C', 'I', 'A', 'L'].map((k) => d[k]).join(' ')} · ${Math.round(d.hp)}hp${d.room ? ` · ${shelter.rooms[d.room].name}` : ' · idle'}`;
      c.onclick = () => { selDweller = d === selDweller ? null : d; renderOverview(); };
      list.appendChild(c);
    }
  };

  const end = (res) => {
    if (over) return;
    over = true; paused = true;
    document.exitPointerLock?.();
    $('end-title').textContent = res.win ? 'ZARYA ENDURES' : 'THE STATION IS LOST';
    $('end-text').textContent = res.why;
    $('end').classList.remove('hidden');
  };

  // ---------- input ----------
  addEventListener('keydown', (e) => {
    if (e.code === 'Tab') { e.preventDefault(); if (!over) toggleOverview(); return; }
    if (paused) return;
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyR') { const n = weapon.reload(shelter.inv.rounds); if (n) { shelter.inv.rounds -= n; audio.reload(); } }
    if (e.code === 'KeyF') weapon.toggleTorch();
    if (e.code === 'KeyH') {
      if (shelter.inv.medkits > 0 && player.hp < 100) { shelter.inv.medkits--; player.hp = Math.min(100, player.hp + 45); toast('Medkit used'); }
    }
    if (e.code === 'F3') { settings.perf = !settings.perf; $('perf').classList.toggle('hidden', !settings.perf); }
  });
  addEventListener('mousedown', (e) => {
    if (paused || e.button !== 0) return;
    const r = weapon.fire(rats, worldMeshes);
    if (r === 'empty') { audio.dry(); if (shelter.inv.rounds > 0) toast('Empty — press R to reload'); }
    else if (r) { audio.shot(); player.kick += 0.018; if (r.rat) rats.damage(r.rat, 1 + (Math.random() < 0.5 ? 1 : 0)); }
  });

  let focus = null;
  const interact = () => {
    if (!focus) return;
    audio.pickup();
    if (focus.kind === 'room') {
      const msg = shelter.collect(focus.room);
      if (msg) toast(`${focus.room.name}: ${msg}`);
    } else if (focus.kind === 'loot') {
      focus.searched = true;
      const got = [];
      for (const [k, v] of Object.entries(focus.contents)) {
        if (!v) continue;
        shelter.inv[k] += v;
        got.push(`${v} ${k === 'mgr' ? 'military-grade rounds' : k === 'rounds' ? '9×18 rounds' : k}`);
      }
      toast(got.length ? `Found ${got.join(', ')}` : 'Nothing useful.');
    }
  };

  // Room interactables (collect batches in person).
  const roomItems = Object.values(shelter.rooms).filter((r) => r.anchor).map((r) => ({
    pos: r.anchor.pos, r: 2.4, kind: 'room', room: r,
    label() { return r.ready ? `<b>[E]</b> Collect ${r.ready} ${r.icon.toLowerCase()} — ${r.name}` : null; },
  }));
  const allItems = [...roomItems, ...interactables];

  // markers over rooms with ready batches
  const markers = new Map();
  const v = new THREE.Vector3();
  const updateMarkers = () => {
    for (const r of Object.values(shelter.rooms)) {
      let el = markers.get(r.id);
      const show = r.anchor && (r.ready > 0 || (r.id === 'farm' && game.ratsEating));
      if (!show) { if (el) el.style.display = 'none'; continue; }
      if (!el) { el = document.createElement('div'); el.className = 'mk'; $('markers').appendChild(el); markers.set(r.id, el); }
      v.copy(r.anchor.pos).setY(2.4).project(camera);
      if (v.z > 1 || v.z < -1) { el.style.display = 'none'; continue; }
      const dist = camera.position.distanceTo(r.anchor.pos);
      el.style.display = 'block';
      el.className = 'mk' + (r.id === 'farm' && game.ratsEating ? ' bad' : '');
      el.textContent = r.id === 'farm' && game.ratsEating ? `RATS IN THE FARM · ${Math.round(dist)} m` : `${r.icon} +${r.ready} · ${Math.round(dist)} m`;
      el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    }
  };

  const bar = (id, val, cap) => {
    const el = $(id);
    el.querySelector('i').style.width = `${Math.max(0, Math.min(100, (val / cap) * 100))}%`;
    el.querySelector('.val').textContent = `${Math.round(val)}/${cap}`;
    el.classList.toggle('low', val < cap * 0.2);
  };

  // perf sampling
  let frames = 0, acc = 0, fps = 0, worst = 0;
  const perfHud = (dt) => {
    frames++; acc += dt; worst = Math.max(worst, dt);
    if (acc >= 0.5) {
      fps = frames / acc;
      if (settings.perf) {
        const i = renderer.r.info;
        $('perf').textContent = `${fps.toFixed(0)} fps  (worst ${(worst * 1000).toFixed(0)} ms)\n${i.render.calls} draws  ${(i.render.triangles / 1000).toFixed(0)}k tris\n${renderer.r.domElement.width}×${renderer.r.domElement.height} @ ${Math.round(renderer.scale * 100)}%  ${settings.quality}`;
      }
      frames = 0; acc = 0; worst = 0;
    }
  };
  game.fps = () => fps;

  let hudT = 0;
  game.onFrame = (dt) => {
    perfHud(dt);
    if (game.hasDwellers) {
      dwellers.update(dt, game.t, rats.list.some((r) => !r.dead && r.o.position.y > -0.5), player.pos);
      collision.dynamic = dwellers.blockers();
    }
    if (game.debugCamera) return;
    if (!paused) {
      player.update(dt);
      game.ratsEating = rats.update(dt, game.t, player, audio);
      shelter.update(dt, game.ratsEating);
      if (shelter.over) end(shelter.over);
    } else if (overview) {
      shelter.update(dt, game.ratsEating || 0);
      hudT += dt; if (hudT > 0.5) { hudT = 0; renderOverview(); }
    }
    weapon.update(dt, game.t, player);
    game.power01 = Math.min(1, shelter.res.power / 20);
    audio.update(dt, camera, game.power01);
    // interaction focus: nearest usable thing in front of the camera
    focus = null;
    let best = 1e9;
    const fw = new THREE.Vector3(); camera.getWorldDirection(fw);
    for (const it of allItems) {
      const lab = it.label(); if (!lab) continue;
      const d = it.pos.distanceTo(camera.position);
      if (d > it.r + 0.6) continue;
      const to = it.pos.clone().sub(camera.position).normalize();
      const facing = to.dot(fw);
      if (facing < 0.55) continue;
      const score = d * (2 - facing);
      if (score < best) { best = score; focus = it; }
    }
    $('prompt').classList.toggle('hidden', !focus || paused);
    if (focus) $('prompt').innerHTML = focus.label();
    // HUD
    bar('r-power', shelter.res.power, shelter.cap.power);
    bar('r-water', shelter.res.water, shelter.cap.water);
    bar('r-food', shelter.res.food, shelter.cap.food);
    $('m-day').textContent = shelter.day(); $('m-clock').textContent = shelter.clock();
    $('m-dwellers').textContent = shelter.dwellers.filter((d) => d.hp > 0).length;
    $('m-mgr').textContent = shelter.inv.mgr; $('m-scrap').textContent = shelter.inv.scrap;
    $('a-mag').textContent = weapon.mag; $('a-res').textContent = shelter.inv.rounds; $('a-med').textContent = shelter.inv.medkits;
    $('hp-fill').style.width = `${Math.max(0, player.hp)}%`;
    hurtT = Math.max(0, hurtT - dt);
    $('hurt').style.boxShadow = `inset 0 0 160px rgba(160,20,10,${(hurtT * 0.9 + (player.hp < 30 ? 0.25 : 0)).toFixed(2)})`;
    updateMarkers();
  };
  return game;
}
