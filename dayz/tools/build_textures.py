#!/usr/bin/env python3
"""Offline texture / HDRI pipeline for the Day Z location.

Downloads CC0 scanned materials + HDRI from Poly Haven (https://polyhaven.com,
all assets CC0 1.0) and encodes them for the browser:

  * colour maps       -> KTX2 / Basis ETC1S, sRGB transfer, mipmapped
  * normal maps       -> KTX2 / Basis UASTC (RDO) + zstd, linear
  * AO/rough/metal    -> KTX2 / Basis ETC1S, linear (ARM packing R=AO G=rough B=metal)
  * terrain layers    -> three KTX2 *array* textures (albedo / normal / AO-rough-height)
  * HDRI              -> 1k .hdr for PMREM lighting + 4k sky-hemisphere JPEG backdrop
                         + sun direction JSON extracted from the brightest texel

Requires Pillow + numpy and KTX-Software's `toktx` (set TOKTX=/path/to/toktx).
Usage:  python3 tools/build_textures.py            (idempotent; caches downloads)
"""
import json, os, subprocess, sys, urllib.request, math
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get("ASSET_CACHE", os.path.join(ROOT, "tools", ".cache"))
OUT_TEX = os.path.join(ROOT, "assets", "tex")
OUT_HDR = os.path.join(ROOT, "assets", "hdri")
TOKTX = os.environ.get("TOKTX", "toktx")
API = "https://api.polyhaven.com"

# name -> (polyhaven id, resolution). Resolution follows how close the player gets.
MATERIALS = {
    "plaster":     ("painted_plaster_wall", "2k"),
    "plasterBrick": ("red_brick_plaster_patch_02", "2k"),
    "concrete":    ("dirty_concrete", "2k"),
    "roofSheet":   ("asbestos_sheet", "2k"),
    "paintedWood": ("wood_peeling_paint_weathered", "2k"),
    "door":        ("rough_pine_door", "2k"),
    "floor":       ("wood_floor_worn", "2k"),
    "wallpaper":   ("decrepit_wallpaper", "2k"),
    "ceiling":     ("ceiling_interior", "1k"),
    "planks":      ("weathered_planks", "2k"),
    "brownPlanks": ("weathered_brown_planks", "2k"),
    "rust":        ("rusty_metal_02", "1k"),
    "greenMetal":  ("green_metal_rust", "1k"),
    "rock":        ("mossy_rock", "2k"),
}
# Terrain splat layers, in array order (index used by the terrain shader)
TERRAIN = [
    ("grass",  "rocky_terrain_02"),
    ("meadow", "sparse_grass"),
    ("forest", "brown_mud_leaves_01"),
    ("gravel", "grass_path_3"),
    ("mud",    "brown_mud_02"),
    ("rock",   "mossy_rock"),
]
TERRAIN_RES = 2048
HDRI = "kloofendal_38d_partly_cloudy_puresky"


def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "dayz-asset-pipeline/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                f.write(r.read())
            os.replace(tmp, dest)
            return dest
        except Exception as e:  # network hiccup -> retry
            print("  retry", url, e)
    raise RuntimeError("download failed: " + url)


def api(path):
    cache = os.path.join(CACHE, "api", path.replace("/", "_") + ".json")
    fetch(f"{API}/{path}", cache)
    return json.load(open(cache))


def maps_for(pid, res):
    files = api(f"files/{pid}")
    def u(key, fmt="jpg"):
        return files[key][res][fmt]["url"]
    out = {}
    for key, name in (("Diffuse", "diff"), ("nor_gl", "nor"), ("arm", "arm"), ("Displacement", "disp")):
        if key in files:
            out[name] = fetch(u(key), os.path.join(CACHE, "tex", pid, f"{name}_{res}.jpg"))
    if "arm" not in out:  # build ARM from separate AO / Rough maps
        ao = fetch(u("AO"), os.path.join(CACHE, "tex", pid, f"ao_{res}.jpg")) if "AO" in files else None
        ro = fetch(u("Rough"), os.path.join(CACHE, "tex", pid, f"rough_{res}.jpg"))
        r = np.asarray(Image.open(ro).convert("L"))
        a = np.asarray(Image.open(ao).convert("L")) if ao else np.full_like(r, 255)
        arm = np.dstack([a, r, np.zeros_like(r)])
        p = os.path.join(CACHE, "tex", pid, f"arm_{res}.png")
        Image.fromarray(arm).save(p)
        out["arm"] = p
    return out


def toktx(dst, srcs, kind, layers=None):
    args = [TOKTX, "--t2", "--genmipmap"]
    if kind == "color":
        args += ["--encode", "etc1s", "--clevel", "2", "--qlevel", "200", "--assign_oetf", "srgb"]
    elif kind == "normal":
        args += ["--encode", "uastc", "--uastc_quality", "2", "--uastc_rdo_l", "4", "--uastc_rdo_d", "8192",
                 "--zcmp", "19", "--assign_oetf", "linear"]
    else:  # linear data (AO / roughness / metal / height)
        args += ["--encode", "etc1s", "--clevel", "2", "--qlevel", "220", "--assign_oetf", "linear"]
    if layers:
        args += ["--layers", str(layers)]
    subprocess.run(args + [dst] + srcs, check=True)


def to_png(src, dst, size=None, mode="RGB"):
    im = Image.open(src).convert(mode)
    if size and im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    im.save(dst)
    return dst


def build_material(name, pid, res, manifest):
    maps = maps_for(pid, res)
    info = api(f"info/{pid}")
    dims = info.get("dimensions") or [2000, 2000]
    work = os.path.join(CACHE, "png", name)
    os.makedirs(work, exist_ok=True)
    entry = {"source": f"https://polyhaven.com/a/{pid}", "license": "CC0-1.0",
             "size_m": [dims[0] / 1000.0, dims[1] / 1000.0], "res": res, "maps": {}}
    for m, kind in (("diff", "color"), ("nor", "normal"), ("arm", "data")):
        dst = os.path.join(OUT_TEX, f"{name}_{m}.ktx2")
        if not os.path.exists(dst):
            png = to_png(maps[m], os.path.join(work, f"{m}.png"))
            toktx(dst, [png], kind)
        entry["maps"][m] = f"assets/tex/{name}_{m}.ktx2"
    manifest["materials"][name] = entry
    print("material", name, "ok")


def build_terrain(manifest):
    work = os.path.join(CACHE, "png", "terrain")
    os.makedirs(work, exist_ok=True)
    diffs, nors, arhs, layers = [], [], [], []
    for name, pid in TERRAIN:
        maps = maps_for(pid, "2k")
        diffs.append(to_png(maps["diff"], os.path.join(work, f"{name}_diff.png"), TERRAIN_RES))
        # normals at half res: terrain relief reads at mid distance, and UASTC arrays are large
        nors.append(to_png(maps["nor"], os.path.join(work, f"{name}_nor.png"), TERRAIN_RES // 2))
        # AO / roughness / height packing: R=AO G=rough B=height (used for height blending)
        arm = np.asarray(Image.open(maps["arm"]).convert("RGB").resize((TERRAIN_RES,) * 2, Image.LANCZOS))
        disp = np.asarray(Image.open(maps["disp"]).convert("L").resize((TERRAIN_RES,) * 2, Image.LANCZOS))
        p = os.path.join(work, f"{name}_arh.png")
        Image.fromarray(np.dstack([arm[..., 0], arm[..., 1], disp])).save(p)
        arhs.append(p)
        # mean albedo, used to tint distant terrain so the far field keeps the layer's colour
        mean = np.asarray(Image.open(diffs[-1]).convert("RGB").resize((8, 8))).reshape(-1, 3).mean(0) / 255
        info = api(f"info/{pid}")
        layers.append({"name": name, "source": f"https://polyhaven.com/a/{pid}", "license": "CC0-1.0",
                       "size_m": (info.get("dimensions") or [2000])[0] / 1000.0, "mean_srgb": mean.round(4).tolist()})
    for tag, srcs, kind in (("diff", diffs, "color"), ("nor", nors, "normal"), ("arh", arhs, "data")):
        dst = os.path.join(OUT_TEX, f"terrain_{tag}.ktx2")
        if not os.path.exists(dst):
            toktx(dst, srcs, kind, layers=len(srcs))
    manifest["terrain"] = {"layers": layers,
                           "maps": {t: f"assets/tex/terrain_{t}.ktx2" for t in ("diff", "nor", "arh")}}
    print("terrain arrays ok")


def read_hdr(path):
    """Minimal Radiance RGBE reader (new-style RLE) -> float32 HxWx3."""
    with open(path, "rb") as f:
        data = f.read()
    hdr_end = data.index(b"\n\n") + 2
    line_end = data.index(b"\n", hdr_end)
    dims = data[hdr_end:line_end].split()
    h, w = int(dims[1]), int(dims[3])
    pos = line_end + 1
    img = np.zeros((h, w, 4), np.uint8)
    buf = np.frombuffer(data, np.uint8)
    for y in range(h):
        pos += 4  # scanline header 2 2 hi lo
        for c in range(4):
            x = 0
            while x < w:
                n = int(buf[pos]); pos += 1
                if n > 128:
                    n -= 128
                    img[y, x:x + n, c] = buf[pos]; pos += 1
                else:
                    img[y, x:x + n, c] = buf[pos:pos + n]; pos += n
                x += n
    e = img[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0).astype(np.float32)
    return img[..., :3].astype(np.float32) * scale[..., None]


def build_hdri(manifest):
    files = api(f"files/{HDRI}")
    os.makedirs(OUT_HDR, exist_ok=True)
    light = fetch(files["hdri"]["1k"]["hdr"]["url"], os.path.join(OUT_HDR, f"sky_1k.hdr"))
    big = fetch(files["hdri"]["4k"]["hdr"]["url"], os.path.join(CACHE, "hdri", f"{HDRI}_4k.hdr"))
    rgb = read_hdr(big)
    h, w, _ = rgb.shape
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    y, x = np.unravel_index(np.argmax(lum), lum.shape)
    # three.js equirect lookup: u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5 (v up)
    u, v = (x + 0.5) / w, (y + 0.5) / h
    phi = (u - 0.5) * 2 * math.pi           # longitude
    theta = (0.5 - v) * math.pi             # elevation
    sun = [math.cos(theta) * math.cos(phi), math.sin(theta), math.cos(theta) * math.sin(phi)]
    # Sun colour/irradiance: integrate the disc (pixels above 30% of max)
    mask = lum > lum.max() * 0.3
    solid = (2 * math.pi / w) * (math.pi / h) * np.cos((0.5 - (np.nonzero(mask)[0] + 0.5) / h) * math.pi)
    E = (rgb[mask] * solid[:, None]).sum(0)
    # Sky backdrop: upper hemisphere (+ a strip below the horizon), tone-compressed into sRGB JPEG.
    # The shader decodes it back with the stored exposure so it stays consistent with the HDR lighting.
    strip = int(h * 0.56)
    sky = rgb[:strip].copy()
    sky_lum = np.percentile(lum[: h // 2], 99.0)
    exposure = 0.92 / sky_lum
    ldr = np.clip(sky * exposure, 0, 1) ** (1 / 2.2)
    Image.fromarray((ldr * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT_HDR, "sky_4k.jpg"), quality=92)
    manifest["hdri"] = {"source": f"https://polyhaven.com/a/{HDRI}", "license": "CC0-1.0",
                        "light": "assets/hdri/sky_1k.hdr", "backdrop": "assets/hdri/sky_4k.jpg",
                        "backdrop_v_extent": strip / h, "backdrop_exposure": float(exposure),
                        "sun_dir": [round(s, 5) for s in sun], "sun_irradiance": [float(round(c, 4)) for c in E],
                        "sun_uv": [float(u), float(v)]}
    print("hdri ok sun", sun, "E", E)


def main():
    os.makedirs(OUT_TEX, exist_ok=True)
    mpath = os.path.join(ROOT, "assets", "manifest.json")
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {}
    manifest.setdefault("materials", {})
    with ThreadPoolExecutor(4) as ex:  # download everything in parallel first
        list(ex.map(lambda kv: maps_for(kv[1][0], kv[1][1]), MATERIALS.items()))
        list(ex.map(lambda t: maps_for(t[1], "2k"), TERRAIN))
    with ThreadPoolExecutor(4) as ex:
        list(ex.map(lambda kv: build_material(kv[0], kv[1][0], kv[1][1], manifest), MATERIALS.items()))
    build_terrain(manifest)
    build_hdri(manifest)
    json.dump(manifest, open(mpath, "w"), indent=1)


if __name__ == "__main__":
    main()
