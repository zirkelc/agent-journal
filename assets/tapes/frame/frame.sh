#!/bin/sh
# Puts a take into a macOS window on a GitHub page background.
#
#   frame.sh <in.mp4|in.png> <out.mp4|out.gif|out.png> <light|dark> [title] [window]
#
# The third argument is the page background, window the title bar (light or
# dark, default dark). The input is a take or a screenshot with no window of its own. The frame is
# frame.html, drawn by headless Chrome (set CHROME to use another binary).
set -eu
in=$1 out=$2 mode=$3 title=${4:-} window=${5:-dark}
FRAME=$(cd "$(dirname "$0")" && pwd)
CHROME=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
m=24 bar=40

size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$in")
w=${size%x*} h=${size#*x}
W=$((w + 2 * m)) H=$((h + bar + 2 * m))

tmp=$(mktemp -d "${TMPDIR:-/tmp}/frame.XXXXXX")
query="w=$w&h=$h&m=$m&bar=$bar&mode=$mode&window=$window&title=$(printf '%s' "$title" | sed 's/ /%20/g')"
"$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --force-device-scale-factor=1 --window-size="$W,$H" \
  --screenshot="$tmp/frame.png" "file://$FRAME/frame.html?$query" >/dev/null 2>&1

# The take goes under the frame, which is transparent only where the terminal shows.
compose="[0:v]pad=$W:$H:$m:$((m + bar))[v];[v][1:v]overlay=0:0"
case $out in
  *.png)
    ffmpeg -v error -y -i "$in" -i "$tmp/frame.png" -filter_complex "$compose" -frames:v 1 "$out" ;;
  *.mp4)
    ffmpeg -v error -y -i "$in" -i "$tmp/frame.png" -filter_complex "$compose,format=yuv420p" \
      -c:v libx264 -crf 18 -preset slow -movflags +faststart "$out" ;;
  *.gif)
    ffmpeg -v error -y -i "$in" -i "$tmp/frame.png" -filter_complex \
      "$compose,fps=12,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
      "$out" ;;
  *) echo "frame.sh: unknown output type: $out" >&2; exit 2 ;;
esac
if command -v trash >/dev/null 2>&1; then trash "$tmp"; else rm -rf "$tmp"; fi
