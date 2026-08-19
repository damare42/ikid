#!/usr/bin/env bash
# Regenerate the social-preview PNG from og.svg.
#
# og.png is committed because GitHub Pages serves it directly and social
# scrapers (Slack, iMessage, X, LinkedIn) won't render SVG. Edit og.svg, run
# this, and commit both.
set -euo pipefail
cd "$(dirname "$0")"

if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w 1200 -h 630 og.svg -o og.png
elif python3 -c "import cairosvg" >/dev/null 2>&1; then
  python3 -c "import cairosvg; cairosvg.svg2png(url='og.svg', write_to='og.png', output_width=1200, output_height=630)"
else
  echo "Need rsvg-convert (brew install librsvg) or cairosvg (pip install cairosvg)." >&2
  exit 1
fi

echo "og.png regenerated ($(du -h og.png | cut -f1))"
