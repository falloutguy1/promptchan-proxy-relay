// Scanned CC0 GLB props (Poly Haven) scattered for environmental storytelling:
// ammunition and crates at flak sites, barrels and cement at the works, jerrycans at the depot.
import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';

const SETS = {
  flak: [['ammo_box', 0.45], ['old_military_crate', 0.3], ['metal_jerrycan_green', 0.25]],
  factory: [['Barrel_01', 0.45], ['cement_bag', 0.3], ['old_military_crate', 0.25]],
  yard: [['Barrel_01', 0.5], ['old_military_crate', 0.5]],
  depot: [['Barrel_01', 0.7], ['metal_jerrycan_green', 0.3]],
  farm: [['Barrel_01', 0.6], ['cement_bag', 0.4]],
};

export class Props {
  constructor(scene, env, assets, hf, settlement) {
    this.group = new THREE.Group(); this.group.name = 'props';
    scene.add(this.group);
    const parts = {};
    for (const [name, root] of Object.entries(assets.models)) {
      root.updateMatrixWorld(true);
      const list = [];
      root.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        const m = o.material;
        env.material(m);
        list.push({ g, m });
      });
      parts[name] = list;
    }
    const rnd = mulberry32(77);
    this.clusters = [];
    const occ = settlement.occGrid;
    for (const spot of settlement.propSpots) {
      const placements = {};
      const set = SETS[spot.kind] || SETS.yard;
      const n = spot.n || 4;
      // props come in small stacks/clusters
      for (let c = 0; c < Math.ceil(n / 5); c++) {
        const cx = spot.x + (rnd() - 0.5) * spot.r * 2, cz = spot.z + (rnd() - 0.5) * spot.r * 2;
        let r = rnd(), name = set[0][0];
        for (const [nm, w] of set) { if (r < w) { name = nm; break; } r -= w; }
        if (!parts[name]) continue;
        const list = occ.get(`${Math.floor(cx / 50)}_${Math.floor(cz / 50)}`);
        let blocked = false;
        if (list) for (const o of list) if (Math.abs(cx - o.x) < o.w / 2 + 1 && Math.abs(cz - o.z) < o.d / 2 + 1 && Math.hypot(cx - o.x, cz - o.z) < Math.max(o.w, o.d) / 2) blocked = true;
        if (blocked) continue;
        const k = Math.min(5, n);
        for (let i = 0; i < k; i++) {
          const x = cx + (i % 3) * 0.75 + (rnd() - 0.5) * 0.2, z = cz + Math.floor(i / 3) * 0.8 + (rnd() - 0.5) * 0.2;
          const y = hf.height(x, z);
          (placements[name] ||= []).push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), new THREE.Vector3(1, 1, 1)));
        }
      }
      const cl = new THREE.Group();
      cl.userData.c = new THREE.Vector3(spot.x, hf.height(spot.x, spot.z), spot.z);
      cl.visible = false;
      for (const [name, mats] of Object.entries(placements)) {
        for (const { g, m } of parts[name]) {
          const im = new THREE.InstancedMesh(g, m, mats.length);
          mats.forEach((mm, i) => im.setMatrixAt(i, mm));
          im.castShadow = true; im.receiveShadow = true;
          im.computeBoundingSphere();
          cl.add(im);
        }
      }
      if (cl.children.length) { this.group.add(cl); this.clusters.push(cl); }
    }
    this.range = 220;
  }

  // scanned props are dense meshes: only draw clusters near the camera
  update(cam) {
    for (const c of this.clusters) c.visible = c.userData.c.distanceToSquared(cam) < this.range * this.range;
  }
}
