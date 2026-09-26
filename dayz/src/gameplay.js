import * as THREE from 'three';
import { FLOOR_Y, WORLD } from './layout.js';
import { spawnModel } from './spawn.js';

// Survival loop for the location: scavenge loot, open doors, keep food and
// water up. Interaction uses a centre-screen ray against loot and door meshes.

const LOOT = [
  // [model, name, effect, position (house-local for indoor), rotation, extra]
  ['russian_food_cans_01', 'Canned meat (tushonka)', { food: 30 }, { x: -3.0, z: 1.75, y: 0.77, rot: 0.4, inside: true }],
  ['russian_food_cans_01', 'Canned meat (tushonka)', { food: 30 }, { x: -4.6, z: -1.8, y: 1.13, rot: 1.9, inside: true }],
  ['can_rusted', 'Rusty can (contents unknown)', { food: 10, health: -5 }, { x: -4.4, z: 2.75, y: 0.34, rot: 0.8, inside: true }],
  ['plastic_bottle_gallon', 'Water bottle (half full)', { water: 45 }, { x: -3.45, z: 1.3, y: 0.77, rot: 2.2, inside: true }],
  ['medical_box', 'First-aid kit', { health: 40 }, { x: 0.2, z: -3.0, y: 1.18, rot: 0.1, inside: true }],
  ['old_gas_mask', 'Gas mask', {}, { x: 3.4, z: -2.0, y: 0.52, rot: 1.2, rx: -Math.PI / 2, inside: true }],
  ['bolt_action_rifle_7_62', 'Mosin-pattern rifle', {}, { x: 3.9, z: -2.5, y: 0.55, rot: 0.3, rx: Math.PI / 2, inside: true }],
  ['ammo_box', '7.62 ammunition', {}, { x: 1.7, z: 2.8, y: 0, rot: 0.6, inside: true }],
  ['metal_jerrycan_green', 'Jerrycan (petrol)', {}, { x: -6.6, z: 12.1, rot: 0.9 }],
  ['hatchet', 'Hatchet', {}, { x: 8.0, z: -6.2, rot: 0.3, rz: 1.2, onStump: true }],
];

export async function build(ctx) {
  const { player, camera, house } = ctx;
  const state = { health: 82, food: 55, water: 40, inv: [] };
  const items = [];
  const raycaster = new THREE.Raycaster();
  raycaster.far = 2.4;

  for (const [id, name, effect, o] of LOOT) {
    const opts = { ...o };
    if (o.inside && house) { opts.parent = house.root; opts.onFloor = true; opts.envIntensity = 0.4; }
    if (o.onStump) { opts.y = ctx.hf.height(o.x, o.z) + 0.5; }
    const obj = await spawnModel(ctx, id, opts);
    if (!obj) continue;
    obj.traverse((m) => { if (m.isMesh) m.userData.loot = true; });
    items.push({ obj, name, effect, id });
  }

  const $ = (id) => document.getElementById(id);
  const toast = (msg) => { const t = $('toast'); t.textContent = msg; clearTimeout(toast.h); toast.h = setTimeout(() => (t.textContent = ''), 3500); };
  const renderInv = () => { $('inv-list').innerHTML = state.inv.length ? state.inv.map((n) => `<li>${n}</li>`).join('') : '<li>Empty</li>'; };
  renderInv();

  let target = null;
  const center = new THREE.Vector2(0, 0);
  const doorMeshes = () => (ctx.doors || []).map((d) => d.leaf);

  addEventListener('keydown', (e) => {
    if (!player.enabled) return;
    if (e.code === 'Tab') { e.preventDefault(); $('inventory').hidden = !$('inventory').hidden; }
    if (e.code !== 'KeyE' || !target) return;
    if (target.door) {
      target.door.open = !target.door.open;
      return;
    }
    const it = target.item;
    it.obj.parent.remove(it.obj);
    items.splice(items.indexOf(it), 1);
    const eff = it.effect;
    if (eff.food || eff.water || eff.health) {
      state.food = Math.min(100, state.food + (eff.food || 0));
      state.water = Math.min(100, state.water + (eff.water || 0));
      state.health = Math.max(0, Math.min(100, state.health + (eff.health || 0)));
      toast(`Used: ${it.name}`);
    } else {
      state.inv.push(it.name); renderInv();
      toast(`Picked up: ${it.name}`);
    }
  });

  ctx.updaters.push({
    update: (dt) => {
      // metabolism: roughly a day of food / half a day of water in game minutes
      const moving = Math.hypot(player.vel.x, player.vel.z);
      state.food = Math.max(0, state.food - dt * (0.012 + moving * 0.004));
      state.water = Math.max(0, state.water - dt * (0.02 + moving * 0.006));
      if (state.food <= 0 || state.water <= 0) state.health = Math.max(0, state.health - dt * 0.05);
      $('m-health').style.width = state.health + '%';
      $('m-food').style.width = state.food + '%';
      $('m-water').style.width = state.water + '%';

      if (!player.enabled) return;
      raycaster.setFromCamera(center, camera);
      const lootMeshes = [];
      for (const it of items) it.obj.traverse((m) => { if (m.isMesh) { m.userData.item = it; lootMeshes.push(m); } });
      const hits = raycaster.intersectObjects([...lootMeshes, ...doorMeshes()], true);
      target = null;
      let text = '';
      if (hits.length) {
        let o = hits[0].object;
        const door = (ctx.doors || []).find((d) => d.leaf === o || d.leaf.children.includes(o));
        if (door) { target = { door }; text = `E — ${door.open ? 'Close' : 'Open'} door`; }
        else if (o.userData.item) { target = { item: o.userData.item }; text = `E — Take ${o.userData.item.name}`; }
      }
      $('prompt').textContent = text;
    },
  });
  // spawn: at the roadside, looking up the driveway at the house
  ctx.spawn = { x: -5.5, z: 26, yaw: 0.12 };
  ctx.state = state;
}
