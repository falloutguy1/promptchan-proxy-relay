import * as THREE from 'three';
import * as TX from '../textures.js';
import { lathe, baked, mergeLoose, trs, instanced, rng } from '../util.js';
import { M, initMaterials, roomEnv, addVista, mesh, chandelier, emissiveMat, curtain, pottedPalm, RoundedBoxGeometry } from './common.js';

// Main dining room: aft-facing arched windows, domed ceilings and set tables.
export function buildDining(renderer) {
  initMaterials();
  const scene = new THREE.Scene();
  scene.environment = roomEnv(renderer);
  scene.environmentIntensity = 0.45;
  const vista = addVista(renderer, scene, { elev: 4, azim: 170, seaY: -16, turbidity: 6, rayleigh: 2.4, clouds: 0.5, gain: 0.5 });
  const R = rng(12);
  const W = 34, D = 26, H = 5.6;
  const x0 = -W / 2, x1 = W / 2, zF = -D / 2, zB = D / 2;

  const carpet = new THREE.MeshStandardMaterial({ map: TX.carpetTexture('#4a1020', '#c9a04e', '#23060e', 'medallion'), roughness: 0.95 });
  carpet.map.repeat.set(8, 6);
  const panel = new THREE.MeshStandardMaterial({ map: TX.woodTexture([112, 70, 44], 59), roughness: 0.42 });
  panel.map.repeat.set(6, 1);
  const cream = new THREE.MeshStandardMaterial({ color: 0xefe6d6, roughness: 0.7 });
  const warm = emissiveMat(0xffc47f, 2.6);
  const cloth = new THREE.MeshPhysicalMaterial({ color: 0xfbfaf6, roughness: 0.85, sheen: 0.5, sheenColor: new THREE.Color(0xffffff) });

  scene.add(mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), carpet, { cast: false }));
  // walls
  scene.add(mesh(baked(new THREE.PlaneGeometry(D, H), [x0, H / 2, 0], [0, Math.PI / 2, 0]), panel));
  scene.add(mesh(baked(new THREE.PlaneGeometry(D, H), [x1, H / 2, 0], [0, -Math.PI / 2, 0]), panel));
  scene.add(mesh(baked(new THREE.PlaneGeometry(W, H), [0, H / 2, zB], [0, Math.PI, 0]), panel));
  // wainscot rail + sconces
  for (const [a, b, rot] of [[[x0 + 0.03, 0], D, Math.PI / 2], [[x1 - 0.03, 0], D, -Math.PI / 2]]) {
    scene.add(mesh(baked(new THREE.BoxGeometry(b, 0.06, 0.06), [a[0], 1.0, 0], [0, rot, 0]), M.brass));
  }
  const sconce = mergeLoose([lathe([[0, 0], [0.12, 0.02], [0.16, 0.22], [0, 0.24]], 16)]);
  const sc = [];
  for (let z = -10; z <= 10; z += 4) for (const x of [x0 + 0.15, x1 - 0.15]) sc.push(trs([x, 2.4, z]));
  scene.add(instanced(sconce, new THREE.MeshStandardMaterial({ color: 0xfff0d6, emissive: 0xffbe78, emissiveIntensity: 2.2, roughness: 0.6 }), sc, { cast: false }));

  // ---- aft window wall with arched windows
  {
    const wallShape = new THREE.Shape();
    wallShape.moveTo(x0, 0); wallShape.lineTo(x1, 0); wallShape.lineTo(x1, H); wallShape.lineTo(x0, H); wallShape.closePath();
    const arches = [];
    for (let i = 0; i < 6; i++) {
      const cx = x0 + 2.85 + i * 5.66, w = 4.2, top = 4.3;
      const h = new THREE.Path();
      h.moveTo(cx - w / 2, 0.55); h.lineTo(cx + w / 2, 0.55); h.lineTo(cx + w / 2, top - w / 2);
      h.absarc(cx, top - w / 2, w / 2, 0, Math.PI, false); h.lineTo(cx - w / 2, 0.55);
      wallShape.holes.push(h);
      arches.push(cx);
    }
    const wg = new THREE.ExtrudeGeometry(wallShape, { depth: 0.5, bevelEnabled: false, curveSegments: 24 });
    wg.translate(0, 0, zF - 0.5);
    scene.add(mesh(wg, cream));
    const mull = new THREE.MeshStandardMaterial({ color: 0xc9a86a, metalness: 1, roughness: 0.3 });
    for (const cx of arches) {
      scene.add(mesh(baked(new THREE.BoxGeometry(0.06, 3.3, 0.06), [cx, 1.9, zF - 0.25]), mull));
      scene.add(mesh(baked(new THREE.BoxGeometry(4.2, 0.06, 0.06), [cx, 2.2, zF - 0.25]), mull));
      scene.add(mesh(baked(new THREE.TorusGeometry(2.1, 0.04, 8, 32, Math.PI), [cx, 2.2, zF - 0.25]), mull));
      const gl = mesh(baked(new THREE.PlaneGeometry(4.2, 3.7), [cx, 2.4, zF - 0.3]), M.glass, { cast: false, receive: false });
      gl.renderOrder = 3; scene.add(gl);
      // drapes
      const drape = new THREE.MeshPhysicalMaterial({ color: 0x8a1a2c, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(0xff6a7a), side: THREE.DoubleSide });
      for (const s of [-1, 1]) { const c = curtain(0.7, H - 0.3, 5, 0.07, drape); c.position.set(cx + s * 2.45, (H - 0.3) / 2, zF + 0.12); scene.add(c); }
    }
  }

  // ---- ceiling with three domes and cove lighting
  {
    const ceilShape = new THREE.Shape();
    ceilShape.moveTo(x0, zF); ceilShape.lineTo(x1, zF); ceilShape.lineTo(x1, zB); ceilShape.lineTo(x0, zB); ceilShape.closePath();
    const domes = [[-10.5, 1], [0, 1], [10.5, 1]];
    for (const [x, z] of domes) { const h = new THREE.Path(); h.absarc(x, z, 4.4, 0, Math.PI * 2, true); ceilShape.holes.push(h); }
    const cg = new THREE.ShapeGeometry(ceilShape, 32);
    cg.rotateX(Math.PI / 2); cg.translate(0, H, 0);
    scene.add(mesh(cg, cream, { cast: false }));
    for (const [x, z] of domes) {
      const dome = lathe([[4.4, 0], [4.4, 0.25], [4.1, 0.25], [4.0, 0.5], [3.6, 1.3], [2.6, 2.0], [1.2, 2.35], [0, 2.4]], 64);
      const dm = new THREE.MeshStandardMaterial({ color: 0xf6ead0, roughness: 0.75, side: THREE.BackSide });
      scene.add(mesh(baked(dome, [x, H, z]), dm, { cast: false }));
      scene.add(mesh(baked(new THREE.TorusGeometry(4.2, 0.03, 6, 96), [x, H + 0.24, z], [Math.PI / 2, 0, 0]), warm, { cast: false }));
      const ch = chandelier({ rings: 4, radius: 1.9, drop: 1.4, rodLen: 0.7, seed: x + 20 });
      ch.position.set(x, H + 1.1, z);
      scene.add(ch);
    }
    // perimeter downlights
    const disk = new THREE.CircleGeometry(0.07, 12).rotateX(Math.PI / 2);
    const pts = [];
    for (let x = x0 + 1.5; x < x1; x += 3) for (const z of [zF + 2, zB - 2]) pts.push(trs([x, H - 0.005, z]));
    scene.add(instanced(disk, warm, pts, { cast: false, receive: false }));
  }

  // ---- columns with capitals
  {
    const col = lathe([[0, 0], [0.5, 0], [0.5, 0.2], [0.36, 0.3], [0.32, 0.35], [0.3, H - 0.6], [0.4, H - 0.45], [0.55, H - 0.25], [0.55, H], [0, H]], 32);
    const cols = [];
    for (const x of [-15.5, -5.25, 5.25, 15.5]) for (const z of [-5.5, 7.5]) cols.push(trs([x, 0, z]));
    const marble = new THREE.MeshPhysicalMaterial({ map: TX.marbleTexture(37, [230, 220, 204], [140, 110, 80], 2), roughness: 0.15, clearcoat: 1 });
    scene.add(instanced(col, marble, cols));
    const rings = [];
    for (const m of cols) { const p = new THREE.Vector3().setFromMatrixPosition(m); rings.push(trs([p.x, 1.2, p.z]), trs([p.x, H - 0.55, p.z])); }
    scene.add(instanced(new THREE.TorusGeometry(0.32, 0.035, 8, 32).rotateX(Math.PI / 2), M.brass, rings, { cast: false }));
  }

  // ---- tables with place settings
  {
    const clothGeo = lathe([[0, 0.76], [0.9, 0.76], [0.93, 0.74], [0.97, 0.6], [1.0, 0.36], [1.0, 0.34], [0, 0.34]], 48);
    const cp = clothGeo.getAttribute('position');
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i);
      if (y < 0.72) {
        const a = Math.atan2(cp.getZ(i), cp.getX(i));
        const k = 1 + 0.04 * Math.sin(a * 14) * (0.76 - y) * 3;
        cp.setX(i, cp.getX(i) * k); cp.setZ(i, cp.getZ(i) * k);
      }
    }
    clothGeo.computeVertexNormals();
    const chair = mergeLoose([
      baked(new RoundedBoxGeometry(0.48, 0.1, 0.48, 2, 0.04), [0, 0.47, 0]),
      baked(new RoundedBoxGeometry(0.46, 0.62, 0.08, 2, 0.04), [0, 0.86, -0.22], [-0.12, 0, 0]),
    ]);
    const chairLegs = mergeLoose([
      ...[[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].map(([x, z]) => baked(new THREE.CylinderGeometry(0.022, 0.018, 0.44, 8), [x, 0.22, z])),
      baked(new THREE.BoxGeometry(0.44, 0.04, 0.03), [0, 1.14, -0.25], [-0.12, 0, 0]),
    ]);
    const plate = lathe([[0, 0], [0.1, 0], [0.13, 0.012], [0.14, 0.018], [0.135, 0.02], [0, 0.012]], 32);
    const charger = lathe([[0, 0], [0.16, 0], [0.165, 0.006], [0, 0.006]], 32);
    const glass = lathe([[0, 0], [0.035, 0], [0.035, 0.004], [0.006, 0.012], [0.005, 0.1], [0.03, 0.12], [0.042, 0.17], [0.036, 0.22], [0.034, 0.22], [0.04, 0.17], [0.028, 0.125], [0, 0.11]], 16);
    const napkin = new THREE.ConeGeometry(0.05, 0.16, 4).translate(0, 0.08, 0);
    const candle = lathe([[0, 0], [0.025, 0], [0.025, 0.12], [0, 0.12]], 12);
    const flame = new THREE.SphereGeometry(0.014, 8, 6).scale(1, 2, 1);
    const tables = [], chairs = [], chairCols = [], plates = [], chargers = [], glasses = [], napkins = [], candles = [], flames = [];
    const chairPalette = [0x1f3564, 0x1f3564, 0x283f74];
    for (let x = -14; x <= 14; x += 4.6) for (let z = -9.5; z <= 11; z += 3.9) {
      if (Math.abs(x - 0.2) < 1.2 && Math.abs(z - 1) < 2) continue; // centre aisle below dome
      const tx = x + (R() - 0.5) * 0.3, tz = z + (R() - 0.5) * 0.3;
      tables.push(trs([tx, 0, tz]));
      const seats = z < -6 ? 4 : 6;
      for (let i = 0; i < seats; i++) {
        const a = (i / seats) * Math.PI * 2 + (seats === 4 ? Math.PI / 4 : 0);
        const cx = tx + Math.cos(a) * 1.2, cz = tz + Math.sin(a) * 1.2;
        chairs.push(trs([cx, 0, cz], [0, -a - Math.PI / 2, 0]));
        chairCols.push(new THREE.Color(chairPalette[i % 3]));
        const px = tx + Math.cos(a) * 0.68, pz = tz + Math.sin(a) * 0.68;
        chargers.push(trs([px, 0.765, pz]));
        plates.push(trs([px, 0.771, pz]));
        napkins.push(trs([px, 0.79, pz]));
        glasses.push(trs([tx + Math.cos(a + 0.35) * 0.72, 0.765, tz + Math.sin(a + 0.35) * 0.72]));
      }
      candles.push(trs([tx, 0.765, tz]));
      flames.push(trs([tx, 0.905, tz]));
    }
    scene.add(instanced(clothGeo, cloth, tables));
    scene.add(instanced(chair, M.velvet, chairs, { colors: chairCols }));
    scene.add(instanced(chairLegs, M.darkWood, chairs));
    scene.add(instanced(charger, M.brass, chargers, { cast: false }));
    scene.add(instanced(plate, M.porcelain, plates, { cast: false }));
    scene.add(instanced(napkin, new THREE.MeshStandardMaterial({ color: 0xc02338, roughness: 0.9 }), napkins, { cast: false }));
    scene.add(instanced(glass, M.crystal, glasses, { cast: false, receive: false }));
    scene.add(instanced(candle, new THREE.MeshStandardMaterial({ color: 0xfff8e8, roughness: 0.5, emissive: 0xffa040, emissiveIntensity: 0.4 }), candles, { cast: false }));
    scene.add(instanced(flame, emissiveMat(0xffb050, 6), flames, { cast: false, receive: false }));
  }
  // service stations + palms
  for (const [x, z] of [[-16, 11.5], [16, 11.5], [-16, -11.5], [16, -11.5]]) { const p = pottedPalm(1.2, x + z * 3); p.position.set(x, 0, z); scene.add(p); }
  scene.add(mesh(baked(new RoundedBoxGeometry(6, 1.0, 0.8, 2, 0.05), [0, 0.5, zB - 0.5]), M.darkWood));
  scene.add(mesh(baked(new THREE.BoxGeometry(6.1, 0.04, 0.9), [0, 1.02, zB - 0.5]), new THREE.MeshPhysicalMaterial({ map: TX.marbleTexture(33, [36, 40, 46], [190, 170, 130], 1.5), roughness: 0.12, clearcoat: 1 })));

  // ---- lighting
  const sun = new THREE.DirectionalLight(0xffb070, 3.6);
  sun.position.copy(vista.sun).multiplyScalar(80);
  sun.position.y = 14;
  sun.target.position.set(0, 0, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera; s.left = -22; s.right = 22; s.top = 22; s.bottom = -22; s.near = 20; s.far = 160;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xffe5c8, 0x3a1a14, 0.5));
  for (const x of [-10.5, 0, 10.5]) { const l = new THREE.PointLight(0xffc27e, 28, 16, 1.8); l.position.set(x, H - 0.6, 1); scene.add(l); }

  return {
    scene, exposure: 0.9, bloom: 0.4, bloomThreshold: 1.9,
    view: {
      pos: new THREE.Vector3(-3.5, 3.3, 12), target: new THREE.Vector3(1, 1.3, -4),
      minDistance: 2, maxDistance: 18, minPolar: 0.5, maxPolar: 1.62,
      bounds: new THREE.Box3(new THREE.Vector3(x0 + 0.8, 0.9, zF + 0.8), new THREE.Vector3(x1 - 0.8, H - 0.4, zB - 0.6)),
    },
    update(t) { vista.update(t); },
  };
}
