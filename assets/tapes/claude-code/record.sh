#!/bin/sh
# Records the README images: the three live takes, with screenshots, in a
# macOS window on GitHub's page background. The main and Claude Code takes are
# sped up where the model works, and the short recall take is not. A dark
# theme goes on the dark page, and a theme whose name ends in -light on the
# light page. The model turns run on the account that Claude Code is logged
# in with: two in the main take, one in each other take.
#
#   ./record.sh             both README sets: graphite-dark (dark) and graphite-light (light)
#   ./record.sh <theme>     one theme: a file in settings/
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
[ -f "settings/$theme.tape" ] || { echo "no theme settings/$theme.tape" >&2; exit 2; }
cp "settings/$theme.tape" .theme.tape
printf '%s\n' "$theme" > .theme-name
case $theme in *-light) modes=light window=light ;; *) modes=dark window=dark ;; esac
mkdir -p out "out/$theme"

vhs main.tape
# The main and Claude Code takes have two model turns each, so their times come from the take itself.
python3 speed.py out/main-raw.mp4 "out/$theme/main-plain.mp4" 6 6 4.5
for mode in $modes; do
  "$frame" "out/$theme/main-plain.mp4" "out/$theme/main-$mode.mp4" "$mode" "$title" "$window"
  "$frame" "out/$theme/main-plain.mp4" "out/$theme/main-$mode.gif" "$mode" "$title" "$window"
done
mv out/main-raw.mp4 "out/$theme/main-raw.mp4"
vhs claude-code.tape
python3 speed.py out/claude-code-raw.mp4 "out/$theme/claude-code-plain.mp4" 8 12 6
for mode in $modes; do
  "$frame" "out/$theme/claude-code-plain.mp4" "out/$theme/claude-code-$mode.mp4" "$mode" "$title" "$window"
  "$frame" "out/$theme/claude-code-plain.mp4" "out/$theme/claude-code-$mode.gif" "$mode" "$title" "$window"
done
mv out/claude-code-raw.mp4 "out/$theme/claude-code-raw.mp4"
# The recall turn is short, so it plays at normal speed.
vhs recall.tape
for mode in $modes; do
  "$frame" out/recall-raw.mp4 "out/$theme/recall-$mode.mp4" "$mode" "$title" "$window"
  "$frame" out/recall-raw.mp4 "out/$theme/recall-$mode.gif" "$mode" "$title" "$window"
done
mv out/recall-raw.mp4 "out/$theme/recall-raw.mp4"
for png in out/*.png; do
  base=$(basename "$png" .png)
  for mode in $modes; do
    "$frame" "$png" "out/$theme/$base-$mode.png" "$mode" "$title" "$window"
  done
  mv "$png" "out/$theme/$base-plain.png"
done
ls -la "out/$theme"
