# Pi recording

The tape in this folder records the image of the Pi section in the [README](../../../README.md) with [vhs](https://github.com/charmbracelet/vhs). It is a live take of the [Claude Code take](../claude-code) in [Pi](https://pi.dev), without the pane. Pi changes `retry()` in a sample repository and writes a journal entry with its `agent_journal_write` tool. Then Pi quits, a new Pi session starts, and Pi answers a question about an older decision from the journal with `agent_journal_list` and `agent_journal_read`.

## Record

```sh
./record.sh               # both README sets: Graphite Dark and Graphite Light
./record.sh <name>        # one theme: ../claude-code/settings/<name>.tape
```

It needs `vhs`, `ttyd`, `ffmpeg`, `git`, the dependencies of this repository (`pnpm install`, which installs Pi), Claude Code (the demo home of the Claude Code tapes reads its version), and a Pi login for Anthropic in `~/.pi/agent/auth.json`. It takes about 2 minutes and two model turns for each theme (about 35 and 10 seconds), with `claude-opus-5-5` on the Anthropic login of Pi. Each take is different, so look at the results before you use them, and run again if you do not like one.

The results go to `out/<theme>/`:

| File | What it shows |
| --- | --- |
| `pi-dark.gif`, `pi-light.gif` (and `.mp4`) | The Pi section image |
| `pi-raw.mp4`, `pi-plain.mp4` | The take at normal speed, and sped up with no window |
| `pi-done-*.png`, `pi-recall-*.png` | The finished turn, and the answer of the new session, also as `-plain` with no window |

To use them, copy `pi-<mode>.gif` to `assets/pi-session-<mode>.gif`.

## How it works

- **Demo home.** `reset.sh` runs the `reset.sh` of the Claude Code tapes, which builds the demo home in `/tmp/agent-journal-demo` with the sample journal and the sample repository. Then it adds Pi's state: the login of the real home (`~/.pi/agent/auth.json`) linked in, the model `anthropic/claude-opus-5-5`, Pi's light or dark theme, and the changelog marked as seen. Pi gets the same user preference as Claude Code in `~/.pi/agent/AGENTS.md`: summaries under 80 characters.
- **Launch.** `launch.sh` starts Pi from this repository's `node_modules` in the sample repository, with a clean environment, the extension from this checkout (`pi/extensions/agent-journal.ts`) and no other extension, skill or MCP server.
- **Waits.** During a turn, the line above the prompt shows `Working`. When the turn is done, it is a plain line again, as is the line below the prompt, and the tape waits for these two plain lines. After `/quit`, vhs does not read the shell screen, so the tape waits a fixed time there.
- **Speed.** `speed.py` finds the turns from the `Working` label in the take and plays them 5 times faster, except their first and last second.
- **Look.** The theme files and the window frame are those of the Claude Code tapes. The size is 1400×1000, as in the main take.
