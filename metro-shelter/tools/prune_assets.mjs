// Removes built assets the game does not reference (keeps the repository/deploy small).
import fs from 'node:fs';

const props = fs.readFileSync('src/props.js', 'utf8');
const list = (name) => [...props.match(new RegExp(`export const ${name} = \\[([^\\]]+)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const models = new Set(list('MODEL_IDS'));
const mats = fs.readFileSync('src/materials.js', 'utf8');
const textures = new Set([...mats.matchAll(/pbr\('([^']+)'/g)].map((m) => m[1]));
for (const f of fs.readdirSync('assets/models')) {
  const id = f.replace(/(_lod1)?\.glb$/, '');
  if (!models.has(id)) { fs.rmSync(`assets/models/${f}`); console.log('removed model', f); }
}
for (const d of fs.readdirSync('assets/textures')) {
  if (!textures.has(d)) { fs.rmSync(`assets/textures/${d}`, { recursive: true }); console.log('removed texture', d); }
}
