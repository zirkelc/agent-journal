#!/usr/bin/env python3
"""Speeds up a Pi take where the model works.

    speed-pi.py <raw.mp4> <out.mp4>

During a turn, Pi writes "Working" at the left of the line above the prompt.
The frames with it are the model turns. Each turn plays 5 times faster, except
its first and last second, and the rest of the take plays at normal speed.
"""
import subprocess
import sys

raw, out = sys.argv[1], sys.argv[2]
FPS = 10
size = subprocess.run(
    ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', raw],
    capture_output=True, text=True, check=True).stdout.strip()
W, H = (int(v) for v in size.split('x'))
frames = subprocess.run(
    ['ffmpeg', '-v', 'error', '-i', raw, '-vf', f'fps={FPS},format=gray', '-f', 'rawvideo', '-'],
    capture_output=True, check=True).stdout
n = len(frames) // (W * H)


def working(i):
    """Whether text is at the left end of a line near the bottom: a plain line is one row, the label is several."""
    f = frames[i * W * H:(i + 1) * W * H]
    bg = f[(H - 2) * W + 2]
    rows = 0
    for y in range(H - 145, H - 118):
        part = f[y * W + 50:y * W + 170]
        if sum(1 for p in part if abs(p - bg) > 30) > 0.1 * len(part):
            rows += 1
    return rows >= 5


states = [working(i) for i in range(n)]
# The turns: runs of frames with the label, where a gap of up to 2 seconds does not end a run.
turns, i = [], 0
while i < n:
    if not states[i]:
        i += 1
        continue
    j = i
    while j < n and any(states[j:j + 2 * FPS]):
        j += 1
    turns.append((i / FPS, j / FPS))
    i = j
turns = [(a, b) for a, b in turns if b - a > 6]
print('turns ' + ', '.join(f'{a:.1f}-{b:.1f}s' for a, b in turns), file=sys.stderr)

segments, at = [], 0.0
for a, b in turns:
    segments += [(at, a + 1, 1), (a + 1, b - 1, 5)]
    at = b - 1
segments.append((at, None, 1))
parts, labels = [], []
for k, (a, b, speed) in enumerate(segments):
    trim = f'trim={a:.2f}' + (f':{b:.2f}' if b is not None else '')
    parts.append(f'[0:v]{trim},setpts=(PTS-STARTPTS)/{speed}[s{k}]')
    labels.append(f'[s{k}]')
graph = ';'.join(parts) + ';' + ''.join(labels) + f'concat=n={len(segments)}:v=1:a=0,format=yuv420p[v]'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-filter_complex', graph, '-map', '[v]',
                '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', out], check=True)
