// Import settings for the downloaded asset pack (applied automatically on import):
// Quaternius FBX files become Humanoid rigs with baked axis conversion and readable meshes; clips whose
// name ends in _Loop loop; normal and mask textures get the right texture types.
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Afterfall.EditorTools
{
    public sealed class AfterfallImport : AssetPostprocessor
    {
        bool Ours => assetPath.StartsWith(AssetFetcher.ThirdParty);

        void OnPreprocessModel()
        {
            if (!Ours) return;
            var mi = (ModelImporter)assetImporter;
            mi.globalScale = 1;
            mi.useFileUnits = true;
            mi.bakeAxisConversion = true;
            mi.isReadable = true;                       // the head is cut out of a full body at runtime
            mi.animationType = ModelImporterAnimationType.Human;
            mi.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
            mi.optimizeGameObjects = false;
            mi.importAnimation = assetPath.Contains("/Animations/");
            mi.importCameras = false;
            mi.importLights = false;
            mi.materialImportMode = ModelImporterMaterialImportMode.ImportViaMaterialDescription;
        }

        void OnPreprocessAnimation()
        {
            if (!Ours || !assetPath.Contains("/Animations/")) return;
            var mi = (ModelImporter)assetImporter;
            var clips = mi.defaultClipAnimations;
            foreach (var c in clips)
            {
                c.loopTime = c.name.EndsWith("_Loop");
                c.lockRootRotation = true;
                c.lockRootHeightY = true;
                c.lockRootPositionXZ = true;
                c.keepOriginalOrientation = true;
                c.keepOriginalPositionY = true;
                c.keepOriginalPositionXZ = true;
            }
            mi.clipAnimations = clips;
        }

        void OnPreprocessTexture()
        {
            if (!Ours) return;
            var ti = (TextureImporter)assetImporter;
            string name = Path.GetFileNameWithoutExtension(assetPath);
            ti.maxTextureSize = 2048;
            ti.mipmapEnabled = true;
            ti.anisoLevel = 8;
            if (name.EndsWith("_Normal") || name.EndsWith("_normal"))
            {
                ti.textureType = TextureImporterType.NormalMap;
            }
            else if (name.EndsWith("_Mask") || name.EndsWith("_mask") || name.EndsWith("_ORM") || name.EndsWith("_Roughness"))
            {
                ti.textureType = TextureImporterType.Default;
                ti.sRGBTexture = false;
            }
            else ti.sRGBTexture = true;
            if (name.EndsWith("_Zombie") || name.EndsWith("_Mask") || name.EndsWith("_mask")) ti.isReadable = false;
        }
    }
}
