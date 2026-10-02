#!/bin/sh
#
# Renders app/Resources/AppIcon.icns from the plugin icon.
#
#   app/scripts/icon.sh
#
# The plugin icon fills its whole canvas, which is right for a plugin list but
# too large for the Dock, where every icon sits on Apple's grid: an 824 pt shape
# centred on a 1024 pt canvas, with room for a shadow. So the artwork is placed
# on that grid rather than scaled to the edges, rendered once at 1024 with
# Chrome, and scaled down with sips for the smaller sizes.
#
# Run it again only when the icon changes. The result is committed, so building
# the app never needs a browser.

set -eu

package=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$package/.." && pwd)
source_svg=$repo/.claude-plugin/icon.svg

chrome=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
[ -x "$chrome" ] || { printf 'Chrome not found, set CHROME to its binary\n' >&2; exit 1; }

work=$(mktemp -d)
iconset=$work/AppIcon.iconset
mkdir -p "$iconset" "$package/Resources"

# The plugin artwork without its outer <svg> element, so it can be nested.
artwork=$(sed -e '1d' -e '$d' "$source_svg")

cat > "$work/icon.html" <<EOF
<!doctype html>
<html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.3"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <svg x="100" y="100" width="824" height="824" viewBox="0 0 256 256">
$artwork
    </svg>
  </g>
</svg>
</body></html>
EOF

"$chrome" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --window-size=1024,1024 --screenshot="$work/icon_1024.png" "file://$work/icon.html" 2>/dev/null

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$work/icon_1024.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$work/icon_1024.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil --convert icns "$iconset" --output "$package/Resources/AppIcon.icns"
printf '%s\n' "$package/Resources/AppIcon.icns"
