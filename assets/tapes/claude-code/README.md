# Claude Code recordings

The tapes in this folder record the images at the top of the [README](../../../README.md) and of the [Claude Code README](../../../claude-code/README.md) with [vhs](https://github.com/charmbracelet/vhs). Each one is a live take: Claude Code changes `retry()` in a sample repository and writes a journal entry. Then Claude exits, and the shell shows the entry in `~/agent-journal`.

## Record

```sh
./record.sh               # both README sets: Atom (dark) and Atom One Light (light)
./record.sh <name>        # one theme: settings/<name>.tape
```

It needs `vhs`, `ttyd`, `ffmpeg`, `git` and Claude Code with a login. It takes about 4 minutes and two model turns for each theme of about 30 seconds each, on the account that Claude Code is logged in with. Each take is different, so look at the results before you use them, and run again if you do not like one.

The results go to `out/<theme>/`:

| File | Tape | What it shows |
| --- | --- | --- |
| `main-dark.gif`, `main-light.gif` (and `.mp4`) | `main.tape` | The main README image: the take with no pane, for any agent |
| `claude-code-dark.gif`, `claude-code-light.gif` (and `.mp4`) | `claude-code.tape` | The Claude Code README image: the take with the journal pane open, and the new entry opened in it |
| `*-raw.mp4`, `*-plain.mp4` | both | The takes at normal speed, and sped up with no window |
| `main-done-*.png`, `main-end-*.png` | `main.tape` | The finished turn, and the shell at the end |
| `claude-code-pane-*.png`, `claude-code-pane-entry-*.png`, `claude-code-end-*.png` | `claude-code.tape` | The pane after the turn, the opened entry, and the shell at the end |

The dark theme (`atom`) gives the `-dark` files, and the light theme (`atom-light`) the `-light` files. The screenshots also come as `-plain`, with no window. To use them, copy them to `assets/`: `main-<mode>.gif` to `session-<mode>.gif`, `claude-code-<mode>.gif` to `claude-code-session-<mode>.gif`, and `claude-code-pane-<mode>.png` and `claude-code-pane-entry-<mode>.png` with the same names. The READMEs show the version that matches the reader's GitHub theme.

## How it works

- **Demo home.** `reset.sh` builds a new home folder in `/tmp/agent-journal-demo` (set `AGENT_JOURNAL_DEMO_HOME` to use another one) from `fixture/`: the sample journal in `~/agent-journal`, the sample repository in `~/Developer/my-awesome-lib` with one commit, and a config with the demo host `macbook` and the demo user `chris`. The takes run Claude Code and the shell with this folder as `HOME`, so the recordings show `~/agent-journal`, and the real home is never read or changed.
- **Login.** Claude Code finds its login on macOS in the login keychain under `~/Library/Keychains`, and elsewhere in `~/.claude/.credentials.json`. `reset.sh` links that one item into the demo home. Nothing else of the real home is in it.
- **Claude Code state.** `reset.sh` writes the demo home's `~/.claude.json` (onboarding done, the sample repository trusted, a pane width of 70 columns, and the notices, hints and promos of a new install marked as seen) and `~/.claude/settings.json` (the fullscreen renderer, which puts the pane beside the chat, auto mode accepted, and no prompt suggestions). If a new version of Claude Code shows a new notice on the start screen, find its key in a `~/.claude.json` that has seen it, and add it to `reset.sh`.
- **Launch.** `launch.sh` starts Claude Code in the sample repository with a clean environment, the plugin from this checkout (`--plugin-dir` at `claude-code/`), no MCP servers and auto mode.
- **Speed.** `record.sh` plays the part where the model works 5 times faster. It starts 6 seconds (main) or 8 seconds (Claude Code) into the take and ends 24 or 31 seconds before the end, because everything after the turn has fixed waits. If a later version of Claude Code changes these times, find the new ones on frames of the raw take and change the numbers in `record.sh`.
- **Look.** `settings/<theme>.tape` sets the font and the theme. `atom` is Atom, and `atom-light` is Atom One Light. Each has the background of the journal pane in Claude Code's dark or light theme, so the pane and the terminal have one color. For a theme whose name ends in `-light`, `reset.sh` also sets Claude Code's own theme to light. Each tape sets its own size after it: 1400×1000 for the main take and 1600×1000 for the Claude Code take, so the pane has room beside the chat.
- **Window.** vhs draws no window title, so the takes have no window, and `record.sh` puts each output into one with [`../frame/frame.sh`](../frame): a macOS title bar with a title (`TITLE`, default `Terminal`), rounded corners and a margin of 24 pixels in GitHub's dark (`#0d1117`) or light (`#ffffff`) page color. The title bar is dark for a dark theme and light for a light theme.
- **Fixture summaries.** Each summary in `fixture/agent-journal/` is short enough that its `grep` line fits on one line of the main take (120 columns). Keep new ones as short. The summary of the entry that Claude writes in the take is longer and can break onto a second line.

## Keys in the pane

After the turn, the prompt has the focus, and `Ctrl+X` `Tab` moves it into the pane. The tab order there is `Close`, `All`, `Current`, date `All`, `Year`, `Month`, `Day`, then the rows, newest first. So 8 more `Tab` presses reach the newest entry. In the opened entry, `Esc` goes back to the list, and in the list, `Esc` closes the pane and gives the focus back to the prompt.
