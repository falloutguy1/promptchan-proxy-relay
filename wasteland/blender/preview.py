# contact sheet: each material lit by a low sun from its normal map, tiled 2x2 to expose seams
import bpy, os, sys, glob
import numpy as np
ARGS = sys.argv[sys.argv.index('--') + 1:]
D, OUTP, SIZE = os.path.abspath(ARGS[0]), os.path.abspath(ARGS[1]), int(ARGS[2]) if len(ARGS) > 2 else 512
names = ARGS[3].split(',') if len(ARGS) > 3 else sorted(set(os.path.basename(p).split('_c_')[0] for p in glob.glob(os.path.join(D, '*_c_%d.png' % SIZE))))
def load(p):
    im = bpy.data.images.load(p); a = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(a); a = a.reshape(im.size[1], im.size[0], 4); bpy.data.images.remove(im); return a
tiles = []
L = np.array([-0.55, 0.45, 0.7]); L /= np.linalg.norm(L)
for nm in names:
    c = load(os.path.join(D, f'{nm}_c_{SIZE}.png')); n = load(os.path.join(D, f'{nm}_n_{SIZE}.png'))
    N = n[..., :3] * 2 - 1
    lam = np.clip((N * L).sum(-1), 0, 1)
    shaded = c[..., :3] ** 2.2 * (0.25 + 1.1 * lam[..., None])
    shaded = np.clip(shaded, 0, 1) ** (1 / 2.2)
    half = np.concatenate([c[..., :3], shaded], axis=1)                       # flat albedo | lit
    tiles.append(np.concatenate([half, half], axis=0)[: SIZE * 2, : SIZE * 2]) # stacked twice to show the v seam
row = [np.concatenate([t, np.ones((t.shape[0], 8, 3))], axis=1) for t in tiles]
sheet = np.concatenate(row, axis=1)
im = bpy.data.images.new('sheet', sheet.shape[1], sheet.shape[0], alpha=True)
im.pixels.foreach_set(np.dstack([sheet, np.ones(sheet.shape[:2])]).astype(np.float32).ravel())
im.filepath_raw = OUTP; im.file_format = 'PNG'; im.save(); print('SHEET', names, sheet.shape)
