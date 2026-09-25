#!/bin/sh
# Convert the PNGs written by the Blender scripts into the WebP files the game loads.
#   sh to_webp.sh PNG_DIR OUT_DIR        (needs cwebp from Google's libwebp)
set -e
IN=${1:-tex}
OUT=${2:-webp}
mkdir -p "$OUT"
for f in "$IN"/*.png; do
  b=$(basename "$f" .png)
  case "$b" in
    *_render) continue ;;
    dirt_*|cracked_*|grass_*|rock_c_*|rock_n_*) opts="-q 90 -alpha_q 80 -exact" ;; # terrain: roughness / height ride in alpha
    branch_*) opts="-q 88 -alpha_q 100 -exact" ;;                             # cut-out card: keep colour under clear pixels
    rocks_n_*|rocks1_n_*) opts="-q 92 -noalpha" ;;
    *) opts="-q 90 -noalpha" ;;
  esac
  cwebp -quiet -m 6 $opts "$f" -o "$OUT/$b.webp"
done
