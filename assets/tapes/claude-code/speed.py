#!/usr/bin/env python3
"""Speeds up a take with two model turns where the model works, and the shell part between them a little.

    speed.py <raw.mp4> <out.mp4> <start> <hold> <lead>

start: seconds into the take where the first turn starts. hold: seconds from
the end of the first turn to /exit. lead: seconds from the second start of
Claude Code to the second question's Enter. The last 9 seconds stay at normal
speed. These come from the fixed waits of the tape.

The model turns take a different time on each take, so the times come from the
take itself. Claude Code's fullscreen view has a line across the whole terminal
above and below the prompt, and the shell has none. So the take is Claude Code,
then the shell, then Claude Code again, and the two changes give the times when
Claude exits and when it starts again. The rest follows from the fixed waits in
the tape.
"""
import subprocess
import sys

raw, out = sys.argv[1], sys.argv[2]
start, hold, lead = (float(v) for v in sys.argv[3:6])
FPS = 10
size = subprocess.run(
    ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', raw],
    capture_output=True, text=True, check=True).stdout.strip()
W, H = (int(v) for v in size.split('x'))
frames = subprocess.run(
    ['ffmpeg', '-v', 'error', '-i', raw, '-vf', f'fps={FPS},format=gray', '-f', 'rawvideo', '-'],
    capture_output=True, check=True).stdout
n = len(frames) // (W * H)


def fullscreen(i):
    """Whether a row near the bottom differs from the background along 90 percent of its width."""
    f = frames[i * W * H:(i + 1) * W * H]
    bg = f[(H - 2) * W + 2]
    for y in range(H - 140, H - 30):
        row = f[y * W + 20:y * W + W - 20]
        if sum(1 for p in row[::4] if abs(p - bg) > 12) > 0.9 * len(row[::4]):
            return True
    return False


states = [fullscreen(i) for i in range(n)]
# The first frame of the shell, and the first frame of the second Claude Code after it.
exit_at = next(i for i in range(n) if not states[i] and all(not s for s in states[i:i + FPS])) / FPS
start2 = next(i for i in range(int(exit_at * FPS), n) if states[i] and all(states[i:i + FPS])) / FPS
end = n / FPS

segments = [
    (0, start, 1),
    (start, exit_at - hold, 5),
    (exit_at - hold, exit_at, 1),
    (exit_at, start2, 1.5),
    (start2, start2 + lead, 1),
    (start2 + lead, end - 9, 5),
    (end - 9, None, 1),
]
parts, labels = [], []
for k, (a, b, speed) in enumerate(segments):
    trim = f'trim={a:.2f}' + (f':{b:.2f}' if b is not None else '')
    parts.append(f'[0:v]{trim},setpts=(PTS-STARTPTS)/{speed}[s{k}]')
    labels.append(f'[s{k}]')
graph = ';'.join(parts) + ';' + ''.join(labels) + f'concat=n={len(segments)}:v=1:a=0,format=yuv420p[v]'
print(f'exit {exit_at:.1f}s, second start {start2:.1f}s, end {end:.1f}s', file=sys.stderr)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-filter_complex', graph, '-map', '[v]',
                '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', out], check=True)
