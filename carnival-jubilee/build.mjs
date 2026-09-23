// Bundles src/ into one standalone HTML file: carnival-jubilee.html
// Usage: npm i three@0.186.0 esbuild && node build.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const nodePaths = (process.env.NODE_PATH || '').split(':').filter(Boolean);

const out = await build({
  entryPoints: [join(here, 'src/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
  nodePaths,
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(join(here, 'src/template.html'), 'utf8').replace('/*BUNDLE*/', () => js);
writeFileSync(join(here, 'carnival-jubilee.html'), html);
console.log(`carnival-jubilee.html ${(html.length / 1024).toFixed(0)} KB`);
