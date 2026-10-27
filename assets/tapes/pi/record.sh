#!/bin/sh
# Records the Pi image of the README: the live take, with screenshots, in a
# macOS window on GitHub's page background, sped up where the model works. It
# uses the themes of the Claude Code tapes. A dark theme goes on the dark page,
# and a theme whose name ends in -light on the light page. The two model turns
# run on the Anthropic login of Pi.
#
#   ./record.sh             both README sets: graphite-dark (dark) and graphite-light (light)
#   ./record.sh <theme>     one theme: a file in ../claude-code/settings/
#
# TITLE sets the window title (default: Terminal). Writes to out/<theme>/.
set -eu
cd "$(dirname "$0")"
if [ $# -eq 0 ]; then
  ./record.sh graphite-dark
  exec ./record.sh graphite-light
fi
theme=$1
title=${TITLE:-Terminal}
frame=../frame/frame.sh
settings=../claude-code/settings/$theme.tape
[ -f "$settings" ] || { echo "no theme $settings" >&2; exit 2; }
cp "$settings" .theme.tape
printf '%s\n' "$theme" > .theme-name
case $theme in *-light) modes=light window=light ;; *) modes=dark window=dark ;; esac
mkdir -p out "out/$theme"

vhs pi.tape
python3 speed.py out/pi-raw.mp4 "out/$theme/pi-plain.mp4"
for mode in $modes; do
  "$frame" "out/$theme/pi-plain.mp4" "out/$theme/pi-$mode.mp4" "$mode" "$title" "$window"
  "$frame" "out/$theme/pi-plain.mp4" "out/$theme/pi-$mode.gif" "$mode" "$title" "$window"
done
mv out/pi-raw.mp4 "out/$theme/pi-raw.mp4"
for png in out/*.png; do
  base=$(basename "$png" .png)
  for mode in $modes; do
    "$frame" "$png" "out/$theme/$base-$mode.png" "$mode" "$title" "$window"
  done
  mv "$png" "out/$theme/$base-plain.png"
done
ls -la "out/$theme"
