#!/usr/bin/env python3
"""Encodes the tree textures shipped with ez-tree (MIT; bark scans credited in
CREDITS.md) to KTX2. Leaf cut-outs get their colour dilated into the transparent
area so mip-mapping and alpha-testing don't produce dark fringes.

Source files: copy node_modules/@dgreenheck/ez-tree/src/lib/assets/* to tools/.cache/ez/
Usage: TOKTX=... python3 tools/build_trees.py
"""
import os, subprocess
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", ".cache", "ez")
WORK = os.path.join(ROOT, "tools", ".cache", "ezpng")
OUT = os.path.join(ROOT, "assets", "trees")
TOKTX = os.environ.get("TOKTX", "toktx")


def dilate(rgba, iters=24):
    rgb = rgba[..., :3].astype(np.float32)
    a = rgba[..., 3] > 127
    filled = a.copy()
    for _ in range(iters):
        acc = np.zeros_like(rgb); cnt = np.zeros(a.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
            m = np.roll(np.roll(filled, dy, 0), dx, 1)
            c = np.roll(np.roll(rgb, dy, 0), dx, 1)
            acc += c * m[..., None]; cnt += m
        grow = (~filled) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        filled |= grow
    out = rgba.copy()
    out[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return out


def tok(dst, src, kind):
    if os.path.exists(dst):
        return
    a = [TOKTX, "--t2", "--genmipmap"]
    if kind == "color":
        a += ["--encode", "etc1s", "--clevel", "2", "--qlevel", "220", "--assign_oetf", "srgb"]
    elif kind == "normal":
        a += ["--encode", "uastc", "--uastc_quality", "2", "--uastc_rdo_l", "3", "--zcmp", "19", "--assign_oetf", "linear"]
    else:
        a += ["--encode", "etc1s", "--clevel", "2", "--qlevel", "200", "--assign_oetf", "linear"]
    subprocess.run(a + [dst, src], check=True)


def main():
    os.makedirs(WORK, exist_ok=True); os.makedirs(OUT, exist_ok=True)
    for leaf in ("aspen", "pine", "oak", "ash"):
        im = np.asarray(Image.open(os.path.join(SRC, "leaves", f"{leaf}_color.png")).convert("RGBA"))
        p = os.path.join(WORK, f"leaf_{leaf}.png")
        Image.fromarray(dilate(im)).save(p)
        tok(os.path.join(OUT, f"leaf_{leaf}.ktx2"), p, "color")
    for bark in ("birch", "pine", "oak"):
        col = os.path.join(SRC, "bark", f"{bark}_color_1k.jpg")
        c = os.path.join(WORK, f"bark_{bark}_diff.png"); Image.open(col).convert("RGB").save(c)
        tok(os.path.join(OUT, f"bark_{bark}_diff.ktx2"), c, "color")
        n = os.path.join(WORK, f"bark_{bark}_nor.png"); Image.open(os.path.join(SRC, "bark", f"{bark}_normal_1k.jpg")).convert("RGB").save(n)
        tok(os.path.join(OUT, f"bark_{bark}_nor.ktx2"), n, "normal")
        ao = np.asarray(Image.open(os.path.join(SRC, "bark", f"{bark}_ao_1k.jpg")).convert("L"))
        ro = np.asarray(Image.open(os.path.join(SRC, "bark", f"{bark}_roughness_1k.jpg")).convert("L"))
        m = os.path.join(WORK, f"bark_{bark}_arm.png"); Image.fromarray(np.dstack([ao, ro, np.zeros_like(ao)])).save(m)
        tok(os.path.join(OUT, f"bark_{bark}_arm.ktx2"), m, "data")
    print("trees ok")


if __name__ == "__main__":
    main()
