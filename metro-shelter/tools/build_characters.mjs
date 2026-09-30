// Builds game-ready character assets from Quaternius' CC0 packs (downloaded into assets-src/characters/):
//   Universal Base Characters, Modular Character Outfits - Fantasy, Universal Animation Library.
// Output (assets/characters/):
//   head_<sex>.glb      base body cut down to head + neck (the outfits cover the rest; avoids clipping)
//   hair_<style>.glb    hair/beard meshes skinned to the Head bone
//   outfit_<name>.glb   clothing + hands, skinned to the same 65-bone skeleton
//   tex_*.ktx2          alternate outfit colourways
//   anims.glb           the animation clips the game uses (no mesh)
//   manifest.json
// Requires KTX-Software >= 4.4 (`toktx` and `ktx`) on PATH.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, compactPrimitive, dedup } from '@gltf-transform/functions';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'assets-src/characters';
const OUT = 'assets/characters';
const UBC = `${SRC}/Universal Base Characters[Standard]`;
const MCO = `${SRC}/Modular Character Outfits - Fantasy[Standard]`;
const UAL = `${SRC}/Universal Animation Library[Standard]`;
const tmp = fs.mkdtempSync('/tmp/chars-');
const ONLY = process.argv[2];   // e.g. `anims` to rebuild just the animation file
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const gt = (...a) => execFileSync('npx', ['gltf-transform', ...a], { stdio: ['ignore', 'ignore', 'inherit'] });

// Some .gltf files in the pack reference "<name>_png.png" images that ship as "<name>.png".
function fixImageRefs(file) {
  const dir = path.dirname(file);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const im of j.images || []) {
    if (!fs.existsSync(path.join(dir, im.uri))) {
      const alt = im.uri.replace('_png.png', '.png');
      const cands = [path.join(dir, alt), path.join(UBC, 'Base Characters/Textures', alt), path.join(dir, '..', alt)];
      const hit = cands.find((c) => fs.existsSync(c));
      if (hit) fs.copyFileSync(hit, path.join(dir, im.uri));
    }
  }
}

// Compress textures (colour ETC1S, normal UASTC) + meshopt geometry.
function pack(inFile, outFile, size = 1024) {
  const a = `${tmp}/a.glb`, b = `${tmp}/b.glb`, c = `${tmp}/c.glb`;
  gt('copy', inFile, a);
  gt('resize', a, b, '--width', String(size), '--height', String(size));
  gt('uastc', b, c, '--slots', 'normalTexture', '--level', '2', '--rdo', '--zstd', '18');
  gt('etc1s', c, a, '--quality', '220');
  gt('meshopt', a, outFile, '--level', 'medium');
}

// ---- heads ----
if (!ONLY) {
const HEAD_JOINTS = new Set(['Head', 'neck_01']);
for (const sex of ['Male', 'Female']) {
  const src = `${UBC}/Base Characters/Godot - UE/Superhero_${sex}_FullBody.gltf`;
  fixImageRefs(src);
  const doc = await io.read(src);
  const skin = doc.getRoot().listSkins()[0];
  const jointNames = skin.listJoints().map((j) => j.getName());
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!/Superhero/.test(prim.getMaterial()?.getName() || '')) continue;   // eyes/eyebrows kept whole
      const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0'), idx = prim.getIndices();
      const headW = new Float32Array(J.getCount());
      const j4 = [], w4 = [];
      for (let v = 0; v < J.getCount(); v++) {
        J.getElement(v, j4); W.getElement(v, w4);
        let s = 0; for (let k = 0; k < 4; k++) if (HEAD_JOINTS.has(jointNames[j4[k]])) s += w4[k];
        headW[v] = s;
      }
      const keep = [];
      for (let t = 0; t < idx.getCount(); t += 3) {
        const a = idx.getScalar(t), b = idx.getScalar(t + 1), c = idx.getScalar(t + 2);
        // keep the head and upper neck; the collar of every outfit covers the seam
        if (headW[a] + headW[b] + headW[c] > 1.2) keep.push(a, b, c);
      }
      const acc = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(idx.getBuffer());
      prim.setIndices(acc);
      compactPrimitive(prim);
      console.log(sex, 'head tris', keep.length / 3, 'of', idx.getCount() / 3);
    }
  }
  await doc.transform(prune(), dedup());
  const raw = `${tmp}/head_${sex}.glb`;
  await io.write(raw, doc);
  pack(raw, `${OUT}/head_${sex.toLowerCase()}.glb`, 1024);
}

// ---- hair ----
const HAIR = ['Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_Beard'];
for (const h of HAIR) {
  const src = `${UBC}/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/${h}.gltf`;
  fixImageRefs(src);
  const doc = await io.read(src);
  const raw = `${tmp}/${h}.glb`;
  await io.write(raw, doc);
  pack(raw, `${OUT}/${h.toLowerCase()}.glb`, 512);
}

// ---- outfits ----
const OUTFITS = ['Male_Peasant', 'Female_Peasant', 'Male_Ranger', 'Female_Ranger'];
for (const o of OUTFITS) {
  const src = `${MCO}/Exports/glTF (Godot-Unreal)/Outfits/${o}.gltf`;
  fixImageRefs(src);
  pack(src, `${OUT}/outfit_${o.toLowerCase()}.glb`, 1024);
}
// alternate colourways of the outfit textures
for (const [f, name] of [[`${MCO}/Textures/Peasant/T_Peasant_2_BaseColor.png`, 'tex_peasant_2'], [`${MCO}/Textures/Ranger/T_Ranger_3_BaseColor.png`, 'tex_ranger_3']]) {
  execFileSync('toktx', ['--t2', '--genmipmap', '--resize', '1024x1024', '--assign_oetf', 'srgb', '--encode', 'etc1s', '--qlevel', '220', `${OUT}/${name}.ktx2`, f], { stdio: 'inherit' });
}

}  // !ONLY

// ---- animations: keep only the clips the game plays, drop the preview mannequin ----
const CLIPS = {
  idle: 'Idle_Loop', talk: 'Idle_Talking_Loop', walk: 'Walk_Loop', jog: 'Jog_Fwd_Loop', run: 'Sprint_Loop',
  sit: 'Sitting_Idle_Loop', sitTalk: 'Sitting_Talking_Loop', kneel: 'Fixing_Kneeling', work: 'Interact',
  torch: 'Idle_Torch_Loop', crouch: 'Crouch_Idle_Loop', death: 'Death01', hit: 'Hit_Chest', pickup: 'PickUp_Table',
  aim: 'Pistol_Aim_Neutral', pistolIdle: 'Pistol_Idle_Loop', shoot: 'Pistol_Shoot', reload: 'Pistol_Reload',
};
{
  const doc = await io.read(`${UAL}/Unreal-Godot/UAL1_Standard.glb`);
  const want = new Set(Object.values(CLIPS));
  for (const a of doc.getRoot().listAnimations()) if (!want.has(a.getName())) a.dispose();
  for (const n of doc.getRoot().listNodes()) if (n.getMesh()) { n.getMesh().dispose(); n.setMesh(null); n.setSkin(null); }
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const m of doc.getRoot().listMaterials()) m.dispose();
  await doc.transform(prune({ keepLeaves: true }), dedup());
  const raw = `${tmp}/anims.glb`;
  await io.write(raw, doc);
  gt('meshopt', raw, `${OUT}/anims.glb`, '--level', 'medium');
}

const manifest = {
  source: 'Quaternius (CC0): Universal Base Characters, Modular Character Outfits - Fantasy, Universal Animation Library',
  heads: { male: 'head_male.glb', female: 'head_female.glb' },
  hair: {
    male: ['hair_buzzed.glb', 'hair_simpleparted.glb', 'hair_long.glb'],
    female: ['hair_buns.glb', 'hair_long.glb', 'hair_buzzedfemale.glb'],
    beard: 'hair_beard.glb',
  },
  outfits: {
    male: ['outfit_male_peasant.glb', 'outfit_male_ranger.glb'],
    female: ['outfit_female_peasant.glb', 'outfit_female_ranger.glb'],
  },
  altTextures: { MI_Peasant: 'tex_peasant_2.ktx2', MI_Ranger: 'tex_ranger_3.ktx2' },
  anims: 'anims.glb',
  clips: CLIPS,
};
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log('done');
