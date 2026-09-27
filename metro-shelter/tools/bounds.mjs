import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of fs.readdirSync('assets/models').filter(f=>!f.includes('_lod1'))) {
  const doc = await io.read('assets/models/'+f);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  const r = (a)=>a.map(v=>v.toFixed(2)).join(',');
  console.log(f.replace('.glb','').padEnd(30), 'min', r(b.min), 'max', r(b.max));
}
