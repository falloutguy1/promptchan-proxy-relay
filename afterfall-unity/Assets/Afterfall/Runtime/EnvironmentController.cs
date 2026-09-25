// Sun, moon, sky, clouds, fog, rain and the camera's look, all driven by the simulation's clock and
// weather. Uses HDRP's physically based sky, volumetric clouds and volumetric fog.
using Afterfall.Sim;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Afterfall.Game
{
    public sealed class EnvironmentController
    {
        readonly Simulation sim;
        readonly Light sun, moon;
        readonly HDAdditionalLightData sunHd, moonHd;
        readonly Fog fog;
        readonly VolumetricClouds clouds;
        readonly Exposure exposure;
        readonly ColorAdjustments grade;
        readonly ParticleSystem rain;
        readonly Transform rainT;
        VolumetricClouds.CloudPresets preset = (VolumetricClouds.CloudPresets)(-1);

        public float Night { get; private set; }
        public float Daylight { get; private set; }

        public EnvironmentController(Simulation sim, Transform parent, MaterialLibrary lib)
        {
            this.sim = sim;
            (sun, sunHd) = Directional(parent, "Sun", true);
            (moon, moonHd) = Directional(parent, "Moon", false);
            moon.color = new Color(.62f, .72f, 1f);

            var go = new GameObject("Atmosphere");
            go.transform.SetParent(parent, false);
            var volume = go.AddComponent<Volume>();
            volume.isGlobal = true;
            volume.priority = 10;
            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            volume.sharedProfile = profile;

            var env = profile.Add<VisualEnvironment>(true);
            env.skyType.value = (int)SkyType.PhysicallyBased;
            env.skyAmbientMode.value = SkyAmbientMode.Dynamic;
            var pbs = profile.Add<PhysicallyBasedSky>(true);
            _ = pbs;
            clouds = profile.Add<VolumetricClouds>(true);
            clouds.enable.value = true;
            fog = profile.Add<Fog>(true);
            fog.enabled.value = true;
            fog.enableVolumetricFog.value = true;
            fog.baseHeight.value = (float)sim.world.waterZ;
            fog.maximumHeight.value = (float)sim.world.waterZ + 90;
            fog.albedo.value = new Color(.86f, .88f, .9f);
            fog.anisotropy.value = .6f;
            exposure = profile.Add<Exposure>(true);
            exposure.mode.value = ExposureMode.AutomaticHistogram;
            exposure.limitMin.value = 1.5f;    // keeps nights dark: moonlight shouldn't be exposed like noon
            exposure.limitMax.value = 15f;
            exposure.adaptationSpeedDarkToLight.value = 2;
            exposure.adaptationSpeedLightToDark.value = 1;
            var tone = profile.Add<Tonemapping>(true);
            tone.mode.value = TonemappingMode.ACES;
            grade = profile.Add<ColorAdjustments>(true);
            grade.saturation.value = -18;       // the washed-out look of the genre
            grade.contrast.value = 8;
            var bloom = profile.Add<Bloom>(true);
            bloom.intensity.value = .12f;
            var ao = profile.Add<ScreenSpaceAmbientOcclusion>(true);
            ao.intensity.value = 1.1f;
            ao.radius.value = 1.5f;
            var contact = profile.Add<ContactShadows>(true);
            contact.enable.value = true;
            contact.length.value = .2f;
            var ssr = profile.Add<ScreenSpaceReflection>(true);
            ssr.enabled.value = true;
            var shadows = profile.Add<HDShadowSettings>(true);
            shadows.maxShadowDistance.value = 220;
            var grain = profile.Add<FilmGrain>(true);
            grain.intensity.value = .18f;
            var vignette = profile.Add<Vignette>(true);
            vignette.intensity.value = .22f;

            (rain, rainT) = Rain(parent, lib);
        }

        static (Light, HDAdditionalLightData) Directional(Transform parent, string name, bool shadows)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var l = go.AddComponent<Light>();
            l.type = LightType.Directional;
            var hd = go.AddComponent<HDAdditionalLightData>();
            l.lightUnit = LightUnit.Lux;
            l.shadows = shadows ? LightShadows.Soft : LightShadows.None;
            if (shadows) hd.SetShadowResolution(2048);
            return (l, hd);
        }

        static (ParticleSystem, Transform) Rain(Transform parent, MaterialLibrary lib)
        {
            var go = new GameObject("Rain");
            go.transform.SetParent(parent, false);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop();
            var main = ps.main;
            main.loop = true;
            main.startLifetime = 1.1f;
            main.startSpeed = 16;
            main.startSize = .02f;
            main.maxParticles = 12000;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.startColor = new Color(.75f, .8f, .85f, .35f);
            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Box;
            shape.scale = new Vector3(40, 1, 40);
            shape.rotation = new Vector3(90, 0, 0);
            var emission = ps.emission;
            emission.rateOverTime = 0;
            var r = go.GetComponent<ParticleSystemRenderer>();
            r.renderMode = ParticleSystemRenderMode.Stretch;
            r.lengthScale = 3;
            r.velocityScale = .04f;
            var m = new Material(Shader.Find("HDRP/Unlit"));
            m.SetColor("_UnlitColor", new Color(.7f, .75f, .8f, .25f));
            HDMaterial.SetSurfaceType(m, true);
            MaterialLibrary.Validate(m);
            r.sharedMaterial = m;
            ps.Play();
            return (ps, go.transform);
        }

        public void Update(Transform camera)
        {
            double hour = sim.Hour;
            // the sun rises in the east and sets in the west; simulation axes: x east, y north
            float ang = (float)(hour / 24 * 2 * Mathf.PI - Mathf.PI / 2);
            var sunDir = new Vector3(Mathf.Cos(ang) * .85f, Mathf.Sin(ang), .42f).normalized;   // Unity (x = east, up, z = north)
            float e = sunDir.y;
            Daylight = Mathf.Clamp01(Mathf.SmoothStep(0, 1, (e + .08f) / .38f));
            Night = 1 - Mathf.Clamp01((e + .22f) / .24f);
            float cloud = (float)sim.cloud;
            sun.transform.rotation = Quaternion.LookRotation(-sunDir);
            sun.intensity = Mathf.Lerp(0, 100000, Mathf.Clamp01(e * 3)) * (1 - cloud * .75f);
            sun.enabled = e > -.1f;
            var moonDir = new Vector3(-sunDir.x, Mathf.Abs(sunDir.y) * .8f + .15f, -sunDir.z).normalized;
            moon.transform.rotation = Quaternion.LookRotation(-moonDir);
            moon.intensity = .35f * Night * (1 - cloud * .6f);
            moon.enabled = Night > .05f;
            moon.shadows = sun.enabled ? LightShadows.None : LightShadows.Soft;

            var want = sim.weather switch
            {
                "clear" => VolumetricClouds.CloudPresets.Sparse,
                "overcast" => VolumetricClouds.CloudPresets.Overcast,
                "rain" => VolumetricClouds.CloudPresets.Overcast,
                "storm" => VolumetricClouds.CloudPresets.Stormy,
                _ => VolumetricClouds.CloudPresets.Cloudy,
            };
            if (want != preset)
            {
                preset = want;
                clouds.cloudPreset = want;
            }
            // fog: mean free path from 900 m (clear) down to 45 m (thick fog)
            float f = (float)sim.fogAmount, rainAmt = (float)sim.rain;
            fog.meanFreePath.value = Mathf.Lerp(900, 45, Mathf.Clamp01(f * .9f + rainAmt * .25f));
            grade.saturation.value = Mathf.Lerp(-18, -32, Mathf.Max(cloud, rainAmt));

            rainT.position = camera.position + Vector3.up * 14 + camera.forward * 8;
            var emission = rain.emission;
            emission.rateOverTime = rainAmt > .08f ? rainAmt * 9000 : 0;
        }
    }
}
