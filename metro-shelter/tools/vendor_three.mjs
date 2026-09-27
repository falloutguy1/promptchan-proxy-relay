// Copies three.js core + the addons the game imports (with their transitive imports) into vendor/three.
import fs from 'node:fs';
import path from 'node:path';

const T = 'node_modules/three';
const OUT = 'vendor/three';
const ENTRY = [
  'loaders/GLTFLoader.js', 'loaders/KTX2Loader.js', 'loaders/HDRLoader.js',
  'libs/meshopt_decoder.module.js', 'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js',
  'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/OutputPass.js',
  'postprocessing/UnrealBloomPass.js', 'postprocessing/GTAOPass.js', 'postprocessing/ShaderPass.js',
  'environments/RoomEnvironment.js',
];
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(`${OUT}/build`, { recursive: true });
for (const f of ['three.module.js', 'three.core.js']) fs.copyFileSync(`${T}/build/${f}`, `${OUT}/build/${f}`);
const seen = new Set();
const visit = (rel) => {
  if (seen.has(rel)) return; seen.add(rel);
  const src = `${T}/examples/jsm/${rel}`;
  const code = fs.readFileSync(src, 'utf8');
  fs.mkdirSync(path.dirname(`${OUT}/addons/${rel}`), { recursive: true });
  fs.writeFileSync(`${OUT}/addons/${rel}`, code);
  for (const m of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) visit(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
};
ENTRY.forEach(visit);
fs.cpSync(`${T}/examples/jsm/libs/basis`, `${OUT}/addons/libs/basis`, { recursive: true });
fs.copyFileSync(`${T}/LICENSE`, `${OUT}/LICENSE`);
console.log([...seen].join('\n'));
