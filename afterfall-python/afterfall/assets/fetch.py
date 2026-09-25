"""Download and convert the optional CC0 asset pack.

    python fetch_assets.py                 # everything (about 520 MB of downloads, 90 MB installed)
    python fetch_assets.py --only textures # just the Poly Haven textures (about 55 MB)

Textures come from the Poly Haven API. The Quaternius packs are free "name your own price" downloads on
itch.io; if the automatic download fails, download the Standard zips by hand from the pages below and put
them in assets/downloads/, then run this again.
"""
import argparse
import http.cookiejar
import json
import os
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from .catalog import ASSET_DIR, CHARACTERS, CLIPS, CREDITS, FORMAT_VERSION, ITCH_PACKS, TEXTURES

UA = "Mozilla/5.0 (Afterfall asset fetcher)"


# --- networking -------------------------------------------------------------------------------------

def _opener():
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    op.addheaders = [("User-Agent", UA)]
    return op


def _retry(fn, what, tries=4):
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # network hiccups: back off and try again
            if i == tries - 1:
                raise RuntimeError(f"{what}: {e}") from e
            print(f"  {what} failed ({e}), retrying...", flush=True)
            time.sleep(2 ** (i + 1))


def _download(op, url, dest: Path, label, data=None):
    tmp = dest.with_suffix(dest.suffix + ".part")

    def go():
        with op.open(url, data, timeout=60) as r, open(tmp, "wb") as f:
            total = int(r.headers.get("Content-Length") or 0)
            got, last = 0, 0.0
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b)
                got += len(b)
                if total and time.time() - last > .5:
                    last = time.time()
                    print(f"\r  {label}: {got * 100 // total:3d}% of {total >> 20} MB", end="", flush=True)
        if total:
            print(f"\r  {label}: done ({total >> 20} MB)        ", flush=True)
        tmp.replace(dest)

    _retry(go, f"download {label}")


def _json(op, url, data=None):
    return _retry(lambda: json.loads(op.open(url, data, timeout=60).read().decode()), f"fetch {url}")


def itch_download(page, want, dest: Path):
    """Free itch.io download: the same three requests the site's download button makes."""
    op = _opener()
    html = _retry(lambda: op.open(page, timeout=60).read().decode(), f"open {page}")
    tok = re.search(r'csrf_token" value="([^"]*)"', html).group(1)
    dl = _json(op, page + "/download_url", urllib.parse.urlencode({"csrf_token": tok}).encode())["url"]
    html = _retry(lambda: op.open(dl, timeout=60).read().decode(), "open download page")
    uploads = re.findall(r'data-upload_id="(\d+)".{0,800}?class="name"[^>]*>([^<]*)<', html, re.S)
    uid = next((u for u, name in uploads if want in name), None)
    if uid is None:
        raise RuntimeError(f"no '{want}' file on {page} (found {[n for _, n in uploads]})")
    tok = re.search(r'csrf_token" value="([^"]*)"', html).group(1)
    r = _json(op, f"{page}/file/{uid}?source=game_download&after_download_lightbox=1&as_props=1",
              urllib.parse.urlencode({"csrf_token": tok}).encode())
    if "url" not in r:
        raise RuntimeError(f"itch.io refused the download: {r.get('errors')}")
    _download(op, r["url"], dest, dest.name)


# --- textures ---------------------------------------------------------------------------------------

def fetch_textures(res="1k", force=False):
    from PIL import Image
    import numpy as np

    out = ASSET_DIR / "textures"
    raw = ASSET_DIR / "downloads" / "polyhaven"
    out.mkdir(parents=True, exist_ok=True)
    raw.mkdir(parents=True, exist_ok=True)
    op = _opener()
    layers = []
    print(f"Textures from Poly Haven ({len(TEXTURES)} materials, {res})", flush=True)
    for i, (key, pid) in enumerate(TEXTURES, start=1):
        alb_path, nrm_path = out / f"{i:02d}_{key}_albedo.jpg", out / f"{i:02d}_{key}_nrm.png"
        info = _json(op, f"https://api.polyhaven.com/info/{pid}")
        size_m = (info.get("dimensions") or [2000])[0] / 1000.0
        mean = None
        if force or not (alb_path.exists() and nrm_path.exists()):
            files = _json(op, f"https://api.polyhaven.com/files/{pid}")
            src = {}
            for kind, name in (("Diffuse", "diff"), ("nor_gl", "nor"), ("arm", "arm")):
                entry = files[kind].get(res) or files[kind]["1k"]
                dest = raw / f"{pid}_{name}_{res}.jpg"
                if not dest.exists():
                    _download(op, entry["jpg"]["url"], dest, f"{pid} {name}")
                src[name] = dest
            alb = np.asarray(Image.open(src["diff"]).convert("RGB"), dtype=np.float32) / 255
            # store the texture as detail around its average colour: the world's palette supplies the hue,
            # the scan supplies everything else (mortar lines, grain, rust spots, dirt)
            mean = alb.reshape(-1, 3).mean(0)
            detail = np.clip(alb / np.maximum(mean, 1e-3) * .5, 0, 1)
            Image.fromarray((detail * 255 + .5).astype(np.uint8)).save(alb_path, quality=92)
            nrm = np.asarray(Image.open(src["nor"]).convert("RGB"))
            arm = np.asarray(Image.open(src["arm"]).convert("RGB").resize(nrm.shape[1::-1]))
            packed = np.dstack([nrm[..., 0], nrm[..., 1], arm[..., 1], arm[..., 0]])   # nx, ny, roughness, ao
            Image.fromarray(packed, "RGBA").save(nrm_path, optimize=True)
            print(f"  [{i:2d}] {key:10s} {pid}", flush=True)
        if not force and alb_path.exists() and (raw / f"{pid}_diff_{res}.jpg").exists():
            mean = (np.asarray(Image.open(raw / f"{pid}_diff_{res}.jpg").convert("RGB"), dtype=np.float32) / 255).reshape(-1, 3).mean(0)
        layers.append({"key": key, "id": pid, "size_m": size_m, "albedo": alb_path.name, "normal": nrm_path.name,
                       "mean": [round(float(c), 4) for c in mean] if mean is not None else [.5, .5, .5]})
    (out / "materials.json").write_text(json.dumps({"version": FORMAT_VERSION, "layers": layers}, indent=1))


# --- characters -------------------------------------------------------------------------------------

def _zip_path(key):
    return ASSET_DIR / "downloads" / ITCH_PACKS[key][2]


def fetch_character_zips():
    (ASSET_DIR / "downloads").mkdir(parents=True, exist_ok=True)
    failed = []
    for key, (page, want, zname) in ITCH_PACKS.items():
        dest = _zip_path(key)
        if dest.exists():
            continue
        print(f"Downloading {zname} from itch.io", flush=True)
        try:
            itch_download(page, want, dest)
        except Exception as e:
            print(f"  could not download automatically: {e}", flush=True)
            failed.append((page, zname))
    if failed:
        print("\nDownload these free packs by hand (choose 'No thanks, just take me to the downloads', pick the"
              f" Standard zip) and save them in {ASSET_DIR / 'downloads'}:", flush=True)
        for page, zname in failed:
            print(f"  {page}  ->  {zname}")
        return False
    return True


def _extract(zpath: Path, prefix_filter, dest: Path):
    """Extract members whose path contains `prefix_filter`, flattened into dest."""
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    with zipfile.ZipFile(zpath) as z:
        for m in z.infolist():
            if m.is_dir() or prefix_filter not in m.filename:
                continue
            target = dest / Path(m.filename).name
            if not target.exists() or target.stat().st_size != m.file_size:
                with z.open(m) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out)
            n += 1
    if n == 0:
        raise RuntimeError(f"nothing matching '{prefix_filter}' in {zpath.name}")


def _prepare_sources(build: Path, tex_out: Path):
    """Unpack the glTF sources, shrink their textures into tex_out and point the glTF files at them."""
    from PIL import Image

    _extract(_zip_path("characters"), "Base Characters/Godot - UE/", build / "base")
    _extract(_zip_path("characters"), "Hairstyles/Rigged to Head Bone/glTF", build / "hair")
    _extract(_zip_path("outfits"), "Exports/glTF (Godot-Unreal)/Outfits/", build / "outfits")
    _extract(_zip_path("anims1"), "Unreal-Godot/UAL1_Standard.glb", build / "anims")
    _extract(_zip_path("anims2"), "Unreal-Godot/UAL2_Standard.glb", build / "anims")
    tex_out.mkdir(parents=True, exist_ok=True)
    done = {}
    for folder in ("base", "hair", "outfits"):
        for gl in sorted((build / folder).glob("*.gltf")):
            if gl.stem.endswith("_af"):
                continue
            d = json.loads(gl.read_text())
            for im in d.get("images", []):
                src = gl.parent / im["uri"]
                if not src.exists():   # a few files in the pack reference 'X_png.png' for 'X.png'
                    src = gl.parent / im["uri"].replace("_png.png", ".png")
                if src.name not in done:
                    img = Image.open(src)
                    small = "Hair" in src.name or "Eye" in src.name
                    limit = 512 if small else 1024
                    if max(img.size) > limit:
                        img = img.resize((limit, limit), Image.LANCZOS)
                    has_alpha = img.mode in ("RGBA", "LA") and img.getextrema()[-1][0] < 250
                    name = src.stem + (".png" if has_alpha or "Normal" in src.name else ".jpg")
                    target = tex_out / name
                    if has_alpha:
                        img.convert("RGBA").save(target)
                    elif name.endswith(".png"):
                        img.convert("RGB").save(target)
                    else:
                        img.convert("RGB").save(target, quality=90)
                    done[src.name] = target
                im["uri"] = os.path.relpath(done[src.name], gl.parent).replace(os.sep, "/")
                im.pop("mimeType", None)
            (gl.parent / (gl.stem + "_af.gltf")).write_text(json.dumps(d))


def build_characters():
    build = ASSET_DIR / "build"
    out = ASSET_DIR / "characters"
    tex_out = out / "tex"
    anim_out = ASSET_DIR / "anims"
    print("Unpacking and shrinking character textures...", flush=True)
    _prepare_sources(build, tex_out)
    print("Converting characters (this takes a minute)...", flush=True)
    from panda3d.core import loadPrcFileData
    # Build in the game's coordinate system: Panda stores joint rotations as HPR angles, which only decode
    # correctly under the coordinate system they were written in (Ursina uses y-up, left-handed).
    loadPrcFileData("", "window-type none\naudio-library-name null\nnotify-level-gobj error\nnotify-level-device fatal\n"
                        "coordinate-system y-up-left\n")
    from direct.showbase.ShowBase import ShowBase
    from . import assemble
    base = ShowBase()
    anim_out.mkdir(parents=True, exist_ok=True)
    clips = assemble.export_clips(base.loader, [build / "anims" / "UAL1_Standard.glb", build / "anims" / "UAL2_Standard.glb"],
                                  sorted({c for c, _, _ in CLIPS.values()}), anim_out)
    variants = {}
    for name, spec in CHARACTERS.items():
        path = out / f"{name}.bam"
        info = assemble.build_character(base.loader, build, spec, path)
        variants[name] = info
        print(f"  {name}: {info['tris']} triangles", flush=True)
    (out / "manifest.json").write_text(json.dumps({"version": FORMAT_VERSION, "characters": variants, "clips": clips}, indent=1))
    base.destroy()


def main(argv=None):
    p = argparse.ArgumentParser(description="Fetch Afterfall's optional CC0 textures, characters and animations.")
    p.add_argument("--only", choices=("textures", "characters"))
    p.add_argument("--res", choices=("1k", "2k"), default="1k", help="texture resolution to download")
    p.add_argument("--force", action="store_true", help="rebuild even if converted files exist")
    p.add_argument("--clean", action="store_true", help="delete the downloaded zips and temporary files afterwards")
    args = p.parse_args(argv)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Asset folder: {ASSET_DIR}", flush=True)
    ok = True
    if args.only in (None, "textures"):
        fetch_textures(args.res, args.force)
    if args.only in (None, "characters"):
        if fetch_character_zips():
            build_characters()
        else:
            ok = False
    (ASSET_DIR / "CREDITS.txt").write_text(CREDITS)
    if args.clean:
        shutil.rmtree(ASSET_DIR / "build", ignore_errors=True)
        shutil.rmtree(ASSET_DIR / "downloads", ignore_errors=True)
    print("Done. Start the game as usual; it picks the assets up automatically." if ok else
          "Textures are installed; characters are waiting for the zips listed above.", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
