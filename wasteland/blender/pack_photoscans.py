# Blender 4.5 (headless): turn downloaded CC0 photoscanned PBR sets (Poly Haven) into the game's texture
# layouts. Sources are 2k maps: diff (colour), nor (OpenGL normal), arm (AO/rough/metal), disp (height).
#   blender -b --factory-startup --python pack_photoscans.py -- SRC_DIR OUT_DIR
# Terrain sets: NAME_c (RGB colour, A roughness) and NAME_n (RGB normal, A = 0.3 + 0.7 * height).
# Other sets:   NAME_c, NAME_n, NAME_orm (R AO, G roughness, B metalness).
# `rep` tiles the scan k x k inside one texture so its real-world size matches the game's UV scale.
import bpy, os, sys
import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = os.path.abspath(ARGS[0]), os.path.abspath(ARGS[1])
ONLY = set(ARGS[2].split(',')) if len(ARGS) > 2 and ARGS[2] else None
os.makedirs(OUT, exist_ok=True)

# name -> (scan, repeats, options). Real sizes: see credits.json (dimensions_mm)
SETS = {
    'dirt': ('dry_ground_rocks', 1, dict(terrain=True)),        # 4 m scan on a 6.25 m terrain tile
    'cracked': ('mud_cracked_dry_03', 2, dict(terrain=True)),   # 1.5 m scan, 2x2 on an 8.9 m tile
    'grass': ('forrest_ground_01', 2, dict(terrain=True)),      # 2 m scan, 2x2 on a 4.5 m tile
    'rock': ('rock_face_03', 1, dict(terrain=True)),            # 2.7 m scan on a 10.4 m tile (cliff scale)
    'concrete': ('dirty_concrete', 1, {}),                     # props map 2 m per tile
    'brick': ('brick_4', 4, {}),                               # 0.5 m scan -> 2 m
    'corrugated': ('worn_corrugated_iron', 1, {}),
    'rust': ('rust_coarse_01', 1, {}),
    'wood': ('old_planks_02', 1, dict(rot90=True)),            # the game's planks run along u
    'bark': ('pine_bark', 1, dict(sizes=(512, 256))),
    'cloth': ('hessian_230', 4, dict(sizes=(512, 256))),
    'paint': ('green_metal_rust', 2, dict(paint=True)),       # 1 m scan -> 2 m
    'road': ('asphalt_02', 4, dict(road=True)),
}
PAINTS = {'c': (0.55, 0.16, 0.12), 'c_teal': (0.25, 0.5, 0.47), 'c_cream': (0.86, 0.82, 0.72), 'c_yellow': (0.8, 0.62, 0.2)}


def load(path):
    """image as top-down float32 HxWx4 of the stored values (no colour management)"""
    im = bpy.data.images.load(path)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[::-1].copy()


def resize(a, size):
    """area-average resize of a square top-down array to size x size (via Blender's scaler)"""
    h, w = a.shape[:2]
    if h == size:
        return a.copy()
    im = bpy.data.images.new('tmp', w, h, alpha=True, float_buffer=True)
    im.pixels.foreach_set(a[::-1].astype(np.float32).ravel())
    im.scale(size, size)
    b = np.empty(size * size * 4, np.float32)
    im.pixels.foreach_get(b)
    bpy.data.images.remove(im)
    return b.reshape(size, size, 4)[::-1].copy()


def tiled(a, size, rep):
    t = resize(a, size // rep)
    return np.tile(t, (rep, rep, 1))


def renorm(n):
    v = n[..., :3] * 2 - 1
    v /= np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-6)
    out = n.copy()
    out[..., :3] = v * 0.5 + 0.5
    return out


def rot90_normal(n):
    """rotate a top-down OpenGL normal map 90 degrees counter-clockwise, vectors included"""
    r = np.rot90(n).copy()
    x, y = r[..., 0].copy(), r[..., 1].copy()
    r[..., 0] = 1 - y
    r[..., 1] = x
    return r


def save_png(a, path):
    h, w = a.shape[:2]
    im = bpy.data.images.new('o', w, h, alpha=True)
    im.pixels.foreach_set(np.clip(a[::-1], 0, 1).astype(np.float32).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def value_noise(size, cells, seed):
    """tileable smooth noise in [0, 1]"""
    rng = np.random.default_rng(seed)
    g = rng.random((cells, cells)).astype(np.float32)
    x = np.arange(size) / size * cells
    i0 = np.floor(x).astype(int) % cells
    i1 = (i0 + 1) % cells
    f = x - np.floor(x)
    f = f * f * (3 - 2 * f)
    rows = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
    rows1 = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
    return rows * (1 - f)[:, None] + rows1 * f[:, None]


def fbm(size, seed, octaves=(4, 8, 16, 32)):
    acc, amp, tot = np.zeros((size, size), np.float32), 1.0, 0.0
    for k, c in enumerate(octaves):
        acc += value_noise(size, c, seed + k) * amp
        tot += amp
        amp *= 0.5
    return acc / tot


def lum(c):
    return c[..., 0] * 0.3 + c[..., 1] * 0.59 + c[..., 2] * 0.11


def paint_variants(c):
    """the scan is green paint with rust drips: recolour the paint (green over red) and keep the rust"""
    mask = smoothstep(0.035, -0.03, c[..., 0] - c[..., 1])
    L = lum(c) / max(1e-4, float(np.percentile(lum(c)[mask > 0.5], 55)))
    out = {}
    for key, col in PAINTS.items():
        # sRGB-ish multiply keeps the scan's brush marks and grime
        pc = np.stack([np.clip(L * col[i], 0, 1) for i in range(3)], -1)
        rgb = c[..., :3] * (1 - mask[..., None]) + pc * mask[..., None]
        out[key] = rgb
    return out, mask


def road_composite(c, n, orm, dirt_c, dirt_n, size):
    """asphalt scan + worn centre dashes, edge lines and sand drifting in from the verges.
    u (columns) runs across the road, v (rows) along it; one tile = 10 m of road"""
    u = (np.arange(size) + 0.5) / size
    v = (np.arange(size) + 0.5) / size
    U, V = np.meshgrid(u, v)
    worn = fbm(size, 11)
    grit = fbm(size, 23, (16, 32, 64, 128))
    centre = (np.abs(U - 0.5) < 0.011) & (((V * 6) % 1) < 0.55)
    edge = (np.abs(U - 0.065) < 0.007) | (np.abs(U - 0.935) < 0.007)
    paint_a = (centre * smoothstep(0.34, 0.46, worn) + edge * smoothstep(0.4, 0.52, worn)) * smoothstep(0.25, 0.55, grit)
    paint_col = np.where(centre[..., None], np.array([0.72, 0.58, 0.2]), np.array([0.66, 0.65, 0.6]))
    rgb = c[..., :3] * (1 - paint_a[..., None]) + paint_col * paint_a[..., None]
    sand = np.clip(smoothstep(0.24, 0.02, np.minimum(U, 1 - U)) * 0.9 + smoothstep(0.62, 0.8, worn) * 0.45, 0, 1)
    sand = np.clip(sand * smoothstep(0.2, 0.55, fbm(size, 37, (8, 16, 32, 64)) + sand * 0.4), 0, 1)
    rgb = rgb * (1 - sand[..., None]) + dirt_c[..., :3] * sand[..., None]
    nn = n.copy()
    nn[..., :3] = n[..., :3] * (1 - sand[..., None]) + dirt_n[..., :3] * sand[..., None]
    nn[..., :3] = nn[..., :3] * (1 - paint_a[..., None] * 0.6) + np.array([0.5, 0.5, 1.0]) * paint_a[..., None] * 0.6
    o = orm.copy()
    o[..., 1] = orm[..., 1] * (1 - paint_a * 0.3) + 0.95 * sand * (1 - paint_a)
    o[..., 2] = 0
    return rgb, renorm(nn), o


def write(name, size, c, n, extra):
    base = os.path.join(OUT, f'{name}_%s_{size}.png')
    for k, a in extra.items():
        save_png(a, base % k)


def process(name, scan, rep, opt):
    d = os.path.join(SRC, scan)
    ext = lambda k: next(os.path.join(d, f) for f in os.listdir(d) if f.startswith(k + '.'))
    C, N, A = load(ext('diff')), load(ext('nor')), load(ext('arm'))
    H = load(ext('disp')) if opt.get('terrain') else None
    if opt.get('rot90'):
        C, A = np.rot90(C).copy(), np.rot90(A).copy()
        N = rot90_normal(N)
    sizes = opt.get('sizes', (1024, 512))
    for size in sizes:
        c, n, a = tiled(C, size, rep), renorm(tiled(N, size, rep)), tiled(A, size, rep)
        if opt.get('terrain'):
            h = tiled(H, size, rep)[..., 0]
            lo, hi = np.percentile(h, 1), np.percentile(h, 99)
            h = np.clip((h - lo) / max(1e-4, hi - lo), 0, 1)
            ao = a[..., 0:1]
            cc = np.dstack([c[..., :3] * (0.25 + 0.75 * ao), a[..., 1]])  # the terrain shader has no AO map
            nn = np.dstack([n[..., :3], 0.3 + 0.7 * h])
            write(name, size, cc, nn, {'c': cc, 'n': nn})
        elif opt.get('paint'):
            variants, mask = paint_variants(c)
            orm = a.copy()
            orm[..., 3] = 1
            extra = {k: np.dstack([rgb, np.ones(rgb.shape[:2])]) for k, rgb in variants.items()}
            extra['n'], extra['orm'] = n, orm
            write(name, size, c, n, extra)
        elif opt.get('road'):
            dirt = SETS['dirt']
            dd = os.path.join(SRC, dirt[0])
            dext = lambda k: next(os.path.join(dd, f) for f in os.listdir(dd) if f.startswith(k + '.'))
            dc, dn = tiled(load(dext('diff')), size, 2), renorm(tiled(load(dext('nor')), size, 2))
            rgb, nn, o = road_composite(c, n, a, dc, dn, size)
            o[..., 3] = 1
            write(name, size, c, n, {'c': np.dstack([rgb, np.ones(rgb.shape[:2])]), 'n': nn, 'orm': o})
        else:
            orm = a.copy()
            orm[..., 3] = 1
            c[..., 3] = 1
            write(name, size, c, n, {'c': c, 'n': n, 'orm': orm})
        print('SET', name, size, 'from', scan, 'rep', rep, flush=True)


for name, (scan, rep, opt) in SETS.items():
    if ONLY and name not in ONLY:
        continue
    process(name, scan, rep, opt)
print('DONE', flush=True)
