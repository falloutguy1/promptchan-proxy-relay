// Turns the simulation's primitive parts into Unity meshes. Simulation space (x east, y north, z up,
// right-handed) maps to Unity as (x, z, y); that mirror flips handedness, so triangles are reversed.
// UVs are in metres in each part's own frame (bricks stay level on a rotated wall); materials tile them
// at the scan's real-world size.
using System;
using System.Collections.Generic;
using Afterfall.Sim;
using UnityEngine;
using UnityEngine.Rendering;

namespace Afterfall.Game
{
    public static class MeshBuilder
    {
        public static Vector3 U(V3 p) => new Vector3((float)p.x, (float)p.z, (float)p.y);
        public static Vector3 U(double x, double y, double z) => new Vector3((float)x, (float)z, (float)y);

        /// <summary>Unit primitive: vertices, normals and a UV generator input (face axis index).</summary>
        sealed class Prim
        {
            public Vector3[] v, n;     // simulation space, unit size (-.5..5)
            public Vector2[] uvDir;    // per vertex: which local axes feed u and v (x=0,y=1,z=2), or -1 for special
            public byte[] kind;        // 0 planar(uvDir), 1 cylinder side (u = angle, v = z)
            public float[] angle;      // for cylinder sides
            public int[] t;
        }

        static readonly Dictionary<(Shape, bool), Prim> prims = new Dictionary<(Shape, bool), Prim>();

        static Prim Get(Shape s, bool low)
        {
            if (!prims.TryGetValue((s, low), out var p))
            {
                p = s switch
                {
                    Shape.Cube => Cube(),
                    Shape.Cylinder => Cylinder(low ? 8 : 14),
                    Shape.Cone => Cone(low ? 8 : 12),
                    _ => Sphere(low ? 10 : 14, low ? 6 : 9),
                };
                prims[(s, low)] = p;
            }
            return p;
        }

        sealed class PrimBuilder
        {
            public readonly List<Vector3> v = new List<Vector3>(), n = new List<Vector3>();
            public readonly List<Vector2> dir = new List<Vector2>();
            public readonly List<byte> kind = new List<byte>();
            public readonly List<float> ang = new List<float>();
            public readonly List<int> t = new List<int>();
            public int Add(Vector3 p, Vector3 nrm, Vector2 d, byte k = 0, float a = 0)
            {
                v.Add(p); n.Add(nrm); dir.Add(d); kind.Add(k); ang.Add(a);
                return v.Count - 1;
            }
            public Prim Build() => new Prim { v = v.ToArray(), n = n.ToArray(), uvDir = dir.ToArray(), kind = kind.ToArray(), angle = ang.ToArray(), t = t.ToArray() };
        }

        static Prim Cube()
        {
            var b = new PrimBuilder();
            // normal, u axis, w axis (simulation space); side faces keep z as their v so courses stay level
            var faces = new (Vector3 nrm, Vector3 u, Vector3 w, Vector2 d)[]
            {
                (new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector2(1, 2)),
                (new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector2(1, 2)),
                (new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector2(0, 2)),
                (new Vector3(0, -1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector2(0, 2)),
                (new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector2(0, 1)),
                (new Vector3(0, 0, -1), new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector2(0, 1)),
            };
            foreach (var f in faces)
            {
                int i0 = b.v.Count;
                foreach (var (su, sw) in new[] { (-1, -1), (1, -1), (1, 1), (-1, 1) })
                    b.Add(f.nrm * .5f + f.u * .5f * su + f.w * .5f * sw, f.nrm, f.d);
                b.t.AddRange(new[] { i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3 });
            }
            return b.Build();
        }

        static Prim Cylinder(int seg)
        {
            var b = new PrimBuilder();
            for (int i = 0; i < seg; i++)
            {
                float a0 = 2 * Mathf.PI * i / seg, a1 = 2 * Mathf.PI * (i + 1) / seg;
                float c0 = Mathf.Cos(a0), s0 = Mathf.Sin(a0), c1 = Mathf.Cos(a1), s1 = Mathf.Sin(a1);
                int q = b.v.Count;
                b.Add(new Vector3(c0 * .5f, s0 * .5f, -.5f), new Vector3(c0, s0, 0), default, 1, a0);
                b.Add(new Vector3(c1 * .5f, s1 * .5f, -.5f), new Vector3(c1, s1, 0), default, 1, a1);
                b.Add(new Vector3(c1 * .5f, s1 * .5f, .5f), new Vector3(c1, s1, 0), default, 1, a1);
                b.Add(new Vector3(c0 * .5f, s0 * .5f, .5f), new Vector3(c0, s0, 0), default, 1, a0);
                b.t.AddRange(new[] { q, q + 1, q + 2, q, q + 2, q + 3 });
                foreach (var (z, sg) in new[] { (.5f, 1), (-.5f, -1) })
                {
                    int c = b.v.Count;
                    var nz = new Vector3(0, 0, sg);
                    b.Add(new Vector3(0, 0, z), nz, new Vector2(0, 1));
                    b.Add(new Vector3(c0 * .5f, s0 * .5f, z), nz, new Vector2(0, 1));
                    b.Add(new Vector3(c1 * .5f, s1 * .5f, z), nz, new Vector2(0, 1));
                    if (sg > 0) b.t.AddRange(new[] { c, c + 1, c + 2 }); else b.t.AddRange(new[] { c, c + 2, c + 1 });
                }
            }
            return b.Build();
        }

        static Prim Cone(int seg)
        {
            var b = new PrimBuilder();
            const float slope = .5f;
            for (int i = 0; i < seg; i++)
            {
                float a0 = 2 * Mathf.PI * i / seg, a1 = 2 * Mathf.PI * (i + 1) / seg, am = (a0 + a1) / 2;
                Vector3 N(float a) => new Vector3(Mathf.Cos(a), Mathf.Sin(a), slope).normalized;
                int q = b.v.Count;
                b.Add(new Vector3(Mathf.Cos(a0) * .5f, Mathf.Sin(a0) * .5f, -.5f), N(a0), default, 1, a0);
                b.Add(new Vector3(Mathf.Cos(a1) * .5f, Mathf.Sin(a1) * .5f, -.5f), N(a1), default, 1, a1);
                b.Add(new Vector3(0, 0, .5f), N(am), default, 1, am);
                b.t.AddRange(new[] { q, q + 1, q + 2 });
                int c = b.v.Count;
                var nz = new Vector3(0, 0, -1);
                b.Add(new Vector3(0, 0, -.5f), nz, new Vector2(0, 1));
                b.Add(new Vector3(Mathf.Cos(a1) * .5f, Mathf.Sin(a1) * .5f, -.5f), nz, new Vector2(0, 1));
                b.Add(new Vector3(Mathf.Cos(a0) * .5f, Mathf.Sin(a0) * .5f, -.5f), nz, new Vector2(0, 1));
                b.t.AddRange(new[] { c, c + 1, c + 2 });
            }
            return b.Build();
        }

        static Prim Sphere(int lon, int lat)
        {
            var b = new PrimBuilder();
            for (int j = 0; j <= lat; j++)
            {
                float th = Mathf.PI * j / lat;   // 0 at the top
                for (int i = 0; i <= lon; i++)
                {
                    float ph = 2 * Mathf.PI * i / lon;
                    var n = new Vector3(Mathf.Sin(th) * Mathf.Cos(ph), Mathf.Sin(th) * Mathf.Sin(ph), Mathf.Cos(th));
                    b.Add(n * .5f, n, default, 1, ph);
                }
            }
            for (int j = 0; j < lat; j++)
                for (int i = 0; i < lon; i++)
                {
                    int a = j * (lon + 1) + i, c = a + lon + 1;
                    b.t.AddRange(new[] { a, c, c + 1, a, c + 1, a + 1 });
                }
            return b.Build();
        }

        /// <summary>A list of parts as one mesh with a submesh per (material, colour), plus the matching materials.</summary>
        public static (Mesh mesh, Material[] mats) Build(IReadOnlyList<Part> parts, MaterialLibrary lib, bool low = false, Vector3 origin = default)
        {
            if (parts == null || parts.Count == 0) return (null, null);
            var groups = new Dictionary<(string, int), List<Part>>();
            foreach (var p in parts)
            {
                if (!groups.TryGetValue((p.mat, p.color), out var list)) groups[(p.mat, p.color)] = list = new List<Part>();
                list.Add(p);
            }
            var verts = new List<Vector3>();
            var norms = new List<Vector3>();
            var uvs = new List<Vector2>();
            var subs = new List<List<int>>();
            var mats = new List<Material>();
            foreach (var kv in groups)
            {
                var tris = new List<int>();
                foreach (var p in kv.Value) Append(p, Get(p.shape, low), verts, norms, uvs, tris, origin);
                subs.Add(tris);
                mats.Add(lib.Get(kv.Key.Item1, kv.Key.Item2));
            }
            var mesh = new Mesh { indexFormat = verts.Count > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16 };
            mesh.SetVertices(verts);
            mesh.SetNormals(norms);
            mesh.SetUVs(0, uvs);
            mesh.subMeshCount = subs.Count;
            for (int i = 0; i < subs.Count; i++) mesh.SetTriangles(subs[i], i, false);
            mesh.RecalculateBounds();
            mesh.RecalculateTangents();
            return (mesh, mats.ToArray());
        }

        static void Append(Part p, Prim prim, List<Vector3> verts, List<Vector3> norms, List<Vector2> uvs, List<int> tris, Vector3 origin)
        {
            var m = p.m;
            var sx = (float)m.Column(0).Length; var sy = (float)m.Column(1).Length; var sz = (float)m.Column(2).Length;
            var size = new Vector3(sx, sy, sz);
            // inverse-transpose for normals (m = R * S, so it is R * S^-1)
            var ns = new Vector3(1 / Mathf.Max(sx, 1e-6f), 1 / Mathf.Max(sy, 1e-6f), 1 / Mathf.Max(sz, 1e-6f));
            double h = Math.Sin(p.pos.x * 12.9898 + p.pos.y * 78.233) * 43758.5453;
            var shift = new Vector2((float)(h - Math.Floor(h)) * 17, (float)((h * 1.37) - Math.Floor(h * 1.37)) * 17);
            float circ = Mathf.PI * (sx + sy) * .5f;
            int baseIndex = verts.Count;
            var rot = RotOnly(m, size);   // normals: (R S)^-T n = R S^-1 n
            for (int i = 0; i < prim.v.Length; i++)
            {
                var lv = prim.v[i];
                var world = p.pos + m * new V3(lv.x, lv.y, lv.z);
                verts.Add(U(world) - origin);
                var ln = new V3(prim.n[i].x * ns.x, prim.n[i].y * ns.y, prim.n[i].z * ns.z);
                norms.Add(U((rot * ln).Normalized));
                Vector2 uv;
                if (prim.kind[i] == 1) uv = new Vector2(prim.angle[i] / (2 * Mathf.PI) * circ, lv.z * sz);
                else
                {
                    var d = prim.uvDir[i];
                    uv = new Vector2(lv[(int)d.x] * size[(int)d.x], lv[(int)d.y] * size[(int)d.y]);
                }
                uvs.Add(uv + shift);
            }
            for (int i = 0; i < prim.t.Length; i += 3)
            {
                tris.Add(baseIndex + prim.t[i]);
                tris.Add(baseIndex + prim.t[i + 2]);
                tris.Add(baseIndex + prim.t[i + 1]);
            }
        }

        /// <summary>The rotation part of m (its columns divided by the part's size).</summary>
        static Mat3 RotOnly(Mat3 m, Vector3 size)
        {
            var cx = m.Column(0) * (1 / Math.Max(size.x, 1e-6));
            var cy = m.Column(1) * (1 / Math.Max(size.y, 1e-6));
            var cz = m.Column(2) * (1 / Math.Max(size.z, 1e-6));
            return Mat3.FromColumns(cx, cy, cz);
        }

        /// <summary>A GameObject with the built mesh, or null when there's nothing to draw.</summary>
        public static GameObject Create(string name, IReadOnlyList<Part> parts, MaterialLibrary lib, Transform parent, bool low = false,
                                        bool shadows = true, Vector3 origin = default)
        {
            var (mesh, mats) = Build(parts, lib, low, origin);
            if (mesh == null) return null;
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = origin;
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterials = mats;
            r.shadowCastingMode = shadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            return go;
        }
    }
}
