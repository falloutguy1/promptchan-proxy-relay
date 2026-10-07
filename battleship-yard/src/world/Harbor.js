import * as THREE from 'three';
import { V, Batch, rbox, cyl, lathe, mulberry } from '../engine/geom.js';
import { QUAY, BUILDINGS, ROAD } from './layout.js';
import { buildBuildings } from './Buildings.js';
import { buildCrane } from './Crane.js';
import { placeProps } from './Props.js';
import { LAYER_NO_AO } from '../engine/Renderer.js';

/**
 * The fitting-out quay and yard: quay wall, apron, yard paving, crane rails, bollards, fenders,
 * ladders, buildings, crane, props, buoys, plus dynamic mooring lines and gangway to the ship.
 */
export class Harbor {
  constructor(assets, lib, terrain, waves) {
    this.assets = assets; this.lib = lib; this.terrain = terrain; this.waves = waves;
    this.group = new THREE.Group();
    this.group.name = 'harbor';
    this.floaters = [];
    this.openings = [];
  }

  materials() {
    const L = this.lib;
    return {
      wall: L.make('quay-wall', 'concrete_wall_008', { normalScale: 1, weather: { macro: 0.22, macroScale: 0.05, wetLine: 0.9, wetRange: 1.4, algae: 0.85, grimeHeight: 1.2, grimeRange: 2.5, grimeAmount: 0.25 } }),
      coping: L.make('quay-coping', 'concrete_wall_008', { color: 0xb8b4ac, weather: { macro: 0.15, macroScale: 0.2 } }),
      apron: L.make('apron', 'concrete_floor_worn_001', { weather: { macro: 0.28, macroScale: 0.018 } }),
      asphalt: L.make('asphalt', 'asphalt_02', { weather: { macro: 0.3, macroScale: 0.015 } }),
      kerb: L.make('kerb', 'concrete_wall_008', { color: 0xa9a59d, weather: { macro: 0.2, macroScale: 0.1, grimeHeight: 2.9, grimeRange: 0.4, grimeAmount: 0.3 } }),
      paintYellow: L.make('paint-yellow', 'painted_concrete', { color: 0xd6a92a, weather: { macro: 0.35, macroScale: 0.3 } }),
      paintWhite: L.make('paint-white', 'painted_concrete', { color: 0xd8d6cf, weather: { macro: 0.35, macroScale: 0.3 } }),
      iron: L.make('cast-iron', 'rust_coarse_01', { color: 0x4a4744, weather: { macro: 0.2, macroScale: 0.5 } }),
      blackIron: L.plain('black-iron', 0x1d1c1b, 0.55, 0.6),
      timber: L.make('fender-timber', 'wood_floor_deck', { color: 0x5b4a3c, weather: { macro: 0.3, macroScale: 0.3, wetLine: 0.8, wetRange: 1.0, algae: 0.6 } }),
      steel: L.make('galv-steel', 'metal_plate', { color: 0x9a9c9c, normalScale: 0.4 }),
      rail: L.plain('rail-steel', 0x6d6a66, 0.35, 0.95),
      rope: L.plain('rope', 0x5e5240, 0.9, 0),
      joint: L.plain('joint', 0x2b2a28, 0.95, 0),
    };
  }

  async build(quality) {
    this.quality = quality;
    const m = (this.m = this.materials());
    const b = new Batch();
    const { x0, x1, edgeZ, topY, floorY, yardZ, apronZ } = QUAY;
    const len = x1 - x0;

    // ---- quay wall: 2.4 m thick mass concrete face from seabed to coping ----
    b.add(m.wall, new THREE.BoxGeometry(len, topY - 0.45 - floorY, 2.4, 1, 1, 1), V(0, (floorY + topY - 0.45) / 2, edgeZ - 1.2));
    // returns at both ends
    for (const s of [-1, 1]) b.add(m.wall, new THREE.BoxGeometry(2.4, topY - 0.45 - floorY, 30), V(s * (x1 - 1.2), (floorY + topY - 0.45) / 2, edgeZ - 15));
    // vertical construction joints
    for (let x = x0 + 15; x < x1; x += 15) b.add(m.joint, new THREE.BoxGeometry(0.05, topY - floorY, 0.05), V(x, (floorY + topY) / 2 - 0.4, edgeZ + 0.005));
    // coping beam with bevelled edges and painted safety edge
    b.add(m.coping, rbox(len, 0.55, 1.4, 0.06), V(0, topY - 0.25, edgeZ - 0.6));
    for (const s of [-1, 1]) b.add(m.coping, rbox(1.4, 0.55, 30, 0.06), V(s * (x1 - 0.6), topY - 0.25, edgeZ - 15));
    for (let x = x0; x < x1; x += 2.0) b.add((Math.round((x - x0) / 2) % 2) ? m.paintYellow : m.paintWhite, new THREE.BoxGeometry(1.98, 0.02, 0.18), V(x + 1, topY + 0.031, edgeZ - 0.12));

    // ---- apron (concrete slabs, 6 m bays) and yard (asphalt) as thick slabs so edges read as kerbs ----
    b.add(m.apron, new THREE.BoxGeometry(len, 0.6, apronZ * -1 - 1.3, 1, 1, 1), V(0, topY - 0.3, (apronZ + edgeZ - 1.3) / 2));
    for (let x = x0 + 6; x < x1; x += 6) b.add(m.joint, new THREE.BoxGeometry(0.03, 0.012, -apronZ - 1.3), V(x, topY + 0.001, (apronZ + edgeZ - 1.3) / 2));
    for (let z = -7; z > apronZ; z -= 6) b.add(m.joint, new THREE.BoxGeometry(len, 0.012, 0.03), V(0, topY + 0.001, z));
    const yardW = len + 60;
    b.add(m.asphalt, new THREE.BoxGeometry(yardW, 0.6, apronZ - yardZ, 1, 1, 1), V(0, topY - 0.32, (apronZ + yardZ) / 2));
    // concrete kerbs around the yard edge
    b.add(m.kerb, rbox(yardW + 0.6, 0.75, 0.35, 0.05), V(0, topY - 0.27, yardZ - 0.15));
    for (const s of [-1, 1]) b.add(m.kerb, rbox(0.35, 0.75, apronZ - yardZ, 0.05), V(s * (yardW / 2 + 0.15), topY - 0.27, (apronZ + yardZ) / 2));
    // painted lane markings, worn
    for (let x = -yardW / 2 + 8; x < yardW / 2 - 8; x += 9) b.add(m.paintWhite, new THREE.BoxGeometry(4.5, 0.012, 0.15), V(x, topY - 0.012 + 0.03, apronZ - 9));
    for (let x = -60; x < 140; x += 3.5) b.add(m.paintYellow, new THREE.BoxGeometry(0.12, 0.012, 2.8), V(x, topY + 0.02, apronZ - 2.8));

    // ---- crane rails (embedded, flush) ----
    for (const rz of QUAY.railZ) {
      b.add(m.rail, new THREE.BoxGeometry(len - 2, 0.05, 0.075), V(0, topY + 0.005, rz));
      b.add(m.joint, new THREE.BoxGeometry(len - 2, 0.012, 0.32), V(0, topY + 0.001, rz));
      for (const s of [-1, 1]) b.add(m.paintYellow, rbox(0.9, 0.9, 0.6, 0.08), V(s * (x1 - 4), topY + 0.45, rz)); // end stops
    }

    // ---- bollards: cast iron tee-head, every 18 m ----
    const bollardProfile = [[0, 0], [0.42, 0], [0.42, 0.08], [0.3, 0.12], [0.24, 0.2], [0.22, 0.55], [0.26, 0.62], [0.36, 0.68], [0.38, 0.74], [0.3, 0.8], [0, 0.82]];
    const bollard = lathe(bollardProfile, 20);
    this.bollards = [];
    for (let x = x0 + 6; x < x1; x += 18) {
      b.add(m.iron, bollard, V(x, topY, edgeZ - 1.0));
      this.bollards.push(V(x, topY + 0.6, edgeZ - 1.0));
    }

    // ---- fenders: timber piles + hanging tyres ----
    for (let x = x0 + 3; x < x1; x += 12) {
      b.add(m.timber, rbox(0.4, topY - floorY * 0.25, 0.4, 0.05), V(x, (topY + floorY * 0.25) / 2 - 0.3, edgeZ + 0.22));
    }
    const tyre = await this.assets.model('old_tyre');
    if (tyre) {
      const rnd = mulberry(5);
      for (let x = x0 + 9; x < x1; x += 12) {
        const t = tyre.clone();
        t.position.set(x + (rnd() - 0.5), 0.9 + rnd() * 0.4, edgeZ + 0.12);
        t.rotation.set(0, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.15);
        t.scale.setScalar(1.6);
        this.group.add(t);
        b.add(m.blackIron, new THREE.CylinderGeometry(0.012, 0.012, topY - 1.3, 4), V(x + 0.1, (topY + 1.4) / 2 + 0.8, edgeZ + 0.06));
      }
    }

    // ---- recessed ladders every 45 m ----
    for (let x = x0 + 22; x < x1; x += 45) {
      b.add(m.joint, new THREE.BoxGeometry(0.9, topY - floorY * 0.3, 0.3), V(x, (topY + floorY * 0.3) / 2 - 0.2, edgeZ - 0.12));
      for (const s of [-0.32, 0.32]) b.add(m.steel, cyl(0.035, 0.035, topY - floorY * 0.3 + 1.1, 8), V(x + s, (topY + floorY * 0.3) / 2 + 0.3, edgeZ - 0.05));
      for (let y = floorY * 0.3; y < topY; y += 0.3) b.add(m.steel, cyl(0.022, 0.022, 0.64, 6), V(x, y, edgeZ - 0.05), [0, 0, Math.PI / 2]);
      // grab hoops above the coping
      for (const s of [-0.32, 0.32]) b.add(m.steel, new THREE.TorusGeometry(0.45, 0.035, 6, 12, Math.PI), V(x + s, topY, edgeZ - 0.5), [0, Math.PI / 2, 0]);
    }

    this.group.add(b.build('quay'));

    const blds = await buildBuildings(this.assets, this.lib, this.quality);
    this.group.add(blds.group);
    this.openings = blds.openings;
    this.lights = blds.lights;
    this.crane = buildCrane(this.lib);
    this.crane.group.position.set(-38, topY, 0);
    this.group.add(this.crane.group);
    const props = await placeProps(this.assets, this.lib, this.terrain);
    this.group.add(props.group);
    this.floaters.push(...props.floaters);
    this.colliders = props.colliders;

    this.mooring = new THREE.Group();
    this.mooring.name = 'mooring';
    this.group.add(this.mooring);
  }

  /** Ground height for walking/camera: paving, quay and building floors over terrain. */
  groundAt(x, z) {
    const { x0, x1, edgeZ, topY, yardZ } = QUAY;
    if (z <= edgeZ && z >= yardZ - 0.3 && Math.abs(x) <= (x1 - x0) / 2 + 30.3) return topY;
    if (z <= edgeZ && z > edgeZ - 30 && Math.abs(x) <= x1) return topY;
    return this.terrain.heightAt(x, z);
  }

  insideOpen(x, z) { return this.openings.some((o) => Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2); }

  attachShip(ship) {
    this.ship = ship;
    this.rebuildMooring();
  }

  setMooringVisible(v) { if (this.mooring) this.mooring.visible = v; }

  rebuildMooring() {
    const ship = this.ship;
    if (!ship || !this.mooring) return;
    for (const c of [...this.mooring.children]) { this.mooring.remove(c); c.geometry?.dispose(); }
    ship.root.updateMatrixWorld(true);
    const hs = ship.hull;
    const m = this.m;
    const lines = [];
    // head, breast and stern lines plus springs, from deck fairleads to quay bollards
    const pairs = [[0.9, 0.5], [0.8, 0.28], [0.62, -0.05], [0.38, 0.12], [0.18, -0.12], [0.08, -0.3], [0.1, -0.5]];
    for (const [s, dxFrac] of pairs) {
      const e = hs.edge(s);
      const local = V(e.x, e.y + 0.6, -(e.b - 1.2)); // port side faces the quay
      const p0 = ship.root.localToWorld(local);
      const targetX = p0.x + dxFrac * ship.length * 0.35;
      const bl = this.bollards.reduce((a, c) => (Math.abs(c.x - targetX) < Math.abs(a.x - targetX) ? c : a));
      lines.push([p0, bl]);
    }
    for (const [a, c] of lines) {
      const pts = [];
      const span = a.distanceTo(c);
      for (let i = 0; i <= 16; i++) {
        const t = i / 16, p = a.clone().lerp(c, t);
        p.y -= Math.sin(t * Math.PI) * span * 0.035; // catenary sag
        pts.push(p);
      }
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.045, 5);
      const mesh = new THREE.Mesh(g, m.rope);
      mesh.castShadow = true;
      this.mooring.add(mesh);
    }
    // gangway from the quay to the main deck, amidships
    const e = hs.edge(0.45);
    const top = ship.root.localToWorld(V(e.x, e.y + 0.05, -(e.b - 1.5)));
    const bottom = V(top.x - 6, QUAY.topY + 0.05, QUAY.edgeZ - 3.5);
    const dir = top.clone().sub(bottom), L = dir.length();
    const gw = new Batch();
    const yaw = Math.atan2(-(dir.z), dir.x), pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    const mid = bottom.clone().add(top).multiplyScalar(0.5);
    const rot = [0, yaw, pitch];
    gw.add(m.steel, rbox(L, 0.12, 1.1, 0.03), mid, rot);
    for (const s of [-0.55, 0.55]) {
      const off = V(0, 1.0, s).applyEuler(new THREE.Euler(0, yaw, pitch, 'YXZ'));
      gw.add(m.steel, cyl(0.03, 0.03, L, 6), mid.clone().add(off), [0, yaw, pitch + Math.PI / 2]);
      for (let k = 0; k <= Math.floor(L / 1.5); k++) {
        const p = bottom.clone().add(dir.clone().multiplyScalar(k * 1.5 / L)).add(V(0, 0.5, 0)).add(V(0, 0, s).applyEuler(new THREE.Euler(0, yaw, 0)));
        gw.add(m.steel, cyl(0.02, 0.02, 1.0, 5), p);
      }
    }
    const gwm = gw.build('gangway');
    this.mooring.add(gwm);
  }

  update(dt, t, camera) {
    for (const f of this.floaters) {
      const h = this.waves.heightAt(f.base.x, f.base.z, t);
      f.obj.position.set(f.base.x, h + f.offset, f.base.z);
      f.obj.rotation.x = Math.sin(t * 0.9 + f.base.x) * 0.06;
      f.obj.rotation.z = Math.cos(t * 0.7 + f.base.z) * 0.06;
    }
    this.crane?.update(dt, t);
  }
}
