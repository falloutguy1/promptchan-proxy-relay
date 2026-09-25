"""GLSL shaders: one lit shader for the whole world (sun + sky/ground ambient + shadows + fog + wind +
two point lights) and a procedural sky dome. Lighting is done in world space (Panda3D y-up)."""
from panda3d.core import Shader

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
out vec3 v_world;
out vec3 v_view;
out vec3 v_nrm;
out vec3 v_col;
out vec4 v_shadow;
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
}
"""

WORLD_FRAG = """
#version 150
uniform struct p3d_LightSourceParameters {
    vec4 color; vec4 position; sampler2DShadow shadowMap; mat4 shadowViewMatrix;
} p3d_LightSource[1];
uniform vec4 p3d_ColorScale;
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
uniform float u_gloss;
uniform float u_emissive;
in vec3 v_world;
in vec3 v_view;
in vec3 v_nrm;
in vec3 v_col;
in vec4 v_shadow;
out vec4 o_color;

float shadow() {
    if (u_shadow_on < 0.5) return 1.0;
    float s = 0.0;
    vec4 c = v_shadow;
    c.z -= 0.0015 * c.w;
    float o = u_shadow_texel * c.w;
    s += textureProj(p3d_LightSource[0].shadowMap, c + vec4(-o, -o, 0, 0));
    s += textureProj(p3d_LightSource[0].shadowMap, c + vec4( o, -o, 0, 0));
    s += textureProj(p3d_LightSource[0].shadowMap, c + vec4(-o,  o, 0, 0));
    s += textureProj(p3d_LightSource[0].shadowMap, c + vec4( o,  o, 0, 0));
    return s * 0.25;
}

vec3 point_light(vec4 l, vec3 col, vec3 n, vec3 base) {
    if (l.w <= 0.0) return vec3(0.0);
    vec3 d = l.xyz - v_world;
    float dist = length(d);
    float att = clamp(1.0 - dist / l.w, 0.0, 1.0);
    return base * col * (max(dot(n, d / dist), 0.0) * 0.8 + 0.2) * att * att;
}

void main() {
    vec3 n = normalize(v_nrm);
    if (!gl_FrontFacing) n = -n;
    vec3 base = v_col * p3d_ColorScale.rgb;
    float ndl = max(dot(n, u_sun_dir), 0.0);
    float hemi = n.y * 0.5 + 0.5;
    vec3 ambient = mix(u_ground_col, u_sky_col, hemi);
    vec3 color = base * (ambient + u_sun_col * ndl * shadow());
    color += point_light(u_light0, u_light0_col, n, base);
    color += point_light(u_light1, u_light1_col, n, base);
    if (u_gloss > 0.0) {
        vec3 v = normalize(u_cam_pos - v_world);
        vec3 h = normalize(v + u_sun_dir);
        color += u_sun_col * pow(max(dot(n, h), 0.0), 60.0) * u_gloss;
        color = mix(color, u_sky_col * 0.9, u_gloss * 0.35 * (1.0 - max(dot(n, v), 0.0)));
    }
    color += base * u_emissive;
    float dist = length(v_view);
    float fog = 1.0 - exp(-pow(u_fog_density * dist, 2.0));
    color = mix(color, u_fog_col, clamp(fog, 0.0, 1.0));
    // gentle filmic shoulder
    color = color / (1.0 + color * 0.18) * 1.12;
    o_color = vec4(color, 1.0);
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


def world_shader():
    return Shader.make(Shader.SL_GLSL, WORLD_VERT, WORLD_FRAG)


def sky_shader():
    return Shader.make(Shader.SL_GLSL, SKY_VERT, SKY_FRAG)
