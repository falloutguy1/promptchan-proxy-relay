import * as THREE from 'three';
import * as TX from '../textures.js';
import { lathe, baked, mergeLoose, trs, instanced } from '../util.js';
import { M, initMaterials, roomEnv, addVista, mesh, sofa, curtain, emissiveMat, RoundedBoxGeometry, railTube } from './common.js';

// Balcony stateroom looking out over the ocean at golden hour.
export function buildStateroom(renderer) {
  initMaterials();
  const scene = new THREE.Scene();
  scene.environment = roomEnv(renderer);
  scene.environmentIntensity = 0.4;
  const vista = addVista(renderer, scene, { elev: 11, azim: 222, seaY: -24, turbidity: 4, rayleigh: 1.8, clouds: 0.45, gain: 0.45 });
  const W = 3.9, D = 6.2, H = 2.55;
  const x0 = -W / 2, x1 = W / 2, zF = -D / 2, zB = D / 2, BAL = 1.7;

  const carpet = new THREE.MeshStandardMaterial({ map: TX.carpetTexture('#3b4a5c', '#8fa3b5', '#2a3644', 'wave'), roughness: 0.95 });
  carpet.map.repeat.set(3, 4);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xece5da, roughness: 0.85 });
  const accentWall = new THREE.MeshStandardMaterial({ map: TX.woodTexture([150, 110, 78], 58), roughness: 0.55 });
  accentWall.map.repeat.set(2, 1);
  const ceil = new THREE.MeshStandardMaterial({ color: 0xf5f2ec, roughness: 0.8 });
  const warm = emissiveMat(0xffcf95, 2.4);
  const balconyDeck = new THREE.MeshStandardMaterial({ map: TX.teakTexture(), roughness: 0.6 });
  balconyDeck.map.repeat.set(0.5, 0.5);

  // ---- shell
  scene.add(mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), carpet, { cast: false }));
  scene.add(mesh(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2).translate(0, H, 0), ceil, { cast: false }));
  scene.add(mesh(baked(new THREE.PlaneGeometry(D, H), [x0, H / 2, 0], [0, Math.PI / 2, 0]), accentWall));
  scene.add(mesh(baked(new THREE.PlaneGeometry(D, H), [x1, H / 2, 0], [0, -Math.PI / 2, 0]), wallMat));
  scene.add(mesh(baked(new THREE.PlaneGeometry(W, H), [0, H / 2, zB], [0, Math.PI, 0]), wallMat));
  // soffit + cove light over the window
  scene.add(mesh(baked(new THREE.BoxGeometry(W, 0.25, 0.5), [0, H - 0.125, zF + 0.25]), ceil));
  scene.add(mesh(baked(new THREE.PlaneGeometry(W - 0.1, 0.04), [0, H - 0.27, zF + 0.52]), warm, { cast: false }));
  // cove strip along the ceiling perimeter
  scene.add(mesh(baked(new THREE.PlaneGeometry(D - 1, 0.03), [x1 - 0.02, H - 0.08, 0.2], [0, -Math.PI / 2, 0]), warm, { cast: false }));
  scene.add(mesh(baked(new THREE.PlaneGeometry(D - 1, 0.03), [x0 + 0.02, H - 0.08, 0.2], [0, Math.PI / 2, 0]), warm, { cast: false }));
  // window wall: frame + sliding doors (one open)
  {
    const frame = new THREE.MeshStandardMaterial({ color: 0xd6d9dd, metalness: 0.7, roughness: 0.3 });
    const fh = H - 0.25;
    scene.add(mesh(baked(new THREE.BoxGeometry(W, 0.08, 0.14), [0, 0.04, zF]), frame));
    scene.add(mesh(baked(new THREE.BoxGeometry(W, 0.08, 0.14), [0, fh, zF]), frame));
    for (const x of [x0 + 0.04, 0, x1 - 0.04]) scene.add(mesh(baked(new THREE.BoxGeometry(0.08, fh, 0.14), [x, fh / 2, zF]), frame));
    const pane = (x, z) => {
      const gg = new THREE.Group();
      gg.add(mesh(new THREE.PlaneGeometry(W / 2 - 0.12, fh - 0.14), M.glass, { cast: false, receive: false }));
      for (const [dx, dy, w, h] of [[0, (fh - 0.1) / 2, W / 2 - 0.08, 0.05], [0, -(fh - 0.1) / 2, W / 2 - 0.08, 0.05], [(W / 2 - 0.1) / 2, 0, 0.05, fh - 0.1], [-(W / 2 - 0.1) / 2, 0, 0.05, fh - 0.1]]) gg.add(mesh(new THREE.BoxGeometry(w, h, 0.05).translate(dx, dy, 0), frame));
      gg.position.set(x, fh / 2, z);
      scene.add(gg);
    };
    pane(-W / 4, zF - 0.03);
    pane(-W / 4 + 0.05, zF + 0.04); // right door slid across (open)
    // sheer curtains gathered at the sides
    const sheer = new THREE.MeshStandardMaterial({ color: 0xf6f1e7, roughness: 0.9, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const c1 = curtain(0.7, H - 0.3, 6, 0.06, sheer); c1.position.set(x0 + 0.4, (H - 0.3) / 2, zF + 0.3); scene.add(c1);
    const c2 = curtain(0.55, H - 0.3, 5, 0.06, sheer); c2.position.set(x1 - 0.32, (H - 0.3) / 2, zF + 0.3); scene.add(c2);
    const heavy = new THREE.MeshPhysicalMaterial({ color: 0x223a6a, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0x6a88c8), side: THREE.DoubleSide });
    const c3 = curtain(0.45, H - 0.3, 4, 0.08, heavy); c3.position.set(x0 + 0.26, (H - 0.3) / 2, zF + 0.42); scene.add(c3);
    const c4 = curtain(0.45, H - 0.3, 4, 0.08, heavy); c4.position.set(x1 - 0.26, (H - 0.3) / 2, zF + 0.42); scene.add(c4);
    scene.add(mesh(railTube([[x0 + 0.05, zF + 0.36], [x1 - 0.05, zF + 0.36]], H - 0.28, 0.015), M.chrome));
  }

  // ---- balcony: deck, dividers, glass railing, two chairs + table
  {
    scene.add(mesh(new THREE.PlaneGeometry(W, BAL).rotateX(-Math.PI / 2).translate(0, -0.05, zF - BAL / 2), balconyDeck, { cast: false }));
    const divider = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.5 });
    for (const x of [x0 - 0.05, x1 + 0.05]) scene.add(mesh(baked(new THREE.BoxGeometry(0.1, H, BAL), [x, H / 2 - 0.05, zF - BAL / 2]), divider));
    scene.add(mesh(baked(new THREE.BoxGeometry(W + 0.2, 0.2, BAL + 0.2), [0, H + 0.1, zF - BAL / 2]), divider));
    const rail = mesh(new THREE.PlaneGeometry(W, 1.0).translate(0, 0.45, zF - BAL), M.glass, { cast: false, receive: false });
    scene.add(rail);
    scene.add(mesh(railTube([[x0, zF - BAL], [x1, zF - BAL]], 1.0, 0.035), M.chrome));
    // hull edge below the balcony
    scene.add(mesh(baked(new THREE.BoxGeometry(W + 0.4, 0.3, 0.2), [0, -0.2, zF - BAL]), divider));
    const chair = new THREE.Group();
    const frameM = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.4, metalness: 0.6 });
    chair.add(mesh(new RoundedBoxGeometry(0.55, 0.06, 0.5, 2, 0.02).translate(0, 0.42, 0), M.tealFabric));
    chair.add(mesh(new RoundedBoxGeometry(0.55, 0.55, 0.05, 2, 0.02).rotateX(-0.25).translate(0, 0.72, -0.25), M.tealFabric));
    for (const [x, z] of [[-0.24, -0.2], [0.24, -0.2], [-0.24, 0.2], [0.24, 0.2]]) chair.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 6).translate(x, 0.21, z), frameM));
    for (const [x, r] of [[-0.8, 0.5], [0.8, -0.5]]) { const c = chair.clone(); c.position.set(x, -0.05, zF - 1.0); c.rotation.y = Math.PI + r; scene.add(c); }
    const tbl = new THREE.Group();
    tbl.add(mesh(lathe([[0, 0.5], [0.25, 0.5], [0.25, 0.53], [0, 0.53]], 24), frameM));
    tbl.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6).translate(0, 0.25, 0), frameM));
    tbl.position.set(0, -0.05, zF - 1.05);
    scene.add(tbl);
  }

  // ---- bed with upholstered headboard, duvet, pillows, runner and a towel animal
  {
    const bed = new THREE.Group();
    const L = 2.05, BW = 1.65;
    bed.add(mesh(new RoundedBoxGeometry(L, 0.32, BW, 2, 0.04).translate(0, 0.2, 0), M.walnut));
    // mattress + duvet with soft drape
    const duvet = new RoundedBoxGeometry(L - 0.05, 0.28, BW + 0.08, 4, 0.12);
    const p = duvet.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y > 0.1) p.setY(i, y + 0.02 * Math.sin(x * 9) * Math.cos(z * 7));
      if (Math.abs(z) > BW / 2 - 0.02 && y < 0) p.setY(i, y - 0.08);
    }
    duvet.computeVertexNormals();
    bed.add(mesh(duvet.translate(0.02, 0.5, 0), M.linen));
    // runner across the foot
    bed.add(mesh(new RoundedBoxGeometry(0.5, 0.3, BW + 0.12, 3, 0.1).translate(0.62, 0.53, 0), M.navyFabric));
    // pillows
    const pillow = new THREE.SphereGeometry(0.5, 24, 12);
    pillow.scale(0.36, 0.14, 0.62);
    for (const [z, y, r] of [[-0.38, 0.78, -0.35], [0.38, 0.78, -0.35], [-0.34, 0.74, -0.15], [0.34, 0.74, -0.15]]) {
      const m = mesh(pillow.clone(), M.linen);
      m.position.set(-0.8 + (y < 0.76 ? 0.18 : 0), y, z);
      m.rotation.z = r;
      bed.add(m);
    }
    const accentP = mesh(new THREE.SphereGeometry(0.5, 20, 10).scale(0.24, 0.16, 0.42), M.tealFabric);
    accentP.position.set(-0.46, 0.75, 0); accentP.rotation.z = -0.4; bed.add(accentP);
    // towel elephant
    const towel = new THREE.MeshStandardMaterial({ map: TX.fabricTexture([250, 250, 248], 67), roughness: 1 });
    const el = new THREE.Group();
    el.add(mesh(new THREE.SphereGeometry(0.16, 20, 14).scale(1.3, 0.85, 0.95), towel));
    const head = mesh(new THREE.SphereGeometry(0.1, 18, 12), towel); head.position.set(0.2, 0.08, 0); el.add(head);
    for (const s of [1, -1]) { const ear = mesh(new THREE.SphereGeometry(0.1, 14, 10).scale(0.3, 1, 1), towel); ear.position.set(0.18, 0.08, s * 0.1); ear.rotation.y = s * 0.4; el.add(ear); }
    const trunk = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.28, 0.06, 0), new THREE.Vector3(0.36, -0.02, 0), new THREE.Vector3(0.36, -0.12, 0)]), 12, 0.035, 8), towel); el.add(trunk);
    const eyeM = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
    for (const s of [1, -1]) { const e = mesh(new THREE.SphereGeometry(0.012, 8, 6), eyeM); e.position.set(0.28, 0.12, s * 0.05); el.add(e); }
    el.position.set(0.2, 0.78, 0); el.rotation.y = -0.2;
    bed.add(el);
    bed.position.set(x0 + L / 2 + 0.08, 0, 0.35);
    scene.add(bed);
    // tufted headboard panel on the accent wall
    const hb = new RoundedBoxGeometry(0.12, 1.1, 2.4, 3, 0.05);
    const hp = hb.getAttribute('position');
    for (let i = 0; i < hp.count; i++) if (hp.getX(i) > 0.03) {
      const y = hp.getY(i), z = hp.getZ(i);
      hp.setX(i, hp.getX(i) - 0.02 * (Math.abs(Math.sin(y * 9)) * Math.abs(Math.sin(z * 7))));
    }
    hb.computeVertexNormals();
    scene.add(mesh(baked(hb, [x0 + 0.07, 1.05, 0.35]), M.sandFabric));
    // nightstands + lamps
    for (const z of [-1.25, 1.95]) {
      scene.add(mesh(baked(new RoundedBoxGeometry(0.45, 0.55, 0.45, 2, 0.03), [x0 + 0.28, 0.275, z]), M.walnut));
      scene.add(mesh(baked(lathe([[0, 0], [0.08, 0], [0.06, 0.05], [0.025, 0.08], [0.025, 0.35], [0, 0.35]], 16), [x0 + 0.28, 0.55, z]), M.brass));
      const shade = lathe([[0.14, 0], [0.1, 0.22]], 24);
      const sm = new THREE.MeshStandardMaterial({ color: 0xfff1d8, emissive: 0xffc27a, emissiveIntensity: 1.6, side: THREE.DoubleSide, roughness: 0.9 });
      scene.add(mesh(baked(shade, [x0 + 0.28, 0.85, z]), sm, { cast: false }));
      const l = new THREE.PointLight(0xffc27a, 1.6, 4, 2);
      l.position.set(x0 + 0.32, 0.98, z);
      scene.add(l);
    }
  }

  // ---- desk, mirror, TV, loveseat, wardrobe
  {
    scene.add(mesh(baked(new RoundedBoxGeometry(0.55, 0.05, 1.5, 2, 0.02), [x1 - 0.3, 0.76, 0.9]), M.walnut));
    scene.add(mesh(baked(new RoundedBoxGeometry(0.5, 0.5, 0.45, 2, 0.02), [x1 - 0.28, 0.5, 0.35]), M.walnut));
    const mirror = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.02 });
    scene.add(mesh(baked(new THREE.PlaneGeometry(0.9, 1.0), [x1 - 0.015, 1.45, 1.2], [0, -Math.PI / 2, 0]), mirror, { cast: false }));
    const tv = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.12, metalness: 0.5 });
    scene.add(mesh(baked(new RoundedBoxGeometry(0.05, 0.62, 1.05, 2, 0.01), [x1 - 0.04, 1.55, -0.2]), tv));
    // vanity stool
    scene.add(mesh(baked(lathe([[0, 0], [0.2, 0], [0.2, 0.45], [0, 0.46]], 24), [x1 - 0.75, 0, 0.9]), M.sandFabric));
    // loveseat under the window side
    const s = sofa(1.7, M.navyFabric, { d: 0.85, seats: 2 });
    s.position.set(x1 - 0.5, 0, -1.9); s.rotation.y = -Math.PI / 2;
    scene.add(s);
    const ct = new THREE.Group();
    ct.add(mesh(lathe([[0, 0.42], [0.3, 0.42], [0.3, 0.45], [0, 0.45]], 32), M.walnut));
    ct.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8).translate(0, 0.21, 0), M.brass));
    ct.position.set(x1 - 1.35, 0, -1.9);
    scene.add(ct);
    // wardrobe with slatted doors near the entry
    const wd = new THREE.Group();
    wd.add(mesh(new THREE.BoxGeometry(0.62, H - 0.05, 1.3).translate(0, (H - 0.05) / 2, 0), M.walnut));
    for (let y = 0.2; y < H - 0.3; y += 0.09) wd.add(mesh(new THREE.BoxGeometry(0.02, 0.035, 1.24).translate(-0.32, y, 0), M.lightWood, { cast: false }));
    wd.position.set(x1 - 0.31, 0, zB - 0.8);
    scene.add(wd);
    // entry door + bathroom door
    scene.add(mesh(baked(new THREE.PlaneGeometry(0.9, 2.1), [-0.5, 1.05, zB - 0.01], [0, Math.PI, 0]), M.lightWood));
    scene.add(mesh(baked(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8), [-0.15, 1.0, zB - 0.06], [0, 0, Math.PI / 2]), M.chrome));
    // downlights
    const disk = new THREE.CircleGeometry(0.05, 16).rotateX(Math.PI / 2);
    scene.add(instanced(disk, warm, [[0, -1.5], [0, 0.5], [0, 2.4], [1.2, 0.9]].map(([x, z]) => trs([x, H - 0.005, z])), { cast: false, receive: false }));
    // wall art: abstract sea painting
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#f2c89a'); gr.addColorStop(0.45, '#e98b6b'); gr.addColorStop(0.5, '#1d4f7a'); gr.addColorStop(1, '#0c2744');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.25})`; g.fillRect(Math.random() * 512, 130 + Math.random() * 120, 30 + Math.random() * 80, 2); }
    g.fillStyle = '#ffe6b0'; g.beginPath(); g.arc(330, 112, 26, 0, Math.PI * 2); g.fill();
    const at = new THREE.CanvasTexture(c); at.colorSpace = THREE.SRGBColorSpace;
    scene.add(mesh(baked(new THREE.BoxGeometry(0.04, 0.62, 1.22), [x0 + 0.14, 1.95, 0.35]), M.brass));
    scene.add(mesh(baked(new THREE.PlaneGeometry(1.14, 0.54), [x0 + 0.165, 1.95, 0.35], [0, Math.PI / 2, 0]), new THREE.MeshStandardMaterial({ map: at, roughness: 0.6 }), { cast: false }));
  }

  // ---- lighting: low golden sun through the balcony
  const sun = new THREE.DirectionalLight(0xffc98f, 4.2);
  sun.position.copy(vista.sun).multiplyScalar(40);
  sun.position.x += 6;
  sun.target.position.set(0, 0, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 10; sc.far = 80;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xffe7cc, 0x3a2e24, 0.45));
  const fill = new THREE.PointLight(0xffe0b8, 3, 6, 2);
  fill.position.set(0.5, H - 0.3, 1.5);
  scene.add(fill);

  return {
    scene, exposure: 0.95, bloom: 0.35, bloomThreshold: 2.2,
    view: {
      pos: new THREE.Vector3(0.55, 1.6, 2.75), target: new THREE.Vector3(-0.2, 1.05, -1.2),
      minDistance: 0.6, maxDistance: 5, minPolar: 0.6, maxPolar: 1.95,
      bounds: new THREE.Box3(new THREE.Vector3(x0 + 0.25, 0.4, zF - BAL + 0.3), new THREE.Vector3(x1 - 0.25, H - 0.2, zB - 0.25)),
    },
    update(t) { vista.update(t); },
  };
}
