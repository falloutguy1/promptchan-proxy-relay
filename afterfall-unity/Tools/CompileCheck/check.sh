#!/bin/sh
# Compile-checks the Unity project's C# against Unity 6000.0's engine/editor assemblies (and HDRP stubs).
# Usage: UNITY=/path/to/Editor/Data sh check.sh
set -e
UNITY=${UNITY:-/opt/unity/Editor/Data}
DOTNET=${DOTNET:-/opt/dotnet/dotnet}
CSC=$(ls $(dirname $DOTNET)/sdk/*/Roslyn/bincore/csc.dll | head -1)
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${OUT:-/tmp/afterfall-check}
mkdir -p $OUT
REFS="-r:$UNITY/NetStandard/ref/2.1.0/netstandard.dll"
for d in $UNITY/Managed/UnityEngine/UnityEngine.*Module.dll; do REFS="$REFS -r:$d"; done
C="$DOTNET $CSC -nologo -langversion:9.0 -nostdlib -noconfig -nowarn:1701,1702,0649,0414,0169 -target:library"
$C $REFS -out:$OUT/Afterfall.Sim.dll $ROOT/Assets/Afterfall/Sim/*.cs
$C $REFS -out:$OUT/HdrpStubs.dll $ROOT/Tools/CompileCheck/HdrpStubs.cs
$C $REFS -define:ENABLE_LEGACY_INPUT_MANAGER -r:$OUT/Afterfall.Sim.dll -r:$OUT/HdrpStubs.dll -out:$OUT/Afterfall.Runtime.dll $ROOT/Assets/Afterfall/Runtime/*.cs
if ls $ROOT/Assets/Afterfall/Editor/*.cs >/dev/null 2>&1; then
  # the editor assemblies build against the monolithic UnityEngine.dll/UnityEditor.dll, so recompile the rest the same way
  M="-r:$UNITY/NetStandard/ref/2.1.0/netstandard.dll -r:$UNITY/Managed/UnityEngine.dll"
  mkdir -p $OUT/mono
  $C $M -out:$OUT/mono/Afterfall.Sim.dll $ROOT/Assets/Afterfall/Sim/*.cs
  $C $M -out:$OUT/mono/HdrpStubs.dll $ROOT/Tools/CompileCheck/HdrpStubs.cs
  $C $M -define:ENABLE_LEGACY_INPUT_MANAGER -r:$OUT/mono/Afterfall.Sim.dll -r:$OUT/mono/HdrpStubs.dll -out:$OUT/mono/Afterfall.Runtime.dll $ROOT/Assets/Afterfall/Runtime/*.cs
  $C $M -r:$UNITY/Managed/UnityEditor.dll -r:$OUT/mono/Afterfall.Sim.dll -r:$OUT/mono/HdrpStubs.dll -r:$OUT/mono/Afterfall.Runtime.dll -out:$OUT/Afterfall.Editor.dll $ROOT/Assets/Afterfall/Editor/*.cs
fi
echo "compile check passed"
