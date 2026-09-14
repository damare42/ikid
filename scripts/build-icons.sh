#!/usr/bin/env bash
# Regenerates the app icons from the brand mark.
#
# Run this if the mark or the brand colours change:
#   bash scripts/build-icons.sh
# Needs ImageMagick (`convert`). Outputs are committed, so this is not part of
# the build — a phone's home-screen icon shouldn't depend on a working
# ImageMagick install in CI.
#
# The mark is the one in site/index.html and client/index.html: two dots and a
# dashed curve, in the brand red. Note that client/public/brand/*.svg are an
# older green palette and are referenced by nothing — do not use them here.
#
# Three sizes, for three different jobs:
#
#   icon-192 / icon-512 (purpose "any") — used as-is. Carries its own
#     background, because a transparent icon puts a dark red dot on whatever
#     wallpaper the user happens to have.
#
#   icon-maskable-512 (purpose "maskable") — Android crops this to whatever
#     shape the launcher uses (circle, squircle, teardrop). Only the inner 80%
#     circle is guaranteed visible, so the mark is scaled to 70% and centred,
#     and the background runs full bleed because the crop eats the edges.
#
#   apple-touch-icon (180) — iOS applies its own rounding and ignores
#     transparency, so this is the flat square.
set -euo pipefail

cd "$(dirname "$0")/.."
out=client/public/icons
mkdir -p "$out"

BG="#f3f2f2"      # the brand card's off-white, same as site/og.svg
DEEP="#8a1f0c"    # the lower dot
RED="#c62f14"     # the upper dot and the curve

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# $1 = pixel size, $2 = transform wrapping the mark (empty for none).
# The width/height matter: ImageMagick rasterises an SVG at its intrinsic size
# and only then applies -resize, so a viewBox-only source renders at 96px and
# gets blown up to 512 — which is exactly the soft, fuzzy icon this produced on
# the first attempt. Emitting the SVG at the target size renders it sharp.
emit_svg() {
  local size=$1 open=$2 close=$3
  cat <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="$size" height="$size" viewBox="0 0 96 96">
  <rect width="96" height="96" fill="$BG"/>
  $open
  <circle cx="26" cy="68" r="11" fill="$DEEP"/>
  <circle cx="70" cy="30" r="11" fill="$RED"/>
  <path d="M33,58 C44,38 52,46 62,38" fill="none" stroke="$RED" stroke-width="5"
        stroke-dasharray="8 8" stroke-linecap="round"/>
  $close
</svg>
EOF
}

render() { # size dest [transform-open] [transform-close]
  local size=$1 dest=$2
  emit_svg "$size" "${3-}" "${4-}" > "$tmp/icon.svg"
  convert -background none "$tmp/icon.svg" "$dest"
  # The mark is three flat colours and two anti-aliased edges. ImageMagick
  # writes 16-bit sRGB by default, which costs 142KB for a 512px picture of two
  # dots; a 64-colour palette is visually identical at a tenth the size, and
  # this ships to phones.
  convert "$dest" -strip -colors 64 "PNG8:$dest"
}

render 192 "$out/icon-192.png"
render 512 "$out/icon-512.png"
render 180 "$out/apple-touch-icon.png"
render 512 "$out/icon-maskable-512.png" '<g transform="translate(14.4,14.4) scale(0.7)">' '</g>'

# A vector copy too: browsers that take it render it crisply at any size, and
# it stays readable in a diff when the mark changes.
emit_svg 512 "" "" > "$out/icon.svg"

identify "$out"/*.png
