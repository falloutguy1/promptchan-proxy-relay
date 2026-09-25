# Wrap .glb models as JSON (base64) so hosts that only serve web data types can deliver them;
# the game decodes the wrapper and hands the bytes to GLTFLoader.parse.
#   python3 glb_to_json.py a.glb [b.glb ...]   ->  a.glb.json ...
import base64, json, sys

for path in sys.argv[1:]:
    data = open(path, 'rb').read()
    assert data[:4] == b'glTF', path + ' is not a binary glTF file'
    with open(path + '.json', 'w') as f:
        json.dump({'format': 'glb-base64', 'bytes': len(data), 'glb': base64.b64encode(data).decode('ascii')}, f)
    print(path + '.json', len(data), 'bytes')
