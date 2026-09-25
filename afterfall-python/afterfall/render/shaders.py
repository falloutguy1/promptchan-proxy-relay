"""GLSL shaders. Everything shares one lighting model (sun + sky/ground ambient + PCF shadows + two point
lights + fog, done in Panda3D's y-up world space):

* world:     the merged primitive geometry; wind sway in the vertex colour's alpha. With the optional
             texture pack it samples a texture array with object-space triplanar projection and normal maps.
* terrain:   the height field, splatting four scanned ground materials by per-vertex weights.
* character: GPU-skinned Quaternius characters with their own albedo/normal/roughness maps.
* sky:       procedural dome.
"""
from panda3d.core import Shader

LIGHTING = """
uniform struct p3d_LightSourceParameters {
    vec4 color; vec4 position; sampler2DShadow shadowMap; mat4 shadowViewMatrix;
} p3d_LightSource[1];
uniform vec3 u_sun_dir;
uniform vec3 u_sun_col;
uniform vec3 u_sky_col;
uniform vec3 u_ground_col;
uniform vec3 u_fog_col;
uniform float u_fog_density;
uniform float u_shadow_on;
uniform float u_shadow_texel;
uniform vec3 u_cam_pos;
uniform vec4 u_light0;   // xyz position, w range
uniform vec3 u_light0_col;
uniform vec4 u_light1;
uniform vec3 u_light1_col;

float shadow_at(vec4 c) {
    if (u_shadow_on < 0.5) return 1.0;
    float s = 0.0;
    c.z -= 0.0015 * c.w;
    float o = u_shadow_texel * c.w;
    s += textureProj(p3d_LightSource[0].shadowMap, c + vec4(-o, -o, 0, 0));
    s += textureProj(p3d_LightSource[0].shadowMap, c + vec4( o, -o, 0, 0));
    s += textureProj(p3d_LightSource[0].shadowMap, c + vec4(-o,  o, 0, 0));
    s += textureProj(p3d_LightSource[0].shadowMap, c + vec4( o,  o, 0, 0));
    return s * 0.25;
}

vec3 point_light(vec4 l, vec3 col, vec3 n, vec3 base, vec3 world) {
    if (l.w <= 0.0) return vec3(0.0);
    vec3 d = l.xyz - world;
    float dist = length(d);
    float att = clamp(1.0 - dist / l.w, 0.0, 1.0);
    return base * col * (max(dot(n, d / dist), 0.0) * 0.8 + 0.2) * att * att;
}

// base colour, normal, roughness, ambient occlusion, sun shadow; gloss adds the wet/water sheen
vec3 shade(vec3 base, vec3 n, float rough, float ao, float sh, vec3 world, float gloss) {
    float ndl = max(dot(n, u_sun_dir), 0.0);
    vec3 ambient = mix(u_ground_col, u_sky_col, n.y * 0.5 + 0.5) * ao;
    vec3 color = base * (ambient + u_sun_col * ndl * sh);
    color += point_light(u_light0, u_light0_col, n, base, world);
    color += point_light(u_light1, u_light1_col, n, base, world);
    vec3 v = normalize(u_cam_pos - world);
    vec3 h = normalize(v + u_sun_dir);
    float smooth_ = 1.0 - clamp(rough, 0.0, 1.0);
    color += u_sun_col * pow(max(dot(n, h), 0.0), 4.0 + 90.0 * smooth_ * smooth_) * smooth_ * smooth_ * 0.35 * ndl * sh;
    if (gloss > 0.0) {
        color += u_sun_col * pow(max(dot(n, h), 0.0), 60.0) * gloss * sh;
        color = mix(color, u_sky_col * 0.9, gloss * 0.35 * (1.0 - max(dot(n, v), 0.0)));
    }
    return color;
}

vec3 finish(vec3 color, float dist) {
    float fog = 1.0 - exp(-pow(u_fog_density * dist, 2.0));
    color = mix(color, u_fog_col, clamp(fog, 0.0, 1.0));
    return color / (1.0 + color * 0.18) * 1.12;   // gentle filmic shoulder
}

// tangent frame from screen-space derivatives: normal maps without stored tangents. The derivatives are
// taken by the caller, outside any branch.
mat3 frame_from(vec3 N, vec3 dp1, vec3 dp2, vec2 d1, vec2 d2) {
    vec3 T = dp1 * d2.y - dp2 * d1.y;
    vec3 B = dp2 * d1.x - dp1 * d2.x;
    if (d1.x * d2.y - d1.y * d2.x < 0.0) { T = -T; B = -B; }
    T = T - N * dot(N, T);
    B = B - N * dot(N, B);
    return mat3(T * inversesqrt(max(dot(T, T), 1e-12)), B * inversesqrt(max(dot(B, B), 1e-12)), N);
}
"""

TEXTURES = """
uniform sampler2DArray u_albedo;   // detail around the palette colour, x0.5
uniform sampler2DArray u_nrm;      // normal xy, roughness, ambient occlusion
uniform vec4 u_layer_size[4];      // metres per tile for layers 0..15 (layer 0 unused)
uniform vec4 u_layer_mean[16];     // each scan's average colour; w = how much of it to use
uniform float u_normal_strength;

float layer_size(int l) { return u_layer_size[l / 4][l - (l / 4) * 4]; }

// detail sample plus a larger, rotated one of the same scan, so repeats don't line up into a grid
vec3 detail(vec2 uv, float z, vec2 gx, vec2 gy) {
    const mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    vec3 a = textureGrad(u_albedo, vec3(uv, z), gx, gy).rgb;
    vec3 b = textureGrad(u_albedo, vec3(rot * uv * 0.29 + 0.37, z), rot * gx * 0.29, rot * gy * 0.29).rgb;
    return mix(a, b, 0.4);
}

vec3 unpack_normal(vec4 t) {
    vec2 xy = (t.xy * 2.0 - 1.0) * u_normal_strength;
    return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}
"""

WORLD_VERT = """
#version 150
uniform mat4 p3d_ModelViewProjectionMatrix;
uniform mat4 p3d_ModelViewMatrix;
uniform mat4 p3d_ModelMatrix;
uniform struct p3d_LightSourceParameters {
    vec4 color; vec4 position; sampler2DShadow shadowMap; mat4 shadowViewMatrix;
} p3d_LightSource[1];
uniform float u_time;
uniform float u_wind;
in vec4 p3d_Vertex;
in vec3 p3d_Normal;
in vec4 p3d_Color;
in vec3 tex3;
in float material;
out vec3 v_world;
out vec3 v_view;
out vec3 v_nrm;
out vec3 v_col;
out vec4 v_shadow;
out vec3 v_tex;
flat out int v_mat;
void main() {
    vec4 v = p3d_Vertex;
    float sway = p3d_Color.a;
    if (sway > 0.0) {
        vec4 wp0 = p3d_ModelMatrix * v;
        float ph = u_time * 1.3 + wp0.x * 0.21 + wp0.z * 0.17;
        v.x += (sin(ph) + 0.4 * sin(ph * 2.7 + 1.3)) * sway * u_wind;
        v.z += cos(ph * 0.83) * sway * u_wind * 0.6;
    }
    vec4 view = p3d_ModelViewMatrix * v;
    gl_Position = p3d_ModelViewProjectionMatrix * v;
    v_world = (p3d_ModelMatrix * v).xyz;
    v_view = view.xyz;
    v_nrm = normalize(transpose(inverse(mat3(p3d_ModelMatrix))) * p3d_Normal);
    v_col = p3d_Color.rgb;
    v_shadow = p3d_LightSource[0].shadowViewMatrix * view;
    v_tex = tex3;
    v_mat = int(material + 0.5);
}
"""

WORLD_FRAG = """
#version 150
uniform vec4 p3d_ColorScale;
uniform float u_gloss;
uniform float u_emissive;
uniform float u_wet;
in vec3 v_world;
in vec3 v_view;
in vec3 v_nrm;
in vec3 v_col;
in vec4 v_shadow;
in vec3 v_tex;
flat in int v_mat;
out vec4 o_color;
""" + LIGHTING + "#ifdef TEXTURED\n" + TEXTURES + "#endif\n" + """
void main() {
    vec3 n = normalize(v_nrm);
    if (!gl_FrontFacing) n = -n;
    vec3 base = v_col * p3d_ColorScale.rgb;
    float rough = 0.85, ao = 1.0;
#ifdef TEXTURED
    // object-space triplanar: v_tex is the position in the part's own frame, in metres
    vec3 tx = dFdx(v_tex), ty = dFdy(v_tex), px = dFdx(v_world), py = dFdy(v_world);
    if (v_mat > 0) {
        vec3 ln = cross(tx, ty);
        vec3 w = pow(abs(ln) / max(max(abs(ln.x), abs(ln.y)), max(abs(ln.z), 1e-12)), vec3(8.0));
        w *= step(0.02, w / (w.x + w.y + w.z));
        w /= w.x + w.y + w.z;
        float s = 1.0 / layer_size(v_mat);
        float z = float(v_mat - 1);
        vec3 alb = vec3(0.0), nn = vec3(0.0);
        vec2 ra = vec2(0.0);
        if (w.x > 0.0) {
            vec2 uv = v_tex.yz * s, gx = tx.yz * s, gy = ty.yz * s;
            vec4 t = textureGrad(u_nrm, vec3(uv, z), gx, gy);
            alb += detail(uv, z, gx, gy) * w.x;
            nn += frame_from(n, px, py, gx, gy) * unpack_normal(t) * w.x;
            ra += t.zw * w.x;
        }
        if (w.y > 0.0) {
            vec2 uv = v_tex.xz * s, gx = tx.xz * s, gy = ty.xz * s;
            vec4 t = textureGrad(u_nrm, vec3(uv, z), gx, gy);
            alb += detail(uv, z, gx, gy) * w.y;
            nn += frame_from(n, px, py, gx, gy) * unpack_normal(t) * w.y;
            ra += t.zw * w.y;
        }
        if (w.z > 0.0) {
            vec2 uv = v_tex.xy * s, gx = tx.xy * s, gy = ty.xy * s;
            vec4 t = textureGrad(u_nrm, vec3(uv, z), gx, gy);
            alb += detail(uv, z, gx, gy) * w.z;
            nn += frame_from(n, px, py, gx, gy) * unpack_normal(t) * w.z;
            ra += t.zw * w.z;
        }
        base = mix(base, u_layer_mean[v_mat].rgb * p3d_ColorScale.rgb, u_layer_mean[v_mat].w) * alb * 2.0;
        n = normalize(nn);
        rough = ra.x;
        ao = mix(1.0, ra.y, 0.8);
    }
#endif
    float wet = u_wet * clamp(n.y * 2.0 - 0.6, 0.0, 1.0);
    base *= 1.0 - wet * 0.25;
    rough = mix(rough, 0.2, wet * 0.8);
    vec3 color = shade(base, n, rough, ao, shadow_at(v_shadow), v_world, u_gloss);
    color += base * u_emissive;
    o_color = vec4(finish(color, length(v_view)), 1.0);
}
"""

TERRAIN_VERT = """
#version 150
uniform mat4 p3d_ModelViewProjectionMatrix;
uniform mat4 p3d_ModelViewMatrix;
uniform mat4 p3d_ModelMatrix;
uniform struct p3d_LightSourceParameters {
    vec4 color; vec4 position; sampler2DShadow shadowMap; mat4 shadowViewMatrix;
} p3d_LightSource[1];
in vec4 p3d_Vertex;
in vec3 p3d_Normal;
in vec4 p3d_Color;
in vec4 splat;
out vec3 v_world;
out vec3 v_view;
out vec3 v_nrm;
out vec3 v_col;
out vec4 v_shadow;
out vec4 v_splat;
void main() {
    vec4 view = p3d_ModelViewMatrix * p3d_Vertex;
    gl_Position = p3d_ModelViewProjectionMatrix * p3d_Vertex;
    v_world = (p3d_ModelMatrix * p3d_Vertex).xyz;
    v_view = view.xyz;
    v_nrm = p3d_Normal;
    v_col = p3d_Color.rgb;
    v_shadow = p3d_LightSource[0].shadowViewMatrix * view;
    v_splat = splat;
}
"""

TERRAIN_FRAG = """
#version 150
uniform float u_wet;
uniform ivec4 u_splat_layers;   // grass, forest floor, mud, rock
in vec3 v_world;
in vec3 v_view;
in vec3 v_nrm;
in vec3 v_col;
in vec4 v_shadow;
in vec4 v_splat;
out vec4 o_color;
""" + LIGHTING + TEXTURES + """
void main() {
    vec3 n = normalize(v_nrm);
    vec4 wt = v_splat / max(dot(v_splat, vec4(1.0)), 1e-4);
    vec3 alb = vec3(0.0), tn = vec3(0.0);
    vec2 ra = vec2(0.0);
    float tot = 0.0;
    vec2 gx0 = dFdx(v_world.xz), gy0 = dFdy(v_world.xz);
    mat3 tbn = frame_from(n, dFdx(v_world), dFdy(v_world), gx0, gy0);
    for (int i = 0; i < 4; i++) {
        float w = wt[i];
        if (w < 0.02) continue;
        int l = u_splat_layers[i];
        float s = 1.0 / layer_size(l);
        vec3 p = vec3(v_world.xz * s, float(l - 1));
        vec4 t = textureGrad(u_nrm, p, gx0 * s, gy0 * s);
        vec3 a = detail(p.xy, p.z, gx0 * s, gy0 * s) * mix(v_col, u_layer_mean[l].rgb, u_layer_mean[l].w);
        // height-aware blending: crevices of one material fill with the next
        w *= pow(t.w + 0.35, 4.0);
        alb += a * w;
        tn += unpack_normal(t) * w;
        ra += t.zw * w;
        tot += w;
    }
    alb /= tot; tn /= tot; ra /= tot;
    vec3 base = alb * 2.0;
    vec3 nn = normalize(tbn * tn);
    float rough = ra.x, ao = mix(1.0, ra.y, 0.7);
    float wet = u_wet * clamp(nn.y * 2.0 - 0.6, 0.0, 1.0);
    base *= 1.0 - wet * 0.3;
    rough = mix(rough, 0.25, wet * 0.7);
    vec3 color = shade(base, nn, rough, ao, shadow_at(v_shadow), v_world, 0.0);
    o_color = vec4(finish(color, length(v_view)), 1.0);
}
"""

CHAR_VERT = """
#version 150
uniform mat4 p3d_ModelViewProjectionMatrix;
uniform mat4 p3d_ModelViewMatrix;
uniform mat4 p3d_ModelMatrix;
uniform mat4 p3d_TransformTable[100];
uniform struct p3d_LightSourceParameters {
    vec4 color; vec4 position; sampler2DShadow shadowMap; mat4 shadowViewMatrix;
} p3d_LightSource[1];
in vec4 p3d_Vertex;
in vec3 p3d_Normal;
in vec4 p3d_Tangent;
in vec2 p3d_MultiTexCoord0;
in vec4 transform_weight;
in uvec4 transform_index;
out vec3 v_world;
out vec3 v_view;
out vec3 v_nrm;
out vec3 v_tan;
out float v_tsign;
out vec2 v_uv;
out vec3 v_obj;
out vec4 v_shadow;
void main() {
    mat4 skin = p3d_TransformTable[transform_index.x] * transform_weight.x
              + p3d_TransformTable[transform_index.y] * transform_weight.y
              + p3d_TransformTable[transform_index.z] * transform_weight.z
              + p3d_TransformTable[transform_index.w] * transform_weight.w;
    vec4 v = skin * p3d_Vertex;
    vec4 view = p3d_ModelViewMatrix * v;
    gl_Position = p3d_ModelViewProjectionMatrix * v;
    mat3 nm = transpose(inverse(mat3(p3d_ModelMatrix))) * mat3(skin);
    v_world = (p3d_ModelMatrix * v).xyz;
    v_view = view.xyz;
    v_nrm = nm * p3d_Normal;
    v_tan = mat3(p3d_ModelMatrix) * mat3(skin) * p3d_Tangent.xyz;
    v_tsign = p3d_Tangent.w;
    v_uv = p3d_MultiTexCoord0;
    v_obj = p3d_Vertex.xyz;   // bind pose: stains stay put on the clothes
    v_shadow = p3d_LightSource[0].shadowViewMatrix * view;
}
"""

CHAR_FRAG = """
#version 150
uniform sampler2D p3d_TextureModulate[1];
uniform sampler2D p3d_TextureNormal[1];
uniform sampler2D p3d_TextureSelector[1];
uniform float u_kind;        // 0 skin, 1 eyes, 2 hair, 3 cloth
uniform vec3 u_skin_tint;
uniform vec3 u_hair_col;
uniform vec4 u_cloth;        // rgb tint, amount
uniform float u_zombie;
uniform float u_seed;
uniform float u_mirror;      // -1 when the node's transform mirrors, so gl_FrontFacing flips
uniform float u_wet;
in vec3 v_world;
in vec3 v_view;
in vec3 v_nrm;
in vec3 v_tan;
in float v_tsign;
in vec2 v_uv;
in vec3 v_obj;
in vec4 v_shadow;
out vec4 o_color;
""" + LIGHTING + """
float h31(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1 + 3.1) * 0.3 + vnoise(p * 4.3 + 7.7) * 0.15; }

void main() {
    vec4 alb = texture(p3d_TextureModulate[0], v_uv);
    vec3 base = alb.rgb;
    vec3 tn = texture(p3d_TextureNormal[0], v_uv).xyz * 2.0 - 1.0;
    vec4 orm = texture(p3d_TextureSelector[0], v_uv);
    vec3 n = normalize(v_nrm);
    bool front = u_mirror > 0.0 ? gl_FrontFacing : !gl_FrontFacing;
    if (!front) n = -n;
    vec3 t = normalize(v_tan - n * dot(v_tan, n));
    vec3 b = cross(n, t) * v_tsign * u_mirror;
    n = normalize(t * tn.x + b * tn.y + n * max(tn.z, 0.2));
    float rough = orm.g, ao = mix(1.0, orm.r, 0.7);
    float lum = dot(base, vec3(0.3, 0.55, 0.15));
    float grime = fbm3(v_obj * 6.0 + u_seed);
    if (u_kind < 0.5) {                    // skin
        base *= u_skin_tint;
        if (u_zombie > 0.5) {
            base = mix(base, vec3(lum) * vec3(0.72, 0.8, 0.64) * 1.1, 0.75);
            base *= 0.75 + 0.35 * fbm3(v_obj * 18.0 + u_seed);
            float gore = smoothstep(0.67, 0.74, fbm3(v_obj * 9.0 + u_seed * 3.0));
            base = mix(base, vec3(0.28, 0.04, 0.03), gore * 0.8);
            rough = mix(rough, 0.35, gore);
        }
    } else if (u_kind < 1.5) {             // eyes
        if (u_zombie > 0.5) base = mix(base, vec3(0.78, 0.76, 0.62), 0.85);
    } else if (u_kind < 2.5) {             // hair: the scans are grey, tinted per character
        base = lum * u_hair_col * 2.2;
        if (u_zombie > 0.5) base *= 0.7;
    } else {                               // clothes
        base = mix(base, vec3(lum) * u_cloth.rgb * 2.0, u_cloth.a);
        float dirt = smoothstep(0.55, 0.05, v_obj.z) * 0.5 + grime * 0.25;
        base = mix(base, vec3(0.2, 0.16, 0.11), clamp(dirt, 0.0, 0.6));
        if (u_zombie > 0.5) {
            base = mix(base, vec3(dot(base, vec3(0.33))), 0.3) * 0.92;
            float blood = smoothstep(0.66, 0.74, fbm3(v_obj * vec3(5.0, 5.0, 2.5) + u_seed * 5.0));
            base = mix(base, vec3(0.24, 0.04, 0.03), blood * 0.75);
            rough = mix(rough, 0.4, blood);
        }
    }
    float wet = u_wet * 0.6;
    base *= 1.0 - wet * 0.2;
    rough = mix(rough, 0.3, wet);
    vec3 color = shade(base, n, rough, ao, shadow_at(v_shadow), v_world, 0.0);
    o_color = vec4(finish(color, length(v_view)), 1.0);
}
"""

SKY_VERT = """
#version 150
uniform mat4 p3d_ModelViewProjectionMatrix;
in vec4 p3d_Vertex;
out vec3 v_dir;
void main() {
    v_dir = p3d_Vertex.xyz;
    gl_Position = p3d_ModelViewProjectionMatrix * p3d_Vertex;
}
"""

SKY_FRAG = """
#version 150
uniform vec3 u_sun_dir;
uniform vec3 u_moon_dir;
uniform vec3 u_zenith;
uniform vec3 u_horizon;
uniform vec3 u_sun_glow;
uniform float u_night;
uniform float u_cloud;
uniform float u_light;
uniform float u_time;
in vec3 v_dir;
out vec4 o_color;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float h31(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
    float a = 0.0, w = 0.5;
    for (int i = 0; i < 5; i++) { a += w * vn(p); p = p * 2.03 + vec2(1.7, 9.2); w *= 0.5; }
    return a;
}
void main() {
    vec3 d = normalize(v_dir);
    float h = d.y;
    vec3 col = mix(u_horizon, u_zenith, pow(clamp(h, 0.0, 1.0), 0.45));
    col = mix(col, u_horizon * 0.55, smoothstep(0.0, -0.3, h));
    float sd = max(dot(d, u_sun_dir), 0.0);
    float sun_up = smoothstep(-0.12, 0.02, u_sun_dir.y);
    col += u_sun_glow * (pow(sd, 900.0) * 25.0 + pow(sd, 14.0) * 0.4 + pow(sd, 3.0) * 0.1) * sun_up * (1.0 - u_cloud * 0.7);
    float md = max(dot(d, u_moon_dir), 0.0);
    col += vec3(0.8, 0.85, 1.0) * (smoothstep(0.9993, 0.9996, md) * 1.3 + pow(md, 50.0) * 0.06) * u_night * (1.0 - u_cloud * 0.8);
    float st = h31(floor(d * 420.0));
    col += vec3(0.9, 0.95, 1.0) * pow(max(st - 0.9965, 0.0) / 0.0035, 4.0) * u_night * smoothstep(0.02, 0.3, h) * (1.0 - u_cloud) * 1.4;
    if (h > 0.0) {
        vec2 uv = d.xz / (h * 1.4 + 0.1) * 0.9 + vec2(u_time * 0.0035, u_time * 0.0018);
        float c = fbm(uv);
        float cov = mix(0.6, 0.3, u_cloud);
        float cm = smoothstep(cov, cov + 0.3, c);
        float shade = mix(0.55, 1.05, smoothstep(0.2, 0.8, fbm(uv * 1.4 + 0.5) - c * 0.5 + 0.4));
        vec3 cc = mix(u_horizon, vec3(1.0) * u_light, 0.55) * shade;
        cc = mix(cc, mix(u_zenith, u_horizon, 0.5) * 0.8, u_cloud * 0.55);
        cc += u_sun_glow * pow(sd, 5.0) * 0.6 * sun_up * (1.0 - u_cloud * 0.5);
        col = mix(col, cc, cm * smoothstep(0.0, 0.14, h) * 0.95);
    }
    o_color = vec4(col, 1.0);
}
"""


def _with_defines(src, defines):
    head, rest = src.split("\n", 2)[1], src.split("\n", 2)[2]
    return head + "\n" + "".join(f"#define {d}\n" for d in defines) + rest


def world_shader(textured=False):
    frag = _with_defines(WORLD_FRAG, ["TEXTURED"] if textured else [])
    return Shader.make(Shader.SL_GLSL, WORLD_VERT, frag)


def terrain_shader():
    return Shader.make(Shader.SL_GLSL, TERRAIN_VERT, TERRAIN_FRAG)


def character_shader():
    return Shader.make(Shader.SL_GLSL, CHAR_VERT, CHAR_FRAG)


def sky_shader():
    return Shader.make(Shader.SL_GLSL, SKY_VERT, SKY_FRAG)
