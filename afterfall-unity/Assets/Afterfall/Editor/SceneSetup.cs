// Afterfall > Create Game Scene: a scene with the game component and a camera, and the HDRP features the
// game uses (volumetric clouds and fog, screen-space reflections and ambient occlusion) switched on in the
// active HDRP asset.
using Afterfall.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Afterfall.EditorTools
{
    public static class SceneSetup
    {
        const string ScenePath = "Assets/Afterfall/Afterfall.unity";

        [MenuItem("Afterfall/Create Game Scene", priority = 0)]
        public static void Create()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            EnableHdrpFeatures();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var cam = new GameObject("Main Camera") { tag = "MainCamera" };
            var c = cam.AddComponent<Camera>();
            c.nearClipPlane = .15f;
            c.farClipPlane = 2500;
            cam.AddComponent<AudioListener>();
            cam.transform.position = new Vector3(140, 40, 100);
            new GameObject("Afterfall").AddComponent<AfterfallGame>();
            EditorSceneManager.SaveScene(scene, ScenePath);
            var list = new System.Collections.Generic.List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            if (!list.Exists(s => s.path == ScenePath)) list.Insert(0, new EditorBuildSettingsScene(ScenePath, true));
            EditorBuildSettings.scenes = list.ToArray();
            if (AfterfallAssets.Load() == null && Resources.Load<AfterfallAssets>("AfterfallAssets") == null)
                Debug.Log("Afterfall: scene created. For scanned textures and mocap characters run Afterfall > Download Free Assets, then press Play.");
            else Debug.Log("Afterfall: scene created. Press Play.");
        }

        [MenuItem("Afterfall/Enable HDRP Features", priority = 3)]
        public static void EnableHdrpFeatures()
        {
            var rp = GraphicsSettings.defaultRenderPipeline;
            if (rp == null || !rp.GetType().Name.Contains("HDRenderPipelineAsset"))
            {
                EditorUtility.DisplayDialog("Afterfall", "This project isn't using HDRP. Create a new project from the Unity 6 \"High Definition 3D\" template and copy the Assets/Afterfall folder into it.", "OK");
                return;
            }
            var so = new SerializedObject(rp);
            foreach (var field in new[] { "supportVolumetricClouds", "supportVolumetrics", "supportSSR", "supportSSAO" })
            {
                var p = so.FindProperty("m_RenderPipelineSettings." + field);
                if (p != null) p.boolValue = true;
            }
            so.ApplyModifiedProperties();
            AssetDatabase.SaveAssets();
        }
    }
}
