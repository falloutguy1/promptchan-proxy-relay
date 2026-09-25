// Catalogue of the imported CC0 assets, written by the editor importer (Afterfall > Download Free Assets)
// to Assets/Afterfall/Resources/AfterfallAssets.asset. The game runs without it, in a plain look.
using System;
using System.Collections.Generic;
using UnityEngine;

namespace Afterfall.Game
{
    [Serializable]
    public class SurfaceEntry
    {
        public string key;              // "brick", "grass"...
        public Texture2D albedo, normal, mask;
        public float sizeM = 2;         // real-world size of one tile
        public Color mean = Color.gray; // the scan's average colour
    }

    [Serializable]
    public class TextureSet
    {
        public string material;         // FBX material name, e.g. "MI_Ranger"
        public Texture2D albedo, normal, mask;
        public Texture2D[] variants = new Texture2D[0];   // alternative albedos (colourways)
        public Texture2D zombieAlbedo;  // grimed and bloodied copy
    }

    [Serializable]
    public class NamedModel
    {
        public string name;
        public GameObject model;
    }

    [CreateAssetMenu(menuName = "Afterfall/Asset Catalogue")]
    public class AfterfallAssets : ScriptableObject
    {
        public Material litTemplate, terrainTemplate, unlitTemplate, decalTemplate;
        public List<SurfaceEntry> surfaces = new List<SurfaceEntry>();
        public List<NamedModel> models = new List<NamedModel>();
        public List<TextureSet> characterTextures = new List<TextureSet>();
        public List<AnimationClip> clips = new List<AnimationClip>();

        public SurfaceEntry Surface(string key) => surfaces.Find(s => s.key == key);
        public GameObject Model(string name) => models.Find(m => m.name == name)?.model;
        public TextureSet CharacterTextures(string material) => characterTextures.Find(t => material.StartsWith(t.material, StringComparison.Ordinal));
        public AnimationClip Clip(string name) => clips.Find(c => c != null && c.name == name);
        public bool HasCharacters => Model("Male_Ranger") != null && clips.Count > 0;

        static AfterfallAssets cached;
        static bool looked;

        public static AfterfallAssets Load()
        {
            if (!looked)
            {
                looked = true;
                cached = Resources.Load<AfterfallAssets>("AfterfallAssets");
            }
            return cached;
        }
    }
}
