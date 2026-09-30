// Downloads the CC0 character sources (Quaternius, quaternius.com) into
// tools/.cache/chars/: the Universal Animation Library 1 + 2, the Universal Base
// Characters and the Modular Character Outfits (Fantasy). Only the free
// "Standard" tier of each pack is used. The packs are distributed through
// itch.io, so this follows the browser's "No thanks, just take me to the
// downloads" flow with curl (which honours HTTPS_PROXY). Re-running skips packs
// that are already unpacked.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = process.env.CHARS_DIR || join(here, '.cache', 'chars');
const only = process.argv.slice(2); // optional pack keys
mkdirSync(root, { recursive: true });

export const PACKS = [
  { key: 'ual1', slug: 'universal-animation-library', name: 'Universal Animation Library', page: 'https://quaternius.com/packs/universalanimationlibrary.html' },
  { key: 'ual2', slug: 'universal-animation-library-2', name: 'Universal Animation Library 2', page: 'https://quaternius.com/packs/universalanimationlibrary2.html' },
  { key: 'ubc', slug: 'universal-base-characters', name: 'Universal Base Characters', page: 'https://quaternius.com/packs/universalbasecharacters.html' },
  { key: 'outfits', slug: 'modular-character-outfits-fantasy', name: 'Modular Character Outfits - Fantasy', page: 'https://quaternius.com/packs/modularcharacteroutfitsfantasy.html' },
];

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

async function curl(args) {
  const { stdout } = await run('curl', ['-sSfL', '-A', UA, ...args], { maxBuffer: 64 << 20 });
  return stdout;
}
const csrf = (html) => /name="csrf_token" value="([^"]+)"/.exec(html)?.[1];

async function fetchPack(p) {
  const dir = join(root, p.key);
  if (existsSync(dir) && readdirSync(dir).some((f) => !f.endsWith('.zip'))) { console.log('have', p.key); return; }
  mkdirSync(dir, { recursive: true });
  const jar = join(dir, '.cookies');
  const game = `https://quaternius.itch.io/${p.slug}`;
  const page = await curl(['-c', jar, '-b', jar, game]);
  // the purchase lightbox's "just take me to the downloads" link
  const dl = JSON.parse(await curl(['-c', jar, '-b', jar, '-X', 'POST', '-H', 'X-Requested-With: XMLHttpRequest', '-H', `Referer: ${game}`,
    '--data-urlencode', `csrf_token=${csrf(page)}`, `${game}/download_url`])).url;
  const dpage = await curl(['-c', jar, '-b', jar, '-H', `Referer: ${game}`, dl]);
  const ids = [...dpage.matchAll(/data-upload_id="(\d+)"/g)].map((m) => m[1]);
  const names = [...dpage.matchAll(/<strong title="([^"]+)" class="name"/g)].map((m) => m[1]);
  const i = names.findIndex((n) => /\[Standard\]/.test(n));
  if (i < 0) throw new Error(`no free Standard upload for ${p.slug}: ${names.join(', ')}`);
  const file = JSON.parse(await curl(['-c', jar, '-b', jar, '-X', 'POST', '-H', 'X-Requested-With: XMLHttpRequest', '-H', `Referer: ${dl}`,
    '--data-urlencode', `csrf_token=${csrf(dpage)}`, `${game}/file/${ids[i]}?source=game_download&after_download_lightbox=1&as_props=1`]));
  if (!file.url) throw new Error(`no download url for ${p.slug}: ${JSON.stringify(file).slice(0, 200)}`);
  const zip = join(dir, 'pack.zip');
  await curl(['-o', zip, file.url]); // the signed URL is valid for about a minute
  await run('unzip', ['-q', '-o', zip, '-d', dir], { maxBuffer: 64 << 20 });
  rmSync(zip); rmSync(jar, { force: true });
  console.log('fetched', p.key, names[i]);
}

for (const p of PACKS) if (!only.length || only.includes(p.key)) await fetchPack(p);
writeFileSync(join(root, 'sources.json'), JSON.stringify(PACKS.map((p) => ({
  key: p.key, name: p.name, url: p.page, source: 'Quaternius', authors: ['Quaternius'], license: 'CC0 1.0',
})), null, 1));
