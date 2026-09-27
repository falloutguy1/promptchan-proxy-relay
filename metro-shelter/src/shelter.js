// Shelter simulation (Fallout Shelter-style): rooms staffed by dwellers produce resources in batches that the
// Overseer must collect in person; everyone consumes power, water and food continuously.
import { roomAnchors } from './props.js';

export const DAY_SECONDS = 240;          // one in-game day
export const WIN_DAY = 10;

const ROOM_DEFS = {
  generator: { name: 'Generator',       stat: 'S', res: 'power', yield: 16, time: 70, icon: 'POWER' },
  water:     { name: 'Water Filters',   stat: 'P', res: 'water', yield: 14, time: 75, icon: 'WATER' },
  farm:      { name: 'Mushroom Farm',   stat: 'A', res: 'food',  yield: 14, time: 80, icon: 'FOOD' },
  workshop:  { name: 'Workshop',        stat: 'E', res: 'rounds', yield: 8, time: 90, icon: 'AMMO', cost: { scrap: 2 } },
  infirmary: { name: 'Infirmary',       stat: 'I', res: 'medkits', yield: 1, time: 120, icon: 'MEDKIT', cost: { scrap: 3 } },
  market:    { name: 'Trading Post',    stat: 'C', res: 'mgr',   yield: 6, time: 100, icon: 'ROUNDS' },
  radio:     { name: 'Radio Room',      stat: 'C', res: 'dweller', yield: 1, time: 180, icon: 'RECRUIT' },
};
const UPGRADE = [null, { mgr: 25, scrap: 4 }, { mgr: 60, scrap: 10 }];
const NAMES = ['Anya', 'Lev', 'Boris', 'Olga', 'Pavel', 'Dasha', 'Grisha', 'Marat', 'Vera', 'Tolya', 'Sasha', 'Nina', 'Ilya', 'Katya', 'Yuri', 'Zoya', 'Fyodor', 'Lida'];
const STATS = ['S', 'P', 'E', 'C', 'I', 'A', 'L'];

export class Shelter {
  constructor() {
    this.res = { power: 70, water: 65, food: 60 };
    this.cap = { power: 100, water: 100, food: 100 };
    this.inv = { mgr: 20, scrap: 3, rounds: 24, medkits: 1 };
    this.time = DAY_SECONDS * 0.25;   // 06:00 on day 1
    this.dwellers = [];
    this.rooms = {};
    this.log = [];
    this.nameIdx = 0;
    this.capacity = 16;
    for (const [id, d] of Object.entries(ROOM_DEFS)) {
      this.rooms[id] = { id, ...d, level: 1, slots: 2, assigned: [], progress: 0, ready: 0, anchor: roomAnchors[id] };
    }
    const start = [['generator', { S: 6 }], ['generator', { S: 4 }], ['water', { P: 5 }], ['farm', { A: 6 }], ['farm', { A: 3 }], ['market', { C: 4 }]];
    for (const [room, st] of start) this.assign(this.newDweller(st), room);
    this.over = null;
  }

  newDweller(bias = {}) {
    const d = { id: this.nameIdx, name: NAMES[this.nameIdx++ % NAMES.length], hp: 100, room: null };
    for (const s of STATS) d[s] = 1 + Math.floor(Math.random() * 3);
    Object.assign(d, bias);
    this.dwellers.push(d);
    return d;
  }

  assign(d, roomId) {
    if (d.room) { const r = this.rooms[d.room]; r.assigned = r.assigned.filter((x) => x !== d); }
    d.room = null;
    if (!roomId) return true;
    const r = this.rooms[roomId];
    if (r.assigned.length >= r.slots) return false;
    r.assigned.push(d); d.room = roomId;
    return true;
  }

  day() { return Math.floor(this.time / DAY_SECONDS) + 1; }
  clock() {
    const f = (this.time / DAY_SECONDS) % 1;
    const m = Math.floor(f * 24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  roomRate(r) {
    const sum = r.assigned.reduce((a, d) => a + d[r.stat] * (d.hp > 30 ? 1 : 0.5), 0);
    if (!sum) return 0;
    return (1 + sum * 0.14) / r.time;
  }

  canUpgrade(r) {
    const c = UPGRADE[r.level];
    return c && this.inv.mgr >= c.mgr && this.inv.scrap >= c.scrap ? c : null;
  }
  upgradeCost(r) { return UPGRADE[r.level]; }
  upgrade(r) {
    const c = this.canUpgrade(r);
    if (!c) return false;
    this.inv.mgr -= c.mgr; this.inv.scrap -= c.scrap;
    r.level++; r.slots++;
    if (r.res in this.cap) this.cap[r.res] += 40;
    return true;
  }

  // Collect a ready batch; returns a description or null.
  collect(r) {
    if (r.ready <= 0) return null;
    const amt = r.ready; r.ready = 0;
    if (r.res in this.res) {
      const before = this.res[r.res];
      this.res[r.res] = Math.min(this.cap[r.res], this.res[r.res] + amt);
      return `+${Math.round(this.res[r.res] - before)} ${r.res}`;
    }
    if (r.res === 'dweller') {
      if (this.dwellers.filter((d) => d.hp > 0).length >= this.capacity) return 'No room for newcomers';
      const d = this.newDweller();
      return `${d.name} arrived from Line 3 and joins the shelter`;
    }
    this.inv[r.res] += amt;
    return `+${amt} ${r.res === 'mgr' ? 'military-grade rounds' : r.res}`;
  }

  // dt seconds. `ratsEating` = number of rats currently at the food stores.
  update(dt, ratsEating = 0) {
    if (this.over) return;
    this.time += dt;
    const alive = this.dwellers.filter((d) => d.hp > 0);
    const n = alive.length;
    // consumption per second
    const staffed = Object.values(this.rooms).filter((r) => r.assigned.length).length;
    this.res.food -= dt * (0.011 * n + ratsEating * 0.12);
    this.res.water -= dt * 0.010 * n;
    this.res.power -= dt * (0.05 + staffed * 0.028);
    const powered = this.res.power > 0;
    for (const r of Object.values(this.rooms)) {
      if (r.ready > 0) continue;                       // full: waiting for collection
      if (!powered && r.id !== 'generator') continue;  // brown-out stops everything but the generator
      if (r.id === 'farm' && ratsEating > 0) continue;
      if (r.cost && Object.entries(r.cost).some(([k, v]) => this.inv[k] < v)) continue;
      r.progress += dt * this.roomRate(r);
      if (r.progress >= 1) {
        r.progress = 0;
        if (r.cost) for (const [k, v] of Object.entries(r.cost)) this.inv[k] -= v;
        r.ready = Math.round(r.yield * (1 + (r.level - 1) * 0.5));
        this.onReady?.(r);
      }
    }
    // hardship
    for (const k of ['power', 'water', 'food']) this.res[k] = Math.max(0, this.res[k]);
    let dmg = 0;
    if (this.res.water <= 0) dmg += 0.35;
    if (this.res.food <= 0) dmg += 0.3;
    for (const d of alive) {
      if (dmg) d.hp -= dmg * dt;
      else if (d.hp < 100) d.hp = Math.min(100, d.hp + dt * (this.rooms.infirmary.assigned.length ? 0.2 : 0.05));
      if (d.hp <= 0) { d.hp = 0; this.assign(d, null); this.onDeath?.(d); }
    }
    if (!this.dwellers.some((d) => d.hp > 0)) this.over = { win: false, why: 'Every dweller of Station Zarya is dead.' };
    else if (this.day() > WIN_DAY) this.over = { win: true, why: `Station Zarya held out for ${WIN_DAY} days. A caravan from Polis has reached the gate.` };
  }
}
