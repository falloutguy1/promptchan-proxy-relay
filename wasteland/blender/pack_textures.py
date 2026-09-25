# Bundle assets/tex/*.webp into a few base64 JSON packs per resolution tier, for hosts that cap the
# number of files (claude.ai artifacts). The page reads assets/pack/manifest.json when it exists.
#   python3 pack_textures.py assets/tex assets/pack
import base64, json, os, re, sys
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
CHUNK = 7 * 1024 * 1024  # base64 bytes per pack file
tiers = {'hi': [], 'lo': []}
for f in sorted(os.listdir(src)):
    m = re.match(r'(.+)_(\d+)\.webp$', f)
    if not m:
        continue
    name, size = m.group(1), int(m.group(2))
    half = name.startswith(('bark_', 'cloth_', 'prop_'))  # loaded at half the tier's size
    if name.startswith('rocks1_'):  # the far-rock atlas is 256 on every tier
        want = {'hi': 256, 'lo': 256}
    else:
        want = {'hi': 512 if half else 1024, 'lo': 256 if half else 512}
    placed = False
    for t in tiers:
        if size == want[t]:
            tiers[t].append(f)
            placed = True
    assert placed, 'no tier loads ' + f
man = {'format': 'webp-pack-base64'}
for t, files in tiers.items():
    packs, cur, n = [], {}, 0
    for f in files:
        b = base64.b64encode(open(os.path.join(src, f), 'rb').read()).decode('ascii')
        if cur and n + len(b) > CHUNK:
            packs.append(cur)
            cur, n = {}, 0
        cur[f] = b
        n += len(b)
    if cur:
        packs.append(cur)
    man[t] = []
    for i, p in enumerate(packs):
        fn = f'{t}_{i}.json'
        json.dump({'files': p}, open(os.path.join(out, fn), 'w'))
        man[t].append(fn)
        print(fn, len(p), 'files', os.path.getsize(os.path.join(out, fn)) // 1024, 'KB')
json.dump(man, open(os.path.join(out, 'manifest.json'), 'w'), indent=1)
print('tiers', {t: len(v) for t, v in tiers.items()})
