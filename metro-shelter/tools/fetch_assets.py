#!/usr/bin/env python3
"""Download the CC0 Poly Haven assets used by Metro Shelter.

All assets come from https://polyhaven.com (CC0 1.0 public domain).
Run from metro-shelter/:  python3 tools/fetch_assets.py
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets-src')
API = 'https://api.polyhaven.com'

# model id -> texture resolution
MODELS = {
    'barrel_stove': '2k', 'Barrel_01': '1k', 'Barrel_02': '1k', 'barrel_03': '1k',
    'wooden_crate_01': '1k', 'wooden_crate_02': '1k', 'old_military_crate': '1k',
    'wooden_military_crate': '1k', 'cardboard_box_01': '1k', 'plastic_crate_01': '1k',
    'metal_jerrycan': '1k', 'plastic_jerrycan': '1k', 'portable_generator': '2k',
    'vintage_radio_transceiver': '2k', 'old_bed_frame': '1k', 'metal_office_desk': '1k',
    'metal_stool_01': '1k', 'worn_metal_rack': '1k', 'steel_frame_shelves_01': '1k',
    'metal_toolbox': '1k', 'hanging_industrial_lamp': '1k', 'caged_hanging_light': '1k',
    'industrial_caged_sconce': '1k', 'trashbag': '1k', 'russian_food_cans_01': '1k',
    'long_life_food': '1k', 'medical_box': '1k', 'ammo_box': '1k', 'old_gas_mask': '1k',
    'service_pistol': '2k', 'street_rat': '1k', 'planter_box_01': '1k', 'planter_box_02': '1k',
    'seeding_tray_01': '1k', 'cement_bag': '1k', 'pot_enamel_01': '1k', 'can_rusted': '1k',
    'propane_tank': '1k', 'old_tyre': '1k', 'concrete_road_barrier': '1k',
    'korean_fire_extinguisher_01': '1k', 'wall_clock': '1k', 'folding_wooden_stool': '1k',
    'WoodenTable_03': '1k', 'plastic_monobloc_chair_01': '1k', 'Lantern_01': '1k',
    'industrial_pastic_container': '1k', 'plastic_bottle_gallon': '1k', 'metal_trash_can': '1k',
    'mousetrap': '1k', 'sledgehammer_01': '1k', 'wooden_ladder': '1k', 'vintage_flashlight': '1k',
    'modular_electric_cables': '1k', 'modular_industrial_pipes_01': '1k', 'tool_cart': '1k',
    'old_military_compressor': '1k', 'binder_notebook': '1k', 'cassette_player': '1k',
    'weed_plant_02': '1k', 'potted_plant_04': '1k', 'rusted_wheel_rim_01': '1k',
}
# texture id -> resolution
TEXTURES = {
    'marble_01': '2k', 'slab_tiles': '2k', 'long_white_tiles': '2k', 'granite_tile': '2k', 'worn_plaster_wall': '2k',
    'concrete_floor_worn_001': '2k', 'rusty_metal_04': '2k', 'dirty_concrete': '2k',
    'weathered_planks': '2k', 'rusty_corrugated_iron': '2k', 'rusty_metal_02': '1k',
    'concrete_wall_008': '2k', 'gravel_floor_02': '2k', 'damaged_plaster': '2k',
    'concrete_debris': '2k', 'rough_concrete': '2k',
}
HDRIS = {'concrete_tunnel': '1k'}


def get_json(url):
    out = subprocess.run(['curl', '-sSfL', '--retry', '4', url], check=True, capture_output=True)
    return json.loads(out.stdout)


def dl(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    subprocess.run(['curl', '-sSfL', '--retry', '4', '-o', dest, url], check=True)


def fetch_model(mid, res):
    files = get_json(f'{API}/files/{mid}')['gltf']
    entry = files.get(res) or files[sorted(files)[0]]
    g = entry['gltf']
    out = os.path.join(ROOT, 'models', mid)
    dl(g['url'], os.path.join(out, os.path.basename(g['url'])))
    for rel, info in g.get('include', {}).items():
        dl(info['url'], os.path.join(out, rel))
    return mid


def fetch_texture(tid, res):
    files = get_json(f'{API}/files/{tid}')
    out = os.path.join(ROOT, 'textures', tid)
    maps = {'diff': files['Diffuse'], 'nor': files['nor_gl'], 'arm': files['arm']}
    for key, m in maps.items():
        dl(m[res]['jpg']['url'], os.path.join(out, f'{key}_{res}.jpg'))
    return tid


def fetch_hdri(hid, res):
    files = get_json(f'{API}/files/{hid}')
    dl(files['hdri'][res]['hdr']['url'], os.path.join(ROOT, 'hdri', f'{hid}_{res}.hdr'))
    return hid


if __name__ == '__main__':
    jobs = [(fetch_model, k, v) for k, v in MODELS.items()]
    jobs += [(fetch_texture, k, v) for k, v in TEXTURES.items()]
    jobs += [(fetch_hdri, k, v) for k, v in HDRIS.items()]
    with ThreadPoolExecutor(8) as ex:
        futs = [ex.submit(f, k, v) for f, k, v in jobs]
        for fu in futs:
            try:
                print('ok', fu.result())
            except Exception as e:  # keep going, report at end
                print('FAILED', e, file=sys.stderr)
