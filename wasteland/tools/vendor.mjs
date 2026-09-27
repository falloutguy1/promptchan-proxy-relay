// Copies the exact three.js / postprocessing / N8AO builds the game uses into
// ../vendor, following relative imports so only what is needed ships, and
// minifies each ES module in place (imports are preserved, no bundling).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const nm = join(here, 'node_modules');
const out = resolve(here, '../vendor');

const threeRoot = join(nm, 'three');
const addonEntries = [
  'loaders/GLTFLoader.js',
  'loaders/KTX2Loader.js',
  'loaders/HDRLoader.js',
  'libs/meshopt_decoder.module.js',
  'utils/BufferGeometryUtils.js',
  'utils/SkeletonUtils.js',
  'geometries/RoundedBoxGeometry.js',
  'postprocessing/Pass.js',
];

function minify(code, file) {
  try {
    return transformSync(code, { minify: true, format: 'esm', target: 'es2020', legalComments: 'none' }).code;
  } catch (e) {
    console.warn('minify failed, copying raw:', file, e.message);
    return code;
  }
}

function copyModuleTree(srcRoot, entry, dstRoot, seen = new Set()) {
  const src = join(srcRoot, entry);
  if (seen.has(src)) return;
  seen.add(src);
  const code = readFileSync(src, 'utf8');
  const dst = join(dstRoot, entry);
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, minify(code, src));
  const re = /(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code))) {
    const rel = relative(srcRoot, resolve(dirname(src), m[1]));
    copyModuleTree(srcRoot, rel, dstRoot, seen);
  }
}

if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });

// three core
for (const f of ['three.module.js', 'three.core.js']) {
  mkdirSync(join(out, 'three/build'), { recursive: true });
  writeFileSync(join(out, 'three/build', f), minify(readFileSync(join(threeRoot, 'build', f), 'utf8'), f));
}
// three addons (with their relative dependencies)
const addonSeen = new Set();
for (const e of addonEntries) copyModuleTree(join(threeRoot, 'examples/jsm'), e, join(out, 'three/examples/jsm'), addonSeen);
// basis transcoder (worker-loaded, keep as shipped)
mkdirSync(join(out, 'three/examples/jsm/libs/basis'), { recursive: true });
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
  copyFileSync(join(threeRoot, 'examples/jsm/libs/basis', f), join(out, 'three/examples/jsm/libs/basis', f));
}
copyFileSync(join(threeRoot, 'LICENSE'), join(out, 'three/LICENSE'));

// postprocessing (pmndrs) + N8AO
mkdirSync(join(out, 'postprocessing'), { recursive: true });
writeFileSync(join(out, 'postprocessing/index.js'), minify(readFileSync(join(nm, 'postprocessing/build/index.js'), 'utf8'), 'postprocessing'));
copyFileSync(join(nm, 'postprocessing/LICENSE.md'), join(out, 'postprocessing/LICENSE.md'));
mkdirSync(join(out, 'n8ao'), { recursive: true });
writeFileSync(join(out, 'n8ao/N8AO.js'), minify(readFileSync(join(nm, 'n8ao/dist/N8AO.js'), 'utf8'), 'n8ao'));
for (const lic of ['LICENSE', 'LICENSE.md']) {
  if (existsSync(join(nm, 'n8ao', lic))) copyFileSync(join(nm, 'n8ao', lic), join(out, 'n8ao/LICENSE'));
}

const versions = {
  three: JSON.parse(readFileSync(join(threeRoot, 'package.json'), 'utf8')).version,
  postprocessing: JSON.parse(readFileSync(join(nm, 'postprocessing/package.json'), 'utf8')).version,
  n8ao: JSON.parse(readFileSync(join(nm, 'n8ao/package.json'), 'utf8')).version,
};
writeFileSync(join(out, 'VERSIONS.json'), JSON.stringify(versions, null, 2) + '\n');
console.log('vendored', versions, 'addon files:', addonSeen.size);
