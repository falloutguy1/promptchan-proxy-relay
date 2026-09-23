import * as THREE from 'three';
import * as TX from '../textures.js';
import { lathe, baked, mergeLoose, trs, instanced } from '../util.js';
import { M, initMaterials, roomEnv, mesh, emissiveMat, curtain, RoundedBoxGeometry } from './common.js';

// Main-stage theatre: raked velvet seating, proscenium, LED backdrop and sweeping beams.
export function buildTheater(renderer) {
  initMaterials();
  const scene = new THREE.Scene();
  scene.environment = roomEnv(renderer);
  scene.environmentIntensity = 0.12;
  scene.background = new THREE.Color(0x030307);
  scene.fog = new THREE.FogExp2(0x07060c, 0.012);
  const W = 32, H = 13;
  const x0 = -W / 2, x1 = W / 2;
  const STAGE_Z = -9, STAGE_Y = 1.1;

  const carpet = new THREE.MeshStandardMaterial({ map: TX.carpetTexture('#121a36', '#3a5aa0', '#0a0f22', 'wave'), roughness: 0.95 });
  carpet.map.repeat.set(10, 10);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1224, roughness: 0.6, metalness: 0.2 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8b060, metalness: 1, roughness: 0.28 });
  const stageWood = new THREE.MeshPhysicalMaterial({ map: TX.woodTexture([40, 28, 22], 71), roughness: 0.3, clearcoat: 0.6 });
  stageWood.map.repeat.set(6, 3);

  // ---- raked seating in arcs
  const rows = 14, cx = 0, cz = STAGE_Z - 2;
  {
    const seat = mergeLoose([
      baked(new RoundedBoxGeometry(0.52, 0.14, 0.5, 2, 0.05), [0, 0.45, 0.02]),
      baked(new RoundedBoxGeometry(0.54, 0.72, 0.12, 2, 0.05), [0, 0.86, 0.26], [0.12, 0, 0]),
    ]);
    const arm = mergeLoose([
      baked(new THREE.BoxGeometry(0.06, 0.62, 0.52), [0.3, 0.31, 0.05]),
    ]);
    const seats = [], arms = [], steps = [], stepLights = [];
    for (let r = 0; r < rows; r++) {
      const rad = 9 + r * 1.05, y = Math.max(0, (r - 1) * 0.36);
      // tier platform
      const tier = new THREE.Shape();
      const a0 = -0.95, a1 = 0.95;
      tier.absarc(0, 0, rad + 0.55, Math.PI / 2 + a0, Math.PI / 2 + a1, false);
      tier.absarc(0, 0, rad - 0.5, Math.PI / 2 + a1, Math.PI / 2 + a0, true);
      const tg = new THREE.ExtrudeGeometry(tier, { depth: y + 0.01, bevelEnabled: false, curveSegments: 48 });
      tg.rotateX(Math.PI / 2); tg.translate(cx, y, cz);
      if (y > 0) steps.push(tg);
      const n = Math.floor(((a1 - a0) * rad) / 0.6);
      for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * (i / n);
        if (Math.abs(a) < 0.045 || Math.abs(Math.abs(a) - 0.55) < 0.035) continue; // aisles
        const px = cx + Math.sin(a) * rad, pz = cz + Math.cos(a) * rad;
        seats.push(trs([px, y, pz], [0, a, 0]));
        arms.push(trs([px, y, pz], [0, a, 0]));
      }
      for (const a of [0, 0.55, -0.55]) stepLights.push(trs([cx + Math.sin(a) * (rad - 0.4), y + 0.02, cz + Math.cos(a) * (rad - 0.4)], [0, a, 0]));
    }
    scene.add(instanced(seat, M.velvet, seats));
    scene.add(instanced(arm, new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.4, metalness: 0.6 }), arms));
    const tierMesh = new THREE.Mesh(mergeLoose(steps), carpet);
    tierMesh.receiveShadow = true;
    scene.add(tierMesh);
    scene.add(instanced(new THREE.BoxGeometry(0.5, 0.03, 0.05), emissiveMat(0x6fb8ff, 2.5), stepLights, { cast: false, receive: false }));
  }
  scene.add(mesh(new THREE.PlaneGeometry(W, 40).rotateX(-Math.PI / 2).translate(0, 0, 8), carpet, { cast: false }));

  // ---- walls with acoustic ribs + LED lines, ceiling
  {
    const side = (s) => {
      scene.add(mesh(baked(new THREE.PlaneGeometry(36, H), [s * x1, H / 2, 6], [0, -s * Math.PI / 2, 0]), wallMat));
      const ribs = [];
      for (let z = -8; z <= 22; z += 1.6) ribs.push(trs([s * (x1 - 0.2), H / 2, z], 0, [1, H, 1]));
      scene.add(instanced(new RoundedBoxGeometry(0.4, 1, 0.5, 2, 0.08), new THREE.MeshStandardMaterial({ color: 0x2a1c34, roughness: 0.5, metalness: 0.3 }), ribs));
      const leds = [];
      for (let z = -7.2; z <= 22; z += 1.6) leds.push(trs([s * (x1 - 0.45), H / 2, z], 0, [1, H - 2, 1]));
      scene.add(instanced(new THREE.BoxGeometry(0.03, 1, 0.03), emissiveMat(0xb04cff, 1.6), leds, { cast: false, receive: false }));
    };
    side(1); side(-1);
    scene.add(mesh(baked(new THREE.PlaneGeometry(W, H), [0, H / 2, 23], [0, Math.PI, 0]), wallMat));
    scene.add(mesh(new THREE.PlaneGeometry(W, 36).rotateX(Math.PI / 2).translate(0, H, 6), new THREE.MeshStandardMaterial({ color: 0x08070c, roughness: 0.9 }), { cast: false }));
    // star-field ceiling
    const stars = [];
    for (let i = 0; i < 700; i++) stars.push(trs([(Math.random() - 0.5) * W, H - 0.01, -6 + Math.random() * 29]));
    scene.add(instanced(new THREE.CircleGeometry(0.03, 6).rotateX(Math.PI / 2), emissiveMat(0xffffff, 2.5), stars, { cast: false, receive: false }));
  }

  // ---- stage, proscenium, curtains, LED backdrop
  {
    const st = new THREE.Shape();
    st.moveTo(-11, STAGE_Z - 8); st.lineTo(11, STAGE_Z - 8); st.lineTo(11, STAGE_Z + 1.5);
    st.quadraticCurveTo(0, STAGE_Z + 4.5, -11, STAGE_Z + 1.5); st.closePath();
    const sg = new THREE.ExtrudeGeometry(st, { depth: STAGE_Y, bevelEnabled: false, curveSegments: 32 });
    sg.rotateX(Math.PI / 2); sg.translate(0, STAGE_Y, 0);
    scene.add(mesh(sg, [stageWood, new THREE.MeshStandardMaterial({ color: 0x0c0a10, roughness: 0.7 })]));
    // lip lights
    const lip = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40, x = -11 + 22 * t; const z = STAGE_Z + 1.5 + 3 * (1 - (2 * t - 1) ** 2) + 0.02; lip.push(trs([x, STAGE_Y - 0.15, z])); }
    scene.add(instanced(new THREE.SphereGeometry(0.05, 8, 6), emissiveMat(0xffd7a0, 3), lip, { cast: false, receive: false }));
    // proscenium arch
    const outer = new THREE.Shape();
    outer.moveTo(x0, 0); outer.lineTo(x1, 0); outer.lineTo(x1, H); outer.lineTo(x0, H); outer.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-11, STAGE_Y); hole.lineTo(11, STAGE_Y); hole.lineTo(11, 8.2); hole.quadraticCurveTo(11, 9.6, 9, 9.6); hole.lineTo(-9, 9.6); hole.quadraticCurveTo(-11, 9.6, -11, 8.2); hole.closePath();
    outer.holes.push(hole);
    const pg = new THREE.ExtrudeGeometry(outer, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3, curveSegments: 20 });
    pg.translate(0, 0, STAGE_Z + 0.7);
    scene.add(mesh(pg, [wallMat, gold]));
    // gilded frame trim
    const trimPts = [[-11.3, STAGE_Y], [-11.3, 8.2], [-11.2, 9.1], [-10.2, 9.8], [-9, 9.9], [9, 9.9], [10.2, 9.8], [11.2, 9.1], [11.3, 8.2], [11.3, STAGE_Y]].map(([x, y]) => new THREE.Vector3(x, y, STAGE_Z + 1.62));
    scene.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trimPts, false, 'catmullrom', 0.2), 200, 0.16, 12), gold));
    scene.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trimPts.map((p) => p.clone().multiplyScalar(1).setX(p.x * 1.035).setY(p.y + (p.y > 5 ? 0.3 : 0))), false, 'catmullrom', 0.2), 200, 0.07, 8), gold));
    // main curtain: swagged to the sides, valance on top
    const velvet = new THREE.MeshPhysicalMaterial({ color: 0x86101f, roughness: 0.8, sheen: 1, sheenColor: new THREE.Color(0xff4a60), sheenRoughness: 0.4, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const c = curtain(3.2, 8.4, 9, 0.14, velvet);
      const p = c.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), x = p.getX(i);
        const pinch = 1 - 0.55 * Math.exp(-((y + 1.2) ** 2) * 0.6);
        p.setX(i, x * pinch + s * (1 - pinch) * 1.2);
      }
      c.geometry.computeVertexNormals();
      c.position.set(s * 9.6, STAGE_Y + 4.2, STAGE_Z + 0.2);
      scene.add(c);
    }
    const val = curtain(22, 1.4, 34, 0.16, velvet);
    val.position.set(0, 8.9, STAGE_Z + 0.35); scene.add(val);
    // LED wall shader backdrop
    const ledMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float t;
        void main(){
          vec2 p=vUv*vec2(3.0,1.4);
          float a=sin(p.x*2.2+t*0.6+sin(p.y*3.0+t*0.4)*1.5);
          float b=sin(p.y*5.0-t*0.8+cos(p.x*1.7-t*0.3)*2.0);
          vec3 c1=vec3(0.05,0.35,0.9), c2=vec3(0.95,0.25,0.55), c3=vec3(0.1,0.9,0.85);
          vec3 c=mix(c1,c2,0.5+0.5*a); c=mix(c,c3,smoothstep(0.4,1.0,b)*0.6);
          c*=0.55+0.45*smoothstep(0.0,0.4,vUv.y);
          vec2 g=fract(vUv*vec2(220.0,90.0)); float pix=smoothstep(0.0,0.18,g.x)*smoothstep(0.0,0.18,g.y);
          gl_FragColor=vec4(c*(0.7+0.3*pix)*1.6,1.0);
        }`,
      toneMapped: false,
    });
    scene.add(mesh(new THREE.PlaneGeometry(20, 8.2).translate(0, STAGE_Y + 4.1, STAGE_Z - 6.8), ledMat, { cast: false, receive: false }));
    scene.userData.led = ledMat;
    // stage floor sheen & set pieces: sweeping staircase silhouettes
    const tread = new RoundedBoxGeometry(5, 0.28, 0.9, 2, 0.05);
    const tr = [];
    for (let i = 0; i < 6; i++) { tr.push(trs([-5.5, STAGE_Y + 0.14 + i * 0.28, STAGE_Z - 1.2 - i * 0.8])); tr.push(trs([5.5, STAGE_Y + 0.14 + i * 0.28, STAGE_Z - 1.2 - i * 0.8])); }
    scene.add(instanced(tread, new THREE.MeshPhysicalMaterial({ color: 0x151520, roughness: 0.2, clearcoat: 1 }), tr));
    const edgeLeds = tr.map((m) => { const p = new THREE.Vector3().setFromMatrixPosition(m); return trs([p.x, p.y + 0.145, p.z + 0.45]); });
    scene.add(instanced(new THREE.BoxGeometry(4.9, 0.02, 0.02), emissiveMat(0xffffff, 2.2), edgeLeds, { cast: false, receive: false }));
  }

  // ---- lighting truss with moving heads + volumetric beams
  const beams = [];
  {
    const truss = mergeLoose([
      baked(new THREE.CylinderGeometry(0.05, 0.05, 22, 6), [0, 0.3, 0.3], [0, 0, Math.PI / 2]),
      baked(new THREE.CylinderGeometry(0.05, 0.05, 22, 6), [0, 0.3, -0.3], [0, 0, Math.PI / 2]),
      baked(new THREE.CylinderGeometry(0.05, 0.05, 22, 6), [0, -0.3, 0.3], [0, 0, Math.PI / 2]),
      baked(new THREE.CylinderGeometry(0.05, 0.05, 22, 6), [0, -0.3, -0.3], [0, 0, Math.PI / 2]),
    ]);
    const tm = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.8, roughness: 0.35 });
    for (const z of [STAGE_Z + 3, STAGE_Z - 3]) scene.add(mesh(baked(truss, [0, 10.8, z]), tm, { cast: false }));
    const beamMat = (col) => new THREE.ShaderMaterial({
      uniforms: { col: { value: new THREE.Color(col) }, k: { value: 1 } },
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY=uv.y; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 col; uniform float k; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float rim=pow(abs(dot(vN,vV)),1.5); float a=pow(vY,1.6)*rim*0.35*k; gl_FragColor=vec4(col*a,a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    const colors = [0x6ab8ff, 0xff4fa0, 0xffffff, 0x7affd8, 0xff4fa0, 0x6ab8ff, 0xffffff, 0x7affd8];
    const cone = new THREE.CylinderGeometry(0.12, 1.6, 12, 32, 1, true).translate(0, -6, 0);
    const head = mergeLoose([baked(new RoundedBoxGeometry(0.4, 0.5, 0.4, 2, 0.08), [0, 0, 0])]);
    const lens = new THREE.CircleGeometry(0.14, 16).rotateX(Math.PI / 2).translate(0, -0.26, 0);
    colors.forEach((c, i) => {
      const pivot = new THREE.Group();
      pivot.position.set(-9 + i * (18 / 7), 10.3, i % 2 ? STAGE_Z + 3 : STAGE_Z - 3);
      pivot.add(mesh(head, tm, { cast: false }));
      pivot.add(mesh(lens, emissiveMat(c, 4), { cast: false }));
      const b = new THREE.Mesh(cone, beamMat(c));
      b.renderOrder = 5;
      pivot.add(b);
      pivot.userData = { ph: i * 0.8, base: i % 2 ? 0.35 : -0.35 };
      scene.add(pivot);
      beams.push(pivot);
    });
  }
  // stage wash lights
  const spotA = new THREE.SpotLight(0xffd9b0, 260, 30, 0.5, 0.6, 1.6);
  spotA.position.set(0, 12, 6); spotA.target.position.set(0, STAGE_Y, STAGE_Z - 2);
  spotA.castShadow = true; spotA.shadow.mapSize.set(1024, 1024); spotA.shadow.bias = -0.0005;
  scene.add(spotA, spotA.target);
  const spotB = new THREE.SpotLight(0x7a5cff, 140, 30, 0.6, 0.8, 1.6);
  spotB.position.set(-12, 9, -2); spotB.target.position.set(0, STAGE_Y, STAGE_Z - 3);
  scene.add(spotB, spotB.target);
  const spotC = new THREE.SpotLight(0xff4f8a, 140, 30, 0.6, 0.8, 1.6);
  spotC.position.set(12, 9, -2); spotC.target.position.set(0, STAGE_Y, STAGE_Z - 3);
  scene.add(spotC, spotC.target);
  scene.add(new THREE.HemisphereLight(0x3a2a60, 0x0a0608, 0.35));
  const house = new THREE.PointLight(0xff9a60, 30, 30, 1.8); house.position.set(0, 9, 12); scene.add(house);

  return {
    scene, exposure: 1.0, bloom: 0.9,
    view: {
      pos: new THREE.Vector3(3.2, 7.4, 14.5), target: new THREE.Vector3(0, 4.4, -8.5),
      minDistance: 4, maxDistance: 24, minPolar: 0.6, maxPolar: 1.7,
      bounds: new THREE.Box3(new THREE.Vector3(x0 + 1, 1.5, -6), new THREE.Vector3(x1 - 1, H - 1, 21)),
    },
    update(t) {
      scene.userData.led.uniforms.t.value = t;
      beams.forEach((b) => {
        const d = b.userData;
        b.rotation.z = d.base + Math.sin(t * 0.7 + d.ph) * 0.45;
        b.rotation.x = 0.35 + Math.sin(t * 0.5 + d.ph * 1.3) * 0.3;
      });
    },
  };
}
