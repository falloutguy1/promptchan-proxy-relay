// Debug hooks used by tools/screenshots.mjs to capture views from the running game.
import * as THREE from 'three';

export const SHOTS = {
  hall_wide:     { pos: [0, 1.65, 24], look: [0, 1.8, 0] },
  hall_north:    { pos: [1.5, 1.65, -8], look: [-1, 1.4, -22] },
  platform_e:    { pos: [9.2, 1.65, 24], look: [7.5, 1.4, 5] },
  platform_w:    { pos: [-9.3, 1.65, -25], look: [-7.2, 1.2, -8] },
  track_e:       { pos: [12.1, 0.55, 20], look: [12.0, 0.2, -10] },
  tunnel_s:      { pos: [12.1, 0.55, 35], look: [12.1, 0.3, 50] },
  fire:          { pos: [2.2, 1.6, -1.8], look: [0.2, 0.7, 1.5] },
  farm:          { pos: [-8.6, 1.6, -15], look: [-6.4, 0.9, -20.5] },
  generator:     { pos: [9.0, 1.6, -17.5], look: [7.4, 0.5, -21] },
  shack_close:   { pos: [9.0, 1.6, -5.5], look: [8.4, 1.2, -9] },
  radio:         { pos: [-1.2, 1.55, -20.8], look: [-2.8, 0.9, -22.6] },
  pylon_close:   { pos: [2.6, 1.6, -6.5], look: [4.2, 1.6, -4.3] },
  rubble:        { pos: [0, 1.65, -18], look: [0, 1.6, -28] },
  overview_high: { pos: [0, 5.2, 26], look: [0, 0, -5] },
  cross_section: { pos: [-3.5, 1.65, 3.2], look: [8, 1.2, 3.2] },
  gun_test:      { pos: [0, 1.2, 0.8], look: [0, 1.1, 0], setup(game) {
    const g = game.weapon.gun.children[0].clone(); g.position.set(0, 1.1, 0); g.rotation.set(0, 0, 0); g.scale.setScalar(2);
    game.scene.add(g); const ax = new game.THREE.AxesHelper(0.5); ax.position.set(0, 1.1, 0); game.scene.add(ax); } },
  viewmodel:     { pos: [0, 1.65, 5], look: [0, 1.6, -5], gun: true },
  player:        { player: true },
  vm_arms:       { pos: [0.5, 1.65, 8], look: [0.2, 1.5, -4], gun: true, setup(g) { g.weapon.update(0.1, 1, { speed: 0, stride: 0 }); } },
  portrait:      { setup(g) { if (!g.dwellers.actors.size) { g.shelter.time = 240 * (22 / 24); window.__advance(45); } }, dyn(g, k = 0) {
    const a = [...g.dwellers.actors.values()][k]; a.g.updateMatrixWorld(true);
    const head = new THREE.Vector3(); a.root.getObjectByName('Head').getWorldPosition(head);
    const f = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    return { pos: head.clone().addScaledVector(f, 1.1).add(new THREE.Vector3(0.25, 0.05, 0)), look: head.clone().add(new THREE.Vector3(0, -0.15, 0)) };
  } },
  portrait2:     { setup(g) { SHOTS.portrait.setup(g); }, dyn(g) { return SHOTS.portrait.dyn(g, 3); } },
  fullbody:      { setup(g) { SHOTS.portrait.setup(g); }, dyn(g) {
    const a = [...g.dwellers.actors.values()][1];
    const f = new THREE.Vector3(Math.sin(a.yaw + 0.5), 0, Math.cos(a.yaw + 0.5));
    return { pos: a.g.position.clone().addScaledVector(f, 2.6).setY(1.3), look: a.g.position.clone().setY(0.95) };
  } },
  vm_side:       { pos: [1.1, 1.55, 7.5], look: [0, 1.5, 7.55], gun: true, setup(g) {
    const h = g.weapon.holder; g.camera.remove(h); g.scene.add(h); h.position.set(0, 1.65, 8); h.rotation.set(0, 0, 0);
    h.add(new g.THREE.AxesHelper(0.3)); g.weapon.update(0.1, 1, { speed: 0, stride: 0 });
    const eye = new g.THREE.Mesh(new g.THREE.SphereGeometry(0.02), new g.THREE.MeshBasicMaterial({ color: 0x00ff00 })); h.add(eye);
    g.weapon.arms.root.traverse((o) => { if (o.isMesh) o.visible = true; });
  } },
  dw_farm:       { pos: [-9.4, 1.6, -13.5], look: [-7.2, 0.9, -19.5], setup(g) { window.__advance(40); } },
  dw_gen:        { pos: [9.4, 1.55, -17.2], look: [7.4, 0.8, -21], setup(g) { window.__advance(2); } },
  dw_fire:       { pos: [2.6, 1.6, -1.6], look: [0.1, 0.8, 1.6], setup(g) { g.shelter.time = 240 * (22 / 24); window.__advance(45); } },
  dw_close:      { pos: [1.3, 1.5, -0.2], look: [0.2, 1.0, 1.4], setup(g) { window.__advance(2); } },
  dw_walk:       { pos: [0.5, 1.6, 12], look: [0, 1.0, 0], setup(g) { g.shelter.time = 240 * (5.8 / 24); window.__advance(8); } },
  rats_close:    { pos: [-8.2, 0.55, -18.6], look: [-7.2, 0.1, -20.4], setup(game) {
    game.rats.spawnWave(4, -1, -1);
    game.rats.list.slice(-4).forEach((r, i) => { r.o.position.set(-7.0 - i * 0.3, 0, -20.2 + i * 0.35); r.o.rotation.y = i * 1.3; r.wp = []; r.wait = 99; });
  } },
  tunnel_torch:  { pos: [12.1, 0.55, -30], look: [12.1, 0.3, -45], setup(game) { game.weapon.torch.intensity = 38; game.camera.updateMatrixWorld(); } },
};

export function installDebug(game) {
  if (!new URLSearchParams(location.search).get('debug')) return;
  const { camera, renderer } = game;
  window.__game = game;
  game.THREE = THREE;
  game.manualRender = true;   // screenshots drive rendering explicitly (software GL is slow)
  window.__play = () => { game.debugStart(); game.debugCamera = false; return true; };
  window.__walk = (keys, sec, yaw) => {
    const p = game.player;
    if (yaw !== undefined) p.yaw = yaw;
    p.keys = Object.fromEntries(keys.map((k) => [k, true]));
    window.__advance(sec);
    p.keys = {};
    window.__advance(0.3);
    return { x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) };
  };
  window.__teleport = (x, y, z, yaw = 0, pitch = 0) => { const p = game.player; p.pos.set(x, y, z); p.yaw = yaw; p.pitch = pitch; p.vy = 0; window.__advance(0.1); return true; };
  window.__state = () => { const s = game.shelter; return { res: s.res, inv: s.inv, day: s.day(), clock: s.clock(), rats: game.rats.list.length, ratsAlive: game.rats.list.filter((r) => !r.dead).length, eating: game.ratsEating, hp: game.player.hp, focus: document.getElementById('prompt').textContent, rooms: Object.fromEntries(Object.values(s.rooms).map((r) => [r.id, { p: +r.progress.toFixed(2), ready: r.ready }])) }; };
  window.__advance = (sec) => { for (let t = 0; t < sec; t += 0.05) { game.dt = 0.05; game.t += 0.05; game.onFrame?.(0.05); } };
  window.__shot = async (name) => {
    const s = SHOTS[name];
    if (!s) return { error: 'unknown shot' };
    game.weapon.holder.visible = !!s.gun || !!s.player;
    if (!s.player) {
      game.debugCamera = true;
      s.setup?.(game);
      const d = s.dyn ? s.dyn(game) : null;
      camera.position.copy(d ? d.pos : new THREE.Vector3(...s.pos));
      camera.lookAt(d ? d.look : new THREE.Vector3(...s.look));
    }
    // render a few frames so temporal effects settle
    const times = [];
    for (let i = 0; i < 4; i++) {
      const t0 = performance.now();
      game.frame();
      renderer.r.getContext().finish();
      times.push(performance.now() - t0);
    }
    const info = renderer.r.info;
    const img = renderer.r.domElement.toDataURL('image/png');
    return { ms: +(times.slice(1).reduce((a, b) => a + b, 0) / 3).toFixed(1), calls: info.render.calls, tris: info.render.triangles, img };
  };
  window.__perf = () => {
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      renderer.render(game.t);
      renderer.r.getContext().finish();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { medianMs: +times[10].toFixed(1), p90Ms: +times[18].toFixed(1), size: [renderer.r.domElement.width, renderer.r.domElement.height] };
  };
}
