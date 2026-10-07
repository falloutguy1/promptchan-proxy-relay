import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.argv[2], args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage();
const r = await p.evaluate(()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');if(!g)return 'no webgl2';const e=g.getExtension('WEBGL_debug_renderer_info');return [g.getParameter(e.UNMASKED_RENDERER_WEBGL), g.getParameter(g.MAX_TEXTURE_SIZE), g.getSupportedExtensions().filter(x=>/compressed|float/.test(x)).join(',')];});
console.log(r); await b.close();
