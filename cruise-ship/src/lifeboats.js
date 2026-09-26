import * as THREE from 'three';
import { procMaterial } from './procmat.js';
import { gridGeo, box } from './geom.js';
import * as D from './dims.js';

const BOAT = /* glsl */`
float lineCov(float d, float hw, float px){ float w = max(hw, px); return (1.0 - smoothstep(w - px, w + px, abs(d))) * clamp(hw / px, 0.0, 1.0); }
void surface(vec3 p, vec3 n, float s, inout vec3 alb, inout float rgh, inout float mtl, inout vec3 emi, inout float bump, inout float ao){
  float px = max(length(fwidth(p)) * 0.7, 1e-4);
  float t = p.x / 6.2;
  float yg = 1.45 + 0.25 * t * t;
  float hullPart = 1.0 - smoothstep(yg + 0.12 - px, yg + 0.12 + px, p.y);
  vec3 orange = vec3(0.95, 0.16, 0.012);
  vec3 col = mix(orange * (0.95 + 0.08 * vnoise(p.xz * 2.0)), vec3(0.80, 0.80, 0.78), hullPart);
  float strake = lineCov(p.y - yg - 0.02, 0.07, px);
  col = mix(col, vec3(0.05), strake * 0.85);
  // windows along the canopy sides
  float side = smoothstep(0.45, 0.7, abs(n.z));
  float cx = (fract((p.x + 10.0) / 0.92) - 0.5) * 0.92;
  float d = sdRBox(vec2(cx, p.y - (yg + 0.74)), vec2(0.3, 0.17), 0.06);
  float win = fillAA(d, px) * side * step(-4.3, p.x) * step(p.x, 4.2) * step(p.y, 3.0);
  col = mix(col, vec3(0.015, 0.018, 0.022), win);
  // top hatches
  float top = smoothstep(0.7, 0.9, n.y);
  float hd = sdRBox(vec2(fract((p.x + 10.0) / 3.1) - 0.5, p.z / 3.1), vec2(0.18, 0.1), 0.03);
  col = mix(col, col * 0.72, fillAA(abs(hd) - 0.006, px / 3.1) * top);
  // waterline boot
  col = mix(col, vec3(0.05, 0.06, 0.08), 1.0 - smoothstep(0.35 - px, 0.35 + px, p.y));
  alb = col;
  rgh = mix(0.32, 0.05, win);
  mtl = 0.0;
  bump = -min(0.02, px * 0.5) * win;
  emi += vec3(1.0, 0.7, 0.4) * 0.35 * uNight * win;
}`;

function boatGeometry() {
  const nx = 30;
  const rows = [];
  for (let i = 0; i <= nx; i++) {
    const u = (i / nx) * 2 - 1;
    const t = Math.sign(u) * Math.pow(Math.abs(u), 0.85);
    const x = t * 6.2;
    const fine = 1 - 0.14 * Math.max(t, 0) ** 2;
    const w = Math.max(0.03, 2.15 * Math.pow(Math.max(0, 1 - Math.abs(t) ** 2.4), 0.55) * fine);
    const yb = 0.35 * Math.abs(t) ** 3;
    const yt = 3.25 - 0.55 * t * t;
    const yg = 1.45 + 0.25 * t * t;
    const H = yt - yg;
    const prof = [
      [0, yb], [0.5, yb + 0.1], [0.86, yb + 0.5], [0.99, yg - 0.3], [1.02, yg], [1.0, yg + 0.12],
      [0.97, yg + 0.5 * H], [0.88, yg + 0.75 * H], [0.66, yt - 0.11 * H], [0.32, yt - 0.02 * H], [0, yt],
    ];
    rows.push(prof.map(([zn, y]) => [x, y, zn * w]));
  }
  const build = (flip) => {
    const star = gridGeo(rows, flip);
    const port = gridGeo(rows.map((r) => r.map((p) => [p[0], p[1], -p[2]])), !flip);
    return [star, port];
  };
  let [star, port] = build(false);
  const nIdx = 15 * 11 + 4;
  if (star.attributes.normal.array[nIdx * 3 + 2] < 0) [star, port] = build(true);
  return mergeTwo(star, port);
}

function mergeTwo(a, b) {
  const pa = a.toNonIndexed(), pb = b.toNonIndexed();
  const pos = new Float32Array(pa.attributes.position.count * 3 + pb.attributes.position.count * 3);
  pos.set(pa.attributes.position.array, 0); pos.set(pb.attributes.position.array, pa.attributes.position.array.length);
  const nor = new Float32Array(pos.length);
  nor.set(pa.attributes.normal.array, 0); nor.set(pb.attributes.normal.array, pa.attributes.normal.array.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

export function buildLifeboats(boats) {
  const g = boatGeometry();
  // cockpit
  const ck = new THREE.BoxGeometry(1.7, 0.6, 1.6, 1, 1, 1).toNonIndexed();
  ck.translate(-3.7, 3.2, 0);
  const merged = new THREE.BufferGeometry();
  const pos = new Float32Array(g.attributes.position.array.length + ck.attributes.position.array.length);
  pos.set(g.attributes.position.array); pos.set(ck.attributes.position.array, g.attributes.position.array.length);
  const nor = new Float32Array(pos.length);
  nor.set(g.attributes.normal.array); nor.set(ck.attributes.normal.array, g.attributes.normal.array.length);
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));

  const mat = procMaterial({ key: 'boat', surface: BOAT, params: { roughness: 0.35, metalness: 0 } });
  const mesh = new THREE.InstancedMesh(merged, mat, boats.length);
  const m = new THREE.Matrix4();
  boats.forEach((b, i) => {
    m.makeTranslation(b.x, D.Y_HULL + 1.25, b.z);
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// Davits and falls, added to the paint / dark buckets in ship coordinates.
export function addDavits(B, boats) {
  const white = new THREE.Color(0xe6e6e3), steel = new THREE.Color(0x3a3e42);
  for (const b of boats) {
    const sm = b.side;
    const zi = D.W - D.REC_D, zo = Math.abs(b.z);
    for (const dx of [-4.3, 4.3]) {
      const x = b.x + dx;
      // column at the inner wall
      B.add('paint', box(x - 0.25, x + 0.25, D.Y_HULL, D.Y_REC, sm > 0 ? zi : -zi - 0.5, sm > 0 ? zi + 0.5 : -zi), white);
      // arm out over the boat
      B.add('paint', box(x - 0.2, x + 0.2, D.Y_REC - 0.75, D.Y_REC - 0.3, sm > 0 ? zi : -zo - 0.35, sm > 0 ? zo + 0.35 : -zi), white);
      B.add('paint', box(x - 0.14, x + 0.14, D.Y_REC - 1.3, D.Y_REC - 0.75, sm * (zo + 0.2) - 0.14, sm * (zo + 0.2) + 0.14), white);
      // falls
      const cyl = new THREE.CylinderGeometry(0.035, 0.035, 2.35, 5);
      cyl.translate(x, D.Y_REC - 1.3 - 1.17, sm * (zo + 0.2));
      B.add('paint', cyl, steel);
    }
  }
}
