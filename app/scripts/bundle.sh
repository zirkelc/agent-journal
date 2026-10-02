#!/bin/sh
#
# Builds Agent Journal.app from the Swift package.
#
#   app/scripts/bundle.sh [release|debug]
#
# SwiftPM builds an executable, not an app, so this lays out the bundle around
# it: the binary, the resource bundles its packages ship, an Info.plist, and a
# copy of the CLI. The CLI goes in with the app rather than being looked up on
# PATH, so the app always talks to the version it was built with, and it keeps
# the checkout's layout (bin/, lib/, INSTRUCTIONS.md) because the script finds
# its own files relative to itself.

set -eu

config=${1:-release}
case $config in
  release | debug) ;;
  *) printf 'usage: %s [release|debug]\n' "$0" >&2; exit 2 ;;
esac

package=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$package/.." && pwd)

swift build -c "$config" --package-path "$package"
bin=$(swift build -c "$config" --package-path "$package" --show-bin-path)

out=$package/build
app="$out/Agent Journal.app"
contents=$app/Contents

# A previous build is moved aside rather than merged into, so a file dropped
# from the bundle does not linger in it. The temporary directory is the
# system's to clean up.
if [ -e "$app" ]; then
  mv "$app" "$(mktemp -d)/"
fi

mkdir -p "$contents/MacOS" "$contents/Resources/cli/bin" "$contents/Resources/cli/lib"

cp "$bin/AgentJournal" "$contents/MacOS/AgentJournal"

# Packages find their resources in Contents/Resources when linked into an app.
for bundle in "$bin"/*.bundle; do
  [ -e "$bundle" ] || continue
  cp -R "$bundle" "$contents/Resources/"
done

cp "$repo/bin/agent-journal" "$contents/Resources/cli/bin/agent-journal"
cp "$repo/lib/install.sh" "$contents/Resources/cli/lib/install.sh"
cp "$repo/INSTRUCTIONS.md" "$contents/Resources/cli/INSTRUCTIONS.md"
chmod +x "$contents/Resources/cli/bin/agent-journal"

if [ -f "$package/Resources/AppIcon.icns" ]; then
  cp "$package/Resources/AppIcon.icns" "$contents/Resources/AppIcon.icns"
fi

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$repo/package.json" | head -n 1)

cat > "$contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Agent Journal</string>
  <key>CFBundleDisplayName</key>
  <string>Agent Journal</string>
  <key>CFBundleIdentifier</key>
  <string>com.zirkelc.agent-journal</string>
  <key>CFBundleExecutable</key>
  <string>AgentJournal</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version:-0.0.0}</string>
  <key>CFBundleVersion</key>
  <string>${version:-0.0.0}</string>
  <key>LSMinimumSystemVersion</key>
  <string>15.0</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
EOF

# Ad hoc, which is enough to run on this machine. Distribution needs a
# Developer ID signature and notarization on top.
codesign --force --deep --sign - "$app"

printf '%s\n' "$app"
