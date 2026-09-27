// Downloads every source asset listed in assets.config.mjs into tools/.cache/.
// Uses curl (respects HTTPS_PROXY / system CA). Re-running skips finished files.
// Also records author/licence metadata into .cache/meta.json for the credits file.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cfg from './assets.config.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
mkdirSync(cache, { recursive: true });

const metaPath = join(cache, 'meta.json');
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};

async function curl(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) return dest;
  mkdirSync(dirname(dest), { recursive: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await run('curl', ['-sSfL', '--retry', '2', '-A', 'wasteland-asset-fetch', '-o', dest + '.part', url], { maxBuffer: 1 << 20 });
      await run('mv', [dest + '.part', dest]);
      return dest;
    } catch (e) {
      if (attempt === 3) throw new Error(`download failed ${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

async function json(url) {
  const { stdout } = await run('curl', ['-sSfL', '-A', 'wasteland-asset-fetch', url], { maxBuffer: 64 << 20 });
  return JSON.parse(stdout);
}

async function pool(items, n, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: n }, async () => {
    while (queue.length) {
      const it = queue.shift();
      try { await fn(it); } catch (e) { console.error('ERROR', e.message); process.exitCode = 1; }
    }
  });
  await Promise.all(workers);
}

async function phInfo(id) {
  if (meta[id]) return meta[id];
  const info = await json(`https://api.polyhaven.com/info/${id}`);
  meta[id] = {
    source: 'Poly Haven', url: `https://polyhaven.com/a/${id}`, license: 'CC0 1.0',
    name: info.name, authors: Object.keys(info.authors || {}), dimensions_mm: info.dimensions || null,
  };
  return meta[id];
}

function acgMeta(id) {
  meta[id] = meta[id] || { source: 'ambientCG', url: `https://ambientcg.com/view?id=${id}`, license: 'CC0 1.0', name: id, authors: ['Lennart Demes (ambientCG)'] };
}

// Poly Haven texture sets (and model-embedded map sets used as atlases)
async function fetchPhMaps(id, res, keys, outDir) {
  const files = await json(`https://api.polyhaven.com/files/${id}`);
  for (const key of keys) {
    const entry = files[key]?.[res];
    if (!entry) throw new Error(`${id}: missing map ${key}@${res}`);
    const f = entry.jpg || entry.png;
    const ext = entry.jpg ? 'jpg' : 'png';
    await curl(f.url, join(outDir, `${key}.${ext}`));
  }
  await phInfo(id);
}

async function fetchAcg(id, res, outDir) {
  const zip = join(cache, 'zips', `${id}_${res}-JPG.zip`);
  await curl(`https://ambientcg.com/get?file=${id}_${res}-JPG.zip`, zip);
  mkdirSync(outDir, { recursive: true });
  await run('unzip', ['-o', '-q', zip, '-d', outDir]);
  acgMeta(id);
}

const jobs = [];
for (const t of cfg.textures) {
  const out = join(cache, 'tex', t.name);
  if (t.src === 'ph') jobs.push(() => fetchPhMaps(t.id, t.res, ['Diffuse', 'nor_gl', 'arm'], out));
  else jobs.push(() => fetchAcg(t.id, t.res, out));
}
for (const a of cfg.atlases) {
  const out = join(cache, 'atlas', a.name);
  if (a.src === 'ph') {
    const p = a.prefix;
    const keys = p ? [`${p}diff`, `${p}alpha`, `${p}nor_gl`, `${p}arm`] : ['Diffuse', 'Alpha', 'nor_gl', 'arm'];
    if (a.extraDiffuse) keys.push(a.extraDiffuse);
    jobs.push(() => fetchPhMaps(a.id, a.res, keys, out));
  } else jobs.push(() => fetchAcg(a.id, a.res, out));
}
for (const d of cfg.decals) jobs.push(() => fetchAcg(d.id, d.res, join(cache, 'decal', d.name)));
for (const s of cfg.skies) {
  jobs.push(async () => {
    const files = await json(`https://api.polyhaven.com/files/${s.id}`);
    await curl(files.hdri['4k'].hdr.url, join(cache, 'sky', `${s.name}.hdr`));
    await phInfo(s.id);
  });
}
for (const m of cfg.models) {
  jobs.push(async () => {
    const res = m.tex >= 2048 ? '2k' : '1k';
    const files = await json(`https://api.polyhaven.com/files/${m.id}`);
    const g = files.gltf?.[res]?.gltf;
    if (!g) throw new Error(`${m.id}: no gltf@${res}`);
    const dir = join(cache, 'models', m.id);
    await curl(g.url, join(dir, `${m.id}.gltf`));
    for (const [rel, inc] of Object.entries(g.include || {})) await curl(inc.url, join(dir, rel));
    await phInfo(m.id);
  });
}

console.log(`fetching ${jobs.length} asset groups...`);
await pool(jobs, 6, (j) => j());
writeFileSync(metaPath, JSON.stringify(meta, null, 1));
console.log('done; meta entries:', Object.keys(meta).length);
