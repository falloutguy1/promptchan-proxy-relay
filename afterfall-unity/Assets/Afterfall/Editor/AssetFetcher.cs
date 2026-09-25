// Afterfall > Download Free Assets: fetches the CC0 asset pack straight into the project.
//   * 15 scanned PBR materials from Poly Haven (colour, normal, and an HDRP mask map built from AO/roughness)
//   * Quaternius Universal Base Characters, Modular Character Outfits and Universal Animation Library 1+2
//     (free "Standard" editions from itch.io, CC0)
// Downloads are cached in <project>/AfterfallDownloads so re-running is quick. If itch.io refuses the
// automatic download, put the four Standard zips in that folder by hand and run the menu again.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Afterfall.Sim;
using UnityEditor;
using UnityEngine;

namespace Afterfall.EditorTools
{
    public static class AssetFetcher
    {
        public const string ThirdParty = "Assets/Afterfall/ThirdParty";
        public static string Downloads => Path.Combine(Path.GetDirectoryName(Application.dataPath), "AfterfallDownloads");

        public static readonly (string key, string page, string zip)[] Packs =
        {
            ("characters", "https://quaternius.itch.io/universal-base-characters", "Universal Base Characters[Standard].zip"),
            ("outfits", "https://quaternius.itch.io/modular-character-outfits-fantasy", "Modular Character Outfits - Fantasy[Standard].zip"),
            ("anims1", "https://quaternius.itch.io/universal-animation-library", "Universal Animation Library[Standard].zip"),
            ("anims2", "https://quaternius.itch.io/universal-animation-library-2", "Universal Animation Library 2[Standard].zip"),
        };

        static volatile string status = "";
        static volatile float progress;
        static Task<string> job;

        [MenuItem("Afterfall/Download Free Assets (CC0)", priority = 1)]
        public static void Download()
        {
            if (job != null && !job.IsCompleted) return;
            if (!EditorUtility.DisplayDialog("Afterfall assets",
                "Download about 520 MB of free CC0 assets (Poly Haven textures, Quaternius characters and mocap animations) into this project?",
                "Download", "Cancel")) return;
            Directory.CreateDirectory(Downloads);
            job = Task.Run(Fetch);
            EditorApplication.update += Poll;
        }

        static void Poll()
        {
            if (!job.IsCompleted)
            {
                if (EditorUtility.DisplayCancelableProgressBar("Afterfall assets", status, progress)) { }
                return;
            }
            EditorApplication.update -= Poll;
            EditorUtility.ClearProgressBar();
            if (job.IsFaulted)
            {
                Debug.LogError("Afterfall asset download failed: " + job.Exception?.GetBaseException().Message);
                EditorUtility.DisplayDialog("Afterfall assets", "Download failed:\n" + job.Exception?.GetBaseException().Message, "OK");
                return;
            }
            if (!string.IsNullOrEmpty(job.Result)) EditorUtility.DisplayDialog("Afterfall assets", job.Result, "OK");
            AssetDatabase.Refresh();
            CatalogBuilder.Build();
        }

        static string Fetch()
        {
            var notes = new List<string>();
            var handler = new HttpClientHandler { CookieContainer = new CookieContainer(), AllowAutoRedirect = true };
            using (var http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(20) })
            {
                http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Afterfall asset fetcher)");
                Textures(http);
                int i = 0;
                foreach (var (key, page, zip) in Packs)
                {
                    progress = .5f + .1f * i++;
                    var dest = Path.Combine(Downloads, zip);
                    if (File.Exists(dest)) continue;
                    status = $"Downloading {zip} from itch.io";
                    try { Itch(http, page, dest); }
                    catch (Exception e) { notes.Add($"{page}\n  ({e.Message})"); }
                }
            }
            if (notes.Count > 0)
                return "Textures are installed, but these free packs couldn't be downloaded automatically. Download the Standard zip from each page, put it in\n" +
                       Downloads + "\nand run Afterfall > Download Free Assets again:\n\n" + string.Join("\n", notes);
            status = "Unpacking characters and animations";
            progress = .92f;
            Unpack();
            return "";
        }

        // --- Poly Haven ------------------------------------------------------------------------------

        static string Get(HttpClient http, string url) => http.GetStringAsync(url).GetAwaiter().GetResult();

        static void Save(HttpClient http, string url, string dest)
        {
            var tmp = dest + ".part";
            using (var r = http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult())
            {
                r.EnsureSuccessStatusCode();
                using (var s = r.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
                using (var f = File.Create(tmp)) s.CopyTo(f);
            }
            if (File.Exists(dest)) File.Delete(dest);
            File.Move(tmp, dest);
        }

        static string MapUrl(string json, string map)
        {
            var m = Regex.Match(json, "\"" + map + "\"\\s*:\\s*\\{.*?\"1k\"\\s*:\\s*\\{\\s*\"jpg\"\\s*:\\s*\\{[^}]*?\"url\"\\s*:\\s*\"([^\"]+)\"", RegexOptions.Singleline);
            if (!m.Success) throw new Exception($"no {map} map listed");
            return m.Groups[1].Value;
        }

        static void Textures(HttpClient http)
        {
            var dir = Path.Combine(Downloads, "polyhaven");
            Directory.CreateDirectory(dir);
            int n = 0;
            foreach (var (key, id) in Catalog.TEXTURES)
            {
                progress = .45f * n++ / Catalog.TEXTURES.Length;
                status = $"Poly Haven: {id}";
                var files = new Dictionary<string, string>();
                foreach (var (map, suffix) in new[] { ("Diffuse", "diff"), ("nor_gl", "nor"), ("arm", "arm") })
                {
                    var path = Path.Combine(dir, $"{id}_{suffix}.jpg");
                    if (!File.Exists(path))
                    {
                        string json = Get(http, $"https://api.polyhaven.com/files/{id}");
                        Save(http, MapUrl(json, map), path);
                    }
                    files[suffix] = path;
                }
                var infoPath = Path.Combine(dir, id + ".json");
                if (!File.Exists(infoPath)) File.WriteAllText(infoPath, Get(http, $"https://api.polyhaven.com/info/{id}"));
            }
        }

        // --- itch.io ---------------------------------------------------------------------------------

        static string Csrf(string html) => Regex.Match(html, "csrf_token\" value=\"([^\"]*)\"").Groups[1].Value;
        /// <summary>The top-level "url" of a JSON object (nested objects carry share links and such).</summary>
        static string JsonUrl(string json)
        {
            int depth = 0;
            bool inString = false;
            for (int i = 0; i < json.Length; i++)
            {
                char c = json[i];
                if (inString)
                {
                    if (c == '\\') i++;
                    else if (c == '"') inString = false;
                    continue;
                }
                if (c == '{' || c == '[') depth++;
                else if (c == '}' || c == ']') depth--;
                else if (c == '"')
                {
                    if (depth == 1 && string.CompareOrdinal(json, i, "\"url\"", 0, 5) == 0)
                    {
                        var m = Regex.Match(json.Substring(i), "^\"url\"\\s*:\\s*\"([^\"]+)\"");
                        if (m.Success) return m.Groups[1].Value.Replace("\\/", "/");
                    }
                    inString = true;
                }
            }
            return "";
        }

        static string Post(HttpClient http, string url, string csrf)
        {
            var body = new FormUrlEncodedContent(new[] { new KeyValuePair<string, string>("csrf_token", csrf) });
            var r = http.PostAsync(url, body).GetAwaiter().GetResult();
            r.EnsureSuccessStatusCode();
            return r.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        }

        /// <summary>A free itch.io download: the same requests the site's download button makes.</summary>
        static void Itch(HttpClient http, string page, string dest)
        {
            string html = Get(http, page);
            string dl = JsonUrl(Post(http, page + "/download_url", Csrf(html)));
            if (dl == "") throw new Exception("no download page offered");
            html = Get(http, dl);
            var uploads = Regex.Matches(html, "data-upload_id=\"(\\d+)\".{0,800}?class=\"name\"[^>]*>([^<]*)<", RegexOptions.Singleline);
            var upload = uploads.Cast<Match>().FirstOrDefault(m => m.Groups[2].Value.Contains("Standard"));
            if (upload == null) throw new Exception("no Standard file on the page");
            string json = Post(http, $"{page}/file/{upload.Groups[1].Value}?source=game_download&after_download_lightbox=1&as_props=1", Csrf(html));
            string url = JsonUrl(json);
            if (url == "") throw new Exception("itch.io refused: " + json);
            Save(http, url, dest);
        }

        // --- unpacking -------------------------------------------------------------------------------

        /// <summary>zip entry path fragment -> destination folder under ThirdParty/Characters</summary>
        static readonly (string pack, string match, string folder)[] Wanted =
        {
            ("characters", "Base Characters/Unity/", "Models"),
            ("characters", "Hairstyles/Rigged to Head Bone/FBX (Unity)/", "Models"),
            ("characters", "Base Characters/Textures/Normals Unity - Godot/", "Textures"),
            ("characters", "Base Characters/Textures/T_", "Textures"),
            ("characters", "Hairstyles/Textures/T_", "Textures"),
            ("outfits", "Exports/FBX (Unity)/Outfits/", "Models"),
            ("outfits", "Textures/Base/", "Textures"),
            ("outfits", "Textures/Peasant/T_", "Textures"),
            ("outfits", "Textures/Ranger/T_", "Textures"),
            ("anims1", "Unity/UAL1_Standard.fbx", "Animations"),
            ("anims2", "Unity/UAL2_Standard.fbx", "Animations"),
        };

        static void Unpack()
        {
            string root = Path.Combine(Path.GetDirectoryName(Application.dataPath), ThirdParty, "Characters");
            foreach (var (key, _, zip) in Packs)
            {
                using (var z = ZipFile.OpenRead(Path.Combine(Downloads, zip)))
                    foreach (var e in z.Entries)
                    {
                        if (e.Name == "" || e.FullName.Contains("Normals-UnrealEngine") || e.FullName.Contains("_RM.")) continue;
                        var w = Wanted.FirstOrDefault(x => x.pack == key && e.FullName.Contains(x.match));
                        if (w.pack == null) continue;
                        // the normal maps for Unity live in their own folder; they replace the generic ones
                        string dir = Path.Combine(root, w.folder);
                        Directory.CreateDirectory(dir);
                        string dest = Path.Combine(dir, e.Name);
                        if (File.Exists(dest) && !e.FullName.Contains("Normals Unity")) continue;
                        e.ExtractToFile(dest, true);
                    }
            }
        }
    }
}
