// Automation hooks used by tools/shots.mjs and tools/bench.mjs (and handy in the
// console): deterministic stepping, camera placement, time/weather control and
// renderer statistics. Always installed; harmless in normal play.
import * as THREE from 'three';

export function installReviewApi(game) {
  const api = {
    get ready() { return !!game.ready; },
    info() {
      const gl = game.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        preset: game.settings.preset, tier: game.assets.tier,
        failures: game.assets.failures,
        memory: { ...game.renderer.info.memory },
      };
    },
    /** Place the camera: pos [x,y,z] (y relative to ground if rel), look target [x,y,z]. */
    view({ pos, target, fov = 40, rel = true }) {
      const t = game.world.terrain;
      game.rig.mode = 'free';
      const p = new THREE.Vector3(...pos);
      if (rel) p.y += t.height(p.x, p.z);
      const q = new THREE.Vector3(...target);
      if (rel) q.y += t.height(q.x, q.z);
      game.camera.position.copy(p);
      game.camera.fov = fov;
      game.camera.updateProjectionMatrix();
      game.camera.lookAt(q);
      game.reviewFocus = q;
    },
    rts(x, z, dist, yaw = 0.6, tilt = 0) {
      game.rig.mode = 'rts';
      game.rig.focusOn(x, z, dist);
      game.rig.goal.yaw = yaw;
      game.rig.pitchOffset = tilt;
      game.rig.snap();
      game.rig.cur.pitch = 0;
    },
    time(h) { game.world.sky.setTime(h); },
    nearestTree(kind, x, z) {
      const it = game.world.trees.nearest(x, z, (t) => !kind || t.kind === kind);
      return it ? { x: it.x, y: it.y, z: it.z, h: it.h, kind: it.kind, s: it.s } : null;
    },
    /** Frame the nearest tree of a kind from the side at eye level. */
    lookAtTree(kind, x, z, dist = 14) {
      const it = game.world.trees.nearest(x, z, (t) => !kind || t.kind === kind);
      if (!it) return null;
      const t = game.world.terrain;
      const cx = it.x + dist, cz = it.z + dist * 0.35;
      this.view({ pos: [cx, 1.7, cz], target: [it.x, it.h * 0.45, it.z], fov: 50 });
      return it;
    },
    weather(w) { game.world.sky.setWeather(w, true); },
    /** Line up characters in every animation state for a visual check. */
    spawnTest(x = 20, z = -60) {
      const C = game.world.characters;
      const states = [['survivor', 'idle'], ['survivor', 'walk'], ['survivor', 'run'], ['survivor', 'work:chop'], ['survivor', 'work:dig'], ['survivor', 'aim'], ['infected', 'walk'], ['infected', 'attack'], ['infected', 'idle'], ['survivor', 'work:carry'], ['survivor', 'dead']];
      states.forEach(([kind, st], i) => {
        const c = C.spawn(kind, 31 + i * 7, x + (i - 5) * 1.6, z);
        const [s, w] = st.split(':');
        c.anim.set(s); if (w) c.anim.work = w;
        c.anim.weights = { [s]: 1 };
        c.speed = s === 'walk' ? (kind === 'infected' ? 0.7 : 1.4) : s === 'run' ? 3.6 : 0;
        c.targetYaw = c.yaw = 0;
      });
      return states.length;
    },
    wet(v) { game.world.sky.rain = v; },
    /** Start a colony without the menu. */
    newGame(mode = 'human', difficulty = 'normal') { game.newGame({ mode, difficulty }); return this.state(); },
    /** Advance the simulation by h game hours without rendering (fixed steps). */
    simulate(h = 1, dt = 0.25) {
      const sim = game.sim, n = Math.ceil((h * 30) / dt), t0 = performance.now();
      for (let i = 0; i < n && !sim.ended; i++) sim.step(dt);
      sim.structures.flush();
      return { ms: Math.round(performance.now() - t0), ...this.state() };
    },
    state() {
      const s = game.sim;
      if (!s.started && !s.ended) return { started: false };
      return {
        day: s.day, hour: +s.hour.toFixed(2), speed: s.speed, ai: s.ai.enabled,
        res: Object.fromEntries(Object.entries(s.res).map(([k, v]) => [k, Math.round(v)])),
        pop: s.alive().length, beds: s.housing, morale: Math.round(s.morale), infected: s.infected.filter((z) => z.alive).length,
        structures: s.structures.list.map((q) => `${q.type}${q.built ? '' : ':' + Math.round(q.progress * 100) + '%'}`),
        jobs: s.alive().map((q) => `${q.first}:${q.job}:${q.activity}:hp${Math.round(q.hp)}`),
        log: s.logList.slice(-10).map((e) => `D${e.day} ${e.hour.toFixed(1)} ${e.text}`), ended: s.ended, stats: { ...s.stats }, paths: { ...s.nav.stats },
        objective: s.objectiveProgress()?.title,
      };
    },
    ai(on = true) { game.hud.toggleAI(on); },
    /** Render n frames with a fixed timestep (review mode has no rAF loop). */
    async frames(n = 3, dt = 1 / 30) {
      for (let i = 0; i < n; i++) {
        game.step(dt);
        await new Promise((r) => setTimeout(r, 0));
      }
      return game.perf;
    },
    /** Approximate draw-call and triangle budget per top-level group (colour + shadow pass). */
    drawStats() {
      const cam = game.camera, fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const out = {};
      const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
      const walk = (o, group, vis) => {
        if (!o.visible) return;
        if (o.isMesh || o.isLine || o.isPoints) {
          const inst = o.isInstancedMesh ? o.count : o.geometry.isInstancedBufferGeometry ? o.geometry.instanceCount : 1;
          if (!inst) return;
          if (o.frustumCulled && !o.isInstancedMesh) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); const sph = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld); if (!fr.intersectsSphere(sph)) return; }
          const e = (out[group] ||= { calls: 0, shadowCalls: 0, tris: 0 });
          e.calls++; e.tris += tri(o.geometry) * inst;
          if (o.castShadow) e.shadowCalls++;
        }
        for (const c of o.children) walk(c, group, vis);
      };
      for (const c of game.scene.children) walk(c, c.name || c.type, true);
      return out;
    },
    /** Timed frames: CPU time of step() and wall time including a GPU sync (readPixels). */
    async timedFrames(n = 10, dt = 1 / 60) {
      const gl = game.renderer.getContext(), px = new Uint8Array(4), cpu = [], wall = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        game.step(dt);
        const t1 = performance.now();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t2 = performance.now();
        cpu.push(t1 - t0); wall.push(t2 - t0);
        await new Promise((r) => setTimeout(r, 0));
      }
      const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const info = game.renderer.info;
      return { cpu: +avg(cpu).toFixed(2), wall: +avg(wall).toFixed(1), wallMax: +Math.max(...wall).toFixed(1), calls: info.render.calls, tris: info.render.triangles,
        geometries: info.memory.geometries, textures: info.memory.textures, px: [game.renderer.domElement.width, game.renderer.domElement.height] };
    },
    stats() {
      const i = game.renderer.info;
      return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length, perf: { ...game.perf } };
    },
    game,
  };
  window.__wl = api;
  return api;
}
