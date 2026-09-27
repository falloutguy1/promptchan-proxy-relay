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
    /** Render n frames with a fixed timestep (review mode has no rAF loop). */
    async frames(n = 3, dt = 1 / 30) {
      for (let i = 0; i < n; i++) {
        game.step(dt);
        await new Promise((r) => setTimeout(r, 0));
      }
      return game.perf;
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
