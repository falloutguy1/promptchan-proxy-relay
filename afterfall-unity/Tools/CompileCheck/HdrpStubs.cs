// Compile-check stubs: the subset of HDRP 17.0.4 / SRP Core 17.0.4 that Afterfall calls, with signatures
// copied from the package sources shipped with Unity 6000.0. Never part of the Unity project.
using System;
using UnityEngine;

namespace UnityEngine.Rendering
{
    public class VolumeComponent : ScriptableObject { }
    public abstract class VolumeParameter { public bool overrideState; }
    public class VolumeParameter<T> : VolumeParameter { public virtual T value { get; set; } public virtual void Override(T x) { } }
    public class BoolParameter : VolumeParameter<bool> { public enum DisplayType { Checkbox, EnumPopup } public BoolParameter(bool v, DisplayType d = DisplayType.Checkbox) { } }
    public class FloatParameter : VolumeParameter<float> { public FloatParameter(float v) { } }
    public class MinFloatParameter : FloatParameter { public MinFloatParameter(float v, float min) : base(v) { } }
    public class NoInterpMinFloatParameter : VolumeParameter<float> { public NoInterpMinFloatParameter(float v, float min) { } }
    public class ClampedFloatParameter : FloatParameter { public ClampedFloatParameter(float v, float a, float b) : base(v) { } }
    public class NoInterpIntParameter : VolumeParameter<int> { public NoInterpIntParameter(int v) { } }
    public class ColorParameter : VolumeParameter<Color> { public ColorParameter(Color v) { } }
    public class EnumParameter<T> : VolumeParameter<T> where T : Enum { public EnumParameter(T v) { } }
    public sealed class VolumeProfile : ScriptableObject { public T Add<T>(bool overrides = false) where T : VolumeComponent => null; }
    public class Volume : MonoBehaviour { public bool isGlobal { get; set; } public float priority; public VolumeProfile sharedProfile; }
}

namespace UnityEngine.Rendering.HighDefinition
{
    public enum EmissiveIntensityUnit { Nits, EV100 }
    public enum SkyType { HDRI = 1, Procedural = 2, Gradient = 3, PhysicallyBased = 4 }
    public enum SkyAmbientMode { Static, Dynamic }
    public enum ExposureMode { Fixed = 0, Automatic = 1, CurveMapping = 2, UsePhysicalCamera = 3, AutomaticHistogram = 4 }
    public enum TonemappingMode { None, Neutral, ACES, Custom, External }

    public class HDAdditionalLightData : MonoBehaviour { public void SetShadowResolution(int resolution) { } }

    public static class HDMaterial
    {
        public static bool ValidateMaterial(Material material) => true;
        public static void SetSurfaceType(Material material, bool transparent) { }
        public static void SetEmissiveColor(Material material, Color value) { }
        public static void SetUseEmissiveIntensity(Material material, bool value) { }
        public static void SetEmissiveIntensity(Material material, float intensity, EmissiveIntensityUnit unit) { }
        public static void SetAlphaClipping(Material material, bool value) { }
        public static void SetAlphaCutoff(Material material, float cutoff) { }
    }

    public sealed class SkyAmbientModeParameter : VolumeParameter<SkyAmbientMode> { }
    public sealed class ExposureModeParameter : VolumeParameter<ExposureMode> { }
    public sealed class TonemappingModeParameter : VolumeParameter<TonemappingMode> { }

    public sealed class VisualEnvironment : VolumeComponent { public NoInterpIntParameter skyType; public SkyAmbientModeParameter skyAmbientMode; }
    public sealed class PhysicallyBasedSky : VolumeComponent { }
    public sealed class VolumetricClouds : VolumeComponent
    {
        public enum CloudPresets { Sparse, Cloudy, Overcast, Stormy, Custom }
        public BoolParameter enable;
        public CloudPresets cloudPreset { get; set; }
    }
    public sealed class Fog : VolumeComponent
    {
        public BoolParameter enabled, enableVolumetricFog;
        public FloatParameter baseHeight, maximumHeight;
        public MinFloatParameter meanFreePath;
        public ColorParameter albedo;
        public ClampedFloatParameter anisotropy;
    }
    public sealed class Exposure : VolumeComponent
    {
        public ExposureModeParameter mode;
        public FloatParameter limitMin, limitMax;
        public MinFloatParameter adaptationSpeedDarkToLight, adaptationSpeedLightToDark;
    }
    public sealed class Tonemapping : VolumeComponent { public TonemappingModeParameter mode; }
    public sealed class ColorAdjustments : VolumeComponent { public ClampedFloatParameter contrast, saturation; }
    public sealed class Bloom : VolumeComponent { public ClampedFloatParameter intensity; }
    public sealed class ScreenSpaceAmbientOcclusion : VolumeComponent { public ClampedFloatParameter intensity, radius; }
    public sealed class ContactShadows : VolumeComponent { public BoolParameter enable; public ClampedFloatParameter length; }
    public class ScreenSpaceReflection : VolumeComponent { public BoolParameter enabled; }
    public class HDShadowSettings : VolumeComponent { public NoInterpMinFloatParameter maxShadowDistance; }
    public sealed class FilmGrain : VolumeComponent { public ClampedFloatParameter intensity; }
    public sealed class Vignette : VolumeComponent { public ClampedFloatParameter intensity; }
}
