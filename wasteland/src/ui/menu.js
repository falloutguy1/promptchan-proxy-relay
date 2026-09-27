// Main menu (new colony: mode + difficulty, continue), settings, credits and
// licences (generated from the asset manifests), the pause menu and the
// end-of-game screen.
import { PRESETS } from '../core/settings.js';
import { Colony } from '../sim/sim.js';
import { DIFFICULTY } from '../sim/defs.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Menu {
  constructor(game) {
    this.game = game;
    this.el = $('menu');
    this.mode = null;
    this.difficulty = 'normal';
    this.back = 'main';
    this.el.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) this.page(go.dataset.go === 'continue' ? this.#continue() : go.dataset.go);
    });
    for (const c of document.querySelectorAll('.mode-card')) c.addEventListener('click', () => {
      this.mode = c.dataset.mode;
      for (const x of document.querySelectorAll('.mode-card')) x.classList.toggle('on', x === c);
      $('btn-start').disabled = false;
    });
    $('difficulty').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.difficulty = b.dataset.v;
      for (const x of $('difficulty').children) x.classList.toggle('on', x === b);
    });
    $('btn-start').addEventListener('click', () => { if (this.mode) this.game.newGame({ mode: this.mode, difficulty: this.difficulty }); });
  }

  show(page = 'main') {
    this.el.classList.remove('hidden');
    const info = Colony.saveInfo();
    const cont = $('btn-continue');
    cont.disabled = !info;
    cont.textContent = info ? `Continue — day ${info.day}, ${info.pop} survivors (${info.mode === 'ai' ? 'AI Overseer' : 'you command'})` : 'Continue';
    this.page(page);
  }
  hide() { this.el.classList.add('hidden'); }

  page(name) {
    if (!name) return;
    for (const p of this.el.querySelectorAll('.menu-page')) p.classList.toggle('hidden', p.id !== `menu-${name}`);
    this.el.classList.toggle('in-game', this.game.sim.started && !this.game.sim.ended);
    if (name === 'settings') this.#settings();
    if (name === 'credits') this.#credits();
    if (name === 'main') this.back = 'main';
    if (name === 'pause') this.back = 'pause';
  }

  #continue() {
    if (!Colony.hasSave()) return null;
    this.game.loadGame();
    return null;
  }

  // ------------------------------------------------------------ pause
  pause() {
    const g = this.game;
    if (!g.sim.started || g.sim.ended) return;
    if (g.rig.mode === 'walk') g.exitWalk();
    this.resumeSpeed = g.sim.speed || this.resumeSpeed || 1;
    g.hud.setSpeed(0);
    this.el.classList.remove('hidden');
    const p = $('menu-pause');
    p.innerHTML = `<h2>Paused — day ${g.sim.day}, ${g.sim.timeString}</h2>
      <button class="menu-btn primary" data-p="resume">Resume</button>
      <button class="menu-btn" data-p="save">Save colony</button>
      <button class="menu-btn" data-go="settings">Settings</button>
      <button class="menu-btn" data-go="help">How to play</button>
      <button class="menu-btn" data-p="quit">Quit to main menu</button>`;
    p.onclick = (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      if (b.dataset.p === 'resume') this.resume();
      if (b.dataset.p === 'save') { const ok = g.sim.save(); b.textContent = ok ? 'Saved ✓' : 'Could not save (storage blocked)'; }
      if (b.dataset.p === 'quit') {
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Quit? Unsaved progress since dawn is lost'; return; }
        g.toMenu();
      }
    };
    this.page('pause');
  }
  resume() {
    this.hide();
    this.game.hud.setSpeed(this.resumeSpeed || 1);
  }
  get open() { return !this.el.classList.contains('hidden'); }

  // ------------------------------------------------------------ settings
  #settings() {
    const s = this.game.settings, v = s.values;
    const p = $('menu-settings');
    const sel = (key, opts, cur) => `<select data-k="${key}">${opts.map(([val, lab]) => `<option value="${val}" ${String(val) === String(cur) ? 'selected' : ''}>${lab}</option>`).join('')}</select>`;
    p.innerHTML = `<h2>Settings</h2>
      <div class="settings-grid">
        <label>Quality preset</label>${sel('preset', Object.keys(PRESETS).map((k) => [k, k[0].toUpperCase() + k.slice(1)]), s.preset)}
        <div class="hint">Detected: ${s.device.mobile ? 'mobile' : 'desktop'} device, ${s.device.mem} GB, ${s.device.cores} cores. Changing the preset reloads the game.</div>
        <label>Render resolution</label><span><input type="range" min="40" max="100" step="5" value="${Math.round(v.renderScale * 100)}" data-k="renderScale"> <b data-o="renderScale">${Math.round(v.renderScale * 100)}%</b></span>
        <label>Dynamic resolution</label><input type="checkbox" data-k="dynamicRes" ${s.dynamicRes ? 'checked' : ''}>
        <div class="hint">Lowers resolution automatically when the frame rate drops below ~45 fps.</div>
        <label>Shadow map</label>${sel('shadowSize', [[1024, 'Low (1024)'], [2048, 'Medium (2048)'], [4096, 'High (4096)']], v.shadowSize)}
        <label>Ambient occlusion</label>${sel('ao', [['off', 'Off'], ['half', 'Half resolution'], ['full', 'Full resolution']], v.ao)}
        <label>Bloom</label><input type="checkbox" data-k="bloom" ${v.bloom ? 'checked' : ''}>
        <label>Anti-aliasing</label>${sel('aa', [['fxaa', 'FXAA'], ['smaa', 'SMAA'], ['msaa', 'MSAA 4×']], v.aa)}
        <label>Grass density</label><span><input type="range" min="0.2" max="1.4" step="0.1" value="${v.grassDensity}" data-k="grassDensity"> <b data-o="grassDensity">${v.grassDensity}</b></span>
        <label>Draw distance</label><span><input type="range" min="400" max="1400" step="50" value="${v.drawDistance}" data-k="drawDistance"> <b data-o="drawDistance">${v.drawDistance} m</b></span>
        <label>Texture detail</label>${sel('texTier', [['lo', 'Standard (1K)'], ['hi', 'High (2K)']], v.texTier)}
        <label>Frame rate / stats</label><input type="checkbox" data-k="showFps" ${s.showFps ? 'checked' : ''}>
        <label>Interface</label>${sel('ui', [['auto', 'Automatic'], ['desktop', 'Desktop'], ['mobile', 'Touch']], s.ui)}
        <label>Volume</label><span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="volume"> <b data-o="volume">${Math.round(s.volume * 100)}%</b></span>
      </div>
      <div class="row"><button class="menu-btn" data-go="${this.back}">Back</button><button class="menu-btn primary hidden" id="btn-apply">Apply &amp; reload</button></div>`;
    const live = new Set(['renderScale', 'dynamicRes', 'showFps', 'volume']);
    p.oninput = (e) => {
      const k = e.target.dataset.k; if (!k) return;
      let val = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? parseFloat(e.target.value) : e.target.value;
      if (k === 'renderScale') val /= 100;
      const out = p.querySelector(`[data-o="${k}"]`);
      if (out) out.textContent = k === 'renderScale' ? `${Math.round(val * 100)}%` : k === 'volume' ? `${Math.round(val * 100)}%` : k === 'drawDistance' ? `${val} m` : val;
      if (k === 'preset') s.setPreset(val);
      else if (k === 'dynamicRes' || k === 'showFps' || k === 'volume' || k === 'ui') { s[k] = val; s.save(); }
      else if (k === 'shadowSize' || k === 'drawDistance') s.set(k, +val);
      else s.set(k, val);
      if (k === 'renderScale') this.game.resize();
      if (k === 'showFps') $('perf').classList.toggle('hidden', !val);
      if (k === 'volume') this.game.audio?.setVolume(val);
      if (!live.has(k)) p.querySelector('#btn-apply').classList.remove('hidden');
    };
    p.querySelector('#btn-apply').onclick = () => { if (this.game.sim.started) this.game.sim.save(); location.reload(); };
  }

  // ------------------------------------------------------------ credits
  async #credits() {
    const p = $('menu-credits');
    p.innerHTML = `<h2>Credits &amp; licences</h2><div class="credits">Loading…</div><div class="row"><button class="menu-btn" data-go="${this.back}">Back</button></div>`;
    const a = this.game.assets;
    try {
      const [mm, tm, sky] = await Promise.all([a.json('manifest-models.json'), a.json('manifest-textures.json'), a.json('sky/skies.json')]);
      const rows = [];
      const add = (src, what) => { if (src) rows.push({ ...src, what }); };
      for (const [k, m] of Object.entries(mm.models || mm)) add(m.source, 'model');
      for (const sec of ['textures', 'atlases', 'decals']) for (const [k, t] of Object.entries(tm[sec] || {})) add(t.source, sec === 'textures' ? 'material' : sec === 'atlases' ? 'foliage' : 'decal');
      for (const [k, s] of Object.entries(sky)) add(s.source, 'sky (HDRI)');
      const seen = new Set();
      const list = rows.filter((r) => { const key = r.url; if (seen.has(key)) return false; seen.add(key); return true; }).sort((x, y) => (x.source + x.name).localeCompare(y.source + y.name));
      const by = (src) => list.filter((r) => r.source === src).map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a> — ${esc((r.authors || []).join(', ') || 'unknown')} · ${esc(r.what)} · ${esc(r.license)}</li>`).join('');
      p.querySelector('.credits').innerHTML = `
        <p>Rustwater is built with Three.js on WebGL2. Every scanned model, material, foliage atlas and sky photograph is CC0 (public domain) and was converted to KTX2 / meshopt glTF by the project's asset pipeline. Buildings, colony structures, trees, grass placement, characters and animation are procedural.</p>
        <h3>Poly Haven</h3><ul>${by('Poly Haven')}</ul>
        <h3>ambientCG</h3><ul>${by('ambientCG')}</ul>
        <h3>Libraries</h3><ul>
          <li><a href="https://threejs.org" target="_blank" rel="noopener">three.js</a> r186 — MIT</li>
          <li><a href="https://github.com/pmndrs/postprocessing" target="_blank" rel="noopener">postprocessing</a> 6.39 — zlib</li>
          <li><a href="https://github.com/N8python/n8ao" target="_blank" rel="noopener">N8AO</a> 2.0 — CC0</li>
          <li><a href="https://github.com/BinomialLLC/basis_universal" target="_blank" rel="noopener">Basis Universal</a> transcoder — Apache 2.0</li>
          <li><a href="https://github.com/zeux/meshoptimizer" target="_blank" rel="noopener">meshoptimizer</a> decoder — MIT</li>
          <li>Fonts: Barlow / Barlow Condensed (Google Fonts) — SIL OFL 1.1</li>
        </ul>`;
    } catch (e) {
      p.querySelector('.credits').textContent = `Could not load the asset manifests: ${e.message}`;
    }
  }

  // ------------------------------------------------------------ end of game
  showEnd(result) {
    const g = this.game, sim = g.sim, st = sim.stats;
    this.el.classList.remove('hidden');
    const p = $('menu-end');
    const win = result === 'victory';
    p.innerHTML = `<h2>${win ? 'Evacuated' : 'The colony has fallen'}</h2>
      <p class="end-text">${win ? `The convoy reached the crossroads on day ${sim.day}. ${sim.alive().length} survivors climbed onto the trucks.` : `Day ${sim.day}. Nobody is left to keep the fire going.`}</p>
      <div class="kvs">
        <div class="kv"><span>Days survived</span><span>${sim.day}</span></div>
        <div class="kv"><span>Survivors alive / most at once</span><span>${sim.alive().length} / ${st.peak}</span></div>
        <div class="kv"><span>Joined along the way</span><span>${st.arrived}</span></div>
        <div class="kv"><span>Lost</span><span>${st.died}</span></div>
        <div class="kv"><span>Infected killed</span><span>${st.killed}</span></div>
        <div class="kv"><span>Structures built</span><span>${st.built}</span></div>
        <div class="kv"><span>Hordes faced</span><span>${st.hordes}</span></div>
        <div class="kv"><span>Difficulty · mode</span><span>${DIFFICULTY[sim.difficulty].name} · ${sim.mode === 'ai' ? 'AI Overseer' : 'you commanded'}</span></div>
      </div>
      <div class="row">
        ${win ? '<button class="menu-btn primary" data-e="keep">Keep playing</button>' : ''}
        <button class="menu-btn ${win ? '' : 'primary'}" data-go="new">New colony</button>
        <button class="menu-btn" data-e="menu">Main menu</button>
      </div>`;
    p.onclick = (e) => {
      const b = e.target.closest('[data-e]'); if (!b) return;
      if (b.dataset.e === 'keep') { sim.continueAfterVictory(); this.hide(); g.hud.setSpeed(1); }
      if (b.dataset.e === 'menu') g.toMenu();
    };
    this.page('end');
  }
}
