"""Loads the optional scanned textures into two texture arrays shared by the world and terrain shaders."""
import json

import numpy as np
from panda3d.core import LVecBase4i, PTA_LVecBase4f, SamplerState, Texture, Vec4

from ..assets.catalog import ASSET_DIR, LAYER, REAL_COLOR, TEXTURES

SPLAT = ("grass", "forest", "mud", "rock")   # terrain splat channels, in world.splat order


def _array(name, paths, size, mode):
    from PIL import Image
    pages = []
    for p in paths:
        img = Image.open(p).convert(mode)
        if img.size != (size, size):
            img = img.resize((size, size), Image.LANCZOS)
        pages.append(np.asarray(img)[::-1])     # Panda wants the bottom row first
    # Panda keeps RAM images as BGR(A)
    data = np.ascontiguousarray(np.stack(pages)[..., [2, 1, 0, 3] if mode == "RGBA" else [2, 1, 0]])
    tex = Texture(name)
    tex.setup_2d_texture_array(size, size, len(pages), Texture.T_unsigned_byte,
                               Texture.F_rgba8 if mode == "RGBA" else Texture.F_rgb8)
    # mipmaps built here: Panda's own generator doesn't handle array textures
    tex.set_ram_image(data.tobytes())
    level = 0
    while data.shape[1] > 1:
        d = data.astype(np.uint16)
        data = ((d[:, 0::2, 0::2] + d[:, 1::2, 0::2] + d[:, 0::2, 1::2] + d[:, 1::2, 1::2] + 2) >> 2).astype(np.uint8)
        level += 1
        memoryview(tex.make_ram_mipmap_image(level)).cast("B")[:] = np.ascontiguousarray(data).tobytes()
    tex.set_wrap_u(SamplerState.WM_repeat)
    tex.set_wrap_v(SamplerState.WM_repeat)
    tex.set_minfilter(SamplerState.FT_linear_mipmap_linear)
    tex.set_magfilter(SamplerState.FT_linear)
    tex.set_anisotropic_degree(8)
    return tex


class Materials:
    def __init__(self, size=1024):
        meta = json.loads((ASSET_DIR / "textures" / "materials.json").read_text())
        layers = meta["layers"]
        if [l["key"] for l in layers] != [k for k, _ in TEXTURES]:
            raise RuntimeError("texture pack is out of date; run fetch_assets.py --only textures --force")
        folder = ASSET_DIR / "textures"
        self.albedo = _array("albedo", [folder / l["albedo"] for l in layers], size, "RGB")
        self.normal = _array("normal", [folder / l["normal"] for l in layers], size, "RGBA")
        sizes = [1.0] + [max(.5, l["size_m"]) for l in layers]
        sizes += [1.0] * (16 - len(sizes))
        self.layer_size = PTA_LVecBase4f([Vec4(*sizes[i:i + 4]) for i in range(0, 16, 4)])
        means = [Vec4(.5, .5, .5, 0)] + [Vec4(*l.get("mean", (.5, .5, .5)), REAL_COLOR[l["key"]]) for l in layers]
        means += [Vec4(.5, .5, .5, 0)] * (16 - len(means))
        self.layer_mean = PTA_LVecBase4f(means)

    def apply(self, node):
        node.set_shader_input("u_albedo", self.albedo)
        node.set_shader_input("u_nrm", self.normal)
        node.set_shader_input("u_layer_size", self.layer_size)
        node.set_shader_input("u_layer_mean", self.layer_mean)
        node.set_shader_input("u_normal_strength", 1.0)
        node.set_shader_input("u_splat_layers", LVecBase4i(*(LAYER[k] for k in SPLAT)))
