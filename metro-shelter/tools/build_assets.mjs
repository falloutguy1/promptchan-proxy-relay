// Packs raw Poly Haven downloads (assets-src/) into game-ready assets (assets/):
//  - models  -> single GLB, textures resized, KTX2 (ETC1S colour/ORM, UASTC normals), meshopt geometry
//               plus a simplified *_lod1.glb for heavier meshes
//  - surface textures -> KTX2 at 2K (high) and 1K (low quality setting)
// Requires KTX-Software's `toktx` on PATH (https://github.com/KhronosGroup/KTX-Software/releases).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'assets-src', OUT = 'assets';
const HERO = new Set(['barrel_stove', 'portable_generator', 'vintage_radio_transceiver', 'service_pistol']);
const gt = (...args) => execFileSync('npx', ['gltf-transform', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const tmp = fs.mkdtempSync('/tmp/msb-');
const only = process.argv.slice(2);

fs.mkdirSync(`${OUT}/models`, { recursive: true });
for (const id of fs.readdirSync(`${SRC}/models`)) {
  if (only.length && !only.includes(id)) continue;
  const dir = `${SRC}/models/${id}`;
  const gltf = fs.readdirSync(dir).find((f) => f.endsWith('.gltf'));
  const out = `${OUT}/models/${id}.glb`;
  if (fs.existsSync(out) && !only.length) continue;
  const size = HERO.has(id) ? 2048 : 1024;
  const a = `${tmp}/${id}_a.glb`, b = `${tmp}/${id}_b.glb`, c = `${tmp}/${id}_c.glb`;
  gt('copy', path.join(dir, gltf), a);
  gt('resize', a, b, '--width', String(size), '--height', String(size));
  gt('uastc', b, c, '--slots', 'normalTexture', '--level', '2', '--rdo', '--zstd', '18');
  gt('etc1s', c, a, '--quality', '200');
  gt('meshopt', a, out, '--level', 'medium');
  // Simplified distant LOD for meshes that are expensive at range.
  const json = JSON.parse(fs.readFileSync(path.join(dir, gltf), 'utf8'));
  const verts = json.accessors.filter((x, i) => json.meshes.some((m) => m.primitives.some((p) => p.attributes.POSITION === i)))
    .reduce((s, x) => s + x.count, 0);
  if (verts > 6000) {
    // LOD1: simplified mesh with 256px textures (it is only seen at range).
    gt('copy', path.join(dir, gltf), a);
    gt('simplify', a, b, '--ratio', '0.2', '--error', '0.004');
    gt('resize', b, c, '--width', '256', '--height', '256');
    gt('etc1s', c, a, '--quality', '160');
    gt('meshopt', a, `${OUT}/models/${id}_lod1.glb`, '--level', 'medium');
  }
  console.log('model', id, (fs.statSync(out).size / 1024).toFixed(0) + 'KB', verts, 'verts');
}

fs.mkdirSync(`${OUT}/textures`, { recursive: true });
for (const id of fs.readdirSync(`${SRC}/textures`)) {
  if (only.length && !only.includes(id)) continue;
  const dir = `${SRC}/textures/${id}`;
  for (const f of fs.readdirSync(dir)) {
    const [key] = f.split('_');
    for (const res of [2048, 1024]) {
      const tag = res === 2048 ? '2k' : '1k';
      const out = `${OUT}/textures/${id}/${key}_${tag}.ktx2`;
      if (fs.existsSync(out)) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const common = ['--t2', '--genmipmap', '--resize', `${res}x${res}`];
      const args = key === 'nor'
        ? [...common, '--assign_oetf', 'linear', '--assign_primaries', 'none', '--encode', 'uastc', '--uastc_quality', '1', '--uastc_rdo_l', '3', '--uastc_rdo_d', '65536', '--zcmp', '20', '--normal_mode', out, `${dir}/${f}`]
        : key === 'arm'
          ? [...common, '--assign_oetf', 'linear', '--assign_primaries', 'none', '--encode', 'etc1s', '--qlevel', '200', out, `${dir}/${f}`]
          : [...common, '--assign_oetf', 'srgb', '--encode', 'etc1s', '--qlevel', '200', out, `${dir}/${f}`];
      execFileSync('toktx', args, { stdio: 'inherit' });
    }
  }
  console.log('texture', id);
}
fs.mkdirSync(`${OUT}/hdri`, { recursive: true });
for (const f of fs.readdirSync(`${SRC}/hdri`)) fs.copyFileSync(`${SRC}/hdri/${f}`, `${OUT}/hdri/${f}`);
