# Download Poly Haven (CC0) texture maps at a given resolution: diffuse, GL normal, ARM (AO/rough/metal), displacement
import json, os, subprocess, sys
res = sys.argv[1]
ids = sys.argv[2:]
credits = json.load(open('credits.json')) if os.path.exists('credits.json') else {}
for aid in ids:
    os.makedirs(f'ph/{aid}', exist_ok=True)
    files = json.loads(subprocess.check_output(['curl', '-s', '-m', '60', f'https://api.polyhaven.com/files/{aid}']))
    info = json.loads(subprocess.check_output(['curl', '-s', '-m', '60', f'https://api.polyhaven.com/info/{aid}']))
    credits[aid] = {'name': info.get('name'), 'authors': list(info.get('authors', {}).keys()), 'dimensions_mm': info.get('dimensions'), 'url': f'https://polyhaven.com/a/{aid}', 'license': 'CC0'}
    for key, short in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('arm', 'arm'), ('Displacement', 'disp')):
        if key not in files:
            print('  missing', aid, key); continue
        d = files[key][res]
        fmt = 'jpg' if 'jpg' in d else 'png'
        out = f'ph/{aid}/{short}.{fmt}'
        if not os.path.exists(out):
            subprocess.check_call(['curl', '-s', '-m', '300', '-o', out, d[fmt]['url']])
        print(aid, short, os.path.getsize(out))
json.dump(credits, open('credits.json', 'w'), indent=1)
