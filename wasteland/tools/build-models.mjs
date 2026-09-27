// Converts Poly Haven glTF models into compact runtime GLBs:
//  * cut-out foliage: merges the separate alpha map into baseColor (RGBA) + MASK
//  * optional mesh simplification (meshoptimizer) for scanned high-poly assets
//  * textures -> KTX2 / Basis ETC1S (colour sRGB, normals XY, ORM linear)
//  * EXT_meshopt_compression geometry
// Writes ../assets/models/<id>.glb and ../assets/manifest-models.json.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as cfg from './assets.config.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
const tmp = join(cache, 'tmp_models');
const outDir = join(here, '..', 'assets', 'models');
const basisu = join(here, 'node_modules/basis_universal/bin/basisu');
mkdirSync(tmp, { recursive: true });
mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(2);

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

async function curlJson(url) {
  const { stdout } = await run('curl', ['-sSfL', url], { maxBuffer: 64 << 20 });
  return JSON.parse(stdout);
}
async function curl(url, dest) {
  if (existsSync(dest)) return dest;
  await run('curl', ['-sSfL', '-o', dest, url]);
  return dest;
}

async function encodeKtx(pngBuf, kind, size) {
  const h = createHash('md5').update(pngBuf).update(kind + size).digest('hex').slice(0, 16);
  const png = join(tmp, `${h}.png`), out = join(tmp, `${h}.ktx2`);
  if (existsSync(out)) return readFileSync(out);
  writeFileSync(png, pngBuf);
  const args = ['-ktx2', '-mipmap', '-file', png, '-output_file', out, '-max_threads', '2'];
  if (kind === 'color') args.push('-q', '200');
  if (kind === 'colorA') args.push('-q', '200', '-force_alpha');
  if (kind === 'normal') args.push('-normal_map', '-separate_rg_to_color_alpha', '-q', '255');
  if (kind === 'linear') args.push('-linear', '-q', '190');
  await run(basisu, args, { maxBuffer: 64 << 20 });
  return readFileSync(out);
}

function slotOf(doc, tex) {
  for (const m of doc.getRoot().listMaterials()) {
    if (m.getBaseColorTexture() === tex) return { kind: 'color', mat: m };
    if (m.getEmissiveTexture() === tex) return { kind: 'color', mat: m };
    if (m.getNormalTexture() === tex) return { kind: 'normal', mat: m };
    if (m.getOcclusionTexture() === tex || m.getMetallicRoughnessTexture() === tex) return { kind: 'linear', mat: m };
  }
  return { kind: 'color', mat: null };
}

async function alphaFor(id, matName, res) {
  const files = await curlJson(`https://api.polyhaven.com/files/${id}`);
  const part = matName.startsWith(id + '_') ? matName.slice(id.length + 1) + '_' : '';
  const keys = [`${part}alpha`, `${part}opacity`, 'Alpha', 'alpha', 'opacity'];
  for (const k of keys) {
    const e = files[k]?.[res];
    if (e) {
      const f = e.jpg || e.png;
      return curl(f.url, join(cache, 'models', id, `${k}_${res}.${e.jpg ? 'jpg' : 'png'}`));
    }
  }
  return null;
}

const manifestPath = join(here, '..', 'assets', 'manifest-models.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const meta = JSON.parse(readFileSync(join(cache, 'meta.json'), 'utf8'));

async function buildModel(m) {
  const res = m.tex >= 2048 ? '2k' : '1k';
  const src = join(cache, 'models', m.id, `${m.id}.gltf`);
  const doc = await io.read(src);
  const root = doc.getRoot();

  // cut-out materials: merge alpha into base colour
  for (const mat of root.listMaterials()) {
    const mode = mat.getAlphaMode();
    const base = mat.getBaseColorTexture();
    if (mode === 'OPAQUE' || !base) continue;
    const alphaFile = await alphaFor(m.id, mat.getName(), res);
    if (!alphaFile) continue;
    const img = sharp(Buffer.from(base.getImage()));
    const { width, height } = await img.metadata();
    const rgb = await img.removeAlpha().raw().toBuffer();
    const a = await sharp(alphaFile).resize(width, height).greyscale().raw().toBuffer();
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = a[i];
    }
    const png = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const t = doc.createTexture(base.getName() + '_rgba').setImage(png).setMimeType('image/png');
    mat.setBaseColorTexture(t);
    const glassy = /glass/i.test(mat.getName());
    if (!glassy) { mat.setAlphaMode('MASK'); mat.setAlphaCutoff(0.5); }
    mat.setExtras({ ...(mat.getExtras() || {}), cutout: !glassy });
  }

  if (m.keep) {
    for (const node of root.listNodes()) {
      if (node.getMesh() && !node.getName().startsWith(m.keep)) node.dispose();
    }
  }
  await doc.transform(dedup(), prune(), weld());

  let tris = 0;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  if (m.tris && tris > m.tris) {
    const ratio = m.tris / tris;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: m.error ?? 0.002, lockBorder: false }), weld());
  }
  let trisAfter = 0;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) trisAfter += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;

  // textures -> KTX2, two tiers stored next to the .gltf; the runtime picks one via
  // a URL modifier (name.ktx2 -> name_hi.ktx2 / name_lo.ktx2)
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  const lowVariants = [];
  let ti = 0;
  for (const tex of root.listTextures()) {
    const { kind } = slotOf(doc, tex);
    const buf = Buffer.from(tex.getImage());
    const img = sharp(buf);
    const md = await img.metadata();
    const hasAlpha = md.channels === 4;
    const encKind = kind === 'color' && hasAlpha ? 'colorA' : kind;
    const hiSize = Math.min(kind === 'linear' ? m.tex / 2 : m.tex, md.width);
    const loSize = Math.max(128, hiSize / 2);
    const variant = async (size) => {
      let out = sharp(buf).resize(size, size, { kernel: 'lanczos3' });
      if (!hasAlpha || kind !== 'color') out = out.removeAlpha();
      return encodeKtx(await out.png({ compressionLevel: 1 }).toBuffer(), encKind, size);
    };
    const uri = `t${ti++}_${kind}`;
    tex.setImage(new Uint8Array(await variant(hiSize))).setMimeType('image/ktx2').setURI(`${uri}.ktx2`);
    lowVariants.push({ uri, data: await variant(loSize) });
  }
  for (const mat of root.listMaterials()) {
    if (mat.getNormalTexture()) mat.setExtras({ ...(mat.getExtras() || {}), xyNormal: true });
  }

  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  const dir = join(outDir, m.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await io.write(join(dir, `${m.id}.gltf`), doc);
  let bytesHi = 0, bytesLo = 0;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.ktx2')) {
      const hi = f.replace(/\.ktx2$/, '_hi.ktx2');
      renameSync(join(dir, f), join(dir, hi));
      bytesHi += statSync(join(dir, hi)).size;
    } else { const sz = statSync(join(dir, f)).size; bytesHi += sz; bytesLo += sz; }
  }
  for (const v of lowVariants) { writeFileSync(join(dir, `${v.uri}_lo.ktx2`), v.data); bytesLo += v.data.length; }

  const scene = root.getDefaultScene() || root.listScenes()[0];
  const bb = getBounds(scene);
  const nodes = root.listNodes().filter((n) => n.getMesh()).map((n) => n.getName());
  manifest[m.id] = {
    file: `models/${m.id}/${m.id}.gltf`, bytesHi, bytesLo, tris: Math.round(trisAfter), srcTris: Math.round(tris),
    min: bb.min.map((v) => +v.toFixed(3)), max: bb.max.map((v) => +v.toFixed(3)), nodes,
    source: meta[m.id],
  };
  console.log(`${m.id.padEnd(30)} tris ${Math.round(tris)} -> ${Math.round(trisAfter)}  hi ${(bytesHi / 1024).toFixed(0)} KB  lo ${(bytesLo / 1024).toFixed(0)} KB`);
}

const list = cfg.models.filter((m) => only.length === 0 || only.includes(m.id));
const q = list.slice();
await Promise.all(Array.from({ length: 2 }, async () => {
  while (q.length) {
    const m = q.shift();
    try { await buildModel(m); } catch (e) { console.error('FAILED', m.id, e.stack || e.message); process.exitCode = 1; }
  }
}));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
