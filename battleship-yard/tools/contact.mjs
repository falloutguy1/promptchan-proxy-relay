// Builds a labelled contact sheet from a directory of thumbnails.
import sharp from 'sharp'; import fs from 'fs'; import path from 'path';
const [dir, out, cols='8', size='192'] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter(f=>/\.(png|jpg)$/.test(f)).sort();
const C=+cols, Z=+size, R=Math.ceil(files.length/C);
const comps = [];
for (let i=0;i<files.length;i++){
  const x=(i%C)*Z, y=Math.floor(i/C)*(Z+20);
  comps.push({input: await sharp(path.join(dir,files[i])).resize(Z,Z).png().toBuffer(), left:x, top:y});
  const label = Buffer.from(`<svg width="${Z}" height="20"><rect width="100%" height="100%" fill="#000"/><text x="3" y="14" font-size="12" fill="#fff" font-family="sans-serif">${files[i].replace(/\.\w+$/,'')}</text></svg>`);
  comps.push({input: label, left:x, top:y+Z});
}
await sharp({create:{width:C*Z,height:R*(Z+20),channels:3,background:'#222'}}).composite(comps).jpeg({quality:85}).toFile(out);
