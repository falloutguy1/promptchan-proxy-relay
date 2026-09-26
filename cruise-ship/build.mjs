import * as esbuild from 'esbuild';
import fs from 'node:fs';

const r = await esbuild.build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false,
  target: 'es2020', legalComments: 'none', logLevel: 'warning',
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync('src/template.html', 'utf8').replace('/*__BUNDLE__*/', () => js);
fs.writeFileSync('index.html', html);
console.log('index.html', (html.length / 1024).toFixed(0) + ' KB');
