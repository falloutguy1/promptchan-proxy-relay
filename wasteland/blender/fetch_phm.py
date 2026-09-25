# Download Poly Haven (CC0) models as glTF at 1k (the .gltf, its .bin and textures)
import json, os, subprocess, sys
res = sys.argv[1]
credits = json.load(open('credits.json')) if os.path.exists('credits.json') else {}
for aid in sys.argv[2:]:
    d = f'phm/{aid}'
    os.makedirs(d, exist_ok=True)
    files = json.loads(subprocess.check_output(['curl', '-s', '-m', '60', f'https://api.polyhaven.com/files/{aid}']))
    info = json.loads(subprocess.check_output(['curl', '-s', '-m', '60', f'https://api.polyhaven.com/info/{aid}']))
    credits[aid] = {'name': info.get('name'), 'authors': list(info.get('authors', {}).keys()), 'url': f'https://polyhaven.com/a/{aid}', 'license': 'CC0', 'type': 'model'}
    g = files['gltf'][res]['gltf']
    todo = [(os.path.join(d, os.path.basename(g['url'])), g['url'])] + [(os.path.join(d, p), v['url']) for p, v in g.get('include', {}).items()]
    for path, url in todo:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if not os.path.exists(path):
            subprocess.check_call(['curl', '-s', '-m', '300', '-o', path, url])
    print(aid, len(todo), 'files', sum(os.path.getsize(p) for p, _ in todo) // 1024, 'KB', flush=True)
json.dump(credits, open('credits.json', 'w'), indent=1)
