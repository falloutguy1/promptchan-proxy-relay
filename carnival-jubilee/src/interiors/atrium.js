import * as THREE from 'three';
import * as TX from '../textures.js';
import { lathe, baked, mergeLoose, trs, instanced, rng } from '../util.js';
import { M, initMaterials, roomEnv, addVista, ribbon, railTube, mesh, sofa, armchair, coffeeTable, pottedPalm, chandelier, recessedLights, emissiveMat, RoundedBoxGeometry } from './common.js';

// Grand Central: a three-deck atrium with a full-height window wall to the sea.
export function buildAtrium(renderer) {
  initMaterials();
  const scene = new THREE.Scene();
  scene.environment = roomEnv(renderer);
  scene.environmentIntensity = 0.55;
  const vista = addVista(renderer, scene, { elev: 18, azim: 238, seaY: -18, gain: 0.38 });
  const R = rng(4);
  const W = 36, D = 28, H = 14, L1 = 4.7, L2 = 9.4;
  const x0 = -W / 2, x1 = W / 2, zF = -D / 2, zB = D / 2;

  const marbleMap = TX.marbleTexture(31, [238, 234, 228], [150, 132, 110], 2);
  marbleMap.repeat.set(3, 3);
  const floor = new THREE.MeshPhysicalMaterial({ map: marbleMap, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1 });
  const darkMarbleMap = TX.marbleTexture(33, [36, 40, 46], [190, 170, 130], 1.5);
  const darkMarble = new THREE.MeshPhysicalMaterial({ map: darkMarbleMap, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  const wallPanel = new THREE.MeshStandardMaterial({ map: TX.woodTexture([120, 82, 56], 55), roughness: 0.5 });
  wallPanel.map.repeat.set(4, 1);
  const carpet = new THREE.MeshStandardMaterial({ map: TX.carpetTexture('#1b2b52', '#c9a55a', '#0d1630', 'wave'), roughness: 0.95 });
  carpet.map.repeat.set(6, 6);
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf3efe8, roughness: 0.7 });
  const warmGlow = emissiveMat(0xffc987, 3);
  const coolGlow = emissiveMat(0x9fd8ff, 2.2);

  // ---- floor with an inlaid compass-rose medallion
  scene.add(mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), floor, { cast: false }));
  {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const g = c.getContext('2d');
    g.translate(512, 512);
    const ring = (r, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
    g.fillStyle = '#1b2b52'; g.beginPath(); g.arc(0, 0, 500, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e9e3d8'; g.beginPath(); g.arc(0, 0, 440, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 16; i++) {
      g.save(); g.rotate(i * Math.PI / 8);
      g.fillStyle = i % 2 ? '#c9a55a' : '#1b2b52';
      const L = i % 2 ? 300 : 420;
      g.beginPath(); g.moveTo(0, -L); g.lineTo(i % 2 ? 26 : 44, 0); g.lineTo(0, 60); g.lineTo(i % 2 ? -26 : -44, 0); g.fill();
      g.restore();
    }
    ring(470, '#c9a55a', 14); ring(440, '#1b2b52', 6); ring(120, '#c9a55a', 10);
    g.fillStyle = '#d51f36'; g.beginPath(); g.arc(0, 0, 60, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const m = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.06 });
    scene.add(mesh(new THREE.CircleGeometry(4.2, 96).rotateX(-Math.PI / 2).translate(0, 0.004, -1), m, { cast: false }));
  }

  // ---- walls (sides + back), window wall at the front
  const wallGeo = (w, h) => new THREE.PlaneGeometry(w, h);
  scene.add(mesh(baked(wallGeo(D, H), [x0, H / 2, 0], [0, Math.PI / 2, 0]), wallPanel));
  scene.add(mesh(baked(wallGeo(D, H), [x1, H / 2, 0], [0, -Math.PI / 2, 0]), wallPanel));
  scene.add(mesh(baked(wallGeo(W, H), [0, H / 2, zB], [0, Math.PI, 0]), wallPanel));
  // window wall: mullion grid + faint glass
  {
    const mull = [];
    for (let x = x0; x <= x1 + 0.01; x += 3) mull.push(trs([x, H / 2, zF], 0, [1, H, 1]));
    const trans = [];
    for (let y = 0; y <= H + 0.01; y += 3.5) trans.push(trs([0, y, zF], 0, [W, 1, 1]));
    scene.add(instanced(new THREE.BoxGeometry(0.16, 1, 0.3), M.chrome, mull));
    scene.add(instanced(new THREE.BoxGeometry(1, 0.14, 0.3), M.chrome, trans));
    const g = mesh(new THREE.PlaneGeometry(W, H).translate(0, H / 2, zF), M.glass, { cast: false, receive: false });
    g.renderOrder = 3;
    scene.add(g);
    // window bench planter
    scene.add(mesh(baked(new RoundedBoxGeometry(W - 1, 0.5, 1.1, 2, 0.1), [0, 0.25, zF + 0.9]), darkMarble));
    for (let x = -15; x <= 15; x += 2.2) {
      const tuft = new THREE.IcosahedronGeometry(0.42, 1);
      scene.add(mesh(baked(tuft, [x, 0.7, zF + 0.9], [R(), R(), R()], [1.2, 0.7, 0.9]), new THREE.MeshStandardMaterial({ color: 0x2e6a37, roughness: 0.85, flatShading: true })));
    }
  }
  // exterior deck visible past the glass
  scene.add(mesh(new THREE.PlaneGeometry(W + 20, 10).rotateX(-Math.PI / 2).translate(0, -0.01, zF - 5), new THREE.MeshStandardMaterial({ map: TX.teakTexture(), roughness: 0.6 }), { cast: false }));
  {
    const g = mesh(new THREE.PlaneGeometry(W + 20, 1.1).translate(0, 0.55, zF - 9.5), M.glass, { cast: false, receive: false });
    scene.add(g);
    scene.add(mesh(railTube([[-28, zF - 9.5], [28, zF - 9.5]], 1.12, 0.04), M.chrome));
  }

  // ---- galleries (U-shaped mezzanines) with glass balustrades, brass rails and LED coves
  const galleryShape = () => {
    const s = new THREE.Shape();
    s.moveTo(x0, zF + 3); s.lineTo(-12.8, zF + 3);
    s.bezierCurveTo(-11.6, zF + 3.2, -11.6, zF + 5, -11.8, zF + 7);
    s.lineTo(-11.8, 5.5); s.quadraticCurveTo(-11.8, 8.8, -8.5, 8.8);
    s.lineTo(8.5, 8.8); s.quadraticCurveTo(11.8, 8.8, 11.8, 5.5);
    s.lineTo(11.8, zF + 7); s.bezierCurveTo(11.6, zF + 5, 11.6, zF + 3.2, 12.8, zF + 3);
    s.lineTo(x1, zF + 3); s.lineTo(x1, zB); s.lineTo(x0, zB); s.closePath();
    return s;
  };
  const edge = [];
  {
    const s = galleryShape();
    const pts = s.getPoints(24).map((p) => [p.x, p.y]);
    // inner edge = points whose |x| < 12.9 or z near the inner curve
    for (const p of pts) if (Math.abs(p[0]) < 12.85 && p[1] < 8.81) edge.push(p);
  }
  const fascia = new THREE.MeshStandardMaterial({ color: 0xece6db, roughness: 0.35 });
  for (const y of [L1, L2]) {
    const slab = new THREE.ExtrudeGeometry(galleryShape(), { depth: 0.6, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 24 });
    slab.rotateX(Math.PI / 2);
    slab.translate(0, y, 0);
    const m = new THREE.Mesh(slab, [carpet, fascia]);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    // glass balustrade
    const gl = mesh(ribbon(edge.map(([x, z]) => [x * 0.985, z - 0.12]), y + 0.05, y + 1.1), M.glass, { cast: false, receive: false });
    gl.renderOrder = 3;
    scene.add(gl);
    scene.add(mesh(railTube(edge.map(([x, z]) => [x * 0.985, z - 0.12]), y + 1.12, 0.04), M.brass, { cast: false }));
    // warm LED cove under the slab edge
    scene.add(mesh(ribbon(edge.map(([x, z]) => [x * 1.0, z + 0.02]), y - 0.66, y - 0.6), warmGlow, { cast: false, receive: false }));
    // gold trim band
    scene.add(mesh(ribbon(edge.map(([x, z]) => [x * 1.003, z + 0.03]), y - 0.3, y - 0.22), M.brass, { cast: false }));
    // gallery-level lounge chairs
    for (let x = -16; x <= 16; x += 3.2) {
      if (Math.abs(x) < 12.5) continue;
      for (let z = zF + 5; z < zB - 2; z += 3.4) {
        const a = armchair(R() > 0.5 ? M.tealFabric : M.sandFabric);
        a.position.set(x, y, z); a.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
        scene.add(a);
      }
    }
    // shop / bar frontage lights on gallery back wall
    scene.add(mesh(ribbon([[x0 + 0.02, zF + 3], [x0 + 0.02, zB]], y + 2.8, y + 2.86), coolGlow, { cast: false, receive: false }));
    scene.add(mesh(ribbon([[x1 - 0.02, zB], [x1 - 0.02, zF + 3]], y + 2.8, y + 2.86), coolGlow, { cast: false, receive: false }));
  }

  // ---- columns
  {
    const colGeo = mergeLoose([
      lathe([[0, 0], [0.62, 0], [0.62, 0.25], [0.5, 0.35], [0.46, 0.4], [0.46, H - 0.6], [0.54, H - 0.45], [0.66, H - 0.3], [0.66, H], [0, H]], 32),
    ]);
    const ringGeo = new THREE.TorusGeometry(0.48, 0.05, 8, 40).rotateX(Math.PI / 2);
    const cols = [], rings = [];
    for (const x of [-12.4, 12.4]) for (const z of [-8, -1, 6]) {
      cols.push(trs([x, 0, z]));
      for (const y of [1.2, L1 - 0.7, L1 + 1.2, L2 - 0.7, L2 + 1.2, H - 0.7]) rings.push(trs([x, y, z]));
    }
    scene.add(instanced(colGeo, darkMarble, cols));
    scene.add(instanced(ringGeo, M.brass, rings, { cast: false }));
  }

  // ---- ceiling: coffers with an elliptical light-well
  {
    scene.add(mesh(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2).translate(0, H, 0), ceilMat, { cast: false }));
    const beams = [];
    for (let x = x0; x <= x1; x += 3) beams.push(trs([x, H - 0.25, 0], 0, [1, 1, D]));
    for (let z = zF; z <= zB; z += 3) beams.push(trs([0, H - 0.25, z], 0, [W, 1, 1]));
    scene.add(instanced(new THREE.BoxGeometry(0.28, 0.5, 0.28), ceilMat, beams.map((m, i) => m), { cast: false }));
    const well = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(Math.PI / 2).scale(7, 1, 5).translate(0, H - 0.52, -1), emissiveMat(0xfff1d8, 1.25));
    scene.add(well);
    scene.add(mesh(new THREE.TorusGeometry(1, 0.03, 8, 96).rotateX(Math.PI / 2).scale(7.1, 1, 5.1).translate(0, H - 0.54, -1), M.brass, { cast: false }));
    const pts = [];
    for (let x = x0 + 1.5; x < x1; x += 3) for (let z = zF + 1.5; z < zB; z += 3) {
      if (((x / 7) ** 2 + ((z + 1) / 5) ** 2) < 1.2) continue;
      pts.push([x, z]);
    }
    scene.add(recessedLights(pts, H - 0.52, warmGlow, 0.12));
    // gallery ceilings downlights
    const gpts = [];
    for (const y of [L1, L2]) for (let z = zF + 5; z < zB; z += 2.6) for (const x of [-15.5, 15.5]) gpts.push([x, z, y]);
    const disk = new THREE.CircleGeometry(0.08, 12).rotateX(Math.PI / 2);
    scene.add(instanced(disk, warmGlow, gpts.map(([x, z, y]) => trs([x, y - 0.62, z])), { cast: false, receive: false }));
  }

  // ---- chandelier
  const chand = chandelier({ rings: 6, radius: 3.4, drop: 3.2, rodLen: 1.2, seed: 7 });
  chand.position.set(0, H - 0.6, -1);
  chand.children.forEach((c) => { if (c.geometry && c.geometry.parameters && c.geometry.parameters.height === 3) c.visible = false; });
  scene.add(chand);

  // ---- curved bar with backlit shelves
  {
    const cx = 0, cz = zB, r0 = 6.2, r1 = 7.1, a0 = Math.PI * 1.12, a1 = Math.PI * 1.88;
    const s = new THREE.Shape();
    s.absarc(cx, 0, r1, a0, a1, false);
    s.absarc(cx, 0, r0, a1, a0, true);
    const base = new THREE.ExtrudeGeometry(s, { depth: 1.05, bevelEnabled: false, curveSegments: 48 });
    base.rotateX(Math.PI / 2); base.translate(0, 1.05, cz);
    scene.add(mesh(base, M.darkWood));
    const s2 = new THREE.Shape();
    s2.absarc(cx, 0, r1 + 0.12, a0 - 0.02, a1 + 0.02, false);
    s2.absarc(cx, 0, r0 - 0.1, a1 + 0.02, a0 - 0.02, true);
    const top = new THREE.ExtrudeGeometry(s2, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 48 });
    top.rotateX(Math.PI / 2); top.translate(0, 1.13, cz);
    scene.add(mesh(top, darkMarble));
    // LED kick line
    const kick = [];
    for (let i = 0; i <= 48; i++) { const a = a0 + (a1 - a0) * (i / 48); kick.push([Math.cos(a) * (r1 + 0.01), cz + Math.sin(a) * (r1 + 0.01)]); }
    scene.add(mesh(ribbon(kick, 0.06, 0.1), warmGlow, { cast: false, receive: false }));
    // bar stools
    const stool = mergeLoose([
      lathe([[0, 0], [0.24, 0], [0.24, 0.02], [0.03, 0.04], [0.03, 0.72], [0, 0.72]], 20),
      new THREE.TorusGeometry(0.17, 0.012, 6, 20).rotateX(Math.PI / 2).translate(0, 0.3, 0),
    ]);
    const seat = lathe([[0, 0.72], [0.2, 0.72], [0.22, 0.76], [0.2, 0.8], [0, 0.81]], 24);
    const sm = [];
    for (let i = 0; i < 11; i++) {
      const a = a0 + 0.08 + (a1 - a0 - 0.16) * (i / 10);
      sm.push(trs([Math.cos(a) * (r1 + 0.55), 0, cz + Math.sin(a) * (r1 + 0.55)]));
    }
    scene.add(instanced(stool, M.brass, sm));
    scene.add(instanced(seat, M.navyFabric, sm));
    // back bar: glowing shelves with bottles
    const bb = mesh(new THREE.PlaneGeometry(10, 3.4).translate(0, 2.4, zB - 0.02).rotateY(0), emissiveMat(0xffb566, 0.9), { cast: false, receive: false });
    bb.rotation.y = Math.PI; bb.position.z = 2 * zB - 0.04;
    scene.add(bb);
    const bottle = lathe([[0, 0], [0.06, 0], [0.065, 0.02], [0.065, 0.2], [0.03, 0.27], [0.018, 0.3], [0.018, 0.36], [0, 0.36]], 12);
    const bottles = [], bcol = [];
    const palette = [0x3d7a3a, 0x7a4a1a, 0xd9d0b0, 0x2a4a8a, 0x8a1a2a, 0xc0a040];
    for (const y of [1.3, 2.05, 2.8]) {
      scene.add(mesh(baked(new THREE.BoxGeometry(10, 0.05, 0.4), [0, y - 0.03, zB - 0.25]), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05 }), { cast: false }));
      for (let x = -4.8; x <= 4.8; x += 0.19) {
        if (R() < 0.12) continue;
        bottles.push(trs([x, y, zB - 0.25 + (R() - 0.5) * 0.1], 0, [1, 0.9 + R() * 0.35, 1]));
        bcol.push(new THREE.Color(palette[(R() * palette.length) | 0]));
      }
    }
    scene.add(instanced(bottle, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.08, transparent: true, opacity: 0.85, clearcoat: 1 }), bottles, { colors: bcol, cast: false }));
  }

  // ---- lounge groupings on rugs
  {
    const rugMat = new THREE.MeshStandardMaterial({ map: TX.carpetTexture('#233a6e', '#d6b46a', '#12204a', 'medallion'), roughness: 1 });
    rugMat.map.repeat.set(1.5, 1);
    const groups = [[-7, -6.5, 0.2], [7.2, -6, -0.2], [-7.5, 3.2, 0]];
    groups.forEach(([x, z, r], i) => {
      const grp = new THREE.Group();
      grp.add(mesh(new THREE.PlaneGeometry(6, 4.2).rotateX(-Math.PI / 2).translate(0, 0.006, 0), rugMat, { cast: false }));
      const s = sofa(2.8, i % 2 ? M.navyFabric : M.tealFabric);
      s.position.set(0, 0, -1.4); grp.add(s);
      const a1 = armchair(M.sandFabric); a1.position.set(-2, 0, 0.5); a1.rotation.y = Math.PI * 0.62; grp.add(a1);
      const a2 = armchair(M.sandFabric); a2.position.set(2, 0, 0.5); a2.rotation.y = -Math.PI * 0.62; grp.add(a2);
      const t = coffeeTable(0.62, darkMarble); t.position.set(0, 0, 0); grp.add(t);
      grp.position.set(x, 0, z); grp.rotation.y = r;
      scene.add(grp);
    });
    for (const [x, z, s] of [[-16.5, zF + 2.2, 1.3], [16.5, zF + 2.2, 1.3], [-11, 8, 1.1], [11, 8, 1.1], [-16.5, 12.5, 1.2], [16.5, 12.5, 1.2]]) {
      const p = pottedPalm(s, x * 7 + z);
      p.position.set(x, 0, z);
      scene.add(p);
    }
  }

  // ---- grand piano on a round stage
  {
    const stage = lathe([[0, 0], [2.6, 0], [2.6, 0.22], [2.55, 0.25], [0, 0.25]], 64);
    const st = mesh(stage, darkMarble); st.position.set(0, 0, 4.2); scene.add(st);
    scene.add(mesh(new THREE.TorusGeometry(2.6, 0.02, 6, 96).rotateX(Math.PI / 2).translate(0, 0.12, 4.2), warmGlow, { cast: false }));
    const outline = new THREE.Shape();
    outline.moveTo(-0.75, 0); outline.lineTo(0.75, 0); outline.lineTo(0.75, 0.9);
    outline.bezierCurveTo(0.75, 1.5, 0.2, 1.6, 0.15, 2.0); outline.bezierCurveTo(0.1, 2.5, -0.2, 2.6, -0.45, 2.55);
    outline.bezierCurveTo(-0.7, 2.5, -0.75, 2.2, -0.75, 1.8); outline.closePath();
    const body = new THREE.ExtrudeGeometry(outline, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 32 });
    body.rotateX(Math.PI / 2); body.translate(0, 1.0, 0);
    const piano = new THREE.Group();
    piano.add(mesh(body, M.pianoBlack));
    const lid = new THREE.ExtrudeGeometry(outline, { depth: 0.02, bevelEnabled: false, curveSegments: 32 });
    lid.rotateX(Math.PI / 2);
    const lidM = mesh(lid, M.pianoBlack); lidM.position.set(0.75, 1.02, 0); lidM.rotation.z = 0.7; lidM.position.x = 0.75;
    const lidG = new THREE.Group(); lidG.position.set(0.75, 1.0, 0); lidM.position.set(-0.75, 0, 0); lidG.add(lidM); lidG.rotation.z = 0.55;
    piano.add(lidG);
    const keys = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.03, 0.16), new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.3 }));
    keys.position.set(0, 0.78, -0.08); piano.add(keys);
    for (const [x, z] of [[-0.65, 0.05], [0.65, 0.05], [-0.4, 2.3]]) piano.add(mesh(baked(new THREE.CylinderGeometry(0.05, 0.04, 0.64, 10), [x, 0.32, z]), M.pianoBlack));
    const bench = mesh(new RoundedBoxGeometry(0.9, 0.08, 0.36, 2, 0.02), M.velvet); bench.position.set(0, 0.5, -0.5); piano.add(bench);
    piano.position.set(0.3, 0.25, 3.2); piano.rotation.y = 0.35;
    piano.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(piano);
  }

  // ---- grand staircase up to the first gallery (right side)
  {
    const steps = [], n = 26;
    const cx = 8.3, cz = 1.2, r = 3.2;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 0.95 - (i / n) * Math.PI * 0.95;
      const y = (i + 1) * (L1 / (n + 0.5));
      steps.push(trs([cx + Math.cos(a) * r, y - 0.09, cz + Math.sin(a) * r], [0, Math.PI / 2 - a, 0]));
    }
    scene.add(instanced(new RoundedBoxGeometry(0.42, 0.18, 2.0, 2, 0.03), darkMarble, steps));
    const railOuter = [], railInner = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, a = Math.PI * 0.95 - t * Math.PI * 0.95;
      railOuter.push(new THREE.Vector3(cx + Math.cos(a) * (r + 1), t * L1 + 1.0, cz + Math.sin(a) * (r + 1)));
      railInner.push(new THREE.Vector3(cx + Math.cos(a) * (r - 1), t * L1 + 1.0, cz + Math.sin(a) * (r - 1)));
    }
    for (const rail of [railOuter, railInner]) {
      scene.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail), 120, 0.035, 8), M.brass, { cast: false }));
      // glass panels following the rake
      const pos = [], idx = [];
      rail.forEach((p, i) => { pos.push(p.x, p.y - 0.95, p.z, p.x, p.y - 0.03, p.z); if (i) { const a = (i - 1) * 2, b = i * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); } });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const gm = mesh(g, M.glass, { cast: false, receive: false }); gm.renderOrder = 3; scene.add(gm);
    }
  }

  // ---- lighting
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
  sun.position.copy(vista.sun).multiplyScalar(60).add(new THREE.Vector3(0, 0, -20));
  sun.position.set(-48, 30, -44);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 20; sc.far = 120;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x4a3a2a, 0.55));
  const chandLight = new THREE.PointLight(0xffc98a, 90, 30, 1.6);
  chandLight.position.set(0, H - 3, -1);
  scene.add(chandLight);
  const barLight = new THREE.PointLight(0xffb060, 40, 14, 1.8);
  barLight.position.set(0, 3, zB - 3);
  scene.add(barLight);

  return {
    scene,
    exposure: 0.9,
    bloom: 0.45, bloomThreshold: 1.8,
    view: {
      pos: new THREE.Vector3(2.5, 6.6, 12.6), target: new THREE.Vector3(-0.5, 6.4, -5),
      minDistance: 2, maxDistance: 20, minPolar: 0.35, maxPolar: 1.72, bounds: new THREE.Box3(new THREE.Vector3(x0 + 0.8, 0.8, zF + 1), new THREE.Vector3(x1 - 0.8, H - 1.2, zB - 0.8)),
    },
    update(t) {
      vista.update(t);
      chand.rotation.y = t * 0.03;
    },
  };
}
