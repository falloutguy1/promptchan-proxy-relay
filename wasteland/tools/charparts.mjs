// Shared by build-characters.mjs: reads the Quaternius sources (fetch-characters.mjs)
// and returns every skinned part with its geometry rebound to one canonical
// skeleton per body type ('M' / 'F'), joint indices in the canonical order and
// the source texture it samples.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const CHARS = join(import.meta.dirname, '.cache', 'chars');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// find a file below dir whose path matches all fragments
export function find(dir, ...frags) {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else out.push(p); } };
  walk(dir);
  const hit = out.find((p) => frags.every((f) => p.includes(f)));
  if (!hit) throw new Error(`not found in ${dir}: ${frags.join(' + ')}`);
  return hit;
}

export const SRC = {
  outfit: (g, o) => find(join(CHARS, 'outfits'), 'Exports/glTF (Godot-Unreal)/Outfits/', `${g === 'M' ? 'Male' : 'Female'}_${o}.gltf`),
  body: (g) => find(join(CHARS, 'ubc'), 'Base Characters/Godot - UE/', `Superhero_${g === 'M' ? 'Male' : 'Female'}_FullBody.gltf`),
  hair: (n) => find(join(CHARS, 'ubc'), 'Rigged to Head Bone', `${n}.gltf`),
  anims: (n, rm) => find(join(CHARS, n), 'Unreal-Godot', `${n.toUpperCase()}_Standard${rm ? '_RM' : ''}.glb`),
  texture: (name) => {
    for (const pack of ['outfits', 'ubc']) {
      const dir = join(CHARS, pack);
      if (!existsSync(dir)) continue;
      try { return find(dir, 'Textures', `/${name}`); } catch { /* next */ }
    }
    throw new Error('texture not found ' + name);
  },
};

// 1x1 grey PNG for image files a source glTF names but the pack does not ship
const PLACEHOLDER = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaGgAAAMEAYFL09IQAAAAAElFTkSuQmCC', 'base64');

export async function read(path) {
  if (path.endsWith('.glb')) return io.read(path);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const dir = dirname(path), resources = {};
  for (const b of json.buffers || []) if (b.uri) resources[b.uri] = new Uint8Array(readFileSync(join(dir, decodeURIComponent(b.uri))));
  for (const im of json.images || []) {
    if (!im.uri) continue;
    const f = join(dir, decodeURIComponent(im.uri)), alt = f.replace(/_png\.png$/, '.png');
    resources[im.uri] = existsSync(f) ? new Uint8Array(readFileSync(f)) : existsSync(alt) ? new Uint8Array(readFileSync(alt)) : new Uint8Array(PLACEHOLDER);
  }
  return io.readJSON({ json, resources });
}

const inv = (m) => {
  // 4x4 column-major inverse (general)
  const a = m, o = new Float64Array(16);
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
};
const mul = (a, b) => { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };

/** Skeleton of a document's first skin: joint names, inverse bind matrices, rest TRS per joint, parent index. */
export function skeletonOf(doc) {
  const skin = doc.getRoot().listSkins()[0];
  const joints = skin.listJoints();
  const ibmArr = skin.getInverseBindMatrices().getArray();
  const names = joints.map((j) => j.getName());
  const ibm = joints.map((_, i) => Float64Array.from(ibmArr.subarray(i * 16, i * 16 + 16)));
  const parent = joints.map((j) => { const p = j.getParentNode(); return p ? names.indexOf(p.getName()) : -1; });
  const rest = joints.map((j) => ({ t: j.getTranslation(), r: j.getRotation(), s: j.getScale() }));
  return { names, ibm, parent, rest, joints };
}

/** Every skinned primitive of a document as a part, rebound to the canonical skeleton `can`. */
export function partsOf(doc, can, { tag, keepPrim = () => true } = {}) {
  const src = skeletonOf(doc);
  const map = src.names.map((n) => { const i = can.names.indexOf(n); if (i < 0) throw new Error('joint missing in canonical skeleton: ' + n); return i; });
  // per source joint: canonical rest * source inverse bind (identity where the skeletons agree)
  const fix = src.ibm.map((m, i) => mul(inv(can.ibm[map[i]]), m));
  const parts = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || !node.getSkin()) continue;
    mesh.listPrimitives().forEach((prim, pi) => {
      const mat = prim.getMaterial();
      const tex = mat?.getBaseColorTexture();
      const texName = tex ? (tex.getURI() || tex.getName()).split('/').pop() : null;
      if (!keepPrim(node.getName(), mat?.getName(), texName)) return;
      const P = prim.getAttribute('POSITION').getArray(), N = prim.getAttribute('NORMAL').getArray();
      const UV = prim.getAttribute('TEXCOORD_0').getArray(), J = prim.getAttribute('JOINTS_0').getArray(), W = prim.getAttribute('WEIGHTS_0');
      const Wn = W.getNormalized() ? Float32Array.from(W.getArray(), (v) => v / (W.getArray() instanceof Uint8Array ? 255 : 65535)) : W.getArray();
      const n = P.length / 3;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), joints = new Uint8Array(n * 4), weights = new Float32Array(n * 4);
      for (let v = 0; v < n; v++) {
        // blend the per-joint correction by the skin weights (exact where only agreeing joints influence)
        let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0, ws = 0;
        for (let k = 0; k < 4; k++) {
          const w = Wn[v * 4 + k]; if (!w) continue;
          const f = fix[J[v * 4 + k]], px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
          x += w * (f[0] * px + f[4] * py + f[8] * pz + f[12]); y += w * (f[1] * px + f[5] * py + f[9] * pz + f[13]); z += w * (f[2] * px + f[6] * py + f[10] * pz + f[14]);
          const qx = N[v * 3], qy = N[v * 3 + 1], qz = N[v * 3 + 2];
          nx += w * (f[0] * qx + f[4] * qy + f[8] * qz); ny += w * (f[1] * qx + f[5] * qy + f[9] * qz); nz += w * (f[2] * qx + f[6] * qy + f[10] * qz);
          ws += w;
        }
        if (ws === 0) { x = P[v * 3]; y = P[v * 3 + 1]; z = P[v * 3 + 2]; nx = N[v * 3]; ny = N[v * 3 + 1]; nz = N[v * 3 + 2]; ws = 1; }
        pos[v * 3] = x / ws; pos[v * 3 + 1] = y / ws; pos[v * 3 + 2] = z / ws;
        const l = Math.hypot(nx, ny, nz) || 1;
        nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
        let s = 0;
        for (let k = 0; k < 4; k++) { joints[v * 4 + k] = map[J[v * 4 + k]]; weights[v * 4 + k] = Wn[v * 4 + k]; s += Wn[v * 4 + k]; }
        if (s > 0) for (let k = 0; k < 4; k++) weights[v * 4 + k] /= s;
      }
      const idx = prim.getIndices() ? Uint32Array.from(prim.getIndices().getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
      parts.push({ tag, node: node.getName(), prim: pi, material: mat?.getName(), texName, pos, nor, uv: Float32Array.from(UV), joints, weights, idx });
    });
  }
  return parts;
}

/** Keep triangles whose three vertices carry at least `min` weight on the given joints. */
export function cutByJoints(part, can, jointNames, min = 0.5) {
  const keep = new Set(jointNames.map((n) => can.names.indexOf(n)));
  const w = (v) => { let s = 0; for (let k = 0; k < 4; k++) if (keep.has(part.joints[v * 4 + k])) s += part.weights[v * 4 + k]; return s; };
  const ok = new Uint8Array(part.pos.length / 3);
  for (let v = 0; v < ok.length; v++) ok[v] = w(v) >= min ? 1 : 0;
  const tri = [];
  for (let i = 0; i < part.idx.length; i += 3) if (ok[part.idx[i]] && ok[part.idx[i + 1]] && ok[part.idx[i + 2]]) tri.push(part.idx[i], part.idx[i + 1], part.idx[i + 2]);
  return compact({ ...part, idx: Uint32Array.from(tri) });
}

/** Drop unreferenced vertices. */
export function compact(part) {
  const n = part.pos.length / 3, remap = new Int32Array(n).fill(-1);
  let m = 0;
  for (const i of part.idx) if (remap[i] < 0) remap[i] = m++;
  const pick = (arr, k) => { const o = new arr.constructor(m * k); for (let v = 0; v < n; v++) if (remap[v] >= 0) for (let c = 0; c < k; c++) o[remap[v] * k + c] = arr[v * k + c]; return o; };
  return { ...part, pos: pick(part.pos, 3), nor: pick(part.nor, 3), uv: pick(part.uv, 2), joints: pick(part.joints, 4), weights: pick(part.weights, 4), idx: Uint32Array.from(part.idx, (i) => remap[i]) };
}

export function uvBounds(part) {
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (let i = 0; i < part.uv.length; i += 2) { u0 = Math.min(u0, part.uv[i]); u1 = Math.max(u1, part.uv[i]); v0 = Math.min(v0, part.uv[i + 1]); v1 = Math.max(v1, part.uv[i + 1]); }
  return [u0, v0, u1, v1];
}

/**
 * Head plus neck, upper chest and upper back of a base body (everything the
 * outfits' collars may reveal), without arms. Below the neck the skin is pulled
 * in along its normals so the broader base body stays under the clothes.
 */
export function cutHeadAndCollar(part, can, { top = 1.5, low = 1.28, shrink = 0.022 } = {}) {
  const J = (n) => can.names.indexOf(n);
  const keepJ = new Set(['Head', 'neck_01', 'spine_03', 'clavicle_l', 'clavicle_r'].map(J));
  const armJ = new Set(['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r'].map(J));
  const n = part.pos.length / 3, ok = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    let k = 0, a = 0;
    for (let c = 0; c < 4; c++) { const j = part.joints[v * 4 + c], w = part.weights[v * 4 + c]; if (keepJ.has(j)) k += w; if (armJ.has(j)) a += w; }
    ok[v] = k >= 0.5 && a < 0.25 && part.pos[v * 3 + 1] >= low ? 1 : 0;
  }
  const tri = [];
  for (let i = 0; i < part.idx.length; i += 3) if (ok[part.idx[i]] && ok[part.idx[i + 1]] && ok[part.idx[i + 2]]) tri.push(part.idx[i], part.idx[i + 1], part.idx[i + 2]);
  const out = compact({ ...part, pos: Float32Array.from(part.pos), idx: Uint32Array.from(tri) });
  for (let v = 0; v < out.pos.length / 3; v++) {
    const y = out.pos[v * 3 + 1], t = Math.min(1, Math.max(0, (top - y) / (top - low - 0.08)));
    const d = shrink * t * t * (3 - 2 * t);
    for (let c = 0; c < 3; c++) out.pos[v * 3 + c] -= out.nor[v * 3 + c] * d;
  }
  return out;
}
